import { beforeEach, describe, expect, it } from 'vitest';
import {
  keepPendingView,
  readPendingViews,
  clearPendingViews,
  isNewReelEvent,
  PENDING_VIEW_PREFIX,
  PENDING_VIEW_MAX_AGE_MS,
} from '../src/shared/pending-views.ts';

let store;
globalThis.chrome = {
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
};
const view = (id = 'example') => ({
  id,
  reelShortcode: 'synthetic',
  sessionId: 'session',
  startedAt: 1000,
  endedAt: 6000,
  watchDurationMs: 5000,
  captionText: null,
  hashtags: [],
  audioName: null,
  authorHandle: null,
});
beforeEach(() => {
  store = {};
});

describe('durable pending views', () => {
  it('keeps separate views without overwriting another tab’s pending copy', async () => {
    await Promise.all([keepPendingView(view('a')), keepPendingView(view('b'))]);
    expect(await readPendingViews()).toHaveLength(2);
  });
  it('expires stale, corrupt, and mismatched records without exposing their contents', async () => {
    const now = Date.now();
    store[PENDING_VIEW_PREFIX + 'stale'] = {
      event: view('stale'),
      queuedAt: now - PENDING_VIEW_MAX_AGE_MS - 1,
    };
    store[PENDING_VIEW_PREFIX + 'corrupt'] = { event: {}, queuedAt: now };
    store[PENDING_VIEW_PREFIX + 'mismatch'] = { event: view('other'), queuedAt: now };
    expect(await readPendingViews(now)).toEqual([]);
    expect(store).toEqual({});
  });
  it('clears only pending copies, preserving settings', async () => {
    store['doomscroll:settings'] = { trackingEnabled: true };
    await keepPendingView(view());
    await clearPendingViews();
    expect(store).toEqual({ 'doomscroll:settings': { trackingEnabled: true } });
  });
  it.each([
    { watchDurationMs: NaN },
    { watchDurationMs: -1 },
    { watchDurationMs: 6001 },
    { endedAt: Infinity },
    { id: '' },
    { hashtags: [null] },
    { captionText: 'x'.repeat(30_001) },
  ])('rejects malformed or oversized event fields: %j', (overrides) => {
    expect(isNewReelEvent({ ...view(), ...overrides })).toBe(false);
  });
});
