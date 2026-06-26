// Optional smart classification path. Same interface as classifier.js's
// classify(text) so callers can switch engines without touching call sites.
// Disabled by default; enable via the options page ("settings.useLLM").
// Runs from the background service worker only — never import this from
// content.js, which executes in the page context on instagram.com.

import { MOOD_ORDER } from './rules.js';
import type { ClassifyResult, Mood } from '../lib/types.js';

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

// Abort a request that hangs — raw fetch has no timeout, and a stuck request
// would otherwise block the per-reel classify in the service worker forever.
const REQUEST_TIMEOUT_MS = 10_000;
// Retry transient rate limits (429) a couple of times before falling back.
const MAX_RETRIES = 2;
// Cap on a fallback delay (ms) when the response carries no Retry-After header.
const DEFAULT_BACKOFF_MS = 1_000;

// Reels repeat (same audio/caption across many clips), so caching by caption
// text avoids paying for — and rate-limiting on — duplicate classifications.
// Bounded, insertion-ordered LRU: on overflow we evict the oldest key.
const CACHE_MAX = 500;
const cache = new Map<string, ClassifyResult>();

function getCached(key: string): ClassifyResult | undefined {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key); // re-insert to mark as most-recently-used
    cache.set(key, hit);
  }
  return hit;
}

function setCached(key: string, value: ClassifyResult): void {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface LLMClassifyOptions {
  apiKey?: string;
  endpoint?: string;
}

async function requestOnce(
  endpoint: string,
  apiKey: string,
  body: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required for calling the Messages API directly from a browser-extension
        // context (the API blocks browser-origin requests as a CSRF guard by default).
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function classify(
  text: string,
  { apiKey, endpoint = DEFAULT_ENDPOINT }: LLMClassifyOptions = {},
): Promise<ClassifyResult> {
  if (!text) return { mood: 'undetectable', score: 0, matched: {}, wordHits: {}, emojiHits: {} };
  if (!apiKey) {
    throw new Error('llmClassifier.classify requires an Anthropic API key');
  }

  const key = text.slice(0, 800);
  const cached = getCached(key);
  if (cached) return cached;

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 64,
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { mood: { type: 'string', enum: MOOD_ORDER } },
          required: ['mood'],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: 'user',
        content: `Classify the dominant mood of this Instagram Reel caption/context text. Caption: ${key}`,
      },
    ],
  });

  let response: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    response = await requestOnce(endpoint, apiKey, body);
    if (response.status !== 429) break;
    if (attempt === MAX_RETRIES) break;
    // Honor Retry-After (seconds) when present, else exponential-ish backoff.
    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : DEFAULT_BACKOFF_MS * (attempt + 1);
    await sleep(waitMs);
  }

  if (!response || !response.ok) {
    throw new Error(`llmClassifier request failed: ${response?.status ?? 'no response'}`);
  }

  const data: { content?: Array<{ type: string; text?: string }> } = await response.json();
  const textBlock = data.content?.find((b) => b.type === 'text');
  if (!textBlock?.text) {
    throw new Error('llmClassifier received no text block in response');
  }

  const { mood }: { mood: Mood } = JSON.parse(textBlock.text);
  const result: ClassifyResult = { mood, score: 1, matched: {}, wordHits: {}, emojiHits: {} };
  setCached(key, result);
  return result;
}
