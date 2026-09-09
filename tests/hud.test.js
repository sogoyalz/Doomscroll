import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isHudMounted, mountHud, pushHudRow, unmountHud } from '../src/content/hud.ts';
import { BRIDGE_STATUS_ATTR } from '../src/content/dom.ts';

function reel(overrides = {}) {
  return {
    shortcode: 'SYNTH-00001',
    identity: 'SYNTH-00001',
    captionText: 'a caption',
    hashtags: ['fyp'],
    audioName: 'Sample Artist · Sample Track',
    authorHandle: 'samplecreator',
    shortcodeSource: 'fiber',
    audioChannel: 'href-reels-audio',
    ...overrides,
  };
}

/** The panel's rendered text, as the person running a session would read it. */
function panelText() {
  const host = document.getElementById('doomscroll-hud');
  return host?.shadowRoot?.textContent ?? '';
}

beforeEach(() => {
  document.documentElement.removeAttribute(BRIDGE_STATUS_ATTR);
});

afterEach(() => {
  unmountHud();
});

describe('mountHud', () => {
  it('renders into a shadow root so Instagram styles cannot reach it', () => {
    mountHud();
    const host = document.getElementById('doomscroll-hud');
    expect(host?.shadowRoot).toBeTruthy();
  });

  it('attaches to documentElement, not body', () => {
    // Instagram re-renders body's children aggressively, and a node it does
    // not own is a node it may remove.
    mountHud();
    expect(document.getElementById('doomscroll-hud')?.parentElement).toBe(
      document.documentElement,
    );
  });

  it('is idempotent — flipping the setting twice leaves one panel', () => {
    mountHud();
    mountHud();
    expect(document.querySelectorAll('#doomscroll-hud')).toHaveLength(1);
  });

  it('removes itself cleanly', () => {
    mountHud();
    unmountHud();
    expect(isHudMounted()).toBe(false);
    expect(document.getElementById('doomscroll-hud')).toBeNull();
  });
});

describe('pushHudRow', () => {
  it('shows the reel identity and the channel that produced it', () => {
    mountHud();
    pushHudRow(reel(), 4200);
    expect(panelText()).toContain('SYNTH-00001');
    expect(panelText()).toContain('fiber');
  });

  it('surfaces a derived identity as a fallback', () => {
    // The signal a live session exists to catch: tracking still works, but
    // identity has quietly stopped surviving CDN rotation.
    mountHud();
    pushHudRow(reel({ shortcode: null, identity: 'creator|abc.mp4', shortcodeSource: 'fallback' }), 3000);
    expect(panelText()).toContain('fallback');
    expect(panelText()).toContain('creator|abc.mp4');
  });

  it('names the audio channel alongside the track', () => {
    mountHud();
    pushHudRow(reel(), 3000);
    expect(panelText()).toContain('href-reels-audio');
  });

  it('marks a reel with no audio rather than leaving the row blank', () => {
    mountHud();
    pushHudRow(reel({ audioName: null, audioChannel: null }), 3000);
    expect(panelText()).toContain('audio: —');
  });

  it('reports the bridge status', () => {
    document.documentElement.setAttribute(BRIDGE_STATUS_ATTR, 'no-fiber');
    mountHud();
    pushHudRow(reel(), 3000);
    expect(panelText()).toContain('no-fiber');
  });

  it('keeps counting while unmounted so the total is not restarted', async () => {
    // Turning the panel on mid-session should show the session so far, not
    // start from zero. The count lives for the life of the page, so this
    // needs a freshly-loaded module to stand in for a fresh page.
    vi.resetModules();
    const hud = await import('../src/content/hud.ts');

    hud.pushHudRow(reel(), 3000);
    hud.pushHudRow(reel(), 3000);
    hud.mountHud();
    expect(panelText()).toContain('reels: 2');
    hud.unmountHud();
  });

  it('caps the visible history rather than growing without bound', () => {
    mountHud();
    for (let i = 0; i < 20; i++) pushHudRow(reel({ identity: `reel-${i}` }), 3000);
    expect(panelText()).toContain('reel-19');
    expect(panelText()).not.toContain('reel-0');
  });

  it('renders a caption as text, never as markup', () => {
    // Captions are scraped from instagram.com and are attacker-controlled.
    // The panel shows a character count rather than the caption itself, but
    // the identity and author are rendered — and those come from the page too.
    mountHud();
    pushHudRow(reel({ identity: '<img src=x onerror=alert(1)>' }), 3000);
    const shadow = document.getElementById('doomscroll-hud').shadowRoot;
    expect(shadow.querySelector('img')).toBeNull();
    expect(panelText()).toContain('<img src=x onerror=alert(1)>');
  });

  it('does nothing harmful when the panel is not mounted', () => {
    expect(() => pushHudRow(reel(), 3000)).not.toThrow();
  });
});
