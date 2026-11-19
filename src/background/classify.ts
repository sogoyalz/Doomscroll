import {
  classify as classifyWithRules,
  classifyDimensions,
  type ClassifierInput,
} from '@shared/classifier.js';
import type { ClassificationResult, UserSettings } from '@shared/types.js';
import { classifyWithModel } from './model.js';
import { combineWithRules } from '@shared/model-labels.js';

export async function classifyReel(
  input: ClassifierInput,
  mode: UserSettings['classificationMode'] = 'local-rules',
): Promise<ClassificationResult | null> {
  if (mode === 'local-ml') {
    try {
      // The model never reads the soundtrack, so neither does the rules side
      // of the combination: a song title must not outvote the caption.
      const written = classifyWithRules({ ...input, audioName: null });
      return combineWithRules(written, await classifyWithModel(input));
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
