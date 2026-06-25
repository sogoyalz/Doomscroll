// IntersectionObserver-based dwell tracking: decides *when* a video has been
// watched long enough to count, independent of what it's about or what to do
// with that fact (see domScraper.js / content.js).

export const VISIBILITY_THRESHOLD = 0.65;
export const MIN_WATCH_MS = 1000;
const CLAMP_MAX_MS = 10 * 60 * 1000; // guard against tab-stuck-visible durations

export function createReelDetector(onWatched) {
  const videoState = new WeakMap();
  const now = () => Date.now();

  function handleEntry(entry) {
    const video = entry.target;
    if (!video) return;
    let state = videoState.get(video);
    if (!state) {
      state = { watching: false, start: null, recorded: false };
      videoState.set(video, state);
    }
    const isVisible = entry.isIntersecting && entry.intersectionRatio >= VISIBILITY_THRESHOLD;

    if (isVisible && !state.watching) {
      state.watching = true;
      state.start = now();
    } else if (!isVisible && state.watching) {
      const watchedMs = now() - (state.start || now());
      state.watching = false;
      state.start = null;

      if (watchedMs >= MIN_WATCH_MS && !state.recorded) {
        state.recorded = true;
        const safeWatched = Math.max(0, Math.min(watchedMs, CLAMP_MAX_MS));
        onWatched(video, safeWatched);
      }
    }
    videoState.set(video, state);
  }

  const observer = new IntersectionObserver((entries) => entries.forEach(handleEntry), {
    threshold: [VISIBILITY_THRESHOLD],
  });

  function observeVideo(video) {
    try {
      if (!videoState.has(video)) {
        videoState.set(video, { watching: false, start: null, recorded: false });
        observer.observe(video);
      }
    } catch {
      // ignore
    }
  }

  function scanAndObserve(root = document) {
    root.querySelectorAll('video').forEach(observeVideo);
  }

  function disconnect() {
    observer.disconnect();
  }

  return { scanAndObserve, disconnect, _videoState: videoState };
}
