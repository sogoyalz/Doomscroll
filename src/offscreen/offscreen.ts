// Offscreen document: hosts the on-device transformers.js classifier so it can
// run in the background (with the DOM/WASM context it needs) without the options
// page being open. The background service worker creates this document on demand
// and relays ML_CLASSIFY_REQUEST messages here.
//
// Replaces the old approach of hosting the model in the options page, which only
// worked while that page happened to be open — see service-worker.ts.

import { MESSAGE_TYPES } from '../lib/types.js';
import { classify, preload } from '../classification/transformersClassifier.js';

// Warm the model so the first real classify() isn't slowed by the one-time
// (then cached) model download + WASM init.
preload().catch((err) => console.error('offscreen: model preload failed', err));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== MESSAGE_TYPES.ML_CLASSIFY_REQUEST) return false;
  classify(msg.text || '')
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the channel open for the async response
});
