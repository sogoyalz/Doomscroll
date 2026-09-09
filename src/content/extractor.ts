// Pulls the text signal out of one reel container: caption, hashtags, audio
// attribution, author, and identity.
//
// Every field except the author is nullable in production — captionless
// reels, zero-hashtag captions, and original-audio reels all occur normally.
// Extraction must degrade to nulls, never throw. See docs/dom-notes.md §3–6.

import { AUTHOR_LINK_SELECTOR, SHORTCODE_ATTR, type ShortcodeSource } from './dom.js';

export interface ExtractedReel {
  /** React fiber shortcode, when the MAIN-world bridge resolved one. */
  shortcode: string | null;
  /** Shortcode when available, else a derived key. Never empty. */
  identity: string;
  captionText: string | null;
  hashtags: string[];
  audioName: string | null;
  authorHandle: string | null;
  /**
   * Which channel produced `identity`. Counted rather than acted on: a feed
   * running mostly on `fallback` still tracks, but its identities will not
   * survive Instagram rotating CDN URLs, so the rate is worth watching.
   */
  shortcodeSource: ShortcodeSource;
  /**
   * Which selector found the audio row, or null when none did.
   *
   * A live capture of 700+ reels found audio 100% dark, and the counters could
   * not say whether the href anchors or the icon fallback was at fault. This
   * makes the answer readable off one instrumented session.
   */
  audioChannel: AudioChannel | null;
}

/** The audio-attribution selector that matched. See AUDIO_LINK_SELECTORS. */
export type AudioChannel = 'href-reels-audio' | 'href-audio' | 'href-music' | 'icon';

const CAPTION_SELECTOR = 'div[dir="auto"]';
const HASHTAG_LINK_SELECTOR = 'a[href^="/explore/tags/"]';
// The audio-attribution anchor. `/reels/audio/` is the historical href prefix;
// Instagram has used `/audio/` and `/music/` variants too, so all are tried.
// A live capture of 700+ reels found this channel returning nothing, so the
// SVG-anchored fallback below matters — re-verify against the live DOM.
const AUDIO_LINK_SELECTORS: ReadonlyArray<{ channel: AudioChannel; selector: string }> = [
  { channel: 'href-reels-audio', selector: 'a[href*="/reels/audio/"]' },
  { channel: 'href-audio', selector: 'a[href*="/audio/"]' },
  { channel: 'href-music', selector: 'a[href*="/music/"]' },
];
// Secondary anchor: the audio row carries an "Audio image" icon. When the
// href selectors miss, the artist/track text is a sibling of this icon.
const AUDIO_ICON_SELECTOR = 'svg[aria-label="Audio image"]';

// Artist and track are joined by a space–middot–space (U+00B7).
const AUDIO_SEPARATOR = ' · ';

const AUTHOR_LABEL_SUFFIX = ' reels';

/**
 * Reads rendered text with line breaks preserved.
 *
 * Captions use <br> for line breaks, so textContent runs paragraphs together.
 * innerText respects them but is not implemented in jsdom, hence the fallback
 * (which is what unit tests exercise).
 */
function readText(el: Element): string {
  const rendered = (el as HTMLElement).innerText;
  const text = typeof rendered === 'string' ? rendered : (el.textContent ?? '');
  return text.trim();
}

/**
 * Caption element: the `div[dir="auto"]` inside the container.
 *
 * The tag name carries the meaning — `span[dir="auto"]` is used for the
 * username, the separator, "Follow", and audio attribution. Only the div
 * variant is the caption.
 */
function captionElement(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(CAPTION_SELECTOR);
}

export function extractCaption(container: HTMLElement): string | null {
  const el = captionElement(container);
  if (!el) return null;
  const text = readText(el);
  return text || null;
}

