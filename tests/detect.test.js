import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  closeDB,
  getDetectionLog,
  putDailyAggregate,
  recordReelView,
} from '../src/background/db.ts';
import { runDetection } from '../src/background/detect.ts';
import { DEFAULT_SETTINGS } from '../src/shared/defaults.ts';
import { MIN_BASELINE_DAYS } from '../src/shared/patterns.ts';
import { localDateKey, startOfLocalDayBefore } from '../src/shared/time.ts';

globalThis.chrome = {
  storage: { local: { async get() { return {}; }, async set() {} } },
};

const NOW = new Date(2026, 7, 20, 15, 0, 0).getTime();

let nextId = 0;
// Advances across calls so successive seed batches are strictly newer than
// earlier ones, and "most recent N" means what the test intends.
let clock = 0;

async function seedRecentReels(category, count) {
  for (let i = 0; i < count; i++) {
    const startedAt = clock;
    clock += 10_000;
    await recordReelView(
      {
        id: `e${nextId++}`,
        reelShortcode: 'abc',
        sessionId: 'session-1',
        startedAt,
        endedAt: startedAt + 5000,
        watchDurationMs: 5000,
        captionText: null,
        hashtags: [],
        audioName: null,
      },
      category ? { category, confidence: 0.9, subtags: [] } : null,
    );
  }
}

/** Baseline days ending yesterday, which is the range detection reads. */
async function seedBaseline(breakdown, dayCount = MIN_BASELINE_DAYS) {
  for (let i = 1; i <= dayCount; i++) {
    await putDailyAggregate({
      date: localDateKey(startOfLocalDayBefore(NOW, i)),
      totalReels: Object.values(breakdown).reduce((a, b) => a + b, 0),
      totalMinutes: 5,
      avgReelsPerSec: 0.2,
      longestBingeMs: 60_000,
      categoryBreakdown: breakdown,
    });
  }
}

beforeEach(async () => {
  nextId = 0;
  clock = NOW - 60 * 60 * 1000;
  await closeDB();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('doomscroll');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});

describe('runDetection', () => {
  it('logs every evaluation, including the ones that do not fire', async () => {
    await seedRecentReels('joyful', 10);
    await runDetection('session-1', DEFAULT_SETTINGS, NOW);

    const log = await getDetectionLog();
    expect(log).toHaveLength(1);
    expect(log[0].detected).toBe(false);
    expect(log[0].reason).toBe('insufficient-history');
  });

  it('fires once there is a baseline and the window is anomalous', async () => {
    await seedBaseline({ joyful: 40, sad: 8 });
    await seedRecentReels('sad', 15);

    const detection = await runDetection('session-1', DEFAULT_SETTINGS, NOW);

    expect(detection.detected).toBe(true);
    expect(detection.category).toBe('sad');

    const [entry] = await getDetectionLog();
    expect(entry.detected).toBe(true);
    expect(entry.streak).toBe(15);
    expect(entry.ratio).toBeGreaterThan(1);
  });

  it('records wouldHaveActed as false while intervention is off', async () => {
    // The default. Log-only means the decision is recorded and nothing else.
    await seedBaseline({ joyful: 40, sad: 8 });
    await seedRecentReels('sad', 15);

    await runDetection('session-1', DEFAULT_SETTINGS, NOW);

    const [entry] = await getDetectionLog();
    expect(entry.detected).toBe(true);
    expect(entry.wouldHaveActed).toBe(false);
  });

  it('records wouldHaveActed once intervention is enabled', async () => {
    await seedBaseline({ joyful: 40, sad: 8 });
    await seedRecentReels('sad', 15);

    await runDetection('session-1', { ...DEFAULT_SETTINGS, interventionEnabled: true }, NOW);

    const [entry] = await getDetectionLog();
    expect(entry.wouldHaveActed).toBe(true);
  });

  it('excludes today from the baseline', async () => {
    // Today's own bingeing must not raise the bar it is measured against.
    await putDailyAggregate({
      date: localDateKey(NOW),
      totalReels: 500,
      totalMinutes: 60,
      avgReelsPerSec: 0.2,
      longestBingeMs: 60_000,
      categoryBreakdown: { sad: 500 },
    });
    await seedBaseline({ joyful: 40, sad: 8 });
    await seedRecentReels('sad', 15);

    const detection = await runDetection('session-1', DEFAULT_SETTINGS, NOW);

    // Had today counted, the sad baseline would swamp the signal.
    expect(detection.detected).toBe(true);
    expect(detection.baselineShare).toBeLessThan(0.5);
  });

  it('collapses an unbroken run of the same outcome into one row', async () => {
    // Detection runs per reel; at a real pace that is a dozen checks a
    // minute. Without this a single session buries the whole log view.
    await seedBaseline({ joyful: 40, sad: 8 });
    await seedRecentReels('sad', 15);

    for (let i = 0; i < 12; i++) {
      await runDetection('session-1', DEFAULT_SETTINGS, NOW + i * 1000);
    }

    const log = await getDetectionLog();
    expect(log).toHaveLength(1);
    expect(log[0].occurrences).toBe(12);
    expect(log[0].at).toBe(NOW);
    expect(log[0].lastAt).toBe(NOW + 11_000);
  });

  it('starts a new row when the outcome changes', async () => {
    await seedBaseline({ joyful: 40, sad: 8 });
    await seedRecentReels('sad', 15);
    await runDetection('session-1', DEFAULT_SETTINGS, NOW);

    // Flood the window with joyful so the dominant category flips.
    await seedRecentReels('joyful', 20);
    await runDetection('session-1', DEFAULT_SETTINGS, NOW + 1000);

    const log = await getDetectionLog();
    expect(log).toHaveLength(2);
    expect(log[0].category).toBe('joyful');
    expect(log[1].category).toBe('sad');
  });

  it('does not merge across sessions', async () => {
    await seedBaseline({ joyful: 40, sad: 8 });
    await seedRecentReels('sad', 15);

    await runDetection('session-1', DEFAULT_SETTINGS, NOW);
    await runDetection('session-2', DEFAULT_SETTINGS, NOW + 1000);

    expect(await getDetectionLog()).toHaveLength(2);
  });

  it('refreshes the numbers on a collapsed row', async () => {
    // The row should describe the run's current state, not its first check.
    await seedBaseline({ joyful: 40, sad: 8 });
    await seedRecentReels('sad', 8);
    await runDetection('session-1', DEFAULT_SETTINGS, NOW);
    const [first] = await getDetectionLog();

    await seedRecentReels('sad', 7);
    await runDetection('session-1', DEFAULT_SETTINGS, NOW + 1000);
    const [updated] = await getDetectionLog();

    expect(updated.id).toBe(first.id);
    expect(updated.streak).toBeGreaterThan(first.streak);
  });

  it('respects a configured window size', async () => {
    await seedBaseline({ joyful: 40, sad: 8 });
    await seedRecentReels('joyful', 30);
    await seedRecentReels('sad', 10);

    const detection = await runDetection(
      'session-1',
      { ...DEFAULT_SETTINGS, patternWindowSize: 10 },
      NOW,
    );

    expect(detection.windowSample).toBe(10);
    expect(detection.category).toBe('sad');
  });
});

