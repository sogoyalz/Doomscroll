import { cleanCaption } from './caption.js';
import type { ClassifierInput } from './classifier.js';
import type { ClassificationResult } from './types.js';

export const MODEL_ID = 'nli-deberta-v3-xsmall';
export const MODEL_VERSION = 'deberta-nli-q8-v1';
export const TOPIC_LABELS: Record<string, string> = {
  comedy: 'comedy',
  music: 'music',
  dance: 'dance',
  food: 'cooking',
  fitness: 'physical fitness',
  sports: 'sports',
  tech: 'computer technology',
  fashion: 'fashion and clothing',
  travel: 'travel',
  gaming: 'video games',
  pets: 'animals',
  art: 'painting and drawing',
  entertainment: 'movies and television',
  learning: 'education and career advice',
};
export const TONE_LABELS: Record<string, string> = {
  joyful: 'happiness and celebration',
  sad: 'sadness and grief',
  breakup: 'heartbreak and breaking up with a partner',
  anxious: 'anxiety and worry',
  angry: 'anger and outrage',
  motivational: 'motivation and encouragement',
  romantic: 'romantic love and relationships',
};

export function modelText(input: ClassifierInput): string {
  // Never infer the subject from background music. Limit inference work per reel.
  return [
    cleanCaption(input.captionText) ?? '',
    ...input.hashtags.map((tag) => tag.replace(/_/g, ' ')),
  ]
    .join(' ')
    .replace(/https?:\/\/\S+|@[\w.]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

export interface ModelScores {
  labels: string[];
  scores: number[];
}
export function chooseModelLabel(
  result: ModelScores,
  labels: Record<string, string>,
  minimum: number,
): string | null {
  const [top = 0, second = 0] = result.scores;
  if (!Number.isFinite(top) || !Number.isFinite(second) || top < minimum || top - second < 0.15)
    return null;
  return Object.keys(labels).find((key) => labels[key] === result.labels[0]) ?? null;
}

export function modelResult(
  topicScores: ModelScores,
  toneScores: ModelScores,
): ClassificationResult {
  const topic = chooseModelLabel(topicScores, TOPIC_LABELS, 0.6);
  const tone = chooseModelLabel(toneScores, TONE_LABELS, 0.8);
  // A love song is music: a romantic tone does not replace a song topic.
  const leadTone =
    tone === 'romantic' && (topic === 'music' || topic === 'dance') ? null : tone;
  return {
    category: leadTone ?? topic ?? 'neutral',
    confidence: leadTone ? toneScores.scores[0]! : topic ? topicScores.scores[0]! : 0,
    subtags: [],
    details: {
      topic,
      tone,
      ...(topic && { topicConfidence: topicScores.scores[0]! }),
      ...(tone && { toneConfidence: toneScores.scores[0]! }),
      engine: MODEL_VERSION,
      status: topic || tone ? 'classified' : 'uncertain',
    },
  };
}

/** A model tone is only trusted alone when it is this sure. */
const MODEL_TONE_ALONE = 0.9;

/**
 * Combines the word lists with the local model for the stored category.
 *
 * A model-only tone can trigger an interruption, so it needs stronger support
 * than a topic.
 *
 * - When the word lists found a category the creator wrote, it stands. Tone
 *   can drive interruptions and needs that precision.
 * - Otherwise the model's topic names the reel.
 * - A model tone with no written support counts only when it is very sure.
 * - A romantic reading never replaces a music or dance topic (a love song is
 *   music), matching the rules classifier.
 *
 * `details` keeps the model's own topic and tone for the review screen.
 */
export function combineWithRules(
  rules: ClassificationResult | null,
  model: ClassificationResult | null,
): ClassificationResult | null {
  if (!model?.details) return rules;
  const details = model.details;
  if (rules && rules.category !== 'neutral') return { ...rules, details };

  const topic = details.topic ?? null;
  const tone = details.tone ?? null;
  // Older rows stored only the winning category's score.
  const toneConfidence =
    details.toneConfidence ?? (model.category === tone ? model.confidence : 0);
  const topicConfidence =
    details.topicConfidence ?? (model.category === topic ? model.confidence : 0);
  const songTopic = topic === 'music' || topic === 'dance';
  if (tone && !(tone === 'romantic' && songTopic) && toneConfidence >= MODEL_TONE_ALONE) {
    return { category: tone, confidence: toneConfidence, subtags: [], details };
  }
  if (topic) return { category: topic, confidence: topicConfidence, subtags: [], details };
  return rules ? { ...rules, details } : { ...model, category: 'neutral', details };
}
