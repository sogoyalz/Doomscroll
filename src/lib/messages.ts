// Message-type constants shared between content scripts and the background service worker.
export const MESSAGE_TYPES = {
  REEL_WATCHED: 'REEL_WATCHED',
  // Background -> options page: ask the page (which owns the loaded ML model)
  // to classify some text. Options page replies with a ClassifyResult.
  ML_CLASSIFY_REQUEST: 'ML_CLASSIFY_REQUEST',
  // Options page -> background: announce the model is loaded and ready, so
  // the background worker knows it can route classification requests there.
  ML_CLASSIFIER_READY: 'ML_CLASSIFIER_READY',
} as const;
