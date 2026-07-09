// The Chain — hand-synthesized festival audio. No asset files, no dependencies:
// every sound is built from oscillators and filtered noise at call time, so the
// bundle stays tiny and nothing can 404 inside Devvit's webview.
//
// Browser autoplay policy: an AudioContext starts suspended until the DOCUMENT has
// user activation. The splash's Enter click happens in a different document, so the
// first load's opening recap may be silent — sound begins from the player's first
// tap inside the game (Game.ts calls unlock() on pointerdown). Every call before
// unlock is a safe no-op.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem('chain:muted') === '1';
} catch {
  // storage can be unavailable in a sandboxed webview — default to sound on
}

const VOLUME = 0.5;

function ac(): AudioContext | null {
  if (ctx) return ctx;
  const AC =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : VOLUME;
  master.connect(ctx.destination);
  return ctx;
}

// Resume the context from a user gesture. Safe to call repeatedly.
export function unlock(): void {
  const c = ac();
  if (c && c.state === 'suspended') void c.resume();
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem('chain:muted', m ? '1' : '0');
  } catch {
    // best-effort persistence only
  }
  if (master) master.gain.value = m ? 0 : VOLUME;
}

export function isMuted(): boolean {
  return muted;
}

function ready(): AudioContext | null {
  const c = ac();
  return c && c.state === 'running' && !muted ? c : null;
}

// ── voices ─────────────────────────────────────────────────────────────────────

// A warm temple-bell strike: fundamental + one inharmonic partial, exponential decay.
function bell(c: AudioContext, freq: number, t0: number, vol: number, dur = 1.4): void {
  for (const [ratio, gain] of [
    [1, 1],
    [2.76, 0.28],
  ] as const) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq * ratio;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol * gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master!);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

// A soft koto-ish pluck: triangle through a closing lowpass, fast decay.
function pluck(c: AudioContext, freq: number, t0: number, vol: number): void {
  const o = c.createOscillator();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  f.type = 'lowpass';
  f.frequency.setValueAtTime(freq * 5, t0);
  f.frequency.exponentialRampToValueAtTime(freq * 1.5, t0 + 0.3);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
  o.connect(f).connect(g).connect(master!);
  o.start(t0);
  o.stop(t0 + 0.5);
}

// A burst of filtered noise (the crack, the shimmer).
function noise(
  c: AudioContext,
  t0: number,
  dur: number,
  vol: number,
  type: BiquadFilterType,
  freq: number
): void {
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t0);
}

// ── the five sounds ────────────────────────────────────────────────────────────

// A major triad, one note per link poured so far — the chord that GROWS as the
// community fills the day. The goal-completing pour lands the full chord + a sparkle.
const CHORD = [220, 277.18, 329.63]; // A3, C#4, E4

// 1. Beat A — the pour. Strummed bells up to `count` notes.
export function pour(count: number, goal: number): void {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  const notes = Math.max(1, Math.min(count, CHORD.length));
  for (let i = 0; i < notes; i++) {
    bell(c, CHORD[i]!, t + i * 0.055, 0.16);
  }
  if (count >= goal) bell(c, 659.25, t + notes * 0.055 + 0.08, 0.1, 1.8); // E5 sparkle
}

// 2. Beat C — the save. A low warm swell opening into a bright ascending shimmer.
export function save(): void {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  // the swell: a gliss through an opening lowpass
  const o = c.createOscillator();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(220, t + 0.7);
  f.type = 'lowpass';
  f.frequency.setValueAtTime(220, t);
  f.frequency.exponentialRampToValueAtTime(2400, t + 0.7);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.2, t + 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  o.connect(f).connect(g).connect(master!);
  o.start(t);
  o.stop(t + 1.2);
  // the shimmer: rising bells over the swell's crest + a breath of bright noise
  for (const [i, freq] of [440, 554.37, 659.25, 880].entries()) {
    bell(c, freq, t + 0.5 + i * 0.09, 0.11, 1.6);
  }
  noise(c, t + 0.5, 0.7, 0.05, 'highpass', 3200);
}

// 3. Beat D — the shatter. A dry crack, a low thud, and a falling gutter.
export function shatter(): void {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  noise(c, t, 0.09, 0.3, 'bandpass', 1800); // the rope cracks
  const thud = c.createOscillator();
  const tg = c.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(100, t + 0.02);
  thud.frequency.exponentialRampToValueAtTime(38, t + 0.4);
  tg.gain.setValueAtTime(0.38, t + 0.02);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  thud.connect(tg).connect(master!);
  thud.start(t + 0.02);
  thud.stop(t + 0.55);
  // the light going out: a sad detuned slide down
  const o = c.createOscillator();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(165, t + 0.1);
  o.frequency.exponentialRampToValueAtTime(82, t + 1.0);
  f.type = 'lowpass';
  f.frequency.value = 700;
  g.gain.setValueAtTime(0.07, t + 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  o.connect(f).connect(g).connect(master!);
  o.start(t + 0.1);
  o.stop(t + 1.2);
}

// 4. The opening recap — one soft pluck per lantern, climbing a pentatonic ladder.
const LADDER = [220, 246.94, 277.18, 329.63, 369.99, 440, 493.88, 554.37, 659.25];
export function recapPluck(i: number): void {
  const c = ready();
  if (!c) return;
  pluck(c, LADDER[Math.min(i, LADDER.length - 1)]!, c.currentTime, 0.09);
}

// 5. Beat B — the danger heartbeat: two muffled thumps while the ember gutters.
let dangerTimer: ReturnType<typeof setInterval> | null = null;
export function setDanger(on: boolean): void {
  if (on && !dangerTimer) {
    const beat = () => {
      const c = ready();
      if (!c) return;
      const t = c.currentTime;
      for (const [dt, vol] of [
        [0, 0.24],
        [0.24, 0.16],
      ] as const) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sine';
        o.frequency.value = 55;
        g.gain.setValueAtTime(0, t + dt);
        g.gain.linearRampToValueAtTime(vol, t + dt + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.16);
        o.connect(g).connect(master!);
        o.start(t + dt);
        o.stop(t + dt + 0.2);
      }
    };
    beat();
    dangerTimer = setInterval(beat, 2600);
  } else if (!on && dangerTimer) {
    clearInterval(dangerTimer);
    dangerTimer = null;
  }
}
