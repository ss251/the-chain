# The Chain

**One link a day, together, or the chain breaks for everyone.**

---

## What it is

The Chain is a Devvit game where an entire subreddit shares **one** streak.

Every day, **N distinct keepers** must each place their single link. If enough
distinct people show up, the chain **holds** and a new ring is added to a growing
monument. If the community falls short before the day ends, the chain **shatters
back to zero** — for everyone — and a new Chain begins on the gold-veined rubble
of the old one.

The rule is what makes it Reddit-native: distinctness is enforced server-side with
a Redis sorted set (`zAdd` to record a keeper, `zCard` to count distinct keepers).
One person tapping a hundred times still counts as **one**. So at N ≥ 2 a solo
clear is **structurally impossible** — the crowd is not decoration, it is the
mechanic. This is a game only a community can play.

## How to play

1. **Open the post.** The monument shows the current Chain number, how many days
   it has held (`DAY 9`), and today's progress (`4 / 6 LINKS TODAY`) over a live
   countdown to the day's end.
2. **Tap `POUR YOUR LINK`.** You may place exactly **one** link per day — your ring
   drops molten onto the monument and cools into place, and your username is etched
   into it in gold. Tapping again does nothing; the count only moves for *new*
   keepers.
3. **Watch the count climb** toward the goal N as other keepers arrive. As the
   clock runs down and the chain is still short, the monument cools toward ash and
   the countdown starts to blink — the community has to rally.
4. **Come back before the countdown ends.**
   - Reach **N distinct keepers** → the chain **holds**, streak `+1`, a ring is added.
   - Fall short → the chain **shatters** to zero and **Chain N+1** rises from the rubble.

That's the whole loop: five seconds of play, then a full day of *"did we hold?"*

## The hook (why you come back)

- **A daily rollover** resolves each day as HOLD or SHATTER.
- **A daily auto-post** (via Devvit's Scheduler) drops the chain back into every
  keeper's feed with the same liturgical title — `Day 23. The chain holds.` — so the
  streak is always one scroll away and the "did we hold overnight?" vigil is the
  retention loop.
- **The shared stake.** Your streak is everyone's streak. Missing a day doesn't cost
  *you* points — it breaks the chain for the whole community. Absence is the threat.

## User contributions

Every ring on the monument is **etched with the username of the keeper who placed
it**, in Kintsugi gold. A judge (or any new visitor) opening the post alone sees
strangers' names carved into the object — and then their own name join them. The
community is visible even in a one-person session; the crowd is made of names, not
numbers. (There are deliberately **no** leaderboards or per-user scores — ranking
individuals would collapse the communal stake into a personal one. Presence, yes;
competition, no.)

## Visual direction — Molten Kintsugi

The monument is a cairn of volcanic glass, poured one molten ring per surviving
day, cooling to black. When it shatters, the community rebuilds on the rubble with
the old breaks healed in gold — *the gold remembers*. Breakage is history, not
deletion: that is the thesis, and it turns the game's harshest mechanic (total
reset) into its lore. One-heat palette only — Void `#0B0B10`, Basalt `#1A1A22`,
Ember `#FF6A00 → #FFB454`, Kintsugi gold `#C9A227`, Ash `#55606E`, candlelit text
`#EDE6DA`. See [`../DESIGN.md`](../DESIGN.md) for the full point of view.

## Tech

- **Devvit Web** (`@devvit/web` 0.13.6) — Reddit's Interactive Posts platform.
- **Phaser 4.2** — the client renderer (monument, tweens, particles, screen-shake,
  the place / cool / etch / shatter beats).
- **Hono** — the server routes (`/api/init`, `/api/contribute`, the scheduler and
  menu internals).
- **Redis** — the shared-streak engine: a per-day sorted set (`chain:d:<day>`) gives
  `zAdd`/`zScore` dedup and `zCard` distinct-keeper counts; chain number, streak,
  goal and deadline are plain keys. Day boundaries roll over lazily on any
  read/write, with the Scheduler cron as the guaranteed backup.
- **Scheduler** — one daily cron (`0 0 * * *`) that resolves the day and posts the
  liturgy.

## Local development

The whole app is switched by a single constant, `PLAYTEST`, at the top of
[`src/server/core/chain.ts`](src/server/core/chain.ts):

- `PLAYTEST = false` (the submission build) → a "day" is a real **24 hours** and every
  dev surface is stripped from the build.
- `PLAYTEST = true` → a "day" is compressed to **5 minutes** so a week of The Chain
  playtests in ~35 minutes, and in-game **DEV: rollover / reset** controls plus the
  `/api/dev/*` routes are re-exposed for fast iteration.

```bash
npm install
npm run login      # devvit login (once)
npm run dev        # devvit playtest — set PLAYTEST=true first for 5-minute days
```

Other scripts: `npm run build` (client + server), `npm run type-check`,
`npm run lint`, `npm run deploy` (upload), `npm run launch` (upload + publish).

> Before publishing the submission build, make sure `PLAYTEST` is `false` and point
> `dev.subreddit` in `devvit.json` at your real playtest subreddit.

---

*Built for the Reddit "Games with a Hook" hackathon (Devvit + Phaser).*
