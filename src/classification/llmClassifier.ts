// Optional smart classification path. Same interface as classifier.js's
// classify(text) so callers can switch engines without touching call sites.
// Disabled by default; enable via the options page ("settings.useLLM").
// Runs from the background service worker only — never import this from
// content.js, which executes in the page context on instagram.com.

import { MOOD_ORDER } from './rules.js';
import type { ClassifyResult, Mood } from '../lib/types.js';

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

interface LLMClassifyOptions {
  apiKey?: string;
  endpoint?: string;
}

export async function classify(
  text: string,
  { apiKey, endpoint = DEFAULT_ENDPOINT }: LLMClassifyOptions = {},
): Promise<ClassifyResult> {
  if (!text) return { mood: 'undetectable', score: 0, matched: {}, wordHits: {}, emojiHits: {} };
  if (!apiKey) {
    throw new Error('llmClassifier.classify requires an Anthropic API key');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for calling the Messages API directly from a browser-extension
      // context (the API blocks browser-origin requests as a CSRF guard by default).
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 20,
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
          content: `Classify the dominant mood of this Instagram Reel caption/context text. Caption: ${text.slice(0, 800)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`llmClassifier request failed: ${response.status}`);
  }

  const data: { content?: Array<{ type: string; text?: string }> } = await response.json();
  const textBlock = data.content?.find((b) => b.type === 'text');
  if (!textBlock?.text) {
    throw new Error('llmClassifier received no text block in response');
  }

  const { mood }: { mood: Mood } = JSON.parse(textBlock.text);
  return { mood, score: 1, matched: {}, wordHits: {}, emojiHits: {} };
}
