// Content script entry — the only layer that touches instagram.com.
//
// Watches which reel is at the viewport midpoint, times how long it stays
// there, and reports finished views to the service worker. Classification and
// storage happen there; this layer only observes.
//
// This code runs on the page the user is actively scrolling, so every sync is
// coalesced into an animation frame. A full sync walks the DOM and reads
// layout, and running that per scroll event is enough to be felt.

import {
  activeReelContainer,
  bridgeStatus,
  findReelContainers,
  findScrollContainer,
} from './dom.js';
import { createDwellTracker, type CompletedView } from './detector.js';
import { isHudMounted, mountHud, pushHudRow, unmountHud } from './hud.js';
import { hideOverlay, isOverlayShowing, showBreakReminder, showOverlay } from './overlay.js';
import { goTo } from './navigate.js';
import {
  BREAK_DESTINATION,
  BREAK_KEY,
  isBreakState,
  isReelsSurface,
  shouldRemind,
  type BreakState,
} from '@shared/break.js';
import {
  extractReel,
  fillMissingFields,
  isIncomplete,
  isSameReel,
  mergeExtractions,
  type ExtractedReel,
} from './extractor.js';
import { currentSessionId } from './session.js';
import { recordExtraction } from '@shared/health.js';
import { getSettings, SETTINGS_KEY } from '@shared/settings.js';
import type { ExtensionMessage } from '@shared/messages.js';
import type { NewReelEvent } from '@shared/types.js';

// Catches feed changes the observers miss (lazy-loaded batches, re-renders
// that do not mutate the observed subtree) and drives the periodic checks
// that are too expensive to run per frame.
const HEARTBEAT_MS = 1000;

/** Backoff between scroll-container scans that came up empty. */
const SCROLL_RESCAN_MS = 5000;

// A zero-height root band at the viewport's vertical centre: an element
// intersects it exactly when it straddles the midpoint, which is how the
// active reel is defined. Used only as a cheap change trigger — the
// authoritative pick is recomputed geometrically, since a zero-height root
// makes intersectionRatio useless for ranking.
const MIDPOINT_ROOT_MARGIN = '-50% 0px -50% 0px';

// Text captured while the reel is on screen. The feed is virtualized, so by
// the time a reel finishes its container may already hold the next one's
// content — reading at completion would attribute the wrong caption.
const snapshots = new WeakMap<HTMLElement, ExtractedReel>();

const tracker = createDwellTracker<HTMLElement>(handleCompletedView);

let observed = new WeakSet<HTMLElement>();
let intersectionObserver: IntersectionObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let mutationRoot: Node | null = null;
let scrollContainer: HTMLElement | null = null;
let lastScrollScanAt = 0;
let syncScheduled = false;
let observing = false;
let unloaded = false;

/**
 * Coalesces sync requests into one per frame.
 *
 * Scroll and mutation events both fire far faster than the DOM can
 * meaningfully change, and a sync reads layout — doing it per event would
 * make the feed janky while scrolling.
 */
function scheduleSync(): void {
  if (syncScheduled || !observing) return;
  syncScheduled = true;
  requestAnimationFrame(() => {
    syncScheduled = false;
    if (observing) syncActiveReel();
  });
}

function syncActiveReel(now: number = Date.now()): void {
  const containers = findReelContainers();

  if (intersectionObserver) {
    for (const container of containers) {
      if (observed.has(container)) continue;
      observed.add(container);
      intersectionObserver.observe(container);
    }
  }

  const active = activeReelContainer(containers);
  if (active && !snapshots.has(active)) snapshots.set(active, extractReel(active));

  const previous = tracker.currentTarget();
  tracker.setActive(active, now);

  // A view shorter than the dwell minimum is dropped without completing, so
  // handleCompletedView never runs and its snapshot is never cleared. If
  // Instagram then recycles that container, the next activation would reuse
  // the previous reel's text. Completed views have already removed their own
  // entry, so this only cleans up the dropped ones.
  if (previous && previous !== active) snapshots.delete(previous);
}

/**
 * Reconciles the active reel on each heartbeat. Two jobs, both needing a fresh
 * read of the container:
 *
 * 1. Recycling — the dwell tracker keys on the element, so a container reused
 *    in place for a different reel would keep one view open across two reels
 *    and bank all the time against the first. A changed identity closes the
 *    old view and opens a new one.
 * 2. Late render — the caption and audio row often appear a beat after the
 *    reel becomes active, so the activation-time snapshot can be empty for a
 *    reel that is genuinely there. While it is still the same reel, fill the
 *    missing fields in so it is not later logged as an empty (no-text) reel.
 */
