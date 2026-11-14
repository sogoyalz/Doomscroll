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
  return [input.captionText ?? '', ...input.hashtags.map((tag) => tag.replace(/_/g, ' '))]
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
  return {
    category: tone ?? topic ?? 'neutral',
    confidence: tone ? toneScores.scores[0]! : topic ? topicScores.scores[0]! : 0,
    subtags: [],
    details: {
      topic,
      tone,
      engine: MODEL_VERSION,
      status: topic || tone ? 'classified' : 'uncertain',
    },
  };
}
