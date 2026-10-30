// The MAIN-world shortcode bridge.
//
// Untested until a review pointed out that the file the codebase itself calls
// "the most fragile thing in the extension" was the only non-React module with
// no coverage — and that the gap was hiding a real defect: it published the
// React-rename signal for a container that had simply not hydrated yet.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BRIDGE_STATUS_ATTR,
  SHORTCODE_ATTR,
  SHORTCODE_SRC_ATTR,
  TRACKING_ATTR,
} from '../src/content/dom.ts';

// start() runs on import and installs a MutationObserver plus an interval.
// Assigned directly rather than through vi.stubGlobal, which restores between
// tests and leaves jsdom's own MutationObserver plumbing calling a global that
// no longer exists. Runs the callback inline to keep the tests synchronous.
globalThis.requestAnimationFrame = (cb) => {
  cb(0);
  return 0;
};

const FIBER_KEY = '__reactFiber$abc123';

/**
 * A mounted reel container.
 *
 * `code` undefined  → fiber present, media.code not yet attached (hydrating).
 * `fiber: false`    → no React expando at all (the rename signature).
 */
function container({ code, fiber = true } = {}) {
  const outer = document.createElement('div');
  const player = document.createElement('div');
  player.setAttribute('aria-label', 'Video player');
  const author = document.createElement('a');
  author.setAttribute('aria-label', 'someone reels');
  outer.append(player, author);
  Object.defineProperty(outer, 'clientHeight', { value: 800, configurable: true });
  if (fiber) {
    outer[FIBER_KEY] = { return: null, memoizedProps: code ? { media: { code } } : {} };
  }
  document.body.append(outer);
  return outer;
}

// Imported with tracking already off, so start() binds no MutationObserver
// and schedules no work of its own. Every test below drives tagContainers()
// directly; leaving the observer live meant jsdom kept calling into it after
// the environment had been torn down.
document.documentElement.setAttribute(TRACKING_ATTR, 'off');
const mw = await import('../src/content/main-world.ts');

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(BRIDGE_STATUS_ATTR);
  document.documentElement.setAttribute(TRACKING_ATTR, 'on');
  window.innerHeight = 800;
});

const status = () => document.documentElement.getAttribute(BRIDGE_STATUS_ATTR);

describe('shortcodeFromFiber', () => {
  it('reaches media above a deep video-player component stack', () => {
    const el = container({});
    let node = { memoizedProps: { media: { code: 'DEEPREEL123' } }, return: null };
    for (let i = 0; i < 60; i++) node = { memoizedProps: {}, return: node };
    const video = document.createElement('video');
    video[FIBER_KEY] = node;
    el.querySelector('[aria-label="Video player"]').append(video);
    expect(mw.shortcodeFromFiber(el)).toBe('DEEPREEL123');
  });
  it('finds media props below the measurable geometry wrapper', () => {
    const el = container({});
    const player = el.querySelector('[aria-label="Video player"]');
    player[FIBER_KEY] = {
      memoizedProps: {},
      return: {
        memoizedProps: { media: { code: 'PLAYER12345' } },
        return: el[FIBER_KEY],
      },
    };
    expect(mw.shortcodeFromFiber(el)).toBe('PLAYER12345');
  });

  it('prefers the media leaf over stale wrapper props', () => {
    const el = container({ code: 'OLDWRAPPER1' });
    const video = document.createElement('video');
    video[FIBER_KEY] = { memoizedProps: { media: { code: 'NEWVIDEO123' } }, return: null };
    el.querySelector('[aria-label="Video player"]').append(video);
    expect(mw.shortcodeFromFiber(el)).toBe('NEWVIDEO123');
  });
  it('reads media.code off the container fiber', () => {
    const el = container({ code: 'Dbv6giIR-kt' });
    expect(mw.shortcodeFromFiber(el)).toBe('Dbv6giIR-kt');
  });

  it('walks up the fiber tree to find it', () => {
    const el = container({});
    el[FIBER_KEY] = {
      memoizedProps: {},
      return: { memoizedProps: { media: { code: 'UpTheTree1' } }, return: null },
    };
    expect(mw.shortcodeFromFiber(el)).toBe('UpTheTree1');
  });

  it('returns null when there is no React expando at all', () => {
    expect(mw.shortcodeFromFiber(container({ fiber: false }))).toBe(null);
  });

  it('gives up rather than walking forever', () => {
    const el = container({});
    // A cycle would hang the page it is running on.
    const node = { memoizedProps: {}, return: null };
    node.return = node;
    el[FIBER_KEY] = node;
    expect(mw.shortcodeFromFiber(el)).toBe(null);
  });
});

