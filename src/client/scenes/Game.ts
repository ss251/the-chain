import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type {
  ChainStateDTO,
  ContributeResponse,
  FallenChain,
  InitResponse,
} from '../../shared/api';

// The Chain's single scene: shared once-a-day, one-tap loop, rendered code-only
// (Phaser shapes/gradients/tweens/particles — no image assets). This is the
// "Molten Kintsugi" pass. The monument is ALWAYS on screen and is the hero: a
// cairn of cooled black glass resting on a basalt ground, one ring per surviving
// day PLUS one still-cooling ring per link poured today, lit only by tight ember
// glows at each seam and a modest pool of light on the ground. Past chains never
// despawn — they fuse into gold-veined rubble at the base ("the gold remembers").
//
// Beats: A (pour arc — drop/hit-stop/cool/etch), B (danger is COLD not red — the
// scene's temperature drops toward ash over the final fraction of the day), and
// D (the shatter — 900ms stillness, veins, detonation into physics shards, epitaph,
// then the new chain rises on the rubble). All are seek-safe against the 3s poll.

const VOID = 0x0b0b10;
const BASALT = 0x1a1a22;
const EMBER = 0xff6a00;
const AMBER = 0xffb454;
const GOLD = 0xc9a227;
const ASH = 0x55606e;
const INK = '#ede6da';

// Fraunces (Black 900) carries the DAY numeral + headlines; IBM Plex Mono is the
// instrument panel — countdown, link count, every system line. Both self-hosted;
// the game boots only after document.fonts.ready, so text never flashes a fallback.
const FONT_DISPLAY = '"Fraunces", Georgia, serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

type State = ChainStateDTO & { username: string | null; youContributed: boolean };

// A physics fragment during Beat D's detonation — hand-rolled gravity + floor bounce.
type Shard = {
  obj: Phaser.GameObjects.Graphics;
  vx: number;
  vy: number;
  vr: number;
  bounces: number;
  resting: boolean;
};

type Ring = {
  x: number;
  y: number;
  w: number;
  h: number;
  gi: number; // global index from the drawn base (0..) — for streak/today classification
  isToday: boolean;
  isCrown: boolean;
};

export class Game extends Scene {
  private state: State | null = null;
  private root!: Phaser.GameObjects.Container;
  private timerText: Phaser.GameObjects.Text | null = null;
  private busy = false;
  // Beat A is a multi-second sequence living outside `root`; this flag keeps a poll
  // mid-pour from starting a second arc or being mistaken for idle.
  private pouring = false;
  // Beat D defer-swap: when a poll reveals the chain broke, we DON'T swap state; we
  // keep rendering the OLD monument, shatter it, then swap. Polls are held meanwhile.
  private shattering = false;
  // countdown baseline: server deadline vs (serverNow + local elapsed)
  private serverNow = 0;
  private serverDeadline = 0;
  private fetchedAt = 0;
  // crown of the monument (top of the stack) in current layout — where a link lands
  private crownX = 0;
  private crownY = 0;
  // the opening recap (monument assembles ring-by-ring) plays once, on first paint
  private hasPlayedRecap = false;
  // danger = the day is running out and the chain is still short; drives the cold
  // colon-blink + the live banner. `chill` (0..1) is the continuous cold-temperature
  // ramp over the final fraction of the day (Beat B).
  private inDanger = false;
  private chill = 0;
  // the one-line hook fades in once per session, on the first paint
  private hasShownHook = false;
  // Persistent ambient FX live on the scene (not `root`) so the 3s poll's teardown
  // never kills them; created once, repositioned each render.
  private groundPool: Phaser.GameObjects.Image | null = null; // pool of light under the stack
  private groundBaseAlpha = 0.2;
  private ashMotes: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private shimmer: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  // the state line is a scene-level object (high depth) so it is NEVER struck by the
  // monument geometry or particles; tracked here to destroy on each re-render + to
  // live-update the danger banner between polls.
  private stateLine: Phaser.GameObjects.Text | null = null;
  private crownLineShort = 0;
  // Beat D shards + their hand-rolled slow-mo (timeScale would fight the real-time
  // delayedCalls that drive the sequence, so shards get their own factor).
  private shards: Shard[] = [];
  private shardSlowmo = 1;
  private shardFloorY = 0;

  constructor() {
    super('Game');
  }

