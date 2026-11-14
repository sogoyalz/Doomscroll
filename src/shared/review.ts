import { classifyDimensions, type ClassifierInput } from './classifier.js';
import { LEXICON_VERSION } from './lexicon.js';
import { TOPIC_CATEGORIES, CHARGED_CATEGORIES } from './taxonomy.js';
import type { ReelReview, ClassificationDetails } from './types.js';

export function validateReview(
  input: ClassifierInput & { classificationDetails?: ClassificationDetails },
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
  const predicted = input.classificationDetails ?? classifyDimensions(input);
  return {
    topic: topic as string | null,
    tone: tone as string | null,
    predictedTopic: predicted.topic,
    predictedTone: predicted.tone,
    version: LEXICON_VERSION,
    engine: input.classificationDetails?.engine ?? 'local-rules',
    reviewedAt: Date.now(),
  };
}