function reconcileActiveReel(now: number): void {
  const active = tracker.currentTarget();
  if (!active?.isConnected) return;

  const snapshot = snapshots.get(active);
  if (!snapshot) return;

  const fresh = extractReel(active);

  if (isSameReel(snapshot, fresh)) {
    if (isIncomplete(snapshot)) snapshots.set(active, fillMissingFields(snapshot, fresh));
    return;
  }

  // Recycled: finalize against the old snapshot before replacing it.
  tracker.setActive(null, now);
  snapshots.set(active, fresh);
  tracker.setActive(active, now);
}

/**
 * Binds scroll and mutation observation to the feed's scroll container.
 *
 * The container is re-resolved whenever the bound one detaches: the content
 * script matches all of instagram.com, so a page that loads on the home feed
 * and then navigates to /reels/ starts with no container at all.
 *
 * Resolving it walks every div on the page and reads layout on each, which is
 * far too expensive to repeat casually. The `isConnected` check alone does not
 * prevent that: when the scan finds nothing it leaves `scrollContainer` null,
 * the guard stays false, and it re-scans on every heartbeat — forever, on any
 * page without a reels feed, which is most of Instagram. Hence the two guards
 * below.
 */
function ensureObservationTargets(now: number): void {
  if (scrollContainer?.isConnected) return;

  // Cheap attribute-only check, no layout reads. No reels on the page means
  // there is nothing to bind to and no reason to pay for the scan at all.
  if (!findReelContainers().length) return;

  // A reels page whose scroll container still will not resolve must not retry
  // every second either.
  if (now - lastScrollScanAt < SCROLL_RESCAN_MS) return;
  lastScrollScanAt = now;

  scrollContainer?.removeEventListener('scroll', scheduleSync);
  scrollContainer = findScrollContainer();
  scrollContainer?.addEventListener('scroll', scheduleSync, { passive: true });

  // Scope mutations to the feed where possible; document.body fires on every
  // unrelated Instagram re-render. Rebind only when the target actually
  // changed, so a failing scan does not churn a subtree observer on body.
  const nextRoot = scrollContainer?.parentElement ?? document.body;
  if (nextRoot !== mutationRoot) {
    mutationObserver?.disconnect();
    mutationObserver ??= new MutationObserver(() => scheduleSync());
    mutationObserver.observe(nextRoot, { childList: true, subtree: true });
    mutationRoot = nextRoot;
  }
}

function handleCompletedView(view: CompletedView<HTMLElement>): void {
  const snapshot = snapshots.get(view.target);
  if (!snapshot) return;
  snapshots.delete(view.target);

  // The MAIN-world bridge may have tagged the shortcode after activation, so
  // give the snapshot a chance to pick it up. Only when the container still
  // holds the same reel, though — a view finalised *because* the container was
  // recycled would otherwise adopt the incoming reel's identity for the
  // outgoing reel's watch time.
  const fresh = view.target.isConnected ? extractReel(view.target) : null;
  const later = fresh && isSameReel(snapshot, fresh) ? fresh : null;
  void reportView(mergeExtractions(snapshot, later), view);
}

async function reportView(
  reel: ExtractedReel,
  view: CompletedView<HTMLElement>,
): Promise<void> {
  const event: NewReelEvent = {
    id: crypto.randomUUID(),
    reelShortcode: reel.identity,
    sessionId: await currentSessionId(view.endedAt),
    startedAt: view.startedAt,
    endedAt: view.endedAt,
    watchDurationMs: view.watchDurationMs,
    captionText: reel.captionText,
    hashtags: reel.hashtags,
    audioName: reel.audioName,
    authorHandle: reel.authorHandle,
  };

  // Watch for Instagram's layout moving underneath us. Extraction degrades to
  // nulls rather than throwing, so without this a selector break looks
  // identical to a quiet week.
  void recordExtraction({
    hasAuthor: Boolean(reel.authorHandle),
    hasText: Boolean(reel.captionText || reel.hashtags.length || reel.audioName),
    hasAudio: Boolean(reel.audioName),
    fromFiber: reel.shortcodeSource === 'fiber',
    audioChannel: reel.audioChannel,
    bridgeStatus: bridgeStatus(),
    now: view.endedAt,
  });

  reportToHud(reel, event);

  const message: ExtensionMessage = { type: 'REEL_VIEW_LOGGED', payload: event };
  try {
    // sendMessage returns a promise here; without the catch, a rejection
    // (service worker asleep, context invalidated during reload) surfaces as
    // an unhandled rejection in the page console.
    await chrome.runtime.sendMessage(message);
  } catch {
    // Dropping a single view is preferable to breaking the page.
  }
}

function startObserving(): void {
  if (observing || unloaded) return;
  observing = true;

  intersectionObserver = new IntersectionObserver(() => scheduleSync(), {
    rootMargin: MIDPOINT_ROOT_MARGIN,
    threshold: 0,
  });

  ensureObservationTargets(Date.now());
  syncActiveReel();
}

