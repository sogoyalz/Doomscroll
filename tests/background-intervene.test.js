import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { closeDB, getInterventionLog, putInterventionLog } from '../src/background/db.ts';
import {
  beginBreak,
  endBreak,
  maybeIntervene,
  readBreak,
  readState,
  recordOutcome,
} from '../src/background/intervene.ts';
import { BREAK_DESTINATION, isBreakActive } from '../src/shared/break.ts';
import { DEFAULT_SETTINGS } from '../src/shared/defaults.ts';
import { COOLDOWN_MS } from '../src/shared/intervene.ts';

const NOW = 1_700_000_000_000;
const LEVELS = DEFAULT_SETTINGS.interventionLevels;

let store = {};
let notifications = [];
let tabMessages = [];
let tabSendFails = false;

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return key in store ? { [key]: store[key] } : {};
      },
      async set(entries) {
        Object.assign(store, entries);
      },
      async remove(key) {
        delete store[key];
      },
    },
  },
  notifications: {
    async create(options) {
      notifications.push(options);
    },
  },
  tabs: {
    async sendMessage(tabId, message) {
      if (tabSendFails) throw new Error('receiving end does not exist');
      tabMessages.push({ tabId, message });
    },
  },
  runtime: { getURL: (p) => `chrome-extension://test/${p}` },
};

/** A detection that fired, with a run long enough for the given level. */
const detection = (over = {}) => ({
  detected: true,
  trigger: 'dominance',
  streak: LEVELS.notifyAfterStreak,
  category: 'sad',
  share: 0.8,
  baselineShare: 0.3,
  ratio: 2.6,
  windowSample: 15,
  chargedSample: 12,
  baselineSample: 300,
  reason: null,
  ...over,
});

const on = { ...DEFAULT_SETTINGS, interventionEnabled: true };

