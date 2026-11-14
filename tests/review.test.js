import { describe, it, expect } from 'vitest';
import { classifyDimensions } from '../src/shared/classifier.ts';
import { validateReview } from '../src/shared/review.ts';
import { reelEventsToCSV } from '../src/shared/csv.ts';

const input = (captionText, audioName = null, hashtags = []) => ({
  captionText,
  audioName,
  hashtags,
});

describe('independent topic and tone regression cases (synthetic, not feed accuracy)', () => {
  it.each([
    ['guitar cover ❤️😍💕', 'Romantic love story', 'music', null],
    ['outfit', 'Official music song remix', 'fashion', null],
    ['jeans and sneakers', 'Pyaar ishq mohabbat', 'fashion', null],
    ['romantic song', null, 'music', 'romantic'],
    ['heartbreak guitar cover', null, 'music', 'breakup'],
    ['recipe', 'Sad lonely crying', 'food', null],
    ['music fashion', null, null, null],
    ['❤️💕', null, null, null],
    [null, 'Romantic song music', null, null],
    ['my boyfriend surprised me on our anniversary', null, null, 'romantic'],
  ])('%s with audio %s', (caption, audio, topic, tone) => {
    expect(classifyDimensions(input(caption, audio))).toEqual({ topic, tone });
  });
  it('does not double count hashtags in captions', () => {
    expect(classifyDimensions(input('#music fashion', null, ['music']))).toEqual(
      classifyDimensions(input('fashion', null, ['music'])),
    );
  });
});

describe('human feedback', () => {
  it('retains a separate machine prediction and exports labels without training on them', () => {
    const event = {
      ...input('guitar cover'),
      id: 'a',
      reelShortcode: 'b',
      sessionId: 's',
      startedAt: 0,
      endedAt: 1,
      watchDurationMs: 1,
      subtags: [],
      category: 'music',
    };
    const review = validateReview(event, { topic: 'fashion', tone: null });
    expect(review.predictedTopic).toBe('music');
    expect(review.topic).toBe('fashion');
    expect(classifyDimensions(event).topic).toBe('music');
    const csv = reelEventsToCSV([{ ...event, review }]);
    expect(csv).toContain(
      'reviewTopic,reviewTone,predictedTopic,predictedTone,reviewVersion,reviewedAt',
    );
    expect(csv).toContain('"fashion","","music"');
  });
  it.each([
    null,
    {},
    { topic: 'sad', tone: null },
    { topic: 'fashion', tone: 'music' },
    { topic: [], tone: null },
  ])('rejects invalid feedback %j', (review) => {
    expect(() => validateReview(input('outfit'), review)).toThrow();
  });
});
