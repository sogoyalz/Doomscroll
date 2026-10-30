import { MIN_WINDOW_SAMPLE } from './patterns.js';
import type { UserSettings } from './types.js';

export const DEFAULT_SETTINGS: UserSettings = {
  // On by default — the extension does nothing useful otherwise — but the
  // user can stop it from the popup in one click without uninstalling.
  trackingEnabled: true,

  // Off until the user has enough history for a trailing baseline to mean
  // anything. Pattern detection runs and logs from day one; it just does not
  // act. Falling back to a fixed threshold during the cold-start window would
  // reintroduce exactly the false positives the baseline exists to avoid.
  interventionEnabled: false,

  // A diagnostic surface, not a feature. Off unless someone is deliberately
  // running a live validation session.
  debugHud: false,

  classificationMode: 'local-rules',

  // Pattern detection looks at the last N reels and asks whether one category
  // holds more than `dominantThreshold` of them, at more than
  // `baselineMultiplier` times the user's own trailing rate for that category.
  patternWindowSize: 15,
  patternDominantThreshold: 0.6,
  patternBaselineMultiplier: 1.5,

  sessionGapThresholdMs: 2 * 60 * 1000,

  // Only negative-loop categories can trigger. Being shown a lot of joyful or
  // motivational content is not a problem worth interrupting.
  watchedCategories: ['sad', 'breakup', 'anxious', 'angry'],

  interventionLevels: {
    notifyAfterStreak: 5,
    overlayAfterStreak: 10,
    blockAfterStreak: 20,
    blockCooldownMs: 30 * 60 * 1000,
  },
};

export const MINUTE_MS = 60_000;

/**
 * Legal range for every numeric setting, in the units the user edits them in.
 *
 * One owner, because two things depend on these and they must not drift: the
 * options inputs render `min`/`max`/`step` from here, and `mergeSettings`
 * clamps to them on the way into storage.
 *
 * The clamp is the load-bearing half. `min`/`max` on `<input type="number">`
 * constrain the spinner and nothing else — a typed value is written unchanged,
 * and an emptied field reads as 0. That is not a corner case: clearing a field
 * to retype it is the ordinary way to edit a number, and it used to write a
 * window size of 0, which stopped detection permanently with no message. A
 * negative window was worse, because `slice(0, -n)` silently measured the
 * wrong reels and went on firing.
 */
export const SETTING_BOUNDS = {
  // Floored at the detector's own minimum sample, not lower. Detection needs
  // MIN_WINDOW_SAMPLE classified reels in the window before dominance means
  // anything, so a smaller window is a setting that can never fire — the
  // options page was offering a value guaranteed to do nothing.
  patternWindowSize: { min: MIN_WINDOW_SAMPLE, max: 100, step: 1 },
  patternDominantThreshold: { min: 0.3, max: 1, step: 0.05 },
  patternBaselineMultiplier: { min: 1, max: 10, step: 0.1 },
  /** Edited in minutes; stored as milliseconds. */
  sessionGapMinutes: { min: 1, max: 120, step: 1 },

  // The intervention ladder. Not editable from the options page today, and
  // bounded anyway: these were the only numbers in the settings object that
  // reached storage unchecked, and they are the ones that decide how hard the
  // extension interrupts. A threshold of 0 makes `levelForStreak` return that
  // rung for a run of length zero, so every single detection fired the
  // harshest interruption the ladder has.
  //
  // Floored at 1 rather than 0 for that reason. The ceiling is generous: a
  // threshold nobody reaches is a rung switched off, which is a legitimate
  // thing to want.
  notifyAfterStreak: { min: 1, max: 100, step: 1 },
  overlayAfterStreak: { min: 1, max: 100, step: 1 },
  blockAfterStreak: { min: 1, max: 100, step: 1 },
  /** Zero is allowed: it means "no cooldown", which is coherent. */
  blockCooldownMs: { min: 0, max: 24 * 60 * 60_000, step: MINUTE_MS },
} as const;
