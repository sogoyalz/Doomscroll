// Read-only views over stored history, for the dashboard.
//
// Pure, like aggregation.ts, and for the same reason: the numbers a user makes
// decisions about should be testable without a browser.
//
// Nothing here feeds detection. These are answers to "what has my feed been
// doing", which is a different question from "is it doing something unusual
// right now" — and deliberately allowed to be looser, because a chart is read
// by a person who can see the sample size, where a detector acts on its own.

import { UNCLASSIFIED } from './aggregation.js';
import { CHARGED_CATEGORIES, isCharged } from './taxonomy.js';
import type { DailyAggregate, ReelEvent, Session } from './types.js';

export interface DayShare {
  date: string;
  /** Charged reels as a share of classified ones, 0–1. */
  share: number;
  /** Classified reels behind it — the denominator, so thin days can be marked. */
  classified: number;
}

/**
 * Charged share per day, oldest first.
 *
 * The denominator is classified reels, not all of them: a day where half the
 * feed had no readable text would otherwise show a suppressed charged share
 * for a reason that has nothing to do with the content.
 *
 * Days with nothing classified are kept, at a share of zero and a sample of
 * zero. Dropping them would silently close the gap and turn a week away from
 * the app into a continuous line, which is exactly the wrong impression.
 */
export function chargedShareByDay(days: DailyAggregate[]): DayShare[] {
  return [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      let charged = 0;
      let classified = 0;
      for (const [category, n] of Object.entries(day.categoryBreakdown)) {
        if (category === UNCLASSIFIED) continue;
        classified += n;
        if (isCharged(category)) charged += n;
      }
      return { date: day.date, share: classified ? charged / classified : 0, classified };
    });
}

/**
 * Below this many classified reels, a day's share is too noisy to draw as a
 * finding. Charted differently rather than hidden — the day still happened,
 * and a gap in the line would imply no scrolling rather than little to read.
 */
export const THIN_DAY_SAMPLE = 5;

/**
 * Axis ceiling for the trend chart.
 *
 * Two fixed scales rather than one continuously fitted to the data. Fitting
 * the axis to whatever is present makes an ordinary, steady month look as
 * dramatic as a real climb — the shape of the line would carry no information
 * at all. A full 0–100% axis is the other failure: charged share realistically
 * lives well under half, so it squeezes every real movement into a few pixels.
 *
 * So: half scale normally, full scale only when a day genuinely exceeds it.
 */
export const HALF_SCALE = 0.5;

/**
 * Believable days needed before a trend is drawn or quoted.
 *
 * Owned here rather than in the chart because two callers depend on it: the
 * chart decides whether to render, and the popup decides whether to show the
 * section around it. Split across both files they drifted apart, and the
 * section rendered a headline percentage above an empty space where the chart
 * had declined to draw.
 */
export const MIN_TREND_POINTS = 3;

export interface TrendPlan {
  /** Days believable enough to draw as values, oldest first. */
  plotted: DayShare[];
  /** Days with too little readable content to assert a number for. */
  thin: DayShare[];
  /** Whether there is enough here to draw, or to quote a number from. */
  drawable: boolean;
  ceiling: number;
  /** Mean share across the believable days. */
  average: number;
}

/**
 * What the trend chart should draw.
 *
 * Days with almost nothing readable are deliberately excluded from the line.
 * With one classified reel a "share" is 0% or 100% and neither is a
 * measurement — plotted, a single reel becomes a spike taller than any real
 * movement on the chart, which is the exact misreading the chart exists to
 * prevent. They are returned separately so the day can still be marked as
 * having happened.
 */
export function planTrend(days: DayShare[]): TrendPlan {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const plotted = ordered.filter((d) => d.classified >= THIN_DAY_SAMPLE);
  const thin = ordered.filter((d) => d.classified < THIN_DAY_SAMPLE);

  return {
    plotted,
    thin,
    drawable: plotted.length >= MIN_TREND_POINTS,
    ceiling: plotted.some((d) => d.share > HALF_SCALE) ? 1 : HALF_SCALE,
    average: plotted.length
      ? plotted.reduce((sum, d) => sum + d.share, 0) / plotted.length
      : 0,
  };
}

/** The aggregated topic band. Not a category — see stackByDay. */
export const TOPICS_BAND = 'topics';

export interface StackBand {
  /** A charged category, TOPICS_BAND, 'neutral', or UNCLASSIFIED. */
  key: string;
  /** Share of the day's total reels, 0–1. */
  share: number;
  count: number;
}

export interface DayStack {
  date: string;
  bands: StackBand[];
  totalReels: number;
  /** Too few reels for the composition to mean much. */
  thin: boolean;
}

/**
 * Band order, bottom of the bar upward, fixed across every day.
 *
 * Fixed because a stacked bar whose bands reorder per day is unreadable — the
 * eye tracks a band's thickness across the series, and that only works if it
 * is in the same place. Charged categories sit at the bottom for the same
 * reason: a band is only comparable day to day if it starts from a common
 * edge, and those are the ones worth comparing.
 */
export const BAND_ORDER: readonly string[] = [
  ...CHARGED_CATEGORIES,
  TOPICS_BAND,
  'neutral',
  UNCLASSIFIED,
];

/**
 * Which band a category belongs to.
 *
 * Shared by the per-day bars and the session summary so the two cannot drift
 * into showing the same feed differently.
 */
function bandKeyFor(category: string): string {
  if (isCharged(category) || category === 'neutral' || category === UNCLASSIFIED) return category;
  return TOPICS_BAND;
}

