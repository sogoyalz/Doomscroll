import { describe, it, expect } from 'vitest';
import {
  BREAK_GRACE_MS,
  BREAK_MINUTES,
  breakRemainingMs,
  isBreakActive,
  isBreakState,
  isReelsSurface,
  newBreak,
  shouldRemind,
} from '../src/shared/break.ts';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

describe('newBreak', () => {
  it('runs for the configured window', () => {
    const state = newBreak('i1', NOW);
    expect(state.endsAt - state.startedAt).toBe(BREAK_MINUTES * MINUTE);
  });

  it('remembers which interruption offered it', () => {
    // So returning early is attributed to the record that made the offer,
    // rather than to the run in general.
    expect(newBreak('i1', NOW).interventionId).toBe('i1');
  });
});

describe('isBreakActive', () => {
  it('is active inside the window', () => {
    expect(isBreakActive(newBreak('i1', NOW), NOW + 5 * MINUTE)).toBe(true);
  });

  it('lapses at the end of it', () => {
    const state = newBreak('i1', NOW);
    expect(isBreakActive(state, state.endsAt)).toBe(false);
    expect(isBreakActive(state, state.endsAt + 1)).toBe(false);
  });

  it('treats no break as no break', () => {
    expect(isBreakActive(null, NOW)).toBe(false);
  });
});

describe('breakRemainingMs', () => {
  it('counts down', () => {
    expect(breakRemainingMs(newBreak('i1', NOW), NOW + 5 * MINUTE)).toBe(
      (BREAK_MINUTES - 5) * MINUTE,
    );
  });

  it('floors at zero rather than going negative', () => {
    // It is rendered as "about N minutes left"; a negative would read as a
    // break running backwards.
    expect(breakRemainingMs(newBreak('i1', NOW), NOW + 999 * MINUTE)).toBe(0);
  });
});

describe('isBreakState', () => {
  it('accepts a real one', () => {
    expect(isBreakState(newBreak('i1', NOW))).toBe(true);
  });

  it('rejects anything else that might come back out of storage', () => {
    for (const value of [null, undefined, 'break', 42, {}, { startedAt: NOW }]) {
      expect(isBreakState(value)).toBe(false);
    }
  });
});

describe('isReelsSurface', () => {
  it('recognises the reels feed', () => {
    // The URL cannot say WHICH reel is on screen — that comes from React fiber
    // — but it is reliable for which surface the page is, which is all this
    // asks. See docs/dom-notes.md §6.
    expect(isReelsSurface('/reels')).toBe(true);
    expect(isReelsSurface('/reels/')).toBe(true);
    expect(isReelsSurface('/reels/DKx9abcdefg/')).toBe(true);
  });

  it('does not mistake the rest of Instagram for it', () => {
    // The break sends you to the home feed, which also shows reels inline. If
    // that counted, the reminder would fire the instant the break began.
    for (const path of ['/', '/explore/', '/someone/', '/someone/reels/']) {
      expect(isReelsSurface(path)).toBe(false);
    }
  });
});

describe('shouldRemind', () => {
  it('stays quiet while the page is still leaving the feed', () => {
    // Taking a break writes the state and then navigates, so for a beat the
    // tab is still on /reels with a live break. Without the grace period the
    // reminder flashes up on the page the user just chose to leave — the
    // extension arguing with a decision it asked for.
    const state = newBreak('i1', NOW);
    expect(isBreakActive(state, NOW + 100)).toBe(true);
    expect(shouldRemind(state, NOW + 100)).toBe(false);
  });

  it('reminds once the grace period has passed', () => {
    const state = newBreak('i1', NOW);
    expect(shouldRemind(state, NOW + BREAK_GRACE_MS)).toBe(true);
    expect(shouldRemind(state, NOW + 5 * MINUTE)).toBe(true);
  });

  it('stops reminding once the break has lapsed', () => {
    const state = newBreak('i1', NOW);
    expect(shouldRemind(state, state.endsAt + 1)).toBe(false);
  });

  it('has nothing to remind about with no break', () => {
    expect(shouldRemind(null, NOW)).toBe(false);
  });

  it('keeps the grace period well inside the break', () => {
    // A grace period near the break length would silence the reminder for
    // most of the window it exists to police.
    expect(BREAK_GRACE_MS).toBeLessThan((BREAK_MINUTES * MINUTE) / 10);
  });
});
