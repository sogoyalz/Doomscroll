// Public classification API: classify(text) -> { mood, score, matched, wordHits, emojiHits }
// Swap the heuristic engine for llmClassifier.js behind this same interface.

import { MOOD_DEFS, MOOD_ORDER, WORD_WEIGHT, EMOJI_WEIGHT } from './rules.js';
import type { ClassifyResult, Mood } from '../lib/types.js';

interface Matcher {
  type: 'word' | 'emoji';
  re: RegExp;
  raw: string;
  weight: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatchers(): Record<string, Matcher[]> {
  const matchers: Record<string, Matcher[]> = {};
  for (const mood of MOOD_ORDER) {
    const def = MOOD_DEFS[mood];
    const wordMatchers: Matcher[] = (def?.words || []).map((w) => ({
      type: 'word',
      re: new RegExp(`\\b${escapeRegExp(w)}\\b`, 'gi'),
      raw: w,
      weight: WORD_WEIGHT,
    }));
    const emojiMatchers: Matcher[] = (def?.emojis || []).map((e) => ({
      type: 'emoji',
      re: new RegExp(escapeRegExp(e), 'g'),
      raw: e,
      weight: EMOJI_WEIGHT,
    }));
    matchers[mood] = [...wordMatchers, ...emojiMatchers];
  }
  return matchers;
}

const MOOD_MATCHERS = buildMatchers();

export function classify(text: string): ClassifyResult {
  if (!text) return { mood: 'undetectable', score: 0, matched: {}, wordHits: {}, emojiHits: {} };

  const scores: Partial<Record<Mood, number>> = {};
  const wordHits: Partial<Record<Mood, number>> = {};
  const emojiHits: Partial<Record<Mood, number>> = {};
  const matched: Partial<Record<Mood, string[]>> = {};

  for (const mood of MOOD_ORDER) {
    let score = 0;
    let wHits = 0;
    let eHits = 0;
    matched[mood] = [];

    for (const { type, re, weight, raw } of MOOD_MATCHERS[mood] ?? []) {
      const matches = text.match(re);
      if (matches && matches.length) {
        if (type === 'word') wHits += matches.length;
        else eHits += matches.length;
        score += weight * matches.length;
        matched[mood]!.push(raw);
      }
    }

    // Guard: avoid single-emoji gaming false positives.
    if (mood === 'gaming' && wHits === 0 && eHits < 2) {
      score = 0;
      matched[mood] = [];
    }
    // Funny vs happy emoji-only tie-break: 😂/🤣 strongly imply humor.
    if (mood === 'funny' && wHits === 0 && eHits > 0) {
      score += 0.1;
    }

    scores[mood] = score;
    wordHits[mood] = wHits;
    emojiHits[mood] = eHits;
  }

  let bestMood: Mood = 'undetectable';
  let best = { score: 0, w: 0, total: 0 };
  for (const mood of MOOD_ORDER) {
    const s = scores[mood] ?? 0;
    const w = wordHits[mood] ?? 0;
    const total = (wordHits[mood] ?? 0) + (emojiHits[mood] ?? 0);
    const better =
      s > best.score ||
      (s === best.score && w > best.w) ||
      (s === best.score && w === best.w && total > best.total);
    if (better) {
      bestMood = mood;
      best = { score: s, w, total };
    }
  }

  if (best.score <= 0) return { mood: 'undetectable', score: 0, matched: {}, wordHits, emojiHits };
  return { mood: bestMood, score: best.score, matched, wordHits, emojiHits };
}
