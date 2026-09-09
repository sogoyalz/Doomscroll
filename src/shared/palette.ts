// Category colours.
//
// Two tiers, two treatments. CHARGED categories keep saturated, distinct hues
// — warm for high-arousal, cool for low — because they are what the tool is
// actually about. TOPIC categories are muted and hue-adjacent so they read as
// context: present in the bar, but visibly quieter than a charged finding.
//
// Unclassified gets a near-background fill: it is not a category, it is the
// part of the feed nothing could be read from, and it should recede.

import type { Category, ChargedCategory, TopicCategory } from './taxonomy.js';

const CHARGED_COLORS: Record<ChargedCategory, string> = {
  joyful: '#dfae42',
  motivational: '#d4823c',
  romantic: '#c9677f',
  angry: '#bd5340',
  breakup: '#8f5f9b',
  sad: '#5480b4',
  anxious: '#4f978d',
};

// Desaturated, lower-contrast — deliberately less eye-catching than charged.
const TOPIC_COLORS: Record<TopicCategory, string> = {
  comedy: '#7f7a53',
  music: '#6d6a86',
  dance: '#846a80',
  food: '#87735a',
  fitness: '#5f7d6e',
  sports: '#5f7385',
  tech: '#66707f',
  fashion: '#83687a',
  travel: '#5c7c7d',
  gaming: '#6b6f84',
  pets: '#84755f',
  art: '#787084',
  entertainment: '#6a7a6a',
};

// Typed against the taxonomy, not `string`. A category added there and
// forgotten here would otherwise compile and then render in the near-background
// no-text fill — present in the data and invisible in every chart.
export const CATEGORY_COLORS: Record<Category, string> = {
  ...CHARGED_COLORS,
  ...TOPIC_COLORS,
  neutral: '#5a5a63',
};

export const UNCLASSIFIED_COLOR = '#2b2b33';

/**
 * Takes a `string`, not a `Category`, on purpose: callers also pass the
 * aggregate `topics` band and the `unclassified` bucket, neither of which is a
 * category. The table itself is typed against the taxonomy, so the permissive
 * lookup cannot hide a missing colour — only an intentionally non-category key
 * reaches the fallback.
 */
export function colorForCategory(category: string): string {
  return (CATEGORY_COLORS as Record<string, string>)[category] ?? UNCLASSIFIED_COLOR;
}
