// The message router, driven the way Chrome drives it.
//
// Untested until an ordering bug lived here undetected: the reel was stored,
// then detection threw, and the day was never queued for aggregation — which
// starves the baseline detection itself depends on. The bug was invisible
// because every unit below the router passed.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const detect = vi.hoisted(() => ({ runDetection: vi.fn() }));
vi.mock('../src/background/detect.ts', () => detect);

let store = {};
let listener;
let alarmListener;

globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener: (fn) => {
        listener = fn;
      },
    },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    getURL: (p) => p,
  },
  alarms: {
    onAlarm: {
      addListener(fn) {
        alarmListener = fn;
      },
    },
    create() {},
    async get() {
      return undefined;
    },
    async clear() {
      return true;
    },
  },
  storage: {
    local: {
      async get(key) {
        if (key == null) return { ...store };
        return key in store ? { [key]: store[key] } : {};
      },
      async set(entries) {
        Object.assign(store, entries);
      },
      async remove(key) {
        delete store[key];
      },
    },
    onChanged: { addListener() {} },
  },
  notifications: { async create() {} },
  tabs: { async sendMessage() {} },
};

await import('../src/background/index.ts');

const { closeDB, getAllReelEvents } = await import('../src/background/db.ts');
const { DIRTY_DAYS_KEY } = await import('../src/background/aggregator.ts');
const { readStorageFailure, resetStorageHealthCache } =
  await import('../src/shared/storage-health.ts');
const db = await import('../src/background/db.ts');
const aggregator = await import('../src/background/aggregator.ts');

const NOW = new Date(2026, 7, 20, 15, 0, 0).getTime();

const payload = (over = {}) => ({
  id: `e${Math.random()}`,
  reelShortcode: 'abc',
  sessionId: 'session-1',
  startedAt: NOW,
  endedAt: NOW + 5000,
  watchDurationMs: 5000,
  captionText: 'a caption',
  hashtags: [],
  audioName: null,
  authorHandle: 'someone',
  ...over,
});

/** Invokes the router the way chrome.runtime does, and resolves its reply. */
function send(message) {
  return new Promise((resolve) => {
    const returned = listener(message, {}, resolve);
    if (returned !== true) resolve(undefined);
  });
}

