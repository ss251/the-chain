import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';
import type { ContributeResponse, ErrorResponse, InitResponse } from '../../shared/api';
import {
  PLAYTEST,
  contribute,
  devForceRollover,
  devReset,
  getState,
  hasContributed,
} from '../core/chain';

export const api = new Hono();

api.get('/init', async (c) => {
  const now = Date.now();
  try {
    const username = (await reddit.getCurrentUsername()) ?? null;
    const state = await getState(now);
    const youContributed = username ? await hasContributed(now, username) : false;
    return c.json<InitResponse>({ type: 'init', ...state, username, youContributed });
  } catch (error) {
    console.error('API /init error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load the chain';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/contribute', async (c) => {
  const now = Date.now();
  try {
    // Identity is resolved server-side from the authenticated session and used as
    // the distinct-keeper dedup key (see contribute() in core/chain.ts). It is
    // never trusted from the client, so the count cannot be spoofed. A logged-out
    // tap resolves to null and is rejected below — it can never move the count.
    const username = (await reddit.getCurrentUsername()) ?? null;
    if (!username) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'You must be logged in to place a link.' },
        401
      );
    }
    const { state, added } = await contribute(now, username);
    return c.json<ContributeResponse>({
      type: 'contribute',
      ...state,
      username,
      youContributed: true,
      added,
    });
  } catch (error) {
    console.error('API /contribute error:', error);
    const message = error instanceof Error ? error.message : 'Failed to place your link';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// --- DEV endpoints: only registered in PLAYTEST builds, so a production
// (PLAYTEST=false) deploy leaves /api/dev/* completely unrouted (404). ---

if (PLAYTEST) {
  api.post('/dev/rollover', async (c) => {
    const now = Date.now();
    await devForceRollover(now);
    const state = await getState(now);
    return c.json<InitResponse>({
      type: 'init',
      ...state,
      username: null,
      youContributed: false,
    });
  });

  api.post('/dev/reset', async (c) => {
    const now = Date.now();
    await devReset(now);
    const state = await getState(now);
    return c.json<InitResponse>({
      type: 'init',
      ...state,
      username: null,
      youContributed: false,
    });
  });
}
