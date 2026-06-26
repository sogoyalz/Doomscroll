// What to do per message type. Kept separate from service-worker.js so the
// routing/lifecycle wiring doesn't get tangled with the actual handler logic.

import { MESSAGE_TYPES } from '../lib/messages.js';
import { getAll, appendRecord } from '../lib/storage.js';
import { classify as classifyHeuristic } from '../classification/classifier.js';
import { classify as classifyLLM } from '../classification/llmClassifier.js';
import type { ClassifyResult, RawReelRecord, ReelRecord } from '../lib/types.js';

// Set by the ML_CLASSIFIER_READY handler below when the options page has the
// on-device model loaded. There's no listener-side way to ask "is anyone
// listening for this message type", so the options page announces itself.
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
      console.warn('LLM classification failed, falling back to heuristic classifier', err);
    }
  }
  return classifyHeuristic(text);
}

interface ReelWatchedMessage {
  type: typeof MESSAGE_TYPES.REEL_WATCHED;
  record: RawReelRecord;
}

export const handlers = {
  async [MESSAGE_TYPES.REEL_WATCHED](
    message: ReelWatchedMessage,
  ): Promise<{ reelCount: number; record: ReelRecord }> {
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

  // Announced by the options page once its on-device model has loaded.
  // ML_CLASSIFY_REQUEST itself is handled by the options page, not here —
  // the background worker only tracks readiness so it knows whether routing
  // a classify request there is worth attempting.
  async [MESSAGE_TYPES.ML_CLASSIFIER_READY](): Promise<Record<string, never>> {
    mlClassifierReady = true;
    return {};
  },
};

export function handleMessage(
  message: { type?: string; record?: RawReelRecord },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): boolean {
  const handler = message?.type ? handlers[message.type as keyof typeof handlers] : undefined;
  if (!handler) return false;

  handler(message as ReelWatchedMessage)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));

  return true; // keep the message channel open for the async response
}
