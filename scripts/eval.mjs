// Measures the classifier against reels YOU labeled by hand.
//
// This is the anti-"fake accuracy" tool. Every tuning change is judged by its
// effect on this benchmark, not by whether a number in the popup looks nicer.
//
// Three modes:
//
//   node scripts/eval.mjs template exported-reels.csv > to-label.csv
//     Turns an exported reels CSV into a labeling sheet: adds a humanLabel
//     column (pre-filled with the classifier's current guess so you only edit
//     the wrong ones) and drops columns irrelevant to labeling.
//
//   node scripts/eval.mjs eval labeled.csv
//     Runs classify() on each row and reports accuracy, per-category
//     precision/recall, the neutral rate, and a confusion matrix.
//
//   node scripts/eval.mjs misses exported-reels.csv
//     Classifies an exported reels CSV and reports the vocabulary the lexicon
//     is MISSING: the most common words and hashtags among reels that came
//     back neutral, plus sample captions. This is the direct path to driving
//     the neutral rate down — it says exactly what to add to the lexicon.
//
// The classifier is imported straight from source via a tiny esbuild step, so
// there is nothing to keep in sync — it evaluates exactly what ships.

import {
  csvCell,
  inputOf,
  loadClassifier,
  loadTuning,
  readRecords,
} from './lib/sheet.mjs';

const [, , mode, file] = process.argv;

if (!mode || !file || !['template', 'eval', 'misses'].includes(mode)) {
  console.error('usage: node scripts/eval.mjs <template|eval|misses> <file.csv>');
  process.exit(1);
}

/** Classifier output, folding null (no text) to the explicit 'unclassified'. */
function predict(classify, rec) {
  const result = classify(inputOf(rec));
  return result ? result.category : 'unclassified';
}

// --- template mode -------------------------------------------------------

async function template() {
  const { classify } = await loadClassifier();
  const records = readRecords(file);
  const header = ['humanLabel', 'guess', 'captionText', 'hashtags', 'audioName'];
  const lines = [header.join(',')];

  for (const rec of records) {
    const guess = predict(classify, rec);
    lines.push(
      [
        // Pre-fill humanLabel with the guess; you only edit the wrong ones.
        guess,
        guess,
        csvCell(rec.captionText),
        csvCell(rec.hashtags),
        csvCell(rec.audioName),
      ].join(','),
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
  console.error(`\n${records.length} rows. Fix the humanLabel column, then: node scripts/eval.mjs eval <file>`);
}

// --- eval mode -----------------------------------------------------------

function pct(n, d) {
  return d === 0 ? '  -  ' : `${((n / d) * 100).toFixed(0).padStart(3)}%`;
}

async function evaluate() {
  const { classify } = await loadClassifier();
  const records = readRecords(file);

  const labeled = records.filter((r) => r.humanLabel && r.humanLabel.trim());
  if (!labeled.length) {
    console.error('No rows with a humanLabel. Fill that column first.');
    process.exit(1);
  }

  const labels = new Set();
  let correct = 0;
  const tp = {};
  const fp = {};
  const fn = {};
  const confusion = {};

  for (const rec of labeled) {
    const truth = rec.humanLabel.trim();
    const pred = predict(classify, rec);
    labels.add(truth);
    labels.add(pred);

    (confusion[truth] ??= {})[pred] = (confusion[truth]?.[pred] ?? 0) + 1;

    if (truth === pred) {
      correct++;
      tp[truth] = (tp[truth] ?? 0) + 1;
    } else {
      fp[pred] = (fp[pred] ?? 0) + 1;
      fn[truth] = (fn[truth] ?? 0) + 1;
    }
  }

  const sorted = [...labels].sort();
  const n = labeled.length;

  console.log(`\n  ${n} labeled reels — overall accuracy ${pct(correct, n)} (${correct}/${n})\n`);

  // Neutral + unclassified shares, the headline numbers for this work.
  const predCounts = {};
  for (const rec of labeled) predCounts[predict(classify, rec)] = (predCounts[predict(classify, rec)] ?? 0) + 1;
  const neutral = predCounts.neutral ?? 0;
  const noText = predCounts.unclassified ?? 0;
  console.log(`  predicted neutral (text, no match): ${pct(neutral, n)}  (${neutral})`);
  console.log(`  predicted no-text:                  ${pct(noText, n)}  (${noText})`);
  const readable = n - noText;
  console.log(`  neutral among readable:             ${pct(neutral, readable)}  (target <= ~15%)\n`);

  console.log('  per category      prec    recall   support');
  for (const c of sorted) {
    const t = tp[c] ?? 0;
    const support = Object.values(confusion[c] ?? {}).reduce((a, b) => a + b, 0);
    console.log(
      `  ${c.padEnd(16)} ${pct(t, t + (fp[c] ?? 0))}   ${pct(t, t + (fn[c] ?? 0))}    ${String(support).padStart(4)}`,
    );
  }

  console.log('\n  confusion (rows = truth, cols = predicted):\n');
  const head = sorted.map((c) => c.slice(0, 6).padStart(7)).join('');
  console.log(''.padEnd(16) + head);
  for (const truth of sorted) {
    const cells = sorted
      .map((pred) => {
        const v = confusion[truth]?.[pred] ?? 0;
        return (v === 0 ? '.' : String(v)).padStart(7);
      })
      .join('');
    console.log(truth.padEnd(16) + cells);
  }
  console.log('');
}

// --- misses mode ---------------------------------------------------------

async function misses() {
  const { classify } = await loadClassifier();
  const { buildTuningReport } = await loadTuning();
  const records = readRecords(file);

  // Reuse the in-extension tuning logic: build event-shaped objects carrying
  // the classifier's current verdict, then let buildTuningReport surface the
  // missing vocabulary among the neutral ones.
  const events = records.map((rec) => {
    const input = inputOf(rec);
    const result = classify(input);
    return { ...input, category: result ? result.category : null };
  });

  const report = buildTuningReport(events, 40);
  const readable = report.totalReels - report.textlessReels;

  console.log(`\n  ${report.totalReels} reels — ${report.classifiedReels} classified, ` +
    `${report.neutralReels} neutral, ${report.textlessReels} no-text`);
  console.log(`  neutral among readable: ${pct(report.neutralReels, readable)} ` +
    `(the number to drive down)\n`);

  const col = (rows) =>
    rows.length ? rows.map((t) => `    ${t.term.padEnd(22)} ${t.count}`).join('\n') : '    (none)';

  console.log('  MISSING HASHTAGS (most common on neutral reels):');
  console.log(col(report.topHashtags));
  console.log('\n  MISSING WORDS (most common on neutral reels):');
  console.log(col(report.topWords));

  console.log('\n  SAMPLE NEUTRAL CAPTIONS:');
  for (const c of report.sampleCaptions) console.log(`    · ${c}`);
  console.log('\n  Paste this whole block back and I will turn it into lexicon entries.\n');
}

await (mode === 'template' ? template() : mode === 'misses' ? misses() : evaluate());
