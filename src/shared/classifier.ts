// Rules classifier: caption, hashtags, and audio name in, category out.
//
// Pure and synchronous. Text is the only signal available — dance clips,
// comedy skits, and pure-visual reels carry little or none, and no amount of
// lexicon tuning fixes that. Those reels come back unclassified, which is the
// honest answer; closing that gap needs vision or audio analysis, which is a
// different project.
//
// What this produces is a claim about the CONTENT the feed showed, never
// about how the viewer feels. Copy built on top of it has to preserve that.

import { LEXICON, TIE_BREAK_ORDER, type ClassifiableCategory } from './lexicon.js';
import { TOPIC_CATEGORIES, CHARGED_CATEGORIES, isCharged } from './taxonomy.js';
import type { ClassificationResult } from './types.js';
import { cleanCaption } from './caption.js';

export { cleanCaption };

export interface ClassifierInput {
  captionText: string | null;
  hashtags: string[];
  audioName: string | null;
}

// A hashtag is a deliberate authorial label, so it outweighs a word that
// merely appears in prose. Audio sits between the two: song titles are a
// strong hint for breakup and sad content, but the user did not write them.
const WEIGHT_HASHTAG = 3;
const WEIGHT_PHRASE = 2;
const WEIGHT_WORD = 1;
const WEIGHT_EMOJI = 1;
const AUDIO_WEIGHT_FACTOR = 0.5;

/**
 * Score at which a match is considered as strong as it needs to be.
 *
 * Three, so that one unambiguous caption word clears MIN_CONFIDENCE on its
 * own — "so anxious right now" should read as anxious — while a single
 * audio-only hit (half weight) does not.
 */
const SATURATION_SCORE = 3;

/**
 * Below this, a match is too weak to name a category and the reel is called
 * neutral instead. Keeps a lone half-weight audio match, or a term that ties
 * with a competing category, from dragging a reel into a charged bucket.
 */
const MIN_CONFIDENCE = 0.25;

/** Neutral is the absence of a positive finding, so it never claims more. */
const NEUTRAL_CONFIDENCE = 0.5;

