import { describe, it, expect, beforeEach } from 'vitest';
import {
  fallbackIdentityShare,
  isAudioDark,
  isDrifting,
  isShortcodeDegraded,
  readHealth,
  recordExtraction,
  textlessShare,
} from '../src/shared/health.ts';

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

beforeEach(() => {
  store = {};
  failStorage = false;
});

async function record(count, outcome) {
  for (let i = 0; i < count; i++) await recordExtraction(outcome);
}

const GOOD = { hasAuthor: true, hasText: true, hasAudio: true };
const NO_AUTHOR = { hasAuthor: false, hasText: false, hasAudio: false };
const NO_TEXT = { hasAuthor: true, hasText: false, hasAudio: false };
const NO_AUDIO = { hasAuthor: true, hasText: true, hasAudio: false };

describe('readHealth', () => {
  it('starts empty', async () => {
    expect(await readHealth()).toMatchObject({ samples: 0, missingAuthor: 0, missingText: 0 });
  });

  it('survives a corrupted record', async () => {
    store['doomscroll:extractionHealth'] = 'not an object';
    expect((await readHealth()).samples).toBe(0);
  });

  it('returns empty when storage is unreachable', async () => {
    failStorage = true;
    expect((await readHealth()).samples).toBe(0);
  });
});

describe('recordExtraction', () => {
  it('counts successful extractions without flagging anything', async () => {
    await record(20, GOOD);
    const health = await readHealth();
    expect(health.samples).toBe(20);
    expect(health.missingAuthor).toBe(0);
    expect(isDrifting(health)).toBe(false);
  });

  it('caps the rolling sample rather than growing forever', async () => {
    await record(200, GOOD);
    expect((await readHealth()).samples).toBeLessThanOrEqual(50);
  });

  it('never throws when storage fails', async () => {
    failStorage = true;
    await expect(recordExtraction(GOOD)).resolves.toBeUndefined();
  });

  it('stamps the update time', async () => {
    await recordExtraction({ ...GOOD, now: 1_700_000_000_000 });
    expect((await readHealth()).lastUpdated).toBe(1_700_000_000_000);
  });
});

describe('isDrifting', () => {
  it('stays quiet on too small a sample', async () => {
    // One unhydrated placeholder early on must not raise an alarm.
    await record(3, NO_AUTHOR);
    expect(isDrifting(await readHealth())).toBe(false);
  });

  it('tolerates the placeholder rate seen in the wild', async () => {
    // dom-notes observed 2 unhydrated slots out of 9 containers.
    await record(20, GOOD);
    await record(6, NO_AUTHOR);
    expect(isDrifting(await readHealth())).toBe(false);
  });

  it('fires when the author handle stops resolving on most reels', async () => {
    // The signature of Instagram changing its markup: extraction does not
    // throw, it just quietly returns nulls.
    await record(30, NO_AUTHOR);
    expect(isDrifting(await readHealth())).toBe(true);
  });

  it('recovers once extraction starts working again', async () => {
    await record(30, NO_AUTHOR);
    expect(isDrifting(await readHealth())).toBe(true);

    await record(60, GOOD);
    expect(isDrifting(await readHealth())).toBe(false);
  });

  it('decays a failure count away, not to a stuck remainder', async () => {
    // Both integer decay schemes were tried and both were wrong, in opposite
    // directions. Math.round has fixed points — at a 50-sample window a count
    // of 25 decays to 24.5 and rounds back to 25 — which latched the alarm at
    // the threshold forever after a selector was fixed. Math.floor cured the
    // latching and caused something worse: floor(n × 49/50) loses exactly one
    // for every n from 1 to 50, so a counter could only hold its value if
    // every single sample incremented it, and no partial failure was ever
    // visible (see 'a sustained partial failure' below).
    //
    // Fractional decay has neither problem. It asymptotes rather than landing
    // on zero, so the assertion is that the count has become negligible — not
    // that it hit an exact integer, which is the detail that hid the bug.
    await record(60, NO_AUTHOR);
    await record(300, GOOD);
    const health = await readHealth();
    expect(health.missingAuthor / health.samples).toBeLessThan(0.01);
  });

  it('still reaches a high failure count while extraction is genuinely broken', async () => {
    // The other half of the decay contract: decay must not damp a real,
    // sustained failure into looking healthy.
    await record(300, NO_AUTHOR);
    const health = await readHealth();
    expect(health.missingAuthor / health.samples).toBeGreaterThan(0.9);
  });

  it('does not treat missing text as drift', async () => {
    // Captionless reels are normal; only the author field is load-bearing.
    await record(30, NO_TEXT);
    expect(isDrifting(await readHealth())).toBe(false);
  });
});

