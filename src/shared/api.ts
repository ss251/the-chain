// Shared request/response types for The Chain.
// The whole subreddit shares ONE streak: each "day", N distinct keepers must each
// place their single link or the chain shatters to zero for everyone.

export type ChainStateDTO = {
  chainNo: number; // which chain we're on (increments on every shatter)
  streak: number; // days the current chain has held = rings on the monument
  day: number; // monotonic index of the current, in-progress day
  goal: number; // N distinct keepers needed today
  count: number; // distinct keepers who have placed today
  deadline: number; // ms epoch when today ends
  dayMs: number; // length of a "day" (grey-box time machine)
  now: number; // server time, so the client can compute the countdown locally
  dev: boolean; // true only in PLAYTEST builds — gates the in-game dev controls
  keepers: string[]; // today's keepers, oldest-first — etched in gold on the monument
};

export type InitResponse = ChainStateDTO & {
  type: 'init';
  username: string | null;
  youContributed: boolean;
};

export type ContributeResponse = ChainStateDTO & {
  type: 'contribute';
  username: string | null;
  youContributed: boolean;
  added: boolean; // true if this was the user's first link today (dedup proof)
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};
