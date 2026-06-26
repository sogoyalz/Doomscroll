import { describe, test, expect, afterEach } from 'vitest';
import {
  normalizeText,
  extractCaption,
  extractContextText,
  isLikelyReel,
} from '../src/content/domScraper.ts';

// --- lightweight DOM fakes (avoid pulling in jsdom) ------------------------

// A fake element: `text` is its innerText; `noise` makes closest() return a
// truthy match so the scraper filters it out (simulating nav/button chrome).
function el(text, noise = false) {
  return {
    innerText: text,
    closest: () => (noise ? {} : null),
  };
}

// A fake <video> whose closest() returns an article exposing the given
// selector -> elements map via querySelectorAll.
function videoWith(selectorMap, ariaLabel = '') {
  const article = {
    querySelectorAll: (sel) => selectorMap[sel] || [],
  };
  return {
    closest: () => article,
    getAttribute: () => ariaLabel,
  };
}

describe('normalizeText', () => {
  test('lowercases, collapses whitespace, trims', () => {
    expect(normalizeText('  Hello   WORLD\n ')).toBe('hello world');
  });
  test('handles null/undefined', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('extractCaption', () => {
  test('passes short text through unchanged', () => {
    expect(extractCaption('a short caption')).toBe('a short caption');
  });
  test('truncates long text at a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(40).trim(); // 199 chars
    const out = extractCaption(long, 80);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(81);
    expect(out.startsWith('word')).toBe(true);
  });
  test('returns empty string for empty/nullish input', () => {
    expect(extractCaption('')).toBe('');
    expect(extractCaption(null)).toBe('');
  });
});

describe('extractContextText', () => {
  test('joins candidate text and strips hashtags', () => {
    const video = videoWith({
      h1: [el('Morning workout routine #fitness')],
      'span:not([role])': [el('lets go')],
    });
    const out = extractContextText(video);
    expect(out).toContain('workout');
    expect(out).toContain('fitness'); // # stripped, word kept
    expect(out).not.toContain('#');
  });

  test('filters UI-noise parts separated by bullets', () => {
    const video = videoWith({
      h1: [el('Comment • amazing recipe')],
    });
    const out = extractContextText(video);
    expect(out).toBe('amazing recipe');
    expect(out).not.toContain('comment');
  });

  test('skips elements inside nav/button chrome', () => {
    const video = videoWith({
      h1: [el('Follow', true), el('real caption text')],
    });
    const out = extractContextText(video);
    expect(out).toContain('real caption text');
    expect(out).not.toContain('follow');
  });

  test('caps output at 800 characters', () => {
    const huge = 'a'.repeat(2000);
    const video = videoWith({ h1: [el(huge)] });
    expect(extractContextText(video).length).toBe(800);
  });
});

describe('isLikelyReel', () => {
  afterEach(() => {
    delete globalThis.location;
  });

  test('returns false for a missing video', () => {
    globalThis.location = { pathname: '/' };
    expect(isLikelyReel(null)).toBe(false);
  });

  test('true on a /reels path', () => {
    globalThis.location = { pathname: '/reels/' };
    expect(isLikelyReel({ closest: () => null })).toBe(true);
  });

  test('true when the video src looks like a reel', () => {
    globalThis.location = { pathname: '/' };
    const video = { currentSrc: 'https://cdn/instagram/reel/abc.mp4', closest: () => null };
    expect(isLikelyReel(video)).toBe(true);
  });

  test('true when wrapped in a reel anchor', () => {
    globalThis.location = { pathname: '/' };
    const video = { currentSrc: '', src: '', closest: (sel) => (sel.includes('/reel/') ? {} : null) };
    expect(isLikelyReel(video)).toBe(true);
  });

  test('false for an unrelated video on a non-reel page', () => {
    globalThis.location = { pathname: '/explore/' };
    const video = { currentSrc: 'https://cdn/clip.mp4', src: '', closest: () => null };
    expect(isLikelyReel(video)).toBe(false);
  });
});
