// Two-tier, closed-ended taxonomy.
//
// CHARGED categories are emotional registers. They are the only ones that can
// drive intervention, and pattern detection measures dominance among *these
// only* — being shown a lot of comedy is not a problem worth interrupting.
//
// TOPIC categories name the rest of the feed. Their entire job is to keep
// ordinary content (food, cricket, music, dance…) out of `neutral`. Without
// them a normal reels feed is ~70% neutral, because most reels have readable
// text but no emotional vocabulary — "neutral" was the classifier answering
// correctly against a taxonomy that could not name most of the feed.
//
// After both tiers exist:
//   - a charged category  -> emotional content, feeds detection
//   - a topic category    -> named, non-emotional content
//   - `neutral`           -> had text, matched nothing in either tier
//   - `unclassified`      -> had no text at all (never stored as a category)
//
// Still closed-ended on purpose: detection math needs a fixed set. Adding a
// category means adding it here and to the lexicon, deliberately.

export const CHARGED_CATEGORIES = [
  'joyful',
  'sad',
  'breakup',
  'anxious',
  'angry',
  'motivational',
  'romantic',
] as const;

export const TOPIC_CATEGORIES = [
  'comedy',
  'music',
  'dance',
  'food',
  'fitness',
  'sports',
  'tech',
  'fashion',
  'travel',
  'gaming',
  'pets',
  'art',
  'entertainment',
] as const;

// `neutral` is last so it reads as the fallback it is.
export const CATEGORIES = [...CHARGED_CATEGORIES, ...TOPIC_CATEGORIES, 'neutral'] as const;

export type ChargedCategory = (typeof CHARGED_CATEGORIES)[number];
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];
export type Category = (typeof CATEGORIES)[number];

const CHARGED_SET = new Set<string>(CHARGED_CATEGORIES);

/** True for the emotional categories that can drive detection. */
export function isCharged(category: string | null | undefined): boolean {
  return category != null && CHARGED_SET.has(category);
}
