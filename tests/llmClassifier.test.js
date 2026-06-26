import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { classify } from '../src/classification/llmClassifier.ts';

describe('llmClassifier.classify', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('returns undetectable for empty text without calling fetch', async () => {
    const result = await classify('', { apiKey: 'sk-ant-test' });
    expect(result.mood).toBe('undetectable');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('throws when no apiKey is provided', async () => {
    await expect(classify('some caption')).rejects.toThrow(/API key/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('parses a successful response into a mood result', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ mood: 'funny' }) }],
      }),
    });

    const result = await classify('lol this is hilarious', { apiKey: 'sk-ant-test' });
    expect(result.mood).toBe('funny');
    expect(result.score).toBeGreaterThan(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.headers['x-api-key']).toBe('sk-ant-test');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('claude-haiku-4-5');
  });

  test('throws when the response is not ok', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401 });
    await expect(classify('caption', { apiKey: 'sk-ant-test' })).rejects.toThrow(/401/);
  });

  test('respects a custom endpoint override', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ mood: 'calm' }) }],
      }),
    });

    await classify('caption', {
      apiKey: 'sk-ant-test',
      endpoint: 'https://my-proxy.example/v1/messages',
    });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('https://my-proxy.example/v1/messages');
  });
});