describe('tagContainers republishes the shortcode', () => {
  it('writes the code and marks it fiber-derived', () => {
    const el = container({ code: 'Dbv6giIR-kt' });
    mw.tagContainers();
    expect(el.getAttribute(SHORTCODE_ATTR)).toBe('Dbv6giIR-kt');
    expect(el.getAttribute(SHORTCODE_SRC_ATTR)).toBe('fiber');
  });

  it('never blanks a good value when a later pass resolves nothing', () => {
    const el = container({ code: 'Dbv6giIR-kt' });
    mw.tagContainers();
    delete el[FIBER_KEY];
    mw.tagContainers();
    // The reel is still on screen; losing its identity would split the view.
    expect(el.getAttribute(SHORTCODE_ATTR)).toBe('Dbv6giIR-kt');
  });
});

describe('what the bridge reports, and what it means', () => {
  it('says ok when a code resolves', () => {
    container({ code: 'Dbv6giIR-kt' });
    mw.tagContainers();
    expect(status()).toBe('ok');
  });

  it('says ok when only some containers resolve', () => {
    // Placeholders never resolve. A partial resolve is the normal state.
    container({ code: 'Dbv6giIR-kt' });
    container({});
    mw.tagContainers();
    expect(status()).toBe('ok');
  });

  it('says no-fiber ONLY when React carries no expando anywhere', () => {
    container({ fiber: false });
    container({ fiber: false });
    mw.tagContainers();
    expect(status()).toBe('no-fiber');
  });

  it('says no-code — not no-fiber — while containers are still hydrating', () => {
    // The defect this file was written for. A mounted container whose fiber
    // exists but has no media.code yet is the ordinary state at page load and
    // when a fresh batch mounts mid-scroll. Publishing 'no-fiber' for it fed
    // isShortcodeDegraded, which treats that value as conclusive with no
    // sample guard, so one badly-timed reel raised "Reels aren't being
    // identified reliably" on a perfectly healthy feed.
    container({});
    container({});
    mw.tagContainers();
    expect(status()).toBe('no-code');
  });

  it('says nothing at all on a page with no reels', () => {
    mw.tagContainers();
    expect(status()).toBe(null);
  });
});

describe('pausing tracking stops the bridge', () => {
  // The options page promises "nothing is observed at all — the extension
  // stops watching the page". This script had no lifecycle controls of any
  // kind and kept walking React fiber and writing attributes into Instagram's
  // DOM regardless of the switch.
  it('does not read or write anything while tracking is off', () => {
    document.documentElement.setAttribute(TRACKING_ATTR, 'off');
    const el = container({ code: 'Dbv6giIR-kt' });

    mw.tagContainers();

    expect(el.getAttribute(SHORTCODE_ATTR)).toBe(null);
    expect(status()).toBe(null);
  });

  it('resumes when tracking is switched back on', () => {
    document.documentElement.setAttribute(TRACKING_ATTR, 'off');
    const el = container({ code: 'Dbv6giIR-kt' });
    mw.tagContainers();

    document.documentElement.setAttribute(TRACKING_ATTR, 'on');
    mw.tagContainers();

    expect(el.getAttribute(SHORTCODE_ATTR)).toBe('Dbv6giIR-kt');
  });

  it('waits for the saved tracking setting before reading the page', () => {
    document.documentElement.removeAttribute(TRACKING_ATTR);
    const el = container({ code: 'Dbv6giIR-kt' });
    mw.tagContainers();
    expect(el.getAttribute(SHORTCODE_ATTR)).toBeNull();
  });
});
