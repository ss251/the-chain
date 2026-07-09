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
// "Lantern Festival" pass. The world is a warm Obon night: a giant low moon behind
// two soft ridges, a dark hill, string-light garlands, and a rope of paper chochin
// lanterns strung from off-screen up to a wooden pole — one lantern per surviving
// day, today's the biggest and brightest, the newest keeper's name painted on its
// paper. Cloaked keepers stand on the hill with hand-lanterns. Past chains never
// despawn — they persist as dark fallen-lantern husks veined with gold at the base.
//
// Beats: A (the lighting — a spark rises to today's lantern, its flame BLOOMS, the
// keeper's name paints on), B (danger is COLD — bulbs go out, paper turns to bone,
// the world grades cold, today's lantern flickers), and D (the rope snaps — it frays
// at the sag, the lanterns fall with hand-rolled physics and gutter out, an epitaph,
// then the new chain lights). All are seek-safe against the 3s poll.

const INK = '#ede6da';

// ── The Lantern Festival palette (mirrors mk-art/target.html) ──────────────────
// Warm values first, cold (danger) values second; `chill` (0..1) lerps between them.
const SKY = [0x141a38, 0x2a2456, 0x4a3168, 0x7a4a63];
const SKY_COLD = [0x0e1220, 0x19202e, 0x283042, 0x303a4c];
const RIDGE_FAR = 0x2d2560;
const RIDGE_FAR_COLD = 0x1a1f30;
const RIDGE_NEAR = 0x221c4c;
const RIDGE_NEAR_COLD = 0x141827;
const HILL = 0x161030;
const HILL_COLD = 0x0d0f18;
const GRASS = 0x1d1740;
const GRASS_COLD = 0x12141f;
const MOON = 0xf9f0d8;
const MOON_COLD = 0xc8ccd4;
const MARIA = 0x8a7f6e;
const TREE = 0x0e0a20;
const TREE_COLD = 0x0b0d14;
const BULB_HALO = 0xffcf7a;
const BULB_WARM = 0xffc86e;
const BULB_HOT = 0xffe9b0;
const BULB_DEAD = 0x464a60;
const PAPER_TOP = 0xffe6ae;
const PAPER_BOT = 0xf29245;
const PAPER_BONE_TOP = 0xaeb6c6;
const PAPER_BONE_BOT = 0x7d8798;
const PAPER_DARK_TOP = 0x4c445c;
const PAPER_DARK_BOT = 0x342d44;
const LANTERN_CAP = 0x1a1226;
const RIB = 0xa34d12;
const TASSEL = 0xd4af37;
const BEAD = 0xc73e2e;
const INK_NAME = 0x5c2508;
const INK_NAME_YOU = 0x8a1a05;
const CLOAK = 0x100b1e;
const FACE = 0xffd98c;
const RIM = 0xffb060;
const HAND_LANTERN = 0xffcf7a;
const HAND_LANTERN_COLD = 0x8d97a8;
const SPARK = 0xffd682;
const EYEBROW = 0xecd188;
const EYEBROW_COLD = 0x8593a4;
const NUMERAL = 0xf8f1de;
const HANKO = 0xc73e2e;
const STATE_WARM = 0xf4ecde;
const STATE_COLD = 0xaebccf;
const PIP_LIT_TOP = 0xffe2a0;
const PIP_LIT_BOT = 0xf09040;
const PIP_DARK_TOP = 0x3c3550;
const PIP_DARK_BOT = 0x2a2440;
const PILL_DIGIT = 0xffc978;
const PILL_DIGIT_COLD = 0xc6d2e2;
const PILL_STROKE = 0xe8c66a;
const BTN_FACE_TOP = 0xffab42;
const BTN_FACE_BOT = 0xf4720c;
const BTN_LIP = 0xa63e02;
const BTN_LABEL = 0x4a1d02;
const BTN_DISABLED = 0x4a3a5e;
const GOLD = 0xc9a227;
const ASH = 0x55606e;

// Deterministic pseudo-random by index — the world must not flicker across the
// 3s poll re-renders, so every star/ridge/firefly position derives from this.
const rnd = (i: number) => (((i * 2654435761) >>> 9) & 0xffff) / 0xffff;

// Baloo 2 (ExtraBold) is the storybook DISPLAY face — the Day numeral, countdown
// digits, and the button label. Nunito carries EVERY label. Both self-hosted; the
// game boots only after document.fonts.ready, so text never flashes a fallback.
const FONT_DISPLAY = '"Baloo 2", system-ui, sans-serif';
const FONT_LABEL = '"Nunito", system-ui, sans-serif';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

type State = ChainStateDTO & { username: string | null; youContributed: boolean };

// A physics fragment during Beat D's detonation — hand-rolled gravity + floor bounce.
// Reused for falling lanterns (each is a small darkened chochin graphic).
type Shard = {
  obj: Phaser.GameObjects.Graphics;
  vx: number;
  vy: number;
  vr: number;
  bounces: number;
  resting: boolean;
  guttered: boolean;
};

// A single hanging lantern's geometry — the record the pour/shatter code reads.
type Lantern = {
  cx: number;
  topY: number; // where the cap sits; body extends down `h`
  w: number;
  h: number;
  warm: number; // 0 (dark) .. 1 (fully lit)
  blaze: number; // today's fill toward goal — drives glow radius + flame core
  name: string | null;
  isYou: boolean;
  isToday: boolean;
};

type Metrics = {
  w: number;
  h: number;
  S: number;
  X: (v: number) => number;
  Y: (v: number) => number;
  horizonY: number;
  hillTop: number;
  groundY: number;
  // bottom-docked UI cluster anchors (fixed rhythm from the bottom edge up)
  btnY: number;
  pillY: number;
  pipY: number;
  stateY: number;
};

type Pt = { x: number; y: number };
type ChainGeom = { rope: { s: Pt; m: Pt; e: Pt }; streak: Lantern[]; today: Lantern; over: number };

export class Game extends Scene {
  private state: State | null = null;
  private root!: Phaser.GameObjects.Container;
  // the festival background (garlands + their glows): scene-level so the 3s poll's
  // root teardown never kills it, but explicitly rebuilt each render (danger unlights).
  private bg!: Phaser.GameObjects.Container;
  private timerText: Phaser.GameObjects.Text | null = null;
  private busy = false;
  // Beat A is a multi-second sequence living outside `root`; this flag keeps a poll
  // mid-lighting from starting a second sequence or being mistaken for idle.
  private pouring = false;
  // Beat D defer-swap: when a poll reveals the chain broke, we DON'T swap state; we
  // keep rendering the OLD chain, snap it, then swap. Polls are held meanwhile.
  private shattering = false;
  // countdown baseline: server deadline vs (serverNow + local elapsed)
  private serverNow = 0;
  private serverDeadline = 0;
  private fetchedAt = 0;
  // today's lantern flame core (where a poured link's spark lands)
  private crownX = 0;
  private crownY = 0;
  // the opening recap (lanterns light one-by-one) plays once, on first paint
  private hasPlayedRecap = false;
  // danger = the day is running out and the chain is still short; drives the cold
  // colon-blink + the live pill. `chill` (0..1) is the continuous cold ramp (Beat B).
  private inDanger = false;
  private chill = 0;
  private hasShownHook = false;
  private crownLineShort = 0;
  // Persistent ambient FX live on the scene (not `root`) so the poll teardown never
  // kills them; created once, repositioned each render.
  private world: Phaser.GameObjects.Graphics | null = null; // sky + stars
  private worldFg: Phaser.GameObjects.Graphics | null = null; // moon + ridges + hill + trees
  private moonHalo: Phaser.GameObjects.Image | null = null;
  private groundPool: Phaser.GameObjects.Image | null = null; // today lantern's aura (flickers in danger)
  private groundBaseAlpha = 0.4;
  private fireflies: Phaser.GameObjects.Particles.ParticleEmitter | null = null; // gold dust
  private embers: Phaser.GameObjects.Particles.ParticleEmitter | null = null; // rising warm sparks
  private ashMotes: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  // the state line is scene-level (high depth) so geometry/particles never strike it,
  // and so the tick can refresh the danger banner between polls.
  private stateLine: Phaser.GameObjects.Text | null = null;
  // measured bounds of the KEEPERS TODAY block — garland bulbs dodge this rect
  private rosterRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  // pip containers (one per goal slot) so Beat A can pop the just-lit one.
  private pips: Phaser.GameObjects.Container[] = [];
  // the live rope endpoints (set each render) so Beat D can fray the exact curve.
  private ropeS = { x: 0, y: 0 };
  private ropeM = { x: 0, y: 0 };
  private ropeE = { x: 0, y: 0 };
  // Beat D shards + their hand-rolled slow-mo.
  private shards: Shard[] = [];
  private shardSlowmo = 1;
  private shardFloorY = 0;

  constructor() {
    super('Game');
  }

