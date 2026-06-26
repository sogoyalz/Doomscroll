// Entry point for the content script ("the eyes" — only layer that touches
// instagram.com). Wires the dwell detector to the DOM scraper + classifier,
// and reports finished views to the background service worker.

import { createReelDetector } from './reelDetector.js';
import {
  extractContextText,
  extractCaption,
  isLikelyReel,
  reelIdOf,
  shortcodeFromPath,
} from './domScraper.js';
import { MESSAGE_TYPES } from '../lib/types.js';
import type { RawReelRecord } from '../lib/types.js';

declare global {
  interface Window {
    __InstaReelTracker?: ReturnType<typeof createReelDetector>;
  }
}

(() => {
  console.log('Doomscroll content script starting');

  // Caption text is captured while the reel is still on screen (onVisible),
  // not after it scrolls away (onWatched) — by then Instagram's virtualized
  // feed may have already swapped the DOM to the next reel.
  const contextTextByVideo = new WeakMap<HTMLVideoElement, string>();

  function handleVisible(video: HTMLVideoElement) {
    if (!isLikelyReel(video)) return;
    contextTextByVideo.set(video, extractContextText(video));
  }

  function handleWatched(video: HTMLVideoElement, watchedMs: number) {
    if (!isLikelyReel(video)) return;

    const contextText = contextTextByVideo.get(video) ?? extractContextText(video);

    const record: RawReelRecord = {
      src: video.currentSrc || video.src || '',
      watchedMs,
      ts: Date.now(),
      contextText,
      contextSample: contextText.slice(0, 200),
      caption: extractCaption(contextText),
    };

    try {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.REEL_WATCHED, record });
    } catch {
      // service worker may be asleep / context invalidated during reload
    }
  }

  // Identity prefers the Instagram shortcode (stable across IG's element reuse),
  // falling back to the media src when no permalink/URL shortcode is available.
  const detector = createReelDetector(
    handleWatched,
    handleVisible,
    (video) => reelIdOf(video) || video.currentSrc || video.src || '',
  );

  // "Reels scrolled": IG updates the URL to /reels/<shortcode> as you scroll the
  // reels surface. Each new shortcode = one reel navigated past, counted
  // independently of whether it was watched long enough to record. Content
  // scripts can't intercept the page's own history.pushState (separate JS world),
  // so we detect changes by re-checking the URL on DOM mutations + popstate.
  let lastShortcode = '';
  function checkUrlChange() {
    const code = shortcodeFromPath(location.pathname);
    if (!code || code === lastShortcode) return;
    lastShortcode = code;
    try {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.REEL_SCROLLED, shortcode: code });
    } catch {
      // service worker asleep / context invalidated during reload
    }
  }
  checkUrlChange();

  detector.scanAndObserve();
  const mo = new MutationObserver(() => {
    detector.scanAndObserve();
    checkUrlChange();
  });
  mo.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', checkUrlChange);

  // Heartbeat: rescan every 2s as an SPA safety net (IG navigates without full reloads).
  const heartbeat = setInterval(() => {
    detector.scanAndObserve();
    checkUrlChange();
  }, 2000);

  // Exclude time spent with the tab hidden from watch-time totals.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) detector.onHide();
    else detector.onShow();
  });

  window.addEventListener('beforeunload', () => {
    detector.disconnect();
    mo.disconnect();
    window.removeEventListener('popstate', checkUrlChange);
    clearInterval(heartbeat);
  });

  window.__InstaReelTracker = detector;
})();
