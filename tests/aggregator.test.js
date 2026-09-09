import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { closeDB, getDailyAggregates, putDailyAggregate, recordReelView } from '../src/background/db.ts';
import * as db from '../src/background/db.ts';
import {
  AGGREGATE_ALARM,
  backfillMissingAggregates,
  DIRTY_DAYS_KEY,
  flushDirtyDays,
  markDayDirty,
  recomputeDay,
  scheduleAggregateFlush,
} from '../src/background/aggregator.ts';
import { UNCLASSIFIED } from '../src/shared/aggregation.ts';

let store = {};

// Minimal chrome.alarms stand-in that mirrors the real replace-on-create
// semantics, which is exactly what the throttle has to work around.
let alarms = {};
const alarmCreates = { count: 0 };

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return key in store ? { [key]: store[key] } : {};
      },
      async set(entries) {
        Object.assign(store, entries);
      },
    },
  },
  alarms: {
    async get(name) {
      return alarms[name];
    },
    create(name, info) {
      alarmCreates.count++;
      // Chrome cancels and replaces any alarm of the same name.
      alarms[name] = { name, ...info };
    },
    clear(name) {
      delete alarms[name];
    },
  },
};

let nextId = 0;

function makeEvent(startedAt, durationMs = 5000) {
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
  };
}

