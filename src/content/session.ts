// Session identity for reel events.
//
// A session is a continuous stretch of scrolling; a gap longer than the
// threshold starts a new one. State lives in chrome.storage.local rather than
// in the content script so it survives Instagram's SPA navigations and is
// shared across tabs — a per-tab counter would split one scrolling session
// into several the moment the user opened a reel in a new tab.
//
// This is a deliberately small, self-contained use of chrome.storage. The
// IndexedDB layer that owns reel events and aggregates lands in Phase 3, and
// may take session bookkeeping over with it.

import { getSettings } from '@shared/settings.js';

const SESSION_KEY = 'doomscroll:session';

interface SessionState {
  id: string;
  lastActivityAt: number;
}

function isSessionState(value: unknown): value is SessionState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SessionState>;
  return typeof candidate.id === 'string' && typeof candidate.lastActivityAt === 'number';
}

/**
 * The session id to attach to a reel event, extending the current session or
 * starting a new one if the user has been away longer than the gap threshold.
 *
 * Concurrent tabs can race here and briefly mint two ids for what is really
 * one session. That splits a session rather than corrupting anything, and is
 * not worth a lock for a single-user local tool.
 */
export async function currentSessionId(now: number, gapThresholdMs?: number): Promise<string> {
  // Read from settings when not supplied, so changing the threshold in
  // options actually affects where sessions get split.
  const gapMs = gapThresholdMs ?? (await getSettings()).sessionGapThresholdMs;

  let stored: unknown;
  try {
    ({ [SESSION_KEY]: stored } = await chrome.storage.local.get(SESSION_KEY));
  } catch {
    // Extension context invalidated mid-reload; a fresh id is the safe answer.
    return crypto.randomUUID();
  }

  const previous = isSessionState(stored) ? stored : null;
  const expired = !previous || now - previous.lastActivityAt > gapMs;
  const id = expired ? crypto.randomUUID() : previous.id;

  const next: SessionState = { id, lastActivityAt: now };
  try {
    await chrome.storage.local.set({ [SESSION_KEY]: next });
  } catch {
    // Losing the write only risks an early session split on the next event.
  }

  return id;
}