describe('textlessShare', () => {
  it('reports the share of reels with nothing to classify', async () => {
    await record(10, GOOD);
    await record(10, NO_TEXT);
    expect(textlessShare(await readHealth())).toBeCloseTo(0.5);
  });

  it('is zero with no samples', () => {
    expect(
      textlessShare({ samples: 0, missingAuthor: 0, missingText: 0, missingAudio: 0, lastUpdated: 0 }),
    ).toBe(0);
  });
});

describe('shortcode channel health', () => {
  const FIBER = { ...GOOD, fromFiber: true, bridgeStatus: 'ok' };
  const FALLBACK = { ...GOOD, fromFiber: false, bridgeStatus: 'ok' };

  it('counts derived identities separately from resolved ones', async () => {
    await record(15, FIBER);
    await record(5, FALLBACK);
    expect(fallbackIdentityShare(await readHealth())).toBeCloseTo(0.25);
  });

  it('does not count fallbacks for a caller that never reports the source', async () => {
    // An older content script omits `fromFiber` entirely. Absent must mean
    // "not reported", not "every reel failed" — otherwise the mere act of
    // shipping this counter would flag a healthy install as degraded.
    await record(30, GOOD);
    const health = await readHealth();
    expect(health.fallbackIdentity).toBe(0);
    expect(isShortcodeDegraded(health)).toBe(false);
  });

  it('stays quiet while a few placeholders fall back', async () => {
    await record(20, FIBER);
    await record(5, FALLBACK);
    expect(isShortcodeDegraded(await readHealth())).toBe(false);
  });

  it('flags degradation when most reels fall back to the derived key', async () => {
    await record(30, FALLBACK);
    expect(isShortcodeDegraded(await readHealth())).toBe(true);
  });

  it('recovers once the fiber channel resolves again', async () => {
    await record(30, FALLBACK);
    expect(isShortcodeDegraded(await readHealth())).toBe(true);
    await record(60, FIBER);
    expect(isShortcodeDegraded(await readHealth())).toBe(false);
  });

  it('trusts a no-fiber bridge report without waiting for the sample to fill', async () => {
    // The bridge ran and found no React expando at all: conclusive on its own,
    // and the whole point of reporting it separately from the fallback rate.
    await recordExtraction({ ...GOOD, fromFiber: false, bridgeStatus: 'no-fiber' });
    expect(isShortcodeDegraded(await readHealth())).toBe(true);
  });

  it('does not treat an absent bridge as broken', async () => {
    // Also what startup looks like before the MAIN-world script has injected.
    await record(30, { ...FIBER, bridgeStatus: 'absent' });
    expect(isShortcodeDegraded(await readHealth())).toBe(false);
  });

  it('keeps the last reported status when a caller omits it', async () => {
    await recordExtraction({ ...GOOD, bridgeStatus: 'ok' });
    await recordExtraction(GOOD);
    expect((await readHealth()).bridgeStatus).toBe('ok');
  });

  it('is independent of author drift', async () => {
    await record(30, FALLBACK);
    const health = await readHealth();
    expect(isDrifting(health)).toBe(false);
    expect(isShortcodeDegraded(health)).toBe(true);
  });
});

describe('audio channel counters', () => {
  it('attributes resolved audio to the selector that found it', async () => {
    await record(6, { ...GOOD, audioChannel: 'icon' });
    await record(2, { ...GOOD, audioChannel: 'href-music' });
    expect((await readHealth()).audioChannels).toEqual({ icon: 6, 'href-music': 2 });
  });

  it('records nothing for reels where no channel matched', async () => {
    await record(10, { ...NO_AUDIO, audioChannel: null });
    expect((await readHealth()).audioChannels).toEqual({});
  });

  it('decays channels alongside the rolling sample rather than growing forever', async () => {
    await record(200, { ...GOOD, audioChannel: 'icon' });
    const health = await readHealth();
    expect(health.audioChannels.icon).toBeLessThanOrEqual(health.samples);
  });

  it('forgets a channel that has stopped matching', async () => {
    // The diagnostic value is "what is working now" — a selector that broke
    // three hundred reels ago should not still appear to be carrying audio.
    await record(30, { ...GOOD, audioChannel: 'href-reels-audio' });
    await record(300, { ...GOOD, audioChannel: 'icon' });
    expect((await readHealth()).audioChannels['href-reels-audio']).toBeUndefined();
  });
});

