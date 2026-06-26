// Pulls likely caption/hashtag text off the DOM around a given <video> element.
// Kept separate from reelDetector so the "what is visible" and "what does it say"
// concerns don't get tangled.

import { UI_NOISE } from '../classification/rules.js';

export const normalizeText = (t: string | null | undefined): string =>
  (t || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function extractContextText(video: HTMLVideoElement): string {
  try {
    const article: ParentNode =
      video.closest('article, div[role="dialog"], div[role="presentation"]') ||
      video.parentElement ||
      document.body;

    const candidates: string[] = [];
    const selectors = [
      'h1',
      'h2',
      'h3',
      'figcaption',
      'span:not([role])',
      'div:not([role])',
      'a[href]:not([role="button"])',
    ];
    for (const sel of selectors) {
      const list = article.querySelectorAll(sel);
      for (let i = 0; i < list.length && candidates.length < 60; i++) {
        const el = list[i] as HTMLElement;
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

// Short human-readable title for display (e.g. the "Recent" list), distinct
// from the longer contextText used for mood classification.
export function extractCaption(contextText: string | null | undefined, maxLen = 80): string {
  const text = (contextText || '').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '…';
}

// The canonical Instagram reel shortcode from a URL path like /reel/<code>/ or
// /reels/<code>/. Returns '' when the path isn't a single-reel permalink (e.g.
// the bare /reels/ feed, or /reels/audio/...). The shortcode is stable across
// IG's DOM/element reuse, so it's a better reel identity than the media src.
const NON_SHORTCODE_SEGMENTS = new Set(['audio', 'sound']);
export function shortcodeFromPath(pathname: string | null | undefined): string {
  const m = /^\/reels?\/([A-Za-z0-9_-]+)/.exec(pathname || '');
  const code = m?.[1];
  if (!code) return '';
  return NON_SHORTCODE_SEGMENTS.has(code) ? '' : code;
}

// Best canonical identity for a reel <video>: prefer the Instagram shortcode
// (from the nearest reel permalink anchor, then the current URL); fall back to
// '' so callers can use the media src as before.
export function reelIdOf(video: HTMLVideoElement | null | undefined): string {
  try {
    if (!video) return '';
    const a = video.closest('a[href*="/reel/"], a[href*="/reels/"]') as HTMLAnchorElement | null;
    if (a?.href) {
      const code = shortcodeFromPath(new URL(a.href, location.href).pathname);
      if (code) return code;
    }
    return shortcodeFromPath(location.pathname);
  } catch {
    return '';
  }
}

export function isLikelyReel(video: HTMLVideoElement | null | undefined): boolean {
  try {
    if (!video) return false;
    if (location.pathname && location.pathname.startsWith('/reels')) return true;
    const src = (video.currentSrc || video.src || '').toLowerCase();
    if (src.includes('/reel') || src.includes('/reels') || src.includes('/video/')) return true;
    if (
      video.closest('a[href*="/reel/"], a[href*="/reels/"], a[href*="/sound/"], a[href*="/audio/"]')
    )
      return true;
    if (video.closest('article, div[role="dialog"], div[role="presentation"]')) return true;
  } catch {
    // ignore
  }
  return false;
}
