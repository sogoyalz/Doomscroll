// Watch-time state machine.
//
// Deliberately pure: it is driven by explicit setActive/pause/resume/flush
// calls and a caller-supplied clock, with no DOM observers of its own. The
// IntersectionObserver wiring lives in index.ts, which keeps the timing rules
// unit-testable without stubbing browser observers.

/** Below this, a reel was flicked past during momentum scroll, not shown. */
export const MIN_DWELL_MS = 250;

/**
 * Above this, the clock was left running by a bug or a stuck tab. Durations
 * are clamped rather than dropped so the view still counts.
 */
export const MAX_DWELL_MS = 10 * 60 * 1000;

/**
 * Hidden for longer than this and the view is treated as having ended when
 * the tab was hidden, rather than resuming on return.
 *
 * Watch time already excludes hidden time, but `startedAt`/`endedAt` are wall
 * clock, and binge length is measured from them. Without this, leaving
 * Instagram open in a background tab overnight produces one view spanning the
 * whole night and a "longest binge" of many hours. Two minutes matches the
 * session-gap default: away that long and you left.
 */
export const MAX_HIDDEN_MS = 2 * 60 * 1000;

export interface CompletedView<T> {
  target: T;
  startedAt: number;
  endedAt: number;
  /** Time on screen with the tab visible. Never exceeds endedAt - startedAt. */
  watchDurationMs: number;
}

interface ActiveView<T> {
  target: T;
  startedAt: number;
  /** Visible time banked before the current run. */
  accumulatedMs: number;
  /** Start of the current visible run, or null while paused. */
  runStartedAt: number | null;
}

export interface DwellTracker<T> {
  setActive(target: T | null, now: number): void;
  pause(now: number): void;
  resume(now: number): void;
  /** Finalizes any in-flight view — call on unload. */
  flush(now: number): void;
  /** Drops any in-flight view without recording it. */
  discard(): void;
  currentTarget(): T | null;
}

/**
 * Tracks which reel is on screen and for how long.
 *
 * Time spent with the tab hidden is excluded: pause() banks the elapsed run
 * and resume() starts a new one, so a reel left on screen in a background tab
 * does not accrue watch time.
 */
export function createDwellTracker<T>(
  onComplete: (view: CompletedView<T>) => void,
  { minDwellMs = MIN_DWELL_MS, maxDwellMs = MAX_DWELL_MS, maxHiddenMs = MAX_HIDDEN_MS } = {},
): DwellTracker<T> {
  let active: ActiveView<T> | null = null;
  let paused = false;
  let pausedAt: number | null = null;

  function finalize(now: number): void {
    if (!active) return;
    const view = active;
    active = null;

    const banked = view.accumulatedMs + (view.runStartedAt === null ? 0 : now - view.runStartedAt);
    const watchDurationMs = Math.min(Math.max(banked, 0), maxDwellMs);
    if (watchDurationMs < minDwellMs) return;

    onComplete({
      target: view.target,
      startedAt: view.startedAt,
      endedAt: now,
      watchDurationMs,
    });
  }

  return {
    setActive(target, now) {
      if (active && active.target === target) return;
      finalize(now);
      if (target === null) return;
      active = {
        target,
        startedAt: now,
        accumulatedMs: 0,
        // Starting while the tab is hidden banks no time until resume().
        runStartedAt: paused ? null : now,
      };
    },

    pause(now) {
      if (paused) return;
      paused = true;
      pausedAt = now;
      if (active && active.runStartedAt !== null) {
        active.accumulatedMs += now - active.runStartedAt;
        active.runStartedAt = null;
      }
    },

    resume(now) {
      if (!paused) return;
      paused = false;

      // Away longer than a session gap: the view ended when the tab was
      // hidden, so close it at that moment instead of stretching it across
      // the absence. Otherwise its wall-clock span — which is what binge
      // length is measured from — swallows the entire time away.
      if (pausedAt !== null && now - pausedAt > maxHiddenMs) {
        finalize(pausedAt);
        pausedAt = null;
        return;
      }

      pausedAt = null;
      if (active && active.runStartedAt === null) active.runStartedAt = now;
    },

    flush(now) {
      finalize(now);
    },

    discard() {
      // Used when tracking is paused mid-reel. Pausing should stop recording
      // immediately, not bank a partial view on the way out.
      active = null;
    },

    currentTarget() {
      return active?.target ?? null;
    },
  };
}
