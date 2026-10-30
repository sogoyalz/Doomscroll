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
export const SHORTCODE_ATTR = 'data-doomscroll-shortcode';

// Which path produced the shortcode. The bridge is the most fragile thing in
// the extension and it fails silently — a React internals rename just stops
// resolving, and the derived `author|basename` fallback keeps tracking working
// while quietly degrading identity. Publishing the source is what makes that
// degradation countable instead of invisible.
export const SHORTCODE_SRC_ATTR = 'data-doomscroll-shortcode-src';

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
export const BRIDGE_STATUS_ATTR = 'data-doomscroll-bridge';

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
 * Absent means on. The MAIN-world script runs before the isolated one has
 * read storage, and defaulting to off would drop the shortcodes for the first
 * reels of every page load.
 */
export const TRACKING_ATTR = 'data-doomscroll-tracking';

export function trackingPaused(doc: Document = document): boolean {
  return (
    !isTrackingSurface(doc.location?.pathname ?? '/') ||
    doc.documentElement.getAttribute(TRACKING_ATTR) === 'off'
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
  const containers = new Set<HTMLElement>();
  for (const player of root.querySelectorAll<HTMLElement>(VIDEO_PLAYER_SELECTOR)) {
    const container = cachedContainerForPlayer(player);
    if (container) containers.add(container);
  }
  return [...containers];
}

/**
 * Player-to-container resolution, memoised per player element.
 *
 * This runs on every animation frame while scrolling, and resolving a
 * container walks ancestors calling querySelectorAll on each — queries that
 * search the whole feed subtree, once per mounted player, per frame. The
 * mapping never changes for a given player, so it is cached and revalidated
 * with two O(1)-ish checks instead.
 */
const containerByPlayer = new WeakMap<HTMLElement, HTMLElement>();

function cachedContainerForPlayer(player: HTMLElement): HTMLElement | null {
  const cached = containerByPlayer.get(player);
  // Revalidate rather than trust: the container must still be in the document
  // and still own this player. Both are cheap tree checks, no selector
  // matching, so a stale entry can never survive a re-render.
  if (cached && cached.isConnected && cached.contains(player)) return cached;

  const resolved = containerForPlayer(player);
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
    if (node.querySelectorAll(VIDEO_PLAYER_SELECTOR).length > 1) break;

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