/** Noon on a given local date, safely away from any midnight boundary. */
function noon(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

beforeEach(async () => {
  store = {};
  nextId = 0;
  alarms = {};
  alarmCreates.count = 0;
  await closeDB();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('doomscroll');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});

describe('recomputeDay', () => {
  it('rolls a day of events into a persisted aggregate', async () => {
    await recordReelView(makeEvent(noon(2026, 8, 7), 30_000));
    await recordReelView(makeEvent(noon(2026, 8, 7) + 40_000, 30_000));

    const aggregate = await recomputeDay('2026-08-07');

    expect(aggregate.totalReels).toBe(2);
    expect(aggregate.totalMinutes).toBe(1);
    // Events are stored unclassified until Phase 5.
    expect(aggregate.categoryBreakdown).toEqual({ [UNCLASSIFIED]: 2 });

    const [persisted] = await getDailyAggregates('2026-08-07', '2026-08-07');
    expect(persisted.totalReels).toBe(2);
  });

  it('only counts events from that local day', async () => {
    await recordReelView(makeEvent(noon(2026, 8, 7)));
    await recordReelView(makeEvent(noon(2026, 8, 8)));

    expect((await recomputeDay('2026-08-07')).totalReels).toBe(1);
  });

  it('includes events at the edges of the local day', async () => {
    const justAfterMidnight = new Date(2026, 7, 7, 0, 0, 0, 0).getTime();
    const justBeforeMidnight = new Date(2026, 7, 7, 23, 59, 59, 500).getTime();

    await recordReelView(makeEvent(justAfterMidnight, 100));
    await recordReelView(makeEvent(justBeforeMidnight, 100));

    expect((await recomputeDay('2026-08-07')).totalReels).toBe(2);
  });

  it('writes a zeroed aggregate for a day whose events are gone', async () => {
    const aggregate = await recomputeDay('2026-08-07');
    expect(aggregate.totalReels).toBe(0);
  });

  it('is idempotent', async () => {
    await recordReelView(makeEvent(noon(2026, 8, 7)));
    await recomputeDay('2026-08-07');
    await recomputeDay('2026-08-07');

    expect(await getDailyAggregates('2026-08-07', '2026-08-07')).toHaveLength(1);
  });
});

describe('dirty-day tracking', () => {
  it('flushes marked days and clears the set', async () => {
    await recordReelView(makeEvent(noon(2026, 8, 7)));
    await markDayDirty(noon(2026, 8, 7));

    expect(await flushDirtyDays()).toEqual(['2026-08-07']);
    expect((await getDailyAggregates('2026-08-07', '2026-08-07'))[0].totalReels).toBe(1);

    // Set is cleared, so a second flush has nothing to do.
    expect(await flushDirtyDays()).toEqual([]);
  });

  it('does not record the same day twice', async () => {
    await markDayDirty(noon(2026, 8, 7));
    await markDayDirty(noon(2026, 8, 7) + 1000);

    expect(await flushDirtyDays()).toEqual(['2026-08-07']);
  });

  it('tracks multiple days independently', async () => {
    await recordReelView(makeEvent(noon(2026, 8, 7)));
    await recordReelView(makeEvent(noon(2026, 8, 8)));
    await markDayDirty(noon(2026, 8, 7));
    await markDayDirty(noon(2026, 8, 8));

    expect((await flushDirtyDays()).sort()).toEqual(['2026-08-07', '2026-08-08']);
    expect(await getDailyAggregates('2026-08-07', '2026-08-08')).toHaveLength(2);
  });

  it('survives a corrupted dirty-day value', async () => {
    store['doomscroll:dirtyDays'] = 'not an array';
    expect(await flushDirtyDays()).toEqual([]);
  });

  it('ignores non-string entries in the dirty set', async () => {
    store['doomscroll:dirtyDays'] = ['2026-08-07', 42, null];
    await recordReelView(makeEvent(noon(2026, 8, 7)));
    expect(await flushDirtyDays()).toEqual(['2026-08-07']);
  });
});

describe('backfillMissingAggregates', () => {
  it('rolls up days recorded before aggregation existed', async () => {
    await recordReelView(makeEvent(noon(2026, 8, 5)));
    await recordReelView(makeEvent(noon(2026, 8, 6)));
    await recordReelView(makeEvent(noon(2026, 8, 7)));

    expect((await backfillMissingAggregates()).sort()).toEqual([
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
    ]);
    expect(await getDailyAggregates('2026-08-05', '2026-08-07')).toHaveLength(3);
  });

  it('leaves days that already have an aggregate alone', async () => {
    await recordReelView(makeEvent(noon(2026, 8, 5)));
    await recordReelView(makeEvent(noon(2026, 8, 6)));

    await putDailyAggregate({
      date: '2026-08-05',
      totalReels: 999,
      totalMinutes: 0,
      avgReelsPerSec: 0,
      longestBingeMs: 0,
      categoryBreakdown: {},
    });

    expect(await backfillMissingAggregates()).toEqual(['2026-08-06']);
    const [preserved] = await getDailyAggregates('2026-08-05', '2026-08-05');
    expect(preserved.totalReels).toBe(999);
  });

  it('is a no-op with no history', async () => {
    expect(await backfillMissingAggregates()).toEqual([]);
  });
});

describe('scheduleAggregateFlush', () => {
  it('schedules a flush when none is pending', async () => {
    await scheduleAggregateFlush();
    expect(alarms[AGGREGATE_ALARM]).toBeDefined();
    expect(alarmCreates.count).toBe(1);
  });

  it('does not push the deadline back while one is already pending', async () => {
    // Regression: this used to call chrome.alarms.create on every reel, and
    // Chrome replaces an alarm of the same name — so at a reel every few
    // seconds the 1-minute deadline was reset before it could ever elapse and
    // the flush never ran for the whole scrolling session.
    for (let i = 0; i < 50; i++) await scheduleAggregateFlush();

    expect(alarmCreates.count).toBe(1);
    expect(alarms[AGGREGATE_ALARM]).toBeDefined();
  });

  it('schedules again once the pending alarm has fired', async () => {
    await scheduleAggregateFlush();
    // Chrome removes a one-shot alarm when it fires.
    delete alarms[AGGREGATE_ALARM];

    await scheduleAggregateFlush();
    expect(alarmCreates.count).toBe(2);
  });

  it('never throws when the alarms API is unavailable', async () => {
    const saved = globalThis.chrome.alarms;
    globalThis.chrome.alarms = undefined;
    await expect(scheduleAggregateFlush()).resolves.toBeUndefined();
    globalThis.chrome.alarms = saved;
  });
});

describe('a flush that fails partway', () => {
  // The queue is cleared before the work, so a throw mid-loop would otherwise
  // lose every day not yet reached — permanently, since nothing would ever
  // roll them up again. A missing aggregate is a hole in the baseline
  // detection is computed from.
  const seedDays = async (dates) => {
    for (const [i, date] of dates.entries()) {
      const at = new Date(`${date}T12:00:00`).getTime();
      await recordReelView({
        id: `e${i}`,
        reelShortcode: `r${i}`,
        sessionId: 's1',
        startedAt: at,
        endedAt: at + 5000,
        watchDurationMs: 5000,
        captionText: null,
        hashtags: [],
        audioName: null,
        authorHandle: null,
      });
      await markDayDirty(at);
    }
  };

  it('puts the unfinished days back on the queue', async () => {
    const dates = ['2026-08-01', '2026-08-02', '2026-08-03'];
    await seedDays(dates);
    expect(store[DIRTY_DAYS_KEY]).toHaveLength(3);

    // Fail on the second day.
    let seen = 0;
    const put = putDailyAggregate;
    const boom = new Error('IndexedDB unavailable');
    const spy = vi.spyOn(db, 'putDailyAggregate').mockImplementation(async (a) => {
      if (++seen === 2) throw boom;
      return put(a);
    });

    await expect(flushDirtyDays()).rejects.toThrow(boom);
    spy.mockRestore();

    // The one that succeeded is gone; the two that did not are queued again.
    expect(store[DIRTY_DAYS_KEY].sort()).toEqual(['2026-08-02', '2026-08-03']);
  });

  it('keeps days marked dirty while the flush was running', async () => {
    await seedDays(['2026-08-01', '2026-08-02']);

    let seen = 0;
    const put = putDailyAggregate;
    const spy = vi.spyOn(db, 'putDailyAggregate').mockImplementation(async (a) => {
      // A reel lands on a new day midway through, marking it dirty.
      if (++seen === 1) await markDayDirty(new Date('2026-08-09T12:00:00').getTime());
      if (seen === 2) throw new Error('boom');
      return put(a);
    });

    await expect(flushDirtyDays()).rejects.toThrow();
    spy.mockRestore();

    // The requeue must not clobber the day marked while it was away.
    expect(store[DIRTY_DAYS_KEY]).toContain('2026-08-09');
    expect(store[DIRTY_DAYS_KEY]).toContain('2026-08-02');
  });

  it('empties the queue when everything succeeds', async () => {
    await seedDays(['2026-08-01', '2026-08-02']);
    await flushDirtyDays();
    expect(store[DIRTY_DAYS_KEY]).toEqual([]);
  });
});
