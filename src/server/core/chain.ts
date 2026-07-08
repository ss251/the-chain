// The Chain — shared streak engine.
//
// One chain per installed subreddit (Redis is per-install). Each "day", N distinct
// keepers must each place ONE link (deduped server-side by username) or the chain
// shatters to zero for everyone. Distinctness is the whole game: a solo clear is
// structurally impossible at N>=2 because zCard counts distinct members.
//
// Day boundaries roll over LAZILY on every read/write (the scheduler is a backup):
// whenever `now` has passed the deadline, we resolve each finished day as HOLD
// (streak++/a ring is added) or SHATTER (new chain begins), then advance.

import { redis } from '@devvit/web/server';
import type { ChainStateDTO } from '../../shared/api';

const K = {
  chainNo: 'chain:no',
  streak: 'chain:streak',
  goal: 'chain:goal',
  day: 'chain:day',
  deadline: 'chain:deadline',
  dayMs: 'chain:cfg:dayms',
  daySet: (day: number) => `chain:d:${day}`,
};

// PLAYTEST is the single switch for the whole app. Flip it to `true` before a
// `devvit playtest` session to compress a "day" to 5 minutes (a week of The Chain
// becomes a ~35-minute session) and to re-expose the dev rollover/reset controls.
// It MUST be `false` for the submission build: production days are a real 24 hours,
// and every dev surface (menu items, /api/dev/*, in-game buttons) reads this flag.
// A boolean constant is used instead of process.env because Devvit's server runtime
// does not reliably inject arbitrary env vars.
export const PLAYTEST = false;

const PROD_DAY_MS = 86_400_000; // 24h — production
const PLAYTEST_DAY_MS = 5 * 60 * 1000; // 5m — grey-box time machine
export const DEFAULT_DAY_MS = PLAYTEST ? PLAYTEST_DAY_MS : PROD_DAY_MS;
const DEFAULT_GOAL = 3;
const DAYSET_TTL_SECONDS = 60 * 60 * 24 * 3; // keep a few days of history for rollover

async function num(key: string, fallback: number): Promise<number> {
  const v = await redis.get(key);
  return v === undefined || v === null || v === '' ? fallback : Number(v);
}

async function ensureInit(now: number): Promise<void> {
  const deadline = await redis.get(K.deadline);
  if (deadline === undefined || deadline === null) {
    await redis.set(K.chainNo, '1');
    await redis.set(K.streak, '0');
    await redis.set(K.goal, String(DEFAULT_GOAL));
    await redis.set(K.day, '0');
    await redis.set(K.dayMs, String(DEFAULT_DAY_MS));
    await redis.set(K.deadline, String(now + DEFAULT_DAY_MS));
  }
}

// Advance past any elapsed deadlines, resolving each finished day.
export async function rollover(now: number): Promise<void> {
  await ensureInit(now);
  let chainNo = await num(K.chainNo, 1);
  let streak = await num(K.streak, 0);
  const goal = await num(K.goal, DEFAULT_GOAL);
  let day = await num(K.day, 0);
  const dayMs = await num(K.dayMs, DEFAULT_DAY_MS);
  let deadline = await num(K.deadline, now + dayMs);

  let guard = 0;
  let shatteredThisBatch = false;
  while (now >= deadline && guard < 1000) {
    guard++;
    const count = await redis.zCard(K.daySet(day));
    if (count >= goal) {
      streak += 1; // the chain held — a ring is added to the monument
    } else if (!shatteredThisBatch) {
      chainNo += 1; // the chain shattered — a new chain begins
      streak = 0;
      shatteredThisBatch = true;
    }
    day += 1;
    deadline += dayMs;
  }

  await redis.set(K.chainNo, String(chainNo));
  await redis.set(K.streak, String(streak));
  await redis.set(K.day, String(day));
  await redis.set(K.deadline, String(deadline));
}

const MAX_KEEPERS_SHOWN = 20;

// Today's keepers, in placement order (oldest first). Their usernames get etched in
// gold on the monument — the social proof that makes the crowd visible to a lone
// visitor (DESIGN.md). Capped so the payload stays small on a busy day.
export async function todaysKeepers(now: number): Promise<string[]> {
  await rollover(now);
  const day = await num(K.day, 0);
  const rows = await redis.zRange(K.daySet(day), 0, MAX_KEEPERS_SHOWN - 1, {
    by: 'rank',
  });
  return rows.map((r) => r.member);
}

export async function getState(now: number): Promise<ChainStateDTO> {
  await rollover(now);
  const [chainNo, streak, goal, day, dayMs, deadline] = await Promise.all([
    num(K.chainNo, 1),
    num(K.streak, 0),
    num(K.goal, DEFAULT_GOAL),
    num(K.day, 0),
    num(K.dayMs, DEFAULT_DAY_MS),
    num(K.deadline, now + DEFAULT_DAY_MS),
  ]);
  const count = await redis.zCard(K.daySet(day));
  const keepers = await todaysKeepers(now);
  return { chainNo, streak, day, goal, count, deadline, dayMs, now, dev: PLAYTEST, keepers };
}

// DEDUP KEY = the server-authenticated Reddit username. `member` is always the
// value of `reddit.getCurrentUsername()` resolved on the server from the caller's
// authenticated session (see routes/api.ts) — it is NEVER a client-supplied value,
// so a webview cannot spoof a second identity to inflate the count. Distinctness
// therefore genuinely holds, which is what makes the "impossible solo clear at N>=2"
// thesis true. Username (not userId) is the chosen key because usernames are the
// social proof of the game: each is etched in gold onto the ring its keeper placed
// (DESIGN.md — "carve the people into the object"). userId would dedup identically
// but could not be shown.
//
// Place a link. Returns whether this was the user's FIRST link today (dedup proof:
// tapping again returns added=false and does not move the count).
export async function contribute(
  now: number,
  member: string
): Promise<{ state: ChainStateDTO; added: boolean }> {
  await rollover(now);
  const day = await num(K.day, 0);
  const existing = await redis.zScore(K.daySet(day), member);
  let added = false;
  if (existing === undefined || existing === null) {
    await redis.zAdd(K.daySet(day), { member, score: now });
    await redis.expire(K.daySet(day), DAYSET_TTL_SECONDS);
    added = true;
  }
  const state = await getState(now);
  return { state, added };
}

export async function hasContributed(now: number, member: string): Promise<boolean> {
  await rollover(now);
  const day = await num(K.day, 0);
  const s = await redis.zScore(K.daySet(day), member);
  return !(s === undefined || s === null);
}

// DEV: jump the deadline to the past so the next read rolls the day over.
export async function devForceRollover(now: number): Promise<void> {
  await ensureInit(now);
  await redis.set(K.deadline, String(now - 1));
  await rollover(now);
}

// DEV: wipe the chain back to Day 0 of Chain 1.
export async function devReset(now: number): Promise<void> {
  const day = await num(K.day, 0);
  for (let d = Math.max(0, day - 8); d <= day + 1; d++) {
    await redis.del(K.daySet(d));
  }
  await redis.set(K.chainNo, '1');
  await redis.set(K.streak, '0');
  await redis.set(K.goal, String(DEFAULT_GOAL));
  await redis.set(K.day, '0');
  await redis.set(K.dayMs, String(DEFAULT_DAY_MS));
  await redis.set(K.deadline, String(now + DEFAULT_DAY_MS));
}
