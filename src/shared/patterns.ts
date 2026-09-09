// Pattern detection: is the feed currently pushing one category harder than
// it normally does for this person?
//
// Two conditions must hold together, and the second is the point of the whole
// design. Dominance alone ("60% of the last 15 reels were sad") false-flags
// anyone whose ordinary diet runs heavy in a category — exactly the people a
// tool like this should not be lecturing. Comparing against the user's OWN
// trailing rate is what makes the signal mean "this is unusual for you"
// rather than "this is unusual for some imagined average person".
//
// What this detects is repetition in a text-derived content CATEGORY. It is
// not a claim about how the viewer feels: someone perfectly fine can trip it
// by falling into an algorithmic loop, and someone having a hard week may
// deliberately want the content it flags. Copy built on this must describe
// the pattern shown, never the person watching.

import { UNCLASSIFIED } from './aggregation.js';
import { isCharged } from './taxonomy.js';
import { localDateKey, localDayRange } from './time.js';
import type { DailyAggregate, ReelEvent } from './types.js';

/**
 * Days of history required before a baseline is trusted.
 *
 * Below this there is deliberately no fallback. Substituting a fixed
 * threshold for the missing baseline would reintroduce precisely the false
 * positives the baseline exists to prevent, and would do it during the week
 * the user is deciding whether to trust the tool at all.
 */
export const MIN_BASELINE_DAYS = 7;

/**
 * Trailing window the baseline is computed over.
 *
 * Fourteen rather than seven because the baseline is now recency-weighted
 * (see BASELINE_HALF_LIFE_DAYS): the older half of the window contributes
 * little, but it contributes smoothly, which is the whole point. A hard
 * seven-day cutoff made a single heavy day change the baseline discontinuously
 * on the morning it aged out.
 */
export const BASELINE_WINDOW_DAYS = 14;

/**
 * Recency half-life of the baseline, in days.
 *
 * A day's contribution halves every seven days, so yesterday counts roughly
 * twice what a week ago does and eight times what a fortnight ago does. Seven
 * keeps the old window's centre of mass while removing its cliff edge: with a
 * flat window, the day a heavy Sunday fell out of range the baseline lurched,
 * and a run that was "within baseline" at 23:59 could be flagged at 00:01
 * without the feed changing at all.
 *
 * This is what makes the baseline track a genuine shift in someone's diet —
 * a new job, a breakup, a new interest — rather than defending a fortnight-old
 * average against the present.
 */
export const BASELINE_HALF_LIFE_DAYS = 7;

/**
 * Minimum classified reels in the recent window before dominance is
 * meaningful. Three out of four reels being sad says little when only four
 * reels could be read at all.
 */
export const MIN_WINDOW_SAMPLE = 8;

/** Minimum classified reels across the baseline period for it to be usable. */
export const MIN_BASELINE_SAMPLE = 20;

/**
 * Minimum CHARGED reels in the window before dominance is meaningful.
 *
 * Dominance is measured among emotional reels only (see chargedShares), and a
 * "100% breakup" window built from two reels is noise. Five keeps a genuine
 * loop detectable while refusing to fire on a couple of stray emotional clips
 * in an otherwise topical feed.
 */
export const MIN_CHARGED_SAMPLE = 5;

// A baseline-free streak trigger ("N in a row fires regardless") was designed,
// built, and removed here. Recording why, because it is an appealing idea that
// will be proposed again.
//
// The pitch was that dominance structurally misses a loop for someone whose
// feed already leans one way: their baseline is high, so an unbroken run stays
// "within baseline". That is true, and it is not a gap — it is the decision
// this module exists to make. A user whose ordinary diet is 70% sad content
// hits nine-in-a-row constantly by chance, and flagging them is precisely the
// lecture the baseline comparison was built to prevent.
//
// Making the required length scale with the user's own rate was tried next.
// It works in principle, but satisfying the existing invariants forces the
// surprise threshold below 0.5^15 — at which point the rule fires for nobody
// the dominance rule was not already going to catch, and the constant is being
// fitted to the test fixtures rather than to anything real.
//
// The streak length IS recorded on every log row. If a week of review shows
// genuine loops that dominance missed, that data will say so, and the rule can
// be built on evidence instead of on the argument above.

