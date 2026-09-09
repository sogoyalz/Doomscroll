// Classification dispatcher.
//
// One entry point so the write path never names an engine directly. Only the
// local rules engine exists today; 'local-ml' and 'cloud-llm' are v2, and each
// is its own accuracy and privacy surface rather than a drop-in swap.

import { classify as classifyWithRules, type ClassifierInput } from '@shared/classifier.js';
import type { ClassificationResult, UserSettings } from '@shared/types.js';

export function classifyReel(
  input: ClassifierInput,
  mode: UserSettings['classificationMode'] = 'local-rules',
): ClassificationResult | null {
  switch (mode) {
    case 'local-rules':
      return classifyWithRules(input);
    case 'local-ml':
    case 'cloud-llm':
      // Not built yet. Falling back keeps tracking working rather than
      // silently dropping the category for every reel if the setting is
      // flipped ahead of the implementation landing.
      return classifyWithRules(input);
    default:
      return classifyWithRules(input);
  }
}
