// The interruption itself.
//
// Copy discipline is load-bearing here, more than anywhere else in the
// extension. Everything this says describes the CONTENT the feed served —
// "the last twelve reels have leaned heavily sad" — and never the person
// watching. The data cannot support "you seem sad", the inference would be
// wrong often enough to be cruel, and a tool that guesses at someone's
// emotional state and tells them about it has earned being uninstalled.
//
// The other rule: this is always dismissible. A soft block delays the exit by
// a few seconds; it never removes it. Locking someone out of an app on the
// strength of a keyword classifier would be both a trust and a store-review
// liability, and the delay captures most of the friction anyway — the point is
// to interrupt an automatic behaviour, not to win an argument.

import { breakRemainingMs, type BreakState } from '@shared/break.js';
import type { InterventionLevel } from '@shared/types.js';

const HOST_ID = 'doomscroll-overlay';

/**
 * How long the block level withholds its dismiss button.
 *
 * Long enough to break the scroll reflex, short enough that someone who
 * genuinely wants to continue is not being punished. This is the entire
 * difference between `overlay` and `block`.
 */
const BLOCK_DISMISS_DELAY_MS = 10_000;

export type DismissAction = 'accepted' | 'bypassed';

interface OverlayOptions {
  level: InterventionLevel;
  category: string | null;
  streak: number;
  onDismiss: (action: DismissAction) => void;
}

let host: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const STYLE = `
  :host { all: initial; }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(8, 8, 10, 0.82);
    backdrop-filter: blur(6px);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card {
    max-width: 380px;
    margin: 24px;
    padding: 28px;
    border-radius: 16px;
    background: #16161a;
    color: #f4f4f6;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    text-align: left;
  }
  h2 { margin: 0 0 10px; font-size: 17px; font-weight: 650; line-height: 1.35; }
  p { margin: 0 0 20px; font-size: 14px; line-height: 1.55; color: #c7c7cf; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; }
  button {
    font: inherit;
    font-size: 14px;
    padding: 10px 16px;
    border-radius: 10px;
    border: 0;
    cursor: pointer;
  }
  .primary { background: #f4f4f6; color: #16161a; font-weight: 600; }
  .secondary { background: transparent; color: #9a9aa4; border: 1px solid #33333c; }
  .secondary[disabled] { opacity: 0.45; cursor: default; }
  .fine { display: block; margin-top: 14px; font-size: 12px; color: #74747e; }
`;

/**
 * Pauses whatever is playing.
 *
 * An overlay over a still-playing reel is the worst of both: the content keeps
 * running behind the thing asking you to stop. Failures are swallowed because
 * Instagram owns these elements and may reject the call.
 */
function pauseVideos(): void {
  for (const video of document.querySelectorAll('video')) {
    try {
      video.pause();
    } catch {
      // Not ours to control; the overlay still stands.
    }
  }
}

/** What the pattern was, in words about the feed. */
function describe(category: string | null, streak: number): string {
  const what = category ? `${category} content` : 'the same kind of content';
  return `The last ${streak} reels in a row have been ${what} — well above what your feed usually serves you.`;
}

export function showOverlay(options: OverlayOptions): void {
  // A second interruption while one is up would stack scrims and leave the
  // page unusable. The one already on screen is the one being answered.
  if (host?.isConnected) return;

  pauseVideos();

  host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLE;

  const scrim = document.createElement('div');
  scrim.className = 'scrim';

  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');

  const heading = document.createElement('h2');
  heading.textContent = 'Your feed has locked onto one thing';

  const body = document.createElement('p');
  // textContent throughout: the category is derived from scraped text.
  body.textContent = describe(options.category, options.streak);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const take = document.createElement('button');
  take.className = 'primary';
  take.textContent = 'Take a break';
  take.addEventListener('click', () => finish(options, 'accepted'));

  const keep = document.createElement('button');
  keep.className = 'secondary';
  keep.addEventListener('click', () => {
    if (!keep.disabled) finish(options, 'bypassed');
  });

  actions.append(take, keep);
  card.append(heading, body, actions);

  if (options.level === 'block') {
    keep.disabled = true;
    let remaining = Math.ceil(BLOCK_DISMISS_DELAY_MS / 1000);
    keep.textContent = `Keep scrolling (${remaining})`;

    // Counts down visibly rather than sitting inert: a disabled button with no
    // explanation reads as broken, and the point is friction, not confusion.
    timer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        keep.textContent = `Keep scrolling (${remaining})`;
        return;
      }
      keep.disabled = false;
      keep.textContent = 'Keep scrolling';
      clearTimer();
    }, 1000);

    const fine = document.createElement('span');
    fine.className = 'fine';
    fine.textContent = 'You can always continue — this just adds a few seconds.';
    card.append(fine);
  } else {
    keep.textContent = 'Keep scrolling';
  }

  scrim.append(card);
  root.append(style, scrim);
  // documentElement, not body: Instagram re-renders body's children and would
  // eventually remove a node it does not own.
  document.documentElement.append(host);

  take.focus();
}

function clearTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function finish(options: OverlayOptions, action: DismissAction): void {
  hideOverlay();
  options.onDismiss(action);
}

export function hideOverlay(): void {
  clearTimer();
  host?.remove();
  host = null;
}

export function isOverlayShowing(): boolean {
  return Boolean(host?.isConnected);
}

/**
 * The reminder shown when the reels feed reappears during a break.
 *
 * Softer than an interruption by design: the user already agreed to this, so
 * the job is to remind, not to argue. Both ways out are equal — there is no
 * withheld button here, and "I'm done with the break" is a legitimate answer
 * that gets recorded as one rather than treated as a failure.
 */
export function showBreakReminder(options: {
  state: BreakState;
  now: number;
  onKeep: () => void;
  onEnd: () => void;
}): void {
  if (host?.isConnected) return;

  pauseVideos();

  host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLE;

  const scrim = document.createElement('div');
  scrim.className = 'scrim';

  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');

  const heading = document.createElement('h2');
  heading.textContent = 'You asked for a break';

  const minutes = Math.ceil(breakRemainingMs(options.state, options.now) / 60_000);
  const body = document.createElement('p');
  body.textContent =
    minutes > 0
      ? `About ${minutes} minute${minutes === 1 ? '' : 's'} left of it.`
      : 'It has just about run out.';

  const actions = document.createElement('div');
  actions.className = 'actions';

  const keep = document.createElement('button');
  keep.className = 'primary';
  keep.textContent = 'Keep the break';
  keep.addEventListener('click', () => {
    hideOverlay();
    options.onKeep();
  });

  const end = document.createElement('button');
  end.className = 'secondary';
  end.textContent = 'End it, I’m good';
  end.addEventListener('click', () => {
    hideOverlay();
    options.onEnd();
  });

  actions.append(keep, end);
  card.append(heading, body, actions);
  scrim.append(card);
  root.append(style, scrim);
  document.documentElement.append(host);

  keep.focus();
}