/**
 * Every reason detection can decline to fire, as a runtime list.
 *
 * The union below is derived from this array rather than declared beside it,
 * so anything that must cover all of them — the labels the log table renders,
 * for one — can be typed exhaustively and fail to compile when a reason is
 * added and forgotten. A reason without a label reaches the UI as its raw
 * enum string, and `insufficient-charged-sample` did exactly that: it is the
 * single most common outcome on a real feed, so the most frequent row in the
 * review table was the one nobody had written words for.
 */
export const NOT_DETECTED_REASONS = [
  'insufficient-history',
  'insufficient-window-sample',
  'insufficient-baseline-sample',
  'insufficient-charged-sample',
  'not-dominant',
  'within-baseline',
  'category-not-watched',
] as const;

export type NotDetectedReason = (typeof NOT_DETECTED_REASONS)[number];

/**
 * Which rule fired, when one did.
 *
 * Only `dominance` exists today. The field is here because a log that records
 * *which* rule fired stays readable when a second one is added, where a log
 * that only records "detected" does not — and adding it later would leave
 * every historical row ambiguous.
 */
export type DetectionTrigger = 'dominance';

export interface PatternDetection {
  detected: boolean;
  /** The rule that fired. Null when nothing did. */
  trigger: DetectionTrigger | null;
  /** Length of the current run of the reported category. */
  streak: number;
  /** The dominant category in the recent window, when there is one. */
  category: string | null;
  /** Its share of classified reels in the window, 0–1. */
  share: number;
  /** The user's own trailing share for that category, 0–1. */
  baselineShare: number;
  /** share / baselineShare. Infinity when the baseline share is zero. */
  ratio: number;
  /** Classified reels in the window (charged + topic + neutral). Context only. */
  windowSample: number;
  /** Charged reels in the window — the denominator dominance is measured on. */
  chargedSample: number;
  /** Charged reels the baseline was computed from. */
  baselineSample: number;
  /** Why nothing was flagged. Null when `detected` is true. */
  reason: NotDetectedReason | null;
}

export interface DetectionConfig {
  windowSize: number;
  dominantThreshold: number;
  baselineMultiplier: number;
  watchedCategories: string[];
}

/**
 * Share of each category among CLASSIFIED reels.
 *
 * Unclassified reels are excluded from the denominator rather than counted as
 * a category. Including them would dilute every share by however much of the
 * feed happens to be text-free that day, so the same run of sad reels would
 * or would not trip the threshold depending on how many dance clips sat
 * between them.
 */
export function categoryShares(counts: Record<string, number>): {
  shares: Record<string, number>;
  classified: number;
} {
  let classified = 0;
  for (const [category, n] of Object.entries(counts)) {
    if (category === UNCLASSIFIED) continue;
    classified += n;
  }

  const shares: Record<string, number> = {};
  if (classified > 0) {
    for (const [category, n] of Object.entries(counts)) {
      if (category === UNCLASSIFIED) continue;
      shares[category] = n / classified;
    }
  }
  return { shares, classified };
}

/**
 * Share of each CHARGED category among charged reels only.
 *
 * This is the denominator that makes detection work on a real feed. Most
 * reels are topical (comedy, food, cricket) or neutral — content with no
 * emotional register. Counting those toward the denominator meant a genuine
 * breakup loop of 5-in-15 reels read as 33%, far below any threshold, so the
 * detector was effectively disabled on any normal feed. Asking instead
 * "among the emotional reels, is one register dominating?" is the question
 * actually worth answering, and topics and neutral drop out of it the same
 * way unclassified always has.
 */
