// User settings.
//
// chrome.storage.local rather than IndexedDB: settings are a single small
// object, and chrome.storage fires change events that the popup and options
// page can subscribe to directly. They also survive clearAllData(), which
// only wipes tracked history.
//
// Lives in shared/ because the content script reads them too — the session
// gap threshold governs when one scrolling session ends and the next begins,
// and that decision is made where the reels are observed.

import { DEFAULT_SETTINGS, MINUTE_MS, SETTING_BOUNDS } from './defaults.js';
import { CHARGED_CATEGORIES } from './taxonomy.js';
import type { UserSettings } from './types.js';

/** Exported so listeners can tell a settings change from any other write. */
export const SETTINGS_KEY = 'doomscroll:settings';

/**
 * Stored settings merged over the defaults.
 *
 * Merging on read means a settings object written by an older version is
 * forward-compatible: fields added later appear with their default rather
 * than as undefined.
 */
export async function getSettings(): Promise<UserSettings> {
  let stored: unknown;
  try {
    ({ [SETTINGS_KEY]: stored } = await chrome.storage.local.get(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  return mergeSettings(DEFAULT_SETTINGS, stored);
}

export async function updateSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  const next = mergeSettings(await getSettings(), patch);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** A number inside its bounds, or the fallback when it is not a number at all. */
function clamp(value: unknown, bounds: { min: number; max: number }, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const WATCHABLE = new Set<string>(CHARGED_CATEGORIES);
const MODES: UserSettings['classificationMode'][] = ['local-rules', 'local-ml', 'cloud-llm'];

/**
 * Shallow merge, except for `interventionLevels` — a plain spread would let a
 * patch touching one threshold silently drop the other three — and except that
 * every field is checked before it is kept.
 *
 * Validating here rather than at the inputs is deliberate. This is the one
 * function every write passes through, from the options page, from a settings
 * object written by an older version, and from anything added later. Guarding
 * the inputs instead would leave the store trusting whoever called it, and the
 * failure it prevents is silent: a window size of 0 stops detection for good
 * and says nothing, and a negative one keeps firing against the wrong reels.
 */
function mergeSettings(base: UserSettings, patch: unknown): UserSettings {
  if (typeof patch !== 'object' || patch === null) return { ...base };
  const incoming = patch as Partial<UserSettings>;

  const merged = {
    ...base,
    ...incoming,
    interventionLevels: {
      ...base.interventionLevels,
      ...(incoming.interventionLevels ?? {}),
    },
  };

  return {
    ...merged,
    trackingEnabled: bool(merged.trackingEnabled, DEFAULT_SETTINGS.trackingEnabled),
    interventionEnabled: bool(merged.interventionEnabled, DEFAULT_SETTINGS.interventionEnabled),
    debugHud: bool(merged.debugHud, DEFAULT_SETTINGS.debugHud),
    classificationMode: MODES.includes(merged.classificationMode)
      ? merged.classificationMode
      : DEFAULT_SETTINGS.classificationMode,
    patternWindowSize: Math.round(
      clamp(
        merged.patternWindowSize,
        SETTING_BOUNDS.patternWindowSize,
        DEFAULT_SETTINGS.patternWindowSize,
      ),
    ),
    patternDominantThreshold: clamp(
      merged.patternDominantThreshold,
      SETTING_BOUNDS.patternDominantThreshold,
      DEFAULT_SETTINGS.patternDominantThreshold,
    ),
    patternBaselineMultiplier: clamp(
      merged.patternBaselineMultiplier,
      SETTING_BOUNDS.patternBaselineMultiplier,
      DEFAULT_SETTINGS.patternBaselineMultiplier,
    ),
    sessionGapThresholdMs:
      Math.round(
        clamp(
          (merged.sessionGapThresholdMs ?? NaN) / MINUTE_MS,
          SETTING_BOUNDS.sessionGapMinutes,
          DEFAULT_SETTINGS.sessionGapThresholdMs / MINUTE_MS,
        ),
      ) * MINUTE_MS,
    // Only charged categories can drive detection, so anything else in the
    // list is inert at best. Deduplicated because the chips append.
    watchedCategories: Array.isArray(merged.watchedCategories)
      ? [...new Set(merged.watchedCategories.filter((c) => WATCHABLE.has(c)))]
      : [...DEFAULT_SETTINGS.watchedCategories],
  };
}
