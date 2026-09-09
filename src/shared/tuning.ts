// Lexicon tuning report.
//
// When most of a feed classifies as neutral there are two explanations that
// look identical in the percentages: the lexicon is missing that feed's
// vocabulary, or the taxonomy does not describe that feed's content at all.
// The first is fixed by adding terms; the second is not fixable by adding
// terms. Telling them apart requires looking at what the missed reels
// actually say.
//
// This surfaces exactly that: the most frequent words and hashtags among
// reels that found nothing, with stopwords and terms already in the lexicon
// removed, so what is left is the candidate list.

import { LEXICON } from './lexicon.js';
import type { ReelEvent } from './types.js';

/**
 * Function words and Instagram boilerplate. Not a general stopword list —
 * just enough to stop "the" and "#reels" from crowding out the signal.
 */
const STOPWORDS = new Set([
  // English function words
  'the', 'and', 'for', 'you', 'your', 'with', 'that', 'this', 'have', 'has',
  'was', 'are', 'but', 'not', 'from', 'they', 'them', 'his', 'her', 'she',
  'him', 'its', 'our', 'out', 'all', 'can', 'will', 'just', 'what', 'when',
  'who', 'why', 'how', 'get', 'got', 'one', 'two', 'now', 'new', 'more',
  'most', 'some', 'any', 'been', 'being', 'were', 'their', 'there', 'then',
  'than', 'into', 'over', 'about', 'after', 'before', 'would', 'could',
  'should', 'like', 'make', 'made', 'want', 'need', 'know', 'see', 'come',
  'day', 'time', 'people', 'part', 'via', 'don', 'let', 'off', 'per',
  // Platform boilerplate that appears on almost everything
  'reel', 'reels', 'video', 'follow', 'followers', 'following', 'link',
  'bio', 'comment', 'comments', 'share', 'tag', 'dm', 'post', 'page',
  'viral', 'trending', 'explore', 'fyp', 'foryou', 'foryoupage', 'instagram',
  'insta', 'ig', 'shorts', 'subscribe', 'watch', 'full',
  // Discovery-tag spam seen dominating a real feed's neutral misses. These
  // carry no content signal — a reel tagged only with these is genuinely
  // neutral, so they should not clutter the "what's missing" report.
  'explorepage', 'exploremore', 'reelsinstagram', 'reelsindia', 'reelindia',
  'instagood', 'trendingreels', 'reelitfeelit', 'reelkarofeelkaro',
  'viralreels', 'reelsviral', 'trend', 'fypage', 'fypp', 'foryoupageofficiall',
]);

const MIN_TERM_LENGTH = 3;

/**
 * Terms that can already match on their own, so the report shows only gaps.
 *
 * Deliberately excludes words that merely appear inside a multi-word phrase.
 * Bare "love" is not a romantic term — it was removed precisely because it is
 * too overloaded — and it only survives inside phrases like "in love". If it
 * turns out to dominate the captions that matched nothing, that is exactly
 * the finding worth surfacing, so treating it as already-known would hide it.
 */
function matchableTerms(): Set<string> {
  const known = new Set<string>();
  for (const table of Object.values(LEXICON)) {
    for (const word of table.words) known.add(word);
    for (const tag of table.hashtags) known.add(tag);
  }
  return known;
}

export interface TermCount {
  term: string;
  count: number;
}

export interface TuningReport {
  totalReels: number;
  /** Had text, but nothing in the lexicon matched. */
  neutralReels: number;
  /** Had no caption, hashtags, or audio name at all. */
  textlessReels: number;
  /** Reels that did get a category. */
  classifiedReels: number;
  topWords: TermCount[];
  topHashtags: TermCount[];
  /** Verbatim captions from neutral reels, for judging content type. */
  sampleCaptions: string[];
}

function tally(counts: Map<string, number>, term: string): void {
  counts.set(term, (counts.get(term) ?? 0) + 1);
}

function ranked(counts: Map<string, number>, limit: number): TermCount[] {
  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    // Alphabetical secondary sort keeps the list stable between reloads.
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit);
}

const SAMPLE_LIMIT = 12;
const SAMPLE_MAX_CHARS = 120;

export function buildTuningReport(events: ReelEvent[], limit = 25): TuningReport {
  const known = matchableTerms();
  const words = new Map<string, number>();
  const hashtags = new Map<string, number>();
  const samples: string[] = [];

  let neutralReels = 0;
  let textlessReels = 0;
  let classifiedReels = 0;

  for (const event of events) {
    if (event.category === null) {
      textlessReels++;
      continue;
    }
    if (event.category !== 'neutral') {
      classifiedReels++;
      continue;
    }

    neutralReels++;

    for (const tag of event.hashtags) {
      const term = tag.toLowerCase();
      if (STOPWORDS.has(term) || known.has(term)) continue;
      tally(hashtags, term);
    }

    const caption = event.captionText?.trim();
    if (!caption) continue;

    if (samples.length < SAMPLE_LIMIT) {
      samples.push(
        caption.length > SAMPLE_MAX_CHARS
          ? `${caption.slice(0, SAMPLE_MAX_CHARS).trimEnd()}…`
          : caption,
      );
    }

    // \p{M} matters as much as \p{L} here: in Devanagari, Arabic, Thai and
    // others the vowel signs are combining marks, not letters. Splitting on
    // them shatters every word into single characters that then fail the
    // minimum length — which would silently hide a non-English feed, the
    // exact thing this report exists to reveal.
    for (const raw of caption.toLowerCase().split(/[^\p{L}\p{N}\p{M}']+/u)) {
      if (raw.length < MIN_TERM_LENGTH) continue;
      if (/^\d+$/.test(raw)) continue;
      if (STOPWORDS.has(raw) || known.has(raw)) continue;
      tally(words, raw);
    }
  }

  return {
    totalReels: events.length,
    neutralReels,
    textlessReels,
    classifiedReels,
    topWords: ranked(words, limit),
    topHashtags: ranked(hashtags, limit),
    sampleCaptions: samples,
  };
}
