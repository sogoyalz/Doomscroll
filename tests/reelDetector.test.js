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

  // A fake <video> that supports play/pause events and a mutable currentSrc,
  // for exercising the scanAndObserve path (which attaches the listeners).
  function makeVideo(src = '') {
    const listeners = {};
    return {
      currentSrc: src,
      src: '',
      paused: false,
      addEventListener(type, cb) {
        (listeners[type] = listeners[type] || []).push(cb);
      },
      _fire(type) {
        (listeners[type] || []).forEach((cb) => cb());
      },
    };
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

  test('onHide/onShow excludes tab-hidden time from watch duration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const onWatched = vi.fn();
    const detector = createReelDetector(onWatched, vi.fn());

    const video = {};
    fireEntry(video, true, 0.9);         // starts watching at t=10000

    vi.setSystemTime(11_000);
    detector.onHide();                    // tab hidden at t=11000 (1s of real watch)

    vi.setSystemTime(13_000);
    detector.onShow();                    // tab visible again at t=13000 (2s hidden)

    vi.setSystemTime(14_500);
    fireEntry(video, false, 0);           // scrolled past at t=14500

    // Should count 1s (before hide) + 1.5s (after show) = 2500ms, not 4500ms
    expect(onWatched).toHaveBeenCalledWith(video, 2500);
    vi.useRealTimers();
  });

  test('excludes paused time from watch duration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const onWatched = vi.fn();
    const detector = createReelDetector(onWatched, vi.fn());

    const video = makeVideo('blob:reel-1');
    detector.scanAndObserve({ querySelectorAll: () => [video] }); // attaches play/pause listeners

    fireEntry(video, true, 0.9); // start watching at t=10000

    vi.setSystemTime(11_000);
    video.paused = true;
    video._fire('pause'); // paused at t=11000 (1s watched so far)

    vi.setSystemTime(14_000);
    video.paused = false;
    video._fire('play'); // resumed at t=14000 (3s paused, excluded)

    vi.setSystemTime(15_000);
    fireEntry(video, false, 0); // scrolled past at t=15000 (1s more watched)

    // 1s before pause + 1s after resume = 2000ms; the 3s paused is excluded.
    expect(onWatched).toHaveBeenCalledWith(video, 2000);
    vi.useRealTimers();
  });

  test('does not double-subtract when tab-hide overlaps the auto-pause', () => {
    // Regression: tabbing away fires BOTH onHide and the video's `pause` event
    // for the same interval. The hidden span must be excluded once, not twice.
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const onWatched = vi.fn();
    const detector = createReelDetector(onWatched, vi.fn());

    const video = makeVideo('blob:reel-1');
    detector.scanAndObserve({ querySelectorAll: () => [video] });

    fireEntry(video, true, 0.9); // start watching at t=10000

    vi.setSystemTime(11_000);
    detector.onHide(); // tab hidden at t=11000 (1s real watch)
    video.paused = true;
    video._fire('pause'); // IG auto-pauses just after hiding

    vi.setSystemTime(13_000);
    video.paused = false;
    video._fire('play'); // IG auto-resumes on return
    detector.onShow(); // tab visible again at t=13000 (2s hidden total)

    vi.setSystemTime(14_500);
    fireEntry(video, false, 0); // scrolled past at t=14500

    // 1s before hide + 1.5s after show = 2500ms; the 2s hidden span is excluded
    // exactly once (not 4500ms counted, nor 500ms from a double subtraction).
    expect(onWatched).toHaveBeenCalledWith(video, 2500);
    vi.useRealTimers();
  });

  test('keeps a reel paused before tab-hide excluded after returning still-paused', () => {
    // A reel the user paused, then tabbed away from, then returned to without
    // resuming: the whole idle span (pause through exit) must stay excluded.
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const onWatched = vi.fn();
    const detector = createReelDetector(onWatched, vi.fn());

    const video = makeVideo('blob:reel-1');
    detector.scanAndObserve({ querySelectorAll: () => [video] });

    fireEntry(video, true, 0.9); // start watching at t=10000

    vi.setSystemTime(11_000);
    video.paused = true;
    video._fire('pause'); // user pauses at t=11000 (1s watched)

    vi.setSystemTime(12_000);
    detector.onHide(); // tab hidden while already paused
    vi.setSystemTime(15_000);
    detector.onShow(); // back, but the reel is still paused (no play event)

    vi.setSystemTime(16_000);
    fireEntry(video, false, 0); // scrolled past, still paused

    // Only the 1s before the pause counts; everything after stays excluded.
    expect(onWatched).toHaveBeenCalledWith(video, 1000);
    vi.useRealTimers();
  });

  test('counts again after the element is reused for a new reel (src change)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const onWatched = vi.fn();
    const detector = createReelDetector(onWatched, vi.fn());

    const video = makeVideo('blob:reel-1');
    const root = { querySelectorAll: () => [video] };
    detector.scanAndObserve(root);

    fireEntry(video, true, 0.9); // reel-1 visible
    vi.setSystemTime(2000);
    fireEntry(video, false, 0); // reel-1 counted
    expect(onWatched).toHaveBeenCalledTimes(1);

    // Instagram reuses the element for a different reel.
    video.currentSrc = 'blob:reel-2';
    detector.scanAndObserve(root); // detects the src change, resets recorded

    vi.setSystemTime(3000);
    fireEntry(video, true, 0.9); // reel-2 visible
    vi.setSystemTime(5000);
    fireEntry(video, false, 0); // reel-2 counted (would be skipped without the reset)
    expect(onWatched).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
