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
  // When the currently-watched video paused (else null). Paused time is
  // excluded from watch duration — a reel sitting paused on screen isn't
  // "watched". Mirrors the tab-hidden accounting in onHide/onShow.
  pausedAt: number | null;
  // The reel's media src, used to detect Instagram reusing a <video> element
  // for a different reel so the new reel can be tracked independently.
  src: string;
}

export type OnWatched = (video: HTMLVideoElement, watchedMs: number) => void;
export type OnVisible = (video: HTMLVideoElement) => void;

function srcOf(video: HTMLVideoElement): string {
  return video.currentSrc || video.src || '';
}

export function createReelDetector(onWatched: OnWatched, onVisible?: OnVisible) {
  const videoState = new WeakMap<HTMLVideoElement, VideoState>();
  // Tracks videos currently being timed so we can pause/resume on tab hide/show.
  const watchingSet = new Set<HTMLVideoElement>();
  let hiddenAt: number | null = null;
  const now = () => Date.now();

  function freshState(video: HTMLVideoElement): VideoState {
    return { watching: false, start: null, recorded: false, pausedAt: null, src: srcOf(video) };
  }

  function handleEntry(entry: IntersectionObserverEntry) {
    const video = entry.target as HTMLVideoElement;
    if (!video) return;
    let state = videoState.get(video);
    if (!state) {
      state = freshState(video);
      videoState.set(video, state);
    }
    const isVisible = entry.isIntersecting && entry.intersectionRatio >= VISIBILITY_THRESHOLD;

    if (isVisible && !state.watching) {
      state.watching = true;
      state.start = now();
      // If the video is already paused when it scrolls into view, don't count
      // the idle time until it actually starts playing.
      state.pausedAt = video.paused === true ? now() : null;
      watchingSet.add(video);
      if (onVisible) onVisible(video);
    } else if (!isVisible && state.watching) {
      // If the reel is still paused at exit, stop the clock at the pause point
      // rather than at exit so the paused tail isn't counted.
      const end = state.pausedAt !== null ? state.pausedAt : now();
      const watchedMs = end - (state.start ?? now());
      state.watching = false;
      state.start = null;
      state.pausedAt = null;
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

  function handlePause(video: HTMLVideoElement) {
    const st = videoState.get(video);
    if (st?.watching && st.pausedAt === null) st.pausedAt = now();
  }

  function handlePlay(video: HTMLVideoElement) {
    const st = videoState.get(video);
    if (st?.watching && st.pausedAt !== null) {
      // Shift start forward by the paused duration so it isn't counted.
      st.start = (st.start ?? now()) + (now() - st.pausedAt);
      st.pausedAt = null;
    }
  }

  function observeVideo(video: HTMLVideoElement) {
    try {
      const existing = videoState.get(video);
      if (existing) {
        // Instagram reuses video elements for different reels. If the src
        // changed and we're not mid-count, reset so the new reel can be
        // tracked (and counted) independently of the old one.
        const src = srcOf(video);
        if (src && existing.src && src !== existing.src && !existing.watching) {
          watchingSet.delete(video);
          videoState.set(video, freshState(video));
        }
        return;
      }
      videoState.set(video, freshState(video));
      observer.observe(video);
      if (typeof video.addEventListener === 'function') {
        // loadstart fires when a new reel loads into a reused element — reset
        // state (covers src changes that happen between scans).
        video.addEventListener('loadstart', () => {
          watchingSet.delete(video);
          videoState.set(video, freshState(video));
        });
        video.addEventListener('pause', () => handlePause(video));
        video.addEventListener('play', () => handlePlay(video));
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
