import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { ChainStateDTO, ContributeResponse, InitResponse } from '../../shared/api';

// The Chain's single scene: shared once-a-day, one-tap loop, rendered code-only
// (Phaser shapes/gradients/tweens/particles — no image assets). This is the
// "Molten Kintsugi" pass: the monument is cooled black glass, lit only by the ember
// seams glowing at each ring joint, with heat-shimmer over the crown and slow ash
// motes drifting in the void. Juice beats live here: Beat A's full pour arc (drop →
// hit-stop → cool-on-camera → gold etch), the keepers roster, the opening recap,
// and the cold danger blink. The shatter (Beat D) is still to be built.

const VOID = 0x0b0b10;
const BASALT = 0x1a1a22;
const EMBER = 0xff6a00;
const AMBER = 0xffb454;
const GOLD = 0xc9a227;
const ASH = 0x55606e;
const INK = '#ede6da';

// Fraunces (Black 900, optical size auto-tracks the large point sizes) carries the
// DAY numeral + headlines; IBM Plex Mono is the instrument panel — countdown, link
// count, every system line. Both are self-hosted (see game.css / game.ts) and the
// game boots only after document.fonts.ready, so text never flashes a fallback.
const FONT_DISPLAY = '"Fraunces", Georgia, serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

type State = ChainStateDTO & { username: string | null; youContributed: boolean };

export class Game extends Scene {
  private state: State | null = null;
  private root!: Phaser.GameObjects.Container;
  private timerText: Phaser.GameObjects.Text | null = null;
  private busy = false;
  // Beat A is a multi-second sequence living outside `root`; this flag keeps a poll
  // mid-pour from starting a second arc or being mistaken for idle.
  private pouring = false;
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
  // colon-blink on the countdown (set in render, read in the 4x/sec tick)
  private inDanger = false;
  // the one-line hook fades in once per session, on the first paint
  private hasShownHook = false;
  // Persistent ambient FX live on the scene (not `root`) so the 3s poll's teardown
  // never kills them; they are created once and repositioned each render.
  private ambientGlow: Phaser.GameObjects.Image | null = null;
  private ashMotes: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private shimmer: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  constructor() {
    super('Game');
  }

