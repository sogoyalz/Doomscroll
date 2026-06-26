// Pure aggregation functions: records in, stats out. No chrome.* calls here
// so this module is trivially unit-testable.

import { MOOD_BUCKET_ORDER, bucketForMood } from '../classification/rules.js';

export const MOOD_KEYS = [
  'happy',
  'calm',
  'sad',
  'angry',
  'funny',
  'romantic',
  'motivational',
  'fitness',
  'educational',
  'music',
  'food',
  'gaming',
  'undetectable',
];

const MIN_SANE_MS = 1_000;
const MAX_SANE_MS = 10 * 60_000;

// A binge is a run of reels with no gap longer than this between consecutive watches.
const BINGE_GAP_MS = 2 * 60 * 1000;

export const TIME_RANGES = ['today', 'week', 'all'];

export function sanitizeRecords(records) {
  return (records || []).map((r) => ({
    ...r,
    watchedMs: Number(r.watchedMs) || 0,
    ts: Number(r.ts ?? r.time) || 0,
    mood: r.mood || 'undetectable',
    caption: r.caption || '',
  }));
}

export function filterSane(records) {
  return records.filter((r) => r.watchedMs >= MIN_SANE_MS && r.watchedMs <= MAX_SANE_MS);
}

export function filterByRange(records, range, now = Date.now()) {
  if (range === 'all') return records;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === 'today') {
    return records.filter((r) => r.ts >= start.getTime());
  }
  if (range === 'week') {
    const weekStart = start.getTime() - 6 * 24 * 60 * 60 * 1000;
    return records.filter((r) => r.ts >= weekStart);
  }
  return records;
}

export function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function countByMood(records) {
  const counts = Object.fromEntries(MOOD_KEYS.map((m) => [m, 0]));
  for (const r of records) counts[r.mood] = (counts[r.mood] ?? 0) + 1;
  return counts;
}

export function topMood(counts) {
  return Object.entries(counts).reduce((best, [mood, n]) => (n > best.n ? { mood, n } : best), {
    mood: 'undetectable',
    n: 0,
  });
}

export function countsInWindow(records, now, windowMs) {
  return records.filter((r) => now - r.ts <= windowMs).length;
}

// Top N mood categories by count, excluding "undetectable" (used for the
// popup's "By type" bars).
export function topCategories(counts, limit = 4) {
  return Object.entries(counts)
    .filter(([mood]) => mood !== 'undetectable')
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([mood, count]) => ({ mood, count }));
}

// Groups mood counts into the 4 high-level buckets (hype/chill/emotional/neutral).
export function countByMoodBucket(records) {
  const counts = Object.fromEntries(MOOD_BUCKET_ORDER.map((b) => [b, 0]));
  for (const r of records) {
    const bucket = bucketForMood(r.mood);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

export function moodBucketPercentages(records) {
  const counts = countByMoodBucket(records);
  const total = records.length;
  return MOOD_BUCKET_ORDER.map((bucket) => ({
    bucket,
    count: counts[bucket],
    pct: total ? Math.round((counts[bucket] / total) * 100) : 0,
  }));
}

// Longest run of reels watched back-to-back with no gap over BINGE_GAP_MS,
// measured from the first reel's start to the last reel's end in the run.
export function longestBinge(records) {
  if (!records.length) return 0;
  const sorted = [...records].sort((a, b) => a.ts - b.ts);

  let longest = 0;
  let runStart = sorted[0].ts - sorted[0].watchedMs;
  let runEnd = sorted[0].ts;

  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    const reelStart = r.ts - r.watchedMs;
    if (reelStart - runEnd <= BINGE_GAP_MS) {
      runEnd = r.ts;
    } else {
      longest = Math.max(longest, runEnd - runStart);
      runStart = reelStart;
      runEnd = r.ts;
    }
  }
  longest = Math.max(longest, runEnd - runStart);
  return longest;
}

export function recentRecords(records, limit = 3) {
  return [...records].sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export function buildSummary(rawRecords, now = Date.now()) {
  const records = sanitizeRecords(rawRecords);
  const sane = filterSane(records);
  const watchTimes = sane.map((r) => r.watchedMs);
  const counts = countByMood(records);
  const { mood, n } = topMood(counts);

  return {
    total: records.length,
    last1m: countsInWindow(records, now, 60 * 1000),
    last1h: countsInWindow(records, now, 60 * 60 * 1000),
    last24h: countsInWindow(records, now, 24 * 60 * 60 * 1000),
    meanWatchMs: mean(watchTimes),
    medianWatchMs: median(watchTimes),
    moodCounts: counts,
    topMood: mood,
    topMoodPct: records.length ? Math.round((n / records.length) * 100) : 0,
  };
}

// Full dashboard payload for the popup UI: headline stat, by-type bars,
// mood pills, and a recent-reels list, all scoped to a time range.
export function buildDashboard(rawRecords, range = 'all', now = Date.now()) {
  const all = sanitizeRecords(rawRecords);
  const records = filterByRange(all, range, now);
  const sane = filterSane(records);
  const watchTimes = sane.map((r) => r.watchedMs);

  const counts = countByMood(records);
  const totalWatchedMs = sane.reduce((sum, r) => sum + r.watchedMs, 0);

  return {
    range,
    totalReels: records.length,
    totalWatchedMs,
    longestBingeMs: longestBinge(sane),
    avgWatchMs: mean(watchTimes),
    medianWatchMs: median(watchTimes),
    byType: topCategories(counts),
    moodBuckets: moodBucketPercentages(records),
    recent: recentRecords(records),
  };
}
