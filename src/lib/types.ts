// Shared types and constants for the whole extension.

import type { MOOD_ORDER } from '../classification/rules.js';

export const MESSAGE_TYPES = {
  REEL_WATCHED: 'REEL_WATCHED',
  ML_CLASSIFY_REQUEST: 'ML_CLASSIFY_REQUEST',
  ML_CLASSIFIER_READY: 'ML_CLASSIFIER_READY',
} as const;

export type Mood = (typeof MOOD_ORDER)[number] | 'undetectable';
export type MoodBucket = 'hype' | 'chill' | 'emotional' | 'neutral';

export interface ClassifyResult {
  mood: Mood;
  score: number;
  matched: Partial<Record<Mood, string[]>>;
  wordHits: Partial<Record<Mood, number>>;
  emojiHits: Partial<Record<Mood, number>>;
}

// What content.js sends to the background service worker for a finished watch.
export interface RawReelRecord {
  src: string;
  watchedMs: number;
  ts: number;
  contextText: string;
  contextSample: string;
  caption: string;
}

// What's actually persisted, after classification adds mood fields.
export interface ReelRecord {
  src: string;
  watchedMs: number;
  ts: number;
  contextSample: string;
  caption: string;
  mood: Mood;
  moodScore: number;
  moodTerms: string[];
}

export interface Settings {
  useLLM: boolean;
  llmEndpoint?: string;
  llmApiKey?: string;
  // On-device zero-shot classification (transformers.js), run from the options
  // page since the model needs a DOM context — see transformersClassifier.ts.
  useMLClassifier?: boolean;
}

export interface StoredData {
  reelCount: number;
  reel_records: ReelRecord[];
  settings: Settings;
}