/**
 * Each day's composition, as bands of a full-height bar.
 *
 * The thirteen topic categories collapse into one band rather than being drawn
 * individually. Twenty-one stacked colours is not a chart, it is a texture —
 * no reader distinguishes `pets` from `art` from `gaming` in a four-pixel
 * sliver, and the attempt costs the legibility of the bands that matter. This
 * mirrors the taxonomy's own split: charged registers are the finding, topics
 * are context, and the palette already draws them saturated versus muted for
 * exactly that reason.
 *
 * The denominator is the day's TOTAL reels, unreadable ones included. The
 * no-text portion is a real part of what was watched, and hiding it would let
 * a day that was mostly unreadable present as confidently as one that was not.
 */
export function stackByDay(days: DailyAggregate[]): DayStack[] {
  return [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      const counts = new Map<string, number>();
      let total = 0;

      for (const [category, n] of Object.entries(day.categoryBreakdown)) {
        const key = bandKeyFor(category);
        counts.set(key, (counts.get(key) ?? 0) + n);
        total += n;
      }

      const bands = BAND_ORDER.filter((key) => (counts.get(key) ?? 0) > 0).map((key) => {
        const count = counts.get(key)!;
        return { key, count, share: total ? count / total : 0 };
      });

      return {
        date: day.date,
        bands,
        totalReels: total,
        // Same threshold as the trend chart, against total rather than
        // classified reels: three reels normalized to a full-height bar reads
        // as confidently as three hundred, and it should not.
        thin: total < THIN_DAY_SAMPLE,
      };
    });
}

export interface Run {
  category: string;
  length: number;
  /** Index in the event sequence where the run begins. */
  startIndex: number;
}

/**
 * Contiguous runs of one category through a session, in order.
 *
 * Unclassified reels neither extend nor break a run, matching
 * `currentStreak` in patterns.ts — a text-free clip in the middle of a stretch
 * of breakup content is not evidence the stretch ended, and counting it as a
 * break would make runs depend on how much of the feed happened to be
 * readable. The two must agree: this is the view of the same thing the
 * detector acts on, and a drill-down that disagreed with the log would be
 * worse than no drill-down.
 */
export function runsOf(events: ReelEvent[]): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;

  for (const [index, event] of events.entries()) {
    const category = event.category;
    if (category === null) continue;

    if (current && current.category === category) current.length++;
    else {
      if (current) runs.push(current);
      current = { category, length: 1, startIndex: index };
    }
  }

  if (current) runs.push(current);
  return runs;
}

/** The longest run of a charged category, which is what detection acts on. */
export function longestChargedRun(events: ReelEvent[]): Run | null {
  let best: Run | null = null;
  for (const run of runsOf(events)) {
    if (!isCharged(run.category)) continue;
    if (!best || run.length > best.length) best = run;
  }
  return best;
}

export interface SessionSummary {
  id: string;
  startedAt: number;
  endedAt: number;
  reelCount: number;
  totalDurationMs: number;
  /** Composition, same banding as the per-day bars. */
  bands: StackBand[];
  /** Longest unbroken run of one emotional register, if any. */
  longestRun: Run | null;
}

/**
 * A session, described the way the detector would see it.
 *
 * `reelCount` comes from the events rather than the stored session record.
 * The two normally agree, but the record is a running total maintained across
 * writes while this is derived from what is actually still stored — and after
 * a prune the events are the truth.
 */
export function summarizeSession(session: Session, events: ReelEvent[]): SessionSummary {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = bandKeyFor(event.category ?? UNCLASSIFIED);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = events.length;
  const bands = BAND_ORDER.filter((key) => (counts.get(key) ?? 0) > 0).map((key) => {
    const count = counts.get(key)!;
    return { key, count, share: total ? count / total : 0 };
  });

  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    reelCount: total,
    totalDurationMs: events.reduce((sum, e) => sum + e.watchDurationMs, 0),
    bands,
    longestRun: longestChargedRun(events),
  };
}

export interface AuthorStat {
  author: string;
  reels: number;
  watchMs: number;
  /** Charged share among this author's classified reels, 0–1. */
  chargedShare: number;
  classified: number;
}

export interface AuthorBreakdown {
  authors: AuthorStat[];
  /** Events carrying an author handle. */
  attributed: number;
  /** Events with no handle — recorded before it was captured, or unresolved. */
  unattributed: number;
}

/**
 * Watch time and emotional mix per creator.
 *
 * `unattributed` is returned rather than quietly excluded because it is the
 * honest caveat on the whole view: author handles were only stored from a
 * certain point on, so early history contributes nothing here and a table that
 * did not say so would understate long-standing creators.
 */
export function authorBreakdown(events: ReelEvent[], limit = 10): AuthorBreakdown {
  const byAuthor = new Map<string, { reels: number; watchMs: number; charged: number; classified: number }>();
  let attributed = 0;
  let unattributed = 0;

  for (const event of events) {
    const author = event.authorHandle;
    if (!author) {
      unattributed++;
      continue;
    }
    attributed++;

    const row = byAuthor.get(author) ?? { reels: 0, watchMs: 0, charged: 0, classified: 0 };
    row.reels++;
    row.watchMs += event.watchDurationMs;
    if (event.category) {
      row.classified++;
      if (isCharged(event.category)) row.charged++;
    }
    byAuthor.set(author, row);
  }

  const authors = [...byAuthor.entries()]
    .map(([author, row]) => ({
      author,
      reels: row.reels,
      watchMs: row.watchMs,
      classified: row.classified,
      chargedShare: row.classified ? row.charged / row.classified : 0,
    }))
    // By watch time, not reel count: thirty seconds on one creator says more
    // than five reels flicked past in as many seconds.
    .sort((a, b) => b.watchMs - a.watchMs || a.author.localeCompare(b.author))
    .slice(0, limit);

  return { authors, attributed, unattributed };
}
