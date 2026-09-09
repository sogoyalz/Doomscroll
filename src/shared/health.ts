// Selector-drift detection.
//
// Instagram has no API and no deprecation notice. When it ships a layout
// change, extraction does not throw — it quietly starts returning nulls, and
// without something watching for that the first symptom is a dashboard that
// looks like a quiet week.
//
// Fixture tests catch regressions against the structure we know about. This
// catches the structure changing underneath us in production.
//
// The signal is the author handle. docs/dom-notes.md records it as the one
// field present on every real reel — captions, hashtags, and audio are all
// legitimately absent sometimes, so only the author failing to resolve is
// evidence the DOM moved rather than evidence of an unusual reel.

const HEALTH_KEY = 'doomscroll:extractionHealth';

/** Rolling sample size. Large enough to smooth over placeholder slots. */
const SAMPLE_SIZE = 50;

/**
 * Above this share of author-resolution failures, something is wrong with the
 * selectors rather than with the reels. Unhydrated placeholders are real but
 * uncommon — dom-notes observed 2 of 9 — so the bar sits well clear of them.
 */
const DRIFT_THRESHOLD = 0.5;

/** Ignore the first few samples, where one placeholder skews the ratio. */
const MIN_SAMPLES = 10;

/** Below this a decayed channel count is treated as gone. */
const CHANNEL_FLOOR = 0.5;

export interface ExtractionHealth {
  samples: number;
  missingAuthor: number;
  missingText: number;
  missingAudio: number;
  /**
   * Reels whose identity came from the derived `author|basename` fallback
   * rather than the React fiber shortcode. A rising rate is the signature of
   * the MAIN-world bridge breaking — the failure this project's docs call its
   * single most fragile dependency.
   */
  fallbackIdentity: number;
  /**
   * Last reported liveness of the MAIN-world bridge. Distinguishes "React
   * internals renamed" (`no-fiber`) from "the script never ran" (`absent`),
   * which need different fixes and are otherwise indistinguishable from here.
   */
  bridgeStatus: 'ok' | 'no-fiber' | 'absent';
  /**
   * Which audio selector produced each resolved audio name.
   *
   * Audio was found 100% dark across 700+ reels and the aggregate counter
   * could not say which channel was at fault. Counting per channel makes one
   * instrumented session enough to tell whether the href anchors are dead, the
   * icon fallback is dead, or the row is not rendered at all.
   */
  audioChannels: Record<string, number>;
  lastUpdated: number;
}

const EMPTY: ExtractionHealth = {
  samples: 0,
  missingAuthor: 0,
  missingText: 0,
  missingAudio: 0,
  fallbackIdentity: 0,
  bridgeStatus: 'absent',
  audioChannels: {},
  lastUpdated: 0,
};

/**
 * Above this share of missing audio, the selector is almost certainly broken
 * rather than the reels being original-audio. Original audio is common but
 * nowhere near universal — a real feed still has licensed audio on most reels
 * — so 90% missing cleanly separates "broken channel" from "some reels have
 * no audio". Found in practice at 100% missing across 700+ reels.
 */
const AUDIO_DARK_THRESHOLD = 0.9;

function isHealth(value: unknown): value is ExtractionHealth {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<ExtractionHealth>;
  return typeof c.samples === 'number' && typeof c.missingAuthor === 'number';
}

/**
 * Decays one counter by a step of the rolling window.
 *
 * Floor, not round. Rounding has fixed points: at a 50-sample window the step
 * is 1/50, so a count of 25 decays to 24.5 and rounds straight back to 25 — a
 * counter that never recovers, leaving a stale alarm latched at exactly the
 * threshold long after the selector was fixed. Flooring always makes progress
 * downward, and a persistently failing channel still climbs back to ~49/50
 * because each new failure adds a whole unit.
 */
/**
 * Ages a counter by one sample. Deliberately fractional.
 *
 * This used to floor, which silently disabled every warning in this file.
 * `Math.floor(n * 49/50)` loses exactly one for any n from 1 to 50, so each
 * recorded reel decayed a counter by one and added at most one — the counter
 * could only hold its value if *every single* sample incremented it. At a 90%
 * author-miss rate, which is catastrophic drift, the ratio read 0.000 and
 * `isDrifting` never fired. Only a literal 100% failure was visible, and the
 * one channel that happened to be at 100% (audio) is what kept the bug hidden.
 *
 * Left fractional on purpose: these counts are only ever read as a ratio
 * against `samples`, and rounding to integers is what broke it. A plain
 * exponential decay converges on `trueRate × SAMPLE_SIZE`, so the ratio
 * converges on the true rate, which is the whole point of the number.
 */
function decayCount(count: number, decay: number): number {
  return count * decay;
}

/**
 * Decays the per-channel counts alongside the rolling sample.
 *
 * Channels that decay to zero are dropped rather than kept at 0, so the map
 * describes what is working now instead of accumulating a row per selector
 * that ever matched.
 */
function decayChannels(channels: Record<string, number>, decay: number): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [channel, count] of Object.entries(channels)) {
    const decayed = decayCount(count, decay);
    // Counts are fractional now, so they approach zero without reaching it.
    // Dropped below a sample's worth of weight, which is where a channel has
    // effectively not been seen in the window this file describes.
    if (decayed >= CHANNEL_FLOOR) next[channel] = decayed;
  }
  return next;
}

