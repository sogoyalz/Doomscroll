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

// The on-device ML model runs in an offscreen document so it works in the
// background without the options page being open. We create the document
// lazily on first use and reuse it; only one offscreen document may exist.
let offscreenReady: Promise<void> | null = null;

function ensureOffscreen(): Promise<void> {
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen
      .createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: 'Run the on-device transformers.js mood classifier (WASM).',
      })
      .catch((err: unknown) => {
        // A document already exists → fine to reuse. Anything else: reset so we retry.
        if (!String(err).includes('single offscreen')) {
          offscreenReady = null;
          throw err;
        }
      });
  }
  return offscreenReady;
}

async function classifyViaOffscreen(text: string): Promise<ClassifyResult> {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.ML_CLASSIFY_REQUEST,
    text,
  });
  if (!response?.ok) throw new Error(response?.error || 'ML classify request failed');
  return response.result;
}

async function classifyText(text: string): Promise<ClassifyResult> {
  const { settings } = await getAll({ settings: { useLLM: false } });

  if (settings?.useMLClassifier) {
    try {
      return await classifyViaOffscreen(text);
    } catch (err) {
      console.warn('On-device ML classification failed, falling back', err);
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