export function chargedShares(counts: Record<string, number>): {
  shares: Record<string, number>;
  charged: number;
} {
  let charged = 0;
  for (const [category, n] of Object.entries(counts)) {
    if (isCharged(category)) charged += n;
  }

  const shares: Record<string, number> = {};
  if (charged > 0) {
    for (const [category, n] of Object.entries(counts)) {
      if (isCharged(category)) shares[category] = n / charged;
    }
  }
  return { shares, charged };
}

function countCategories(events: ReelEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const key = event.category ?? UNCLASSIFIED;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * The user's trailing counts per category, pooled across the given days.
 *
 * Pooled rather than averaged per-day so a day with three reels does not
 * carry the same weight as a day with three hundred.
 */
function pooledBaseline(aggregates: DailyAggregate[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const day of aggregates) {
    for (const [category, n] of Object.entries(day.categoryBreakdown)) {
      totals[category] = (totals[category] ?? 0) + n;
    }
  }
  return totals;
}

/**
 * The same counts, each day scaled by how recent it is.
 *
 * Still pooled, so a heavy day outweighs a quiet one — that property is why
 * the baseline is counts-based in the first place, and decay multiplies it
 * rather than replacing it. A day's weight halves every
 * BASELINE_HALF_LIFE_DAYS.
 *
 * `reference` is the moment being judged; ages are measured in whole local
 * days back from it, so a day's weight does not drift over the hours of a
 * session.
 */
function decayedBaseline(
  aggregates: DailyAggregate[],
  reference: number,
): Record<string, number> {
  const todayKey = localDateKey(reference);
  const totals: Record<string, number> = {};

  for (const day of aggregates) {
    const age = daysBetweenKeys(day.date, todayKey);
    // A future-dated aggregate means a clock change, not a prediction. Weight
    // it as today rather than trusting a negative age to behave.
    const weight = Math.pow(0.5, Math.max(0, age) / BASELINE_HALF_LIFE_DAYS);
    for (const [category, n] of Object.entries(day.categoryBreakdown)) {
      totals[category] = (totals[category] ?? 0) + n * weight;
    }
  }
  return totals;
}

/** Whole local days from `fromKey` to `toKey`, both `YYYY-MM-DD`. */
function daysBetweenKeys(fromKey: string, toKey: string): number {
  const from = localDayRange(fromKey).from;
  const to = localDayRange(toKey).from;
  // Rounded because a DST transition leaves a 23- or 25-hour day in the span.
  return Math.round((to - from) / DAY_MS);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function baselineShares(aggregates: DailyAggregate[]): {
  shares: Record<string, number>;
  classified: number;
} {
  return categoryShares(pooledBaseline(aggregates));
}

/**
 * Trailing charged-only shares — the baseline dominance is measured against.
 *
 * The returned `charged` count is deliberately the RAW total, not the decayed
 * one, while the shares come from the decayed counts. The two numbers answer
 * different questions: the shares are "what does this person's emotional diet
 * look like lately", where recency matters, and the count is "is there enough
 * history here to say anything at all", where it does not. Decaying the sample
 * guard would make MIN_BASELINE_SAMPLE mean something different depending on
 * when the reels happened to land.
 */
export function chargedBaselineShares(
  aggregates: DailyAggregate[],
  reference: number = Date.now(),
): {
  shares: Record<string, number>;
  charged: number;
} {
  const { shares } = chargedShares(decayedBaseline(aggregates, reference));
  const { charged } = chargedShares(pooledBaseline(aggregates));
  return { shares, charged };
}

function dominantOf(shares: Record<string, number>): { category: string; share: number } | null {
  let best: { category: string; share: number } | null = null;
  // Object.entries order is insertion order, which is not meaningful here, so
  // ties are broken alphabetically to keep the result deterministic.
  for (const [category, share] of Object.entries(shares).sort(([a], [b]) => a.localeCompare(b))) {
    if (!best || share > best.share) best = { category, share };
  }
  return best;
}

const EMPTY: Omit<PatternDetection, 'reason'> = {
  detected: false,
  trigger: null,
  streak: 0,
  category: null,
  share: 0,
  baselineShare: 0,
  ratio: 0,
  windowSample: 0,
  chargedSample: 0,
  baselineSample: 0,
};

/**
 * Decides whether the recent window is anomalous for this user.
 *
 * `recentEvents` should be the most recent `windowSize` reels; `baselineDays`
 * the daily aggregates the trailing rate is drawn from, excluding today so
 * the current session cannot raise the bar it is being measured against.
 */
export function detectPattern(
  recentEvents: ReelEvent[],
  baselineDays: DailyAggregate[],
  config: DetectionConfig,
  now: number = Date.now(),
): PatternDetection {
  if (baselineDays.length < MIN_BASELINE_DAYS) {
    return { ...EMPTY, reason: 'insufficient-history' };
  }

  const window = recentEvents.slice(0, config.windowSize);
  const counts = countCategories(window);
  const { classified: windowSample } = categoryShares(counts);

  if (windowSample < MIN_WINDOW_SAMPLE) {
    return { ...EMPTY, windowSample, reason: 'insufficient-window-sample' };
  }

  // Dominance is asked of the emotional slice only. Topics and neutral are
  // real content but not what intervention is about, so they leave the
  // denominator just as unclassified always has.
  const { shares, charged: chargedSample } = chargedShares(counts);
  const { shares: baseline, charged: baselineSample } = chargedBaselineShares(baselineDays, now);

  if (baselineSample < MIN_BASELINE_SAMPLE) {
    return {
      ...EMPTY,
      windowSample,
      chargedSample,
      baselineSample,
      reason: 'insufficient-baseline-sample',
    };
  }

  if (chargedSample < MIN_CHARGED_SAMPLE) {
    return {
      ...EMPTY,
      windowSample,
      chargedSample,
      baselineSample,
      reason: 'insufficient-charged-sample',
    };
  }

  const dominant = dominantOf(shares);
  if (!dominant) {
    return { ...EMPTY, windowSample, chargedSample, baselineSample, reason: 'not-dominant' };
  }

  const baselineShare = baseline[dominant.category] ?? 0;
  // A category absent from the baseline is infinitely above it. Reported as
  // Infinity rather than clamped so the log shows what actually happened.
  const ratio = baselineShare > 0 ? dominant.share / baselineShare : Infinity;

  const base = {
    trigger: null,
    // Carried on every row, fired or not: it is the evidence a streak-based
    // rule would have to be justified from. See the note above.
    streak: currentStreak(recentEvents, dominant.category),
    category: dominant.category,
    share: dominant.share,
    baselineShare,
    ratio,
    windowSample,
    chargedSample,
    baselineSample,
  };

  if (dominant.share < config.dominantThreshold) {
    return { ...base, detected: false, reason: 'not-dominant' };
  }

  // Checked after dominance so the log records how far above baseline an
  // unwatched category ran, which is what tells you whether the watched list
  // is set sensibly.
  if (!config.watchedCategories.includes(dominant.category)) {
    return { ...base, detected: false, reason: 'category-not-watched' };
  }

  if (ratio < config.baselineMultiplier) {
    return { ...base, detected: false, reason: 'within-baseline' };
  }

  return { ...base, detected: true, trigger: 'dominance', reason: null };
}

/**
 * Length of the current run of consecutive reels in `category`, counting back
 * from the most recent.
 *
 * Unclassified reels neither extend nor break a run: a text-free clip in the
 * middle of a stretch of breakup content is not evidence the stretch ended,
 * and treating it as a break would make streaks depend on how much of the
 * feed happens to be readable.
 */
export function currentStreak(recentEvents: ReelEvent[], category: string): number {
  let streak = 0;
  for (const event of recentEvents) {
    if (event.category === category) streak++;
    else if (event.category !== null) break;
  }
  return streak;
}
