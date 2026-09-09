import { describe, it, expect } from 'vitest';
import {
  baselineShares,
  categoryShares,
  chargedBaselineShares,
  chargedShares,
  BASELINE_HALF_LIFE_DAYS,
  currentStreak,
  detectPattern,
  BASELINE_WINDOW_DAYS,
  MIN_BASELINE_DAYS,
  MIN_BASELINE_SAMPLE,
  MIN_CHARGED_SAMPLE,
  MIN_WINDOW_SAMPLE,
} from '../src/shared/patterns.ts';
import { UNCLASSIFIED } from '../src/shared/aggregation.ts';
import { localDateKey, startOfLocalDayBefore } from '../src/shared/time.ts';
import { DEFAULT_SETTINGS } from '../src/shared/defaults.ts';

const config = {
  windowSize: DEFAULT_SETTINGS.patternWindowSize,
  dominantThreshold: DEFAULT_SETTINGS.patternDominantThreshold,
  baselineMultiplier: DEFAULT_SETTINGS.patternBaselineMultiplier,
  watchedCategories: DEFAULT_SETTINGS.watchedCategories,
};

let nextId = 0;
const event = (category) => ({
  id: `e${nextId++}`,
  reelShortcode: 'abc',
  sessionId: 's1',
  startedAt: 0,
  endedAt: 1000,
  watchDurationMs: 1000,
  captionText: null,
  hashtags: [],
  audioName: null,
  category,
  categoryConfidence: category ? 0.8 : null,
  subtags: [],
});

/** `count` events of `category`, newest first as the detector expects. */
const runOf = (category, count) => Array.from({ length: count }, () => event(category));

/** Baseline days where each day has the given category counts. */
function days(count, breakdown) {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    totalReels: Object.values(breakdown).reduce((a, b) => a + b, 0),
    totalMinutes: 1,
    avgReelsPerSec: 0.1,
    longestBingeMs: 1000,
    categoryBreakdown: breakdown,
  }));
}

describe('categoryShares', () => {
  it('excludes unclassified from the denominator', () => {
    // Otherwise the same run of sad reels would or would not cross the
    // threshold depending on how many text-free clips sat between them.
    const { shares, classified } = categoryShares({ sad: 6, joyful: 2, [UNCLASSIFIED]: 92 });
    expect(classified).toBe(8);
    expect(shares.sad).toBe(0.75);
    expect(shares[UNCLASSIFIED]).toBeUndefined();
  });

  it('reports zero classified when everything is unreadable', () => {
    const { shares, classified } = categoryShares({ [UNCLASSIFIED]: 20 });
    expect(classified).toBe(0);
    expect(shares).toEqual({});
  });

  it('handles an empty breakdown', () => {
    expect(categoryShares({})).toEqual({ shares: {}, classified: 0 });
  });
});

describe('chargedShares', () => {
  it('measures dominance among charged reels only', () => {
    // The fix: topics and neutral leave the denominator, so a real breakup
    // loop is not hidden by a feed that is mostly comedy and food.
    const { shares, charged } = chargedShares({
      breakup: 5,
      sad: 1,
      food: 4,
      comedy: 3,
      neutral: 5,
      [UNCLASSIFIED]: 2,
    });
    expect(charged).toBe(6);
    expect(shares.breakup).toBeCloseTo(5 / 6);
    expect(shares.food).toBeUndefined();
    expect(shares.neutral).toBeUndefined();
  });

  it('is empty when the feed has no charged reels', () => {
    expect(chargedShares({ food: 10, comedy: 5, neutral: 8 })).toEqual({ shares: {}, charged: 0 });
  });
});

describe('baselineShares', () => {
  it('pools across days rather than averaging them', () => {
    // A day with 2 reels must not weigh the same as a day with 200.
    const aggregates = [
      { ...days(1, { sad: 2 })[0], date: '2026-08-01' },
      { ...days(1, { joyful: 198 })[0], date: '2026-08-02' },
    ];
    const { shares, classified } = baselineShares(aggregates);
    expect(classified).toBe(200);
    expect(shares.sad).toBeCloseTo(0.01);
  });

  it('is empty with no days', () => {
    expect(baselineShares([])).toEqual({ shares: {}, classified: 0 });
  });
});

