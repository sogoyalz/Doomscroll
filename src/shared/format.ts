// Display formatting shared by the popup and options page.

import type { NotDetectedReason } from './patterns.js';

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function formatMinutes(minutes: number): string {
  return formatDuration(minutes * 60_000);
}

/**
 * Scroll pace, shown per minute.
 *
 * Stored per second because that is the natural unit for the ratio, but a
 * value like 0.18 reels/sec is unreadable — per minute lands in the range
 * people can picture.
 */
export function formatPace(reelsPerSec: number): string {
  if (!reelsPerSec) return '—';
  const perMinute = reelsPerSec * 60;
  return `${perMinute < 10 ? perMinute.toFixed(1) : Math.round(perMinute)}/min`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Ratios can be Infinity when a category is absent from the baseline. */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return '∞';
  return `${ratio.toFixed(1)}×`;
}

export function formatTimestamp(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Human wording for why a detection did not fire. */
export const REASON_LABELS: Record<NotDetectedReason, string> = {
  'insufficient-history': 'Not enough history yet',
  'insufficient-window-sample': 'Too few readable reels',
  'insufficient-baseline-sample': 'Baseline too thin',
  'insufficient-charged-sample': 'Too few emotional reels to judge',
  'not-dominant': 'No single category dominated',
  'within-baseline': 'Normal for you',
  'category-not-watched': 'Category not being watched',
};

/**
 * Takes a `string` because it reads stored log rows, which may carry a reason
 * from an older build. The table itself is typed exhaustively, so a reason in
 * use today cannot be missing — only a retired one falls through to its raw
 * form, which is the honest way to render something no longer explained.
 */
export function reasonLabel(reason: string | null): string {
  if (!reason) return 'Flagged';
  return (REASON_LABELS as Record<string, string>)[reason] ?? reason;
}