/**
 * Percent-decodes a hashtag taken from an href.
 *
 * Instagram URL-encodes anything non-ASCII, so `#ग़म` arrives as
 * `%e0%a4%97%e0%a4%bc%e0%a4%ae` and `#reelindia❤️` as
 * `reelindia%e2%9d%a4%ef%b8%8f`. Left encoded, those never match the lexicon —
 * which is Hinglish- and Devanagari-heavy and weights emoji — so the strongest
 * signal on the reel is silently discarded. Measured at 69 of 1,559 hashtags
 * across a real feed.
 *
 * Returns the raw value on a malformed sequence: decodeURIComponent throws on
 * a stray '%', and one bad tag must not cost the reel its other hashtags.
 */
function decodeTag(tag: string): string {
  try {
    return decodeURIComponent(tag);
  } catch {
    return tag;
  }
}

/**
 * Hashtags, lowercased and without the leading '#'.
 *
 * Parsed from the href segment (/explore/tags/<tag>/) rather than the anchor
 * text, since the href is already canonical and lowercase. Falls back to
 * scanning the caption text when no hashtag links are present.
 */
export function extractHashtags(container: HTMLElement): string[] {
  const caption = captionElement(container);
  const scope: ParentNode = caption ?? container;
  const tags: string[] = [];

  for (const link of scope.querySelectorAll<HTMLAnchorElement>(HASHTAG_LINK_SELECTOR)) {
    const href = link.getAttribute('href') ?? '';
    const tag = href.split('/explore/tags/')[1]?.replace(/\/.*$/, '').trim();
    if (tag) tags.push(decodeTag(tag).toLowerCase());
  }

  if (!tags.length && caption) {
    // \p{M} keeps combining marks, so a non-Latin hashtag survives intact.
    for (const match of readText(caption).matchAll(/#([\p{L}\p{N}\p{M}_]+)/gu)) {
      const tag = match[1];
      if (tag) tags.push(tag.toLowerCase());
    }
  }

  return [...new Set(tags)];
}

/**
 * Audio attribution, formatted "Artist · Track".
 *
 * Null for original-audio reels, which render no audio link at all. The
 * marquee animation renders the text twice, so only the first line is taken.
 */
export function extractAudioName(container: HTMLElement): string | null {
  return extractAudio(container).name;
}

/** Audio attribution alongside the selector that found it. */
export function extractAudio(container: HTMLElement): {
  name: string | null;
  channel: AudioChannel | null;
} {
  const found = audioScope(container);
  if (!found) return { name: null, channel: null };

  const { scope, channel } = found;

  for (const span of scope.querySelectorAll<HTMLElement>('span[dir="auto"]')) {
    const text = readText(span);
    if (text.includes(AUDIO_SEPARATOR)) {
      const firstLine = text.split('\n')[0]?.trim();
      if (firstLine) return { name: firstLine, channel };
    }
  }

  // No separator found (single-name audio): fall back to the scope's own text.
  const fallback = readText(scope).split('\n')[0]?.trim();
  // The scope matched but held no readable text — a broken channel, not audio.
  return fallback ? { name: fallback, channel } : { name: null, channel: null };
}

/**
 * The element holding the audio attribution, tried by href, then by the
 * "Audio image" icon's nearest link/row when the href anchors miss.
 */
function audioScope(
  container: HTMLElement,
): { scope: HTMLElement; channel: AudioChannel } | null {
  for (const { channel, selector } of AUDIO_LINK_SELECTORS) {
    const link = container.querySelector<HTMLElement>(selector);
    if (link) return { scope: link, channel };
  }
  const icon = container.querySelector<HTMLElement>(AUDIO_ICON_SELECTOR);
  if (!icon) return null;
  // Prefer the icon's enclosing link; else its parent row.
  const scope = icon.closest<HTMLElement>('a') ?? icon.parentElement;
  return scope ? { scope, channel: 'icon' } : null;
}

/**
 * Author handle, from the author link's aria-label or its href.
 *
 * The href form is a genuine fallback, not just a second read of the same
 * element: if Instagram drops or renames the aria-label, the link stops
 * matching AUTHOR_LINK_SELECTOR entirely and has to be found by href instead.
 */
export function extractAuthorHandle(container: HTMLElement): string | null {
  const labelled = container.querySelector<HTMLAnchorElement>(AUTHOR_LINK_SELECTOR);
  if (labelled) {
    const label = labelled.getAttribute('aria-label') ?? '';
    const handle = label.slice(0, -AUTHOR_LABEL_SUFFIX.length).trim();
    if (handle) return handle;
  }

  for (const link of container.querySelectorAll<HTMLAnchorElement>('a[href$="/reels/"]')) {
    const fromHref = (link.getAttribute('href') ?? '').match(/^\/([^/]+)\/reels\/$/)?.[1];
    if (fromHref) return fromHref;
  }

  return null;
}

/** Shortcode published by the MAIN-world bridge, if it resolved one. */
export function extractShortcode(container: HTMLElement): string | null {
  return container.getAttribute(SHORTCODE_ATTR) || null;
}

/**
 * Stable-enough key for when no shortcode resolves: author handle plus the
 * video src basename. Good enough to dedupe within a session, though it will
 * not survive Instagram rotating CDN URLs.
 */
/**
 * The identity produced when neither the author nor the video resolved —
 * i.e. the container is mounted but Instagram has not filled it in yet.
 */
export const UNIDENTIFIED_IDENTITY = 'unknown|';

function fallbackIdentity(container: HTMLElement, authorHandle: string | null): string {
  const video = container.querySelector('video');
  const src = video?.currentSrc || video?.getAttribute('src') || '';
  const basename = src.split('?')[0]?.split('/').pop() ?? '';
  return `${authorHandle ?? 'unknown'}|${basename}`;
}

export function extractReel(container: HTMLElement): ExtractedReel {
  const authorHandle = extractAuthorHandle(container);
  const shortcode = extractShortcode(container);
  const audio = extractAudio(container);

  return {
    shortcode,
    identity: shortcode ?? fallbackIdentity(container, authorHandle),
    captionText: extractCaption(container),
    hashtags: extractHashtags(container),
    audioName: audio.name,
    authorHandle,
    shortcodeSource: shortcode ? 'fiber' : 'fallback',
    audioChannel: audio.channel,
  };
}

/**
 * Prefers the snapshot taken while the reel was on screen, filling in fields
 * that had not resolved yet from a later read.
 *
 * The feed is virtualized: by the time a reel finishes, its container may
 * already hold the next reel's content, so the snapshot wins for text. The
 * shortcode is the exception — the MAIN-world bridge may tag a container
 * after it becomes active, so a later non-null value is an improvement.
 */
export function mergeExtractions(
  snapshot: ExtractedReel,
  later: ExtractedReel | null,
): ExtractedReel {
  if (!later?.shortcode || snapshot.shortcode) return snapshot;
  return {
    ...snapshot,
    shortcode: later.shortcode,
    identity: later.shortcode,
    shortcodeSource: 'fiber',
  };
}

/** True when a snapshot is still missing text that a later read might supply. */
export function isIncomplete(reel: ExtractedReel): boolean {
  return reel.captionText === null || reel.audioName === null || reel.hashtags.length === 0;
}

/**
 * True when nothing identifying resolved at all — no shortcode, no author,
 * and no video, leaving the bare `unknown|` placeholder.
 *
 * This is what an un-hydrated container looks like: mounted, but Instagram has
 * not filled it in yet. It matters for same-reel comparison, because such a
 * snapshot has nothing to compare against and must not be mistaken for a
 * *different* reel once it does hydrate.
 *
 * Deliberately strict: a reel with no author but a resolved video
 * (`unknown|abc.mp4`) IS identifiable, and two such reels with different
 * videos are genuinely different reels.
 */
export function isUnidentified(reel: ExtractedReel): boolean {
  return reel.shortcode === null && reel.identity === UNIDENTIFIED_IDENTITY;
}

/**
 * Everything readable about a reel, as one string.
 *
 * The last resort for telling two reels apart when nothing identifies them.
 * Not an identity — it is not unique, and two reels sharing a caption are
 * indistinguishable here — but it is the difference between degraded tracking
 * and none at all.
 */
function readableText(reel: ExtractedReel): string {
  // Empty parts are dropped before joining, not after. The separator is not
  // whitespace, so trimming a separator-only string leaves it truthy and a
  // reel with nothing readable would read as having text.
  return [reel.captionText, reel.hashtags.join(' '), reel.audioName]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    // A separator no caption can contain, so two fields cannot run together
    // into the same string as one field holding both.
    .join('\u0000');
}

/**
 * Fills fields the snapshot is missing from a fresh read of the same reel.
 *
 * The caption and audio row often render a beat after the reel becomes active,
 * so the activation-time snapshot can be empty for a reel that is genuinely
 * there. Re-reading while the reel is still on screen recovers them. The
 * caller must guarantee the fresh read is the same reel (isSameReel), since
 * the feed recycles containers — otherwise this would graft the next reel's
 * text onto this one.
 */
export function fillMissingFields(snapshot: ExtractedReel, fresh: ExtractedReel): ExtractedReel {
  const shortcode = snapshot.shortcode ?? fresh.shortcode;

  // Identity precedence: a real shortcode, then the snapshot's own derived
  // identity — unless the snapshot never identified anything, in which case
  // the placeholder `unknown|` must give way to whatever hydration produced.
  const identity = shortcode ?? (isUnidentified(snapshot) ? fresh.identity : snapshot.identity);

  return {
    shortcode,
    identity,
    captionText: snapshot.captionText ?? fresh.captionText,
    hashtags: snapshot.hashtags.length ? snapshot.hashtags : fresh.hashtags,
    audioName: snapshot.audioName ?? fresh.audioName,
    authorHandle: snapshot.authorHandle ?? fresh.authorHandle,
    shortcodeSource: shortcode ? 'fiber' : 'fallback',
    // Follows whichever read supplied the audio name, so the channel counters
    // describe the selector that actually produced the stored value.
    audioChannel: snapshot.audioName ? snapshot.audioChannel : fresh.audioChannel,
  };
}

/**
 * True when two reads of a container describe the same reel.
 *
 * Used to notice Instagram recycling a container in place. A shortcode
 * present on only one side means the MAIN-world bridge resolved it late
 * rather than the reel having changed — treating that as a new reel would
 * split every view in two.
 */
export function isSameReel(a: ExtractedReel, b: ExtractedReel): boolean {
  if (a.shortcode && b.shortcode) return a.shortcode === b.shortcode;

  // Neither side could be named. That happens two ways, and conflating them
  // is what made a selector break stop tracking entirely rather than degrade:
  //
  //   - An un-hydrated shell, which is the same reel arriving. Calling it a
  //     new reel would report the empty placeholder as a finished view and
  //     never fill it in. This is why the rule exists.
  //   - Two genuinely different reels on a feed where identity extraction is
  //     dead. Calling those the same reel means the container is recycled
  //     without anyone noticing, one view stays open across the whole session,
  //     and nothing is ever recorded — a silent stop, from the one code path
  //     that runs precisely when Instagram has moved underneath us.
  //
  // Readable text separates them. A shell has none; a rendered reel usually
  // has a caption even when the author link and the fiber bridge are gone. So
  // when both sides carry text and it differs, these are different reels that
  // merely cannot be named — track them as such.
  if (isUnidentified(a) && isUnidentified(b)) {
    const textA = readableText(a);
    const textB = readableText(b);
    return !textA || !textB || textA === textB;
  }

  if (isUnidentified(a) || isUnidentified(b)) return true;

  // Two known-but-different authors mean a different reel, and this must be
  // checked BEFORE the shortcode-asymmetry rule below. Otherwise a container
  // recycled from an untagged reel to a tagged one looks like "the bridge
  // resolved our shortcode late", and the first reel's watch time gets filed
  // under the second reel's identity.
  if (a.authorHandle && b.authorHandle && a.authorHandle !== b.authorHandle) return false;

  // A shortcode on only one side: the MAIN-world bridge tagged this container
  // after the snapshot was taken. Same reel, now identifiable.
  if (a.shortcode || b.shortcode) return true;

  return a.identity === b.identity;
}
