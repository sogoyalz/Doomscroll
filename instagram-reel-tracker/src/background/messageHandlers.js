// What to do per message type. Kept separate from service-worker.js so the
// routing/lifecycle wiring doesn't get tangled with the actual handler logic.

import { MESSAGE_TYPES } from '../lib/messages.js';
import { getAll, appendRecord } from '../lib/storage.js';
import { classify as classifyHeuristic } from '../classification/classifier.js';
import { classify as classifyLLM } from '../classification/llmClassifier.js';

async function classifyText(text) {
  const { settings } = await getAll({ settings: { useLLM: false } });
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

export const handlers = {
  async [MESSAGE_TYPES.REEL_WATCHED](message) {
    const { contextText, ...rest } = message.record;
    const { mood, score, matched } = await classifyText(contextText);
    const record = {
      ...rest,
      mood,
      moodScore: score,
      moodTerms: matched[mood] || [],
    };
    const { reelCount, record: savedRecord } = await appendRecord(record);
    return { reelCount, record: savedRecord };
  },
};

export function handleMessage(message, _sender, sendResponse) {
  const handler = handlers[message?.type];
  if (!handler) return false;

  handler(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));

  return true; // keep the message channel open for the async response
}