describe('isAudioDark', () => {
  it('stays quiet on too small a sample', async () => {
    await record(3, NO_AUDIO);
    expect(isAudioDark(await readHealth())).toBe(false);
  });

  it('tolerates original-audio reels (some legitimately have no audio name)', async () => {
    // A healthy feed still resolves audio on most reels; a minority without is
    // normal and must not trip the alarm.
    await record(30, GOOD);
    await record(10, NO_AUDIO);
    expect(isAudioDark(await readHealth())).toBe(false);
  });

  it('fires when audio resolves on almost no reels — a broken selector', async () => {
    // The real-world failure: 0 of 700+ reels resolved an audio name, which
    // previously failed silently because only the author handle was watched.
    await record(40, NO_AUDIO);
    expect(isAudioDark(await readHealth())).toBe(true);
  });

  it('recovers once audio starts resolving again', async () => {
    await record(40, NO_AUDIO);
    expect(isAudioDark(await readHealth())).toBe(true);
    await record(60, GOOD);
    expect(isAudioDark(await readHealth())).toBe(false);
  });

  it('is independent of author drift — audio can fail on its own', async () => {
    // Author resolves fine, only audio is dark.
    await record(40, NO_AUDIO);
    const health = await readHealth();
    expect(isDrifting(health)).toBe(false);
    expect(isAudioDark(health)).toBe(true);
  });
});

describe('a sustained partial failure', () => {
  // The regression this covers disabled every warning in the module. The
  // counters decayed with Math.floor, and floor(n × 49/50) loses exactly one
  // for any n from 1 to 50 — so each recorded reel decayed a counter by one
  // and added at most one. A counter could only hold its value if *every*
  // sample incremented it. At a 90% author-miss rate the ratio read 0.000 and
  // isDrifting never fired; only a literal 100% failure was ever visible.

  /** Feeds `n` reels with misses spread as evenly as possible, no square wave. */
  async function atRate(rate, n = 3000) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += rate;
      let missing = false;
      if (acc >= 1) {
        missing = true;
        acc -= 1;
      }
      await recordExtraction({ hasAuthor: !missing, hasText: true, hasAudio: true });
    }
    return readHealth();
  }

  it('measures the rate it is actually seeing', async () => {
    const health = await atRate(0.7);
    expect(health.missingAuthor / health.samples).toBeCloseTo(0.7, 1);
  });

  it('warns well before every single reel has failed', async () => {
    // 70% of reels missing an author is drift by any reading. Requiring 100%
    // meant the alarm fired only once the channel was completely dead.
    expect(isDrifting(await atRate(0.7))).toBe(true);
  });

  it('stays quiet at a rate that is merely unlucky', async () => {
    expect(isDrifting(await atRate(0.2))).toBe(false);
  });

  it('sits either side of the threshold correctly', async () => {
    expect(isDrifting(await atRate(0.45))).toBe(false);
    store = {};
    expect(isDrifting(await atRate(0.6))).toBe(true);
  });

  it('comes back down when extraction recovers', async () => {
    const broken = await atRate(1.0, 200);
    expect(isDrifting(broken)).toBe(true);

    const recovered = await atRate(0, 300);
    expect(isDrifting(recovered)).toBe(false);
    expect(recovered.missingAuthor / recovered.samples).toBeLessThan(0.05);
  });

  it('keeps the ratio bounded at totality', async () => {
    const health = await atRate(1.0);
    expect(health.missingAuthor / health.samples).toBeCloseTo(1, 5);
    expect(health.missingAuthor).toBeLessThanOrEqual(health.samples);
  });
});

describe('audio channel counts', () => {
  it('forgets a channel that has stopped matching', async () => {
    for (let i = 0; i < 60; i++) {
      await recordExtraction({ hasAuthor: true, hasText: true, hasAudio: true, audioChannel: 'href-reels-audio' });
    }
    expect(Object.keys((await readHealth()).audioChannels)).toContain('href-reels-audio');

    for (let i = 0; i < 400; i++) {
      await recordExtraction({ hasAuthor: true, hasText: true, hasAudio: false });
    }
    // Fractional counts approach zero without reaching it, so the entry has to
    // be dropped at a floor or it lingers as a channel that is no longer live.
    expect(Object.keys((await readHealth()).audioChannels)).not.toContain('href-reels-audio');
  });

  it('keeps a channel that is still matching', async () => {
    for (let i = 0; i < 200; i++) {
      await recordExtraction({ hasAuthor: true, hasText: true, hasAudio: true, audioChannel: 'icon-fallback' });
    }
    expect(Object.keys((await readHealth()).audioChannels)).toContain('icon-fallback');
  });
});
