import { Hono } from 'hono';
import { context } from '@devvit/web/server';
import { getState, rollover } from '../core/chain';
import { createPost } from '../core/post';

export const scheduler = new Hono();

// Daily cron (registered in devvit.json). Two jobs, in order:
//   1. Resolve the day that just ended — HOLD (a ring is added) or SHATTER (a new
//      chain begins). Lazy rollover already does this on any read/write; running it
//      here guarantees the boundary resolves even on a dead-quiet day with no taps.
//   2. Drop the liturgy post back into the feed. The identical-shape daily title is
//      the retention flywheel: it puts the chain in every keeper's feed and creates
//      the between-session "did we hold?" vigil (DESIGN.md §6).
scheduler.post('/daily', async (c) => {
  try {
    const now = Date.now();
    await rollover(now);
    const state = await getState(now);

    // Liturgy: same shape every day, only the number changes. A fresh chain (streak
    // reset to 0 by an overnight shatter) announces the new chain instead.
    const title =
      state.streak > 0
        ? `Day ${state.streak}. The chain holds.`
        : `Chain ${state.chainNo} begins.`;

    const post = await createPost(title);

    return c.json(
      {
        status: 'success',
        message: `Daily post created in ${context.subredditName} with id ${post.id}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error in daily scheduler: ${error}`);
    return c.json({ status: 'error', message: 'Daily scheduler failed' }, 400);
  }
});