/**
 * Tears observation down.
 *
 * `discard` rather than `flush`: pausing should stop recording at the moment
 * the user asked, not bank the partial reel they happened to be on. On unload
 * the caller flushes first, because that view really did finish.
 */
function stopObserving(): void {
  if (!observing) return;
  observing = false;

  // An interruption outliving the tracking it was about would be a dialog the
  // user cannot explain and the extension is no longer entitled to show.
  hideOverlay();
  tracker.discard();
  intersectionObserver?.disconnect();
  intersectionObserver = null;
  mutationObserver?.disconnect();
  mutationObserver = null;
  mutationRoot = null;
  scrollContainer?.removeEventListener('scroll', scheduleSync);
  scrollContainer = null;
  // Resuming should re-bind immediately rather than sit out the backoff.
  lastScrollScanAt = 0;
  observed = new WeakSet();
}

async function applyTrackingSetting(): Promise<void> {
  const { trackingEnabled, debugHud } = await getSettings();
  console.log(`[Doomscroll] tracking ${trackingEnabled ? 'enabled' : 'PAUSED'}`);
  if (trackingEnabled) startObserving();
  else stopObserving();

  // The HUD reports on tracking, so it follows tracking as well as its own
  // switch — a panel showing a frozen count while paused reads as a bug.
  if (debugHud && trackingEnabled) mountHud();
  else unmountHud();
}

/**
 * Feeds the diagnostic panel, when one is mounted.
 *
 * Guarded rather than unconditional so the HUD costs nothing in the normal
 * case: this runs once per finished reel on the page the user is scrolling.
 *
 * The per-reel console line lives behind the same guard. It used to run
 * unconditionally, which put the caption of everything you watch into the
 * console of a page you do not control, on a machine whose whole selling point
 * is that this data never leaves it — a debugging convenience that had outlived
 * the debug switch built for exactly this.
 */
function reportToHud(reel: ExtractedReel, event: NewReelEvent): void {
  if (!isHudMounted()) return;
  pushHudRow(reel, event.watchDurationMs);
  console.log(
    `[Doomscroll] reel watched ${event.watchDurationMs}ms — "${event.reelShortcode}"`,
    reel.captionText ? `caption: ${reel.captionText.slice(0, 60)}` : '(no caption)',
  );
}

/**
 * Holds the dwell clock while the page is hidden OR an overlay is up.
 *
 * The overlay half matters more than it looks. A prompt pauses the video and
 * then sits there — ten seconds at the block level, longer while someone
 * decides — and the reel underneath is still the one at the viewport midpoint,
 * so without this it banks every second of that as watch time. The extension
 * would be inflating the measurement of the very reel it interrupted, and the
 * break reminder, which can sit indefinitely, is worse.
 *
 * Expressed as one predicate over both conditions rather than paired
 * pause/resume calls at each site: with two independent reasons to be stopped,
 * whichever one resumed first would cancel the other. Returning from a
 * background tab must not restart the clock while the prompt is still up.
 */
function syncDwellClock(now: number = Date.now()): void {
  if (document.hidden || isOverlayShowing()) tracker.pause(now);
  else tracker.resume(now);
}

/**
 * Leaves the reels feed.
 *
 * The substantive half of a break: the state and the reminder guard against
 * coming straight back, but only navigation actually ends the scroll. Same
 * origin, one tap from returning — this interrupts an automatic behaviour, it
 * does not lock anyone out.
 */
function leaveTheFeed(destination: string = BREAK_DESTINATION): void {
  hideOverlay();
  goTo(destination);
}

/**
 * The break currently running, held in memory.
 *
 * Cached rather than read per heartbeat. The check runs every second on the
 * page the user is scrolling, breaks are rare, and an async storage round trip
 * a second to almost always learn "no break" is the kind of cost that does not
 * look like much until it is measured. Kept fresh by the storage listener
 * below, which is how the state changes in the first place.
 */
let activeBreak: BreakState | null = null;

async function refreshBreak(): Promise<void> {
  try {
    const { [BREAK_KEY]: stored } = await chrome.storage.local.get(BREAK_KEY);
    activeBreak = isBreakState(stored) ? stored : null;
  } catch {
    activeBreak = null;
  }
}

/**
 * Notices the reels feed reappearing while a break is running.
 *
 * This is the only place the ladder is measured by behaviour rather than by
 * which button someone pressed: a break that is never cut short held, and one
 * that is did not. Checked on the heartbeat because Instagram is a single-page
 * app — navigating back to /reels/ fires no load event.
 */
