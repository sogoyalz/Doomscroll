import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  combineWithRules,
  modelResult,
  modelText,
  TOPIC_LABELS,
  TONE_LABELS,
} from '../src/shared/model-labels.ts';
import { classifyWithModel } from '../src/background/model.ts';
import { classifyReel } from '../src/background/classify.ts';
const input = {
  captionText: 'Playing violin in the orchestra',
  hashtags: [],
  audioName: 'Romantic song',
};
const score = (label, first = 0.95, second = 0.03) => ({
  labels: [label, 'other'],
  scores: [first, second],
});

beforeEach(() => {
  globalThis.chrome = {
    offscreen: {
      hasDocument: vi.fn().mockResolvedValue(true),
      closeDocument: vi.fn().mockResolvedValue(),
      createDocument: vi.fn().mockResolvedValue(),
      Reason: { WORKERS: 'WORKERS' },
    },
    runtime: { sendMessage: vi.fn() },
  };
});

describe('trained model decisions', () => {
  it('keeps topic and tone separately and does not use the soundtrack as input', () => {
    expect(modelText(input)).not.toContain('Romantic');
    const result = modelResult(score(TOPIC_LABELS.music), score(TONE_LABELS.romantic));
    expect(result.details).toMatchObject({ topic: 'music', tone: 'romantic' });
    // A love song is music: the romantic tone stays in details for review.
    expect(result.category).toBe('music');
  });
  it('still leads with a tone that is not about the song', () => {
    const result = modelResult(score(TOPIC_LABELS.music), score(TONE_LABELS.sad));
    expect(result.category).toBe('sad');
  });
  it('abstains on weak and tied predictions', () => {
    const result = modelResult(
      score(TOPIC_LABELS.music, 0.5, 0.49),
      score(TONE_LABELS.sad, 0.7, 0.2),
    );
    expect(result.details).toMatchObject({ topic: null, tone: null, status: 'uncertain' });
    expect(result.confidence).toBe(0);
  });
  it('caps text and removes handles and URLs', () => {
    expect(
      modelText({ ...input, captionText: '@someone https://example.com ' + 'a'.repeat(1000) }),
    ).toHaveLength(600);
  });
  it('marks an inference failure as a rules fallback', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ ok: false });
    const result = await classifyReel(input, 'local-ml');
    expect(result.details).toMatchObject({ engine: 'local-rules', status: 'fallback' });
    expect(chrome.offscreen.closeDocument).toHaveBeenCalled();
  });
  it('does not run an English model on Devanagari-only input', async () => {
    const result = await classifyReel({ ...input, captionText: 'उदास दर्द दुख' }, 'local-ml');
    expect(result.details.status).toBe('fallback');
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
  it('does not classify an audio-only reel', async () => {
    expect(await classifyWithModel({ ...input, captionText: null })).toBeNull();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
  it('bounds inference time and closes timed-out work', async () => {
    vi.useFakeTimers();
    try {
      chrome.runtime.sendMessage.mockReturnValue(new Promise(() => {}));
      const result = classifyReel(input, 'local-ml');
      await vi.advanceTimersByTimeAsync(20001);
      expect((await result).details.status).toBe('fallback');
      expect(chrome.offscreen.closeDocument).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('combining the word lists with the model', () => {
  const model = (category, topic, tone, confidence = 0.95) => ({
    category,
    confidence,
    subtags: [],
    details: { topic, tone, engine: 'deberta-nli-q8-v1', status: 'classified' },
  });
  const rules = (category) => ({ category, confidence: 0.6, subtags: ['x'] });

  it('keeps a category the creator wrote and attaches the model details', () => {
    const result = combineWithRules(rules('breakup'), model('joyful', null, 'joyful'));
    expect(result.category).toBe('breakup');
    expect(result.details.tone).toBe('joyful');
  });
  it('uses the model topic when the word lists found nothing', () => {
    expect(
      combineWithRules(rules('neutral'), model('learning', 'learning', null, 0.7)).category,
    ).toBe('learning');
  });
  it('ignores a model tone that is not very sure', () => {
    expect(
      combineWithRules(rules('neutral'), model('angry', 'learning', 'angry', 0.8)).category,
    ).toBe('learning');
    expect(
      combineWithRules(rules('neutral'), model('angry', null, 'angry', 0.8)).category,
    ).toBe('neutral');
  });
  it('uses the score for the chosen topic when the tone falls below the interruption threshold', () => {
    const prediction = modelResult(
      score(TOPIC_LABELS.learning, 0.72),
      score(TONE_LABELS.angry, 0.85),
    );
    expect(combineWithRules(rules('neutral'), prediction)).toMatchObject({
      category: 'learning',
      confidence: 0.72,
    });
  });
  it('accepts a very sure model tone', () => {
    expect(
      combineWithRules(rules('neutral'), model('angry', null, 'angry', 0.95)).category,
    ).toBe('angry');
  });
  it('never lets a romantic model tone replace a song topic', () => {
    expect(
      combineWithRules(rules('neutral'), model('music', 'music', 'romantic', 0.97)).category,
    ).toBe('music');
  });
  it('falls back to the rules when the model returned nothing', () => {
    expect(combineWithRules(rules('food'), null).category).toBe('food');
  });
});

it('passes the model content tags once and drops discovery tags and account mentions', () => {
  expect(
    modelText({
      captionText: 'New term! @travel #SYLLABUS #explore',
      hashtags: ['syllabus', 'fyp'],
      audioName: null,
    }),
  ).toBe('New term! syllabus');
  expect(modelText({ captionText: '#Trending #Explore', hashtags: [], audioName: null })).toBe(
    '',
  );
});
