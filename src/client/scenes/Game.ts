import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import type { ChainStateDTO, ContributeResponse, InitResponse } from '../../shared/api';

// GREY-BOX for the 48h cake spike: rectangles + text only. No art, no juice yet.
// It exists to answer one question — is the shared, once-a-day, one-tap loop legible
// and does it create social pull? Molten-Kintsugi visuals come only after that's proven.

const VOID = 0x0b0b10;
const EMBER = 0xff6a00;
const AMBER = 0xffb454;
const GOLD = 0xc9a227;
const ASH = 0x55606e;
const INK = '#ede6da';

type State = ChainStateDTO & { username: string | null; youContributed: boolean };

export class Game extends Scene {
  private state: State | null = null;
  private root!: Phaser.GameObjects.Container;
  private timerText: Phaser.GameObjects.Text | null = null;
  private busy = false;
  // countdown baseline: server deadline vs (serverNow + local elapsed)
  private serverNow = 0;
  private serverDeadline = 0;
  private fetchedAt = 0;

  constructor() {
    super('Game');
  }

  create() {
    this.cameras.main.setBackgroundColor(VOID);
    this.root = this.add.container(0, 0);

    void this.refresh();

    // Poll shared state every 3s (rally feel) + tick the countdown 4x/sec.
    this.time.addEvent({ delay: 3000, loop: true, callback: () => void this.refresh() });
    this.time.addEvent({ delay: 250, loop: true, callback: () => this.tickCountdown() });

    this.scale.on('resize', () => this.render());
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
    if (this.busy || this.state?.youContributed) return;
    this.busy = true;
    const data = await this.api<ContributeResponse>('/api/contribute', 'POST');
    if (data && data.type === 'contribute') this.ingest(data);
    this.busy = false;
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
    if (this.timerText) this.timerText.setText(Game.fmt(this.remainingMs()));
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

    const label = (
      x: number,
      y: number,
      text: string,
      size: number,
      color: string,
      mono = true
    ) => {
      const t = this.add
        .text(x, y, text, {
          fontFamily: mono ? 'monospace' : 'Georgia, serif',
          fontSize: size,
          color,
          align: 'center',
        })
        .setOrigin(0.5);
      this.root.add(t);
      return t;
    };

    // --- header: chain # + day numeral ---
    label(cx, height * 0.08, `CHAIN #${s.chainNo}`, 18, `#${GOLD.toString(16)}`);
    label(cx, height * 0.16, `DAY ${s.streak}`, 64, INK, false);

    // --- the monument: one ring per surviving day, stacked upward ---
    const maxShown = 16;
    const shown = Math.min(s.streak, maxShown);
    const baseY = height * 0.62;
    const ringH = 12;
    const gap = 3;
    for (let i = 0; i < shown; i++) {
      const w = 150 - i * 6;
      const col = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(EMBER),
        Phaser.Display.Color.ValueToColor(0x1a1a22),
        maxShown,
        i
      );
      const tint = danger ? ASH : Phaser.Display.Color.GetColor(col.r, col.g, col.b);
      const rect = this.add
        .rectangle(cx, baseY - i * (ringH + gap), Math.max(30, w), ringH, tint)
        .setOrigin(0.5);
      this.root.add(rect);
    }
    if (s.streak > maxShown) {
      label(cx, baseY - shown * (ringH + gap) - 14, `+${s.streak - maxShown}`, 14, `#${AMBER.toString(16)}`);
    }
    if (s.streak === 0) {
      // fresh chain rising from rubble
      label(cx, baseY, 'the ground is bare - pour the first link', 15, `#${ASH.toString(16)}`);
    }

    // --- today's progress: count / goal ---
    const progColor = held ? `#${AMBER.toString(16)}` : danger ? '#ff5d60' : INK;
    label(cx, height * 0.70, `${s.count} / ${s.goal} LINKS TODAY`, 30, progColor);

    // --- countdown ---
    this.timerText = label(cx, height * 0.77, Game.fmt(this.remainingMs()), 26, `#${AMBER.toString(16)}`);

    // --- status line ---
    const status = held
      ? 'THE CHAIN HOLDS'
      : danger
        ? `THE EMBER IS GUTTERING - ${s.goal - s.count} SHORT`
        : 'THE CHAIN NEEDS YOU';
    label(cx, height * 0.83, status, 15, danger ? '#ff5d60' : `#${GOLD.toString(16)}`);

    // --- the one interaction: place your link ---
    this.button(
      cx,
      height * 0.90,
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
      .rectangle(x, y, w, h, disabled ? 0x1a1a22 : color)
      .setStrokeStyle(2, disabled ? ASH : color)
      .setOrigin(0.5);
    const t = this.add
      .text(x, y, text, {
        fontFamily: 'monospace',
        fontSize: 20,
        color: disabled ? `#${ASH.toString(16)}` : '#0b0b10',
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
      .rectangle(x, y, 150, 26, 0x1a1a22)
      .setStrokeStyle(1, ASH)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onClick);
    const t = this.add
      .text(x, y, text, { fontFamily: 'monospace', fontSize: 12, color: `#${ASH.toString(16)}` })
      .setOrigin(0.5);
    this.root.add(bg);
    this.root.add(t);
  }
}
