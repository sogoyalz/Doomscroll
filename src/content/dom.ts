// Locating Reel containers in Instagram's DOM.
//
// Imported by BOTH the isolated-world content script and the MAIN-world
// shortcode bridge, so nothing here may touch chrome.* APIs.
//
// Every selector is anchored on aria-label / dir / role / href prefix.
// Meta's generated atomic class names (x1lliihq, xvs91rp, …) change between
// deploys and A/B cohorts and must never be selected on. See docs/dom-notes.md.

export const VIDEO_PLAYER_SELECTOR = 'div[aria-label="Video player"]';
export const AUTHOR_LINK_SELECTOR = 'a[aria-label$=" reels"]';

// The MAIN-world bridge republishes the React fiber shortcode here, because
// an isolated-world script cannot read page-set expando properties.
export const SHORTCODE_ATTR = 'data-reel-code';

// Which path produced the shortcode. The bridge is the most fragile thing in
// the extension and it fails silently — a React internals rename just stops
// resolving, and the derived `author|basename` fallback keeps tracking working
// while quietly degrading identity. Publishing the source is what makes that
// degradation countable instead of invisible.
export const SHORTCODE_SRC_ATTR = 'data-reel-code-src';

/**
 * Instagram shortcodes are URL-safe base64, almost always 11 characters.
 *
 * The bridge copies `media.code` out of the page, and the page can also write
 * the same attribute itself. Anything outside this shape is not an identity
 * the extension should store or treat as fiber-derived.
 */
const PUBLISHED_SHORTCODE = /^[A-Za-z0-9_-]{6,32}$/;

export function isPublishedShortcode(value: unknown): value is string {
  return typeof value === 'string' && PUBLISHED_SHORTCODE.test(value);
}

export type ShortcodeSource = 'fiber' | 'fallback';

/**
 * Bridge liveness, published on <html> by the MAIN-world script.
 *
 * Separates the ways the shortcode channel dies, which need different fixes
 * and look identical from the isolated world:
 *
 * - `ok` — at least one container resolved a shortcode.
 * - `no-fiber` — containers exist and NONE carries a `__reactFiber$` expando.
 *   React internals were renamed, or Instagram stopped rendering this tree in
 *   React. Conclusive on its own, which is why it must mean only this.
 * - `no-code` — the fiber is there but no `media.code` was found on it. Two
 *   very different things look like this: the props shape was renamed, and a
 *   container that has mounted but not hydrated yet. The second is ordinary —
 *   it happens at page load and whenever a fresh batch mounts mid-scroll — so
 *   this is NOT evidence of a fault and must not be treated as conclusive.
 *   `fallbackIdentityShare` over a full sample is the instrument for that.
 * - attribute absent — the MAIN-world script never ran at all (registration
 *   dropped from the manifest, injection blocked), or tracking is paused.
 *
 * `no-code` was split out of `no-fiber` after the two were found conflated:
 * one reel completing during ordinary hydration raised a permanent "Reels
 * aren't being identified reliably" alarm on a healthy feed.
 */
export const BRIDGE_STATUS_ATTR = 'data-reel-bridge';

export type BridgeStatus = 'ok' | 'no-fiber' | 'no-code' | 'absent';

/** Reads bridge liveness from the isolated world. */
export function bridgeStatus(doc: Document = document): BridgeStatus {
  const value = doc.documentElement.getAttribute(BRIDGE_STATUS_ATTR);
  return value === 'ok' || value === 'no-fiber' || value === 'no-code' ? value : 'absent';
}

/**
 * Whether tracking is on, published on <html> by the ISOLATED-world script.
 *
 * The MAIN world has no chrome.* at all, so it cannot read the setting that
 * governs it. Without this it had no lifecycle controls of any kind and kept
 * walking React fiber and writing attributes into Instagram's DOM after the
 * user switched tracking off — while the options page promised "nothing is
 * observed at all; the extension stops watching the page".
 *
 * Absent means paused until the isolated script has read the saved setting.
 * A saved pause must also be respected during page initialization.
 */
export const TRACKING_ATTR = 'data-reel-watch';

export function trackingPaused(doc: Document = document): boolean {
  return (
    !isTrackingSurface(doc.location?.pathname ?? '/') ||
    doc.documentElement.getAttribute(TRACKING_ATTR) !== 'on'
  );
}

/** Manifest exclusions only apply to a fresh load; SPA navigations need this too. */
export function isTrackingSurface(pathname: string): boolean {
  return !/^\/(?:direct|accounts)(?:\/|$)/.test(pathname);
}

// The author link sits a few levels above the video player; 12 is well clear
// of the observed depth while still bailing out before reaching the feed root.
const MAX_ANCESTOR_WALK = 12;

// Fallback container detection accepts an ancestor whose height is within
// this fraction of the viewport, since each reel occupies roughly one screen.
const VIEWPORT_HEIGHT_TOLERANCE = 0.1;

/**
 * All mounted reel containers, in DOM order.
 *
 * Instagram keeps 8–9 mounted at once. Some are placeholders with no video
 * and no resolvable shortcode — callers must tolerate them rather than
 * assuming every container is a real reel.
 */
export function findReelContainers(root: ParentNode = document): HTMLElement[] {
  const players = [...root.querySelectorAll<HTMLElement>(VIDEO_PLAYER_SELECTOR)];
  if (!players.length) return [];

  // One parent walk for the whole screen. The old check ran querySelectorAll
  // on every ancestor of every player, and each of those scans the feed.
  const playerCount = countPlayersUnderAncestors(players);
  const containers = new Set<HTMLElement>();
  for (const player of players) {
    const container = cachedContainerForPlayer(player, playerCount);
    if (container) containers.add(container);
  }
  return [...containers];
}

