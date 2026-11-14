// A synthetic smoke benchmark, NOT a representative or independent accuracy test.
import { readFile } from 'node:fs/promises';
import { env, pipeline } from '@huggingface/transformers';
import { loadModule } from './lib/sheet.mjs';
const { MODEL_ID, TOPIC_LABELS, TONE_LABELS, modelResult, modelText } = await loadModule(
  'src/shared/model-labels.ts',
);
const { classifyDimensions } = await loadModule('src/shared/classifier.ts');
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = './public/models/';
const model = await pipeline('zero-shot-classification', MODEL_ID, { dtype: 'q8' });
const examples = JSON.parse(await readFile('tests/fixtures/model/examples.json', 'utf8'));
let rulesCorrect = 0,
  modelCorrect = 0,
  labeled = 0;
const results = [];
for (const example of examples) {
  const input = { captionText: example.captionText, hashtags: [], audioName: null };
  const text = modelText(input);
  const topic = await model(text, Object.values(TOPIC_LABELS), {
    hypothesis_template: 'This text is about {}.',
    multi_label: false,
  });
  const tone = await model(text, Object.values(TONE_LABELS), {
    hypothesis_template: 'This text is about {}.',
    multi_label: false,
  });
  const predicted = modelResult(topic, tone).details;
  const rules = classifyDimensions(input);
  for (const dimension of ['topic', 'tone']) {
    if (example[dimension] === null) continue;
    labeled++;
    rulesCorrect += rules[dimension] === example[dimension] ? 1 : 0;
    modelCorrect += predicted[dimension] === example[dimension] ? 1 : 0;
  }
  results.push({
    caption: example.captionText,
    expected: { topic: example.topic, tone: example.tone },
    rules,
    model: predicted,
  });
}
console.log(
  JSON.stringify(
    {
      scope:
        'Synthetic development examples; not real-feed accuracy. Null expected labels are not scored.',
      labeled,
      rulesCorrect,
      modelCorrect,
      results,
    },
    null,
    2,
  ),
);
await model.dispose();