function checkBreak(now: number): void {
  if (isOverlayShowing() || !isReelsSurface(location.pathname)) return;
  if (!shouldRemind(activeBreak, now) || !activeBreak) return;

  showBreakReminder({
    state: activeBreak,
    now,
    onKeep: () => leaveTheFeed(),
    onEnd: () => {
      syncDwellClock();
      activeBreak = null;
      void chrome.runtime
        .sendMessage({ type: 'END_BREAK', payload: { early: true } })
        .catch(() => {
          // The break lapses on its own at endsAt either way; only the record
          // of it having been cut short is lost.
        });
    },
  });

  syncDwellClock(now);
}

function start(): void {
  // One of the three lines that log without the debug panel on, and none of
  // them carry anything you watched — this one, the container count below, and
  // the tracking-state line. Extraction degrades to nulls rather than
  // throwing, so without this a broken content script and a quiet page look
  // identical in the console, with no way to confirm the script even injected.
  console.log('[Doomscroll] content script loaded on', location.pathname);

  let loggedFirstScan = false;
  const heartbeat = setInterval(() => {
    if (!observing) return;
    const now = Date.now();
    ensureObservationTargets(now);

    if (!loggedFirstScan) {
      loggedFirstScan = true;
      const count = findReelContainers().length;
      // The single most useful diagnostic line: zero containers on a reels
      // page means the selectors no longer match Instagram's current markup.
      console.log(`[Doomscroll] found ${count} reel container(s) on this scan`);
    }

    syncActiveReel(now);
    reconcileActiveReel(now);
    checkBreak(now);
    // Cheap, and the only thing that notices an overlay being dismissed by a
    // path that does not route through here.
    syncDwellClock(now);
  }, HEARTBEAT_MS);

  document.addEventListener('visibilitychange', () => syncDwellClock());

  // React to the pause switch being flipped from the popup or options page,
  // in every open Instagram tab, without needing a reload.
  // One read at startup; the listener below keeps it current from there. A
  // tab opened mid-break has to learn about it somehow.
  void refreshBreak();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[SETTINGS_KEY]) void applyTrackingSetting();
    // A break started in this tab, or in another one — either way this tab
    // should honour it, which is the point of keeping the state in storage
    // rather than in the page.
    if (changes[BREAK_KEY]) {
      const next = changes[BREAK_KEY].newValue;
      activeBreak = isBreakState(next) ? next : null;
    }
  });

  // The one message that arrives rather than leaves. Everything else in this
  // file reports outward; interruptions are decided in the worker, which owns
  // the history and the cooldowns, and only the rendering happens here.
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    if (message?.type !== 'INTERVENE') return false;

    // Nothing is shown over a paused tracker: the user has already said they
    // do not want this extension acting right now.
    if (!observing || isOverlayShowing()) {
      sendResponse({ ok: true, data: { shown: false } });
      return false;
    }

    const { id, level, category, streak } = message.payload;
    if (level === 'notify') {
      // Notifications are raised by the worker; nothing to render here.
      sendResponse({ ok: true, data: { shown: false } });
      return false;
    }

    showOverlay({
      level,
      category,
      streak,
      onDismiss: (userAction) => {
        syncDwellClock();
        void (async () => {
          // Accepting has to produce the thing the button names. Closing the
          // overlay and handing the feed straight back made "Take a break" a
          // label for nothing, and made the effectiveness figures meaningless
          // — both buttons did the same thing, so the log could only report
          // which one was nicer to press.
          //
          // Each step is caught on its own, and the navigation happens either
          // way. Gating it behind the two reports would put the substantive
          // half of the feature behind the failure of the bookkeeping about
          // it: a worker that could not be reached would leave the user on the
          // feed, having just asked to leave it.
          let goTo: string | undefined;

          try {
            await chrome.runtime.sendMessage({
              type: 'INTERVENTION_DISMISSED',
              payload: { id, userAction },
            });
          } catch {
            // The record stays 'pending', which is the honest outcome for a
            // response that never made it back.
          }

          if (userAction !== 'accepted') return;

          try {
            const started = await chrome.runtime.sendMessage({
              type: 'START_BREAK',
              payload: { id },
            });
            goTo = started?.data?.goTo;
          } catch {
            // No stored break, so no reminder and no observation — but the
            // break itself still happens, because leaving is what makes it one.
          }

          leaveTheFeed(goTo);
        })();
      },
    });

    // Immediately, rather than waiting up to a heartbeat: the prompt pauses
    // the video, and the reel underneath must stop banking time with it.
    syncDwellClock();

    sendResponse({ ok: true, data: { shown: true } });
    return false;
  });

  // pagehide fires for bfcache navigations where beforeunload does not.
  window.addEventListener('pagehide', () => {
    unloaded = true;
    tracker.flush(Date.now());
    stopObserving();
    clearInterval(heartbeat);
  });

  void applyTrackingSetting();
}

start();