  create() {
    this.cameras.main.setBackgroundColor(VOID);
    this.bakeTextures();

    this.root = this.add.container(0, 0);

    // Ambient light: the monument is the only light source. A soft additive glow
    // sits behind the crown; slow ash motes drift up through the void.
    this.ambientGlow = this.add
      .image(0, 0, 'glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-10)
      .setAlpha(0.45);
    this.tweens.add({
      targets: this.ambientGlow,
      alpha: 0.6,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.ashMotes = this.add.particles(0, 0, 'spark', {
      x: { min: -40, max: 2200 },
      y: { min: 0, max: 1400 },
      speedY: { min: -14, max: -4 },
      speedX: { min: -4, max: 4 },
      lifespan: { min: 9000, max: 15000 },
      frequency: 600,
      quantity: 1,
      scale: { min: 0.08, max: 0.18 },
      // a gentle drift: each mote eases up from faint then dies out, never twinkles
      alpha: { start: 0.12, end: 0 },
      tint: [ASH, AMBER],
      blendMode: Phaser.BlendModes.NORMAL,
    });
    this.ashMotes.setDepth(-8);

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
    this.state = data;
    this.serverNow = data.now;
    this.serverDeadline = data.deadline;
    this.fetchedAt = this.time.now;
    this.render();
  }

  private async refresh() {
    const data = await this.api<InitResponse>('/api/init', 'GET');
    if (data && data.type === 'init') this.ingest(data);
  }

  private async place() {
    if (this.busy || this.pouring || this.state?.youContributed) return;
    this.busy = true;
    const data = await this.api<ContributeResponse>('/api/contribute', 'POST');
    if (data && data.type === 'contribute') {
      this.ingest(data);
      // Only the FIRST link of the day earns the pour — a repeat tap is a no-op.
      if (data.added) this.playPourFX(data);
    }
    this.busy = false;
  }

  // Beat A — the most-repeated moment, the one a solo judge is guaranteed to feel,
  // built to the DESIGN.md §4 arc verbatim: tap → a white-hot ring materialises above
  // the stack → 120ms hang → drops with Quart.easeIn → impact (40ms hit-stop, camera
  // shake, stack squash, ember burst) → the payoff: the ring COOLS ON CAMERA white →
  // orange → deep red → black glass over ~2.5s → then the placer's username ETCHES in
  // gold, letter by letter → and the player is handed a quotable line. Every object
  // lives on the SCENE (not `root`), so the 3s poll's teardown can't kill the arc
  // mid-flight; the `pouring` flag guards against overlap and each object self-cleans.
  private playPourFX(data: State) {
    if (this.pouring) return;
    this.pouring = true;

    const x = this.crownX;
    const yTarget = this.crownY - 8;
    const width = 150;
    const ringH = 12;
    const startY = yTarget - 90;

    // additive bloom that rides the ring down, then fades as it cools
    const glow = this.add
      .image(x, startY, 'glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(width * 1.7, 90)
      .setDepth(20)
      .setAlpha(0.95);

    // the ring itself: a rounded glass slab, redrawn as its fill cools
    const ring = this.add.graphics({ x, y: startY }).setDepth(21);
    const drawRing = (color: number) => {
      ring.clear();
      ring.fillStyle(color, 1);
      ring.fillRoundedRect(-width / 2, -ringH / 2, width, ringH, 4);
    };
    drawRing(0xffffff);

    // drop: 120ms of anticipation hang, then Quart.easeIn onto the crown
    this.tweens.add({
      targets: [ring, glow],
      y: yTarget,
      ease: 'Quart.easeIn',
      delay: 120,
      duration: 200,
      onComplete: () => this.pourImpact(data, x, yTarget, ring, glow, drawRing),
    });
  }

  // Impact + payoff halves of Beat A, split out for readability.
  private pourImpact(
    data: State,
    x: number,
    yTarget: number,
    ring: Phaser.GameObjects.Graphics,
    glow: Phaser.GameObjects.Image,
    drawRing: (color: number) => void
  ) {
    // 40ms hit-stop: freeze every in-flight tween, a beat of frozen impact, then the
    // reaction fires. Uses a real timer so the freeze is wall-clock exact.
    this.tweens.pauseAll();
    window.setTimeout(() => {
      this.tweens.resumeAll();

      this.cameras.main.shake(150, 0.004);

      // receiving stack squashes, then restores with Back.easeOut over 180ms
      this.root.setScale(1.04, 0.94);
      this.tweens.add({
        targets: this.root,
        scaleX: 1,
        scaleY: 1,
        duration: 180,
        ease: 'Back.easeOut',
        onComplete: () => this.root.setScale(1),
      });

      // 15–20 ember particles with gravity
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

      // the reward: cool ON CAMERA over ~2.5s. White → orange → deep red → black
      // glass. Slow and watchable — this is the payoff, so it is not rushed.
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

  // The username etches into the ring in gold, letter by letter (~400ms). This is
  // "my one tap mattered," rendered literally. Then the quotable line is handed over.
  private etchName(
    data: State,
    x: number,
    yTarget: number,
    ring: Phaser.GameObjects.Graphics
  ) {
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
        // the etched ring + name hold as "permanent," then fade so a later poll's
        // re-rendered crown takes over cleanly.
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

  // DESIGN.md §6 — after placing, hand the player words they can screenshot and quote:
  // "Link 4 of 6. You placed at 09:12 — third keeper today."
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

    const t = this.add
      .text(width / 2, height * 0.5, line, {
        fontFamily: FONT_MONO,
        fontSize: 15,
        color: INK,
        align: 'center',
        wordWrap: { width: Math.min(560, width * 0.86) },
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(24);
    this.tweens.add({
      targets: t,
      alpha: 1,
      duration: 500,
      hold: 4200,
      yoyo: true,
      onComplete: () => t.destroy(),
    });
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
    if (!this.timerText) return;
    let txt = Game.fmt(this.remainingMs());
    // Danger is cold, not red: the colon blinks like a failing instrument panel.
    if (this.inDanger && Math.floor(this.time.now / 500) % 2 === 0) {
      txt = txt.replace(/:/g, ' ');
    }
    this.timerText.setText(txt);
  }

  // A single text helper. `display` swaps to Fraunces Black for the numeral/headlines;
  // otherwise IBM Plex Mono, the vigil's instrument panel.
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

  private render() {
    if (!this.state) return;
    const { width, height } = this.scale;
    this.cameras.resize(width, height);
    this.root.removeAll(true);
    this.timerText = null;

    const cx = width / 2;
    const s = this.state;
    const held = s.count >= s.goal;
    const danger = !held && this.remainingMs() < s.dayMs * 0.4;
    this.inDanger = danger;

    // On the FIRST paint of an already-standing chain, replay its whole history in
    // ~1s: the rings rise from the base and the day numeral ticks up in step, so a
    // judge is handed the stakes before reading a word. Subsequent polls render
    // instantly (guarded by hasPlayedRecap).
    const doRecap = !this.hasPlayedRecap && s.streak > 1;

    // --- header: chain # (mono) + day numeral (Fraunces Black) ---
    this.label(cx, height * 0.08, `CHAIN #${s.chainNo}`, 18, hex(GOLD), { tracking: 3 });
    const dayLabel = this.label(cx, height * 0.16, `DAY ${s.streak}`, 66, INK, {
      display: true,
      tracking: -1,
    });

    // --- the monument: cooled black glass, one ring per surviving day ---
    const maxShown = 16;
    const shown = Math.min(s.streak, maxShown);
    const baseY = height * 0.62;
    const ringH = 12;
    const gap = 3;
    const stagger = 60;
    for (let i = 0; i < shown; i++) {
      const w = Math.max(30, 150 - i * 6);
      const finalY = baseY - i * (ringH + gap);
      const isCrown = i === shown - 1;
      const g = this.drawGlassRing(cx, finalY, w, ringH, danger, isCrown);
      this.root.add(g);
      if (doRecap) {
        g.setAlpha(0).setY(finalY + 10);
        this.tweens.add({
          targets: g,
          alpha: 1,
          y: finalY,
          delay: i * stagger,
          duration: 220,
          ease: 'Quad.easeOut',
        });
      }
    }
    if (doRecap) {
      // tick DAY 0 -> streak in lockstep with the rings assembling
      const ticker = { v: 0 };
      this.tweens.add({
        targets: ticker,
        v: s.streak,
        delay: 0,
        duration: Math.max(300, shown * stagger),
        ease: 'Quad.easeOut',
        onUpdate: () => dayLabel.setText(`DAY ${Math.round(ticker.v)}`),
        onComplete: () => dayLabel.setText(`DAY ${s.streak}`),
      });
    }
    // remember the crown (top of the stack) so the pour FX lands in the right place
    this.crownX = cx;
    this.crownY = baseY - shown * (ringH + gap);

    // position the ambient light + heat shimmer over the crown
    this.positionAmbient(cx, this.crownY, danger);

    if (s.streak > maxShown) {
      this.label(cx, this.crownY - 6, `+${s.streak - maxShown}`, 14, hex(AMBER), { tracking: 1 });
    }
    if (s.streak === 0) {
      // fresh chain rising from rubble
      this.label(cx, baseY, 'THE GROUND IS BARE — POUR THE FIRST LINK', 13, hex(ASH), {
        tracking: 2,
      });
    }

    // --- today's keepers: usernames etched in gold (social proof for a lone judge) ---
    this.drawKeepers(width, height, s);

    // --- today's progress: count / goal (mono) ---
    const progColor = held ? hex(AMBER) : danger ? hex(ASH) : INK;
    this.label(cx, height * 0.7, `${s.count} / ${s.goal} LINKS TODAY`, 30, progColor, {
      weight: '700',
      tracking: 2,
    });

    // --- countdown (mono) ---
    this.timerText = this.label(cx, height * 0.77, Game.fmt(this.remainingMs()), 26, hex(AMBER), {
      weight: '700',
      tracking: 1,
    });

    // --- status line (mono) ---
    const status = held
      ? 'THE CHAIN HOLDS'
      : danger
        ? `THE EMBER IS GUTTERING — ${s.goal - s.count} SHORT`
        : 'THE CHAIN NEEDS YOU';
    this.label(cx, height * 0.83, status, 15, danger ? hex(ASH) : hex(GOLD), { tracking: 3 });

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
    if (this.state?.dev) {
      this.smallButton(width * 0.5 - 90, height * 0.965, 'DEV: rollover', () =>
        void this.dev('/api/dev/rollover')
      );
      this.smallButton(width * 0.5 + 90, height * 0.965, 'DEV: reset', () =>
        void this.dev('/api/dev/reset')
      );
    }

    // the recap is a one-time entrance; every later paint renders instantly
    this.hasPlayedRecap = true;

    // First run: land the hook in one sentence (Fraunces), floating over the monument,
    // then fade. Lives on the scene (not root) so the 3s poll teardown can't kill it.
    if (!this.hasShownHook) {
      this.hasShownHook = true;
      this.showHookLine(width, height);
    }
  }

  // A single cooled-glass ring: a rounded basalt slab with a vertical rim-light
  // gradient (lit from the monument's own glow above) and an ember seam glowing at
  // the joint. In danger the seam cools to ash. Returned as one Graphics so the recap
  // can rise + fade it as a unit. Drawn in local space; positioned at (cx, y).
  private drawGlassRing(
    cx: number,
    y: number,
    w: number,
    h: number,
    danger: boolean,
    isCrown: boolean
  ): Phaser.GameObjects.Graphics {
    const g = this.add.graphics({ x: cx, y });
    const left = -w / 2;
    const top = -h / 2;

    // body: rim-light warm at the top, deep basalt at the bottom (single top light)
    const rim = danger ? 0x2b3038 : 0x33303c;
    const base = danger ? 0x0f1216 : 0x121017;
    g.fillGradientStyle(rim, rim, base, base, 1);
    g.fillRoundedRect(left, top, w, h, 4);

    // thin top rim highlight
    g.fillStyle(danger ? ASH : 0x4a4550, 0.5);
    g.fillRoundedRect(left + 2, top + 1, w - 4, 1.5, 1);

    // ember seam at the joint (bottom edge), with a soft bloom above/below. The crown
    // seam burns a touch hotter — the freshest ring. Danger cools every seam to ash.
    const seam = danger ? ASH : isCrown ? AMBER : EMBER;
    const seamA = danger ? 0.35 : 1;
    // bloom
    g.fillStyle(seam, 0.16 * seamA);
    g.fillRect(left + 2, top + h - 5, w - 4, 8);
    g.fillStyle(seam, 0.32 * seamA);
    g.fillRect(left + 3, top + h - 3, w - 6, 4);
    // hot line
    g.fillStyle(seam, 0.95 * seamA);
    g.fillRect(left + 4, top + h - 2, w - 8, 1.6);

    return g;
  }

  // Reposition the persistent ambient light + heat shimmer over the crown each render.
  private positionAmbient(cx: number, crownY: number, danger: boolean) {
    if (this.ambientGlow) {
      this.ambientGlow.setPosition(cx, crownY + 10).setDisplaySize(360, 360);
      this.ambientGlow.setAlpha(danger ? 0.18 : 0.5);
    }
    // Faint heat-shimmer: a few slow blurred highlights rising off the crown. Created
    // lazily, then repositioned; it dies back in danger (the fire is guttering).
    if (!this.shimmer) {
      this.shimmer = this.add.particles(cx, crownY, 'spark', {
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
      this.shimmer.setDepth(1);
    }
    this.shimmer.setPosition(cx, crownY);
    this.shimmer.frequency = danger ? 900 : 220;
  }

  private showHookLine(width: number, height: number) {
    const line = this.add
      .text(
        width / 2,
        height * 0.44,
        'One link a day, together,\nor the chain breaks for everyone.',
        {
          fontFamily: FONT_DISPLAY,
          fontStyle: '900',
          fontSize: 24,
          color: INK,
          align: 'center',
          lineSpacing: 8,
          letterSpacing: -0.5,
        }
      )
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(30);
    this.tweens.add({
      targets: line,
      alpha: 1,
      duration: 600,
      hold: 2600,
      yoyo: true,
      onComplete: () => line.destroy(),
    });
  }

  // Etched-gold roster of today's keepers — the load-bearing mitigation for the game's
  // biggest risk (a lone judge cannot see the crowd). Strangers' names, then the
  // judge's own highlighted, make the community visible in a one-person session. Gold,
  // small-caps (uppercased), IBM Plex Mono. Redrawn each poll.
  private drawKeepers(width: number, height: number, s: State) {
    const keepers = s.keepers ?? [];
    if (keepers.length === 0) return;

    const trunc = (name: string) => (name.length > 12 ? name.slice(0, 11) + '…' : name);
    const rightX = width - 14;
    const maxRows = 8;
    const rowH = 20;
    const startY = height * 0.3;

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
        .text(rightX, startY + i * rowH, `${trunc(name).toUpperCase()}${isYou ? ' ·YOU' : ''}`, {
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
    const h = 56;
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
