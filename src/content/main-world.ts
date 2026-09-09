// MAIN-world bridge: the only place a reel's real shortcode is reachable.
//
// Instagram's URL does NOT change while scrolling Reels — it identifies only
// the reel the page was opened on. The real shortcode lives in React fiber
// props (memoizedProps.media.code), and fiber keys are page-set expando
// properties, which an isolated-world content script cannot see.
//
// So this script runs in the page's own world (manifest "world": "MAIN") and
// republishes each container's shortcode as a plain data-* attribute. The
// isolated-world script then reads it synchronously off the DOM, with no
// request/response correlation to get wrong.
//
// This is the most fragile thing in the extension: a React internals rename
// breaks it silently. Callers must treat the shortcode as best-effort and
// fall back to a derived identity. See docs/dom-notes.md §6.

import {
  BRIDGE_STATUS_ATTR,
  findReelContainers,
  SHORTCODE_ATTR,
  SHORTCODE_SRC_ATTR,
} from './dom.js';

// memoizedProps.media.code was found within ~5 levels; 30 is generous
// headroom without risking a walk to the fiber root on every container.
const FIBER_WALK_LIMIT = 30;

// Re-tag periodically: React recycles containers as the feed virtualizes, and
// a re-render can drop an attribute React does not manage.
const RETAG_INTERVAL_MS = 1000;

interface FiberNode {
  return: FiberNode | null;
  memoizedProps?: { media?: { code?: unknown } };
}

// React derives one random suffix per page, so the key is the same on every
// element and worth remembering: Object.keys allocates an array of every own
// property on the node, and this runs per container on every retag.
let fiberKey: string | null = null;

function fiberOf(el: HTMLElement): FiberNode | null {
  const record = el as unknown as Record<string, FiberNode | undefined>;
  if (fiberKey !== null && fiberKey in record) return record[fiberKey] ?? null;

  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (!key) return null;
  fiberKey = key;
  return record[key] ?? null;
}

export function shortcodeFromFiber(el: HTMLElement): string | null {
  let node = fiberOf(el);
  for (let depth = 0; depth < FIBER_WALK_LIMIT && node; depth++) {
    const code = node.memoizedProps?.media?.code;
    if (typeof code === 'string' && code) return code;
    node = node.return;
  }
  return null;
}

/**
 * Publishes whether the fiber channel is alive, for the isolated world to
 * count. Only written on change — this runs every frame while scrolling.
 */
function publishStatus(status: 'ok' | 'no-fiber'): void {
  const root = document.documentElement;
  if (root.getAttribute(BRIDGE_STATUS_ATTR) !== status) {
    root.setAttribute(BRIDGE_STATUS_ATTR, status);
  }
}

function tagContainers(): void {
  const containers = findReelContainers();
  let resolved = 0;

  for (const container of containers) {
    const code = shortcodeFromFiber(container);
    if (code) resolved++;
    // Only overwrite on a successful resolve. Placeholder containers never
    // resolve, and blanking a previously-good value would lose identity for
    // a reel that is still on screen. Skip the write when the value already
    // matches: this runs constantly, and writing an attribute React does not
    // manage is not free.
    if (code && container.getAttribute(SHORTCODE_ATTR) !== code) {
      container.setAttribute(SHORTCODE_ATTR, code);
      // Marks the value as fiber-derived. Written alongside the shortcode
      // rather than on every pass, for the same reason: attribute writes React
      // does not manage are not free, and this runs constantly.
      container.setAttribute(SHORTCODE_SRC_ATTR, 'fiber');
    }
  }

  // Only meaningful once there is something to resolve: a page with no reel
  // containers says nothing about whether the fiber channel works, and
  // reporting 'no-fiber' there would flag every non-Reels page as broken.
  //
  // Placeholders never resolve, so a partial resolve is normal and counts as
  // healthy. Zero out of several containers is the React-rename signature.
  if (containers.length) publishStatus(resolved ? 'ok' : 'no-fiber');
}

let retagScheduled = false;

/**
 * Coalesces retags into one per frame.
 *
 * This script runs in the page's own JS context, so anything wasteful here
 * janks Instagram itself. A subtree observer on document.body fires many times
 * a second on a feed that re-renders constantly, and each retag walks fiber
 * nodes for every mounted container — far more often than the DOM can
 * meaningfully change. The isolated-world script already batches this way.
 */
function scheduleRetag(): void {
  if (retagScheduled) return;
  retagScheduled = true;
  requestAnimationFrame(() => {
    retagScheduled = false;
    tagContainers();
  });
}

function start(): void {
  tagContainers();

  // Tag newly-mounted containers as the feed lazy-loads.
  const observer = new MutationObserver(scheduleRetag);
  observer.observe(document.body, { childList: true, subtree: true });

  // Safety net for re-renders that neither mutate body nor drop the node.
  setInterval(tagContainers, RETAG_INTERVAL_MS);
}

start();