  create() {
    this.cameras.main.setBackgroundColor(0x060608);
    this.bakeTextures();

    // deepest: sky + stars, then the moon halo bloom, then the moon disk/ridges/hill.
    this.world = this.add.graphics().setDepth(-20);
    this.moonHalo = this.add
      .image(0, 0, 'glowpale')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(MOON)
      .setAlpha(0.14)
      .setDepth(-19);
    this.worldFg = this.add.graphics().setDepth(-18);

    // the festival garlands + bulb glows (rebuilt each render)
    this.bg = this.add.container(0, 0).setDepth(-14);

    this.root = this.add.container(0, 0);

    // gold dust drifting through the festival air — warm, sparse, alive; dies in danger
    this.fireflies = this.add.particles(0, 0, 'spark', {
      speedY: { min: -6, max: 6 },
      speedX: { min: -8, max: 8 },
      lifespan: { min: 3000, max: 6000 },
      frequency: 380,
      quantity: 1,
      scale: { min: 0.18, max: 0.5 },
      alpha: { start: 0, end: 0.5, ease: 'Sine.easeInOut', yoyo: true } as never,
      tint: [SPARK, BULB_WARM],
      blendMode: Phaser.BlendModes.ADD,
    });
    this.fireflies.setDepth(-9);

    // today's lantern casts a warm aura on the hill; its alpha breathes, and gutters
    // irregularly in danger (Beat B — the ember is guttering). Driven in tickCountdown.
    this.groundPool = this.add
      .image(0, 0, 'glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-6)
      .setAlpha(0.4);

    // faint warm sparks rising off today's lantern; die back in danger
    this.embers = this.add.particles(0, 0, 'spark', {
      speedY: { min: -26, max: -12 },
      speedX: { min: -8, max: 8 },
      lifespan: { min: 900, max: 1600 },
      frequency: 260,
      quantity: 1,
      scale: { start: 0.4, end: 0.9 },
      alpha: { start: 0.2, end: 0 },
      tint: [BULB_HALO, SPARK],
      blendMode: Phaser.BlendModes.ADD,
    });
    this.embers.setDepth(4);

    // ambient drift (cool motes thicken in danger)
    this.ashMotes = this.add.particles(0, 0, 'spark', {
      x: { min: -40, max: 2200 },
      y: { min: 0, max: 1400 },
      speedY: { min: -14, max: -4 },
      speedX: { min: -4, max: 4 },
      lifespan: { min: 9000, max: 15000 },
      frequency: 900,
      quantity: 1,
      scale: { min: 0.06, max: 0.16 },
      alpha: { start: 0.1, end: 0 },
      tint: [ASH, BULB_WARM],
      blendMode: Phaser.BlendModes.NORMAL,
    });
    this.ashMotes.setDepth(-8);

    void this.refresh();

    this.time.addEvent({ delay: 3000, loop: true, callback: () => void this.refresh() });
    this.time.addEvent({ delay: 250, loop: true, callback: () => this.tickCountdown() });

    this.scale.on('resize', () => this.render());
  }

  // Bake the runtime textures — no art assets exist. `spark` is a soft dot for the
  // particle emitters; `glow` is a warm radial for aura/light; `glowpale` is a WHITE
  // radial we tint per-use (moon halo, flame cores, bulb halos, pips, button glow).
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
        grad.addColorStop(0, 'rgba(255,178,68,0.95)');
        grad.addColorStop(0.4, 'rgba(255,140,40,0.4)');
        grad.addColorStop(1, 'rgba(255,140,40,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        tex.refresh();
      }
    }
    if (!this.textures.exists('glowpale')) {
      const size = 256;
      const tex = this.textures.createCanvas('glowpale', size, size);
      if (tex) {
        const ctx = tex.getContext();
        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
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
    // bare chain now — keep the OLD chain on screen, play the snap, only then swap.
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
      // Only the FIRST link of the day earns the lighting — a repeat tap is a no-op.
      if (data.added) this.playLighting(data);
    }
    this.busy = false;
  }

  // ── Beat A: the lighting ──────────────────────────────────────────────────────
  // tap → a warm spark rises from the button up to today's lantern (~500ms, eased) →
  // a soft hit (gentle shake) → the lantern's flame core BLOOMS white→warm over ~1.8s
  // → the keeper's name paints onto the paper letter-by-letter → the quotable card.
  // The corresponding pip also pops (scale 1.3→1). render() has already drawn the lit
  // lantern underneath, so the bloom overlays it and settles into permanence.
  private playLighting(data: State) {
    if (this.pouring || this.shattering) return;
    this.pouring = true;
    const M = this.metrics();

    const tx = this.crownX;
    const ty = this.crownY;
    const startX = M.w / 2;
    const startY = M.h * 0.9;

    const spark = this.add
      .image(startX, startY, 'glowpale')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(SPARK)
      .setDisplaySize(20 * M.S, 20 * M.S)
      .setDepth(40)
      .setAlpha(0.95);

    this.tweens.add({
      targets: spark,
      x: tx,
      y: ty,
      ease: 'Sine.easeInOut',
      duration: 500,
      onComplete: () => {
        spark.destroy();
        this.cameras.main.shake(100, 0.002);
        this.bloomLantern(data, M, tx, ty);
      },
    });
  }

