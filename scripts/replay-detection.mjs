// Replays pattern detection over exported history.
//
// eval.mjs is the gate for classifier changes; this is the equivalent for
// detector changes, and it exists for the same reason. A threshold edit is
// judged by what it does to real decisions across a real month, not by whether
// the reasoning sounded right — the detector has exactly one user's feed to
// learn from, and it is already on disk.
//
//   node scripts/replay-detection.mjs reels.csv
//     Replays every reel in order and reports what the CURRENT detector
//     decides: how often it fires, and the reason breakdown for when it does
//     not. The reason histogram is the useful half — a month of
//     'within-baseline' means the multiplier is too high, a month of
//     'insufficient-charged-sample' means the window is too small for how much
//     of this feed is readable.
//
//   node scripts/replay-detection.mjs reels.csv --against HEAD
//     Also replays the detector as it exists at that git ref and prints the
//     decisions that differ. Review the diff by hand before merging: a change
//     that flips decisions is not automatically wrong, but it must be a change
//     you meant.
//
// Read-only. Touches no extension storage.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadModule, readRecords } from './lib/sheet.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const against = args.map((a, i) => (a === '--against' ? args[i + 1] : null)).find(Boolean);

if (!file) {
  console.error('usage: node scripts/replay-detection.mjs <reels.csv> [--against <git-ref>]');
  process.exit(1);
}

const [{ aggregateDay, groupByLocalDay }, { localDateKey, startOfLocalDayBefore }, defaults] =
  await Promise.all([
    loadModule('src/shared/aggregation.ts'),
    loadModule('src/shared/time.ts'),
    loadModule('src/shared/defaults.ts'),
  ]);

const config = {
  windowSize: defaults.DEFAULT_SETTINGS.patternWindowSize,
  dominantThreshold: defaults.DEFAULT_SETTINGS.patternDominantThreshold,
  baselineMultiplier: defaults.DEFAULT_SETTINGS.patternBaselineMultiplier,
  watchedCategories: defaults.DEFAULT_SETTINGS.watchedCategories,
};

/**
 * Loads patterns.ts as it exists at a git ref.
 *
 * Written to a temp file and bundled from there rather than diffed in the
 * head, so the comparison is against code that actually existed rather than
 * against a description of it.
 */
async function patternsAt(ref) {
  const source = execFileSync('git', ['show', `${ref}:src/shared/patterns.ts`], {
    encoding: 'utf8',
  });
  const dir = mkdtempSync(join(tmpdir(), 'doomscroll-replay-'));
  // Its relative imports must resolve, so it is placed where it normally sits.
  const path = join(dir, 'patterns.ts');
  writeFileSync(path, source);
  for (const dep of ['aggregation', 'taxonomy', 'types', 'time', 'lexicon']) {
    try {
      writeFileSync(
        join(dir, `${dep}.ts`),
        execFileSync('git', ['show', `${ref}:src/shared/${dep}.ts`], { encoding: 'utf8' }),
      );
    } catch {
      // Not every ref has every module; the bundle will fail loudly if one
      // patterns.ts actually needs is missing.
    }
  }
  return loadModule(path);
}

function toEvent(rec) {
  const startedAt = Date.parse(rec.startedAt);
  return {
    id: rec.id,
    reelShortcode: rec.reelShortcode,
    sessionId: rec.sessionId,
    startedAt,
    endedAt: Date.parse(rec.endedAt),
    watchDurationMs: Number(rec.watchDurationMs) || 0,
    captionText: rec.captionText || null,
    hashtags: (rec.hashtags || '').split(/\s+/).filter(Boolean),
    audioName: rec.audioName || null,
    authorHandle: rec.authorHandle || null,
    category: rec.category || null,
    categoryConfidence: rec.categoryConfidence ? Number(rec.categoryConfidence) : null,
    subtags: (rec.subtags || '').split(/\s+/).filter(Boolean),
  };
}

const events = readRecords(file)
  .map(toEvent)
  .filter((e) => Number.isFinite(e.startedAt))
  .sort((a, b) => a.startedAt - b.startedAt);

