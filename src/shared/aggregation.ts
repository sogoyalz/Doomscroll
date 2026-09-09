// Pure rollup functions: reel events in, daily stats out.
//
// No chrome.* and no IndexedDB, so the numbers behind the dashboard can be
// unit-tested directly. The orchestration that reads events and persists the
// results lives in background/aggregator.ts.

import type { DailyAggregate, ReelEvent } from './types.js';
import { localDateKey } from './time.js';

/**
 * Bucket for events that have no category yet.
 *
 * Deliberately NOT 'neutral'. Neutral means the classifier looked and found
 * nothing charged; unclassified means nothing has looked yet, or there was no
 * text to look at. Collapsing the two would let a day of unreadable reels
 * masquerade as a genuinely calm one — and would poison the trailing baseline
 * that pattern detection compares against.
 */
export const UNCLASSIFIED = 'unclassified';

/** Reels closer together than this belong to the same binge. */
export const DEFAULT_BINGE_GAP_MS = 2 * 60 * 1000;

/**
 * Longest uninterrupted run of watching, measured from the first reel's start
 * to the last reel's end in the run.
 *
 * A gap longer than `gapMs` between one reel ending and the next starting
 * breaks the run. Wall-clock, so a reel left paused mid-run still counts as
 * time inside the binge — which is the honest reading of "how long was I in
 * this for".
 */
export function longestBingeMs(
  events: ReelEvent[],
  gapMs: number = DEFAULT_BINGE_GAP_MS,
): number {
  if (!events.length) return 0;

  const sorted = [...events].sort((a, b) => a.startedAt - b.startedAt);
  const first = sorted[0]!;

  let longest = 0;
  let runStart = first.startedAt;
  let runEnd = first.endedAt;

  for (let i = 1; i < sorted.length; i++) {
    const event = sorted[i]!;
    if (event.startedAt - runEnd <= gapMs) {
      // Math.max guards overlapping events, which two tabs can produce.
      runEnd = Math.max(runEnd, event.endedAt);
    } else {
      longest = Math.max(longest, runEnd - runStart);
      runStart = event.startedAt;
      runEnd = event.endedAt;
    }
  }

  return Math.max(longest, runEnd - runStart);
}

/** Count of reels per category, with unclassified tracked separately. */
export function categoryBreakdown(events: ReelEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const key = event.category ?? UNCLASSIFIED;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Splits events into local-day buckets keyed `YYYY-MM-DD`. */
export function groupByLocalDay(events: ReelEvent[]): Map<string, ReelEvent[]> {
  const days = new Map<string, ReelEvent[]>();
  for (const event of events) {
    const key = localDateKey(event.startedAt);
    const bucket = days.get(key);
    if (bucket) bucket.push(event);
    else days.set(key, [event]);
  }
  return days;
}

/**
 * Rolls one local day's events into its aggregate.
 *
 * `avgReelsPerSec` is reels divided by seconds actually watched — a measure
 * of how fast the feed is being burned through, where a high number means
 * flicking past reels rather than watching them. It is intentionally not
 * computed over wall-clock time, which would just measure how long the tab
 * sat open.
 */
export function aggregateDay(
  date: string,
  events: ReelEvent[],
  gapMs: number = DEFAULT_BINGE_GAP_MS,
): DailyAggregate {
  const totalMs = events.reduce((sum, e) => sum + e.watchDurationMs, 0);
  const totalSeconds = totalMs / 1000;

  return {
    date,
    totalReels: events.length,
    totalMinutes: totalMs / 60_000,
    avgReelsPerSec: totalSeconds > 0 ? events.length / totalSeconds : 0,
    longestBingeMs: longestBingeMs(events, gapMs),
    categoryBreakdown: categoryBreakdown(events),
  };
}