  private bloomLantern(data: State, M: Metrics, tx: number, ty: number) {
    // the flame core blooms white -> warm over ~1.8s (alpha + radius grow)
    const core = this.add
      .image(tx, ty, 'glowpale')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xffffff)
      .setDisplaySize(6 * M.S, 6 * M.S)
      .setDepth(41)
      .setAlpha(0);
    const b = { t: 0 };
    this.tweens.add({
      targets: b,
      t: 1,
      duration: 1800,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        const r = (6 + 42 * b.t) * M.S;
        core.setDisplaySize(r, r);
        core.setTint(Phaser.Display.Color.GetColor(255, Math.round(255 - 60 * b.t), Math.round(255 - 150 * b.t)));
        core.setAlpha(0.9 * (b.t < 0.7 ? b.t / 0.7 : 1 - (b.t - 0.7) / 0.6));
      },
      onComplete: () => core.destroy(),
    });

    // pop the pip that this link just lit
    const lit = Math.min(this.pips.length, data.count) - 1;
    if (lit >= 0 && this.pips[lit]) {
      const pip = this.pips[lit]!;
      pip.setScale(1.3);
      this.tweens.add({ targets: pip, scaleX: 1, scaleY: 1, duration: 320, ease: 'Back.easeOut' });
    }

    // paint the keeper's name onto the paper, letter by letter (~400ms)
    const name = (data.username ?? 'a keeper').toUpperCase();
    const shown = name.length > 10 ? name.slice(0, 9) + '…' : name;
    const isYou = data.username != null && data.keepers?.[data.keepers.length - 1] === data.username;
    const label = this.add
      .text(tx, ty - 2 * M.S, '', {
        fontFamily: FONT_LABEL,
        fontSize: 9 * M.S,
        fontStyle: '900',
        color: hex(isYou ? INK_NAME_YOU : INK_NAME),
        letterSpacing: 0.5,
      })
      .setOrigin(0.5)
      .setDepth(42);
    this.time.delayedCall(700, () => {
      const idx = { i: 0 };
      this.tweens.add({
        targets: idx,
        i: shown.length,
        duration: 400,
        ease: 'Linear',
        onUpdate: () => label.setText(shown.slice(0, Math.round(idx.i))),
        onComplete: () => {
          label.setText(shown);
          this.handQuote(data);
          this.time.delayedCall(2600, () => {
            this.tweens.add({
              targets: label,
              alpha: 0,
              duration: 600,
              onComplete: () => {
                label.destroy();
                this.pouring = false;
              },
            });
          });
        },
      });
    });
  }

  // After lighting, hand the player words they can screenshot and quote.
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
    const line = `Link ${data.count} of ${data.goal}. You lit it at ${clock} — ${Game.ordinal(
      pos
    )} keeper tonight.`;
    this.cardText(width / 2, height * 0.44, line, 15, INK, 4200);
  }

  private static ordinal(n: number): string {
    const words = [
      'zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
      'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
    ];
    if (n >= 1 && n < words.length) return words[n]!;
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
  }

  private static numberWord(n: number): string {
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    return n >= 0 && n < words.length ? words[n]! : String(n);
  }

  // Chains are numbered like dynasties: Chain I, Chain II, ...
  private static roman(n: number): string {
    if (n <= 0) return String(n);
    const map: [number, string][] = [
      [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
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
    // today's lantern aura breathes; in danger the ember gutters irregularly, the
    // flicker quickening as the day dies (Beat B) — the lantern's paper flickers.
    if (this.groundPool) {
      if (this.inDanger) {
        if (Math.random() < 0.35 + 0.55 * this.chill) {
          const a = this.groundBaseAlpha * (0.25 + Math.random() * 0.6) * (1 - 0.6 * this.chill);
          this.groundPool.setAlpha(Math.max(0.03, a));
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

  private fit(t: Phaser.GameObjects.Text, maxW: number): Phaser.GameObjects.Text {
    if (t.width > maxW) t.setScale(maxW / t.width);
    return t;
  }

  private truncName(name: string): string {
    return name.length > 11 ? name.slice(0, 10) + '…' : name;
  }

  // A single label on a dark card at high depth — never struck by geometry. Fades in.
  private cardText(x: number, y: number, text: string, size: number, color: string, hold: number) {
    const t = this.add
      .text(x, y, text, {
        fontFamily: FONT_LABEL,
        fontStyle: '700',
        fontSize: size,
        color,
        align: 'center',
        wordWrap: { width: Math.min(320, this.scale.width * 0.84) },
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setDepth(51)
      .setAlpha(0);
    const pad = 16;
    const card = this.add
      .rectangle(x, y, t.width + pad * 2, t.height + pad, 0x0d0d13, 0.85)
      .setStrokeStyle(1, 0x2a2440)
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

  // ── metrics: translate the mock's 375x640 coordinates into the live viewport ────
  private metrics(): Metrics {
    const { width: w, height: h } = this.scale;
    const S = w / 375;
    const X = (v: number) => (v / 375) * w;
    const Y = (v: number) => (v / 640) * h;
    // The UI cluster docks to the BOTTOM edge with a fixed rhythm, and the hill
    // anchors to the cluster top — so the scene and the controls always meet,
    // whatever height the devvit modal leaves us (its header steals space).
    const btnY = h - (42 + 16) * S; // button top (lip adds +4S below)
    const pillY = btnY - 26 * S; // countdown pill center
    const pipY = pillY - 36 * S; // lantern pips center
    const stateY = pipY - 32 * S; // state line center
    const hillTop = stateY - 52 * S; // the crest the state line sits under
    const groundY = hillTop + 16 * S;
    const horizonY = hillTop - 48 * S;
    return { w, h, S, X, Y, horizonY, hillTop, groundY, btnY, pillY, pipY, stateY };
  }

  // ── geometry: the lanterns on the rope (the record pour/shatter read) ───────────
  // Streak lanterns recede up the rope (cap 8), today's lantern hangs biggest at 0.94.
  private lanternGeom(
    streak: number,
    count: number,
    goal: number,
    keepers: string[],
    username: string | null,
    M: Metrics
  ): ChainGeom {
    const poleX = M.w * 0.86;
    const s = { x: M.X(-46), y: M.hillTop - 2 * M.S };
    const m = { x: M.w * 0.36, y: M.hillTop - 66 * M.S };
    const e = { x: poleX, y: M.hillTop - 106 * M.S };
    const rp = (t: number) => {
      const a = 1 - t;
      return {
        x: a * a * s.x + 2 * a * t * m.x + t * t * e.x,
        y: a * a * s.y + 2 * a * t * m.y + t * t * e.y,
      };
    };

    const maxLine = 8;
    const lineCount = Math.min(streak, maxLine);
    const streakL: Lantern[] = [];
    for (let i = 0; i < lineCount; i++) {
      const t = 0.8 - i * 0.094;
      const pt = rp(t);
      const shrink = 1 - i * 0.09;
      streakL.push({
        cx: pt.x,
        topY: pt.y + 6 * shrink * M.S,
        w: 30 * shrink * M.S,
        h: 25 * shrink * M.S,
        warm: Math.max(0.35, 0.85 - i * 0.07),
        blaze: 0.35,
        name: null,
        isYou: false,
        isToday: false,
      });
    }

    const blaze = Math.min(1, count / Math.max(1, goal));
    const tp = rp(0.94);
    const todayName = keepers.length ? keepers[keepers.length - 1]! : null;
    const today: Lantern = {
      cx: tp.x,
      topY: tp.y + 9 * M.S,
      w: 54 * M.S,
      h: 44 * M.S,
      warm: count > 0 ? 1 : 0,
      blaze,
      name: todayName,
      isYou: todayName != null && todayName === username,
      isToday: true,
    };

    return { rope: { s, m, e }, streak: streakL, today, over: Math.max(0, streak - maxLine) };
  }

  private render() {
    if (!this.state) return;
    const M = this.metrics();
    this.cameras.resize(M.w, M.h);
    this.root.removeAll(true);
    this.root.setVisible(true);
    this.timerText = null;
    this.stateLine?.destroy();
    this.stateLine = null;
    this.pips = [];

    const s = this.state;
    const held = s.count >= s.goal;

    // Beat B: continuous cold ramp over the final fraction of the day.
    const rem = this.remainingMs();
    const dangerT = s.dayMs * 0.4;
    const danger = !held && rem < dangerT;
    this.inDanger = danger;
    this.chill = danger ? Phaser.Math.Clamp((dangerT - rem) / dangerT, 0, 1) : 0;
    const chill = this.chill;
    this.crownLineShort = Math.max(0, s.goal - s.count);

    const doRecap = !this.hasPlayedRecap && s.streak > 1;

    // world -> roster (measured first so garland bulbs can dodge its pixels)
    // -> garlands -> chain -> keepers -> UI
    this.drawWorld(M, chill);
    this.drawKeepersToday(M, s, chill);
    this.drawGarlands(M, chill);
    this.drawChain(M, s, chill, doRecap);
    this.drawKeeperFigures(M, s, chill);
    this.drawRubble(M, s.fallen ?? []);

    // header: eyebrow + Day numeral. The numeral counts the day THIS chain is living
    // (first day = Day 1), which equals the number of lanterns on the rope.
    this.drawHeader(M, s, doRecap);
    this.drawHanko(M, chill);
    if (s.streak > 8) this.drawOverHill(M, s, chill);

    // the state line — soft sentence, or the cold guttering banner.
    this.drawStateLine(M, s, danger);
    this.drawPips(M, s, chill);
    this.drawCountdownPill(M, rem, danger);
    this.drawButton(M, s);
    this.positionAmbient(M, chill);

    if (s.dev) {
      // playtest-only controls — parked at the very top (clear night sky) so they
      // never cover the button lozenge, which now hugs the bottom edge like the mock.
      this.smallButton(M.w * 0.26, M.Y(16), 'DEV: rollover', () =>
        void this.dev('/api/dev/rollover')
      );
      this.smallButton(M.w * 0.74, M.Y(16), 'DEV: reset', () =>
        void this.dev('/api/dev/reset')
      );
    }

    this.hasPlayedRecap = true;

    if (!this.hasShownHook) {
      this.hasShownHook = true;
      this.cardText(
        M.w / 2,
        M.h * 0.42,
        'One link a day, together,\nor the chain breaks for everyone.',
        18,
        INK,
        2600
      );
    }
  }

  // ── the world ───────────────────────────────────────────────────────────────
  private drawWorld(M: Metrics, chill: number) {
    const g = this.world;
    const fg = this.worldFg;
    if (!g || !fg) return;
    g.clear();
    fg.clear();

    const c = (warm: number, cold: number) => this.mix(warm, cold, chill);
    const sky = [
      c(SKY[0]!, SKY_COLD[0]!),
      c(SKY[1]!, SKY_COLD[1]!),
      c(SKY[2]!, SKY_COLD[2]!),
      c(SKY[3]!, SKY_COLD[3]!),
    ];
    // dusk sky in graded bands: indigo night -> plum -> a last remnant of rose
    const skyH = M.horizonY + M.Y(50);
    const b1 = skyH * 0.45;
    const b2 = skyH * 0.78;
    g.fillGradientStyle(sky[0]!, sky[0]!, sky[1]!, sky[1]!, 1);
    g.fillRect(0, 0, M.w, b1);
    g.fillGradientStyle(sky[1]!, sky[1]!, sky[2]!, sky[2]!, 1);
    g.fillRect(0, b1, M.w, b2 - b1);
    g.fillGradientStyle(sky[2]!, sky[2]!, sky[3]!, sky[3]!, 1);
    g.fillRect(0, b2, M.w, skyH - b2);

    // 70 deterministic stars incl. 4-point sparkles; none near the ridge line
    for (let i = 0; i < 70; i++) {
      const sx = (i * 61) % M.w;
      const sy = ((i * 137) % Math.max(60, M.horizonY - M.Y(140))) + M.Y(14);
      g.fillStyle(i % 9 === 0 ? 0xffe9c9 : 0xcdd6f4, (0.2 + rnd(i) * 0.55) * (1 - chill * 0.2));
      if (i % 12 === 0) {
        g.fillRect(sx - 1.8 * M.S, sy - 0.4 * M.S, 3.6 * M.S, 0.8 * M.S);
        g.fillRect(sx - 0.4 * M.S, sy - 1.8 * M.S, 0.8 * M.S, 3.6 * M.S);
      } else {
        const d = (i % 11 === 0 ? 1.5 : 0.9) * M.S;
        g.fillRect(sx, sy, d, d);
      }
    }

    // ── the moon, giant and low, BEHIND the ridges ──
    const moonR = 104 * M.S;
    const moonX = M.w * 0.42;
    const moonY = Math.max(150 * M.S, M.horizonY - 140 * M.S);
    this.moonHalo
      ?.setPosition(moonX, moonY)
      .setDisplaySize(moonR * 3.2, moonR * 3.2)
      .setTint(this.mix(MOON, MOON_COLD, chill * 0.8))
      .setAlpha(0.14 * (1 - chill * 0.3));
    fg.fillStyle(this.mix(MOON, MOON_COLD, chill * 0.8), 0.96);
    fg.fillCircle(moonX, moonY, moonR);
    fg.fillStyle(MARIA, 0.05);
    for (const [dx, dy, r] of [[-34, -26, 24], [20, -46, 16], [36, 8, 27], [-12, 30, 18]] as const) {
      fg.fillCircle(moonX + dx * M.S, moonY + dy * M.S, r * M.S);
    }

    // two smooth quadratic-saddle ridges (drawn after the moon -> they occlude it)
    this.fillRidge(fg, M, M.horizonY - M.Y(54), M.Y(26), 3, this.mix(RIDGE_FAR, RIDGE_FAR_COLD, chill));
    this.fillRidge(fg, M, M.horizonY - M.Y(22), M.Y(20), 11, this.mix(RIDGE_NEAR, RIDGE_NEAR_COLD, chill));

    // the dark hill dome — a rounded crest the vigil stands on
    fg.fillStyle(this.mix(HILL, HILL_COLD, chill), 1);
    const hillPts: { x: number; y: number }[] = [{ x: M.X(-40), y: M.h + 40 }];
    hillPts.push(...this.sampleQuad({ x: M.X(-40), y: M.h }, { x: M.w * 0.18, y: M.hillTop + M.Y(28) }, { x: M.w * 0.5, y: M.hillTop }, 14));
    hillPts.push(...this.sampleQuad({ x: M.w * 0.5, y: M.hillTop }, { x: M.w * 0.82, y: M.hillTop + M.Y(28) }, { x: M.X(415), y: M.h }, 14));
    hillPts.push({ x: M.X(415), y: M.h + 40 });
    fg.fillPoints(hillPts as unknown as Phaser.Math.Vector2[], true);

    // grass tufts along the crest — silhouette texture
    fg.lineStyle(1.2 * M.S, this.mix(GRASS, GRASS_COLD, chill), 1);
    for (let i = 0; i < 46; i++) {
      const t = i / 46;
      const gx = M.X(8) + t * M.X(359);
      const gy = M.hillTop + Math.pow(Math.abs(t - 0.5) * 2, 1.6) * M.Y(26) + M.Y(1.5);
      const lh = (2.5 + rnd(i * 7) * 4) * M.S;
      const tuft = this.sampleQuad(
        { x: gx, y: gy + lh },
        { x: gx + (rnd(i) - 0.5) * 3 * M.S, y: gy + lh / 2 },
        { x: gx + (rnd(i * 3) - 0.5) * 5 * M.S, y: gy },
        4
      );
      fg.beginPath();
      fg.moveTo(tuft[0]!.x, tuft[0]!.y);
      for (let k = 1; k < tuft.length; k++) fg.lineTo(tuft[k]!.x, tuft[k]!.y);
      fg.strokePath();
    }

    // kasumi mist — flat-topped rounded bands drifting over the hills
    const mist = this.mix(0x9a8cc0, 0x7d8aa3, chill);
    fg.fillStyle(mist, 0.1);
    fg.fillRoundedRect(M.X(-30), M.horizonY - M.Y(60), M.w * 0.48, M.Y(12), M.Y(6));
    fg.fillStyle(mist, 0.08);
    fg.fillRoundedRect(M.w * 0.5, M.horizonY - M.Y(30), M.w * 0.6, M.Y(14), M.Y(7));

    // two lush silhouette trees framing left/right edges
    this.drawTree(fg, M, M.X(26), M.hillTop + M.Y(40), 1.15, 5, chill);
    this.drawTree(fg, M, M.X(345), M.hillTop + M.Y(52), 1.3, 9, chill);
  }

  // One ridge: 5 control peaks joined by quadratic saddles, sampled to a filled poly.
  private fillRidge(g: Phaser.GameObjects.Graphics, M: Metrics, baseYr: number, amp: number, seed: number, color: number) {
    const n = 5;
    const raw: { x: number; y: number }[] = [];
    for (let k = 0; k <= n; k++) {
      const px = (M.w / n) * k + (rnd(seed * 3 + k) - 0.5) * 30 * M.S;
      const peak = k % 2 === 1;
      const yv = baseYr + (peak ? -amp * (0.7 + rnd(seed + k) * 0.6) : amp * (0.15 + rnd(seed * 7 + k) * 0.3));
      raw.push({ x: px, y: yv });
    }
    const pts: { x: number; y: number }[] = [
      { x: -20, y: M.h + 40 },
      { x: -20, y: raw[0]!.y },
    ];
    for (let k = 0; k < raw.length - 1; k++) {
      const p0 = raw[k]!;
      const p1 = raw[k + 1]!;
      const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      pts.push(...this.sampleQuad(pts[pts.length - 1]!, p0, mid, 8));
    }
    pts.push({ x: M.w + 20, y: raw[n]!.y });
    pts.push({ x: M.w + 20, y: M.h + 40 });
    g.fillStyle(color, 1);
    g.fillPoints(pts as unknown as Phaser.Math.Vector2[], true);
  }

  // Sample a quadratic Bézier (p0 -> control c -> p1) into `steps` points.
  private sampleQuad(p0: { x: number; y: number }, c: { x: number; y: number }, p1: { x: number; y: number }, steps: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const a = 1 - t;
      out.push({
        x: a * a * p0.x + 2 * a * t * c.x + t * t * p1.x,
        y: a * a * p0.y + 2 * a * t * c.y + t * t * p1.y,
      });
    }
    return out;
  }

  private strokeQuad(g: Phaser.GameObjects.Graphics, p0: { x: number; y: number }, c: { x: number; y: number }, p1: { x: number; y: number }, steps = 10) {
    const pts = [p0, ...this.sampleQuad(p0, c, p1, steps)];
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
    g.strokePath();
  }

  // A lush silhouette tree: trunk + branch strokes + clustered-circle canopies.
  private drawTree(g: Phaser.GameObjects.Graphics, M: Metrics, bx: number, by: number, s: number, seed: number, chill: number) {
    const dark = this.mix(TREE, TREE_COLD, chill);
    const sc = s * M.S;
    g.fillStyle(dark, 1);
    g.lineStyle(6 * sc, dark, 1);
    this.strokeQuad(g, { x: bx, y: by }, { x: bx + 8 * sc, y: by - 40 * sc }, { x: bx + 2 * sc, y: by - 78 * sc }, 8);
    const branches = [[-26, -58, 16], [22, -72, 18], [-6, -92, 20], [30, -96, 13], [-32, -84, 13]] as const;
    for (let bi = 0; bi < branches.length; bi++) {
      const [dx, dy, r] = branches[bi]!;
      g.lineStyle(2.5 * sc, dark, 1);
      this.strokeQuad(
        g,
        { x: bx + 2 * sc, y: by - 60 * sc },
        { x: bx + dx * 0.5 * sc, y: by + (dy + 14) * sc },
        { x: bx + dx * sc, y: by + dy * sc },
        6
      );
      for (let k = 0; k < 5; k++) {
        const cxk = bx + dx * sc + (rnd(seed + bi * 7 + k) - 0.5) * r * 1.6 * sc;
        const cyk = by + dy * sc + (rnd(seed * 3 + bi + k) - 0.5) * r * 1.1 * sc;
        g.fillCircle(cxk, cyk, r * 0.55 * sc * (0.7 + rnd(seed + k) * 0.5));
      }
    }
  }

  // ── the string-light garlands: the festival abundance ───────────────────────
  private drawGarlands(M: Metrics, chill: number) {
    this.bg.removeAll(true);
    const cold = chill > 0.5;
    const stringG = this.add.graphics();
    const coreG = this.add.graphics();
    this.bg.add(stringG);

    const garland = (x0: number, y0: number, x1: number, y1: number, sag: number, nB: number, seed: number, bulbR: number, dim: number) => {
      const mx = (x0 + x1) / 2;
      const my = Math.max(y0, y1) + sag;
      stringG.lineStyle(1 * M.S, cold ? 0x8c96aa : 0xd4af37, cold ? 0.4 : 0.42);
      this.strokeQuad(stringG, { x: x0, y: y0 }, { x: mx, y: my }, { x: x1, y: y1 }, 20);
      for (let i = 1; i < nB; i++) {
        const t = i / nB;
        const a = 1 - t;
        const bx = a * a * x0 + 2 * a * t * mx + t * t * x1;
        const by = a * a * y0 + 2 * a * t * my + t * t * y1 + 2.5 * M.S;
        const lit = cold ? i % 3 === 0 : true; // in danger most bulbs are out
        const br = bulbR * (0.8 + rnd(seed + i) * 0.5);
        // bulbs never blaze over the KEEPERS TODAY words — inside the roster
        // rect they keep a dim core only (the string still passes behind)
        const R = this.rosterRect;
        const shy = !!R && bx > R.x0 && bx < R.x1 && by > R.y0 && by < R.y1;
        if (lit && !shy) {
          const glow = this.add
            .image(bx, by, 'glowpale')
            .setBlendMode(Phaser.BlendModes.ADD)
            .setTint(BULB_HALO)
            .setDisplaySize(br * 9, br * 9)
            .setAlpha(0.5 * dim * (1 - chill * 0.65));
          this.bg.add(glow);
          coreG.fillStyle(i % 4 === 0 ? BULB_HOT : BULB_WARM, (0.85 + rnd(i) * 0.15) * dim);
        } else if (lit) {
          coreG.fillStyle(BULB_WARM, 0.35 * dim);
        } else {
          coreG.fillStyle(BULB_DEAD, 0.8);
        }
        coreG.fillCircle(bx, by, shy ? br * 0.75 : br);
      }
    };

    garland(M.X(-10), M.Y(118), M.X(385), M.Y(96), M.Y(66), 22, 4, 2.2 * M.S, 0.85);
    garland(M.X(30), M.Y(156), M.X(359), M.Y(190), M.Y(48), 17, 8, 2.6 * M.S, 1);
    garland(M.w * 0.32, M.Y(208), M.X(387), M.Y(168), M.Y(40), 13, 15, 2.2 * M.S, 0.7);
    this.bg.add(coreG); // bulb cores over their halos
  }

  // ── the chain: rope + pole + hanging chochin lanterns ───────────────────────
  private drawChain(M: Metrics, s: State, chill: number, doRecap: boolean) {
    const geom = this.lanternGeom(s.streak, s.count, s.goal, s.keepers ?? [], s.username, M);
    this.ropeS = geom.rope.s;
    this.ropeM = geom.rope.m;
    this.ropeE = geom.rope.e;

    const poleX = M.w * 0.86;
    const poleTop = M.hillTop - 112 * M.S;

    // pole: weathered wood + crossbar + warm rim light
    const poleG = this.add.graphics();
    poleG.lineStyle(6 * M.S, 0x130e24, 1);
    poleG.beginPath();
    poleG.moveTo(poleX, poleTop);
    poleG.lineTo(poleX + 7 * M.S, M.groundY + 10 * M.S);
    poleG.strokePath();
    poleG.lineStyle(3 * M.S, 0x130e24, 1);
    poleG.beginPath();
    poleG.moveTo(poleX - 13 * M.S, poleTop + 9 * M.S);
    poleG.lineTo(poleX + 13 * M.S, poleTop + 3 * M.S);
    poleG.strokePath();
    poleG.lineStyle(1.2 * M.S, RIM, 0.4 * (1 - chill * 0.65));
    poleG.beginPath();
    poleG.moveTo(poleX - 1.5 * M.S, poleTop + 3 * M.S);
    poleG.lineTo(poleX + 5 * M.S, M.groundY + 4 * M.S);
    poleG.strokePath();
    this.root.add(poleG);

    // the rope
    const ropeG = this.add.graphics();
    ropeG.lineStyle(1.6 * M.S, chill > 0.5 ? 0x96a0b2 : 0xdeba5a, chill > 0.5 ? 0.6 : 0.65);
    this.strokeQuad(ropeG, geom.rope.s, geom.rope.m, geom.rope.e, 24);
    this.root.add(ropeG);

    const recapGroups: Phaser.GameObjects.GameObject[][] = [];

    // streak lanterns (receding), oldest last
    for (const lan of geom.streak) {
      const objs: Phaser.GameObjects.GameObject[] = [];
      // the short cord above each lantern
      const cord = this.add.graphics();
      cord.lineStyle(1 * M.S, 0x120e1c, 0.75);
      cord.beginPath();
      cord.moveTo(lan.cx, lan.topY - 6 * M.S);
      cord.lineTo(lan.cx, lan.topY);
      cord.strokePath();
      this.root.add(cord);
      objs.push(cord);
      this.chochin(M, lan, chill, objs);
      recapGroups.push(objs);
    }

    // today's lantern — biggest, brightest, named
    const today = geom.today;
    const tObjs: Phaser.GameObjects.GameObject[] = [];
    const tcord = this.add.graphics();
    tcord.lineStyle(1.5 * M.S, 0x120e1c, 0.9);
    tcord.beginPath();
    tcord.moveTo(today.cx, today.topY - 9 * M.S);
    tcord.lineTo(today.cx, today.topY);
    tcord.strokePath();
    this.root.add(tcord);
    tObjs.push(tcord);
    this.chochin(M, today, chill, tObjs);
    recapGroups.push(tObjs);

    // the flame core is where a poured link's spark lands
    const centerY = today.topY + today.h * 0.55;
    this.crownX = today.cx;
    this.crownY = centerY;

    // today's lantern casts the warm aura that breathes / gutters
    if (this.groundPool) {
      this.groundPool
        .setPosition(today.cx, centerY)
        .setDisplaySize(today.w * 3.2, today.w * 3.2)
        .setTint(chill > 0.5 ? 0x9aa6bc : 0xffb244);
      this.groundBaseAlpha = today.warm > 0.05 ? 0.42 * (1 - 0.5 * chill) : 0.05;
    }

    // Opening recap: lanterns light one-by-one along the rope (~70ms stagger).
    if (doRecap) {
      const stagger = 70;
      for (let i = 0; i < recapGroups.length; i++) {
        const grp = recapGroups[i]!;
        for (const o of grp) (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0);
        this.tweens.add({ targets: grp, alpha: 1, delay: i * stagger, duration: 260, ease: 'Quad.easeOut' });
      }
    }
  }

  // A single paper chochin, drawn into `this.root`; created objects pushed to `objs`
  // for the opening recap's stagger.
  private chochin(M: Metrics, lan: Lantern, chill: number, objs: Phaser.GameObjects.GameObject[]) {
    const { cx, topY: y, w, h, warm, blaze, name, isYou } = lan;
    const cold = chill > 0.5;

    // inner glow (additive)
    if (warm > 0.05) {
      const gr = w * (0.95 + 0.55 * blaze);
      const glow = this.add
        .image(cx, y + h * 0.52, 'glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xffb244)
        .setDisplaySize(gr * 2, gr * 2)
        .setAlpha((0.4 + 0.32 * blaze) * warm * (1 - chill * 0.65));
      this.root.add(glow);
      objs.push(glow);
    }

    // barrel paper body (quadratic sides), sampled into a filled polygon
    let paperTop: number;
    let paperBot: number;
    if (warm > 0.05 && !cold) {
      paperTop = this.mix(PAPER_TOP, 0xd9a86a, 1 - warm);
      paperBot = this.mix(PAPER_BOT, 0xa06838, 1 - warm);
    } else if (warm > 0.05) {
      paperTop = this.mix(PAPER_BONE_TOP, PAPER_TOP, 1 - chill);
      paperBot = this.mix(PAPER_BONE_BOT, PAPER_BOT, 1 - chill);
    } else {
      paperTop = PAPER_DARK_TOP;
      paperBot = PAPER_DARK_BOT;
    }
    const x = cx - w / 2;
    const body = this.add.graphics();
    const outline: { x: number; y: number }[] = [{ x: x + w * 0.18, y: y + 2 }];
    outline.push(...this.sampleQuad({ x: x + w * 0.18, y: y + 2 }, { x: x - w * 0.1, y: y + h * 0.5 }, { x: x + w * 0.18, y: y + h - 2 }, 8));
    outline.push({ x: x + w * 0.82, y: y + h - 2 });
    outline.push(...this.sampleQuad({ x: x + w * 0.82, y: y + h - 2 }, { x: x + w * 1.1, y: y + h * 0.5 }, { x: x + w * 0.82, y: y + 2 }, 8));
    // solid paper (the inner glow supplies the vertical luminance ramp)
    body.fillStyle(this.mix(paperTop, paperBot, 0.5), 1);
    body.fillPoints(outline as unknown as Phaser.Math.Vector2[], true);
    // top-lit band to suggest the paper gradient
    body.fillStyle(paperTop, 0.45);
    body.fillPoints(
      [
        { x: x + w * 0.18, y: y + 2 },
        ...this.sampleQuad({ x: x + w * 0.18, y: y + 2 }, { x: x - w * 0.02, y: y + h * 0.28 }, { x: x + w * 0.2, y: y + h * 0.5 }, 6),
        { x: x + w * 0.8, y: y + h * 0.5 },
        ...this.sampleQuad({ x: x + w * 0.8, y: y + h * 0.5 }, { x: x + w * 1.02, y: y + h * 0.28 }, { x: x + w * 0.82, y: y + 2 }, 6),
      ] as unknown as Phaser.Math.Vector2[],
      true
    );

    // 3 bamboo rib curves
    if (w > 20 * M.S) {
      body.lineStyle(0.8 * M.S, warm > 0.05 ? RIB : 0x14101e, warm > 0.05 ? 0.4 : 0.5);
      for (let rIdx = 1; rIdx <= 3; rIdx++) {
        const ry = y + (h * rIdx) / 4;
        const bulge = Math.sin((Math.PI * rIdx) / 4) * w * 0.1;
        this.strokeQuad(body, { x: x + w * 0.14 - bulge, y: ry }, { x: cx, y: ry + 2.5 * M.S }, { x: x + w * 0.86 + bulge, y: ry }, 6);
      }
    }

    // visible flame core (bright center) when blazing
    if (warm > 0.05 && blaze > 0) {
      const fr = w * 0.22;
      const core = this.add
        .image(cx, y + h * 0.55, 'glowpale')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xfff6d6)
        .setDisplaySize(fr * 2.4, fr * 2.4)
        .setAlpha(0.9 * blaze * (1 - chill * 0.65));
      this.root.add(core);
      objs.push(core);
    }

    // dark cap + base
    body.fillStyle(LANTERN_CAP, 1);
    body.fillRoundedRect(x + w * 0.24, y - 3 * M.S, w * 0.52, 5 * M.S, 2.5 * M.S);
    body.fillRoundedRect(x + w * 0.28, y + h - 2.5 * M.S, w * 0.44, 4.5 * M.S, 2.5 * M.S);
    this.root.add(body);
    objs.push(body);

    // gold tassel + tiny vermillion bead
    if (w > 26 * M.S) {
      const tas = this.add.graphics();
      tas.lineStyle(1 * M.S, TASSEL, 0.8);
      tas.beginPath();
      tas.moveTo(cx, y + h + 2 * M.S);
      tas.lineTo(cx, y + h + 7 * M.S);
      tas.strokePath();
      tas.fillStyle(BEAD, 0.9);
      tas.fillCircle(cx, y + h + 9 * M.S, 1.8 * M.S);
      this.root.add(tas);
      objs.push(tas);
    }

    // the keeper's name painted on the paper — only once the lantern is lit
    // (dark ink on dark paper reads as a smudge, and an unpoured lantern has
    // no keeper yet)
    if (name && w > 30 * M.S && warm > 0.05) {
      const nm = name.length > 10 ? name.slice(0, 9) + '…' : name;
      const t = this.add
        .text(cx, y + h * 0.42, nm.toUpperCase(), {
          fontFamily: FONT_LABEL,
          fontStyle: '900',
          fontSize: Math.min(9 * M.S, w * 0.18),
          color: hex(isYou ? INK_NAME_YOU : INK_NAME),
          letterSpacing: 0.5,
        })
        .setOrigin(0.5)
        .setDepth(3);
      this.fit(t, w - 8 * M.S);
      this.root.add(t);
      objs.push(t);
    }
  }

  // ── the keepers on the hill: chunky cloaked figures with hand-lanterns ──────
  private drawKeeperFigures(M: Metrics, s: State, chill: number) {
    const keepers = s.keepers ?? [];
    const nK = Math.min(keepers.length, 5);
    for (let k = 0; k < nK; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const kx = M.w * 0.5 + side * (46 + rnd(k * 7) * 58) * M.S;
      // stand on the crest, above the state line (stateY = hillTop + 52S):
      // deepest figure base stays ~12S clear of the text
      const ky = M.hillTop + (22 + rnd(k * 11) * 10) * M.S;
      const sc = (1.05 + rnd(k * 5) * 0.35) * M.S;

      // hand-lantern halo (additive)
      const halo = this.add
        .image(kx + side * 8 * sc, ky - 4 * sc, 'glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xffb244)
        .setDisplaySize(26 * sc, 26 * sc)
        .setAlpha(0.55 * (1 - chill * 0.65));
      this.root.add(halo);

      const g = this.add.graphics();
      // cloak: rounded cone
      g.fillStyle(CLOAK, 1);
      const cloak: { x: number; y: number }[] = [{ x: kx - 7 * sc, y: ky + 3 * sc }];
      cloak.push(...this.sampleQuad({ x: kx - 7 * sc, y: ky + 3 * sc }, { x: kx - 8 * sc, y: ky - 10 * sc }, { x: kx, y: ky - 14 * sc }, 6));
      cloak.push(...this.sampleQuad({ x: kx, y: ky - 14 * sc }, { x: kx + 8 * sc, y: ky - 10 * sc }, { x: kx + 7 * sc, y: ky + 3 * sc }, 6));
      cloak.push(...this.sampleQuad({ x: kx + 7 * sc, y: ky + 3 * sc }, { x: kx, y: ky + 6 * sc }, { x: kx - 7 * sc, y: ky + 3 * sc }, 6));
      g.fillPoints(cloak as unknown as Phaser.Math.Vector2[], true);
      // glowing face
      g.fillStyle(FACE, 0.95 * (1 - chill * 0.5));
      g.fillEllipse(kx + side * 1.5 * sc, ky - 10.5 * sc, 5.2 * sc, 4 * sc);
      // warm rim toward the lantern
      g.lineStyle(1 * sc, RIM, 0.55 * (1 - chill * 0.65));
      this.strokeQuad(g, { x: kx + side * 7 * sc, y: ky + 2 * sc }, { x: kx + side * 8.5 * sc, y: ky - 8 * sc }, { x: kx + side * 1 * sc, y: ky - 13.5 * sc }, 6);
      // hand-lantern box
      g.fillStyle(chill > 0.5 ? HAND_LANTERN_COLD : HAND_LANTERN, 1);
      g.fillRoundedRect(kx + side * 6.5 * sc, ky - 8 * sc, 4.4 * sc, 6 * sc, 2 * sc);
      g.lineStyle(0.9 * sc, LANTERN_CAP, 1);
      g.beginPath();
      g.moveTo(kx + side * 8.7 * sc, ky - 8 * sc);
      g.lineTo(kx + side * 8.7 * sc, ky - 12.5 * sc);
      g.strokePath();
      this.root.add(g);
    }
  }

  // The graveyard: each fallen chain is a row of dark fallen-lantern husks with thin
  // gold veins near the hill base — oldest deepest ("the gold remembers").
  private drawRubble(M: Metrics, fallen: FallenChain[]) {
    const list = fallen.slice(-5);
    for (let j = 0; j < list.length; j++) {
      const f = list[j]!;
      const depth = list.length - j; // oldest (j=0) sits deepest
      const g = this.add.graphics().setDepth(-3);
      // husks hug the crest below the figures — the zone under the state line
      // now belongs to the UI cluster (pips/pill/button)
      const baseY = M.hillTop + (26 + depth * 3) * M.S;
      const husks = Math.min(7, 3 + Math.floor(f.days / 2));
      const spread = Math.min(M.w * 0.7, (66 + f.days * 4) * M.S);
      for (let k = 0; k < husks; k++) {
        const hx = M.w / 2 - spread / 2 + (spread * k) / Math.max(1, husks - 1) + (rnd(k + f.chainNo * 13) - 0.5) * 8 * M.S;
        const hw = (7 + rnd(k * 3) * 4) * M.S;
        const hh = hw * 1.15;
        g.fillStyle(this.mix(0x1a1226, 0x0d0d13, Math.min(1, depth / 5)), 1);
        g.fillEllipse(hx, baseY, hw, hh);
        // a thin gold vein — deterministic so it doesn't flicker across polls
        if ((k + f.chainNo) % 2 === 0) {
          g.lineStyle(1 * M.S, GOLD, 0.5);
          g.beginPath();
          g.moveTo(hx - hw * 0.4, baseY + hh * 0.2);
          g.lineTo(hx + hw * 0.4, baseY - hh * 0.2);
          g.strokePath();
        }
      }
      this.root.add(g);
    }
  }

  // ── header: eyebrow + Day numeral ───────────────────────────────────────────
  private drawHeader(M: Metrics, s: State, doRecap: boolean) {
    const cold = this.chill > 0.5;
    const eyebrow = this.add
      .text(M.w / 2, M.Y(40), `CHAIN ${Game.roman(s.chainNo)}`, {
        fontFamily: FONT_LABEL,
        fontStyle: '900',
        fontSize: 11 * M.S,
        color: hex(cold ? EYEBROW_COLD : EYEBROW),
        letterSpacing: 4,
      })
      .setOrigin(0.5)
      .setAlpha(0.9);
    this.root.add(eyebrow);

    // the day THIS chain is living (first day = Day 1) == lanterns on the rope
    const numeral = s.streak + 1;
    const day = this.add
      .text(M.w / 2, M.Y(70), `Day ${numeral}`, {
        fontFamily: FONT_DISPLAY,
        fontStyle: '800',
        fontSize: 50 * M.S,
        color: hex(NUMERAL),
      })
      .setOrigin(0.5, 0);
    day.setShadow(0, 3, 'rgba(8,5,16,0.85)', 12, false, true);
    this.root.add(day);

    if (doRecap) {
      const ticker = { v: 1 };
      this.tweens.add({
        targets: ticker,
        v: numeral,
        duration: Math.max(300, (Math.min(s.streak, 8) + 1) * 70),
        ease: 'Quad.easeOut',
        onUpdate: () => day.setText(`Day ${Math.round(ticker.v)}`),
        onComplete: () => day.setText(`Day ${numeral}`),
      });
    }
  }

  // Top-right roster label: KEEPERS TODAY + the names joined.
  private drawKeepersToday(M: Metrics, s: State, chill: number) {
    const keepers = s.keepers ?? [];
    this.rosterRect = null;
    if (keepers.length === 0) return;
    const cold = chill > 0.5;
    const rightX = M.w - M.X(16);
    const header = this.add
      .text(rightX, M.Y(128), 'KEEPERS TODAY', {
        fontFamily: FONT_LABEL,
        fontStyle: '900',
        fontSize: 8.5 * M.S,
        color: hex(cold ? EYEBROW_COLD : EYEBROW),
        letterSpacing: 2,
      })
      .setOrigin(1, 0.5)
      .setAlpha(0.6);
    this.root.add(header);
    const shown = keepers.slice(0, 4).map((n) => this.truncName(n).toUpperCase());
    const extra = keepers.length > 4 ? `  +${keepers.length - 4}` : '';
    const names = this.add
      .text(rightX, M.Y(144), shown.join('  ·  ') + extra, {
        fontFamily: FONT_LABEL,
        fontStyle: '900',
        fontSize: 11 * M.S,
        color: hex(cold ? STATE_COLD : EYEBROW),
        letterSpacing: 0.5,
      })
      .setOrigin(1, 0.5)
      .setAlpha(cold ? 0.95 : 0.98);
    names.setShadow(0, 2, 'rgba(8,5,16,0.8)', 8, false, true);
    this.fit(names, M.w * 0.66);
    this.root.add(names);

    // remember where the words live, padded by roughly a bulb-halo radius, so
    // drawGarlands can keep its bright bulbs out of the label's pixels
    const hb = header.getBounds();
    const nb = names.getBounds();
    this.rosterRect = {
      x0: Math.min(hb.left, nb.left) - 10 * M.S,
      y0: hb.top - 7 * M.S,
      x1: Math.max(hb.right, nb.right) + 10 * M.S,
      y1: nb.bottom + 7 * M.S,
    };
  }

  // The hanko (lock seal) — a small vermillion square with the 鎖 glyph.
  private drawHanko(M: Metrics, chill: number) {
    const cold = chill > 0.5;
    const hx = M.X(30);
    const hy = M.hillTop + 10 * M.S;
    const hw = 24 * M.S;
    const g = this.add.graphics().setDepth(4);
    g.fillStyle(cold ? this.mix(HANKO, 0x6d5a5e, chill * 0.7) : HANKO, 1);
    g.fillRoundedRect(hx - hw / 2, hy - hw / 2, hw, hw, 4 * M.S);
    this.root.add(g);
    const seal = this.add
      .text(hx, hy, '鎖', {
        fontFamily: 'Georgia, serif',
        fontStyle: '700',
        fontSize: 13 * M.S,
        color: '#f5ecd8',
      })
      .setOrigin(0.5)
      .setDepth(5);
    this.root.add(seal);
  }

  private drawOverHill(M: Metrics, s: State, chill: number) {
    const cold = chill > 0.5;
    const t = this.add
      .text(M.X(46), M.hillTop + M.Y(32), `+${s.streak - 8} OVER THE HILL`, {
        fontFamily: FONT_LABEL,
        fontStyle: '700',
        fontSize: 8.5 * M.S,
        color: hex(cold ? EYEBROW_COLD : EYEBROW),
        letterSpacing: 1.5,
      })
      .setOrigin(0, 0.5)
      .setAlpha(0.6)
      .setDepth(4);
    this.root.add(t);
  }

  // ── the state line: soft sentence, or the cold guttering banner ─────────────
  private drawStateLine(M: Metrics, s: State, danger: boolean) {
    let text: string;
    let color: number;
    let weight = '700';
    if (danger) {
      text = `${this.crownLineShort} short · the ember is guttering`.toUpperCase();
      color = STATE_COLD;
      weight = '900';
    } else if (s.count === 0) {
      text = 'the ground is dark — pour the first link';
      color = STATE_WARM;
    } else if (s.streak === 0) {
      text =
        this.crownLineShort > 0
          ? `the first link is poured — ${Game.numberWord(this.crownLineShort)} more before the dark`
          : 'the first day holds — the chain is lit';
      color = STATE_WARM;
    } else if (this.crownLineShort > 0) {
      text = `the chain holds — ${Game.numberWord(this.crownLineShort)} more before nightfall`;
      color = STATE_WARM;
    } else {
      text = 'the chain holds — safe until nightfall';
      color = STATE_WARM;
    }
    const display = danger ? text : text.charAt(0).toUpperCase() + text.slice(1);
    const t = this.add
      .text(M.w / 2, M.stateY, display, {
        fontFamily: FONT_LABEL,
        fontStyle: weight,
        fontSize: 13 * M.S,
        color: hex(color),
        align: 'center',
        letterSpacing: danger ? 0.5 : 0.2,
        wordWrap: { width: M.w * 0.92 },
        lineSpacing: 4,
      })
      .setOrigin(0.5)
      .setDepth(50)
      .setAlpha(danger ? 0.98 : 0.82);
    this.fit(t, M.w * 0.92);
    this.stateLine = t;
  }

  // ── the goal as a row of little lanterns; today's poured ones lit ───────────
  private drawPips(M: Metrics, s: State, chill: number) {
    const cold = chill > 0.5;
    const pipN = s.goal;
    const pipGap = 34 * M.S;
    const pipY = M.pipY;
    for (let i = 0; i < pipN; i++) {
      const px = M.w / 2 + (i - (pipN - 1) / 2) * pipGap;
      const lit = i < s.count;
      const cont = this.add.container(px, pipY).setDepth(50);
      const pw = 15 * M.S;
      const ph = 13 * M.S;
      if (lit) {
        const glow = this.add
          .image(0, 0, 'glowpale')
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(BULB_HALO)
          .setDisplaySize(30 * M.S, 30 * M.S)
          .setAlpha(0.55 * (1 - chill * 0.65));
        cont.add(glow);
      }
      const g = this.add.graphics();
      let top: number;
      let bot: number;
      if (lit && !cold) {
        top = PIP_LIT_TOP;
        bot = PIP_LIT_BOT;
      } else if (lit) {
        top = this.mix(PIP_LIT_TOP, PAPER_BONE_TOP, chill);
        bot = this.mix(PIP_LIT_BOT, PAPER_BONE_BOT, chill);
      } else {
        top = PIP_DARK_TOP;
        bot = PIP_DARK_BOT;
      }
      g.fillStyle(this.mix(top, bot, 0.5), 1);
      g.fillEllipse(0, 0, pw, ph);
      if (!lit) {
        g.lineStyle(1 * M.S, 0x9696b4, 0.4);
        g.strokeEllipse(0, 0, pw, ph);
      }
      g.fillStyle(LANTERN_CAP, 1);
      g.fillRoundedRect(-4 * M.S, -ph / 2 - 3 * M.S, 8 * M.S, 3.4 * M.S, 1.5 * M.S);
      cont.add(g);
      if (lit) {
        const core = this.add
          .image(0, 1 * M.S, 'glowpale')
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(0xfff6d6)
          .setDisplaySize(6 * M.S, 6 * M.S)
          .setAlpha(0.85 * (1 - chill * 0.65));
        cont.add(core);
      }
      this.root.add(cont);
      this.pips.push(cont);
    }
  }

  // ── countdown in a rounded pill (Baloo digits, amber; steel in danger) ──────
  private drawCountdownPill(M: Metrics, rem: number, danger: boolean) {
    const cw = 92 * M.S;
    const ch = 24 * M.S;
    const cy = M.pillY;
    const g = this.add.graphics().setDepth(49);
    g.fillStyle(0x0a0816, 0.55);
    g.fillRoundedRect(M.w / 2 - cw / 2, cy - ch / 2, cw, ch, 12 * M.S);
    g.lineStyle(1 * M.S, danger ? 0xa0aabe : PILL_STROKE, danger ? 0.35 : 0.3);
    g.strokeRoundedRect(M.w / 2 - cw / 2, cy - ch / 2, cw, ch, 12 * M.S);
    this.root.add(g);
    this.timerText = this.add
      .text(M.w / 2, cy, Game.fmt(rem), {
        fontFamily: FONT_DISPLAY,
        fontStyle: '800',
        fontSize: 15 * M.S,
        color: hex(danger ? PILL_DIGIT_COLD : PILL_DIGIT),
        letterSpacing: 1,
      })
      .setOrigin(0.5)
      .setDepth(50);
    this.root.add(this.timerText);
  }

  // ── the button: a chunky pressable lozenge ──────────────────────────────────
  private drawButton(M: Metrics, s: State) {
    const disabled = s.youContributed || s.username == null;
    const label = s.username == null ? 'Log in to pour' : s.youContributed ? "You've poured today" : 'Pour your link';
    const bw = 252 * M.S;
    const bh = 42 * M.S;
    const bx = M.w / 2 - bw / 2;
    const by = M.btnY;
    const r = 21 * M.S;

    if (!disabled) {
      const glow = this.add
        .image(M.w / 2, by + bh / 2, 'glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xffa03c)
        .setDisplaySize(bw * 1.3, bh * 2.4)
        .setAlpha(0.3)
        .setDepth(48);
      this.root.add(glow);
    }

    const g = this.add.graphics().setDepth(49);
    // pressable lip (darker, offset down)
    g.fillStyle(disabled ? 0x2c2440 : BTN_LIP, 1);
    g.fillRoundedRect(bx, by + 4 * M.S, bw, bh, r);
    // face — warm 3-stop gradient (2-stop approximation), dusk-purple when disabled
    if (disabled) {
      g.fillStyle(BTN_DISABLED, 1);
      g.fillRoundedRect(bx, by, bw, bh, r);
    } else {
      g.fillGradientStyle(BTN_FACE_TOP, BTN_FACE_TOP, BTN_FACE_BOT, BTN_FACE_BOT, 1);
      g.fillRoundedRect(bx, by, bw, bh, r);
    }
    // top sheen bar
    g.fillStyle(0xfff0d2, disabled ? 0.12 : 0.35);
    g.fillRoundedRect(bx + 10 * M.S, by + 4 * M.S, bw - 20 * M.S, 7 * M.S, 4 * M.S);
    this.root.add(g);

    const t = this.add
      .text(M.w / 2, by + bh / 2, label, {
        fontFamily: FONT_DISPLAY,
        fontStyle: '800',
        fontSize: 19 * M.S,
        color: hex(disabled ? 0x9a8fb0 : BTN_LABEL),
        letterSpacing: 0.3,
      })
      .setOrigin(0.5)
      .setDepth(50);
    this.root.add(t);

    if (!disabled) {
      const zone = this.add
        .zone(M.w / 2, by + bh / 2, bw, bh + 8 * M.S)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .setDepth(51);
      zone.on('pointerdown', () => {
        this.tweens.add({ targets: [g, t], y: '+=3', duration: 70, yoyo: true });
        void this.place();
      });
      this.root.add(zone);
    }
  }

  private smallButton(x: number, y: number, text: string, onClick: () => void) {
    const M = this.metrics();
    const g = this.add.graphics().setDepth(49);
    g.fillStyle(0x1a1626, 0.85);
    g.fillRoundedRect(x - 72 * M.S, y - 12 * M.S, 144 * M.S, 24 * M.S, 8 * M.S);
    g.lineStyle(1, ASH, 0.5);
    g.strokeRoundedRect(x - 72 * M.S, y - 12 * M.S, 144 * M.S, 24 * M.S, 8 * M.S);
    this.root.add(g);
    const t = this.add
      .text(x, y, text, {
        fontFamily: FONT_LABEL,
        fontStyle: '700',
        fontSize: 11 * M.S,
        color: hex(EYEBROW_COLD),
      })
      .setOrigin(0.5)
      .setDepth(50);
    this.root.add(t);
    const zone = this.add
      .zone(x, y, 144 * M.S, 26 * M.S)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(51);
    zone.on('pointerdown', onClick);
    this.root.add(zone);
  }

  private positionAmbient(M: Metrics, chill: number) {
    if (this.fireflies) {
      this.fireflies.setEmitZone(
        new Phaser.GameObjects.Particles.Zones.RandomZone(
          new Phaser.Geom.Rectangle(
            M.X(14),
            M.Y(150),
            M.w - M.X(28),
            Math.max(40, M.groundY - M.Y(90))
          ) as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource
        )
      );
      this.fireflies.frequency = chill > 0.5 ? 3600 : 380;
    }
    if (this.embers) {
      this.embers.setPosition(this.crownX, this.crownY);
      this.embers.frequency = 260 + chill * 1400;
    }
    if (this.ashMotes) {
      this.ashMotes.frequency = Math.max(400, 900 - chill * 500);
    }
  }

  // ── Beat D: the rope snaps ──────────────────────────────────────────────────
  private playShatter(old: State, next: State) {
    this.shattering = true;
    this.pouring = false;
    this.inDanger = false;
    const M = this.metrics();
    this.shardFloorY = M.groundY + M.Y(30);

    // 900ms of stillness: freeze emitters, dim the garlands + aura.
    this.embers?.stop();
    this.ashMotes?.stop();
    this.fireflies?.stop();
    if (this.groundPool) this.tweens.add({ targets: this.groundPool, alpha: 0.05, duration: 260 });
    this.tweens.add({ targets: this.bg, alpha: 0.25, duration: 400 });

    const geom = this.lanternGeom(old.streak, old.count, old.goal, old.keepers ?? [], old.username, M);
    const fray = this.add.graphics().setDepth(26);

    const STILL = 900;
    const FRAY = 800;
    const HIT = 100;

    this.time.delayedCall(STILL, () => {
      // the rope vibrates then frays at the sag midpoint (growing gap + whipping ends)
      const p = { v: 0 };
      this.tweens.add({
        targets: p,
        v: 1,
        duration: FRAY,
        ease: 'Quad.easeIn',
        onUpdate: () => this.drawFray(fray, M, p.v),
      });
    });

    this.time.delayedCall(STILL + FRAY, () => {
      this.time.delayedCall(HIT, () => this.detonate(old, next, geom, fray, M));
    });
  }

  // Draw the rope with a growing gap at the sag + a whipping wiggle at the frayed tips.
  private drawFray(g: Phaser.GameObjects.Graphics, M: Metrics, p: number) {
    g.clear();
    g.lineStyle(1.6 * M.S, 0xdeba5a, 0.65);
    const vib = (1 - p) * 2 * M.S * Math.sin(this.time.now / 30);
    const gap = 0.06 + p * 0.34; // half-width of the gap in t-space, growing
    const rp = (t: number) => {
      const a = 1 - t;
      return {
        x: a * a * this.ropeS.x + 2 * a * t * this.ropeM.x + t * t * this.ropeE.x,
        y: a * a * this.ropeS.y + 2 * a * t * this.ropeM.y + t * t * this.ropeE.y,
      };
    };
    // left half: ropeStart -> (0.5 - gap), whipping down at the tip
    const leftEnd = Math.max(0.02, 0.5 - gap);
    const lp: { x: number; y: number }[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = (leftEnd * i) / 20;
      const pt = rp(t);
      const w = (t / Math.max(0.01, leftEnd)) * p * 10 * M.S;
      lp.push({ x: pt.x, y: pt.y + w + vib });
    }
    g.beginPath();
    g.moveTo(lp[0]!.x, lp[0]!.y);
    for (let i = 1; i < lp.length; i++) g.lineTo(lp[i]!.x, lp[i]!.y);
    g.strokePath();
    // right half: (0.5 + gap) -> ropeEnd
    const rightStart = Math.min(0.98, 0.5 + gap);
    const rpts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = rightStart + ((1 - rightStart) * i) / 20;
      const pt = rp(t);
      const frac = 1 - (t - rightStart) / Math.max(0.01, 1 - rightStart);
      rpts.push({ x: pt.x, y: pt.y + frac * p * 10 * M.S - vib });
    }
    g.beginPath();
    g.moveTo(rpts[0]!.x, rpts[0]!.y);
    for (let i = 1; i < rpts.length; i++) g.lineTo(rpts[i]!.x, rpts[i]!.y);
    g.strokePath();
  }

  private detonate(
    old: State,
    next: State,
    geom: ChainGeom,
    fray: Phaser.GameObjects.Graphics,
    M: Metrics
  ) {
    const count = geom.streak.length + 1;
    this.cameras.main.shake(600, Math.min(0.03, 0.006 + count * 0.0016));
    this.root.setVisible(false); // falling lanterns replace the standing chain
    fray.destroy();

    this.shardSlowmo = 0.35;
    this.time.delayedCall(700, () => {
      this.shardSlowmo = 1;
    });

    // each lantern detaches and falls as a small darkened chochin
    for (const lan of [...geom.streak, geom.today]) {
      this.shards.push(this.makeLanternShard(M, lan));
    }

    this.time.delayedCall(1400, () => this.showEpitaph(old, next, M));
  }

  // A falling lantern: a small darkened-chochin graphic with gravity + bounce.
  private makeLanternShard(M: Metrics, lan: Lantern): Shard {
    const g = this.add.graphics({ x: lan.cx, y: lan.topY + lan.h * 0.5 }).setDepth(24);
    const w = lan.w;
    const h = lan.h;
    // barrel silhouette in local coords (centered)
    g.fillStyle(this.mix(0x4c445c, 0x2a2440, Math.random()), 1);
    const outline: { x: number; y: number }[] = [{ x: -w * 0.32, y: -h * 0.5 }];
    outline.push(...this.sampleQuad({ x: -w * 0.32, y: -h * 0.5 }, { x: -w * 0.6, y: 0 }, { x: -w * 0.32, y: h * 0.5 }, 6));
    outline.push({ x: w * 0.32, y: h * 0.5 });
    outline.push(...this.sampleQuad({ x: w * 0.32, y: h * 0.5 }, { x: w * 0.6, y: 0 }, { x: w * 0.32, y: -h * 0.5 }, 6));
    g.fillPoints(outline as unknown as Phaser.Math.Vector2[], true);
    g.fillStyle(LANTERN_CAP, 1);
    g.fillRoundedRect(-w * 0.26, -h * 0.5 - 3 * M.S, w * 0.52, 5 * M.S, 2 * M.S);
    // a lingering gold vein — the gold remembers
    if (Math.random() < 0.5) {
      g.lineStyle(1 * M.S, GOLD, 0.8);
      g.beginPath();
      g.moveTo(-w * 0.2, -h * 0.2);
      g.lineTo(w * 0.2, h * 0.2);
      g.strokePath();
    }
    return {
      obj: g,
      vx: Phaser.Math.Between(-220, 220),
      vy: Phaser.Math.Between(-380, -80),
      vr: Phaser.Math.FloatBetween(-5, 5),
      bounces: 0,
      resting: false,
      guttered: false,
    };
  }

  private showEpitaph(old: State, next: State, M: Metrics) {
    const rec = (next.fallen ?? []).find((f) => f.chainNo === old.chainNo);
    const days = rec?.days ?? old.streak;
    const keepers = rec?.keepers ?? (old.keepers?.length ?? 0);
    const line = `Chain ${Game.roman(old.chainNo)} — held ${days} day${days === 1 ? '' : 's'} by ${keepers} keeper${keepers === 1 ? '' : 's'}.`;
    const t = this.add
      .text(M.w / 2, M.groundY - M.Y(40), line, {
        fontFamily: FONT_DISPLAY,
        fontStyle: '800',
        fontSize: 22 * M.S,
        color: INK,
        align: 'center',
        wordWrap: { width: M.w * 0.88 },
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setDepth(52)
      .setAlpha(0);
    t.setShadow(0, 2, 'rgba(8,5,16,0.85)', 10, false, true);
    this.fit(t, M.w * 0.9);
    this.tweens.add({ targets: t, alpha: 1, duration: 700 });
    this.time.delayedCall(3200, () => this.completeShatter(next, t));
  }

  private completeShatter(next: State, epitaph: Phaser.GameObjects.Text) {
    this.state = next;
    this.serverNow = next.now;
    this.serverDeadline = next.deadline;
    this.fetchedAt = this.time.now;

    const dead = this.shards.map((sh) => sh.obj);
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

    this.embers?.start();
    this.ashMotes?.start();
    this.fireflies?.start();
    this.bg.setAlpha(1);
    this.shattering = false;

    // the new chain lights over the rubble, fading in
    this.render();
    this.root.setAlpha(0);
    this.tweens.add({ targets: this.root, alpha: 1, duration: 900, delay: 400 });
  }

  // Per-frame integration for the falling lanterns (hand-rolled physics).
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
          // guttering out: settle to a dim husk as it lands
          if (!sh.guttered) {
            sh.guttered = true;
            this.tweens.add({ targets: sh.obj, alpha: 0.3, duration: 500 });
          }
        }
      }
    }
  }

}
