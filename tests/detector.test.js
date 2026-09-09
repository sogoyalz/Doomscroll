import { describe, it, expect } from 'vitest';
import { createDwellTracker, MIN_DWELL_MS, MAX_DWELL_MS } from '../src/content/detector.ts';

// The tracker takes an explicit clock, so these drive time directly rather
// than using fake timers.
function setup(options) {
  const completed = [];
  const tracker = createDwellTracker((view) => completed.push(view), options);
  return { tracker, completed };
}

describe('createDwellTracker', () => {
  it('records a view when the active reel changes', () => {
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.setActive('b', 3000);

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      target: 'a',
      startedAt: 0,
      endedAt: 3000,
      watchDurationMs: 3000,
    });
  });

  it('does not re-record when setActive repeats the current reel', () => {
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.setActive('a', 1000);
    tracker.setActive('a', 2000);
    expect(completed).toHaveLength(0);
    expect(tracker.currentTarget()).toBe('a');
  });

  it('drops flicker below the minimum dwell', () => {
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.setActive('b', MIN_DWELL_MS - 1);
    expect(completed).toHaveLength(0);
  });

  it('keeps a fast scroll that clears the minimum dwell', () => {
    // Rapid scrolling is real signal for this extension, not noise to filter.
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.setActive('b', MIN_DWELL_MS);
    expect(completed).toHaveLength(1);
    expect(completed[0].watchDurationMs).toBe(MIN_DWELL_MS);
  });

  it('clamps an implausibly long view rather than dropping it', () => {
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.setActive('b', MAX_DWELL_MS + 60_000);
    expect(completed[0].watchDurationMs).toBe(MAX_DWELL_MS);
  });

  it('excludes time spent with the tab hidden', () => {
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.pause(1000); // 1s watched
    tracker.resume(9000); // 8s hidden, not counted
    tracker.setActive('b', 11_000); // 2s more watched

    expect(completed[0].watchDurationMs).toBe(3000);
    // Wall-clock span is still the full window.
    expect(completed[0].endedAt - completed[0].startedAt).toBe(11_000);
  });

  it('accrues no time for a reel that becomes active while hidden', () => {
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.pause(0);
    tracker.setActive('b', 1000); // 'a' watched 0ms, dropped
    tracker.setActive('c', 9000); // 'b' was active only while hidden

    expect(completed).toHaveLength(0);
  });

  it('counts time again once the tab is visible', () => {
    const { tracker, completed } = setup();
    tracker.pause(0);
    tracker.setActive('a', 100);
    tracker.resume(5000);
    tracker.setActive('b', 7000);

    expect(completed).toHaveLength(1);
    expect(completed[0].watchDurationMs).toBe(2000);
  });

  it('ignores repeated pause and resume calls', () => {
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.pause(1000);
    tracker.pause(2000);
    tracker.resume(3000);
    tracker.resume(4000);
    tracker.setActive('b', 5000);

    // 1s before the pause, 2s after the resume.
    expect(completed[0].watchDurationMs).toBe(3000);
  });

  it('finalizes the in-flight view on flush', () => {
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.flush(2000);

    expect(completed).toHaveLength(1);
    expect(completed[0].watchDurationMs).toBe(2000);
    expect(tracker.currentTarget()).toBeNull();
  });

  it('is a no-op when flushed with nothing active', () => {
    const { tracker, completed } = setup();
    tracker.flush(1000);
    expect(completed).toHaveLength(0);
  });

  it('drops the in-flight view on discard without recording it', () => {
    // Pausing should stop recording at the moment the user asked, not bank
    // the partial reel they happened to be on.
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.discard();

    expect(completed).toHaveLength(0);
    expect(tracker.currentTarget()).toBeNull();
  });

  it('keeps working after a discard', () => {
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.discard();
    tracker.setActive('b', 1000);
    tracker.flush(3000);

    expect(completed).toHaveLength(1);
    expect(completed[0].target).toBe('b');
    expect(completed[0].watchDurationMs).toBe(2000);
  });

  it('finalizes the current view when the active reel becomes null', () => {
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.setActive(null, 2000);

    expect(completed).toHaveLength(1);
    expect(tracker.currentTarget()).toBeNull();
  });

  it('honours overridden dwell bounds', () => {
    const { tracker, completed } = setup({ minDwellMs: 5000 });
    tracker.setActive('a', 0);
    tracker.setActive('b', 4999);
    expect(completed).toHaveLength(0);
  });
});

describe('long absences do not stretch a view across the gap', () => {
  it('closes the view at the moment the tab was hidden', () => {
    // Regression: leaving Instagram open in a background tab kept the reel
    // active, so on return the view spanned the whole absence. Watch time was
    // right, but binge length is measured from startedAt/endedAt — one
    // overnight view reported a 10-hour "longest binge".
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.pause(30_000);
    tracker.resume(10 * 60 * 60_000); // back 10 hours later

    expect(completed).toHaveLength(1);
    expect(completed[0].watchDurationMs).toBe(30_000);
    // The wall-clock span must match the time actually spent, not the absence.
    expect(completed[0].endedAt - completed[0].startedAt).toBe(30_000);
  });

  it('keeps one view across a brief tab switch', () => {
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.pause(5_000);
    tracker.resume(20_000); // back after 15s — still the same sitting
    tracker.setActive('b', 30_000);

    expect(completed).toHaveLength(1);
    expect(completed[0].watchDurationMs).toBe(15_000);
  });

  it('honours a custom hidden threshold', () => {
    const { tracker, completed } = setup({ maxHiddenMs: 1_000 });
    tracker.setActive('a', 0);
    tracker.pause(2_000);
    tracker.resume(5_000); // 3s away, over the 1s threshold

    expect(completed).toHaveLength(1);
    expect(completed[0].endedAt).toBe(2_000);
  });

  it('starts a fresh view after a long absence closes the old one', () => {
    const { tracker, completed } = setup();
    tracker.setActive('a', 0);
    tracker.pause(30_000);
    tracker.resume(10 * 60 * 60_000);
    expect(tracker.currentTarget()).toBeNull();

    // The next scroll begins a genuinely new view.
    const back = 10 * 60 * 60_000;
    tracker.setActive('b', back);
    tracker.flush(back + 5_000);
    expect(completed).toHaveLength(2);
    expect(completed[1].watchDurationMs).toBe(5_000);
  });
});
