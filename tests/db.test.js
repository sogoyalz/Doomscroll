import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  closeDB,
  clearAllData,
  getAllReelEvents,
  getDailyAggregates,
  getDetectionLog,
  getInterventionById,
  getInterventionLog,
  getRecentReelEvents,
  getRecentSessions,
  getSessionEvents,
  getReelEvents,
  getSession,
  pruneOldData,
  putDailyAggregate,
  putDetectionLog,
  putInterventionLog,
  recordReelView,
  RETENTION_DAYS,
} from '../src/background/db.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

let nextId = 0;

function makeEvent(overrides = {}) {
  const startedAt = overrides.startedAt ?? Date.now();
  return {
    id: `event-${nextId++}`,
    reelShortcode: 'SYNTH-00001',
    sessionId: 'session-1',
    startedAt,
    endedAt: startedAt + 5000,
    watchDurationMs: 5000,
    captionText: 'a caption',
    hashtags: ['fyp'],
    audioName: 'Sample Artist · Sample Track',
    ...overrides,
  };
}

function makeLogEntry(at) {
  return {
    id: `log-${nextId++}`,
    at,
    lastAt: at,
    occurrences: 1,
    sessionId: 'session-1',
    detected: false,
    category: 'sad',
    share: 0.5,
    baselineShare: 0.4,
    ratio: 1.25,
    windowSample: 15,
    baselineSample: 200,
    streak: 3,
    reason: 'within-baseline',
    wouldHaveActed: false,
  };
}

beforeEach(async () => {
  await closeDB();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('doomscroll');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  nextId = 0;
});

describe('recordReelView', () => {
  it('stores the event with classification fields left unset', () => {
    // Phase 5 fills these in; storage must not invent a category.
    return recordReelView(makeEvent()).then(async (stored) => {
      expect(stored.category).toBeNull();
      expect(stored.categoryConfidence).toBeNull();
      expect(stored.subtags).toEqual([]);

      const all = await getAllReelEvents();
      expect(all).toHaveLength(1);
      expect(all[0].captionText).toBe('a caption');
    });
  });

  it('creates a session from the first event', async () => {
    await recordReelView(makeEvent({ startedAt: 1000, endedAt: 6000, watchDurationMs: 5000 }));

    const session = await getSession('session-1');
    expect(session).toMatchObject({
      id: 'session-1',
      startedAt: 1000,
      endedAt: 6000,
      reelCount: 1,
      totalDurationMs: 5000,
      dominantCategory: null,
    });
  });

  it('folds later events into the same session', async () => {
    await recordReelView(makeEvent({ startedAt: 1000, endedAt: 6000, watchDurationMs: 5000 }));
    await recordReelView(makeEvent({ startedAt: 7000, endedAt: 10_000, watchDurationMs: 3000 }));

    const session = await getSession('session-1');
    expect(session.reelCount).toBe(2);
    expect(session.totalDurationMs).toBe(8000);
    expect(session.startedAt).toBe(1000);
    expect(session.endedAt).toBe(10_000);
  });

  it('keeps sessions separate', async () => {
    await recordReelView(makeEvent({ sessionId: 'a' }));
    await recordReelView(makeEvent({ sessionId: 'b' }));

    expect((await getSession('a')).reelCount).toBe(1);
    expect((await getSession('b')).reelCount).toBe(1);
  });

  it('does not let an out-of-order event shrink the session window', async () => {
    await recordReelView(makeEvent({ startedAt: 5000, endedAt: 9000 }));
    await recordReelView(makeEvent({ startedAt: 1000, endedAt: 2000 }));

    const session = await getSession('session-1');
    expect(session.startedAt).toBe(1000);
    expect(session.endedAt).toBe(9000);
  });

  it('keeps session totals consistent under concurrent writes', async () => {
    // Events arrive from the content script without awaiting each other, so
    // the read-modify-write on the session must be transactionally safe.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        recordReelView(makeEvent({ startedAt: 1000 + i, watchDurationMs: 100 })),
      ),
    );

    const session = await getSession('session-1');
    expect(session.reelCount).toBe(20);
    expect(session.totalDurationMs).toBe(2000);
    expect(await getAllReelEvents()).toHaveLength(20);
  });
});

