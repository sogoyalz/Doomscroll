// Typed client for talking to the service worker.
//
// The background replies with an { ok, data } envelope so a handler failure
// arrives as data rather than a rejected sendMessage. This unwraps it back
// into a normal promise, so callers get the response type declared in
// MessageResponses and a thrown error when something actually failed.

import type { ExtensionMessage, MessageResponses, MessageResult } from './messages.js';

type PayloadFor<T extends ExtensionMessage['type']> = Extract<
  ExtensionMessage,
  { type: T }
>['payload'];

export async function send<T extends ExtensionMessage['type']>(
  type: T,
  payload: PayloadFor<T>,
): Promise<MessageResponses[T]> {
  const result = (await chrome.runtime.sendMessage({ type, payload })) as
    | MessageResult<MessageResponses[T]>
    | undefined;

  // No response at all means no handler claimed the message — a wiring bug
  // rather than a runtime failure, so it is worth surfacing distinctly.
  if (!result) throw new Error(`No response from background for ${type}`);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
