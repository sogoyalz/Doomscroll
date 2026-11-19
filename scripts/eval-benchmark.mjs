// Scores the final category each engine would store against a labeled
// benchmark of Instagram-style captions.
//
// Usage: node scripts/eval-benchmark.mjs [dev|holdout] [rules|model|both] [--errors]
//
// The development set is for tuning. Reserve the holdout set for evaluation.
// Both sets use fictional captions:
// they show whether known failure patterns are fixed, not real-feed accuracy.
import { readFile } from 'node:fs/promises';
import { loadModule } from './lib/sheet.mjs';

const [, , split = 'dev', engine = 'both', ...flags] = process.argv;
if (!['dev', 'holdout'].includes(split) || !['rules', 'model', 'both'].includes(engine)) {
  console.error(
    'Usage: node scripts/eval-benchmark.mjs [dev|holdout] [rules|model|both] [--errors]',
  );
  process.exit(1);
}
const showErrors = flags.includes('--errors');
const examples = JSON.parse(
  await readFile(`tests/fixtures/model/benchmark-${split}.json`, 'utf8'),
);

const { classify } = await loadModule('src/shared/classifier.ts');
const engines = {};
if (engine !== 'model') {
  engines.rules = async (input) => classify(input)?.category ?? 'unclassified';
}
let model;
if (engine !== 'rules') {
  const { env, pipeline } = await import('@huggingface/transformers');
  const { MODEL_ID, TOPIC_LABELS, TONE_LABELS, modelResult, modelText, combineWithRules } =
    await loadModule('src/shared/model-labels.ts');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = './public/models/';
  model = await pipeline('zero-shot-classification', MODEL_ID, { dtype: 'q8' });
  const hypothesis_template = 'This text is about {}.';
  engines.model = async (input) => {
    const text = modelText(input);
    const written = classify({ ...input, audioName: null });
    const letters = text.match(/\p{L}/gu) ?? [];
    if (!letters.length) return written?.category ?? 'unclassified';
    if (
      letters.filter((letter) => /\p{Script=Latin}/u.test(letter)).length / letters.length <
      0.7
    )
      return classify(input)?.category ?? 'unclassified';
    const topic = await model(text, Object.values(TOPIC_LABELS), {
      hypothesis_template,
      multi_label: false,
    });
    const tone = await model(text, Object.values(TONE_LABELS), {
      hypothesis_template,
      multi_label: false,
    });
    const combined = combineWithRules(written, modelResult(topic, tone));
    return combined?.category ?? 'unclassified';
  };
}

const report = { split, examples: examples.length };
for (const [name, run] of Object.entries(engines)) {
  let correct = 0;
  let musicAsRomantic = 0;
  const perCategory = {};
  const errors = [];
  for (const example of examples) {
    const input = {
      captionText: example.captionText,
      hashtags: example.hashtags ?? [],
      audioName: example.audioName ?? null,
    };
    const predicted = await run(input);
    const gold = example.category;
    const row = (perCategory[gold] ??= { n: 0, correct: 0 });
    row.n++;
    if (predicted === gold) {
      correct++;
      row.correct++;
    } else {
      errors.push({ caption: example.captionText.slice(0, 90), gold, predicted });
    }
    if (gold === 'music' && predicted === 'romantic') musicAsRomantic++;
  }
  report[name] = {
    accuracy: Number((correct / examples.length).toFixed(3)),
    correct,
    musicAsRomantic,
    recall: Object.fromEntries(
      Object.entries(perCategory)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, `${v.correct}/${v.n}`]),
    ),
    ...(showErrors ? { errors } : {}),
  };
}
console.log(JSON.stringify(report, null, 2));
await model?.dispose();
