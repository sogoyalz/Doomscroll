import { describe, test, expect } from 'vitest';
import {
  sanitizeRecords,
  filterSane,
  filterByRange,
  mean,
  median,
  countByMood,
  topMood,
  topCategories,
  countByMoodBucket,
  moodBucketPercentages,
  longestBinge,
  recentRecords,
  buildSummary,
  buildDashboard,
} from '../src/lib/stats.js';

describe('sanitizeRecords', () => {
  test('coerces numeric fields and defaults mood', () => {
    const out = sanitizeRecords([{ watchedMs: '1500', ts: '100', mood: '' }]);
    expect(out[0]).toMatchObject({ watchedMs: 1500, ts: 100, mood: 'undetectable' });
  });
});

describe('filterSane', () => {
  test('keeps only records within 1s..10min', () => {
    const out = filterSane([{ watchedMs: 500 }, { watchedMs: 5000 }, { watchedMs: 700_000 }]);
    expect(out).toEqual([{ watchedMs: 5000 }]);
  });
});

describe('mean / median', () => {
  test('mean of empty array is 0', () => {
    expect(mean([])).toBe(0);
  });
  test('mean and median of values', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('countByMood / topMood', () => {
  test('counts records per mood bucket', () => {
    const counts = countByMood([{ mood: 'happy' }, { mood: 'happy' }, { mood: 'sad' }]);
    expect(counts.happy).toBe(2);
    expect(counts.sad).toBe(1);
  });

  test('topMood picks the highest count', () => {
    const counts = { happy: 2, sad: 5, calm: 1 };
    expect(topMood(counts)).toEqual({ mood: 'sad', n: 5 });
  });
});

describe('buildSummary', () => {
  test('aggregates totals and time windows', () => {
    const now = 1_000_000;
    const records = [
      { watchedMs: 2000, ts: now - 500, mood: 'happy' },
      { watchedMs: 3000, ts: now - 2 * 60 * 1000, mood: 'sad' },
      { watchedMs: 4000, ts: now - 25 * 60 * 60 * 1000, mood: 'calm' },
    ];
    const summary = buildSummary(records, now);
    expect(summary.total).toBe(3);
    expect(summary.last1m).toBe(1);
    expect(summary.last1h).toBe(2);
    expect(summary.last24h).toBe(2);
    expect(summary.topMood).toBeDefined();
  });
});

describe('filterByRange', () => {
  const now = new Date('2026-06-25T15:00:00').getTime();
  const startOfToday = new Date('2026-06-25T00:00:00').getTime();
  const records = [
    { ts: now - 1000 }, // earlier today
    { ts: startOfToday - 1000 }, // yesterday, within the week
    { ts: now - 10 * 24 * 60 * 60 * 1000 }, // 10 days ago, outside the week
  ];

  test('"today" keeps only records since local midnight', () => {
    expect(filterByRange(records, 'today', now)).toHaveLength(1);
  });

  test('"week" keeps the last 7 days', () => {
    expect(filterByRange(records, 'week', now)).toHaveLength(2);
  });

  test('"all" returns every record', () => {
    expect(filterByRange(records, 'all', now)).toHaveLength(3);
  });
});

describe('topCategories', () => {
  test('excludes undetectable and sorts by count desc', () => {
    const counts = { happy: 2, sad: 5, calm: 1, undetectable: 9 };
    expect(topCategories(counts, 2)).toEqual([
      { mood: 'sad', count: 5 },
      { mood: 'happy', count: 2 },
    ]);
  });
});

describe('countByMoodBucket / moodBucketPercentages', () => {
  test('groups moods into hype/chill/emotional/neutral buckets', () => {
    const records = [
      { mood: 'funny' },
      { mood: 'calm' },
      { mood: 'happy' },
      { mood: 'undetectable' },
    ];
    const counts = countByMoodBucket(records);
    expect(counts).toEqual({ hype: 1, chill: 1, emotional: 1, neutral: 1 });
  });

  test('computes percentages per bucket', () => {
    const records = [
      { mood: 'funny' },
      { mood: 'motivational' },
      { mood: 'calm' },
      { mood: 'happy' },
    ];
    const pcts = moodBucketPercentages(records);
    expect(pcts.find((p) => p.bucket === 'hype').pct).toBe(50);
    expect(pcts.find((p) => p.bucket === 'chill').pct).toBe(25);
  });
});

describe('longestBinge', () => {
  test('returns 0 for no records', () => {
    expect(longestBinge([])).toBe(0);
  });

  test('merges reels watched back-to-back into one binge', () => {
    const records = [
      { ts: 10_000, watchedMs: 5000 }, // 5s..10s
      { ts: 20_000, watchedMs: 5000 }, // 15s..20s, gap 5s <= BINGE_GAP_MS
    ];
    expect(longestBinge(records)).toBe(15_000); // 5s -> 20s
  });

  test('splits runs separated by a large gap', () => {
    const records = [
      { ts: 10_000, watchedMs: 5000 },
      { ts: 10_000 + 10 * 60 * 1000, watchedMs: 5000 },
    ];
    expect(longestBinge(records)).toBe(5000);
  });
});

describe('recentRecords', () => {
  test('returns the most recent N records, newest first', () => {
    const records = [{ ts: 1 }, { ts: 3 }, { ts: 2 }];
    expect(recentRecords(records, 2)).toEqual([{ ts: 3 }, { ts: 2 }]);
  });
});

describe('buildDashboard', () => {
  test('assembles headline stats, type bars, mood pills, and recent list', () => {
    const now = 1_000_000;
    const records = [
      { watchedMs: 5000, ts: now - 1000, mood: 'funny', caption: 'lol' },
      { watchedMs: 3000, ts: now - 2000, mood: 'funny', caption: 'haha' },
    ];
    const dashboard = buildDashboard(records, 'all', now);
    expect(dashboard.totalReels).toBe(2);
    expect(dashboard.totalWatchedMs).toBe(8000);
    expect(dashboard.byType[0]).toEqual({ mood: 'funny', count: 2 });
    expect(dashboard.recent).toHaveLength(2);
  });
});
