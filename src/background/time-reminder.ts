import {
  addActiveTime,
  readTimeBudget,
  SAMPLE_MS,
  SNOOZE_MS,
  TIME_REMINDER_KEY,
} from '@shared/time-reminder.js';
import { showDesktopNotification } from '@shared/desktop-notification.js';
import { isBreakActive } from '@shared/break.js';
import { DISCARD_VIEWS_BEFORE_KEY } from '@shared/pending-views.js';
import { getSettings } from '@shared/settings.js';
import { beginBreak, readBreak } from './intervene.js';

export async function tickBudget(tabId: number, start: number, end: number): Promise<void> {
  const now = Date.now();
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > SAMPLE_MS * 2 ||
    end > now ||
    now - end > SAMPLE_MS * 2
  )
    return;
  const settings = await getSettings();
  if (!settings.trackingEnabled || !settings.timeReminderMinutes) return;
  if (isBreakActive(await readBreak(), now)) return;
  const data = await chrome.storage.local.get([TIME_REMINDER_KEY, DISCARD_VIEWS_BEFORE_KEY]);
  const cutoff = data[DISCARD_VIEWS_BEFORE_KEY];
  if (typeof cutoff === 'number' && start < cutoff) return;
  const state = addActiveTime(
    readTimeBudget(data[TIME_REMINDER_KEY]),
    settings.timeReminderMinutes,
    settings.sessionGapThresholdMs,
    start,
    end,
  );
  const due = state.spentMs >= state.targetMs && !state.delivered;
  if (due) state.reminderId ??= crypto.randomUUID();
  await chrome.storage.local.set({ [TIME_REMINDER_KEY]: state });
  if (!due || !state.reminderId) return;
  // Recheck the originating document after waiting in the history queue.
  const ready = await chrome.tabs
    .sendMessage(tabId, { type: 'TIME_REMINDER_READY' })
    .catch(() => false);
  if (ready !== true) return;
  const minutes = Math.round(state.targetMs / 60000);
  const result = await showDesktopNotification(
    'Time for your Reels break?',
    `You reached ${minutes} minute${minutes === 1 ? '' : 's'} of active Reel time. Open Doomscroll to snooze for five minutes.`,
    state.reminderId,
  );
  if (result !== 'accepted') {
    const shown = await chrome.tabs
      .sendMessage(tabId, {
        type: 'SHOW_TIME_REMINDER',
        id: state.reminderId,
        minutes,
      })
      .catch(() => false);
    if (shown !== true) return;
  }
  await chrome.storage.local.set({ [TIME_REMINDER_KEY]: { ...state, delivered: true } });
}

export async function respondToTimer(id: string, action: 'snooze' | 'break'): Promise<boolean> {
  const data = await chrome.storage.local.get(TIME_REMINDER_KEY);
  const state = readTimeBudget(data[TIME_REMINDER_KEY]);
  if (!state || state.reminderId !== id || !state.delivered) return false;
  const settings = await getSettings();
  if (
    !settings.trackingEnabled ||
    settings.timeReminderMinutes !== state.limitMinutes ||
    Date.now() - state.lastEnd > settings.sessionGapThresholdMs
  )
    return false;
  if (action === 'break') {
    await beginBreak(id);
    await chrome.storage.local.remove(TIME_REMINDER_KEY);
  } else if (action === 'snooze') {
    await chrome.storage.local.set({
      [TIME_REMINDER_KEY]: {
        ...state,
        targetMs: state.spentMs + SNOOZE_MS,
        reminderId: null,
        delivered: false,
      },
    });
  } else return false;
  return true;
}
