import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// createReelDetector constructs a real IntersectionObserver synchronously, so
// stub a minimal fake that captures the callback for the test to drive
// manually with fabricated entries.
class FakeIntersectionObserver {
  constructor(callback) {
    FakeIntersectionObserver.instances.push(this);
    this.callback = callback;
  }
  observe() {}
  disconnect() {}
}
FakeIntersectionObserver.instances = [];

describe('createReelDetector', () => {
  let createReelDetector;
  const originalIO = global.IntersectionObserver;

  beforeEach(async () => {
    FakeIntersectionObserver.instances = [];
    global.IntersectionObserver = FakeIntersectionObserver;
    vi.resetModules();
    ({ createReelDetector } = await import('../src/content/reelDetector.ts'));
  });

  afterEach(() => {
    global.IntersectionObserver = originalIO;
  });

  // boundingClientRect.top < 0 means video exited above viewport (scrolled forward/down).
  // Pass { top: 100 } to simulate scrolling back up.
  function fireEntry(video, isIntersecting, intersectionRatio, boundingClientRect = { top: -100 }) {
    const observer = FakeIntersectionObserver.instances[0];
    observer.callback([{ target: video, isIntersecting, intersectionRatio, boundingClientRect }]);
  }

  test('calls onVisible when a video becomes visible', () => {
    const onWatched = vi.fn();
    const onVisible = vi.fn();
    createReelDetector(onWatched, onVisible);

    const video = {};
    fireEntry(video, true, 0.9);

    expect(onVisible).toHaveBeenCalledWith(video);
    expect(onWatched).not.toHaveBeenCalled();
  });

  test('calls onWatched with elapsed watch time when visibility ends', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const onWatched = vi.fn();
    const onVisible = vi.fn();
    createReelDetector(onWatched, onVisible);

    const video = {};
    fireEntry(video, true, 0.9); // becomes visible at t=10000

    vi.setSystemTime(11_500);
    fireEntry(video, false, 0); // scrolls away at t=11500

    expect(onWatched).toHaveBeenCalledTimes(1);
    expect(onWatched).toHaveBeenCalledWith(video, 1500);

    vi.useRealTimers();
  });

  test('does not call onWatched if watched for less than MIN_WATCH_MS', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const onWatched = vi.fn();
    createReelDetector(onWatched, vi.fn());

    const video = {};
    fireEntry(video, true, 0.9);
    vi.setSystemTime(10_500); // under the 1000ms minimum
    fireEntry(video, false, 0);

    expect(onWatched).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test('only calls onVisible once per uninterrupted visible stretch', () => {
    const onVisible = vi.fn();
    createReelDetector(vi.fn(), onVisible);

    const video = {};
    fireEntry(video, true, 0.9);
    fireEntry(video, true, 0.95); // still visible, ratio change only

    expect(onVisible).toHaveBeenCalledTimes(1);
  });

  test('computes correct watch time even when start timestamp is exactly 0 (falsy)', () => {
    // Regression test: `state.start || now()` would treat a start time of
    // exactly 0 as falsy and discard it, producing watchedMs = 0.
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const onWatched = vi.fn();
    createReelDetector(onWatched, vi.fn());

    const video = {};
    fireEntry(video, true, 0.9); // becomes visible at t=0
    vi.setSystemTime(1500);
    fireEntry(video, false, 0);

    expect(onWatched).toHaveBeenCalledWith(video, 1500);
    vi.useRealTimers();
  });

  test('works without an onVisible callback provided', () => {
    expect(() => {
      createReelDetector(vi.fn());
      fireEntry({}, true, 0.9);
    }).not.toThrow();
  });

  test('does not call onWatched when user scrolls back up (video exits below viewport)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const onWatched = vi.fn();
    createReelDetector(onWatched, vi.fn());

    const video = {};
    fireEntry(video, true, 0.9);
    vi.setSystemTime(12_000);
    // top > 0: video exited below viewport — user scrolled back up
    fireEntry(video, false, 0, { top: 100 });

    expect(onWatched).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
