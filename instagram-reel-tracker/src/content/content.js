// Entry point for the content script ("the eyes" — only layer that touches
// instagram.com). Wires the dwell detector to the DOM scraper + classifier,
// and reports finished views to the background service worker.

import { createReelDetector } from './reelDetector.js';
import { extractContextText, isLikelyReel } from './domScraper.js';
import { classify } from '../classification/classifier.js';
import { MESSAGE_TYPES } from '../lib/messages.js';

(() => {
  console.log('InstaReel Tracker content script starting');

  function handleWatched(video, watchedMs) {
    if (!isLikelyReel(video)) return;

    const contextText = extractContextText(video);
    const { mood, score, matched } = classify(contextText);

    const record = {
      src: video.currentSrc || video.src || '',
      watchedMs,
      ts: Date.now(),
      mood,
      moodScore: score,
      moodTerms: matched[mood] || [],
      contextSample: contextText.slice(0, 200),
    };

    try {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.REEL_WATCHED, record });
    } catch {
      // service worker may be asleep / context invalidated during reload
    }
  }

  const detector = createReelDetector(handleWatched);

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