describe('logged context, never acted on', () => {
  it('records the scrolling pace across the window', async () => {
    // Seeded 10s apart, so the pace is 0.1 reels/sec.
    await seedRecentReels('sad', 10);
    await runDetection('session-1', DEFAULT_SETTINGS, NOW);

    const [entry] = await getDetectionLog();
    expect(entry.pacePerSec).toBeCloseTo(0.1, 2);
  });

  it('records the local hour of the check', async () => {
    await seedRecentReels('sad', 10);
    await runDetection('session-1', DEFAULT_SETTINGS, NOW);

    const [entry] = await getDetectionLog();
    expect(entry.hourOfDay).toBe(new Date(NOW).getHours());
  });

  it('reports a pace of zero rather than infinity for a single reel', async () => {
    // Every event shares a timestamp only in degenerate cases, but a log field
    // must never be the thing that throws or serializes as Infinity.
    await seedRecentReels('sad', 1);
    await runDetection('session-1', DEFAULT_SETTINGS, NOW);

    const [entry] = await getDetectionLog();
    expect(entry.pacePerSec).toBe(0);
  });

  it('records a long-horizon baseline alongside the one it decided on', async () => {
    // Sad-heavy recently, calm before that: the two shares should disagree,
    // which is the whole signal — a diet that shifted, versus one that always
    // looked this way.
    await seedBaseline({ sad: 40, joyful: 10 }, 10);
    for (let i = 20; i <= 50; i++) {
      await putDailyAggregate({
        date: localDateKey(startOfLocalDayBefore(NOW, i)),
        totalReels: 50,
        totalMinutes: 5,
        avgReelsPerSec: 0.2,
        longestBingeMs: 60_000,
        categoryBreakdown: { joyful: 45, sad: 5 },
      });
    }
    await seedRecentReels('sad', 15);
    await runDetection('session-1', DEFAULT_SETTINGS, NOW);

    const [entry] = await getDetectionLog();
    expect(entry.category).toBe('sad');
    // Recent fortnight is sad-heavy; the sixty-day view still remembers calm.
    expect(entry.baselineShareLong).toBeLessThan(entry.baselineShare);
  });

  it('matches the two baselines when the diet has been stable', async () => {
    await seedBaseline({ sad: 20, joyful: 30 }, 40);
    await seedRecentReels('sad', 15);
    await runDetection('session-1', DEFAULT_SETTINGS, NOW);

    const [entry] = await getDetectionLog();
    expect(entry.baselineShareLong).toBeCloseTo(entry.baselineShare, 2);
  });
});
