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
  trackingPaused,
  TRACKING_ATTR,
  VIDEO_PLAYER_SELECTOR,
} from './dom.js';

// The live October 2026 player stack exceeded the former 30-level limit.
// Keep the walk bounded and avoid revisiting shared ancestors or cycles.
const FIBER_WALK_LIMIT = 120;

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
  return readFiber(el).code;
}

/**
 * The shortcode, and whether React was there to be read at all.
 *
 * The second half is the point. `shortcodeFromFiber` returning null conflates
 * "React renamed its internals" with "this container mounted a moment ago and
 * has not hydrated", and the status published from it is consumed as though
 * it could only mean the first.
 */
function readFiber(el: HTMLElement): { code: string | null; hasFiber: boolean } {
  // Geometry wrappers may sit above the component holding media props.
  // Starting only from that wrapper skips the component entirely. Prefer
  // the media leaf and player, retaining the wrapper as a fallback.
  let hasFiber = false;
  const visited = new Set<FiberNode>();
  for (const candidate of [
    el.querySelector('video'),
    el.querySelector(VIDEO_PLAYER_SELECTOR),
    el,
  ]) {
    if (!(candidate instanceof HTMLElement)) continue;
    let node: FiberNode | null = fiberOf(candidate);
    if (node) hasFiber = true;
    for (let depth = 0; depth < FIBER_WALK_LIMIT && node && !visited.has(node); depth++) {
      visited.add(node);
      const code = node.memoizedProps?.media?.code;
      if (typeof code === 'string' && code) return { code, hasFiber: true };
      node = node.return;
    }
  }
  return { code: null, hasFiber };
}

/**
 * Publishes whether the fiber channel is alive, for the isolated world to
 * count. Only written on change — this runs every frame while scrolling.
 */
function publishStatus(status: 'ok' | 'no-fiber' | 'no-code'): void {
  const root = document.documentElement;
  if (root.getAttribute(BRIDGE_STATUS_ATTR) !== status) {
    root.setAttribute(BRIDGE_STATUS_ATTR, status);
  }
}

export function tagContainers(): void {
  // Nothing at all while tracking is off — no fiber walks, no DOM queries
  // beyond this check, no attribute writes. The switch says the extension
  // stops watching the page, and this is the half of it that used to carry on
  // regardless because the MAIN world cannot reach chrome.storage to know.
  if (trackingPaused()) return;

  const containers = findReelContainers();
  let resolved = 0;
  let withFiber = 0;

  for (const container of containers) {
    const { code, hasFiber } = readFiber(container);
    if (hasFiber) withFiber++;
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
  // reporting a fault there would flag every non-Reels page as broken.
  //
  // Placeholders never resolve, so a partial resolve is normal and healthy.
  // Below that, the two failures are reported separately, because only one of
  // them is evidence of anything: no expando anywhere is the React-rename
  // signature, while a fiber without media.code is also just a container that
  // has not hydrated yet.
  if (!containers.length) return;
  if (resolved) publishStatus('ok');
  else publishStatus(withFiber ? 'no-code' : 'no-fiber');
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

/**
 * Binds and unbinds the subtree observer to follow the tracking switch.
 *
 * The observer is the expensive half: `subtree: true` on document.body fires
 * many times a second on a feed that re-renders constantly. Leaving it bound
 * while paused would mean the extension was still watching the page in the
 * only sense that costs anything, however little it did with what it saw.
 */
let observer: MutationObserver | null = null;

function syncObserver(): void {
  if (trackingPaused()) {
    observer?.disconnect();
    observer = null;
    return;
  }
  if (observer) return;
  observer ??= new MutationObserver(scheduleRetag);
  observer.observe(document.body, { childList: true, subtree: true });
}

function start(): void {
  syncObserver();
  tagContainers();
  // Respond immediately when the isolated world publishes the saved setting.
  // Observe only this attribute, never page content while tracking is paused.
  const settingObserver = new MutationObserver(() => {
    syncObserver();
    tagContainers();
  });
  settingObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [TRACKING_ATTR],
  });

  // Safety net for re-renders and SPA transitions that do not mutate the
  // observed content. Also catches changes missed while the observer was off.
  setInterval(() => {
    syncObserver();
    tagContainers();
  }, RETAG_INTERVAL_MS);
}

start();
