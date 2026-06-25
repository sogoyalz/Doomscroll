// Pulls likely caption/hashtag text off the DOM around a given <video> element.
// Kept separate from reelDetector so the "what is visible" and "what does it say"
// concerns don't get tangled.

import { UI_NOISE } from '../classification/rules.js';

export const normalizeText = (t) => (t || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function extractContextText(video) {
  try {
    const article = video.closest('article, div[role="dialog"], div[role="presentation"]') || video.parentElement || document.body;

    const candidates = [];
    const selectors = [
      'h1', 'h2', 'h3', 'figcaption',
      'span:not([role])', 'div:not([role])',
      'a[href]:not([role="button"])',
    ];
    for (const sel of selectors) {
      const list = article.querySelectorAll(sel);
      for (let i = 0; i < list.length && candidates.length < 60; i++) {
        const el = list[i];
        if (el.closest('nav,[role="button"],button,[aria-hidden="true"]')) continue;
        const txt = (el.innerText || '').trim();
        if (!txt) continue;
        candidates.push(txt);
      }
      if (candidates.length >= 60) break;
    }

    let text = candidates.join(' ');
    text += ' ' + (video.getAttribute('aria-label') || '');
    text = text.replace(/#[\w]+/g, (s) => s.slice(1));

    let parts = text.split(/\s*[|•·\n\r]+\s*| {2,}/g).filter(Boolean);
    parts = parts.filter((p) => {
      const s = normalizeText(p);
      if (s.length < 2) return false;
      if (UI_NOISE.some((x) => s.includes(x))) return false;
      return true;
    });
    return normalizeText(parts.join(' ')).slice(0, 800);
  } catch {
    return '';
  }
}

export function isLikelyReel(video) {
  try {
    if (!video) return false;
    if (location.pathname && location.pathname.startsWith('/reels')) return true;
    const src = (video.currentSrc || video.src || '').toLowerCase();
    if (src.includes('/reel') || src.includes('/reels') || src.includes('/video/')) return true;
    if (video.closest('a[href*="/reel/"], a[href*="/reels/"], a[href*="/sound/"], a[href*="/audio/"]')) return true;
    if (video.closest('article, div[role="dialog"], div[role="presentation"]')) return true;
  } catch {
    // ignore
  }
  return false;
}
