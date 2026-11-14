const HOST_ID = 'reel-layout-notice';

/** Shown on the page when React's reel identity can no longer be read. */
export function syncLayoutWarning(broken: boolean): void {
  const existing = document.getElementById(HOST_ID);
  if (!broken) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent =
    ':host{all:initial}div{position:fixed;top:12px;left:12px;z-index:2147483646;max-width:280px;padding:10px 12px;border-radius:10px;background:#1c1917;color:#fafaf9;font:13px/1.4 system-ui,sans-serif}';
  const box = document.createElement('div');
  box.textContent =
    'Reel identification is not working on this layout, so watch counts may be missing.';
  root.append(style, box);
  document.documentElement.append(host);
}
