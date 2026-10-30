import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeDB,
  getDB,
  getRecentSessionEvents,
  getSessionStreak,
} from '../src/background/db.ts';

beforeEach(async () => {
  await closeDB();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('doomscroll');
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
});

describe('schema 4 → 5 upgrade', () => {
  it('indexes existing events without losing history or mixing sessions', async () => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('doomscroll', 4);
      open.onupgradeneeded = () => {
        const db = open.result;
        const events = db.createObjectStore('reelEvents', { keyPath: 'id' });
        events.createIndex('by-startedAt', 'startedAt');
        events.createIndex('by-session', 'sessionId');
        for (let i = 0; i < 25; i++)
          events.put({
            id: `old-${i}`,
            sessionId: 'old-session',
            startedAt: 1000 + i * 10,
            category: 'sad',
          });
        events.put({
          id: 'other',
          sessionId: 'other-session',
          startedAt: 99999,
          category: 'comedy',
        });
      };
      open.onsuccess = () => {
        open.result.close();
        resolve();
      };
      open.onerror = () => reject(open.error);
    });
    const db = await getDB();
    expect(db.version).toBe(5);
    expect(await db.count('reelEvents')).toBe(26);
    expect((await getRecentSessionEvents('old-session', 15)).map((event) => event.id)).toEqual(
      Array.from({ length: 15 }, (_, i) => `old-${24 - i}`),
    );
    expect(await getSessionStreak('old-session', 'sad')).toBe(25);
  });
});
