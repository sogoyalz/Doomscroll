// Pure aggregation functions: records in, stats out. No chrome.* calls here
// so this module is trivially unit-testable.

export const MOOD_KEYS = [
  'happy', 'calm', 'sad', 'angry', 'funny', 'romantic',
  'motivational', 'fitness', 'educational', 'music', 'food', 'gaming', 'undetectable',
];

const MIN_SANE_MS = 1_000;
const MAX_SANE_MS = 10 * 60_000;

export function sanitizeRecords(records) {
  return (records || []).map((r) => ({
    ...r,
    watchedMs: Number(r.watchedMs) || 0,
    ts: Number(r.ts ?? r.time) || 0,
    mood: r.mood || 'undetectable',
  }));
}

export function filterSane(records) {
  return records.filter((r) => r.watchedMs >= MIN_SANE_MS && r.watchedMs <= MAX_SANE_MS);
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
  return Object.entries(counts).reduce(
    (best, [mood, n]) => (n > best.n ? { mood, n } : best),
    { mood: 'undetectable', n: 0 },
  );
}

export function countsInWindow(records, now, windowMs) {
  return records.filter((r) => now - r.ts <= windowMs).length;
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
