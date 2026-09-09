// CSV serialization for data export.
//
// Caption text is scraped from instagram.com, so every cell is
// attacker-controlled. Beyond quote escaping this must defend against CSV
// formula injection: a cell starting with = + - @ (or a leading tab/CR) is
// evaluated as a live formula by Excel, Sheets, and Numbers, so a caption
// reading `=HYPERLINK("http://evil","click")` would execute on open.
// Prefixing a single quote makes spreadsheets treat it as literal text.

import type { DetectionLogEntry, InterventionLogEntry, ReelEvent } from './types.js';

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function escapeCSV(value: unknown): string {
  let s = (value ?? '').toString();
  if (FORMULA_TRIGGER.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCSV(header: string[], rows: unknown[][]): string {
  const lines = rows.map((row) => row.map(escapeCSV).join(','));
  return [header.join(','), ...lines].join('\n');
}

/** Largest millisecond value the Date type can represent. */
const MAX_TIMESTAMP = 8.64e15;

/**
 * ISO timestamp, or empty for a value Date cannot represent.
 *
 * `new Date(NaN).toISOString()` throws, and export is the one path that must
 * not fail: it is how the user gets their data out. Without this a single
 * corrupted row would take the entire export down and return nothing at all,
 * which is far worse than one row with a blank timestamp.
 */
function isoOrEmpty(ms: number): string {
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_TIMESTAMP ? new Date(ms).toISOString() : '';
}

const REEL_EVENT_HEADER = [
  'id',
  'reelShortcode',
  'sessionId',
  'startedAt',
  'endedAt',
  'watchDurationMs',
  'captionText',
  'hashtags',
  'audioName',
  'authorHandle',
  'category',
  'categoryConfidence',
  'subtags',
];

/**
 * Reel history as CSV.
 *
 * Timestamps are emitted as ISO strings alongside nothing else — epoch ms in
 * a spreadsheet is unreadable, and the raw value is recoverable from the ISO
 * form if anyone needs it.
 */
export function reelEventsToCSV(events: ReelEvent[]): string {
  const rows = events.map((e) => [
    e.id,
    e.reelShortcode,
    e.sessionId,
    isoOrEmpty(e.startedAt),
    isoOrEmpty(e.endedAt),
    e.watchDurationMs,
    e.captionText ?? '',
    e.hashtags.join(' '),
    e.audioName ?? '',
    // Null for events recorded before authorHandle was captured, which is not
    // the same as a reel with no author — see ReelEvent.authorHandle.
    e.authorHandle ?? '',
    e.category ?? '',
    e.categoryConfidence ?? '',
    e.subtags.join(' '),
  ]);
  return toCSV(REEL_EVENT_HEADER, rows);
}

const DETECTION_LOG_HEADER = [
  'at',
  'lastAt',
  'occurrences',
  'sessionId',
  'detected',
  'trigger',
  'wouldHaveActed',
  'category',
  'share',
  'baselineShare',
  'ratio',
  'streak',
  'windowSample',
  'chargedSample',
  'baselineSample',
  'reason',
  'baselineShareLong',
  // Context, not inputs to the decision — carried so the question "should pace
  // or time of day trigger anything?" can be answered from a review rather
  // than from intuition.
  'pacePerSec',
  'hourOfDay',
];

/**
 * The detection log as CSV — the artifact for reviewing a week of log-only
 * output before letting anything act on it.
 *
 * Near-misses matter as much as hits, so `reason` is carried through: a week
 * of 'within-baseline' rows means the multiplier is too high, and a week of
 * 'insufficient-window-sample' means too little of the feed is readable for
 * the configured window size.
 */
export function detectionLogToCSV(entries: DetectionLogEntry[]): string {
  const rows = entries.map((e) => [
    isoOrEmpty(e.at),
    isoOrEmpty(e.lastAt ?? e.at),
    e.occurrences ?? 1,
    e.sessionId,
    e.detected,
    e.trigger ?? '',
    e.wouldHaveActed,
    e.category ?? '',
    e.share.toFixed(3),
    e.baselineShare.toFixed(3),
    Number.isFinite(e.ratio) ? e.ratio.toFixed(2) : 'inf',
    e.streak,
    e.windowSample,
    e.chargedSample ?? '',
    e.baselineSample,
    e.reason ?? '',
    e.baselineShareLong === undefined ? '' : e.baselineShareLong.toFixed(3),
    // Rows written before these were logged carry neither; an empty cell says
    // "not recorded", where 0 would read as "measured, and it was zero".
    e.pacePerSec === undefined ? '' : e.pacePerSec.toFixed(3),
    e.hourOfDay ?? '',
  ]);
  return toCSV(DETECTION_LOG_HEADER, rows);
}

const INTERVENTION_HEADER = [
  'at',
  'sessionId',
  'level',
  'category',
  'streak',
  'share',
  'ratio',
  'outcome',
  'respondedAt',
  'respondedAfterMs',
  'breakStartedAt',
  'breakEndedEarlyAt',
  'breakHeldMs',
];

/**
 * Interruptions and what the user did about them.
 *
 * `respondedAfterMs` is derived rather than stored: how long someone sat with
 * a prompt before answering is the part worth reading, and computing it here
 * keeps it consistent with whatever the two timestamps actually say.
 *
 * An outcome of `pending` is real data, not a missing value — it means the
 * prompt was decided on and never answered, which includes the case where it
 * was never delivered at all.
 */
export function interventionLogToCSV(entries: InterventionLogEntry[]): string {
  const rows = entries.map((e) => [
    isoOrEmpty(e.at),
    e.sessionId,
    e.level,
    e.category ?? '',
    e.streak,
    e.share.toFixed(3),
    Number.isFinite(e.ratio) ? e.ratio.toFixed(2) : 'inf',
    e.outcome,
    e.respondedAt === null ? '' : isoOrEmpty(e.respondedAt),
    e.respondedAt === null ? '' : e.respondedAt - e.at,
    e.breakStartedAt == null ? '' : isoOrEmpty(e.breakStartedAt),
    e.breakEndedEarlyAt == null ? '' : isoOrEmpty(e.breakEndedEarlyAt),
    // How long a break that was cut short actually lasted. Empty when no break
    // was taken, and empty when one was taken and never cut short — those are
    // different facts, and the two columns before this one separate them.
    e.breakStartedAt == null || e.breakEndedEarlyAt == null
      ? ''
      : e.breakEndedEarlyAt - e.breakStartedAt,
  ]);
  return toCSV(INTERVENTION_HEADER, rows);
}
