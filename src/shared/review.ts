import { classifyDimensions, type ClassifierInput } from './classifier.js';
import { LEXICON_VERSION } from './lexicon.js';
import { TOPIC_CATEGORIES, CHARGED_CATEGORIES } from './taxonomy.js';
import type { ReelReview, ClassificationDetails, Abstention } from './types.js';

export function validateReview(
  input: ClassifierInput & { classificationDetails?: ClassificationDetails; review?: ReelReview },
  payload: unknown,
): ReelReview {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid review');
  const { topic, tone } = payload as { topic: unknown; tone: unknown };
  if (
    !(topic === null || TOPIC_CATEGORIES.some((c) => c === topic)) ||
    !(tone === null || CHARGED_CATEGORIES.some((c) => c === tone))
  ) {
    throw new Error('Invalid topic or tone');
  }
  function abstention(value: unknown): Abstention | undefined {
    if (value === undefined || value === 'unsure' || value === 'other') return value;
    throw new Error('Invalid review reason');
  }
  const reasons = payload as { topicAbstention?: unknown; toneAbstention?: unknown };
  const predicted = input.classificationDetails ?? classifyDimensions(input);
  return {
    method: input.review ? 'correction' : 'hidden-prediction',
    topicAbstention: topic === null ? abstention(reasons.topicAbstention) : undefined,
    toneAbstention: tone === null ? abstention(reasons.toneAbstention) : undefined,
    topic: topic as string | null,
    tone: tone as string | null,
    predictedTopic: predicted.topic,
    predictedTone: predicted.tone,
    version: LEXICON_VERSION,
    engine: input.classificationDetails?.engine ?? 'local-rules',
    reviewedAt: Date.now(),
  };
}
