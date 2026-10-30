import { send } from '@shared/client.js';

/** Session assignment is serialized in the worker so tabs share one owner. */
export async function currentSessionId(endedAt: number, startedAt = endedAt): Promise<string> {
  try {
    return (await send('GET_SESSION_ID', { startedAt, endedAt })).id;
  } catch {
    // Preserve a view for durable retry when the worker cannot be reached.
    return crypto.randomUUID();
  }
}
