import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  closeDB,
  getAllReelEvents,
  getDailyAggregates,
  recordReelView,
} from '../src/background/db.ts';
import { reclassifyAll, reclassifyIfLexiconChanged } from '../src/background/reclassify.ts';
import { classifyReel } from '../src/background/classify.ts';
import { LEXICON_VERSION } from '../src/shared/lexicon.ts';
import { UNCLASSIFIED } from '../src/shared/aggregation.ts';

let store = {};

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
};

let nextId = 0;

function makeEvent({ captionText = null, hashtags = [], audioName = null, startedAt } = {}) {
  const at = startedAt ?? new Date(2026, 7, 7, 12, 0, 0).getTime();
  return {
    id: `e${nextId++}`,
    reelShortcode: 'abc',
    sessionId: 's1',
    startedAt: at,
    endedAt: at + 5000,
    watchDurationMs: 5000,
    captionText,
    hashtags,
    audioName,
  };
}

beforeEach(async () => {
  store = {};
  nextId = 0;
  await closeDB();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('doomscroll');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});

describe('classification on the write path', () => {
  it('stores the category alongside the event', async () => {
    const event = makeEvent({ captionText: 'crying again, so lonely', hashtags: ['sad'] });
    await recordReelView(event, classifyReel(event));

    const [stored] = await getAllReelEvents();
    expect(stored.category).toBe('sad');
    expect(stored.categoryConfidence).toBeGreaterThan(0);
    expect(stored.subtags.length).toBeGreaterThan(0);
  });

  it('stores a reel with no text as unclassified, not neutral', async () => {
    const event = makeEvent();
    await recordReelView(event, classifyReel(event));

    const [stored] = await getAllReelEvents();
    expect(stored.category).toBeNull();
    expect(stored.categoryConfidence).toBeNull();
  });

  it('keeps the inputs needed to re-score later', async () => {
    // Discarding these would make the lexicon un-tunable without a data wipe.
    const event = makeEvent({ captionText: 'hello', hashtags: ['fyp'], audioName: 'A · B' });
    await recordReelView(event, classifyReel(event));

    const [stored] = await getAllReelEvents();
    expect(stored.captionText).toBe('hello');
    expect(stored.hashtags).toEqual(['fyp']);
    expect(stored.audioName).toBe('A · B');
  });
});

describe('reclassifyAll', () => {
  it('re-labels events stored without a category', async () => {
    // Simulates history written before classification existed.
    await recordReelView(makeEvent({ captionText: 'my anxiety is spiraling' }), null);
    expect((await getAllReelEvents())[0].category).toBeNull();

    expect(await reclassifyAll()).toBe(1);
    expect((await getAllReelEvents())[0].category).toBe('anxious');
  });

  it('reports zero when nothing changes', async () => {
    const event = makeEvent({ captionText: 'my anxiety is spiraling' });
    await recordReelView(event, classifyReel(event));

    expect(await reclassifyAll()).toBe(0);
  });

  it('rebuilds daily aggregates so the breakdown is not left stale', async () => {
    await recordReelView(makeEvent({ captionText: 'crying again tonight' }), null);
    await reclassifyAll();

    const [aggregate] = await getDailyAggregates('2026-08-07', '2026-08-07');
    expect(aggregate.categoryBreakdown).toEqual({ sad: 1 });
    expect(aggregate.categoryBreakdown[UNCLASSIFIED]).toBeUndefined();
  });

  it('is a no-op with no history', async () => {
    expect(await reclassifyAll()).toBe(0);
  });

  it('leaves genuinely unclassifiable reels unclassified', async () => {
    await recordReelView(makeEvent(), null);
    await reclassifyAll();
    expect((await getAllReelEvents())[0].category).toBeNull();
  });
});

describe('reclassifyIfLexiconChanged', () => {
  it('runs when no version has been recorded yet', async () => {
    await recordReelView(makeEvent({ captionText: 'so much anxiety' }), null);

    expect(await reclassifyIfLexiconChanged()).toBe(1);
    expect(store['doomscroll:lexiconVersion']).toBe(LEXICON_VERSION);
  });

  it('skips when the stored version already matches', async () => {
    store['doomscroll:lexiconVersion'] = LEXICON_VERSION;
    await recordReelView(makeEvent({ captionText: 'so much anxiety' }), null);

    // Left unclassified precisely because the pass was skipped.
    expect(await reclassifyIfLexiconChanged()).toBe(0);
    expect((await getAllReelEvents())[0].category).toBeNull();
  });

  it('runs again once the version moves on', async () => {
    store['doomscroll:lexiconVersion'] = LEXICON_VERSION - 1;
    await recordReelView(makeEvent({ captionText: 'so much anxiety' }), null);

    expect(await reclassifyIfLexiconChanged()).toBe(1);
    expect((await getAllReelEvents())[0].category).toBe('anxious');
  });
});
