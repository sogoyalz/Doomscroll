import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatMinutes,
  formatPace,
  formatPercent,
  formatRatio,
  reasonLabel,
} from '../src/shared/format.ts';

describe('formatDuration', () => {
  it('shows seconds under a minute', () => {
    expect(formatDuration(42_000)).toBe('42s');
  });

  it('shows whole minutes under an hour', () => {
    expect(formatDuration(5 * 60_000)).toBe('5m');
  });

  it('shows hours and minutes past an hour', () => {
    expect(formatDuration(83 * 60_000)).toBe('1h 23m');
  });

  it('omits a zero minute remainder', () => {
    expect(formatDuration(2 * 60 * 60_000)).toBe('2h');
  });

  it('renders zero as 0s rather than blank', () => {
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('formatMinutes', () => {
  it('accepts the fractional minutes aggregates store', () => {
    expect(formatMinutes(1.5)).toBe('1m');
    expect(formatMinutes(90)).toBe('1h 30m');
  });

  it('shows sub-minute totals in seconds', () => {
    expect(formatMinutes(0.5)).toBe('30s');
  });
});

describe('formatPace', () => {
  it('converts per-second to the readable per-minute figure', () => {
    // 0.2/sec is 12/min — the same number, in a unit people can picture.
    expect(formatPace(0.2)).toBe('12/min');
  });

  it('keeps a decimal for slow paces', () => {
    expect(formatPace(0.05)).toBe('3.0/min');
  });

  it('shows a dash rather than zero when nothing was watched', () => {
    expect(formatPace(0)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('rounds to whole percent', () => {
    expect(formatPercent(0.666)).toBe('67%');
  });

  it('handles zero', () => {
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('formatRatio', () => {
  it('shows one decimal place', () => {
    expect(formatRatio(2.35)).toBe('2.4×');
  });

  it('renders an absent baseline as infinity rather than NaN', () => {
    expect(formatRatio(Infinity)).toBe('∞');
  });
});

describe('reasonLabel', () => {
  it('describes the content pattern, never the viewer', () => {
    // "Normal for you" is a statement about the feed's mix, not a judgement.
    expect(reasonLabel('within-baseline')).toBe('Normal for you');
  });

  it('labels a fired detection', () => {
    expect(reasonLabel(null)).toBe('Flagged');
  });

  it('passes through an unrecognised reason instead of hiding it', () => {
    expect(reasonLabel('something-new')).toBe('something-new');
  });
});
