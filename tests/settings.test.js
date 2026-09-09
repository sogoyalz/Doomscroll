import { describe, it, expect, beforeEach } from 'vitest';
import { getSettings, updateSettings } from '../src/shared/settings.ts';
import { DEFAULT_SETTINGS, MINUTE_MS, SETTING_BOUNDS } from '../src/shared/defaults.ts';
import { MIN_WINDOW_SAMPLE } from '../src/shared/patterns.ts';

// Minimal chrome.storage.local stand-in — enough surface for these two
// functions, without pulling in a full extension-API mock.
let store = {};
let failNextGet = false;

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (failNextGet) {
          failNextGet = false;
          throw new Error('extension context invalidated');
        }
        return key in store ? { [key]: store[key] } : {};
      },
      async set(entries) {
        Object.assign(store, entries);
      },
    },
  },
};

beforeEach(() => {
  store = {};
  failNextGet = false;
});

describe('getSettings', () => {
  it('returns the defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('ships with intervention off, since week one has no baseline', async () => {
    expect((await getSettings()).interventionEnabled).toBe(false);
  });

  it('ships with tracking on, but able to be turned off', async () => {
    // The extension does nothing useful with tracking off, so it defaults on
    // — but "uninstall" must not be the only way to stop it.
    expect((await getSettings()).trackingEnabled).toBe(true);

    await updateSettings({ trackingEnabled: false });
    expect((await getSettings()).trackingEnabled).toBe(false);
  });

  it('keeps tracking and intervention independent', async () => {
    await updateSettings({ trackingEnabled: false });
    expect((await getSettings()).interventionEnabled).toBe(false);

    await updateSettings({ trackingEnabled: true });
    expect((await getSettings()).trackingEnabled).toBe(true);
  });

  it('fills in fields absent from an older stored object', async () => {
    // Forward compatibility: a settings blob written before a field existed
    // must not surface that field as undefined.
    store['doomscroll:settings'] = { interventionEnabled: true };

    const settings = await getSettings();
    expect(settings.interventionEnabled).toBe(true);
    expect(settings.patternWindowSize).toBe(DEFAULT_SETTINGS.patternWindowSize);
    expect(settings.watchedCategories).toEqual(DEFAULT_SETTINGS.watchedCategories);
  });

  it('falls back to defaults when storage is unreachable', async () => {
    failNextGet = true;
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores a corrupted non-object value', async () => {
    store['doomscroll:settings'] = 'not an object';
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('updateSettings', () => {
  it('persists a patch and leaves other fields alone', async () => {
    await updateSettings({ patternWindowSize: 25 });

    const settings = await getSettings();
    expect(settings.patternWindowSize).toBe(25);
    expect(settings.patternDominantThreshold).toBe(DEFAULT_SETTINGS.patternDominantThreshold);
  });

  it('merges interventionLevels instead of replacing it', async () => {
    // A plain spread here would drop the other three thresholds.
    await updateSettings({ interventionLevels: { notifyAfterStreak: 3 } });

    const { interventionLevels } = await getSettings();
    expect(interventionLevels.notifyAfterStreak).toBe(3);
    expect(interventionLevels.overlayAfterStreak).toBe(
      DEFAULT_SETTINGS.interventionLevels.overlayAfterStreak,
    );
    expect(interventionLevels.blockCooldownMs).toBe(
      DEFAULT_SETTINGS.interventionLevels.blockCooldownMs,
    );
  });

  it('accumulates across successive updates', async () => {
    await updateSettings({ patternWindowSize: 20 });
    await updateSettings({ interventionEnabled: true });

    const settings = await getSettings();
    expect(settings.patternWindowSize).toBe(20);
    expect(settings.interventionEnabled).toBe(true);
  });

  it('returns the merged result', async () => {
    const result = await updateSettings({ classificationMode: 'local-ml' });
    expect(result.classificationMode).toBe('local-ml');
    expect(result.sessionGapThresholdMs).toBe(DEFAULT_SETTINGS.sessionGapThresholdMs);
  });
});

describe('settings are validated on the way in', () => {
  // `min`/`max` on <input type="number"> constrain the spinner and nothing
  // else: a typed value is written unchanged, and an emptied field reads as 0.
  // Clearing a field to retype it is the ordinary way to edit a number, and it
  // used to store a window size of 0 — which stopped detection permanently and
  // said nothing. A negative one was worse: slice(0, -n) kept firing against
  // the wrong reels.
  const bad = async (patch) => {
    await updateSettings(patch);
    return getSettings();
  };

  it('refuses a window size of zero, which is what an emptied field sends', async () => {
    const s = await bad({ patternWindowSize: 0 });
    expect(s.patternWindowSize).toBe(SETTING_BOUNDS.patternWindowSize.min);
  });

  it('refuses a negative window, which measured the wrong reels', async () => {
    const s = await bad({ patternWindowSize: -5 });
    expect(s.patternWindowSize).toBeGreaterThanOrEqual(SETTING_BOUNDS.patternWindowSize.min);
  });

  it('caps a window nobody meant to type', async () => {
    const s = await bad({ patternWindowSize: 100000 });
    expect(s.patternWindowSize).toBe(SETTING_BOUNDS.patternWindowSize.max);
  });

  it('keeps the window a whole number of reels', async () => {
    const s = await bad({ patternWindowSize: 15.7 });
    expect(Number.isInteger(s.patternWindowSize)).toBe(true);
  });

  it('refuses a dominance threshold of zero, which would flag everything', async () => {
    const s = await bad({ patternDominantThreshold: 0 });
    expect(s.patternDominantThreshold).toBe(SETTING_BOUNDS.patternDominantThreshold.min);
  });

  it('refuses a baseline multiplier of zero, which would flag everything', async () => {
    const s = await bad({ patternBaselineMultiplier: 0 });
    expect(s.patternBaselineMultiplier).toBe(SETTING_BOUNDS.patternBaselineMultiplier.min);
  });

  it('holds the session gap to the range the options page offers', async () => {
    expect((await bad({ sessionGapThresholdMs: 0 })).sessionGapThresholdMs).toBe(
      SETTING_BOUNDS.sessionGapMinutes.min * MINUTE_MS,
    );
    expect((await bad({ sessionGapThresholdMs: 999 * MINUTE_MS })).sessionGapThresholdMs).toBe(
      SETTING_BOUNDS.sessionGapMinutes.max * MINUTE_MS,
    );
  });

  it('falls back to the default when a number is not a number', async () => {
    for (const value of [NaN, Infinity, null, 'fifteen', undefined]) {
      store = {};
      const s = await bad({ patternWindowSize: value });
      expect(s.patternWindowSize, String(value)).toBe(DEFAULT_SETTINGS.patternWindowSize);
    }
  });

  it('drops categories that cannot drive detection anyway', async () => {
    const s = await bad({ watchedCategories: ['sad', 'comedy', 'not-a-category', 'neutral'] });
    expect(s.watchedCategories).toEqual(['sad']);
  });

  it('deduplicates the watched list, which the chips can append to', async () => {
    const s = await bad({ watchedCategories: ['sad', 'sad', 'angry'] });
    expect(s.watchedCategories).toEqual(['sad', 'angry']);
  });

  it('restores the default list when the value is not a list', async () => {
    const s = await bad({ watchedCategories: 'sad' });
    expect(s.watchedCategories).toEqual(DEFAULT_SETTINGS.watchedCategories);
  });

  it('refuses a classification mode that does not exist', async () => {
    const s = await bad({ classificationMode: 'gpt-9' });
    expect(s.classificationMode).toBe(DEFAULT_SETTINGS.classificationMode);
  });

  it('refuses a non-boolean for the switches', async () => {
    const s = await bad({ trackingEnabled: 'yes', interventionEnabled: 1 });
    expect(s.trackingEnabled).toBe(DEFAULT_SETTINGS.trackingEnabled);
    expect(s.interventionEnabled).toBe(DEFAULT_SETTINGS.interventionEnabled);
  });

  it('cleans a corrupt object already sitting in storage', async () => {
    // Not only patches: settings written by an older build are merged on read.
    store['doomscroll:settings'] = { patternWindowSize: -1, watchedCategories: null };
    const s = await getSettings();
    expect(s.patternWindowSize).toBeGreaterThanOrEqual(SETTING_BOUNDS.patternWindowSize.min);
    expect(s.watchedCategories).toEqual(DEFAULT_SETTINGS.watchedCategories);
  });

  it('leaves a legitimate value exactly alone', async () => {
    const s = await bad({ patternWindowSize: 20, patternDominantThreshold: 0.75 });
    expect(s.patternWindowSize).toBe(20);
    expect(s.patternDominantThreshold).toBe(0.75);
  });
});

describe('the bounds and the detector agree', () => {
  it('never offers a window too small for detection to fire', async () => {
    // The options page used to offer a minimum of 5 while detection requires
    // MIN_WINDOW_SAMPLE classified reels before dominance means anything — so
    // the lowest setting on the page was one that provably could never fire.
    expect(SETTING_BOUNDS.patternWindowSize.min).toBeGreaterThanOrEqual(MIN_WINDOW_SAMPLE);
  });

  it('keeps the default inside its own bounds', async () => {
    // A default outside the range would be clamped on first read, silently
    // changing the shipped behaviour.
    const s = await getSettings();
    expect(s.patternWindowSize).toBe(DEFAULT_SETTINGS.patternWindowSize);
    expect(s.patternDominantThreshold).toBe(DEFAULT_SETTINGS.patternDominantThreshold);
    expect(s.patternBaselineMultiplier).toBe(DEFAULT_SETTINGS.patternBaselineMultiplier);
    expect(s.sessionGapThresholdMs).toBe(DEFAULT_SETTINGS.sessionGapThresholdMs);
  });
});