describe('cold start', () => {
  it('refuses to decide without enough days of history', () => {
    const result = detectPattern(runOf('sad', 15), days(MIN_BASELINE_DAYS - 1, { sad: 50 }), config);
    expect(result.detected).toBe(false);
    expect(result.reason).toBe('insufficient-history');
  });

  it('does not fall back to a fixed threshold during cold start', () => {
    // 100% sad in the window is as extreme as it gets; it must still not fire
    // without a baseline to compare against.
    const result = detectPattern(runOf('sad', 15), [], config);
    expect(result.detected).toBe(false);
    expect(result.reason).toBe('insufficient-history');
  });

  it('refuses when too little of the window could be classified', () => {
    const window = [...runOf('sad', MIN_WINDOW_SAMPLE - 1), ...runOf(null, 10)];
    const result = detectPattern(window, days(MIN_BASELINE_DAYS, { joyful: 100 }), config);
    expect(result.reason).toBe('insufficient-window-sample');
  });

  it('refuses when the baseline itself is too thin', () => {
    const thin = days(MIN_BASELINE_DAYS, { joyful: 1 });
    const result = detectPattern(runOf('sad', 15), thin, config);
    expect(result.baselineSample).toBeLessThan(MIN_BASELINE_SAMPLE);
    expect(result.reason).toBe('insufficient-baseline-sample');
  });
});

describe('detectPattern', () => {
  const normalDays = days(MIN_BASELINE_DAYS, { joyful: 40, sad: 8, motivational: 12 });

  it('fires when a watched category is both dominant and well above baseline', () => {
    const result = detectPattern(runOf('sad', 15), normalDays, config);
    expect(result.detected).toBe(true);
    expect(result.category).toBe('sad');
    expect(result.share).toBe(1);
    expect(result.ratio).toBeGreaterThan(config.baselineMultiplier);
    expect(result.reason).toBeNull();
  });

  it('does not fire on dominance alone when this is normal for the user', () => {
    // The whole point: someone whose ordinary diet is 70% sad content should
    // not be flagged for watching sad content.
    const heavySadUser = days(MIN_BASELINE_DAYS, { sad: 70, joyful: 30 });
    const result = detectPattern(runOf('sad', 15), heavySadUser, config);
    expect(result.detected).toBe(false);
    expect(result.reason).toBe('within-baseline');
    expect(result.share).toBe(1);
  });

  it('does not fire when no category dominates', () => {
    const mixed = [...runOf('sad', 5), ...runOf('joyful', 5), ...runOf('motivational', 5)];
    const result = detectPattern(mixed, normalDays, config);
    expect(result.detected).toBe(false);
    expect(result.reason).toBe('not-dominant');
  });

  it('does not fire for a category the user is not watching', () => {
    // Being shown a lot of motivational content is not worth interrupting.
    const result = detectPattern(runOf('motivational', 15), normalDays, config);
    expect(result.detected).toBe(false);
    expect(result.reason).toBe('category-not-watched');
    // Still recorded, so the watched list can be reviewed against real data.
    expect(result.category).toBe('motivational');
    expect(result.share).toBe(1);
  });

  it('treats a category absent from the baseline as infinitely above it', () => {
    const noBreakups = days(MIN_BASELINE_DAYS, { joyful: 60, sad: 40 });
    const result = detectPattern(runOf('breakup', 15), noBreakups, config);
    expect(result.baselineShare).toBe(0);
    expect(result.ratio).toBe(Infinity);
    expect(result.detected).toBe(true);
  });

  it('respects the window size rather than reading all history', () => {
    const window = [...runOf('sad', 15), ...runOf('joyful', 100)];
    const result = detectPattern(window, normalDays, { ...config, windowSize: 15 });
    expect(result.windowSample).toBe(15);
    expect(result.share).toBe(1);
  });

  it('ignores unclassified reels when measuring dominance', () => {
    const window = [...runOf('sad', 10), ...runOf(null, 5)];
    const result = detectPattern(window, normalDays, config);
    expect(result.windowSample).toBe(10);
    expect(result.share).toBe(1);
  });

  it('records the inputs behind a near miss', () => {
    // Near misses are what make the log worth reviewing.
    const result = detectPattern(runOf('sad', 15), days(MIN_BASELINE_DAYS, { sad: 80, joyful: 20 }), config);
    expect(result.detected).toBe(false);
    expect(result.baselineShare).toBeCloseTo(0.8);
    expect(result.ratio).toBeCloseTo(1.25);
    // 7 baseline days of 100 classified reels each.
    expect(result.baselineSample).toBe(700);
  });

  it('honours a stricter dominance threshold', () => {
    const window = [...runOf('sad', 9), ...runOf('joyful', 6)];
    const lenient = detectPattern(window, normalDays, { ...config, dominantThreshold: 0.5 });
    const strict = detectPattern(window, normalDays, { ...config, dominantThreshold: 0.9 });
    expect(lenient.detected).toBe(true);
    expect(strict.detected).toBe(false);
  });

  it('honours a stricter baseline multiplier', () => {
    const window = runOf('sad', 15);
    const base = days(MIN_BASELINE_DAYS, { sad: 50, joyful: 50 });
    const lenient = detectPattern(window, base, { ...config, baselineMultiplier: 1.5 });
    const strict = detectPattern(window, base, { ...config, baselineMultiplier: 3 });
    expect(lenient.detected).toBe(true);
    expect(strict.detected).toBe(false);
  });

  it('is deterministic when two categories tie for dominance', () => {
    const window = [...runOf('sad', 5), ...runOf('angry', 5)];
    const first = detectPattern(window, normalDays, config).category;
    for (let i = 0; i < 5; i++) {
      expect(detectPattern(window, normalDays, config).category).toBe(first);
    }
  });

  it('requires a week of history but looks back a fortnight', () => {
    // The two numbers answer different questions and are deliberately not
    // equal. MIN_BASELINE_DAYS is the cold-start rule: below a week there is
    // no baseline worth comparing against. BASELINE_WINDOW_DAYS is how far
    // back the recency-weighted baseline reaches — further, because the older
    // days are damped rather than cut off.
    expect(MIN_BASELINE_DAYS).toBe(7);
    expect(BASELINE_WINDOW_DAYS).toBeGreaterThan(MIN_BASELINE_DAYS);
  });
});

