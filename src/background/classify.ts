// Classification dispatcher.
//
// One entry point so the write path never names an engine directly. Only the
// local rules engine exists today; the reserved local mode uses the same
// rules until an alternative implementation is available.

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
      // Not built yet. Falling back keeps tracking working rather than
      // silently dropping the category for every reel if the setting is
      // flipped ahead of the implementation landing.
      return classifyWithRules(input);
    default:
      return classifyWithRules(input);
  }
}
