import { describe, test, expect, beforeEach, vi } from 'vitest';

// Minimal chrome.storage.local fake. get/set resolve on a real timer tick (not
// just a microtask) so concurrent appendRecord calls actually interleave the
// way they would with the real async chrome API — this is what reproduces the
// read-modify-write race if the queueing in storage.js is removed.
function installFakeChromeStorage() {
  let store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get(keys, cb) {
          setTimeout(() => {
            const result = {};
            const keyList = Array.isArray(keys) ? keys : Object.keys(keys);
            for (const key of keyList) {
              result[key] = key in store ? store[key] : keys[key];
            }
            cb(result);
          }, 0);
        },
        set(data, cb) {
          setTimeout(() => {
            store = { ...store, ...data };
            cb();
          }, 0);
        },
      },
      onChanged: { addListener() {} },
    },
  };
  return () => store;
}

describe('appendRecord', () => {
  let getStore;

  beforeEach(() => {
    vi.resetModules();
    getStore = installFakeChromeStorage();
  });

  test('concurrent appends do not clobber each other', async () => {
    const { appendRecord } = await import('../src/lib/storage.ts');

    await Promise.all([
      appendRecord({ id: 1 }),
      appendRecord({ id: 2 }),
      appendRecord({ id: 3 }),
    ]);

    const store = getStore();
    expect(store.reel_records).toHaveLength(3);
    expect(store.reelCount).toBe(3);
    expect(store.reel_records.map((r) => r.id).sort()).toEqual([1, 2, 3]);
  });

  test('caps reel_records at 2000, dropping the oldest first', async () => {
    const { appendRecord } = await import('../src/lib/storage.ts');

    for (let i = 0; i < 2005; i++) {
      await appendRecord({ id: i });
    }

    const store = getStore();
    expect(store.reel_records).toHaveLength(2000);
    expect(store.reel_records[0].id).toBe(5);
    expect(store.reel_records[1999].id).toBe(2004);
    expect(store.reelCount).toBe(2005);
  });
});
