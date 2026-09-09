// The content script's half of an interruption.
//
// Untested until "Take a break" was put behind two messages whose failure
// skipped the navigation — leaving the user on the feed they had just asked to
// leave. That is the same shape as the write-path bug the router had: a side
// effect gated behind the bookkeeping about it.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const nav = vi.hoisted(() => ({ goTo: vi.fn() }));
vi.mock('../src/content/navigate.ts', () => nav);

// The dwell clock, made observable. The reel behind an overlay is still the
// one at the viewport midpoint, so whether it keeps banking time while a
// prompt sits there is a real question about the data this extension records.
const dwell = vi.hoisted(() => ({
  pause: vi.fn(),
  resume: vi.fn(),
  setActive: vi.fn(),
  currentTarget: vi.fn(() => null),
  flush: vi.fn(),
  discard: vi.fn(),
}));
vi.mock('../src/content/detector.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  createDwellTracker: () => dwell,
}));

// jsdom has no IntersectionObserver, and importing the content script starts
// it observing. Nothing here exercises the observer path; this only keeps the
// import from throwing.
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let store = {};
let listener;
let sendMessage;

globalThis.chrome = {
  runtime: {
    onMessage: { addListener: (fn) => { listener = fn; } },
    sendMessage: (...args) => sendMessage(...args),
    getURL: (p) => p,
  },
  storage: {
    local: {
      async get(key) { return key in store ? { [key]: store[key] } : {}; },
      async set(entries) { Object.assign(store, entries); },
      async remove(key) { delete store[key]; },
    },
    onChanged: { addListener() {} },
  },
};

await import('../src/content/index.ts');

const { BREAK_DESTINATION } = await import('../src/shared/break.ts');

function shadow() {
  return document.getElementById('doomscroll-overlay')?.shadowRoot ?? null;
}

function click(match) {
  [...shadow().querySelectorAll('button')].find((b) => match.test(b.textContent)).click();
}

/** Delivers an INTERVENE the way the worker does. */
function intervene(payload = {}) {
  return new Promise((resolve) => {
    listener(
      {
        type: 'INTERVENE',
        payload: { id: 'i1', level: 'overlay', category: 'sad', streak: 12, ...payload },
      },
      {},
      resolve,
    );
  });
}

/** Lets the dismiss handler's promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  store = {};
  nav.goTo.mockReset();
  dwell.pause.mockReset();
  dwell.resume.mockReset();
  sendMessage = vi.fn().mockResolvedValue({ ok: true, data: { goTo: BREAK_DESTINATION } });
  document.getElementById('doomscroll-overlay')?.remove();
});

describe('receiving an interruption', () => {
  it('shows the overlay and reports that it did', async () => {
    expect(await intervene()).toEqual({ ok: true, data: { shown: true } });
    expect(shadow()).toBeTruthy();
  });

  it('renders nothing for the notification level', async () => {
    // The worker raises that one itself; there is nothing for the page to do.
    expect(await intervene({ level: 'notify' })).toEqual({ ok: true, data: { shown: false } });
    expect(shadow()).toBeNull();
  });

  it('ignores anything that is not an interruption', () => {
    expect(listener({ type: 'GET_STATS', payload: {} }, {}, () => {})).toBe(false);
  });
});

describe('taking a break', () => {
  it('leaves the feed', async () => {
    await intervene();
    click(/Take a break/);
    await settle();

    expect(nav.goTo).toHaveBeenCalledWith(BREAK_DESTINATION);
  });

  it('reports the outcome and starts the break', async () => {
    await intervene();
    click(/Take a break/);
    await settle();

    const types = sendMessage.mock.calls.map(([m]) => m.type);
    expect(types).toEqual(['INTERVENTION_DISMISSED', 'START_BREAK']);
  });

  it('still leaves the feed when the worker cannot be reached', async () => {
    // The regression. Navigation is the substantive half of a break; putting
    // it behind the reports about the break meant an unreachable worker left
    // the user exactly where they had asked not to be.
    sendMessage = vi.fn().mockRejectedValue(new Error('receiving end does not exist'));

    await intervene();
    click(/Take a break/);
    await settle();

    expect(nav.goTo).toHaveBeenCalledWith(BREAK_DESTINATION);
  });

  it('falls back to a destination of its own when none comes back', async () => {
    sendMessage = vi.fn().mockResolvedValue(undefined);

    await intervene();
    click(/Take a break/);
    await settle();

    expect(nav.goTo).toHaveBeenCalledWith(BREAK_DESTINATION);
  });
});

describe('keeping scrolling', () => {
  it('records the dismissal and goes nowhere', async () => {
    await intervene();
    click(/Keep scrolling/);
    await settle();

    expect(sendMessage.mock.calls.map(([m]) => m.type)).toEqual(['INTERVENTION_DISMISSED']);
    expect(nav.goTo).not.toHaveBeenCalled();
  });

  it('never starts a break', async () => {
    await intervene();
    click(/Keep scrolling/);
    await settle();

    const started = sendMessage.mock.calls.some(([m]) => m.type === 'START_BREAK');
    expect(started).toBe(false);
  });
});

describe('the dwell clock under a prompt', () => {
  it('stops as soon as a prompt goes up', async () => {
    // A prompt pauses the video and then sits there — ten seconds at the block
    // level, longer while someone decides. Left running, the clock would
    // inflate the watch time of the very reel the extension interrupted.
    await intervene();

    expect(dwell.pause).toHaveBeenCalled();
    expect(dwell.resume).not.toHaveBeenCalled();
  });

  it('restarts once the prompt is answered', async () => {
    await intervene();
    dwell.pause.mockReset();

    click(/Keep scrolling/);
    await settle();

    expect(dwell.resume).toHaveBeenCalled();
  });

  it('does not restart while the page is also hidden', async () => {
    // Two independent reasons to be stopped. Paired pause/resume calls at each
    // site would let whichever resumed first cancel the other — coming back to
    // a background tab would restart the clock with the prompt still up.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    await intervene();
    dwell.pause.mockReset();
    dwell.resume.mockReset();

    document.dispatchEvent(new Event('visibilitychange'));

    expect(dwell.resume).not.toHaveBeenCalled();
    expect(dwell.pause).toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('restarts on returning to a visible page with no prompt up', async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    expect(dwell.resume).toHaveBeenCalled();
  });
});