export async function readHealth(): Promise<ExtractionHealth> {
  try {
    const { [HEALTH_KEY]: stored } = await chrome.storage.local.get(HEALTH_KEY);
    return isHealth(stored) ? { ...emptyHealth(), ...stored } : emptyHealth();
  } catch {
    return emptyHealth();
  }
}

/** A fresh record. Cloned so callers never share EMPTY's nested map. */
function emptyHealth(): ExtractionHealth {
  return { ...EMPTY, audioChannels: {} };
}

/**
 * Folds one extraction outcome into the rolling sample.
 *
 * Counters are decayed proportionally once the sample is full rather than
 * kept as a list, so this stays a single small record no matter how much the
 * user scrolls, and recovers quickly once a broken selector is fixed.
 */
export async function recordExtraction(outcome: {
  hasAuthor: boolean;
  hasText: boolean;
  hasAudio: boolean;
  /** False when identity fell back to `author|basename`. */
  fromFiber?: boolean;
  /** Which audio selector matched, when one did. */
  audioChannel?: string | null;
  bridgeStatus?: ExtractionHealth['bridgeStatus'];
  now?: number;
}): Promise<void> {
  const current = await readHealth();

  let { samples, missingAuthor, missingText, missingAudio, fallbackIdentity } = current;
  let audioChannels = current.audioChannels;

  if (samples >= SAMPLE_SIZE) {
    const decay = (SAMPLE_SIZE - 1) / SAMPLE_SIZE;
    samples = SAMPLE_SIZE - 1;
    missingAuthor = decayCount(missingAuthor, decay);
    missingText = decayCount(missingText, decay);
    missingAudio = decayCount(missingAudio, decay);
    fallbackIdentity = decayCount(fallbackIdentity, decay);
    audioChannels = decayChannels(audioChannels, decay);
  }

  if (outcome.audioChannel) {
    audioChannels = {
      ...audioChannels,
      [outcome.audioChannel]: (audioChannels[outcome.audioChannel] ?? 0) + 1,
    };
  }

  const next: ExtractionHealth = {
    samples: samples + 1,
    missingAuthor: missingAuthor + (outcome.hasAuthor ? 0 : 1),
    missingText: missingText + (outcome.hasText ? 0 : 1),
    missingAudio: missingAudio + (outcome.hasAudio ? 0 : 1),
    // `fromFiber` is optional so an older caller cannot start reporting every
    // reel as a fallback; absent means "not reported", not "failed".
    fallbackIdentity: fallbackIdentity + (outcome.fromFiber === false ? 1 : 0),
    bridgeStatus: outcome.bridgeStatus ?? current.bridgeStatus,
    audioChannels,
    lastUpdated: outcome.now ?? Date.now(),
  };

  try {
    await chrome.storage.local.set({ [HEALTH_KEY]: next });
  } catch {
    // Health tracking must never break tracking itself.
  }
}

/**
 * True when the author handle is failing often enough that the selectors,
 * not the reels, are the likely explanation.
 */
export function isDrifting(health: ExtractionHealth): boolean {
  if (health.samples < MIN_SAMPLES) return false;
  return health.missingAuthor / health.samples > DRIFT_THRESHOLD;
}

/** Share of recent reels that carried no readable text at all, 0–1. */
export function textlessShare(health: ExtractionHealth): number {
  return health.samples ? health.missingText / health.samples : 0;
}

/**
 * True when audio has gone almost entirely dark — evidence the audio selector
 * is broken rather than the reels genuinely lacking audio. This is a separate
 * signal from author-handle drift: audio can fail on its own (as it did) while
 * everything else keeps resolving, and that failure was previously invisible.
 */
export function isAudioDark(health: ExtractionHealth): boolean {
  if (health.samples < MIN_SAMPLES) return false;
  return health.missingAudio / health.samples > AUDIO_DARK_THRESHOLD;
}

/**
 * Above this share of derived identities, the fiber channel is degraded rather
 * than merely missing the odd placeholder. Set well above the placeholder rate
 * dom-notes observed (2 of 9) so an ordinary feed never trips it.
 */
const FALLBACK_IDENTITY_THRESHOLD = 0.5;

/** Share of recent reels identified by the derived fallback key, 0–1. */
export function fallbackIdentityShare(health: ExtractionHealth): number {
  return health.samples ? health.fallbackIdentity / health.samples : 0;
}

/**
 * True when the shortcode channel is no longer carrying identity.
 *
 * `no-fiber` is conclusive on its own — the bridge ran and found no React
 * expando at all — so it does not wait for the sample to fill. `absent` is
 * deliberately not treated as broken here: it is also what a page with no
 * MAIN-world injection yet looks like during startup.
 */
export function isShortcodeDegraded(health: ExtractionHealth): boolean {
  if (health.bridgeStatus === 'no-fiber') return true;
  if (health.samples < MIN_SAMPLES) return false;
  return fallbackIdentityShare(health) > FALLBACK_IDENTITY_THRESHOLD;
}