beforeEach(async () => {
  store = {};
  detect.runDetection.mockReset();
  detect.runDetection.mockResolvedValue({
    detected: false,
    trigger: null,
    streak: 0,
    category: null,
    share: 0,
    baselineShare: 0,
    ratio: 0,
    windowSample: 0,
    chargedSample: 0,
    baselineSample: 0,
    reason: 'insufficient-history',
  });
  await closeDB();
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('doomscroll');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe('REEL_VIEW_LOGGED', () => {
  it('recovers later queued views when an earlier record fails, then retries it safely', async () => {
    const first = payload({ id: 'retry-first' });
    const second = payload({ id: 'retry-second', startedAt: NOW + 1, endedAt: NOW + 5001 });
    for (const event of [first, second]) {
      store['doomscroll:pendingView:' + event.id] = { event, queuedAt: Date.now() };
    }
    const original = db.recordReelViewOnce;
    const spy = vi
      .spyOn(db, 'recordReelViewOnce')
      .mockImplementation((event, classification) => {
        if (event.id === first.id) return Promise.reject(new Error('synthetic write failure'));
        return original(event, classification);
      });
    try {
      alarmListener({ name: 'doomscroll:delivery' });
      await vi.waitFor(async () => {
        expect((await getAllReelEvents()).map((event) => event.id)).toEqual([second.id]);
        expect(store['doomscroll:pendingView:' + second.id]).toBeUndefined();
      });
      expect(store['doomscroll:pendingView:' + first.id]).toBeDefined();
      spy.mockRestore();
      alarmListener({ name: 'doomscroll:delivery' });
      await vi.waitFor(async () => {
        expect(await getAllReelEvents()).toHaveLength(2);
        expect(store['doomscroll:pendingView:' + first.id]).toBeUndefined();
      });
    } finally {
      spy.mockRestore();
    }
  });
  it('stores the reel and queues its day', async () => {
    const result = await send({ type: 'REEL_VIEW_LOGGED', payload: payload() });

    expect(result).toEqual({ ok: true, data: { queued: true } });
    expect(await getAllReelEvents()).toHaveLength(1);
    expect(store[DIRTY_DAYS_KEY]).toContain('2026-08-20');
  });

  it('still queues the day when detection throws', async () => {
    // The regression. Aggregation is what produces the daily rollups the
    // baseline is computed from, so skipping it on a detection failure
    // starves the thing that failed — silently, and self-reinforcingly.
    detect.runDetection.mockRejectedValue(new Error('detection blew up'));

    const result = await send({ type: 'REEL_VIEW_LOGGED', payload: payload() });

    expect(await getAllReelEvents()).toHaveLength(1);
    expect(store[DIRTY_DAYS_KEY]).toContain('2026-08-20');
    // And the view still counts as logged: that is what the message promises,
    // and the content script drops the reel entirely on a rejection.
    expect(result).toEqual({ ok: true, data: { queued: true } });
  });

  it('records nothing at all while tracking is paused', async () => {
    store['doomscroll:settings'] = { trackingEnabled: false };

    const result = await send({ type: 'REEL_VIEW_LOGGED', payload: payload() });

    expect(result).toEqual({ ok: true, data: { queued: false } });
    expect(await getAllReelEvents()).toHaveLength(0);
    expect(store[DIRTY_DAYS_KEY]).toBeUndefined();
  });
});

describe('the router itself', () => {
  it('releases the channel for a message it does not handle', async () => {
    // Returning true would leave the sender hanging until the port closed.
    expect(listener({ type: 'NOT_A_REAL_MESSAGE', payload: {} }, {}, () => {})).toBe(false);
  });

  it('holds the channel open for a message it does handle', async () => {
    // The mirror of the case above: returning anything but true here closes
    // the port before the async handler can reply, and every read silently
    // resolves undefined.
    expect(listener({ type: 'GET_SETTINGS', payload: {} }, {}, () => {})).toBe(true);
  });

  it('wraps a handler result in the ok envelope', async () => {
    const result = await send({ type: 'GET_SETTINGS', payload: {} });
    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty('trackingEnabled');
  });
});

describe('CLEAR_DATA', () => {
  it('forgets the days still queued for a rollup', async () => {
    // Left behind, the queue rolls the deleted days up as empty aggregates on
    // the next alarm — putting days back on the charts after a wipe.
    const { getDailyAggregates } = await import('../src/background/db.ts');

    await send({ type: 'REEL_VIEW_LOGGED', payload: payload() });
    expect(store[DIRTY_DAYS_KEY]).toContain('2026-08-20');

    await send({ type: 'CLEAR_DATA', payload: {} });
    expect(store[DIRTY_DAYS_KEY]).toBeUndefined();

    // And flushing now finds nothing to resurrect.
    const { flushDirtyDays } = await import('../src/background/aggregator.ts');
    await flushDirtyDays();
    expect(await getDailyAggregates('2026-08-01', '2026-08-31')).toEqual([]);
  });

  it('ends a break that is still running', async () => {
    // Otherwise the reminder keeps interrupting someone who has just asked for
    // everything to be forgotten, pointing at a record that no longer exists.
    const { beginBreak, readBreak } = await import('../src/background/intervene.ts');
    await beginBreak('i1', NOW);
    expect(await readBreak()).not.toBeNull();

    await send({ type: 'CLEAR_DATA', payload: {} });

    expect(await readBreak()).toBeNull();
  });

  it('does not record that break as one the user broke', async () => {
    // Ending it is a consequence of the deletion, not a statement about them.
    const { beginBreak } = await import('../src/background/intervene.ts');
    const { putInterventionLog, getInterventionLog } = await import('../src/background/db.ts');

    await putInterventionLog({
      id: 'i1',
      at: NOW,
      sessionId: 's1',
      level: 'overlay',
      category: 'sad',
      streak: 12,
      share: 0.8,
      ratio: 2,
      outcome: 'accepted',
      respondedAt: NOW,
      breakStartedAt: null,
      breakEndedEarlyAt: null,
    });
    await beginBreak('i1', NOW);
    await send({ type: 'CLEAR_DATA', payload: {} });

    // The row is gone with the rest of the history; nothing was stamped on the
    // way out, which is what would have happened had this counted as early.
    expect(await getInterventionLog()).toHaveLength(0);
  });
});

describe('a database that will not take writes', () => {
  // Without this the popup reads "Nothing tracked yet" — the same words it
  // uses when you simply have not scrolled — while every reel is being lost.
  it('records the failure where the dashboard can find it', async () => {
    resetStorageHealthCache();
    const spy = vi
      .spyOn(db, 'recordReelViewOnce')
      .mockRejectedValue(new Error('QuotaExceededError'));

    await send({ type: 'REEL_VIEW_LOGGED', payload: payload() });

    const failure = await readStorageFailure();
    expect(failure).not.toBeNull();
    expect(failure.message).toContain('QuotaExceededError');
    spy.mockRestore();
  });

  it('does not aggregate a day whose reel was never stored', async () => {
    resetStorageHealthCache();
    const spy = vi.spyOn(db, 'recordReelViewOnce').mockRejectedValue(new Error('disk full'));

    await send({ type: 'REEL_VIEW_LOGGED', payload: payload() });

    // Nothing was written, so there is nothing to roll up — marking the day
    // dirty would schedule an aggregate over an event that does not exist.
    expect(store[DIRTY_DAYS_KEY]).toBeUndefined();
    spy.mockRestore();
  });

  it('clears the warning once writes start working again', async () => {
    resetStorageHealthCache();
    const spy = vi.spyOn(db, 'recordReelViewOnce').mockRejectedValue(new Error('disk full'));
    await send({ type: 'REEL_VIEW_LOGGED', payload: payload() });
    expect(await readStorageFailure()).not.toBeNull();
    spy.mockRestore();

    await send({ type: 'REEL_VIEW_LOGGED', payload: payload() });
    expect(await readStorageFailure()).toBeNull();
  });
});

describe('what counts as a storage failure', () => {
  it('does not blame storage for a classifier that threw', async () => {
    // The message a storage failure produces sends the user to look at their
    // disk. Attributing an unrelated throw to it sends them to look at the one
    // thing that was working.
    resetStorageHealthCache();
    const classify = await import('../src/background/classify.ts');
    const spy = vi.spyOn(classify, 'classifyReel').mockImplementation(() => {
      throw new Error('lexicon exploded');
    });

    await send({ type: 'REEL_VIEW_LOGGED', payload: payload() });

    expect(await readStorageFailure()).toBeNull();
    spy.mockRestore();
  });
});

describe('UPDATE_SETTINGS replies with what was stored', () => {
  // The page applies a settings change optimistically and then adopts this
  // reply. When it was `{ ok: true }` the optimistic value was the only one
  // the page ever had, so an out-of-range number stayed on screen looking
  // saved while detection ran on the clamped one.
  it('returns the clamped value, not the value that was sent', async () => {
    const reply = await send({
      type: 'UPDATE_SETTINGS',
      payload: { patternWindowSize: 999 },
    });

    expect(reply.ok).toBe(true);
    expect(reply.data.patternWindowSize).toBe(100);
  });

  it('returns the floor when the field was emptied', async () => {
    // An emptied <input type="number"> reads as 0, which is a window that can
    // never fire. The page has to be told the stored value is 8.
    const reply = await send({
      type: 'UPDATE_SETTINGS',
      payload: { patternWindowSize: 0 },
    });

    expect(reply.data.patternWindowSize).toBeGreaterThan(0);
    expect(reply.data.patternWindowSize).toBe(
      (await send({ type: 'GET_SETTINGS', payload: {} })).data.patternWindowSize,
    );
  });

  it('returns the whole settings object, not just the patched field', async () => {
    const reply = await send({
      type: 'UPDATE_SETTINGS',
      payload: { trackingEnabled: false },
    });

    expect(reply.data.trackingEnabled).toBe(false);
    expect(reply.data.watchedCategories).toBeInstanceOf(Array);
    expect(reply.data.interventionLevels).toBeTruthy();
  });
});

describe('EXPORT_DATA builds one export per call', () => {
  beforeEach(async () => {
    await send({ type: 'REEL_VIEW_LOGGED', payload: payload() });
  });

  it('returns the reels CSV under its own filename', async () => {
    const { data } = await send({ type: 'EXPORT_DATA', payload: { which: 'reels' } });

    expect(data.filename).toBe('doomscroll-reels.csv');
    expect(data.csv).toContain('reelShortcode');
  });

  it('returns the detection log under its own filename', async () => {
    const { data } = await send({ type: 'EXPORT_DATA', payload: { which: 'detection' } });

    expect(data.filename).toBe('doomscroll-detection-log.csv');
  });

  it('reads only the store the caller asked for', async () => {
    // The point of the `which` parameter. Building all three meant a click on
    // "Export reels" walked both logs as well and threw the results away.
    const reels = vi.spyOn(db, 'getAllReelEvents');
    const detection = vi.spyOn(db, 'getDetectionLog');

    await send({ type: 'EXPORT_DATA', payload: { which: 'reels' } });

    expect(reels).toHaveBeenCalled();
    expect(detection).not.toHaveBeenCalled();
    reels.mockRestore();
    detection.mockRestore();
  });
});

describe('changing the session gap rebuilds history', () => {
  // sessionGapThresholdMs is baked into every stored aggregate's
  // longestBingeMs. Nothing reacted to it changing, and only today is ever
  // recomputed on demand, so past days kept the old value permanently and the
  // dashboard mixed two different measures on one chart.
  const MIN = 60_000;

  it('recomputes past days when the gap actually changes', async () => {
    const spy = vi.spyOn(aggregator, 'recomputeAllDays').mockResolvedValue([]);

    await send({ type: 'UPDATE_SETTINGS', payload: { sessionGapThresholdMs: 10 * MIN } });

    expect(spy).toHaveBeenCalledWith(10 * MIN);
    spy.mockRestore();
  });

  it('does not rebuild when the gap is unchanged', async () => {
    await send({ type: 'UPDATE_SETTINGS', payload: { sessionGapThresholdMs: 10 * MIN } });
    const spy = vi.spyOn(aggregator, 'recomputeAllDays').mockResolvedValue([]);

    await send({ type: 'UPDATE_SETTINGS', payload: { sessionGapThresholdMs: 10 * MIN } });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not rebuild for a setting that has nothing to do with rollups', async () => {
    const spy = vi.spyOn(aggregator, 'recomputeAllDays').mockResolvedValue([]);

    await send({ type: 'UPDATE_SETTINGS', payload: { debugHud: true } });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('compares against the stored value, not the clamped patch', async () => {
    // 500 minutes clamps to the 120-minute ceiling. Sending it twice must
    // rebuild once: the second write stores the same value as the first.
    await send({ type: 'UPDATE_SETTINGS', payload: { sessionGapThresholdMs: 500 * MIN } });
    const spy = vi.spyOn(aggregator, 'recomputeAllDays').mockResolvedValue([]);

    await send({ type: 'UPDATE_SETTINGS', payload: { sessionGapThresholdMs: 500 * MIN } });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('still replies with the stored settings when the rebuild fails', async () => {
    const spy = vi
      .spyOn(aggregator, 'recomputeAllDays')
      .mockRejectedValue(new Error('disk full'));

    const reply = await send({
      type: 'UPDATE_SETTINGS',
      payload: { sessionGapThresholdMs: 7 * MIN },
    });

    expect(reply.ok).toBe(true);
    expect(reply.data.sessionGapThresholdMs).toBe(7 * MIN);
    spy.mockRestore();
  });
});
