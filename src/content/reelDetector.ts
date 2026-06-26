// IntersectionObserver-based dwell tracking: decides *when* a video has been
// watched long enough to count, independent of what it's about or what to do
// with that fact (see domScraper.js / content.js).

export const VISIBILITY_THRESHOLD = 0.65;
export const MIN_WATCH_MS = 1000;
const CLAMP_MAX_MS = 10 * 60 * 1000; // guard against tab-stuck-visible durations

interface VideoState {
  watching: boolean;
  start: number | null;
  recorded: boolean;
}

export type OnWatched = (video: HTMLVideoElement, watchedMs: number) => void;
export type OnVisible = (video: HTMLVideoElement) => void;

export function createReelDetector(onWatched: OnWatched, onVisible?: OnVisible) {
  const videoState = new WeakMap<HTMLVideoElement, VideoState>();
  // Tracks videos currently being timed so we can pause/resume on tab hide/show.
  const watchingSet = new Set<HTMLVideoElement>();
  let hiddenAt: number | null = null;
  const now = () => Date.now();

  function handleEntry(entry: IntersectionObserverEntry) {
    const video = entry.target as HTMLVideoElement;
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
      watchingSet.add(video);
      if (onVisible) onVisible(video);
    } else if (!isVisible && state.watching) {
      const watchedMs = now() - (state.start ?? now());
      state.watching = false;
      state.start = null;
      watchingSet.delete(video);

      // Only count when the user scrolled forward (down): the video exited
      // above the viewport (top < 0). If top > 0 the user scrolled back up.
      // Guard: boundingClientRect is always present in real browsers but may
      // be absent in test stubs — default to counting when unknown.
      const rect = entry.boundingClientRect;
      const scrolledForward = !rect || rect.top < 0;

      if (watchedMs >= MIN_WATCH_MS && !state.recorded && scrolledForward) {
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

  function observeVideo(video: HTMLVideoElement) {
    try {
      if (!videoState.has(video)) {
        videoState.set(video, { watching: false, start: null, recorded: false });
        observer.observe(video);
        // Instagram reuses video elements for different reels. When the src
        // changes, reset state so the new reel can be tracked independently.
        video.addEventListener('loadstart', () => {
          watchingSet.delete(video);
          videoState.set(video, { watching: false, start: null, recorded: false });
        });
      }
    } catch {
      // ignore
    }
  }

  function scanAndObserve(root: ParentNode = document) {
    root.querySelectorAll('video').forEach(observeVideo);
  }

  // Call when the tab becomes hidden. Stores the hide time so onShow() can
  // subtract it from each active timer, excluding hidden time from watch totals.
  function onHide() {
    hiddenAt = now();
  }

  // Call when the tab becomes visible again. Shifts every active start time
  // forward by the time spent hidden so that gap is not counted as watch time.
  function onShow() {
    if (hiddenAt === null) return;
    const hiddenMs = now() - hiddenAt;
    hiddenAt = null;
    for (const video of watchingSet) {
      const state = videoState.get(video);
      if (state?.start !== null && state?.start !== undefined) {
        state.start += hiddenMs;
        videoState.set(video, state);
      }
    }
  }

  function disconnect() {
    observer.disconnect();
    watchingSet.clear();
  }

  return { scanAndObserve, disconnect, onHide, onShow, _videoState: videoState };
}
