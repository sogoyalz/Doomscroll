// Materializes daily aggregates from raw reel events.
//
// Aggregates have to be written, not computed on demand: raw events are
// pruned after 90 days and the aggregates outlive them, so a day that was
// never rolled up is lost permanently once its events age out.
//
// Recomputing on every reel would mean a write per scroll, so days are marked
// dirty and flushed on a debounced alarm. The dirty set lives in
// chrome.storage.local rather than module scope because MV3 kills the service
// worker after ~30s idle — anything held in memory is gone by the time the
// alarm fires.

import {
  getAllReelEvents,
  getDB,
  getDailyAggregates,
  getReelEvents,
  putDailyAggregate,
  putDailyAggregates,
} from './db.js';
import { aggregateDay, groupByLocalDay } from '@shared/aggregation.js';
import { localDateKey, localDayRange } from '@shared/time.js';
import type { DailyAggregate } from '@shared/types.js';

/** Storage key for the set of days awaiting a rollup. Exported for tests. */
export const DIRTY_DAYS_KEY = 'doomscroll:dirtyDays';

/** Recomputes one local day from its events and persists the result. */
export async function recomputeDay(dateKey: string, gapMs?: number): Promise<DailyAggregate> {
  const { from, to } = localDayRange(dateKey);
  const [legacy, captured] = await Promise.all([getReelEvents(from, to),
    (await getDB()).getAllFromIndex('reelEvents', 'by-capture-day', dateKey)]);
  const events = [...legacy.filter(event => !event.calendar), ...captured];
  const aggregate = aggregateDay(dateKey, events, gapMs);
  await putDailyAggregate(aggregate);
  return aggregate;
}

async function readDirtyDays(): Promise<string[]> {
  try {
    const { [DIRTY_DAYS_KEY]: stored } = await chrome.storage.local.get(DIRTY_DAYS_KEY);
    return Array.isArray(stored)
      ? stored.filter((d): d is string => typeof d === 'string')
      : [];
  } catch {
    return [];
  }
}

export const AGGREGATE_ALARM = 'doomscroll:aggregate';

/** chrome.alarms clamps anything shorter, so one minute is the floor. */
export const AGGREGATE_DELAY_MINUTES = 1;

/**
 * Schedules the dirty-day flush, keeping at most one alarm pending.
 *
 * Deliberately a THROTTLE, not a debounce. `chrome.alarms.create` replaces any
 * existing alarm of the same name, so re-creating it on every reel pushed the
 * deadline back a minute each time — during continuous scrolling (a reel every
 * few seconds) it never fired at all, and the day's aggregate went
 * unmaterialised for the entire sitting. Scrolling across midnight made it
 * worse: yesterday stayed stale, while GET_STATS only ever recomputes today
 * and detection reads yesterday as part of its baseline.
 */
export async function scheduleAggregateFlush(): Promise<void> {
  try {
    if (await chrome.alarms.get(AGGREGATE_ALARM)) return;
    chrome.alarms.create(AGGREGATE_ALARM, { delayInMinutes: AGGREGATE_DELAY_MINUTES });
  } catch {
    // Scheduling is best-effort; GET_STATS recomputes today on demand.
  }
}

/**
 * Notes that a day's events changed and its aggregate is now stale.
 *
 * Read-modify-write on a shared key can drop a concurrent mark. The cost is a
 * stale aggregate until that day is touched again or read via GET_STATS,
 * which recomputes today anyway — not worth a lock.
 */
export async function markDayDirty(timestamp: number, dateKey = localDateKey(timestamp)): Promise<void> {
  const dirty = await readDirtyDays();
  if (dirty.includes(dateKey)) return;
  try {
    await chrome.storage.local.set({ [DIRTY_DAYS_KEY]: [...dirty, dateKey] });
  } catch {
    // Losing the mark only delays the rollup to the next GET_STATS.
  }
}

/** Called under the history queue. Keep each marker until its write commits. */
export async function flushDirtyDays(gapMs?: number): Promise<string[]> {
  const dirty = await readDirtyDays();
  for (const dateKey of dirty) {
    await recomputeDay(dateKey, gapMs);
    const current = await readDirtyDays();
    await chrome.storage.local.set({ [DIRTY_DAYS_KEY]: current.filter(day => day !== dateKey) });
  }
  return dirty;
}

/**
 * One-time rollup of days that have events but no aggregate.
 *
 * Only relevant for history recorded before this phase existed. Scans all
 * events once, which is acceptable on install but not something to run on
 * every worker start.
 */
export async function backfillMissingAggregates(gapMs?: number): Promise<string[]> {
  const events = await getAllReelEvents();
  if (!events.length) return [];

  const byDay = groupByLocalDay(events);
  const keys = [...byDay.keys()].sort();
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;

  const existing = new Set((await getDailyAggregates(first, last)).map((a) => a.date));

  const written: string[] = [];
  for (const [dateKey, dayEvents] of byDay) {
    if (existing.has(dateKey)) continue;
    await putDailyAggregate(aggregateDay(dateKey, dayEvents, gapMs));
    written.push(dateKey);
  }
  return written;
}

/**
 * Rebuilds every day that still has events, against the given session gap.
 *
 * `sessionGapThresholdMs` is not just a query parameter — it is baked into
 * `longestBingeMs` when a day is rolled up. Nothing recomputed history when
 * the user changed it, and only today is ever recomputed on demand, so the
 * dashboard showed today under the new rule and every previous day under the
 * old one. On the same five reels a two-minute gap gives a 2m05s longest
 * binge and a ten-minute gap gives 8m05s, so the chart was comparing days
 * measured in different units without saying so.
 *
 * Distinct from backfillMissingAggregates, which deliberately skips any day
 * that already has an aggregate — that is what made this unfixable by simply
 * running the backfill again.
 *
 * Days whose events have aged out are left untouched. Their aggregate is all
 * that survives them, and recomputing one against no events writes a zero
 * over real history.
 */
export async function recomputeAllDays(gapMs?: number): Promise<string[]> {
  const events = await getAllReelEvents();
  if (!events.length) return [];

  const byDay = groupByLocalDay(events);
  // One transaction rather than one per day: a year of history is hundreds of
  // writes, and an MV3 worker killed partway through would leave the rebuild
  // half-applied — precisely the mixed-units state this exists to remove.
  await putDailyAggregates(
    [...byDay].map(([dateKey, dayEvents]) => aggregateDay(dateKey, dayEvents, gapMs)),
  );
  return [...byDay.keys()];
}
