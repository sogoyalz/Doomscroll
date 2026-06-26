// Entry point for the content script ("the eyes" — only layer that touches
// instagram.com). Wires the dwell detector to the DOM scraper + classifier,
// and reports finished views to the background service worker.

import { createReelDetector } from './reelDetector.js';
import { extractContextText, extractCaption, isLikelyReel } from './domScraper.js';
import { MESSAGE_TYPES } from '../lib/messages.js';
import type { RawReelRecord } from '../lib/types.js';

declare global {
  interface Window {
    __InstaReelTracker?: ReturnType<typeof createReelDetector>;
  }
}

(() => {
  console.log('InstaReel Tracker content script starting');

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

  const detector = createReelDetector(handleWatched, handleVisible);

  detector.scanAndObserve();
  const mo = new MutationObserver(() => detector.scanAndObserve());
  mo.observe(document.body, { childList: true, subtree: true });

  // Heartbeat: rescan every 2s as an SPA safety net (IG navigates without full reloads).
  const heartbeat = setInterval(() => detector.scanAndObserve(), 2000);

  window.addEventListener('beforeunload', () => {
    detector.disconnect();
    mo.disconnect();
    clearInterval(heartbeat);
  });

  window.__InstaReelTracker = detector;
})();
