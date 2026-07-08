import { reddit } from '@devvit/web/server';

// The daily post title is the game's liturgy — an identical shape every day, only
// the number changing (see DESIGN.md §6). Callers pass the day's line; the manual
// "new post" menu action falls back to the plain name.
export const createPost = async (title = 'The Chain') => {
  return await reddit.submitCustomPost({
    title,
  });
};