describe('detection on a realistic mixed feed', () => {
  // A window shaped like the user's actual feed: mostly topical/neutral, with
  // a real breakup loop buried in it. Newest-first, 15 reels.
  const mixedWindow = [
    ...runOf('breakup', 5),
    ...runOf('sad', 1),
    ...runOf('food', 3),
    ...runOf('comedy', 2),
    ...runOf('neutral', 2),
    ...runOf(null, 2),
  ];

  // Baseline: breakup is rare for this user (a handful across a week).
  const normalBaseline = days(MIN_BASELINE_DAYS, {
    comedy: 40,
    food: 30,
    neutral: 25,
    breakup: 2,
    joyful: 5,
  });

  it('fires on a 5-of-15 breakup loop that used to read as 33% and be ignored', () => {
    const result = detectPattern(mixedWindow, normalBaseline, config);
    expect(result.category).toBe('breakup');
    // Dominance is now measured among the 6 charged reels, not all 15.
    expect(result.chargedSample).toBe(6);
    expect(result.share).toBeCloseTo(5 / 6);
    expect(result.detected).toBe(true);
  });

  it('still does not fire for a user whose normal is heavy on breakup', () => {
    // Same window; but if this is ordinary for them, it is not a loop.
    const heavyBreakup = days(MIN_BASELINE_DAYS, { breakup: 70, comedy: 30 });
    const result = detectPattern(mixedWindow, heavyBreakup, config);
    expect(result.detected).toBe(false);
    expect(result.reason).toBe('within-baseline');
  });

  it('refuses when too few charged reels are in the window', () => {
    // A feed that is almost all topics: a couple of stray emotional clips
    // must not read as a loop.
    const mostlyTopics = [
      ...runOf('breakup', 3),
      ...runOf('food', 6),
      ...runOf('comedy', 6),
    ];
    const result = detectPattern(mostlyTopics, normalBaseline, config);
    expect(result.chargedSample).toBeLessThan(MIN_CHARGED_SAMPLE);
    expect(result.reason).toBe('insufficient-charged-sample');
  });
});

