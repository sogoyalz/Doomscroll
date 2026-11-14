import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
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
    expect(result.category).toBe('romantic');
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
