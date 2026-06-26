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
  // The clock is "stopped" while the reel is paused and/or the tab is hidden —
  // neither counts as watching. These two reasons can overlap (tabbing away
  // auto-pauses the video), so we track them independently and anchor a single
  // `stoppedAt` to when the clock *first* stopped. The excluded span is added
  // back exactly once, when the last reason clears (see stopClock/resumeClock),
  // so an overlapping pause+hide is never subtracted twice.
  paused: boolean;
  hidden: boolean;
  stoppedAt: number | null;
  // The reel's identity (shortcode if available, else media src), used to detect
  // Instagram reusing a <video> element for a different reel so the new reel can
  // be tracked independently.
  id: string;
}

export type OnWatched = (video: HTMLVideoElement, watchedMs: number) => void;
export type OnVisible = (video: HTMLVideoElement) => void;
export type IdOf = (video: HTMLVideoElement) => string;

function srcOf(video: HTMLVideoElement): string {
  return video.currentSrc || video.src || '';
}

// idOf computes a reel's identity for element-reuse detection. Defaults to the
// media src; content.ts injects a shortcode-preferring variant (see reelIdOf).
export function createReelDetector(onWatched: OnWatched, onVisible?: OnVisible, idOf: IdOf = srcOf) {
  const videoState = new WeakMap<HTMLVideoElement, VideoState>();
  // Tracks videos currently being timed so we can pause/resume on tab hide/show.
  const watchingSet = new Set<HTMLVideoElement>();
  const now = () => Date.now();

  function freshState(video: HTMLVideoElement): VideoState {
    return {
      watching: false,
      start: null,
      recorded: false,
      paused: false,
      hidden: false,
      stoppedAt: null,
      id: idOf(video),
    };
  }

  // Stop the watch clock for one reason. Anchors stoppedAt to the first reason
  // so concurrent reasons (pause + tab-hidden) share a single excluded span.
  function stopClock(state: VideoState, reason: 'paused' | 'hidden') {
    if (!state.watching) return;
    state[reason] = true;
    if (state.stoppedAt === null) state.stoppedAt = now();
  }

  // Clear one reason. Only once *every* reason is cleared do we shift `start`
  // forward by the stopped span — so the excluded time is counted exactly once,
  // regardless of the order pause/play and hide/show events arrive in.
  function resumeClock(state: VideoState, reason: 'paused' | 'hidden') {
    state[reason] = false;
    if (!state.paused && !state.hidden && state.stoppedAt !== null) {
      state.start = (state.start ?? now()) + (now() - state.stoppedAt);
      state.stoppedAt = null;
    }
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
      state.paused = video.paused === true;
      state.hidden = false;
      state.stoppedAt = state.paused ? now() : null;
      watchingSet.add(video);
      if (onVisible) onVisible(video);
    } else if (!isVisible && state.watching) {
      // If the clock is still stopped at exit (reel paused and/or tab hidden),
      // end at the point it stopped rather than at exit so the idle tail isn't
      // counted.
      const end = state.stoppedAt !== null ? state.stoppedAt : now();
      const watchedMs = end - (state.start ?? now());
      state.watching = false;
      state.start = null;
      state.paused = false;
      state.hidden = false;
      state.stoppedAt = null;
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
    if (st) stopClock(st, 'paused');
  }

  function handlePlay(video: HTMLVideoElement) {
    const st = videoState.get(video);
    if (st) resumeClock(st, 'paused');
  }

  function observeVideo(video: HTMLVideoElement) {
    try {
      const existing = videoState.get(video);
      if (existing) {
        // Instagram reuses video elements for different reels. If the identity
        // changed and we're not mid-count, reset so the new reel can be
        // tracked (and counted) independently of the old one.
        const id = idOf(video);
        if (id && existing.id && id !== existing.id && !existing.watching) {
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

  // Call when the tab becomes hidden. Stops the clock on every active timer for
  // the "hidden" reason; the elapsed hidden span is excluded on onShow(). Going
  // through stopClock means a reel already paused when the tab hides keeps its
  // single stoppedAt anchor rather than starting a second, overlapping one.
  function onHide() {
    for (const video of watchingSet) {
      const state = videoState.get(video);
      if (state) stopClock(state, 'hidden');
    }
  }

  // Call when the tab becomes visible again. Clears the "hidden" reason; the
  // clock only resumes once the reel is also unpaused (resumeClock), so a reel
  // the user had paused before tabbing away isn't counted as watched on return.
  function onShow() {
    for (const video of watchingSet) {
      const state = videoState.get(video);
      if (state) resumeClock(state, 'hidden');
    }
  }

  function disconnect() {
    observer.disconnect();
    watchingSet.clear();
  }

  return { scanAndObserve, disconnect, onHide, onShow, _videoState: videoState };
}
