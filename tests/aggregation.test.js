import { describe, it, expect } from 'vitest';
import {
  aggregateDay,
  categoryBreakdown,
  groupByLocalDay,
  longestBingeMs,
  UNCLASSIFIED,
  DEFAULT_BINGE_GAP_MS,
} from '../src/shared/aggregation.ts';
import { localDateKey } from '../src/shared/time.ts';

const MINUTE = 60_000;

let nextId = 0;

function ev({ startedAt, durationMs = 5000, category = null }) {
  return {
    id: `e${nextId++}`,
    reelShortcode: 'abc',
    sessionId: 's1',
    startedAt,
    endedAt: startedAt + durationMs,
    watchDurationMs: durationMs,
    captionText: null,
    hashtags: [],
    audioName: null,
    category,
    categoryConfidence: category ? 0.9 : null,
    subtags: [],
  };
}

describe('longestBingeMs', () => {
  it('is zero with no events', () => {
    expect(longestBingeMs([])).toBe(0);
  });

  it('measures a single reel start to end', () => {
    expect(longestBingeMs([ev({ startedAt: 0, durationMs: 4000 })])).toBe(4000);
  });

  it('merges reels separated by less than the gap', () => {
    const events = [
      ev({ startedAt: 0, durationMs: 5000 }),
      ev({ startedAt: 6000, durationMs: 5000 }),
    ];
    // First start (0) to last end (11000).
    expect(longestBingeMs(events)).toBe(11_000);
  });

  it('breaks the run when the gap is exceeded', () => {
    const events = [
      ev({ startedAt: 0, durationMs: 5000 }),
      ev({ startedAt: 5000 + DEFAULT_BINGE_GAP_MS + 1, durationMs: 3000 }),
    ];
    expect(longestBingeMs(events)).toBe(5000);
  });

  it('returns the longest run, not the last', () => {
    const events = [
      // Short run.
      ev({ startedAt: 0, durationMs: 2000 }),
      // Long run, well after the gap.
      ev({ startedAt: 10 * MINUTE, durationMs: 5000 }),
      ev({ startedAt: 10 * MINUTE + 6000, durationMs: 5000 }),
      // Short run again.
      ev({ startedAt: 60 * MINUTE, durationMs: 1000 }),
    ];
    expect(longestBingeMs(events)).toBe(11_000);
  });

  it('treats a gap exactly at the threshold as continuous', () => {
    const events = [
      ev({ startedAt: 0, durationMs: 1000 }),
      ev({ startedAt: 1000 + DEFAULT_BINGE_GAP_MS, durationMs: 1000 }),
    ];
    expect(longestBingeMs(events)).toBe(1000 + DEFAULT_BINGE_GAP_MS + 1000);
  });

  it('does not depend on input order', () => {
    const a = ev({ startedAt: 0, durationMs: 5000 });
    const b = ev({ startedAt: 6000, durationMs: 5000 });
    expect(longestBingeMs([b, a])).toBe(longestBingeMs([a, b]));
  });

  it('handles overlapping events from two tabs without shrinking the run', () => {
    const events = [
      ev({ startedAt: 0, durationMs: 20_000 }),
      ev({ startedAt: 5000, durationMs: 1000 }),
    ];
    expect(longestBingeMs(events)).toBe(20_000);
  });

  it('honours a custom gap', () => {
    const events = [
      ev({ startedAt: 0, durationMs: 1000 }),
      ev({ startedAt: 3000, durationMs: 1000 }),
    ];
    expect(longestBingeMs(events, 500)).toBe(1000);
    expect(longestBingeMs(events, 5000)).toBe(4000);
  });
});

describe('categoryBreakdown', () => {
  it('counts per category', () => {
    const events = [
      ev({ startedAt: 0, category: 'sad' }),
      ev({ startedAt: 1, category: 'sad' }),
      ev({ startedAt: 2, category: 'joyful' }),
    ];
    expect(categoryBreakdown(events)).toEqual({ sad: 2, joyful: 1 });
  });

  it('buckets unclassified events separately from neutral', () => {
    // Conflating "nothing looked yet" with "looked and found nothing" would
    // let a day of unreadable reels read as a genuinely calm one.
    const events = [ev({ startedAt: 0, category: null }), ev({ startedAt: 1, category: 'neutral' })];
    expect(categoryBreakdown(events)).toEqual({ [UNCLASSIFIED]: 1, neutral: 1 });
  });

  it('is empty for no events', () => {
    expect(categoryBreakdown([])).toEqual({});
  });
});

describe('groupByLocalDay', () => {
  it('splits events across a local midnight boundary', () => {
    const beforeMidnight = new Date(2026, 7, 7, 23, 30).getTime();
    const afterMidnight = new Date(2026, 7, 8, 0, 15).getTime();

    const days = groupByLocalDay([ev({ startedAt: beforeMidnight }), ev({ startedAt: afterMidnight })]);

    expect([...days.keys()].sort()).toEqual(['2026-08-07', '2026-08-08']);
    expect(days.get('2026-08-07')).toHaveLength(1);
  });

  it('keeps same-day events together', () => {
    const morning = new Date(2026, 7, 7, 9, 0).getTime();
    const evening = new Date(2026, 7, 7, 21, 0).getTime();
    const days = groupByLocalDay([ev({ startedAt: morning }), ev({ startedAt: evening })]);

    expect(days.size).toBe(1);
    expect(days.get('2026-08-07')).toHaveLength(2);
  });
});

describe('aggregateDay', () => {
  it('produces zeroed stats for a day with no events', () => {
    expect(aggregateDay('2026-08-07', [])).toEqual({
      date: '2026-08-07',
      totalReels: 0,
      totalMinutes: 0,
      avgReelsPerSec: 0,
      longestBingeMs: 0,
      categoryBreakdown: {},
    });
  });

  it('sums watch time into minutes', () => {
    const events = [
      ev({ startedAt: 0, durationMs: 30_000 }),
      ev({ startedAt: 40_000, durationMs: 30_000 }),
    ];
    expect(aggregateDay('2026-08-07', events).totalMinutes).toBe(1);
  });

  it('reports a higher reels-per-second for faster flicking', () => {
    const slow = [ev({ startedAt: 0, durationMs: 20_000 })];
    const fast = Array.from({ length: 20 }, (_, i) =>
      ev({ startedAt: i * 1000, durationMs: 1000 }),
    );

    expect(aggregateDay('d', fast).avgReelsPerSec).toBeGreaterThan(
      aggregateDay('d', slow).avgReelsPerSec,
    );
    // 20 reels over 20 watched seconds.
    expect(aggregateDay('d', fast).avgReelsPerSec).toBe(1);
  });

  it('avoids dividing by zero when nothing was actually watched', () => {
    const events = [ev({ startedAt: 0, durationMs: 0 })];
    expect(aggregateDay('d', events).avgReelsPerSec).toBe(0);
  });

  it('carries the date key through unchanged', () => {
    const key = localDateKey(new Date(2026, 7, 7, 12).getTime());
    expect(aggregateDay(key, []).date).toBe('2026-08-07');
  });
});
