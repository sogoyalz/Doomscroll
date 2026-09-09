import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  hideOverlay,
  isOverlayShowing,
  showBreakReminder,
  showOverlay,
} from '../src/content/overlay.ts';

function shadow() {
  return document.getElementById('doomscroll-overlay')?.shadowRoot ?? null;
}

function buttonLabelled(match) {
  return [...(shadow()?.querySelectorAll('button') ?? [])].find((b) => match.test(b.textContent));
}

const show = (over = {}) => {
  const onDismiss = vi.fn();
  showOverlay({ level: 'overlay', category: 'sad', streak: 12, onDismiss, ...over });
  return onDismiss;
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  hideOverlay();
  vi.useRealTimers();
});

describe('showOverlay', () => {
  it('renders in a shadow root attached to documentElement', () => {
    show();
    expect(shadow()).toBeTruthy();
    expect(document.getElementById('doomscroll-overlay').parentElement).toBe(
      document.documentElement,
    );
  });

  it('pauses whatever is playing behind it', () => {
    // An overlay over a still-running reel is the worst of both.
    const video = document.createElement('video');
    const pause = vi.fn();
    video.pause = pause;
    document.body.append(video);

    show();
    expect(pause).toHaveBeenCalled();
  });

  it('survives a video that refuses to pause', () => {
    const video = document.createElement('video');
    video.pause = () => {
      throw new Error('not yours to control');
    };
    document.body.append(video);

    expect(() => show()).not.toThrow();
    expect(isOverlayShowing()).toBe(true);
  });

  it('does not stack a second overlay over the first', () => {
    show();
    show();
    expect(document.querySelectorAll('#doomscroll-overlay')).toHaveLength(1);
  });
});

describe('copy discipline', () => {
  it('describes the feed, never the person', () => {
    show();
    const text = shadow().textContent;
    expect(text).toContain('reels in a row');
    // The data cannot support a claim about how the viewer feels, and saying
    // so anyway would be a guess delivered as a finding.
    expect(text).not.toMatch(/\byou (are|seem|feel|look)\b/i);
  });

  it('names the count and the category of content', () => {
    show({ category: 'breakup', streak: 14 });
    expect(shadow().textContent).toContain('14');
    expect(shadow().textContent).toContain('breakup content');
  });

  it('falls back to a neutral phrase when no category resolved', () => {
    show({ category: null });
    expect(shadow().textContent).toContain('the same kind of content');
  });

  it('renders a category as text, never as markup', () => {
    // The category is derived from scraped captions.
    show({ category: '<img src=x onerror=alert(1)>' });
    expect(shadow().querySelector('img')).toBeNull();
  });
});

describe('dismissal', () => {
  it('reports taking a break', () => {
    const onDismiss = show();
    buttonLabelled(/Take a break/).click();
    expect(onDismiss).toHaveBeenCalledWith('accepted');
    expect(isOverlayShowing()).toBe(false);
  });

  it('reports carrying on', () => {
    const onDismiss = show();
    buttonLabelled(/Keep scrolling/).click();
    expect(onDismiss).toHaveBeenCalledWith('bypassed');
  });

  it('lets the overlay level be dismissed immediately', () => {
    show({ level: 'overlay' });
    expect(buttonLabelled(/Keep scrolling/).disabled).toBe(false);
  });
});

describe('the block level is a delay, never a lock', () => {
  it('withholds the exit at first, and counts down visibly', () => {
    // A disabled button with no explanation reads as broken; the point is
    // friction, not confusion.
    show({ level: 'block' });
    const keep = buttonLabelled(/Keep scrolling/);
    expect(keep.disabled).toBe(true);
    expect(keep.textContent).toMatch(/\(\d+\)/);
  });

  it('always returns the exit', () => {
    // The guarantee: a soft block delays leaving, it never removes the option.
    // Locking someone out on the strength of a keyword classifier would be a
    // trust and store-review liability.
    const onDismiss = show({ level: 'block' });
    vi.advanceTimersByTime(11_000);

    const keep = buttonLabelled(/Keep scrolling/);
    expect(keep.disabled).toBe(false);
    keep.click();
    expect(onDismiss).toHaveBeenCalledWith('bypassed');
  });

  it('ignores clicks while the exit is still withheld', () => {
    const onDismiss = show({ level: 'block' });
    buttonLabelled(/Keep scrolling/).click();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('offers the break immediately even while blocking', () => {
    const onDismiss = show({ level: 'block' });
    buttonLabelled(/Take a break/).click();
    expect(onDismiss).toHaveBeenCalledWith('accepted');
  });

  it('says plainly that continuing is possible', () => {
    show({ level: 'block' });
    expect(shadow().textContent).toContain('You can always continue');
  });
});

describe('hideOverlay', () => {
  it('removes the panel and stops its timer', () => {
    show({ level: 'block' });
    hideOverlay();
    expect(document.getElementById('doomscroll-overlay')).toBeNull();
    // A surviving interval would keep ticking against a detached node.
    expect(() => vi.advanceTimersByTime(20_000)).not.toThrow();
  });

  it('is safe to call when nothing is showing', () => {
    expect(() => hideOverlay()).not.toThrow();
  });
});

describe('the break reminder', () => {
  const state = { startedAt: 0, endsAt: 15 * 60_000, interventionId: 'i1' };

  const remind = (over = {}) => {
    const onKeep = vi.fn();
    const onEnd = vi.fn();
    showBreakReminder({ state, now: 0, onKeep, onEnd, ...over });
    return { onKeep, onEnd };
  };

  it('says how much of the break is left', () => {
    remind({ now: 10 * 60_000 });
    expect(shadow().textContent).toContain('5 minutes left');
  });

  it('reads sensibly with a minute to go', () => {
    remind({ now: 14 * 60_000 + 30_000 });
    expect(shadow().textContent).toContain('1 minute left');
  });

  it('does not claim time that has run out', () => {
    remind({ now: 15 * 60_000 });
    expect(shadow().textContent).toContain('just about run out');
  });

  it('offers both ways out on equal terms', () => {
    // The user already agreed to this break, so the job is to remind, not to
    // argue — there is no withheld button here.
    remind();
    const buttons = [...shadow().querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => !b.disabled)).toBe(true);
  });

  it('keeps the break', () => {
    const { onKeep, onEnd } = remind();
    buttonLabelled(/Keep the break/).click();
    expect(onKeep).toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(isOverlayShowing()).toBe(false);
  });

  it('ends the break when that is what the user wants', () => {
    // A legitimate answer, recorded as one rather than treated as a failure.
    const { onKeep, onEnd } = remind();
    buttonLabelled(/End it/).click();
    expect(onEnd).toHaveBeenCalled();
    expect(onKeep).not.toHaveBeenCalled();
  });

  it('pauses the reel behind it', () => {
    const video = document.createElement('video');
    const pause = vi.fn();
    video.pause = pause;
    document.body.append(video);
    remind();
    expect(pause).toHaveBeenCalled();
  });

  it('does not stack on top of an interruption already showing', () => {
    showOverlay({ level: 'overlay', category: 'sad', streak: 12, onDismiss: vi.fn() });
    remind();
    expect(document.querySelectorAll('#doomscroll-overlay')).toHaveLength(1);
    // The interruption is the one on screen, not the reminder.
    expect(shadow().textContent).toContain('locked onto one thing');
  });
});
