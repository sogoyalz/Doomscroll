// IndexedDB layer — the only module that touches persistent reel history.
//
// IndexedDB rather than chrome.storage.local because this grows without
// bound: chrome.storage has a ~10MB quota and no indexes, so every read would
// mean deserializing the entire history to filter it. Reel events are queried
// by time range constantly (aggregation, pattern detection), which is exactly
// what an index is for.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  ClassificationResult,
  DailyAggregate,
  DetectionLogEntry,
  InterventionLogEntry,
  NewReelEvent,
  ReelEvent,
  Session,
} from '@shared/types.js';
import { startOfLocalDayBefore } from '@shared/time.js';

const DB_NAME = 'doomscroll';
// v2 adds detectionLog. v3 adds ReelEvent.authorHandle — an additive field
// needing no data migration: events written before it carry undefined, which
// reads as "not captured" and is normalised to null on the way out. v4 adds
// interventionLog.
const DB_VERSION = 4;

/** How long raw per-reel history is kept. Daily aggregates outlive it. */
export const RETENTION_DAYS = 90;

export interface DoomscrollDB extends DBSchema {
  reelEvents: {
    key: string;
    value: ReelEvent;
    indexes: {
      'by-startedAt': number;
      'by-session': string;
    };
  };
  sessions: {
    key: string;
    value: Session;
    indexes: { 'by-startedAt': number };
  };
  dailyAggregates: {
    key: string; // YYYY-MM-DD, local time
    value: DailyAggregate;
  };
  detectionLog: {
    key: string;
    value: DetectionLogEntry;
    indexes: { 'by-at': number };
  };
  interventionLog: {
    key: string;
    value: InterventionLogEntry;
    indexes: { 'by-at': number };
  };
}

let dbPromise: Promise<IDBPDatabase<DoomscrollDB>> | null = null;

/**
 * The shared connection.
 *
 * A failed open clears the cached promise so the next call retries — caching
 * a rejected promise would leave every future write failing against a stale
 * error for the life of the service worker.
 */
