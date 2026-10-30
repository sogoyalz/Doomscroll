import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/defaults.ts';
import { SETTINGS_KEY } from '../src/shared/settings.ts';
import { keepPendingView, readPendingViews } from '../src/shared/pending-views.ts';
import { localDateKey, startOfLocalDayBefore } from '../src/shared/time.ts';
import {
  closeDB,
  getAllReelEvents,
  getDetectionLog,
  getInterventionLog,
  getSession,
  putDailyAggregate,
  recordReelView,
} from '../src/background/db.ts';

let store;
let receive;
let alarm;
const notifications = [];
const tabMessages = [];
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener(fn) {
        receive = fn;
      },
    },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    getURL: (path) => path,
  },
  alarms: {
    create() {},
    async get() {},
    onAlarm: {
      addListener(fn) {
        alarm = fn;
      },
    },
  },
  storage: {
    local: {
      async get(key) {
        return key === null ? { ...store } : { [key]: store[key] };
      },
      async set(values) {
        Object.assign(store, values);
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
      },
    },
  },
  notifications: {
    async create() {
      notifications.push(true);
      return 'notification';
    },
  },
  tabs: {
    async sendMessage(tabId, message) {
      tabMessages.push({ tabId, ...message.payload });
      return { ok: true, data: { shown: true } };
    },
  },
};
await import('../src/background/index.ts');
const NOW = new Date(2026, 9, 30, 12).getTime();
const event = (i, overrides = {}) => ({
  id: `view-${i}`,
  reelShortcode: `synthetic-${i}`,
  sessionId: 'session-current',
  startedAt: NOW + i * 6000,
  endedAt: NOW + i * 6000 + 5000,
  watchDurationMs: 5000,
  captionText: 'crying again tonight, feeling so lonely',
  hashtags: ['sad'],
  audioName: null,
  authorHandle: 'synthetic_creator',
  ...overrides,
});
function send(type, payload, sender = { tab: { id: 42 } }) {
  return new Promise((resolve) => receive({ type, payload }, sender, resolve));
}
async function baseline() {
  for (let i = 1; i <= 7; i++)
    await putDailyAggregate({
      date: localDateKey(startOfLocalDayBefore(NOW, i)),
      totalReels: 100,
      totalMinutes: 10,
      avgReelsPerSec: 0.1,
      longestBingeMs: 60_000,
      categoryBreakdown: { joyful: 90, sad: 10 },
    });
}
beforeEach(async () => {
  store = { [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, interventionEnabled: true } };
  notifications.length = 0;
  tabMessages.length = 0;
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  await closeDB();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('doomscroll');
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('real storage → classification → detection → intervention pipeline', () => {
  it('reaches every default intervention level with a 15-reel dominance window', async () => {
    await baseline();
    for (let i = 0; i < 25; i++)
      expect(await send('REEL_VIEW_LOGGED', event(i))).toEqual({
        ok: true,
        data: { queued: true },
      });
    expect(notifications).toHaveLength(1);
    expect(tabMessages.map((message) => message.level)).toEqual(['overlay', 'block']);
    expect(tabMessages[1]).toMatchObject({ tabId: 42, streak: 20 });
    expect((await getSession('session-current')).reelCount).toBe(25);
    const decisions = await getInterventionLog();
    expect(decisions).toHaveLength(3);
    expect(decisions.every((decision) => decision.deliveredAt === NOW)).toBe(true);
  });

  it('counts a long streak even with unreadable reels between classified reels', async () => {
    await baseline();
    for (let i = 0; i < 40; i++)
      await send(
        'REEL_VIEW_LOGGED',
        event(i, i % 2 ? { captionText: null, hashtags: [] } : {}),
      );
    expect(tabMessages.find((message) => message.level === 'block')?.streak).toBe(20);
  });

  it('does not borrow a previous session’s streak or detection window', async () => {
    await baseline();
    for (let i = 0; i < 25; i++) await send('REEL_VIEW_LOGGED', event(i));
    await send('REEL_VIEW_LOGGED', event(30, { sessionId: 'new-session' }));
    const log = await getDetectionLog();
    expect(log.find((row) => row.sessionId === 'new-session')).toMatchObject({
      detected: false,
      reason: 'insufficient-window-sample',
    });
    expect(tabMessages).toHaveLength(2);
  });

  it('deduplicates concurrent retries in events, session totals, and detection', async () => {
    const view = event(0);
    await Promise.all([send('REEL_VIEW_LOGGED', view), send('REEL_VIEW_LOGGED', view)]);
    expect(await getAllReelEvents()).toHaveLength(1);
    expect(await getSession(view.sessionId)).toMatchObject({
      reelCount: 1,
      totalDurationMs: 5000,
    });
    expect((await getDetectionLog())[0].occurrences).toBe(1);
  });

  it('repairs aggregate bookkeeping after a worker stopped just after saving a view', async () => {
    const view = event(0);
    await recordReelView(view);
    await send('REEL_VIEW_LOGGED', view);
    expect(store['doomscroll:dirtyDays']).toContain(localDateKey(view.startedAt));
    expect((await getSession(view.sessionId)).reelCount).toBe(1);
  });

  it('recovers pending views after an alarm without interrupting an unrelated tab', async () => {
    await baseline();
    for (let i = 0; i < 25; i++) await keepPendingView(event(i));
    alarm({ name: 'doomscroll:delivery' });
    await vi.waitFor(async () => expect(await readPendingViews()).toHaveLength(0));
    expect(await getAllReelEvents()).toHaveLength(25);
    expect(notifications).toHaveLength(0);
    expect(tabMessages).toHaveLength(0);
  });

  it('deletes pending views with history and never replays them after a wipe', async () => {
    await keepPendingView(event(0));
    expect((await send('CLEAR_DATA', {})).ok).toBe(true);
    alarm({ name: 'doomscroll:delivery' });
    // A queued read also waits for the alarm’s serialized history operation.
    await send('GET_SESSIONS', {});
    expect(await readPendingViews()).toHaveLength(0);
    expect(await getAllReelEvents()).toHaveLength(0);
  });

  it('rejects malformed events before writing anything', async () => {
    const result = await send('REEL_VIEW_LOGGED', event(0, { watchDurationMs: -1 }));
    expect(result.ok).toBe(false);
    expect(await getAllReelEvents()).toHaveLength(0);
  });

  it('rejects late views from before a history deletion', async () => {
    await send('CLEAR_DATA', {});
    const reply = await send(
      'REEL_VIEW_LOGGED',
      event(0, {
        startedAt: NOW - 6000,
        endedAt: NOW - 1000,
      }),
    );
    expect(reply.data.queued).toBe(false);
    expect(await getAllReelEvents()).toHaveLength(0);
  });

  it('does not revive paused-period backlog after tracking resumes', async () => {
    await send('UPDATE_SETTINGS', { trackingEnabled: false });
    await send('UPDATE_SETTINGS', { trackingEnabled: true });
    await send('REEL_VIEW_LOGGED', event(0, { startedAt: NOW - 6000, endedAt: NOW - 1000 }));
    expect(await getAllReelEvents()).toHaveLength(0);
  });
});
