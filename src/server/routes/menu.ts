import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';
import { PLAYTEST, devForceRollover, devReset } from '../core/chain';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();

    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: 'Failed to create post',
      },
      400
    );
  }
});

// --- DEV menu routes: only registered in PLAYTEST builds. The matching menu
// items are also absent from devvit.json in production, so these are unreachable
// in the submission build (kept here, gated, for symmetry with the dev buttons). ---

if (PLAYTEST) {
  menu.post('/dev-rollover', async (c) => {
    await devForceRollover(Date.now());
    return c.json<UiResponse>({ showToast: 'DEV: forced day rollover' }, 200);
  });

  menu.post('/dev-reset', async (c) => {
    await devReset(Date.now());
    return c.json<UiResponse>({ showToast: 'DEV: chain reset to Day 0' }, 200);
  });
}