const MAX_SUBTAGS = 5;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(normalized: string): Set<string> {
  // \p{M} keeps combining marks attached. In Devanagari, Arabic, Thai and
  // others the vowel signs are marks rather than letters, so omitting it
  // splits every word into single characters and no term can ever match.
  return new Set(normalized.split(/[^\p{L}\p{N}\p{M}']+/u).filter(Boolean));
}

interface Score {
  score: number;
  /**
   * Points from words, phrases, and hashtags the creator wrote.
   *
   * Hearts and song titles are excluded. A decorative ❤️ or a romantic track
   * name was outranking a caption that was actually about the outfit or the
   * song, because a tie prefers a charged category.
   */
  lexical: number;
  matched: Set<string>;
  /**
   * True when a caption or hashtag matched — i.e. the creator *wrote* about
   * this category. Audio-only matches do not set it, because a song title
   * routinely mismatches the content it plays over.
   */
  authored: boolean;
}

function scoreText(
  lexicon: (typeof LEXICON)[ClassifiableCategory],
  raw: string,
  weightFactor: number,
  authored: boolean,
  into: Score,
  /**
   * Emoji are scored everywhere except inside hashtags, where they are
   * decoration rather than sentiment: `#trendingsongs❤️` and `#fypシ❤️💞❤️`
   * are reach tags that happen to carry hearts, and reading them as romantic
   * was measurably worse than ignoring them.
   */
  scoreEmoji = true,
): void {
  const normalized = normalize(raw);
  if (!normalized) return;

  const mark = () => {
    if (authored) into.authored = true;
  };

  const tokens = tokenize(normalized);
  for (const word of lexicon.words) {
    if (tokens.has(word)) {
      const points = WEIGHT_WORD * weightFactor;
      into.score += points;
      if (authored) into.lexical += points;
      into.matched.add(word);
      mark();
    }
  }

  // Padding lets a plain includes() act as a word-boundary check without
  // relying on \b, which behaves poorly outside ASCII.
  const padded = ` ${normalized} `;
  for (const phrase of lexicon.phrases) {
    if (padded.includes(` ${phrase} `)) {
      const points = WEIGHT_PHRASE * weightFactor;
      into.score += points;
      if (authored) into.lexical += points;
      into.matched.add(phrase);
      mark();
    }
  }

  if (!scoreEmoji) return;

  for (const emoji of lexicon.emoji) {
    if (raw.includes(emoji)) {
      into.score += WEIGHT_EMOJI * weightFactor;
      into.matched.add(emoji);
      mark();
    }
  }
}

function scoreCategory(category: ClassifiableCategory, input: ClassifierInput): Score {
  const lexicon = LEXICON[category];
  const result: Score = { score: 0, lexical: 0, matched: new Set(), authored: false };

  if (input.captionText) scoreText(lexicon, input.captionText, 1, true, result);
  // Audio matches count toward the score but not toward `authored`: the user
  // did not choose the song, and its title routinely mismatches the content.
  if (input.audioName) scoreText(lexicon, input.audioName, AUDIO_WEIGHT_FACTOR, false, result);

  const tags = new Set(input.hashtags.map((t) => t.toLowerCase()));
  const curated = new Set<string>();
  for (const tag of lexicon.hashtags) {
    if (tags.has(tag)) {
      result.score += WEIGHT_HASHTAG;
      result.lexical += WEIGHT_HASHTAG;
      result.matched.add(`#${tag}`);
      result.authored = true;
      curated.add(tag);
    }
  }

  // A hashtag not on the curated list is still authored text, and the general
  // vocabulary applies to it. Without this the highest-weighted channel has by
  // far the smallest dictionary: `दर्द` in a caption reads as sad, while the
  // same word written `#दर्द` scored nothing at all, because only the
  // hashtag list was ever consulted for tags.
  //
  // Scored at caption weight rather than WEIGHT_HASHTAG: three is the premium
  // for a term someone curated into the lexicon as a deliberate label, and an
  // incidental vocabulary hit has not earned it. Tags already matched above
  // are skipped so nothing is counted twice.
  //
  // Token matching, not substring: `#sadhguru` tokenizes to one token that is
  // not `sad`, so it stays unmatched. Substring matching would classify it as
  // sad, and compound tags like `#sadstatus` are not worth that risk.
  for (const tag of tags) {
    if (!curated.has(tag)) scoreText(lexicon, tag, 1, true, result, false);
  }

  return result;
}

function cleanInput(input: ClassifierInput): ClassifierInput {
  return { ...input, captionText: cleanCaption(input.captionText) };
}

/**
 * Topics where a romantic word usually describes the song, not the reel.
 *
 * A cover of a love song, a playlist of romantic tracks, or a dance to one is
 * music or dance content. Calling it romantic was the most visible mistake in
 * real feeds. Sad and breakup songs are left charged on purpose: a run of
 * heartbreak tracks is exactly the narrowing the detector looks for.
 */
const SONG_TOPICS: readonly ClassifiableCategory[] = ['music', 'dance'];

/** True when there is nothing at all for the classifier to read. */
export function hasSignal(input: ClassifierInput): boolean {
  return Boolean(
    normalize(input.captionText ?? '') ||
    normalize(input.audioName ?? '') ||
    input.hashtags.length,
  );
}

/**
 * Classifies one reel.
 *
 * Returns `null` when there was no text to read — deliberately distinct from
 * 'neutral', which means the classifier did read something and found nothing
 * charged. Storage keeps null as an unclassified event so a day of unreadable
 * reels can never pass as a calm one.
 */
export function classify(raw: ClassifierInput): ClassificationResult | null {
  const input = cleanInput(raw);
  if (!hasSignal(input)) return null;

  const scores = TIE_BREAK_ORDER.map((category) => ({
    category,
    ...scoreCategory(category, input),
  }));

  // When the creator wrote a category word, that decides the reel. A song
  // title and a decorative heart still score, but they cannot replace a
  // written category or win a tie against one.
  const written = scores.some((candidate) => candidate.lexical > 0);
  const metric = (candidate: (typeof scores)[number]) =>
    written ? candidate.lexical : candidate.score;

  // TIE_BREAK_ORDER drives the iteration, and a strict `>` means the first
  // category in that order keeps the lead on an exact tie.
  let best = scores[0]!;
  let runnerUp = 0;
  for (const candidate of scores) {
    const value = metric(candidate);
    const lead = metric(best);
    if (value > lead) {
      runnerUp = lead;
      best = candidate;
    } else if (candidate !== best && value > runnerUp) {
      runnerUp = value;
    }
  }

  const confidence = confidenceFor(metric(best), runnerUp);

  // Charged content is favoured for recall. A real emotional signal must not
  // be dropped to neutral just because it is weak or ties with another charged
  // category — for this product a charged reel misread as neutral is a miss
  // the detector can never recover, whereas a topic reel is cosmetic. This is
  // safe: the detection layer enforces precision (it requires dominance over
  // the user's own baseline across many charged reels), so a single
  // low-confidence charged label cannot by itself trigger anything. Topics
  // keep the confidence floor so weak topic guesses do not flood the dashboard.
  // A below-floor result is rescued from neutral only when it is charged AND
  // the signal was authored (caption/hashtag, not audio alone) — a lone
  // half-weight song-title match is too unreliable to name a category from.
  const belowFloor = confidence < MIN_CONFIDENCE;
  const rescueCharged = belowFloor && isCharged(best.category) && best.authored;
  if (best.score <= 0 || (belowFloor && !rescueCharged)) {
    return { category: 'neutral', confidence: NEUTRAL_CONFIDENCE, subtags: [] };
  }

  // A love song is music. When the caption is about a song or a dance at
  // least as much as it is about romance, the topic names the reel. Applied
  // after the floor, so a weak soundtrack match can never be promoted by it.
  if (best.category === 'romantic') {
    const song = scores
      .filter((candidate) => SONG_TOPICS.includes(candidate.category))
      .sort((a, b) => metric(b) - metric(a))[0];
    if (song && metric(song) > 0 && metric(song) >= metric(best)) {
      return {
        category: song.category,
        confidence,
        subtags: [...song.matched].sort().slice(0, MAX_SUBTAGS),
      };
    }
  }

  return {
    category: best.category,
    confidence,
    subtags: [...best.matched].sort().slice(0, MAX_SUBTAGS),
  };
}

/**
 * Confidence combines how strong the winning score is with how far clear of
 * the runner-up it sits. A reel matching two categories equally is genuinely
 * ambiguous and should not be reported as a confident read of either.
 */
function confidenceFor(top: number, second: number): number {
  if (top <= 0) return 0;
  const strength = Math.min(1, top / SATURATION_SCORE);
  const separation = (top - second) / top;
  return strength * (0.5 + 0.5 * separation);
}

/** Independent, conservative labels for review. Unknown is not neutral. */
export function classifyDimensions(raw: ClassifierInput): {
  topic: string | null;
  tone: string | null;
} {
  // Hashtags are extracted separately: do not count the same tag as prose too.
  const input = cleanInput(raw);
  const authored = {
    ...input,
    captionText: input.captionText?.replace(/#[\p{L}\p{N}\p{M}_]+/gu, '') ?? null,
    audioName: null,
  };
  const choose = (categories: readonly ClassifiableCategory[]) => {
    const ranked = categories
      .map((category) => ({
        category,
        score: scoreCategory(category, authored).lexical,
      }))
      .sort((a, b) => b.score - a.score);
    const first = ranked[0]!;
    const second = ranked[1]?.score ?? 0;
    // A tied or weak reading is unresolved, not an arbitrary emotional label.
    return first.score > second && confidenceFor(first.score, second) >= MIN_CONFIDENCE
      ? first.category
      : null;
  };
  return { topic: choose(TOPIC_CATEGORIES), tone: choose(CHARGED_CATEGORIES) };
}