if (!events.length) {
  console.error('No usable rows — expected an export with startedAt and category columns.');
  process.exit(1);
}

// Daily aggregates, built the same way the extension builds them so the replay
// is measuring the detector rather than a second implementation of the inputs.
const aggregatesByDate = new Map();
for (const [date, dayEvents] of groupByLocalDay(events)) {
  aggregatesByDate.set(date, aggregateDay(date, dayEvents));
}

/**
 * Every decision the detector makes over the history, in order.
 *
 * The window is the trailing `windowSize` reels newest-first, and the baseline
 * is the aggregates for the days before the one being judged — the same
 * construction runDetection uses, so a replayed decision matches what would
 * have been logged at the time.
 */
function replay(detectPattern, baselineWindowDays) {
  const decisions = [];

  for (let i = 0; i < events.length; i++) {
    const at = events[i].startedAt;
    const recent = events.slice(Math.max(0, i - config.windowSize + 1), i + 1).reverse();

    const fromKey = localDateKey(startOfLocalDayBefore(at, baselineWindowDays));
    const toKey = localDateKey(startOfLocalDayBefore(at, 1));
    const baselineDays = [...aggregatesByDate.entries()]
      .filter(([date]) => date >= fromKey && date <= toKey)
      .map(([, aggregate]) => aggregate);

    decisions.push(detectPattern(recent, baselineDays, config, at));
  }
  return decisions;
}

function summarize(decisions) {
  const reasons = {};
  let fired = 0;
  for (const d of decisions) {
    if (d.detected) fired++;
    const key = d.reason ?? 'DETECTED';
    reasons[key] = (reasons[key] ?? 0) + 1;
  }
  return { fired, reasons };
}

function report(label, decisions) {
  const { fired, reasons } = summarize(decisions);
  const n = decisions.length;
  console.log(`\n  ${label}`);
  console.log(`  ${fired} of ${n} checks fired (${((fired / n) * 100).toFixed(1)}%)\n`);
  for (const [reason, count] of Object.entries(reasons).sort(([, a], [, b]) => b - a)) {
    console.log(`    ${reason.padEnd(30)} ${String(count).padStart(5)}`);
  }
}

const current = await loadModule('src/shared/patterns.ts');
const currentDecisions = replay(current.detectPattern, current.BASELINE_WINDOW_DAYS);

const first = new Date(events[0].startedAt).toISOString().slice(0, 10);
const last = new Date(events[events.length - 1].startedAt).toISOString().slice(0, 10);
console.log(`\n  ${events.length} reels, ${aggregatesByDate.size} days (${first} .. ${last})`);

report('CURRENT', currentDecisions);

if (against) {
  const previous = await patternsAt(against);
  const previousDecisions = replay(previous.detectPattern, previous.BASELINE_WINDOW_DAYS);
  report(`AT ${against}`, previousDecisions);

  const changed = [];
  for (let i = 0; i < currentDecisions.length; i++) {
    const a = previousDecisions[i];
    const b = currentDecisions[i];
    if (a.detected !== b.detected || a.reason !== b.reason || a.category !== b.category) {
      changed.push({ at: events[i].startedAt, from: a, to: b });
    }
  }

  console.log(`\n  ${changed.length} decisions differ\n`);
  // Flips in whether anything fires are what a reviewer must look at; a
  // changed reason on a decision that still does not fire is noise by
  // comparison, so the firing changes are listed first and in full.
  const flips = changed.filter((c) => c.from.detected !== c.to.detected);
  console.log(`    ${flips.length} change whether detection fires at all`);
  for (const { at, from, to } of flips.slice(0, 25)) {
    const when = new Date(at).toISOString().replace('T', ' ').slice(0, 16);
    console.log(
      `      ${when}  ${from.detected ? 'FIRED' : from.reason} -> ${to.detected ? 'FIRED' : to.reason}` +
        `  (${to.category ?? '-'}, share ${to.share.toFixed(2)}, baseline ${to.baselineShare.toFixed(2)})`,
    );
  }
  if (flips.length > 25) console.log(`      ... and ${flips.length - 25} more`);
  console.log('');
}