describe('queries', () => {
  it('returns events within an inclusive time range', async () => {
    await recordReelView(makeEvent({ startedAt: 1000 }));
    await recordReelView(makeEvent({ startedAt: 5000 }));
    await recordReelView(makeEvent({ startedAt: 9000 }));

    const events = await getReelEvents(1000, 5000);
    expect(events.map((e) => e.startedAt)).toEqual([1000, 5000]);
  });

  it('returns recent events newest first, capped at the limit', async () => {
    for (const startedAt of [1000, 2000, 3000, 4000]) {
      await recordReelView(makeEvent({ startedAt }));
    }

    const recent = await getRecentReelEvents(2);
    expect(recent.map((e) => e.startedAt)).toEqual([4000, 3000]);
  });

  it('tolerates a limit larger than the stored history', async () => {
    await recordReelView(makeEvent({ startedAt: 1000 }));
    expect(await getRecentReelEvents(50)).toHaveLength(1);
  });

  it('round-trips daily aggregates by date key', async () => {
    await putDailyAggregate({
      date: '2026-08-05',
      totalReels: 3,
      totalMinutes: 4,
      avgReelsPerSec: 0.1,
      longestBingeMs: 1000,
      categoryBreakdown: { sad: 3 },
    });
    await putDailyAggregate({
      date: '2026-08-07',
      totalReels: 1,
      totalMinutes: 1,
      avgReelsPerSec: 0.2,
      longestBingeMs: 500,
      categoryBreakdown: {},
    });

    const range = await getDailyAggregates('2026-08-05', '2026-08-06');
    expect(range.map((a) => a.date)).toEqual(['2026-08-05']);
  });
});

describe('pruneOldData', () => {
  it('deletes raw history past the retention window', async () => {
    const now = Date.now();
    const old = now - (RETENTION_DAYS + 5) * DAY_MS;

    await recordReelView(makeEvent({ startedAt: old, sessionId: 'old' }));
    await recordReelView(makeEvent({ startedAt: now, sessionId: 'current' }));

    const deleted = await pruneOldData(now);

    expect(deleted).toBe(1);
    const remaining = await getAllReelEvents();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].startedAt).toBe(now);
    expect(await getSession('old')).toBeUndefined();
    expect(await getSession('current')).toBeDefined();
  });

  it('keeps daily aggregates, which outlive raw history', async () => {
    const now = Date.now();
    await putDailyAggregate({
      date: '2020-01-01',
      totalReels: 1,
      totalMinutes: 1,
      avgReelsPerSec: 0,
      longestBingeMs: 0,
      categoryBreakdown: {},
    });

    await pruneOldData(now);

    expect(await getDailyAggregates('2020-01-01', '2020-01-01')).toHaveLength(1);
  });

  it('is a no-op when nothing is old enough', async () => {
    const now = Date.now();
    await recordReelView(makeEvent({ startedAt: now }));
    expect(await pruneOldData(now)).toBe(0);
  });

  it('prunes the detection log too', async () => {
    // Regression: the log was the one store nothing ever deleted from, so it
    // grew without bound. Once the reels behind an entry are gone there is
    // nothing left to cross-reference it against.
    const now = Date.now();
    const old = now - (RETENTION_DAYS + 5) * DAY_MS;

    await putDetectionLog(makeLogEntry(old));
    await putDetectionLog(makeLogEntry(now));

    await pruneOldData(now);

    const remaining = await getDetectionLog();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].at).toBe(now);
  });
});

