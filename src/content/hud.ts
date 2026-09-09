// On-page diagnostic panel for live validation sessions.
//
// The capture path degrades to nulls rather than throwing, so a broken
// selector and a quiet feed produce identical output: nothing. Unit tests
// cover the DOM shapes we know about, but the shapes we do not know about are
// precisely the ones that break in production, and the only way to find them
// is to watch a real session and see what fails to resolve.
//
// This is a diagnostic surface, not a feature: it renders only while
// `debugHud` is on, and it must never affect what gets recorded. It reads
// state that was captured anyway and displays it. See
// docs/live-session-protocol.md for the session it exists to support.

import { bridgeStatus } from './dom.js';
import type { ExtractedReel } from './extractor.js';

/**
 * Rendered inside a shadow root so Instagram's stylesheet cannot reach it and
 * it cannot reach Instagram's. Open rather than closed: nothing here is
 * sensitive, and an inspectable panel is easier to debug than a sealed one.
 */
const HOST_ID = 'doomscroll-hud';

/** Recent reels shown. Enough to see a pattern, short enough to stay small. */
const HISTORY_LIMIT = 5;

interface HudRow {
  identity: string;
  source: string;
  captionChars: number;
  hashtags: number;
  audio: string;
  author: string;
  durationMs: number;
}

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let body: HTMLElement | null = null;
let sessionReels = 0;
const history: HudRow[] = [];

const STYLE = `
  :host { all: initial; }
  .panel {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 2147483647;
    width: 320px;
    max-height: 60vh;
    overflow: auto;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(10, 10, 12, 0.92);
    color: #f2f2f4;
    font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }
  .title { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.7; }
  .summary { margin: 6px 0 8px; }
  .row { padding: 5px 0; border-top: 1px solid rgba(255, 255, 255, 0.12); }
  .id { font-weight: 700; word-break: break-all; }
  .muted { opacity: 0.62; }
  .bad { color: #ff8a80; }
  .good { color: #9ae6a0; }
`;

/** Creates the panel. Idempotent — safe to call whenever the setting flips. */
export function mountHud(): void {
  if (host?.isConnected) return;

  host = document.createElement('div');
  host.id = HOST_ID;
  root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLE;

  const panel = document.createElement('div');
  panel.className = 'panel';

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'Doomscroll HUD';

  body = document.createElement('div');

  panel.append(title, body);
  root.append(style, panel);

  // documentElement rather than body: Instagram re-renders body's children
  // aggressively, and a node it does not own is a node it may remove.
  document.documentElement.append(host);
  render();
}

export function unmountHud(): void {
  host?.remove();
  host = null;
  root = null;
  body = null;
}

export function isHudMounted(): boolean {
  return Boolean(host?.isConnected);
}

/**
 * Records one finished view for display.
 *
 * Counting happens whether or not the panel is mounted, so turning the HUD on
 * mid-session shows a running total rather than restarting from zero.
 */
export function pushHudRow(reel: ExtractedReel, watchDurationMs: number): void {
  sessionReels++;
  history.unshift({
    identity: reel.identity,
    source: reel.shortcodeSource,
    captionChars: reel.captionText?.length ?? 0,
    hashtags: reel.hashtags.length,
    audio: reel.audioName ? `${reel.audioName} (${reel.audioChannel ?? '?'})` : '—',
    author: reel.authorHandle ?? '—',
    durationMs: watchDurationMs,
  });
  history.length = Math.min(history.length, HISTORY_LIMIT);
  render();
}

function render(): void {
  if (!body) return;

  const status = bridgeStatus();
  const fallbacks = history.filter((r) => r.source === 'fallback').length;

  body.replaceChildren(
    line('summary', [
      text(`reels: ${sessionReels}`),
      text('  bridge: '),
      badge(status, status === 'ok'),
      text(`  fallback: ${fallbacks}/${history.length}`),
    ]),
    ...history.map(renderRow),
  );
}

function renderRow(row: HudRow): HTMLElement {
  const el = document.createElement('div');
  el.className = 'row';

  const id = document.createElement('div');
  id.className = 'id';
  id.append(text(row.identity), text(' '), badge(row.source, row.source === 'fiber'));

  const detail = document.createElement('div');
  detail.className = 'muted';
  detail.textContent =
    `@${row.author} · ${Math.round(row.durationMs / 100) / 10}s · ` +
    `caption ${row.captionChars}c · tags ${row.hashtags}`;

  const audio = document.createElement('div');
  audio.className = 'muted';
  audio.textContent = `audio: ${row.audio}`;

  el.append(id, detail, audio);
  return el;
}

function line(className: string, children: Node[]): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.append(...children);
  return el;
}

/** textContent-only nodes throughout — captions are attacker-controlled. */
function text(value: string): Text {
  return document.createTextNode(value);
}

function badge(label: string, ok: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = ok ? 'good' : 'bad';
  el.textContent = label;
  return el;
}
