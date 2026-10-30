// Session identity for reel events.
//
// A session is a continuous stretch of scrolling; a gap longer than the
// threshold starts a new one. State lives in chrome.storage.local rather than
// in the content script so it survives Instagram's SPA navigations and is
// shared across tabs — a per-tab counter would split one scrolling session
// into several the moment the user opened a reel in a new tab.
//
// Only the worker assigns sessions. Requests from different tabs are
// serialized, and the persisted activity stamp survives worker restarts.

import { getSettings } from '@shared/settings.js';
import { createSerialQueue } from '@shared/serial.js';

export const SESSION_KEY = 'doomscroll:session';
const serialize = createSerialQueue();

interface SessionState {
  id: string;
  lastActivityAt: number;
}

function isSessionState(value: unknown): value is SessionState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SessionState>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.lastActivityAt === 'number' &&
    Number.isFinite(candidate.lastActivityAt)
  );
}

/**
 * The session id to attach to a reel event, extending the current session or
 * starting a new one if the user has been away longer than the gap threshold.
 *
 * The inactivity gap is measured before a view starts, so watching a long
 * reel does not itself split a continuously active session.
 */
export function currentSessionId(
  now: number,
  gapThresholdMs?: number,
  startedAt = now,
): Promise<string> {
  return serialize(() => resolveSession(now, gapThresholdMs, startedAt));
}

async function resolveSession(
  now: number,
  gapThresholdMs: number | undefined,
  startedAt: number,
): Promise<string> {
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
  const expired = !previous || startedAt - previous.lastActivityAt > gapMs;
  const id = expired ? crypto.randomUUID() : previous.id;

  const next: SessionState = {
    id,
    lastActivityAt: Math.max(now, previous?.lastActivityAt ?? now),
  };
  try {
    await chrome.storage.local.set({ [SESSION_KEY]: next });
  } catch {
    // Losing the write only risks an early session split on the next event.
  }

  return id;
}
