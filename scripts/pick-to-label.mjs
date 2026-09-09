// Chooses which unlabeled reels are worth labeling next.
//
// The labeled set is 701 reels and its class balance is the problem: among the
// 532 readable rows, `breakup` and `joyful` have four examples each, `angry`
// and `motivational` five. Those are the categories the whole tool is built to
// notice, and at that support every accuracy number about them is noise —
// breakup currently scores 100% recall and 44% precision, which says nothing
// except that four examples cannot settle the question. Training anything on
// that distribution, or gating a merge on it, would be measuring the sample
// rather than the classifier.
//
// Labeling another 3,000 rows at random would not fix it either: a random
// sample of this feed is ~40% neutral and ~13% charged, so it would add ~390
// charged examples only by spending an afternoon labeling comedy. This picks
// the rows where a label actually changes what we know.
//
//   node scripts/pick-to-label.mjs reels.csv --exclude to-label.csv > next.csv
//
// Then label `next.csv` in tools/label.html and merge it into the benchmark.
//
// Deliberately different from `eval.mjs template` in one respect: humanLabel
// comes out BLANK, not pre-filled with the classifier's guess. Pre-filling is
// fine when you are correcting a sheet you already trust, and a trap here —
// the classes being expanded are exactly the ones the classifier is worst at,
// so confirming its guesses would bake its current errors into the benchmark
// it is measured against.

import { writeFileSync } from 'node:fs';
import {
  csvCell,
  hasText,
  inputOf,
  loadClassifier,
  loadTaxonomy,
  loadTuning,
  readRecords,
  rowKey,
} from './lib/sheet.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const excludeFiles = args
  .map((a, i) => (a === '--exclude' ? args[i + 1] : null))
  .filter(Boolean);
const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 300);

if (!file) {
  console.error(
    'usage: node scripts/pick-to-label.mjs <reels.csv> [--exclude labeled.csv] [--limit=300]',
  );
  process.exit(1);
}

/**
 * Rows to draw per charged category, when that many candidates exist.
 *
 * Sized to take the thin classes from single digits to a support where a
 * per-class recall figure means something and a stratified fold is not mostly
 * empty. It is a floor for usefulness, not a statistically derived number.
 */
const CHARGED_QUOTA = 30;

/** Cap per topic category, so the sheet does not refill with comedy. */
const TOPIC_QUOTA = 8;

/**
 * Neutral rows carried along regardless of any signal.
 *
 * Without these the sheet is entirely rows some heuristic already found
 * interesting, and a benchmark built only from interesting rows overstates
 * accuracy on the ordinary feed. This keeps a plain slice in the mix.
 */
const NEUTRAL_CONTROL = 40;

/** Confidence band counted as "the classifier was unsure". */
const UNSURE_BELOW = 0.45;

const { classify } = await loadClassifier();
const { buildTuningReport } = await loadTuning();
const { isCharged } = await loadTaxonomy();

const records = readRecords(file);

// Rows already labeled are matched on the text the labeler saw: the sheets
// drop the id column, so there is nothing else in common between them.
const seen = new Set();
for (const f of excludeFiles) {
  for (const rec of readRecords(f)) seen.add(rowKey(rec));
}

const candidates = records.filter((rec) => hasText(rec) && !seen.has(rowKey(rec)));

// The vocabulary the lexicon is missing, as ranked by the same report the
// options page shows. Rows containing these terms are where the recall gap
// lives, so a label on one of them is worth more than a label on a row the
// classifier already handles.
const events = candidates.map((rec) => {
  const input = inputOf(rec);
  const result = classify(input);
  return { ...input, category: result ? result.category : null };
});
const report = buildTuningReport(events, 60);
const missingTerms = new Set(
  [...report.topHashtags, ...report.topWords].map((t) => t.term.toLowerCase()),
);

function mentionsMissingTerm(rec) {
  const haystack = `${rec.captionText || ''} ${rec.hashtags || ''}`.toLowerCase();
  for (const term of missingTerms) {
    if (haystack.includes(term)) return true;
  }
  return false;
}

/**
 * Why a row is worth a label. Ordered strongest first; each row is filed under
 * the first reason that applies, so the sheet explains itself.
 */
function reasonFor(rec) {
  const result = classify(inputOf(rec));
  const category = result?.category ?? 'unclassified';
  const confidence = result?.confidence ?? 0;

  if (isCharged(category)) return { band: `charged:${category}`, category, confidence };
  if (category !== 'neutral' && confidence < UNSURE_BELOW) {
    return { band: 'unsure', category, confidence };
  }
  if (category === 'neutral' && mentionsMissingTerm(rec)) {
    return { band: 'neutral-with-signal', category, confidence };
  }
  if (category === 'neutral') return { band: 'neutral-control', category, confidence };
  return { band: `topic:${category}`, category, confidence };
}

const byBand = new Map();
for (const rec of candidates) {
  const reason = reasonFor(rec);
  if (!byBand.has(reason.band)) byBand.set(reason.band, []);
  byBand.get(reason.band).push({ rec, ...reason });
}

function quotaFor(band) {
  if (band.startsWith('charged:')) return CHARGED_QUOTA;
  if (band === 'unsure') return CHARGED_QUOTA;
  if (band === 'neutral-with-signal') return CHARGED_QUOTA * 2;
  if (band === 'neutral-control') return NEUTRAL_CONTROL;
  return TOPIC_QUOTA;
}

const picked = [];
for (const [band, rows] of [...byBand].sort(([a], [b]) => a.localeCompare(b))) {
  // Least-confident first within a band: those sit nearest the decision
  // boundary, where a human label is most informative. The neutral control is
  // the exception — it is meant to be an ordinary slice, so it is left in feed
  // order rather than sorted toward anything.
  const ordered =
    band === 'neutral-control' ? rows : [...rows].sort((a, b) => a.confidence - b.confidence);
  picked.push(...ordered.slice(0, quotaFor(band)));
}

const sheet = picked.slice(0, limit);

const header = ['humanLabel', 'guess', 'whyPicked', 'captionText', 'hashtags', 'audioName'];
const lines = [header.join(',')];
for (const { rec, band, category } of sheet) {
  lines.push(
    [
      // Blank on purpose. See the note at the top of this file.
      '',
      category,
      band,
      csvCell(rec.captionText),
      csvCell(rec.hashtags),
      csvCell(rec.audioName),
    ].join(','),
  );
}

writeFileSync(1, lines.join('\n') + '\n');

const counts = {};
for (const { band } of sheet) counts[band] = (counts[band] ?? 0) + 1;

console.error(`\n  ${candidates.length} unlabeled readable rows available`);
console.error(`  ${sheet.length} picked\n`);
for (const [band, n] of Object.entries(counts).sort(([, a], [, b]) => b - a)) {
  console.error(`    ${band.padEnd(24)} ${n}`);
}
console.error('\n  Label the humanLabel column, then merge into your benchmark and run:');
console.error('    node scripts/eval.mjs eval <merged.csv>\n');
