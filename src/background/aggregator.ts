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

import { getAllReelEvents, getDailyAggregates, getReelEvents, putDailyAggregate } from './db.js';
import { aggregateDay, groupByLocalDay } from '@shared/aggregation.js';
import { localDateKey, localDayRange } from '@shared/time.js';
import type { DailyAggregate } from '@shared/types.js';

/** Storage key for the set of days awaiting a rollup. Exported for tests. */
export const DIRTY_DAYS_KEY = 'doomscroll:dirtyDays';

/** Recomputes one local day from its events and persists the result. */
export async function recomputeDay(dateKey: string, gapMs?: number): Promise<DailyAggregate> {
  const { from, to } = localDayRange(dateKey);
  const events = await getReelEvents(from, to);
  const aggregate = aggregateDay(dateKey, events, gapMs);
  await putDailyAggregate(aggregate);
  return aggregate;
}

async function readDirtyDays(): Promise<string[]> {
  try {
    const { [DIRTY_DAYS_KEY]: stored } = await chrome.storage.local.get(DIRTY_DAYS_KEY);
    return Array.isArray(stored) ? stored.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

/** Alarm that flushes the dirty days. */
/**
 * Forgets the days awaiting a rollup.
 *
 * Only for wiping history. The dirty set is a queue of days to recompute, and
 * a day recomputed after its events are gone rolls up as a zero — so left
 * behind, a wipe quietly resurrects the deleted days as empty aggregates on
 * the next alarm. Detection survives that (the sample guard rejects them), but
 * the charts would show days that no longer exist.
 */
export async function clearDirtyDays(): Promise<void> {
  try {
    await chrome.storage.local.remove(DIRTY_DAYS_KEY);
  } catch {
    // Worst case the stale days roll up as empty and are recomputed properly
    // the next time anything is actually recorded on them.
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
export async function markDayDirty(timestamp: number): Promise<void> {
  const dateKey = localDateKey(timestamp);
  const dirty = await readDirtyDays();
  if (dirty.includes(dateKey)) return;
  try {
    await chrome.storage.local.set({ [DIRTY_DAYS_KEY]: [...dirty, dateKey] });
  } catch {
    // Losing the mark only delays the rollup to the next GET_STATS.
  }
}

/**
 * Recomputes every day marked dirty.
 *
 * The set is cleared before the work runs, so a failure mid-flush drops those
 * marks. Days are re-marked on the next reel, and GET_STATS recomputes today
 * regardless, so the exposure is a stale aggregate for a quiet past day.
 */
export async function flushDirtyDays(gapMs?: number): Promise<string[]> {
  const dirty = await readDirtyDays();
  if (!dirty.length) return [];

  // Cleared before the work, not after, so a day marked dirty *during* the
  // flush is not wiped by a write that finishes later.
  try {
    await chrome.storage.local.set({ [DIRTY_DAYS_KEY]: [] });
  } catch {
    // Proceed anyway: recomputing is idempotent, so a repeat is harmless.
  }

  // Clearing first has a cost: a throw partway through would lose every day
  // not yet reached, and lose it permanently — the queue is already empty, so
  // nothing would ever roll those days up again. An aggregate that is never
  // written is a hole in the baseline detection is computed from, which is
  // exactly the kind of silent, self-reinforcing loss this codebase has been
  // bitten by before. Whatever is left goes back on the queue.
  const done: string[] = [];
  try {
    for (const dateKey of dirty) {
      await recomputeDay(dateKey, gapMs);
      done.push(dateKey);
    }
  } catch (err) {
    await requeueDays(dirty.filter((d) => !done.includes(d)));
    throw err;
  }

  return done;
}

/** Puts days back on the queue, preserving any marked while we were away. */
async function requeueDays(days: string[]): Promise<void> {
  if (!days.length) return;
  try {
    const current = await readDirtyDays();
    const merged = [...new Set([...current, ...days])];
    await chrome.storage.local.set({ [DIRTY_DAYS_KEY]: merged });
  } catch {
    // Nothing left to try. The days roll up on the next write to them, or on
    // the install-time backfill.
  }
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
