import { beforeEach, describe, expect, it } from 'vitest';
import { syncLayoutWarning } from '../src/content/layout-warning.ts';

beforeEach(() => {
  document.body.innerHTML = '';
  document.getElementById('reel-layout-notice')?.remove();
});

describe('layout warning', () => {
  it('appears when reel identity cannot be read and leaves no product name in the page', () => {
    syncLayoutWarning(true);
    const host = document.getElementById('reel-layout-notice');
    expect(host?.shadowRoot?.textContent).toContain('counts may be missing');
    expect(document.documentElement.innerHTML.toLowerCase()).not.toContain('doomscroll');
  });

  it('says the counts may be missing', () => {
    syncLayoutWarning(true);
    const host = document.getElementById('reel-layout-notice');
    const text = host.shadowRoot?.textContent ?? '';
    expect(text).toContain('counts may be missing');
  });

  it('goes away when identification works again', () => {
    syncLayoutWarning(true);
    syncLayoutWarning(false);
    expect(document.getElementById('reel-layout-notice')).toBeNull();
  });
});
