// On-device zero-shot classification via transformers.js (ONNX Runtime Web /
// WASM). Same interface as classifier.js's classify(text) so callers can
// switch engines without touching call sites.
//
// Must run in a context with a DOM (the options page) — MV3 service workers
// can't reliably load/run a WASM model: they have no persistent execution
// context and get killed after ~30s idle, which would drop in-flight model
// state. See messageHandlers.ts for how the background worker relays
// classification requests here instead of running this itself.

import { pipeline } from '@huggingface/transformers';
import { MOOD_ORDER } from './rules.js';
import type { ClassifyResult, Mood } from '../lib/types.js';

const MODEL_ID = 'Xenova/nli-deberta-v3-xsmall';

type ZeroShotClassifier = Awaited<ReturnType<typeof getClassifierImpl>>;

function getClassifierImpl() {
  return pipeline('zero-shot-classification', MODEL_ID);
}

let classifierPromise: Promise<ZeroShotClassifier> | null = null;

function getClassifier(): Promise<ZeroShotClassifier> {
  if (!classifierPromise) {
    classifierPromise = getClassifierImpl();
  }
  return classifierPromise;
}

// Warms the model so the first real classify() call isn't slowed down by the
// (one-time, then cached) model download + WASM init.
export function preload(): Promise<unknown> {
  return getClassifier();
}

export async function classify(text: string): Promise<ClassifyResult> {
  if (!text) return { mood: 'undetectable', score: 0, matched: {}, wordHits: {}, emojiHits: {} };

  const classifier = await getClassifier();
  const result = await classifier(text, [...MOOD_ORDER]);
  const output = Array.isArray(result) ? result[0] : result;

  const topLabel = output?.labels[0];
  const topScore = output?.scores[0] ?? 0;
  if (!topLabel || topScore < 0.4) {
    return { mood: 'undetectable', score: 0, matched: {}, wordHits: {}, emojiHits: {} };
  }

  return { mood: topLabel as Mood, score: topScore, matched: {}, wordHits: {}, emojiHits: {} };
}
