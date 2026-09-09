// The taxonomy is spread across three files that must agree.
//
// taxonomy.ts names the categories, lexicon.ts gives each one its vocabulary
// and its place in the scoring order, palette.ts gives it a colour. Adding a
// category is documented as a deliberate three-file edit — which is precisely
// the kind of edit that gets done in two.
//
// Two of the three couplings are enforced by the type system: LEXICON and
// CATEGORY_COLORS are `Record`s keyed by the category union, so a missing
// entry is a compile error. TIE_BREAK_ORDER is a plain array, which types
// cannot make exhaustive, and it is also the one whose failure is worst.

import { describe, it, expect } from 'vitest';
import { CATEGORIES, CHARGED_CATEGORIES, TOPIC_CATEGORIES, isCharged } from '../src/shared/taxonomy.ts';
import { LEXICON, TIE_BREAK_ORDER } from '../src/shared/lexicon.ts';
import { CATEGORY_COLORS, colorForCategory, UNCLASSIFIED_COLOR } from '../src/shared/palette.ts';

/** Every category that can actually be assigned. `neutral` is the absence of one. */
const NAMABLE = CATEGORIES.filter((c) => c !== 'neutral');

describe('TIE_BREAK_ORDER', () => {
  it('contains every namable category', () => {
    // Not a nicety. TIE_BREAK_ORDER *drives the scoring loop* in classifier.ts:
    //
    //   const scores = TIE_BREAK_ORDER.map((category) => ...scoreCategory(category, input))
    //
    // A category missing here is never scored at all. It stays in the taxonomy,
    // keeps its lexicon and its colour, and simply never gets assigned to
    // anything — silently, with no error and no warning.
    expect([...TIE_BREAK_ORDER].sort()).toEqual([...NAMABLE].sort());
  });

  it('lists nothing that is not a category', () => {
    for (const category of TIE_BREAK_ORDER) expect(CATEGORIES).toContain(category);
  });

  it('has no duplicates, which would score a category twice', () => {
    expect(new Set(TIE_BREAK_ORDER).size).toBe(TIE_BREAK_ORDER.length);
  });

  it('puts every charged category ahead of every topic', () => {
    // Documented behaviour, not presentation: a reel that is both charged and
    // on a topic — a heartbreak song, a motivational gym clip — is counted for
    // what detection cares about.
    const lastCharged = Math.max(...TIE_BREAK_ORDER.map((c, i) => (isCharged(c) ? i : -1)));
    const firstTopic = TIE_BREAK_ORDER.findIndex((c) => !isCharged(c));
    expect(lastCharged).toBeLessThan(firstTopic);
  });
});

describe('LEXICON', () => {
  it('covers every namable category', () => {
    expect(Object.keys(LEXICON).sort()).toEqual([...NAMABLE].sort());
  });

  it('gives every category something to match on', () => {
    // An entry with no terms is a category that exists and can never win.
    for (const [category, entry] of Object.entries(LEXICON)) {
      const terms = [entry.words, entry.phrases, entry.hashtags, entry.emoji]
        .filter(Boolean)
        .reduce((n, list) => n + list.length, 0);
      expect(terms, `${category} has no terms`).toBeGreaterThan(0);
    }
  });
});

describe('the palette', () => {
  it('covers every category, including neutral', () => {
    expect(Object.keys(CATEGORY_COLORS).sort()).toEqual([...CATEGORIES].sort());
  });

  it('never lets a real category fall back to the no-text fill', () => {
    // The fallback is a near-background grey chosen to recede. A category
    // reaching it is present in the data and invisible in every chart.
    for (const category of CATEGORIES) {
      expect(colorForCategory(category), category).not.toBe(UNCLASSIFIED_COLOR);
    }
  });

  it('gives each category its own colour', () => {
    // Two categories sharing a fill are indistinguishable in the mix bar, the
    // day stacks and the session strip.
    expect(new Set(Object.values(CATEGORY_COLORS)).size).toBe(CATEGORIES.length);
  });

  it('still falls back for the keys that are deliberately not categories', () => {
    expect(colorForCategory('unclassified')).toBe(UNCLASSIFIED_COLOR);
  });
});

describe('the two tiers', () => {
  it('partition the taxonomy exactly', () => {
    expect([...CHARGED_CATEGORIES, ...TOPIC_CATEGORIES, 'neutral'].sort()).toEqual(
      [...CATEGORIES].sort(),
    );
  });

  it('do not overlap', () => {
    const topics = new Set(TOPIC_CATEGORIES);
    for (const c of CHARGED_CATEGORIES) expect(topics.has(c)).toBe(false);
  });

  it('agree with isCharged', () => {
    for (const c of CHARGED_CATEGORIES) expect(isCharged(c)).toBe(true);
    for (const c of TOPIC_CATEGORIES) expect(isCharged(c)).toBe(false);
    expect(isCharged('neutral')).toBe(false);
    expect(isCharged(null)).toBe(false);
  });
});