/**
 * Player-to-container resolution, memoised per player element.
 *
 * The mapping does not change for a given player. Revalidated with two tree
 * checks, no selector matching, so a stale entry cannot survive a re-render.
 */
const containerByPlayer = new WeakMap<HTMLElement, HTMLElement>();

function countPlayersUnderAncestors(players: readonly HTMLElement[]): Map<HTMLElement, number> {
  const counts = new Map<HTMLElement, number>();
  for (const player of players) {
    let node = player.parentElement;
    for (let depth = 0; depth < MAX_ANCESTOR_WALK && node; depth++) {
      if (node === document.body || node === document.documentElement) break;
      counts.set(node, (counts.get(node) ?? 0) + 1);
      node = node.parentElement;
    }
  }
  return counts;
}

function cachedContainerForPlayer(
  player: HTMLElement,
  playerCount?: Map<HTMLElement, number>,
): HTMLElement | null {
  const cached = containerByPlayer.get(player);
  // Revalidate rather than trust: the container must still be in the document
  // and still own this player. Both are cheap tree checks, no selector
  // matching, so a stale entry can never survive a re-render.
  if (cached && cached.isConnected && cached.contains(player)) return cached;

  const resolved = resolveContainer(player, playerCount);
  if (resolved) containerByPlayer.set(player, resolved);
  return resolved;
}

/**
 * The reel container owning a given video player.
 *
 * Primary: nearest ancestor that also contains the author link — walking up
 * from the player stops at the reel's own container, since the author link
 * lives in a sibling subtree within it.
 *
 * Fallback (author link missing/renamed): nearest ancestor that is roughly
 * viewport-height, since each reel occupies about one screen.
 */
export function containerForPlayer(player: HTMLElement): HTMLElement | null {
  return resolveContainer(player);
}

/**
 * Ancestors that still belong to this reel, then the one that should be tracked.
 *
 * `playerCount` comes from a single walk over every mounted player. Without
 * it, each ancestor asks the DOM whether it holds a second player.
 */
function resolveContainer(
  player: HTMLElement,
  playerCount?: Map<HTMLElement, number>,
): HTMLElement | null {
  // Collect the ancestors that could plausibly be this reel's container
  // before testing any of them, so both strategies search the same bounded
  // set and neither can escape into the page shell.
  const candidates: HTMLElement[] = [];
  let node = player.parentElement;

  for (let depth = 0; depth < MAX_ANCESTOR_WALK && node; depth++) {
    // <body> and <html> contain every reel. Returning one would collapse the
    // whole feed into a single container and attribute every view to it.
    if (node === document.body || node === document.documentElement) break;

    // A reel container holds exactly one player. Seeing a second means the
    // walk has left this reel and reached the feed that holds them all —
    // which is what happens when a reel's own author link is missing.
    const others = playerCount
      ? (playerCount.get(node) ?? 0) > 1
      : node.querySelectorAll(VIDEO_PLAYER_SELECTOR).length > 1;
    if (others) break;

    candidates.push(node);
    node = node.parentElement;
  }

  for (const candidate of candidates) {
    // The live layout can put an absolutely positioned player inside a
    // zero-height wrapper. That wrapper has the right text but no geometry
    // for midpoint tracking; use the first enclosing box with actual height.
    if (
      candidate.querySelector(AUTHOR_LINK_SELECTOR) &&
      (candidate.clientHeight > 0 || candidate.getBoundingClientRect().height > 0)
    )
      return candidate;
  }

  // Author label renamed or dropped: fall back to the ancestor that is about
  // one screen tall, since each reel occupies roughly a viewport.
  const viewportHeight = window.innerHeight;
  for (const candidate of candidates) {
    const delta = Math.abs(candidate.clientHeight - viewportHeight);
    if (delta <= viewportHeight * VIEWPORT_HEIGHT_TOLERANCE) return candidate;
  }

  return null;
}

/**
 * The reel the user is actually looking at: the container straddling the
 * viewport's vertical midpoint.
 *
 * Verified to select exactly one container at every scroll position sampled.
 * Deliberately does NOT use video.paused / video.currentTime — every mounted
 * video reads `paused: true, currentTime: 0` regardless of what is on screen.
 *
 * Falls back to the container with the largest visible height, which matters
 * during momentum scrolling when no container cleanly spans the midpoint.
 */
export function activeReelContainer(containers: HTMLElement[]): HTMLElement | null {
  const viewportHeight = window.innerHeight;
  const midpoint = viewportHeight / 2;

  let fallback: HTMLElement | null = null;
  let fallbackVisible = 0;

  for (const container of containers) {
    const rect = container.getBoundingClientRect();
    if (rect.top <= midpoint && rect.bottom >= midpoint) return container;

    const visible = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
    if (visible > fallbackVisible) {
      fallbackVisible = visible;
      fallback = container;
    }
  }

  return fallbackVisible > 0 ? fallback : null;
}

// A scrollable element must overshoot its own height by this much to count,
// which excludes incidentally-overflowing wrappers.
const MIN_SCROLL_OVERSHOOT = 200;
const MIN_SCROLL_VIEWPORT = 300;

/**
 * The element the Reels feed actually scrolls in.
 *
 * The document itself does NOT scroll — window.scrollY stays 0 and scrolling
 * happens inside a nested div. Listeners bound to window/document never fire,
 * so anything scroll-driven has to bind here instead.
 */
export function findScrollContainer(root: ParentNode = document): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('div')) {
    if (
      el.scrollHeight > el.clientHeight + MIN_SCROLL_OVERSHOOT &&
      el.clientHeight > MIN_SCROLL_VIEWPORT
    ) {
      return el;
    }
  }
  return null;
}
