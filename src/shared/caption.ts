// Caption cleanup shared by the page extractor and both classifiers.
// Kept separate so the content script does not bundle the word lists.

/**
 * Instagram collapses long captions to a first line followed by "… more".
 * That suffix is interface text, not the creator's words, and stored history
 * still contains it, so it is removed wherever a caption is read.
 */
export function cleanCaption(caption: string | null): string | null {
  if (caption == null) return null;
  const cleaned = caption.replace(/\s*(?:…|\.\.\.)\s*more\s*$/iu, '').trim();
  return cleaned || null;
}

// Distribution tags can appear inline, as extracted links, or both. They
// describe where a creator wants a post shown, irrespective of its subject.
export const DISCOVERY_TAGS = new Set([
  'explore',
  'explorepage',
  'exploremore',
  'fyp',
  'fypage',
  'fypp',
  'foryou',
  'foryoupage',
  'foryoupageofficiall',
  'trending',
  'trend',
  'viral',
  'reelsinstagram',
  'reelsindia',
  'reelindia',
  'instagood',
  'trendingreels',
  'reelitfeelit',
  'reelkarofeelkaro',
  'viralreels',
  'reelsviral',
]);

/** The text and distinct subject tags used by both classification engines. */
export function captionSignals(caption: string | null, hashtags: string[]) {
  const tags = new Set(hashtags.map((tag) => tag.replace(/^#/, '').toLowerCase()));
  const prose = (cleanCaption(caption) ?? '')
    .replace(/https?:\/\/\S+|@[\w.]+/giu, ' ')
    .replace(/#([\p{L}\p{N}\p{M}_]+)/gu, (_, tag: string) => {
      tags.add(tag.toLowerCase());
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return {
    captionText: prose || null,
    hashtags: [...tags].filter((tag) => tag && !DISCOVERY_TAGS.has(tag)),
  };
}
