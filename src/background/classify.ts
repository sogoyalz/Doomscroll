import {
  classify as classifyWithRules,
  classifyDimensions,
  type ClassifierInput,
} from '@shared/classifier.js';
import type { ClassificationResult, UserSettings } from '@shared/types.js';
import { classifyWithModel } from './model.js';

export async function classifyReel(
  input: ClassifierInput,
  mode: UserSettings['classificationMode'] = 'local-rules',
): Promise<ClassificationResult | null> {
  if (mode === 'local-ml') {
    try {
      return await classifyWithModel(input);
    } catch {
      const fallback = classifyWithRules(input);
      return (
        fallback && {
          ...fallback,
          details: {
            ...classifyDimensions(input),
            engine: 'local-rules',
            status: 'fallback',
          },
        }
      );
    }
  }
  return classifyWithRules(input);
}
