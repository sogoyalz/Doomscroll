import { describe, it, expect, beforeEach } from 'vitest';
import { send } from '../src/shared/client.ts';

let reply;
let lastMessage;

globalThis.chrome = {
  runtime: {
    async sendMessage(message) {
      lastMessage = message;
      return typeof reply === 'function' ? reply(message) : reply;
    },
  },
};

beforeEach(() => {
  reply = undefined;
  lastMessage = undefined;
});

describe('send', () => {
  it('unwraps the data from a successful envelope', async () => {
    reply = { ok: true, data: [{ date: '2026-08-07' }] };
    expect(await send('GET_STATS', { range: 'today' })).toEqual([{ date: '2026-08-07' }]);
  });

  it('forwards the type and payload as sent', async () => {
    reply = { ok: true, data: null };
    await send('GET_DETECTION_LOG', { limit: 10 });
    expect(lastMessage).toEqual({ type: 'GET_DETECTION_LOG', payload: { limit: 10 } });
  });

  it('throws with the handler error on a failed envelope', async () => {
    reply = { ok: false, error: 'db closed' };
    await expect(send('GET_SETTINGS', {})).rejects.toThrow('db closed');
  });

  it('distinguishes no handler from a handler failure', async () => {
    // An unclaimed message resolves undefined, which is a wiring bug rather
    // than a runtime error and should not be reported as a generic failure.
    reply = undefined;
    await expect(send('GET_SETTINGS', {})).rejects.toThrow(/No response from background/);
  });

  it('passes a falsy but valid payload through', async () => {
    reply = { ok: true, data: 0 };
    expect(await send('GET_STATS', { range: '7d' })).toBe(0);
  });
});