export function getDB(): Promise<IDBPDatabase<DoomscrollDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DoomscrollDB>(DB_NAME, DB_VERSION, {
      // Guarded per store rather than switched on oldVersion, so upgrading
      // from any earlier version creates whatever is missing.
      upgrade(db) {
        if (!db.objectStoreNames.contains('reelEvents')) {
          const events = db.createObjectStore('reelEvents', { keyPath: 'id' });
          events.createIndex('by-startedAt', 'startedAt');
          events.createIndex('by-session', 'sessionId');
        }

        if (!db.objectStoreNames.contains('sessions')) {
          const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
          sessions.createIndex('by-startedAt', 'startedAt');
        }

        if (!db.objectStoreNames.contains('dailyAggregates')) {
          db.createObjectStore('dailyAggregates', { keyPath: 'date' });
        }

        if (!db.objectStoreNames.contains('detectionLog')) {
          const log = db.createObjectStore('detectionLog', { keyPath: 'id' });
          log.createIndex('by-at', 'at');
        }

        if (!db.objectStoreNames.contains('interventionLog')) {
          const interventions = db.createObjectStore('interventionLog', { keyPath: 'id' });
          interventions.createIndex('by-at', 'at');
        }
      },
    }).catch((err: unknown) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/**
 * Closes the shared connection and drops the cache.
 *
 * An open connection blocks `deleteDatabase` and version upgrades, so this
 * has to actually close rather than just forget the promise.
 */
export async function closeDB(): Promise<void> {
  if (!dbPromise) return;
  const pending = dbPromise;
  dbPromise = null;
  const db = await pending.catch(() => null);
  db?.close();
}

/**
 * Persists a finished reel view and folds it into its session.
 *
 * Both writes share one transaction: a session's reelCount and totalDuration
 * are derived from its events, so a partial write would leave them disagreeing
 * permanently.
 *
 * A null `classification` means the reel had no text to read, and is stored as
 * unclassified rather than being guessed at.
 */
export async function recordReelView(
  event: NewReelEvent,
  classification: ClassificationResult | null = null,
): Promise<ReelEvent> {
  const db = await getDB();
  const tx = db.transaction(['reelEvents', 'sessions'], 'readwrite');

  const reelEvent: ReelEvent = {
    ...event,
    category: classification?.category ?? null,
    categoryConfidence: classification?.confidence ?? null,
    subtags: classification?.subtags ?? [],
  };

  const sessions = tx.objectStore('sessions');
  const existing = await sessions.get(event.sessionId);

  const session: Session = existing
    ? {
        ...existing,
        startedAt: Math.min(existing.startedAt, event.startedAt),
        endedAt: Math.max(existing.endedAt, event.endedAt),
        reelCount: existing.reelCount + 1,
        totalDurationMs: existing.totalDurationMs + event.watchDurationMs,
      }
    : {
        id: event.sessionId,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        reelCount: 1,
        totalDurationMs: event.watchDurationMs,
        dominantCategory: null,
      };

  await Promise.all([
    tx.objectStore('reelEvents').put(reelEvent),
    sessions.put(session),
    tx.done,
  ]);

  return reelEvent;
}

/** Reel events with `startedAt` in [from, to], oldest first. */
export async function getReelEvents(from: number, to: number): Promise<ReelEvent[]> {
  const db = await getDB();
  return db.getAllFromIndex('reelEvents', 'by-startedAt', IDBKeyRange.bound(from, to));
}

/** The most recent `limit` reel events, newest first — the pattern-detection window. */
export async function getRecentReelEvents(limit: number): Promise<ReelEvent[]> {
  const db = await getDB();
  const tx = db.transaction('reelEvents', 'readonly');
  const index = tx.objectStore('reelEvents').index('by-startedAt');

  const events: ReelEvent[] = [];
  for (
    let cursor = await index.openCursor(null, 'prev');
    cursor && events.length < limit;
    cursor = await cursor.continue()
  ) {
    events.push(cursor.value);
  }

  await tx.done;
  return events;
}

export async function getAllReelEvents(): Promise<ReelEvent[]> {
  const db = await getDB();
  return db.getAllFromIndex('reelEvents', 'by-startedAt');
}


/** Rows per transaction for bulk writes. Large enough to amortise the
 *  transaction cost, small enough to stay responsive. */
const WRITE_CHUNK = 500;

/**
 * Writes many events, batched into a few transactions.
 *
 * One transaction per event is the obvious shape and the wrong one at this
 * scale: a lexicon bump rewrites the whole history, and at ~1000 reels a day
 * that is tens of thousands of round trips — minutes of blocking work, which
 * an MV3 worker is terminated partway through.
 */
export async function putReelEvents(events: ReelEvent[]): Promise<void> {
  for (let i = 0; i < events.length; i += WRITE_CHUNK) {
    const chunk = events.slice(i, i + WRITE_CHUNK);
    const db = await getDB();
    const tx = db.transaction('reelEvents', 'readwrite');
    const store = tx.objectStore('reelEvents');
    await Promise.all([...chunk.map((event) => store.put(event)), tx.done]);
  }
}

/** Writes many daily aggregates in one transaction. */
export async function putDailyAggregates(aggregates: DailyAggregate[]): Promise<void> {
  if (!aggregates.length) return;
  const db = await getDB();
  const tx = db.transaction('dailyAggregates', 'readwrite');
  const store = tx.objectStore('dailyAggregates');
  await Promise.all([...aggregates.map((a) => store.put(a)), tx.done]);
}

export async function getSession(id: string): Promise<Session | undefined> {
  const db = await getDB();
  return db.get('sessions', id);
}

/** The most recent `limit` scrolling sessions, newest first. */
export async function getRecentSessions(limit = 20): Promise<Session[]> {
  const db = await getDB();
  const tx = db.transaction('sessions', 'readonly');
  const index = tx.objectStore('sessions').index('by-startedAt');

  const sessions: Session[] = [];
  for (
    let cursor = await index.openCursor(null, 'prev');
    cursor && sessions.length < limit;
    cursor = await cursor.continue()
  ) {
    sessions.push(cursor.value);
  }

  await tx.done;
  return sessions;
}

/**
 * One session's reels, in the order they were watched.
 *
 * Order matters more here than anywhere else in this file: the drill-down
 * exists to make a run of one category visible as a contiguous block, and the
 * by-session index returns insertion order rather than time order.
 */
export async function getSessionEvents(sessionId: string): Promise<ReelEvent[]> {
  const db = await getDB();
  const events = await db.getAllFromIndex('reelEvents', 'by-session', sessionId);
  return events.sort((a, b) => a.startedAt - b.startedAt);
}

export async function putDailyAggregate(aggregate: DailyAggregate): Promise<void> {
  const db = await getDB();
  await db.put('dailyAggregates', aggregate);
}

/** Daily aggregates for the inclusive date-key range, oldest first. */
export async function getDailyAggregates(
  fromDateKey: string,
  toDateKey: string,
): Promise<DailyAggregate[]> {
  const db = await getDB();
  return db.getAll('dailyAggregates', IDBKeyRange.bound(fromDateKey, toDateKey));
}

/** Inserts or replaces a log entry, keyed by id. */
export async function putDetectionLog(entry: DetectionLogEntry): Promise<void> {
  const db = await getDB();
  await db.put('detectionLog', entry);
}

/** Detection decisions, newest first — the log-only review artifact. */
export async function getDetectionLog(limit = 200): Promise<DetectionLogEntry[]> {
  const db = await getDB();
  const tx = db.transaction('detectionLog', 'readonly');
  const index = tx.objectStore('detectionLog').index('by-at');

  const entries: DetectionLogEntry[] = [];
  for (
    let cursor = await index.openCursor(null, 'prev');
    cursor && entries.length < limit;
    cursor = await cursor.continue()
  ) {
    entries.push(cursor.value);
  }

  await tx.done;
  return entries;
}

/** Inserts or replaces an intervention record, keyed by id. */
export async function putInterventionLog(entry: InterventionLogEntry): Promise<void> {
  const db = await getDB();
  await db.put('interventionLog', entry);
}

/** Interruptions, newest first. */
export async function getInterventionLog(limit = 200): Promise<InterventionLogEntry[]> {
  const db = await getDB();
  const tx = db.transaction('interventionLog', 'readonly');
  const index = tx.objectStore('interventionLog').index('by-at');

  const entries: InterventionLogEntry[] = [];
  for (
    let cursor = await index.openCursor(null, 'prev');
    cursor && entries.length < limit;
    cursor = await cursor.continue()
  ) {
    entries.push(cursor.value);
  }

  await tx.done;
  return entries;
}

/** One intervention record by id, for correlating a dismissal back to it. */
export async function getInterventionById(
  id: string,
): Promise<InterventionLogEntry | undefined> {
  const db = await getDB();
  return db.get('interventionLog', id);
}

/**
 * Drops raw history older than the retention window.
 *
 * Daily aggregates are deliberately kept: they are small, and the trailing
 * baseline that pattern detection compares against is more useful the longer
 * it reaches back.
 */
export async function pruneOldData(now: number = Date.now()): Promise<number> {
  const cutoff = startOfLocalDayBefore(now, RETENTION_DAYS);
  const db = await getDB();
  const tx = db.transaction(
    ['reelEvents', 'sessions', 'detectionLog', 'interventionLog'],
    'readwrite',
  );

  let deleted = 0;
  const events = tx.objectStore('reelEvents').index('by-startedAt');
  for (
    let cursor = await events.openCursor(IDBKeyRange.upperBound(cutoff, true));
    cursor;
    cursor = await cursor.continue()
  ) {
    await cursor.delete();
    deleted++;
  }

  const sessions = tx.objectStore('sessions').index('by-startedAt');
  for (
    let cursor = await sessions.openCursor(IDBKeyRange.upperBound(cutoff, true));
    cursor;
    cursor = await cursor.continue()
  ) {
    await cursor.delete();
  }

  // The log outlives nothing: once the reels behind an entry are gone there is
  // nothing left to cross-reference it against, and without this it is the one
  // store that grows without bound.
  const log = tx.objectStore('detectionLog').index('by-at');
  for (
    let cursor = await log.openCursor(IDBKeyRange.upperBound(cutoff, true));
    cursor;
    cursor = await cursor.continue()
  ) {
    await cursor.delete();
  }

  // Same reasoning for interruptions: an intervention whose session and reels
  // have been pruned can no longer be evaluated, and keeping it would leave
  // the effectiveness figures quoting evidence that is gone.
  const interventions = tx.objectStore('interventionLog').index('by-at');
  for (
    let cursor = await interventions.openCursor(IDBKeyRange.upperBound(cutoff, true));
    cursor;
    cursor = await cursor.continue()
  ) {
    await cursor.delete();
  }

  await tx.done;
  return deleted;
}

/**
 * Wipes tracked history.
 *
 * Settings survive deliberately — they live in chrome.storage.local, and a
 * user clearing their history is not asking to be re-onboarded.
 */
export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['reelEvents', 'sessions', 'dailyAggregates', 'detectionLog', 'interventionLog'],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('reelEvents').clear(),
    tx.objectStore('sessions').clear(),
    tx.objectStore('dailyAggregates').clear(),
    tx.objectStore('detectionLog').clear(),
    tx.objectStore('interventionLog').clear(),
    tx.done,
  ]);
}
