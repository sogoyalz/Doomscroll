import { classify } from '../src/classification/classifier.js';

describe('classify', () => {
  test('returns undetectable for empty text', () => {
    expect(classify('').mood).toBe('undetectable');
    expect(classify(null).mood).toBe('undetectable');
  });

  test('detects fitness from caption keywords', () => {
    const result = classify('intense gym workout abs cardio transformation');
    expect(result.mood).toBe('fitness');
  });

  test('detects funny over happy on emoji-only ties', () => {
    const result = classify('😂😂 lol');
    expect(result.mood).toBe('funny');
  });

  test('guards against single-emoji gaming false positives', () => {
    const result = classify('🎮 nice day');
    expect(result.mood).not.toBe('gaming');
  });

  test('detects gaming with word + emoji combo', () => {
    const result = classify('ranked valorant gameplay 🎮🏆');
    expect(result.mood).toBe('gaming');
  });

  test('detects educational tutorials', () => {
    const result = classify('python tutorial: learn coding basics 💡');
    expect(result.mood).toBe('educational');
  });

  test('returns undetectable when no keywords match', () => {
    const result = classify('just a random caption with no signal words');
    expect(result.mood).toBe('undetectable');
  });
});