beforeEach(async () => {
  store = {};
  notifications = [];
  tabMessages = [];
  tabSendFails = false;
  await closeDB();
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('doomscroll');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe('maybeIntervene', () => {
  it('does nothing while interventions are switched off', async () => {
    const level = await maybeIntervene(detection(), DEFAULT_SETTINGS, 'session-1', 1, NOW);
    expect(level).toBeNull();
    expect(await getInterventionLog()).toHaveLength(0);
    expect(notifications).toHaveLength(0);
  });

  it('raises a notification for the gentlest level', async () => {
    const level = await maybeIntervene(detection(), on, 'session-1', 1, NOW);
    expect(level).toBe('notify');
    expect(notifications).toHaveLength(1);
    // Nothing is sent to the tab: there is no overlay at this level.
    expect(tabMessages).toHaveLength(0);
  });

  it('describes the feed in the notification, never the person', async () => {
    await maybeIntervene(detection({ streak: 7 }), on, 'session-1', 1, NOW);
    const { message } = notifications[0];
    expect(message).toContain('7');
    expect(message).toContain('sad content');
    expect(message).not.toMatch(/\byou (are|seem|feel|look)\b/i);
  });

  it('sends an overlay to the tab the reel came from', async () => {
    const level = await maybeIntervene(
      detection({ streak: LEVELS.overlayAfterStreak }),
      on,
      'session-1',
      42,
      NOW,
    );
    expect(level).toBe('overlay');
    expect(tabMessages[0].tabId).toBe(42);
    expect(tabMessages[0].message.type).toBe('INTERVENE');
    expect(notifications).toHaveLength(0);
  });

  it('carries the record id out so the dismissal can be correlated back', async () => {
    await maybeIntervene(
      detection({ streak: LEVELS.overlayAfterStreak }),
      on,
      'session-1',
      42,
      NOW,
    );
    const [entry] = await getInterventionLog();
    expect(tabMessages[0].message.payload.id).toBe(entry.id);
  });

  it('records the interruption before showing it', async () => {
    await maybeIntervene(detection(), on, 'session-1', 1, NOW);
    const [entry] = await getInterventionLog();
    expect(entry).toMatchObject({
      level: 'notify',
      category: 'sad',
      streak: LEVELS.notifyAfterStreak,
      outcome: 'pending',
      respondedAt: null,
    });
  });

  it('keeps the record when delivery to the tab fails', async () => {
    // The tab closed between the reel being reported and the overlay being
    // sent. Something was decided and the user never saw it — which is
    // precisely the failure worth being able to count.
    tabSendFails = true;
    const level = await maybeIntervene(
      detection({ streak: LEVELS.overlayAfterStreak }),
      on,
      'session-1',
      42,
      NOW,
    );
    expect(level).toBe('overlay');
    const [entry] = await getInterventionLog();
    expect(entry.outcome).toBe('pending');
  });

  it('does not interrupt twice for the same level in one session', async () => {
    await maybeIntervene(detection(), on, 'session-1', 1, NOW);
    const second = await maybeIntervene(detection(), on, 'session-1', 1, NOW + 1000);
    expect(second).toBeNull();
    expect(await getInterventionLog()).toHaveLength(1);
  });

  it('persists the cooldown so a worker restart cannot reset it', async () => {
    // MV3 kills the worker every 30 idle seconds — far more often than any
    // cooldown elapses. Held in memory, the cooldown would not exist.
    await maybeIntervene(detection(), on, 'session-1', 1, NOW);
    const state = await readState();
    expect(state.lastFiredAt.notify).toBe(NOW);

    const inNewSession = await maybeIntervene(
      detection(),
      on,
      'session-2',
      1,
      NOW + COOLDOWN_MS.notify - 1,
    );
    expect(inNewSession).toBeNull();
  });

  it('escalates to a stronger level as the run grows', async () => {
    await maybeIntervene(detection(), on, 'session-1', 1, NOW);
    const stronger = await maybeIntervene(
      detection({ streak: LEVELS.blockAfterStreak }),
      on,
      'session-1',
      1,
      NOW + 1000,
    );
    expect(stronger).toBe('block');
  });

  it('survives notifications being unavailable', async () => {
    const create = chrome.notifications.create;
    chrome.notifications.create = () => Promise.reject(new Error('no permission'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(maybeIntervene(detection(), on, 'session-1', 1, NOW)).resolves.toBe('notify');

    warn.mockRestore();
    chrome.notifications.create = create;
  });
});

describe('recordOutcome', () => {
  const seed = async (over = {}) => {
    const entry = {
      id: 'i1',
      at: NOW,
      sessionId: 'session-1',
      level: 'overlay',
      category: 'sad',
      streak: 12,
      share: 0.8,
      ratio: 2.1,
      outcome: 'pending',
      respondedAt: null,
      ...over,
    };
    await putInterventionLog(entry);
    return entry;
  };

  it('records that the user took the break', async () => {
    await seed();
    await recordOutcome('i1', 'accepted', NOW + 500);
    const [entry] = await getInterventionLog();
    expect(entry.outcome).toBe('accepted');
    expect(entry.respondedAt).toBe(NOW + 500);
  });

  it('records that the user kept scrolling', async () => {
    await seed();
    await recordOutcome('i1', 'bypassed', NOW + 500);
    expect((await getInterventionLog())[0].outcome).toBe('bypassed');
  });

  it('ignores a dismissal for a record that does not exist', async () => {
    await expect(recordOutcome('missing', 'accepted', NOW)).resolves.toBeUndefined();
  });

  it('keeps the first answer when a duplicate arrives', async () => {
    await seed();
    await recordOutcome('i1', 'accepted', NOW + 500);
    await recordOutcome('i1', 'bypassed', NOW + 900);
    const [entry] = await getInterventionLog();
    expect(entry.outcome).toBe('accepted');
    expect(entry.respondedAt).toBe(NOW + 500);
  });

  it('leaves a stale record from another interruption alone', async () => {
    // Correlating by "most recent pending" instead of by id would resolve this
    // one when the user answered a different, newer overlay.
    await seed({ id: 'stale', at: NOW - 60_000 });
    await seed({ id: 'current' });

    await recordOutcome('current', 'bypassed', NOW + 100);

    const log = await getInterventionLog();
    expect(log.find((e) => e.id === 'stale').outcome).toBe('pending');
    expect(log.find((e) => e.id === 'current').outcome).toBe('bypassed');
  });
});

describe('the break lifecycle', () => {
  const seed = async (over = {}) => {
    const entry = {
      id: 'i1',
      at: NOW,
      sessionId: 'session-1',
      level: 'overlay',
      category: 'sad',
      streak: 12,
      share: 0.8,
      ratio: 2.1,
      outcome: 'accepted',
      respondedAt: NOW,
      breakStartedAt: null,
      breakEndedEarlyAt: null,
      ...over,
    };
    await putInterventionLog(entry);
    return entry;
  };

  it('returns somewhere to go, because leaving the feed is the point', async () => {
    await seed();
    const { goTo } = await beginBreak('i1', NOW);
    expect(goTo).toBe(BREAK_DESTINATION);
  });

  it('stamps the record that offered the break', async () => {
    await seed();
    await beginBreak('i1', NOW);
    expect((await getInterventionLog())[0].breakStartedAt).toBe(NOW);
  });

  it('persists the break so another tab honours it too', async () => {
    await seed();
    await beginBreak('i1', NOW);
    const state = await readBreak();
    expect(state).toMatchObject({ interventionId: 'i1', startedAt: NOW });
    expect(isBreakActive(state, NOW + 60_000)).toBe(true);
  });

  it('still sends the user away when the state cannot be saved', async () => {
    // Losing the state costs the reminder and the observation, not the break:
    // the page still leaves the feed, which is the substantive half.
    const set = chrome.storage.local.set;
    chrome.storage.local.set = () => Promise.reject(new Error('quota'));
    await seed();
    await expect(beginBreak('i1', NOW)).resolves.toEqual({ goTo: BREAK_DESTINATION });
    chrome.storage.local.set = set;
  });

  it('records a break cut short by returning to the feed', async () => {
    await seed();
    await beginBreak('i1', NOW);
    await endBreak(true, NOW + 90_000);

    const [entry] = await getInterventionLog();
    expect(entry.breakEndedEarlyAt).toBe(NOW + 90_000);
    expect(await readBreak()).toBeNull();
  });

  it('leaves the record alone when the break simply lapses', async () => {
    // A window that ran its course is the break working, not failing.
    await seed();
    await beginBreak('i1', NOW);
    await endBreak(false, NOW + 90_000);

    expect((await getInterventionLog())[0].breakEndedEarlyAt).toBeNull();
  });

  it('does not count a return after the window closed', async () => {
    await seed();
    await beginBreak('i1', NOW);
    // Fifteen minutes later the break is over; coming back is not breaking it.
    await endBreak(true, NOW + 60 * 60 * 1000);

    expect((await getInterventionLog())[0].breakEndedEarlyAt).toBeNull();
  });

  it('keeps the first return when several arrive', async () => {
    await seed();
    await beginBreak('i1', NOW);
    await endBreak(true, NOW + 30_000);
    await beginBreak('i1', NOW);
    await endBreak(true, NOW + 60_000);

    expect((await getInterventionLog())[0].breakEndedEarlyAt).toBe(NOW + 30_000);
  });

  it('survives ending a break that was never started', async () => {
    await expect(endBreak(true, NOW)).resolves.toBeUndefined();
  });
});

describe('interventions during a break', () => {
  it('stays silent, and spends nothing', async () => {
    // The failure this prevents: the worker records the interruption and burns
    // the cooldown, the page declines to draw it over the break reminder, and
    // the row sits at 'pending' forever having interrupted no one.
    await beginBreak('i-earlier', NOW);

    const level = await maybeIntervene(
      detection({ streak: LEVELS.blockAfterStreak }),
      on,
      'session-1',
      42,
      NOW + 60_000,
    );

    expect(level).toBeNull();
    expect(tabMessages).toHaveLength(0);
    expect(notifications).toHaveLength(0);
    expect(await getInterventionLog()).toHaveLength(0);
    expect((await readState()).lastFiredAt).toEqual({});
  });

  it('interrupts again once the break has lapsed', async () => {
    await beginBreak('i-earlier', NOW);
    const level = await maybeIntervene(
      detection(),
      on,
      'session-1',
      42,
      // Past endsAt: the break is over and the ladder is live again.
      NOW + 60 * 60 * 1000,
    );
    expect(level).toBe('notify');
  });
});

describe('cost on the path almost every reel takes', () => {
  it('reads nothing when interventions are off', async () => {
    // The default, and the state anyone who never turns it on stays in.
    // Detection runs on every reel; loading cooldowns and break state for each
    // one is work done to reach a conclusion the arguments already give.
    const get = vi.spyOn(chrome.storage.local, 'get');

    await maybeIntervene(detection(), DEFAULT_SETTINGS, 'session-1', 1, NOW);

    expect(get).not.toHaveBeenCalled();
    get.mockRestore();
  });

  it('reads nothing when detection did not fire', async () => {
    const get = vi.spyOn(chrome.storage.local, 'get');

    await maybeIntervene(detection({ detected: false }), on, 'session-1', 1, NOW);

    expect(get).not.toHaveBeenCalled();
    get.mockRestore();
  });

  it('still reads what it needs when an interruption is possible', async () => {
    const get = vi.spyOn(chrome.storage.local, 'get');

    await maybeIntervene(detection(), on, 'session-1', 1, NOW);

    expect(get).toHaveBeenCalled();
    get.mockRestore();
  });
});
