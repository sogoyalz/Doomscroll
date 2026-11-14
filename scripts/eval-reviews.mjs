// Evaluate exported human reviews without treating the machine guess as truth.
// No captions or creator names are printed. Keep exports out of Git.
import { createHash } from 'node:crypto';
import { inputOf, loadClassifier, readRecords, rowKey } from './lib/sheet.mjs';

const [, , file, partition = 'holdout', engine = 'rules'] = process.argv;
if (
  !file ||
  !['development', 'holdout'].includes(partition) ||
  !['rules', 'model'].includes(engine)
) {
  console.error(
    'Usage: node scripts/eval-reviews.mjs exported-reels.csv [development|holdout] [rules|model]',
  );
  process.exit(1);
}
const { classifyDimensions } = await loadClassifier();
// Keep repeats of the same reel in one partition. Use latest reviewed view.
const unique = new Map();
for (const row of readRecords(file)
  .filter((r) => r.reviewedAt)
  .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))) {
  unique.set(row.reelShortcode || rowKey(row), row);
}
const counts = {
  reviewed: 0,
  topic: { labeled: 0, correct: 0, uncertain: 0 },
  tone: { labeled: 0, correct: 0, uncertain: 0 },
};
for (const [key, row] of unique) {
  const heldOut = createHash('sha256').update(key).digest()[0] % 5 === 0;
  if (heldOut !== (partition === 'holdout')) continue;
  if (engine === 'model' && row.reviewEngine !== 'deberta-nli-q8-v1') continue;
  counts.reviewed++;
  const predicted =
    engine === 'model'
      ? { topic: row.predictedTopic || null, tone: row.predictedTone || null }
      : classifyDimensions(inputOf(row));
  for (const dimension of ['topic', 'tone']) {
    const truth = row[dimension === 'topic' ? 'reviewTopic' : 'reviewTone'];
    // Blank means unsure/other, not a verified negative label.
    if (!truth) continue;
    counts[dimension].labeled++;
    if (predicted[dimension] === truth) counts[dimension].correct++;
    if (predicted[dimension] === null) counts[dimension].uncertain++;
  }
}
console.log(JSON.stringify({ partition, engine, ...counts }, null, 2));
console.log(
  'Correct/labeled includes uncertain predictions as misses. Blank human labels are excluded.',
);
console.log(
  'Tune on development only; reserve holdout for evaluation. Selected reviews are not representative feed accuracy.',
);
if (!counts.reviewed)
  console.log('No reviewed reels in this partition yet. No accuracy claim is available.');