describe('currentStreak', () => {
  it('counts consecutive reels of the category from the most recent', () => {
    expect(currentStreak([...runOf('sad', 4), ...runOf('joyful', 2)], 'sad')).toBe(4);
  });

  it('is zero when the most recent reel is a different category', () => {
    expect(currentStreak([...runOf('joyful', 1), ...runOf('sad', 5)], 'sad')).toBe(0);
  });

  it('is not broken by an unclassified reel in the middle', () => {
    // A text-free clip is not evidence the run ended, and treating it as a
    // break would make streaks depend on how readable the feed happens to be.
    const window = [...runOf('sad', 2), ...runOf(null, 1), ...runOf('sad', 3)];
    expect(currentStreak(window, 'sad')).toBe(5);
  });

  it('is broken by a different classified category', () => {
    const window = [...runOf('sad', 2), ...runOf('joyful', 1), ...runOf('sad', 3)];
    expect(currentStreak(window, 'sad')).toBe(2);
  });

  it('is zero for an empty window', () => {
    expect(currentStreak([], 'sad')).toBe(0);
  });
});

describe('recency-weighted baseline', () => {
  /** A day `age` days before `today`, with the given category counts. */
  const dayAged = (today, age, breakdown) => ({
    date: localDateKey(startOfLocalDayBefore(today, age)),
    totalReels: Object.values(breakdown).reduce((a, b) => a + b, 0),
    totalMinutes: 1,
    avgReelsPerSec: 0.1,
    longestBingeMs: 1000,
    categoryBreakdown: breakdown,
  });

  const NOW = new Date(2026, 7, 22, 12, 0, 0).getTime();

  it('weights a recent day above an old one', () => {
    // Same counts, opposite categories, a fortnight apart. The recent day
    // should dominate the resulting shares.
    const aggregates = [
      dayAged(NOW, 1, { sad: 50 }),
      dayAged(NOW, 14, { angry: 50 }),
    ];
    const { shares } = chargedBaselineShares(aggregates, NOW);
    expect(shares.sad).toBeGreaterThan(shares.angry);
  });

  it('halves a day\'s contribution every half-life', () => {
    const recent = chargedBaselineShares([dayAged(NOW, 1, { sad: 100 })], NOW);
    // A day exactly one half-life older than another contributes half as much.
    const mixed = chargedBaselineShares(
      [dayAged(NOW, 1, { sad: 100 }), dayAged(NOW, 1 + BASELINE_HALF_LIFE_DAYS, { angry: 100 })],
      NOW,
    );
    expect(recent.shares.sad).toBe(1);
    // sad:100 at weight w, angry:100 at weight w/2 -> sad share 2/3.
    expect(mixed.shares.sad).toBeCloseTo(2 / 3, 2);
  });

  it('still pools by volume, so a heavy day outweighs a quiet one', () => {
    // Decay multiplies the count weighting, it does not replace it: a day with
    // three reels must not carry the same weight as a day with three hundred.
    const { shares } = chargedBaselineShares(
      [dayAged(NOW, 1, { sad: 2 }), dayAged(NOW, 2, { angry: 200 })],
      NOW,
    );
    expect(shares.angry).toBeGreaterThan(shares.sad);
  });

  it('reports the raw charged count, not the decayed one', () => {
    // The sample guard asks "is there enough history to say anything", which
    // does not depend on when the reels happened to land. Decaying it would
    // make MIN_BASELINE_SAMPLE mean different things on different days.
    const { charged } = chargedBaselineShares(
      [dayAged(NOW, 1, { sad: 30 }), dayAged(NOW, 13, { angry: 30 })],
      NOW,
    );
    expect(charged).toBe(60);
  });

  it('has no cliff edge: one extra day of age changes the baseline smoothly', () => {
    // The failure this replaced. With a hard 7-day window, the morning a heavy
    // day aged out the baseline lurched, and an unchanged feed could go from
    // "within baseline" to flagged overnight.
    const at = (age) =>
      chargedBaselineShares([dayAged(NOW, 1, { sad: 50 }), dayAged(NOW, age, { angry: 50 })], NOW)
        .shares.sad;
    const before = at(7);
    const after = at(8);
    expect(Math.abs(after - before)).toBeLessThan(0.05);
  });

  it('treats a future-dated aggregate as current rather than trusting it', () => {
    // A clock change can leave a day dated ahead of now. Weighting it by a
    // negative age would give it more than full weight.
    const { shares } = chargedBaselineShares([dayAged(NOW, -3, { sad: 50 })], NOW);
    expect(shares.sad).toBe(1);
  });
});
