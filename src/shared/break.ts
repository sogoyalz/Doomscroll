// The break itself.
//
// "Take a break" used to close the overlay and hand you straight back to the
// feed you were being interrupted about — a button that named an outcome and
// produced none. Worse, it made the effectiveness figures meaningless:
// `accepted` and `bypassed` were two labels for the same event, so the table
// asking "did interrupting help?" could only report which button was nicer to
// press.
//
// A break is therefore a real, timed state. Taking one leaves the reels
// surface; coming back to it inside the window is noticed and recorded. That
// is what makes accepting observably different from dismissing, and the
// difference is the only honest evidence the ladder works.
//
// Pure. The storage and messaging around it live in background/intervene.ts.

/** Where a break sends you. Same origin, one tap from going back. */
export const BREAK_DESTINATION = 'https://www.instagram.com/';

/**
 * How long a break runs.
 *
 * Long enough that returning to the feed is a decision rather than a reflex,
 * short enough to stay proportionate to what prompted it — this is a response
 * to a run of similar reels, not a commitment anyone opted into. It is not
 * user-configurable yet, deliberately: a setting is worth adding once there is
 * data on whether breaks hold, which is what the log now collects.
 */
export const BREAK_MINUTES = 15;

export const BREAK_KEY = 'doomscroll:break';

export interface BreakState {
  startedAt: number;
  endsAt: number;
  /**
   * The interruption that prompted it, so returning early can be attributed
   * to the record that offered the break rather than to the run in general.
   */
  interventionId: string;
}

export function newBreak(
  interventionId: string,
  now: number,
  minutes: number = BREAK_MINUTES,
): BreakState {
  return { startedAt: now, endsAt: now + minutes * 60_000, interventionId };
}

/**
 * Whether a break is still running.
 *
 * An expired break is simply inactive rather than being cleaned up. Nothing
 * reads it once it has lapsed, and a worker that has to wake up to tidy state
 * is a worse trade than a stale key.
 */
export function isBreakActive(state: BreakState | null, now: number): boolean {
  return state !== null && now < state.endsAt;
}

export function breakRemainingMs(state: BreakState, now: number): number {
  return Math.max(0, state.endsAt - now);
}

/**
 * How long after a break begins the reminder stays quiet.
 *
 * Taking a break navigates away, and that takes a moment: the state is written
 * before the page leaves, so for a beat the tab is still on the reels feed
 * with a live break. Without this the reminder can flash up on the page the
 * user just chose to leave, which reads as the extension arguing with a
 * decision it asked for.
 *
 * Also covers a second tab already sitting on the feed — it gets reminded, a
 * few seconds later rather than instantly.
 */
export const BREAK_GRACE_MS = 5000;

/**
 * Whether to remind someone that a break is running.
 *
 * Not the same question as whether the break is active: a break is active from
 * the instant it starts, and worth mentioning only once the page has had time
 * to leave the feed.
 */
export function shouldRemind(state: BreakState | null, now: number): boolean {
  return isBreakActive(state, now) && now - state!.startedAt >= BREAK_GRACE_MS;
}

/** Shape check for a value read back out of storage. */
export function isBreakState(value: unknown): value is BreakState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<BreakState>;
  return (
    typeof candidate.startedAt === 'number' &&
    typeof candidate.endsAt === 'number' &&
    typeof candidate.interventionId === 'string'
  );
}

/**
 * Whether this page is the reels feed.
 *
 * The URL cannot tell you *which* reel is on screen — it names only the one
 * the page opened on, which is why identity comes from React fiber instead
 * (docs/dom-notes.md §6). It is perfectly reliable for the different and much
 * weaker question asked here: which surface am I on.
 */
export function isReelsSurface(pathname: string): boolean {
  return pathname === '/reels' || pathname.startsWith('/reels/');
}
