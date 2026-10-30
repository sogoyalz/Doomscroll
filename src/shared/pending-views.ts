import type { NewReelEvent } from './types.js';

export const PENDING_VIEW_PREFIX = 'doomscroll:pendingView:';
export const PENDING_VIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const DISCARD_VIEWS_BEFORE_KEY = 'doomscroll:discardViewsBefore';

/** Validate persisted messages before they can reach classification or storage. */
export function isNewReelEvent(value: unknown): value is NewReelEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<NewReelEvent>;
  const boundedString = (s: unknown, max: number) =>
    typeof s === 'string' && s.length > 0 && s.length <= max;
  const nullableText = (s: unknown, max: number) =>
    s == null || (typeof s === 'string' && s.length <= max);
  return (
    boundedString(e.id, 256) &&
    boundedString(e.sessionId, 256) &&
    boundedString(e.reelShortcode, 2048) &&
    typeof e.startedAt === 'number' &&
    Number.isFinite(e.startedAt) &&
    e.startedAt >= 0 &&
    typeof e.endedAt === 'number' &&
    Number.isFinite(e.endedAt) &&
    e.endedAt >= e.startedAt &&
    typeof e.watchDurationMs === 'number' &&
    Number.isFinite(e.watchDurationMs) &&
    e.watchDurationMs >= 0 &&
    e.watchDurationMs <= 600_000 &&
    e.watchDurationMs <= e.endedAt - e.startedAt &&
    nullableText(e.captionText, 30_000) &&
    nullableText(e.audioName, 4000) &&
    nullableText(e.authorHandle, 256) &&
    Array.isArray(e.hashtags) &&
    e.hashtags.length <= 200 &&
    e.hashtags.every((tag) => boundedString(tag, 512))
  );
}

export async function keepPendingView(event: NewReelEvent): Promise<void> {
  await chrome.storage.local.set({
    [PENDING_VIEW_PREFIX + event.id]: { event, queuedAt: Date.now() },
  });
}

export async function forgetPendingView(id: string): Promise<void> {
  await chrome.storage.local.remove(PENDING_VIEW_PREFIX + id);
}

export async function readPendingViews(now = Date.now()): Promise<NewReelEvent[]> {
  const all = await chrome.storage.local.get(null);
  const valid: NewReelEvent[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(PENDING_VIEW_PREFIX)) continue;
    const pending = value as { event?: unknown; queuedAt?: unknown } | null;
    if (
      pending &&
      typeof pending.queuedAt === 'number' &&
      Number.isFinite(pending.queuedAt) &&
      pending.queuedAt <= now &&
      now - pending.queuedAt <= PENDING_VIEW_MAX_AGE_MS &&
      isNewReelEvent(pending.event) &&
      key === PENDING_VIEW_PREFIX + pending.event.id
    ) {
      valid.push(pending.event);
    } else {
      await chrome.storage.local.remove(key);
    }
  }
  return valid.sort((a, b) => a.startedAt - b.startedAt);
}

export async function clearPendingViews(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(PENDING_VIEW_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}