describe('clearAllData', () => {
  it('wipes events, sessions, and aggregates', async () => {
    await recordReelView(makeEvent());
    await putDailyAggregate({
      date: '2026-08-07',
      totalReels: 1,
      totalMinutes: 1,
      avgReelsPerSec: 0,
      longestBingeMs: 0,
      categoryBreakdown: {},
    });

    await clearAllData();

    expect(await getAllReelEvents()).toHaveLength(0);
    expect(await getSession('session-1')).toBeUndefined();
    expect(await getDailyAggregates('2000-01-01', '2100-01-01')).toHaveLength(0);
  });
});

describe('authorHandle persistence', () => {
  it('round-trips the author through storage', async () => {
    await recordReelView(makeEvent({ authorHandle: 'samplecreator' }));
    const [stored] = await getAllReelEvents();
    expect(stored.authorHandle).toBe('samplecreator');
  });

  it('stores a reel whose author never resolved as null, not as missing', async () => {
    await recordReelView(makeEvent({ authorHandle: null }));
    const [stored] = await getAllReelEvents();
    expect(stored.authorHandle).toBeNull();
  });
});

describe('v2 -> v3 upgrade', () => {
  it('opens a v2 database and keeps the events already in it', async () => {
    // The v3 bump only adds ReelEvent.authorHandle, so there is nothing to
    // migrate — but an upgrade that dropped or failed on existing history
    // would silently destroy the user's data on update, which is the whole
    // reason this is tested rather than assumed.
    await closeDB();
    indexedDB.deleteDatabase('doomscroll');

    await new Promise((resolve, reject) => {
      const open = indexedDB.open('doomscroll', 2);
      open.onupgradeneeded = () => {
        const db = open.result;
        const events = db.createObjectStore('reelEvents', { keyPath: 'id' });
        events.createIndex('by-startedAt', 'startedAt');
        events.createIndex('by-session', 'sessionId');
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('by-startedAt', 'startedAt');
        db.createObjectStore('dailyAggregates', { keyPath: 'date' });
        const log = db.createObjectStore('detectionLog', { keyPath: 'id' });
        log.createIndex('by-at', 'at');
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('reelEvents', 'readwrite');
        // A pre-v3 row: no authorHandle field at all.
        tx.objectStore('reelEvents').put({
          id: 'legacy-1',
          reelShortcode: 'SYNTH-00001',
          sessionId: 'session-legacy',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_005_000,
          watchDurationMs: 5000,
          captionText: 'from before authors were captured',
          hashtags: [],
          audioName: null,
          category: 'sad',
          categoryConfidence: 0.6,
          subtags: [],
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });

    const events = await getAllReelEvents();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('legacy-1');
    // Absent rather than null on an old row; readers must treat both as
    // "not captured" — see ReelEvent.authorHandle.
    expect(events[0].authorHandle ?? null).toBeNull();

    // And the upgraded database still accepts writes on every store.
    await recordReelView(makeEvent({ authorHandle: 'newauthor' }));
    expect(await getAllReelEvents()).toHaveLength(2);
  });
});

describe('interventionLog', () => {
  const intervention = (over = {}) => ({
    id: `i${nextId++}`,
    at: Date.now(),
    sessionId: 'session-1',
    level: 'overlay',
    category: 'sad',
    streak: 12,
    share: 0.8,
    ratio: 2.1,
    outcome: 'pending',
    respondedAt: null,
    ...over,
  });

  it('stores and returns interruptions newest first', async () => {
    await putInterventionLog(intervention({ id: 'older', at: 1000 }));
    await putInterventionLog(intervention({ id: 'newer', at: 2000 }));

    const log = await getInterventionLog();
    expect(log.map((e) => e.id)).toEqual(['newer', 'older']);
  });

  it('looks one up by id, which is how a dismissal is correlated', async () => {
    await putInterventionLog(intervention({ id: 'target' }));
    expect((await getInterventionById('target')).level).toBe('overlay');
  });

  it('returns undefined for an id that does not exist', async () => {
    expect(await getInterventionById('nope')).toBeUndefined();
  });

  it('is wiped by clearAllData along with everything else', async () => {
    await putInterventionLog(intervention());
    await clearAllData();
    expect(await getInterventionLog()).toHaveLength(0);
  });

  it('is pruned with the history it refers to', async () => {
    // An intervention whose reels and session are gone cannot be evaluated,
    // and keeping it would leave the effectiveness figures citing evidence
    // that no longer exists.
    const now = Date.now();
    await putInterventionLog(
      intervention({ id: 'ancient', at: now - (RETENTION_DAYS + 5) * DAY_MS }),
    );
    await putInterventionLog(intervention({ id: 'recent', at: now }));

    await pruneOldData(now);
    expect((await getInterventionLog()).map((e) => e.id)).toEqual(['recent']);
  });
});

describe('v3 -> v4 upgrade', () => {
  it('adds the intervention store without disturbing existing history', async () => {
    await closeDB();
    indexedDB.deleteDatabase('doomscroll');

    await new Promise((resolve, reject) => {
      const open = indexedDB.open('doomscroll', 3);
      open.onupgradeneeded = () => {
        const db = open.result;
        const events = db.createObjectStore('reelEvents', { keyPath: 'id' });
        events.createIndex('by-startedAt', 'startedAt');
        events.createIndex('by-session', 'sessionId');
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('by-startedAt', 'startedAt');
        db.createObjectStore('dailyAggregates', { keyPath: 'date' });
        const log = db.createObjectStore('detectionLog', { keyPath: 'id' });
        log.createIndex('by-at', 'at');
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('reelEvents', 'readwrite');
        tx.objectStore('reelEvents').put({
          id: 'kept',
          reelShortcode: 'abc',
          sessionId: 's1',
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_005_000,
          watchDurationMs: 5000,
          captionText: 'from before interventions existed',
          hashtags: [],
          audioName: null,
          authorHandle: 'someone',
          category: 'sad',
          categoryConfidence: 0.6,
          subtags: [],
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });

    const events = await getAllReelEvents();
    expect(events.map((e) => e.id)).toEqual(['kept']);
    // And the new store exists and is usable.
    expect(await getInterventionLog()).toEqual([]);
  });
});

describe('session drill-down reads', () => {
  it('returns recent sessions newest first', async () => {
    await recordReelView(makeEvent({ sessionId: 'older', startedAt: 1000, endedAt: 2000 }));
    await recordReelView(makeEvent({ sessionId: 'newer', startedAt: 9000, endedAt: 9500 }));

    const sessions = await getRecentSessions();
    expect(sessions.map((s) => s.id)).toEqual(['newer', 'older']);
  });

  it('honours the limit', async () => {
    for (let i = 0; i < 5; i++) {
      await recordReelView(makeEvent({ sessionId: `s${i}`, startedAt: i * 1000 }));
    }
    expect(await getRecentSessions(2)).toHaveLength(2);
  });

  it('returns a session’s reels in the order they were watched', async () => {
    // The by-session index returns insertion order; the drill-down needs time
    // order, or a run stops being a contiguous block.
    await recordReelView(makeEvent({ id: 'third', sessionId: 's1', startedAt: 3000 }));
    await recordReelView(makeEvent({ id: 'first', sessionId: 's1', startedAt: 1000 }));
    await recordReelView(makeEvent({ id: 'second', sessionId: 's1', startedAt: 2000 }));

    const events = await getSessionEvents('s1');
    expect(events.map((e) => e.id)).toEqual(['first', 'second', 'third']);
  });

  it('does not leak reels from another session', async () => {
    await recordReelView(makeEvent({ id: 'mine', sessionId: 's1' }));
    await recordReelView(makeEvent({ id: 'theirs', sessionId: 's2' }));
    expect((await getSessionEvents('s1')).map((e) => e.id)).toEqual(['mine']);
  });

  it('returns nothing for a session that has been pruned away', async () => {
    expect(await getSessionEvents('gone')).toEqual([]);
  });
});
