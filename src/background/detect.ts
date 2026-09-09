// Runs pattern detection after each reel and records the outcome.
//
// LOG ONLY. Nothing here notifies, overlays, or blocks — it writes what it
// would have done and stops. Intervention is Phase 7b and stays behind
// interventionEnabled, which ships off.
//
// That is not caution for its own sake: the thresholds are guesses until they
// have been checked against a real week of one person's scrolling, and the
// detection log is the artifact that makes that check possible.

import { getDailyAggregates, getDetectionLog, getRecentReelEvents, putDetectionLog } from './db.js';
import {
  BASELINE_WINDOW_DAYS,
  chargedBaselineShares,
  currentStreak,
  detectPattern,
  type PatternDetection,
} from '@shared/patterns.js';
import { localDateKey, startOfLocalDayBefore } from '@shared/time.js';
import type { DetectionLogEntry, ReelEvent, UserSettings } from '@shared/types.js';

/**
 * True when a new check says the same thing as the last one.
 *
 * Only the qualitative outcome is compared. The share and ratio drift by a
 * point or two with every reel, so comparing numbers would defeat the
 * collapsing entirely.
 */
function sameOutcome(previous: DetectionLogEntry, next: PatternDetection, sessionId: string) {
  return (
    previous.sessionId === sessionId &&
    previous.detected === next.detected &&
    previous.category === next.category &&
    previous.reason === next.reason &&
    // Distinguishes findings that agree on category and reason but came from
    // different rules, once there is more than one rule.
    (previous.trigger ?? null) === next.trigger
  );
}

/**
 * Horizon for the second, slower baseline that is logged but never acted on.
 *
 * Motivated by a concrete finding from scripts/replay-detection.mjs: over a
 * synthetic month containing a deliberate slide into sad content, the detector
 * fires on the first day of the slide and then goes quiet for the rest of it —
 * including an unbroken fourteen-reel sad run on the final day. Any adaptive
 * baseline does this, and the pooled one it replaced behaved identically, so
 * it is a property of the design rather than a regression.
 *
 * Whether it is a *fault* depends on a distinction the detector cannot
 * currently draw. Someone whose sad share has been 70% for months should be
 * left alone — that is the design working. Someone whose sad share went from
 * 10% to 70% in a week is the slide the tool exists to notice, and to a
 * two-week baseline the two look the same by the end.
 *
 * Sixty days is long enough that a week-old shift has barely moved it, so
 * comparing the two shares separates the cases. Logged rather than used,
 * because turning it into a rule on the strength of one synthetic month would
 * be exactly the guesswork the log-only period exists to replace.
 */
const LONG_BASELINE_DAYS = 60;

/**
 * Scrolling pace across the window, in reels per second.
 *
 * Measured from the events already in hand rather than from the day's
 * aggregate: this is meant to describe the run happening right now, and the
 * daily average washes exactly that out. Spans start-to-start, so N reels give
 * N-1 intervals.
 *
 * Returns 0 rather than Infinity when the span is degenerate — a single reel,
 * or a clock that went backwards. This is a context field on a log row; it
 * must never be the thing that throws.
 */
function pacePerSec(events: ReelEvent[]): number {
  if (events.length < 2) return 0;
  const times = events.map((e) => e.startedAt).sort((a, b) => a - b);
  const spanMs = times[times.length - 1]! - times[0]!;
  if (spanMs <= 0) return 0;
  return (events.length - 1) / (spanMs / 1000);
}

/**
 * Evaluates the current window and records the decision.
 *
 * Detection runs on every reel, which at a real scrolling pace is a dozen
 * checks a minute. Writing a row each time buried the interesting entries and
 * made one session overflow the whole log view, so an unbroken run of the
 * same outcome collapses into a single row that counts its occurrences and
 * carries the most recent numbers.
 *
 * Returns the detection so Phase 7b can act on it without redoing the work.
 */
export async function runDetection(
  sessionId: string,
  settings: UserSettings,
  now: number = Date.now(),
): Promise<PatternDetection> {
  const recent = await getRecentReelEvents(settings.patternWindowSize);

  // Baseline excludes today: the session being judged must not be allowed to
  // raise the bar it is judged against. Yesterday backwards.
  //
  // One read covers both horizons. The detector only ever sees the short one —
  // passing it more days would quietly weaken the cold-start guard, which
  // counts days rather than measuring them.
  const to = localDateKey(startOfLocalDayBefore(now, 1));
  const longFrom = localDateKey(startOfLocalDayBefore(now, LONG_BASELINE_DAYS));
  const shortFrom = localDateKey(startOfLocalDayBefore(now, BASELINE_WINDOW_DAYS));

  const longDays = await getDailyAggregates(longFrom, to);
  const baselineDays = longDays.filter((d) => d.date >= shortFrom);

  const detection = detectPattern(
    recent,
    baselineDays,
    {
      windowSize: settings.patternWindowSize,
      dominantThreshold: settings.patternDominantThreshold,
      baselineMultiplier: settings.patternBaselineMultiplier,
      watchedCategories: settings.watchedCategories,
    },
    now,
  );

  const measurements = {
    detected: detection.detected,
    trigger: detection.trigger,
    category: detection.category,
    share: detection.share,
    baselineShare: detection.baselineShare,
    ratio: detection.ratio,
    windowSample: detection.windowSample,
    chargedSample: detection.chargedSample,
    baselineSample: detection.baselineSample,
    // detectPattern already computes this for the category it reports; falling
    // back keeps the field populated on the early returns that name none.
    streak: detection.streak || (detection.category ? currentStreak(recent, detection.category) : 0),
    reason: detection.reason,
    baselineShareLong: detection.category
      ? (chargedBaselineShares(longDays, now).shares[detection.category] ?? 0)
      : 0,
    pacePerSec: pacePerSec(recent),
    hourOfDay: new Date(now).getHours(),
    wouldHaveActed: detection.detected && settings.interventionEnabled,
  };

  const [previous] = await getDetectionLog(1);

  if (previous && sameOutcome(previous, detection, sessionId)) {
    // Keep `at` as the moment the run began; everything else reflects now.
    await putDetectionLog({
      ...previous,
      ...measurements,
      lastAt: now,
      occurrences: (previous.occurrences ?? 1) + 1,
    });
    return detection;
  }

  await putDetectionLog({
    id: crypto.randomUUID(),
    at: now,
    lastAt: now,
    occurrences: 1,
    sessionId,
    ...measurements,
  });

  return detection;
}
