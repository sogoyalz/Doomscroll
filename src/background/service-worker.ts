// Background service worker — message router + lifecycle events.

import { initDefaults, getAll, appendRecord } from '../lib/storage.js';
import { MESSAGE_TYPES } from '../lib/types.js';
import { classify as classifyHeuristic } from '../classification/classifier.js';
import { classify as classifyLLM } from '../classification/llmClassifier.js';
import type { ClassifyResult, RawReelRecord, ReelRecord } from '../lib/types.js';

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Doomscroll installed — reason:', details.reason);
  initDefaults();
});

// Tracks whether the options page has its on-device ML model loaded and ready.
let mlClassifierReady = false;

async function classifyViaMLPage(text: string): Promise<ClassifyResult> {
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.ML_CLASSIFY_REQUEST,
    text,
  });
  if (!response?.ok) throw new Error(response?.error || 'ML classify request failed');
  return response.result;
}

async function classifyText(text: string): Promise<ClassifyResult> {
  const { settings } = await getAll({ settings: { useLLM: false } });

  if (settings?.useMLClassifier && mlClassifierReady) {
    try {
      return await classifyViaMLPage(text);
    } catch (err) {
      console.warn('On-device ML classification failed, falling back', err);
      mlClassifierReady = false;
    }
  }

  if (settings?.useLLM && settings?.llmApiKey) {
    try {
      return await classifyLLM(text, {
        apiKey: settings.llmApiKey,
        endpoint: settings.llmEndpoint,
      });
    } catch (err) {
      console.warn('LLM classification failed, falling back to heuristic', err);
    }
  }

  return classifyHeuristic(text);
}

interface ReelWatchedMessage {
  type: typeof MESSAGE_TYPES.REEL_WATCHED;
  record: RawReelRecord;
}

type Handler = (message: ReelWatchedMessage) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  async [MESSAGE_TYPES.REEL_WATCHED](message) {
    const { contextText, ...rest } = message.record;
    const { mood, score, matched } = await classifyText(contextText);
    const record: ReelRecord = {
      ...rest,
      mood,
      moodScore: score,
      moodTerms: matched[mood] || [],
    };
    const { reelCount, record: savedRecord } = await appendRecord(record);
    return { reelCount, record: savedRecord };
  },

  async [MESSAGE_TYPES.ML_CLASSIFIER_READY]() {
    mlClassifierReady = true;
    return {};
  },
};

chrome.runtime.onMessage.addListener(
  (message: { type?: string; record?: RawReelRecord }, _sender, sendResponse) => {
    const handler = message?.type ? handlers[message.type] : undefined;
    if (!handler) return false;

    handler(message as ReelWatchedMessage)
      .then((result) => sendResponse({ ok: true, ...(result as object) }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));

    return true; // keep channel open for async response
  },
);
