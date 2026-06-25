import {
  sanitizeRecords, filterSane, mean, median, countByMood, topMood, buildSummary,
} from '../src/lib/stats.js';

describe('sanitizeRecords', () => {
  test('coerces numeric fields and defaults mood', () => {
    const out = sanitizeRecords([{ watchedMs: '1500', ts: '100', mood: '' }]);
    expect(out[0]).toMatchObject({ watchedMs: 1500, ts: 100, mood: 'undetectable' });
  });
});

describe('filterSane', () => {
  test('keeps only records within 1s..10min', () => {
    const out = filterSane([
      { watchedMs: 500 },
      { watchedMs: 5000 },
      { watchedMs: 700_000 },
    ]);
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
