import { describe, it, expect, beforeEach } from 'vitest';
import { currentSessionId } from '../src/content/session.ts';
import { DEFAULT_SETTINGS } from '../src/shared/defaults.ts';

let store = {};
let failStorage = false;

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (failStorage) throw new Error('extension context invalidated');
        return key in store ? { [key]: store[key] } : {};
      },
      async set(entries) {
        if (failStorage) throw new Error('extension context invalidated');
        Object.assign(store, entries);
      },
    },
  },
};

const MINUTE = 60_000;

beforeEach(() => {
  store = {};
  failStorage = false;
});

describe('currentSessionId', () => {
  it('mints an id on first use', async () => {
    const id = await currentSessionId(1_000_000);
    expect(id).toBeTruthy();
    expect(store['doomscroll:session'].id).toBe(id);
  });

  it('reuses the id for activity inside the gap', async () => {
    const first = await currentSessionId(1_000_000);
    const second = await currentSessionId(1_000_000 + MINUTE);
    expect(second).toBe(first);
  });

  it('starts a new session after the gap elapses', async () => {
    const first = await currentSessionId(1_000_000);
    const second = await currentSessionId(
      1_000_000 + DEFAULT_SETTINGS.sessionGapThresholdMs + 1,
    );
    expect(second).not.toBe(first);
  });

  it('advances the activity stamp so the window slides', async () => {
    // Continuous scrolling should stay one session, not expire on a fixed
    // deadline measured from when it started.
    const first = await currentSessionId(0);
    let last = first;
    for (let t = MINUTE; t <= 10 * MINUTE; t += MINUTE) {
      last = await currentSessionId(t);
    }
    expect(last).toBe(first);
  });

  it('honours a shorter threshold configured in settings', async () => {
    // Regression: the content script used to read the default and ignore the
    // user's configured value entirely.
    //
    // One minute rather than thirty seconds because settings are clamped to
    // the range the options page offers, and a sub-minute gap is not one of
    // them — the shortest a user can choose is a minute. The value was only
    // ever picked for being shorter than the default, and this one still is.
    store['doomscroll:settings'] = { sessionGapThresholdMs: MINUTE };

    const first = await currentSessionId(0);
    const second = await currentSessionId(MINUTE + 1000);
    expect(second).not.toBe(first);
  });

  it('honours a longer threshold configured in settings', async () => {
    store['doomscroll:settings'] = { sessionGapThresholdMs: 60 * MINUTE };

    const first = await currentSessionId(0);
    const second = await currentSessionId(10 * MINUTE);
    expect(second).toBe(first);
  });

  it('lets an explicit threshold override settings', async () => {
    store['doomscroll:settings'] = { sessionGapThresholdMs: 60 * MINUTE };

    const first = await currentSessionId(0, 1000);
    const second = await currentSessionId(2000, 1000);
    expect(second).not.toBe(first);
  });

  it('returns a fresh id when storage is unreachable', async () => {
    failStorage = true;
    const id = await currentSessionId(1_000_000);
    expect(id).toBeTruthy();
  });

  it('recovers from a corrupted session record', async () => {
    store['doomscroll:session'] = 'not an object';
    const id = await currentSessionId(1_000_000);
    expect(id).toBeTruthy();
    expect(store['doomscroll:session'].id).toBe(id);
  });
});
