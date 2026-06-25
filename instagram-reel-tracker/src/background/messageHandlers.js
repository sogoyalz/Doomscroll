// What to do per message type. Kept separate from service-worker.js so the
// routing/lifecycle wiring doesn't get tangled with the actual handler logic.

import { MESSAGE_TYPES } from '../lib/messages.js';
import { appendRecord } from '../lib/storage.js';

export const handlers = {
  async [MESSAGE_TYPES.REEL_WATCHED](message) {
    const { reelCount, record } = await appendRecord(message.record);
    return { reelCount, record };
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