  create() {
    this.cameras.main.setBackgroundColor(VOID);
    this.bakeTextures();

    this.root = this.add.container(0, 0);

    // The monument is the only light source. A modest pool of light rests on the
    // ground under the stack (NOT a big blob in empty space); its alpha breathes,
    // and gutters irregularly in danger. Driven in tickCountdown.
    this.groundPool = this.add
      .image(0, 0, 'glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-6)
      .setAlpha(0.2);

    this.ashMotes = this.add.particles(0, 0, 'spark', {
      x: { min: -40, max: 2200 },
      y: { min: 0, max: 1400 },
      speedY: { min: -14, max: -4 },
      speedX: { min: -4, max: 4 },
      lifespan: { min: 9000, max: 15000 },
      frequency: 600,
      quantity: 1,
      scale: { min: 0.08, max: 0.18 },
      alpha: { start: 0.12, end: 0 },
      tint: [ASH, AMBER],
      blendMode: Phaser.BlendModes.NORMAL,
    });
    this.ashMotes.setDepth(-8);

    // Faint heat-shimmer rising off the crown. Repositioned + throttled each render;
    // it dies back in danger (the fire is guttering).
    this.shimmer = this.add.particles(0, 0, 'spark', {
      speedY: { min: -26, max: -12 },
      speedX: { min: -8, max: 8 },
      lifespan: { min: 900, max: 1600 },
      frequency: 220,
      quantity: 1,
      scale: { start: 0.5, end: 1.1 },
      alpha: { start: 0.22, end: 0 },
      tint: [AMBER, EMBER],
      blendMode: Phaser.BlendModes.ADD,
    });
    this.shimmer.setDepth(4);

    void this.refresh();

    // Poll shared state every 3s (rally feel) + tick the countdown 4x/sec.
    this.time.addEvent({ delay: 3000, loop: true, callback: () => void this.refresh() });
    this.time.addEvent({ delay: 250, loop: true, callback: () => this.tickCountdown() });

    this.scale.on('resize', () => this.render());
  }

  // Bake the two runtime textures we need — no art assets exist. `spark` is a soft
  // dot for embers/motes; `glow` is a radial gradient for the monument's own light.
  private bakeTextures() {
    if (!this.textures.exists('spark')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(4, 4, 4);
      g.generateTexture('spark', 8, 8);
      g.destroy();
    }
    if (!this.textures.exists('glow')) {
      const size = 256;
      const tex = this.textures.createCanvas('glow', size, size);
      if (tex) {
        const ctx = tex.getContext();
        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,150,60,0.95)');
        grad.addColorStop(0.35, 'rgba(255,106,0,0.4)');
        grad.addColorStop(1, 'rgba(255,106,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        tex.refresh();
      }
    }
  }

  private async api<T>(path: string, method: 'GET' | 'POST'): Promise<T | null> {
    try {
      const res = await fetch(path, method === 'POST' ? { method: 'POST' } : undefined);
      if (!res.ok) throw new Error(`${path} -> ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  private ingest(data: State) {
    const prev = this.state;
    // Beat D defer-swap: the chain BROKE (chainNo increased). Do NOT swap to the new
    // bare chain now — keep the OLD monument on screen, play the shatter on it, and
    // only then swap + render the new state. Polls are held (see refresh) until done.
    if (prev && data.chainNo > prev.chainNo && !this.shattering) {
      this.playShatter(prev, data);
      return;
    }
    this.state = data;
    this.serverNow = data.now;
    this.serverDeadline = data.deadline;
    this.fetchedAt = this.time.now;
    this.render();
  }

  private async refresh() {
    if (this.shattering) return; // hold polls through the set-piece
    const data = await this.api<InitResponse>('/api/init', 'GET');
    if (data && data.type === 'init') this.ingest(data);
  }

  private async place() {
    if (this.busy || this.pouring || this.shattering || this.state?.youContributed) return;
    this.busy = true;
    const data = await this.api<ContributeResponse>('/api/contribute', 'POST');
    if (data && data.type === 'contribute') {
      this.ingest(data);
      // Only the FIRST link of the day earns the pour — a repeat tap is a no-op.
      if (data.added) this.playPourFX(data);
    }
    this.busy = false;
  }

  // ---- Beat A: the pour ---------------------------------------------------------
  // The most-repeated moment, built to DESIGN.md §4 verbatim: tap → a white-hot ring
  // materialises above the stack → 120ms hang → drops with Quart.easeIn → impact
  // (40ms hit-stop, camera shake, stack squash, ember burst) → the payoff: the ring
  // COOLS ON CAMERA white → orange → deep red → black glass over ~2.5s → then the
  // placer's username ETCHES in gold. The transient pour ring lands exactly on the
  // persistent today-ring that render() already drew, so it cools into permanence.
  private playPourFX(data: State) {
    if (this.pouring || this.shattering) return;
    this.pouring = true;

    const x = this.crownX;
    const yTarget = this.crownY;
    const width = 150;
    const ringH = 12;
    const startY = yTarget - 90;

    const glow = this.add
      .image(x, startY, 'glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(width * 1.7, 90)
      .setDepth(20)
      .setAlpha(0.95);

    const ring = this.add.graphics({ x, y: startY }).setDepth(21);
    const drawRing = (color: number) => {
      ring.clear();
      ring.fillStyle(color, 1);
      ring.fillRoundedRect(-width / 2, -ringH / 2, width, ringH, 4);
    };
    drawRing(0xffffff);

    this.tweens.add({
      targets: [ring, glow],
      y: yTarget,
      ease: 'Quart.easeIn',
      delay: 120,
      duration: 200,
      onComplete: () => this.pourImpact(data, x, yTarget, ring, glow, drawRing),
    });
  }

  private pourImpact(
    data: State,
    x: number,
    yTarget: number,
    ring: Phaser.GameObjects.Graphics,
    glow: Phaser.GameObjects.Image,
    drawRing: (color: number) => void
  ) {
    // 40ms hit-stop: freeze every in-flight tween, then the reaction fires.
    this.tweens.pauseAll();
    window.setTimeout(() => {
      this.tweens.resumeAll();

      this.cameras.main.shake(150, 0.004);

      this.root.setScale(1.04, 0.94);
      this.tweens.add({
        targets: this.root,
        scaleX: 1,
        scaleY: 1,
        duration: 180,
        ease: 'Back.easeOut',
        onComplete: () => this.root.setScale(1),
      });

      const emitter = this.add.particles(x, yTarget, 'spark', {
        speed: { min: 40, max: 180 },
        angle: { min: 200, max: 340 },
        gravityY: 340,
        lifespan: { min: 380, max: 900 },
        scale: { start: 0.9, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [EMBER, AMBER],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      });
      emitter.setDepth(22);
      emitter.explode(Phaser.Math.Between(15, 20), x, yTarget);
      this.time.delayedCall(1100, () => emitter.destroy());

      // the reward: cool ON CAMERA over ~2.5s. White → orange → deep red → black.
      const ramp = [0xffffff, EMBER, 0x7a1500, 0x121118].map((c) =>
        Phaser.Display.Color.ValueToColor(c)
      );
      const cool = { t: 0 };
      this.tweens.add({
        targets: cool,
        t: 1,
        duration: 2500,
        ease: 'Sine.easeOut',
        onUpdate: () => {
          const seg = Math.min(ramp.length - 2, Math.floor(cool.t * (ramp.length - 1)));
          const local = cool.t * (ramp.length - 1) - seg;
          const c = Phaser.Display.Color.Interpolate.ColorWithColor(
            ramp[seg]!,
            ramp[seg + 1]!,
            100,
            local * 100
          );
          drawRing(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
          glow.setAlpha(0.95 * (1 - cool.t));
        },
        onComplete: () => {
          glow.destroy();
          this.etchName(data, x, yTarget, ring);
        },
      });
    }, 40);
  }

  // The username etches into the ring in gold, letter by letter (~400ms), then the
  // quotable line is handed over and the transient ring fades — the persistent
  // today-ring render() drew underneath takes over cleanly.
  private etchName(data: State, x: number, yTarget: number, ring: Phaser.GameObjects.Graphics) {
    const name = (data.username ?? 'a keeper').toUpperCase();
    const label = this.add
      .text(x, yTarget, '', {
        fontFamily: FONT_MONO,
        fontSize: 13,
        color: hex(GOLD),
        letterSpacing: 2,
      })
      .setOrigin(0.5)
      .setDepth(23);

    const idx = { i: 0 };
    this.tweens.add({
      targets: idx,
      i: name.length,
      duration: 400,
      ease: 'Linear',
      onUpdate: () => label.setText(name.slice(0, Math.round(idx.i))),
      onComplete: () => {
        label.setText(name);
        this.handQuote(data);
        this.time.delayedCall(2600, () => {
          this.tweens.add({
            targets: [ring, label],
            alpha: 0,
            duration: 600,
            onComplete: () => {
              ring.destroy();
              label.destroy();
              this.pouring = false;
            },
          });
        });
      },
    });
  }

  // DESIGN.md §6 — after placing, hand the player words they can screenshot and quote.
  // Rendered on a dark card at high depth so it is never struck by the monument.
  private handQuote(data: State) {
    const { width, height } = this.scale;
    const now = new Date();
    const clock = `${now.getHours().toString().padStart(2, '0')}:${now
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
    const keepers = data.keepers ?? [];
    const pos =
      data.username != null && keepers.indexOf(data.username) >= 0
        ? keepers.indexOf(data.username) + 1
        : Math.max(1, data.count);
    const line = `Link ${data.count} of ${data.goal}. You placed at ${clock} — ${Game.ordinal(
      pos
    )} keeper today.`;
    this.cardText(width / 2, height * 0.46, line, 15, INK, 4200);
  }

  private static ordinal(n: number): string {
    const words = [
      'zeroth',
      'first',
      'second',
      'third',
      'fourth',
      'fifth',
      'sixth',
      'seventh',
      'eighth',
      'ninth',
      'tenth',
      'eleventh',
      'twelfth',
    ];
    if (n >= 1 && n < words.length) return words[n]!;
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
  }

  // Chains are numbered like dynasties: Chain I, Chain II, ... (DESIGN.md §7.3).
  private static roman(n: number): string {
    if (n <= 0) return String(n);
    const map: [number, string][] = [
      [1000, 'M'],
      [900, 'CM'],
      [500, 'D'],
      [400, 'CD'],
      [100, 'C'],
      [90, 'XC'],
      [50, 'L'],
      [40, 'XL'],
      [10, 'X'],
      [9, 'IX'],
      [5, 'V'],
      [4, 'IV'],
      [1, 'I'],
    ];
    let r = '';
    let v = n;
    for (const [val, sym] of map) {
      while (v >= val) {
        r += sym;
        v -= val;
      }
    }
    return r;
  }

  private async dev(path: string) {
    const data = await this.api<InitResponse>(path, 'POST');
    if (data && data.type === 'init') this.ingest(data);
  }

  private remainingMs(): number {
    if (!this.state) return 0;
    const elapsed = this.time.now - this.fetchedAt;
    return Math.max(0, this.serverDeadline - (this.serverNow + elapsed));
  }

  private static fmt(ms: number): string {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
  }

  private tickCountdown() {
    if (this.shattering) return; // the sequence owns the screen; freeze the clock
    const rem = this.remainingMs();
    const blink = this.inDanger && Math.floor(this.time.now / 500) % 2 === 0;
    if (this.timerText) {
      let txt = Game.fmt(rem);
      if (blink) txt = txt.replace(/:/g, ' ');
      this.timerText.setText(txt);
    }
    // Beat B: the danger banner lives ON the state line, in Plex Mono, colon blinking.
    if (this.inDanger && this.stateLine) {
      let t = Game.fmt(rem);
      if (blink) t = t.replace(/:/g, ' ');
      this.stateLine.setText(`${this.crownLineShort} SHORT · ${t}`);
    }
    // The ground pool breathes; in danger the ember gutters irregularly, the flicker
    // quickening as the day dies (Beat B). Heat, not a periodic pulse.
    if (this.groundPool) {
      if (this.inDanger) {
        if (Math.random() < 0.3 + 0.6 * this.chill) {
          const a = this.groundBaseAlpha * (0.25 + Math.random() * 0.6) * (1 - 0.7 * this.chill);
          this.groundPool.setAlpha(Math.max(0.02, a));
        }
      } else {
        const breathe = this.groundBaseAlpha * (0.85 + 0.15 * Math.sin(this.time.now / 900));
        this.groundPool.setAlpha(breathe);
      }
    }
  }

  // Interpolate two 0xRRGGBB colors by t in [0,1].
  private mix(a: number, b: number, t: number): number {
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(a),
      Phaser.Display.Color.ValueToColor(b),
      100,
      Phaser.Math.Clamp(t, 0, 1) * 100
    );
    return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
  }

  // Scale a Text down to fit maxW so nothing ever clips on a 375px webview.
  private fit(t: Phaser.GameObjects.Text, maxW: number): Phaser.GameObjects.Text {
    if (t.width > maxW) t.setScale(maxW / t.width);
    return t;
  }

  private truncName(name: string): string {
    return name.length > 11 ? name.slice(0, 10) + '…' : name;
  }

  // A single Fraunces/mono text on a dark card at high depth — never struck by the
  // monument geometry or particles. Fades in, holds, fades out.
  private cardText(x: number, y: number, text: string, size: number, color: string, hold: number) {
    const t = this.add
      .text(x, y, text, {
        fontFamily: FONT_MONO,
        fontSize: size,
        color,
        align: 'center',
        wordWrap: { width: Math.min(320, this.scale.width * 0.84) },
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setDepth(51)
      .setAlpha(0);
    const pad = 14;
    const card = this.add
      .rectangle(x, y, t.width + pad * 2, t.height + pad, VOID, 0.82)
      .setStrokeStyle(1, BASALT)
      .setOrigin(0.5)
      .setDepth(50)
      .setAlpha(0);
    this.tweens.add({
      targets: [t, card],
      alpha: 1,
      duration: 500,
      hold,
      yoyo: true,
      onComplete: () => {
        t.destroy();
        card.destroy();
      },
    });
  }

  // ---- layout -------------------------------------------------------------------
  // The stack: bottom `streak` rings are cooled black glass; the top `count` rings
  // are TODAY'S links, warmer and still-cooling. Grows UP from the ground; the crown
  // tracks the height. When the total exceeds the cap we drop the OLDEST (bottom)
  // rings so today's always show, and mark how many are hidden.
  private ringGeom(streak: number, count: number, width: number, height: number) {
    const maxShown = 14;
    const total = streak + count;
    const shown = Math.min(total, maxShown);
    const hiddenBelow = total - shown;
    const cx = width / 2;
    const baseY = height * 0.63; // the ground line
    const ringH = 12;
    const gap = 3;
    const rings: Ring[] = [];
    for (let i = 0; i < shown; i++) {
      const gi = hiddenBelow + i; // global index from the true base
      const w = Math.max(34, 150 - i * 6); // widest at the bottom, tapering up
      const y = baseY - ringH / 2 - 3 - i * (ringH + gap);
      rings.push({ x: cx, y, w, h: ringH, gi, isToday: gi >= streak, isCrown: i === shown - 1 });
    }
    const crownY = shown > 0 ? rings[shown - 1]!.y : baseY - ringH;
    const stackW = shown > 0 ? Math.max(...rings.map((r) => r.w)) : 130;
    return { rings, baseY, crownY, cx, shown, total, hiddenBelow, stackW, ringH };
  }

  private render() {
    if (!this.state) return;
    const { width, height } = this.scale;
    this.cameras.resize(width, height);
    this.root.removeAll(true);
    this.root.setVisible(true);
    this.timerText = null;
    this.stateLine?.destroy();
    this.stateLine = null;

    const cx = width / 2;
    const s = this.state;
    const held = s.count >= s.goal;

    // Beat B: continuous cold-temperature ramp over the final fraction of the day.
    const rem = this.remainingMs();
    const dangerT = s.dayMs * 0.4;
    const danger = !held && rem < dangerT;
    this.inDanger = danger;
    this.chill = danger ? Phaser.Math.Clamp((dangerT - rem) / dangerT, 0, 1) : 0;
    const chill = this.chill;
    this.crownLineShort = Math.max(0, s.goal - s.count);

    const geom = this.ringGeom(s.streak, s.count, width, height);
    const doRecap = !this.hasPlayedRecap && s.streak > 1;

    // --- header: chain # (Roman, mono) + day numeral (Fraunces Black) ---
    this.fit(
      this.label(cx, height * 0.065, `CHAIN ${Game.roman(s.chainNo)}`, 18, hex(GOLD), {
        tracking: 3,
      }),
      width * 0.8
    );
    const dayLabel = this.label(cx, height * 0.15, `DAY ${s.streak}`, 64, INK, {
      display: true,
      tracking: -1,
    });

    // --- the ground + the graveyard of past chains fused into it ---
    this.drawGround(cx, geom.baseY, geom.stackW, geom.total, chill);
    this.drawRubble(cx, geom.baseY, s.fallen ?? []);

    // --- the monument: cooled glass below, today's warm links on top ---
    const stagger = 60;
    const keepers = s.keepers ?? [];
    let todaySeen = 0; // index into today's keepers, bottom(oldest)-first
    for (let i = 0; i < geom.shown; i++) {
      const r = geom.rings[i]!;
      const g = this.drawGlassRing(r.x, r.y, r.w, r.h, chill, r.isToday, r.isCrown);
      this.root.add(g);

      // tight additive glow emanating from the seam geometry (no glow in empty space)
      const warm = r.isToday ? (r.isCrown ? 1 : 0.85) : 0.5;
      const seamGlow = this.add
        .image(r.x, r.y + r.h / 2, 'glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDisplaySize(r.w * 0.72, 15)
        .setDepth(1)
        .setAlpha(warm * 0.5 * (1 - 0.85 * chill))
        .setTint(chill > 0.5 ? ASH : r.isToday ? AMBER : EMBER);
      this.root.add(seamGlow);

      // carve the people into the object: today's rings bear their placer's name
      if (r.isToday) {
        const nm = keepers[todaySeen];
        todaySeen++;
        if (nm) {
          const isYou = s.username != null && nm === s.username;
          const nameLbl = this.add
            .text(r.x, r.y, this.truncName(nm.toUpperCase()), {
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: isYou ? hex(AMBER) : hex(GOLD),
              letterSpacing: 1,
            })
            .setOrigin(0.5)
            .setDepth(3);
          this.fit(nameLbl, r.w - 8);
          this.root.add(nameLbl);
        }
      }

      if (doRecap && !r.isToday) {
        g.setAlpha(0).setY(r.y + 10);
        seamGlow.setAlpha(0);
        this.tweens.add({
          targets: [g, seamGlow],
          alpha: 1,
          delay: i * stagger,
          duration: 220,
          ease: 'Quad.easeOut',
        });
        this.tweens.add({ targets: g, y: r.y, delay: i * stagger, duration: 220, ease: 'Quad.easeOut' });
      }
    }

    if (doRecap) {
      const ticker = { v: 0 };
      this.tweens.add({
        targets: ticker,
        v: s.streak,
        duration: Math.max(300, geom.shown * stagger),
        ease: 'Quad.easeOut',
        onUpdate: () => dayLabel.setText(`DAY ${Math.round(ticker.v)}`),
        onComplete: () => dayLabel.setText(`DAY ${s.streak}`),
      });
    }

    // crown (top of stack) so the pour FX lands in the right place
    this.crownX = cx;
    this.crownY = geom.crownY;
    this.positionAmbient(cx, geom.baseY, geom.crownY, geom.stackW, geom.total, chill);

    if (geom.hiddenBelow > 0) {
      this.label(cx, geom.baseY - 2, `+${geom.hiddenBelow} EARLIER`, 11, hex(AMBER), {
        tracking: 1,
      });
    }

    // --- today's keepers roster: usernames etched in gold (social proof) ---
    this.drawKeepers(width, height, s);

    // --- the state line: below the monument, high depth, never struck by geometry.
    // State-aware (Beat B danger banner folds in here and updates live in the tick).
    this.drawStateLine(cx, geom.baseY + height * 0.075, s, held, danger);

    // --- count / goal (mono, shrunk — the monument is the hero, not the counter) ---
    const progColor = held ? hex(AMBER) : danger ? hex(ASH) : INK;
    this.label(cx, height * 0.78, `${s.count} / ${s.goal} LINKS TODAY`, 21, progColor, {
      weight: '700',
      tracking: 2,
    });

    // --- countdown (mono) ---
    this.timerText = this.label(cx, height * 0.835, Game.fmt(rem), 24, hex(AMBER), {
      weight: '700',
      tracking: 1,
    });

    // --- the one interaction: place your link ---
    this.button(
      cx,
      height * 0.9,
      s.username == null
        ? 'LOG IN TO POUR'
        : s.youContributed
          ? "YOU'VE POURED TODAY"
          : 'POUR YOUR LINK',
      s.youContributed || s.username == null ? GOLD : EMBER,
      s.youContributed || s.username == null,
      () => void this.place()
    );

    // --- DEV controls: only rendered in PLAYTEST builds (server sends dev:true) ---
    if (s.dev) {
      this.smallButton(width * 0.5 - 90, height * 0.965, 'DEV: rollover', () =>
        void this.dev('/api/dev/rollover')
      );
      this.smallButton(width * 0.5 + 90, height * 0.965, 'DEV: reset', () =>
        void this.dev('/api/dev/reset')
      );
    }

    this.hasPlayedRecap = true;

    if (!this.hasShownHook) {
      this.hasShownHook = true;
      this.cardText(
        width / 2,
        height * 0.42,
        'One link a day, together,\nor the chain breaks for everyone.',
        18,
        INK,
        2600
      );
    }
  }

  // The state line — one warm keeper's-log sentence, or the cold danger banner.
  private drawStateLine(x: number, y: number, s: State, held: boolean, danger: boolean) {
    let text: string;
    let color: number;
    if (danger) {
      text = `${this.crownLineShort} SHORT · ${Game.fmt(this.remainingMs())}`;
      color = ASH;
    } else if (held) {
      text = `the chain holds — ${s.count} keeper${s.count === 1 ? '' : 's'} today`;
      color = AMBER;
    } else if (s.count === 0) {
      text = 'the ground is bare — pour the first link';
      color = ASH;
    } else {
      text = `${this.crownLineShort} more before the dark`;
      color = GOLD;
    }
    const t = this.add
      .text(x, y, text, {
        fontFamily: FONT_MONO,
        fontSize: 15,
        color: hex(color),
        align: 'center',
        letterSpacing: 1,
        wordWrap: { width: Math.min(340, this.scale.width * 0.9) },
        lineSpacing: 4,
      })
      .setOrigin(0.5)
      .setDepth(50);
    this.fit(t, Math.min(340, this.scale.width * 0.92));
    this.stateLine = t;
  }

  // A low basalt ground the rings physically rest on. A subtle rim highlight is lit
  // by the ember pool; when the ground is bare a faint ember pit glows in its center.
  private drawGround(cx: number, baseY: number, stackW: number, total: number, chill: number) {
    const g = this.add.graphics().setDepth(-5);
    const gw = Math.max(160, stackW * 1.5);
    g.fillStyle(this.mix(0x14141b, 0x0e0e14, 0.4 + chill * 0.4), 1);
    g.fillEllipse(cx, baseY + 5, gw, 24);
    g.fillStyle(this.mix(0x2a2732, ASH, chill), 0.45 * (1 - 0.6 * chill));
    g.fillEllipse(cx, baseY - 1, gw * 0.9, 11);
    // the bare-ground ember pit — a place, not a void
    if (total === 0) {
      g.fillStyle(this.mix(EMBER, ASH, chill), 0.5 * (1 - 0.7 * chill));
      g.fillEllipse(cx, baseY, 46, 12);
      g.fillStyle(this.mix(AMBER, ASH, chill), 0.7 * (1 - 0.7 * chill));
      g.fillEllipse(cx, baseY, 22, 6);
    }
    this.root.add(g);
  }

  // The graveyard: each fallen chain is a low mound of dark shards fused with thin
  // gold veins at the base — oldest deepest (DESIGN.md §7.3 "the gold remembers").
  private drawRubble(cx: number, baseY: number, fallen: FallenChain[]) {
    const list = fallen.slice(-5);
    for (let j = 0; j < list.length; j++) {
      const f = list[j]!;
      const depth = list.length - j; // oldest (j=0) sits deepest
      const y = baseY + 6 + depth * 3;
      const spread = Math.min(160, 66 + f.days * 4);
      const g = this.add.graphics().setDepth(-4);
      g.fillStyle(this.mix(0x1a1a22, 0x0d0d13, Math.min(1, depth / 5)), 1);
      g.fillEllipse(cx, y, spread, 12);
      // gold veins fused in — deterministic so they don't flicker across polls
      g.lineStyle(1, GOLD, 0.5);
      const veins = Math.min(6, 2 + Math.floor(f.keepers / 2));
      for (let k = 0; k < veins; k++) {
        const vx = cx - spread / 2 + ((k * 53 + f.chainNo * 17) % Math.max(1, Math.floor(spread)));
        g.beginPath();
        g.moveTo(vx - 6, y + 2);
        g.lineTo(vx + 6, y - 3);
        g.strokePath();
      }
      this.root.add(g);
    }
  }

  // A single glass ring. Cooled streak rings are basalt; today's rings run warmer.
  // In danger the whole ring lerps toward ash (Beat B — no red anywhere), and the
  // newest ring grows faint hairline cracks as the day dies.
  private drawGlassRing(
    x: number,
    y: number,
    w: number,
    h: number,
    chill: number,
    isToday: boolean,
    isCrown: boolean
  ): Phaser.GameObjects.Graphics {
    const g = this.add.graphics({ x, y });
    const left = -w / 2;
    const top = -h / 2;

    const rim = this.mix(isToday ? 0x3a3540 : 0x33303c, 0x2b3038, chill);
    const base = this.mix(isToday ? 0x171320 : 0x121017, 0x0f1216, chill);
    g.fillGradientStyle(rim, rim, base, base, 1);
    g.fillRoundedRect(left, top, w, h, 4);

    g.fillStyle(this.mix(0x4a4550, ASH, chill), 0.5);
    g.fillRoundedRect(left + 2, top + 1, w - 4, 1.5, 1);

    // ember seam at the joint. Crown burns hottest; danger cools every seam to ash.
    const hot = isCrown ? 0xffcaa0 : isToday ? AMBER : EMBER;
    const seam = this.mix(hot, ASH, chill);
    const seamA = 1 - 0.6 * chill;
    g.fillStyle(seam, 0.18 * seamA);
    g.fillRect(left + 2, top + h - 5, w - 4, 8);
    g.fillStyle(seam, 0.34 * seamA);
    g.fillRect(left + 3, top + h - 3, w - 6, 4);
    g.fillStyle(seam, 0.95 * seamA);
    g.fillRect(left + 4, top + h - 2, w - 8, 1.6);

    if (isCrown && chill > 0.35) {
      const n = chill > 0.7 ? 3 : 2;
      g.lineStyle(1, ASH, 0.3 + 0.5 * chill);
      for (let k = 0; k < n; k++) {
        let px = left + 8 + (k * (w - 16)) / n;
        g.beginPath();
        g.moveTo(px, top + 1);
        for (let step = 1; step <= 4; step++) {
          px += w * 0.09 * (Math.random() - 0.5);
          g.lineTo(px, top + (h * step) / 4);
        }
        g.strokePath();
      }
    }

    return g;
  }

  // Reposition the ground light pool + heat shimmer + ash-mote density each render.
  private positionAmbient(
    cx: number,
    baseY: number,
    crownY: number,
    stackW: number,
    total: number,
    chill: number
  ) {
    if (this.groundPool) {
      if (total === 0) {
        this.groundPool.setPosition(cx, baseY).setDisplaySize(stackW * 1.1, stackW * 0.45);
        this.groundBaseAlpha = 0.24;
      } else {
        this.groundPool.setPosition(cx, baseY - 4).setDisplaySize(stackW * 1.3, stackW * 0.55);
        this.groundBaseAlpha = Math.min(0.25, 0.22);
      }
    }
    if (this.shimmer) {
      this.shimmer.setPosition(cx, crownY);
      this.shimmer.frequency = 220 + chill * 1600; // heat dies as it cools
    }
    if (this.ashMotes) {
      this.ashMotes.frequency = Math.max(180, 600 - chill * 420); // motes thicken in danger
    }
  }

  // ---- Beat D: the shatter ------------------------------------------------------
  // Triggered from ingest() when chainNo increased. Renders on the OLD monument
  // (still in `root`); the new state is swapped in only at the very end.
  private playShatter(old: State, next: State) {
    this.shattering = true;
    this.pouring = false;
    this.inDanger = false;
    const { width, height } = this.scale;
    const geom = this.ringGeom(old.streak, old.count, width, height);
    this.shardFloorY = geom.baseY;

    // 900ms of absolute stillness: particles freeze, the glow dies to black.
    this.ashMotes?.stop();
    this.shimmer?.stop();
    if (this.groundPool) this.tweens.add({ targets: this.groundPool, alpha: 0, duration: 260 });

    const veins = this.add.graphics().setDepth(25);
    const veinPts = this.buildVeinPath(geom);

    const STILL = 900;
    const VEIN = 800;
    const HIT = 100;

    this.time.delayedCall(STILL, () => {
      // stress veins propagate down the stack, crown → base
      const p = { v: 0 };
      this.tweens.add({
        targets: p,
        v: 1,
        duration: VEIN,
        ease: 'Quad.easeIn',
        onUpdate: () => this.drawVeins(veins, veinPts, p.v),
      });
    });

    this.time.delayedCall(STILL + VEIN, () => {
      this.time.delayedCall(HIT, () => this.detonate(old, next, geom, veins));
    });
  }

  private buildVeinPath(geom: ReturnType<typeof this.ringGeom>): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const y = geom.crownY + ((geom.baseY - geom.crownY) * i) / steps;
      const x = geom.cx + Phaser.Math.Between(-16, 16);
      pts.push({ x, y });
    }
    return pts;
  }

  private drawVeins(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[], p: number) {
    g.clear();
    g.lineStyle(1.5, ASH, 0.6);
    const reach = Math.max(1, Math.floor(pts.length * p));
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < reach; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
    g.strokePath();
  }

  private detonate(
    old: State,
    next: State,
    geom: ReturnType<typeof this.ringGeom>,
    veins: Phaser.GameObjects.Graphics
  ) {
    // camera shake amplitude proportional to ring count
    this.cameras.main.shake(600, Math.min(0.03, 0.006 + geom.shown * 0.0016));
    this.root.setVisible(false); // shards replace the standing monument
    veins.destroy();

    // slow-mo the shard rain (own factor; delayedCalls stay real-time)
    this.shardSlowmo = 0.3;
    this.time.delayedCall(700, () => {
      this.shardSlowmo = 1;
    });

    // every ring bursts into 8–16 shards with hand-rolled gravity + bounce
    for (const r of geom.rings) {
      const n = Phaser.Math.Between(8, 16);
      for (let k = 0; k < n; k++) {
        this.shards.push(this.makeShard(r.x + Phaser.Math.Between(-r.w / 2, r.w / 2), r.y));
      }
    }

    this.time.delayedCall(1400, () => this.showEpitaph(old, next, geom));
  }

  private makeShard(x: number, y: number): Shard {
    const g = this.add.graphics({ x, y }).setDepth(24);
    const sz = Phaser.Math.Between(4, 9);
    g.fillStyle(this.mix(0x1a1a22, 0x0f1216, Math.random()), 1);
    g.beginPath();
    g.moveTo(-sz, -sz * 0.6);
    g.lineTo(sz * 0.8, -sz);
    g.lineTo(sz, sz * 0.7);
    g.lineTo(-sz * 0.7, sz);
    g.closePath();
    g.fillPath();
    // some shards carry a gold vein — the gold remembers
    if (Math.random() < 0.4) {
      g.lineStyle(1, GOLD, 0.9);
      g.beginPath();
      g.moveTo(-sz * 0.6, -sz * 0.4);
      g.lineTo(sz * 0.5, sz * 0.3);
      g.strokePath();
    }
    return {
      obj: g,
      vx: Phaser.Math.Between(-260, 260),
      vy: Phaser.Math.Between(-460, -120),
      vr: Phaser.Math.FloatBetween(-6, 6),
      bounces: 0,
      resting: false,
    };
  }

  private showEpitaph(
    old: State,
    next: State,
    geom: ReturnType<typeof this.ringGeom>
  ) {
    const rec = (next.fallen ?? []).find((f) => f.chainNo === old.chainNo);
    const days = rec?.days ?? old.streak;
    const keepers = rec?.keepers ?? (old.keepers?.length ?? 0);
    const line = `Chain ${Game.roman(old.chainNo)} — held ${days} day${
      days === 1 ? '' : 's'
    } by ${keepers} keeper${keepers === 1 ? '' : 's'}.`;
    const t = this.add
      .text(this.scale.width / 2, geom.baseY - 40, line, {
        fontFamily: FONT_DISPLAY,
        fontStyle: '900',
        fontSize: 22,
        color: INK,
        align: 'center',
        wordWrap: { width: this.scale.width * 0.88 },
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setDepth(52)
      .setAlpha(0);
    this.fit(t, this.scale.width * 0.9);
    this.tweens.add({ targets: t, alpha: 1, duration: 700 });
    // after ~2.5s the new chain rises on the rubble
    this.time.delayedCall(3200, () => this.completeShatter(next, t));
  }

  private completeShatter(next: State, epitaph: Phaser.GameObjects.Text) {
    this.state = next;
    this.serverNow = next.now;
    this.serverDeadline = next.deadline;
    this.fetchedAt = this.time.now;

    // the settled shards fade as the persistent rubble (from `fallen`) takes over
    const dead = this.shards.map((s) => s.obj);
    this.shards = [];
    if (dead.length) {
      this.tweens.add({
        targets: dead,
        alpha: 0,
        duration: 700,
        onComplete: () => dead.forEach((o) => o.destroy()),
      });
    }
    this.tweens.add({
      targets: epitaph,
      alpha: 0,
      duration: 700,
      delay: 300,
      onComplete: () => epitaph.destroy(),
    });

    this.ashMotes?.start();
    this.shimmer?.start();
    this.shattering = false;

    // render the new bare chain over the rubble, fading in on top
    this.render();
    this.root.setAlpha(0);
    this.tweens.add({ targets: this.root, alpha: 1, duration: 900, delay: 400 });
  }

  // Per-frame integration for the shatter shards (hand-rolled physics).
  override update(_time: number, delta: number) {
    if (this.shards.length === 0) return;
    const dt = Math.min(0.05, delta / 1000) * this.shardSlowmo;
    const floorY = this.shardFloorY;
    for (const sh of this.shards) {
      if (sh.resting) continue;
      sh.vy += 900 * dt;
      sh.obj.x += sh.vx * dt;
      sh.obj.y += sh.vy * dt;
      sh.obj.rotation += sh.vr * dt;
      if (sh.obj.y >= floorY) {
        sh.obj.y = floorY;
        sh.vy *= -0.42;
        sh.vx *= 0.6;
        sh.vr *= 0.5;
        sh.bounces++;
        if (Math.abs(sh.vy) < 40 || sh.bounces > 4) {
          sh.resting = true;
          sh.vy = 0;
          sh.vx = 0;
          sh.vr = 0;
        }
      }
    }
  }

  // A single text helper. `display` swaps to Fraunces Black; otherwise IBM Plex Mono.
  private label(
    x: number,
    y: number,
    text: string,
    size: number,
    color: string,
    opts?: { display?: boolean; weight?: string; tracking?: number }
  ) {
    const display = opts?.display ?? false;
    const t = this.add
      .text(x, y, text, {
        fontFamily: display ? FONT_DISPLAY : FONT_MONO,
        fontSize: size,
        fontStyle: opts?.weight ?? (display ? '900' : '400'),
        color,
        align: 'center',
        letterSpacing: opts?.tracking ?? 0,
      })
      .setOrigin(0.5);
    this.root.add(t);
    return t;
  }

  // Etched-gold roster of today's keepers — the load-bearing mitigation for a lone
  // judge who cannot see the crowd. Strangers' names, then the judge's own.
  private drawKeepers(width: number, height: number, s: State) {
    const keepers = s.keepers ?? [];
    if (keepers.length === 0) return;

    const rightX = width - 14;
    const maxRows = 7;
    const rowH = 20;
    const startY = height * 0.28;

    const header = this.add
      .text(rightX, startY - rowH, 'KEEPERS TODAY', {
        fontFamily: FONT_MONO,
        fontSize: 12,
        color: hex(GOLD),
        letterSpacing: 2,
      })
      .setOrigin(1, 0.5);
    this.root.add(header);

    const rows = Math.min(keepers.length, maxRows);
    for (let i = 0; i < rows; i++) {
      const name = keepers[i]!;
      const isYou = s.username != null && name === s.username;
      const t = this.add
        .text(rightX, startY + i * rowH, `${this.truncName(name).toUpperCase()}${isYou ? ' ·YOU' : ''}`, {
          fontFamily: FONT_MONO,
          fontSize: isYou ? 15 : 14,
          fontStyle: isYou ? '700' : '400',
          color: isYou ? hex(AMBER) : hex(GOLD),
          letterSpacing: 1,
        })
        .setOrigin(1, 0.5);
      this.root.add(t);
    }
    if (keepers.length > maxRows) {
      const more = this.add
        .text(rightX, startY + rows * rowH, `+${keepers.length - maxRows} MORE`, {
          fontFamily: FONT_MONO,
          fontSize: 12,
          color: hex(ASH),
          letterSpacing: 1,
        })
        .setOrigin(1, 0.5);
      this.root.add(more);
    }
  }

  private button(
    x: number,
    y: number,
    text: string,
    color: number,
    disabled: boolean,
    onClick: () => void
  ) {
    const w = 280;
    const h = 54;
    const bg = this.add
      .rectangle(x, y, w, h, disabled ? BASALT : color)
      .setStrokeStyle(2, disabled ? ASH : color)
      .setOrigin(0.5);
    const t = this.add
      .text(x, y, text, {
        fontFamily: FONT_MONO,
        fontStyle: '700',
        fontSize: 20,
        color: disabled ? hex(ASH) : '#0b0b10',
        letterSpacing: 2,
      })
      .setOrigin(0.5);
    if (!disabled) {
      bg.setInteractive({ useHandCursor: true })
        .on('pointerover', () => bg.setFillStyle(AMBER))
        .on('pointerout', () => bg.setFillStyle(color))
        .on('pointerdown', onClick);
    }
    this.root.add(bg);
    this.root.add(t);
  }

  private smallButton(x: number, y: number, text: string, onClick: () => void) {
    const bg = this.add
      .rectangle(x, y, 150, 26, BASALT)
      .setStrokeStyle(1, ASH)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onClick);
    const t = this.add
      .text(x, y, text, { fontFamily: FONT_MONO, fontSize: 12, color: hex(ASH) })
      .setOrigin(0.5);
    this.root.add(bg);
    this.root.add(t);
  }
}
