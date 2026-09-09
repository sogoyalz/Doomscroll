// Whether a failing database is visible to the user.
//
// The reason this exists: "Nothing tracked yet" is what the popup says when
// you have not scrolled, when tracking is paused, AND when every write has
// been failing for a week. The first two are explained on screen. The third
// was silent, and it is the only one where something is actually being lost.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  noteStorageFailure,
  noteStorageWorking,
  readStorageFailure,
  resetStorageHealthCache,
} from '../src/shared/storage-health.ts';

const KEY = 'doomscroll:storageFailure';
const NOW = 1_700_000_000_000;

let store = {};
let failStorage = false;

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (failStorage) throw new Error('storage unavailable');
        return key in store ? { [key]: store[key] } : {};
      },
      async set(entries) {
        if (failStorage) throw new Error('storage unavailable');
        Object.assign(store, entries);
      },
      async remove(key) {
        if (failStorage) throw new Error('storage unavailable');
        delete store[key];
      },
    },
  },
};

beforeEach(() => {
  store = {};
  failStorage = false;
  resetStorageHealthCache();
});

describe('recording a failure', () => {
  it('records when it happened and what went wrong', async () => {
    await noteStorageFailure(new Error('QuotaExceededError'), NOW);
    const failure = await readStorageFailure();
    expect(failure).toMatchObject({ at: NOW });
    expect(failure.message).toContain('QuotaExceededError');
  });

  it('caps the message so a huge error cannot fill storage', async () => {
    await noteStorageFailure(new Error('x'.repeat(5000)), NOW);
    expect((await readStorageFailure()).message.length).toBeLessThanOrEqual(200);
  });

  it('does not throw when even chrome.storage is gone', async () => {
    // Both stores broken is possible, and this runs inside the write path —
    // it must never be the thing that breaks it.
    failStorage = true;
    await expect(noteStorageFailure(new Error('boom'), NOW)).resolves.toBeUndefined();
  });

  it('reports nothing rather than throwing when storage cannot be read', async () => {
    failStorage = true;
    expect(await readStorageFailure()).toBeNull();
  });
});

describe('clearing on recovery', () => {
  it('clears the failure once a write succeeds', async () => {
    await noteStorageFailure(new Error('full'), NOW);
    await noteStorageWorking();
    expect(await readStorageFailure()).toBeNull();
  });

  it('clears a failure left behind by an earlier worker', async () => {
    // MV3 kills the worker every 30 idle seconds, so the process that failed
    // is usually not the one that recovers. A fresh context has to find out.
    store[KEY] = { at: NOW, message: 'from a previous worker' };
    resetStorageHealthCache();

    await noteStorageWorking();
    expect(await readStorageFailure()).toBeNull();
  });
});

describe('cost on a healthy install', () => {
  it('reads storage once per context, then never again', async () => {
    // This runs after every single reel. On an install that has never failed
    // it must be free, or it is a storage round trip a dozen times a minute
    // to learn nothing.
    const get = vi.spyOn(chrome.storage.local, 'get');

    for (let i = 0; i < 50; i++) await noteStorageWorking();

    expect(get).toHaveBeenCalledTimes(1);
    get.mockRestore();
  });

  it('never writes when there is nothing to clear', async () => {
    const set = vi.spyOn(chrome.storage.local, 'set');
    const remove = vi.spyOn(chrome.storage.local, 'remove');

    for (let i = 0; i < 20; i++) await noteStorageWorking();

    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    set.mockRestore();
    remove.mockRestore();
  });
});
