import { beforeEach, expect, it, vi } from 'vitest';
import { tickBudget, respondToTimer } from '../src/background/time-reminder.ts';
import { TIME_REMINDER_KEY } from '../src/shared/time-reminder.ts';
import { SETTINGS_KEY } from '../src/shared/settings.ts';

let store;
beforeEach(() => {
  store = { [SETTINGS_KEY]: { timeReminderMinutes: 1 } };
  globalThis.chrome = {
    storage: { local: {
      get: async keys => Object.fromEntries([keys].flat().map(key => [key, store[key]])),
      set: vi.fn(async values => Object.assign(store, values)),
    } },
    tabs: { sendMessage: vi.fn(async () => true) },
  };
});

it('banks a fresh-at-receipt sample after worker delay without showing a stale prompt', async () => {
  const end = Date.now() - 30000;
  store[TIME_REMINDER_KEY] = { limitMinutes: 1, spentMs: 59000, targetMs: 60000,
    lastEnd: end - 1000, delivered: false, reminderId: null };
  await tickBudget(1, end - 1000, end, end);
  expect(store[TIME_REMINDER_KEY]).toMatchObject({ spentMs: 60000, delivered: false });
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
});

it('retries a failed write and counts the interval once', async () => {
  const end = Date.now();
  chrome.storage.local.set.mockRejectedValueOnce(new Error('quota'));
  await expect(tickBudget(1, end - 1000, end, end)).rejects.toThrow('quota');
  await tickBudget(1, end - 1000, end, end);
  await tickBudget(1, end - 1000, end, end);
  expect(store[TIME_REMINDER_KEY].spentMs).toBe(1000);
});

it('falls back to the page and applies a snooze only once', async () => {
  const end = Date.now();
  store[TIME_REMINDER_KEY] = { limitMinutes: 1, spentMs: 59000, targetMs: 60000,
    lastEnd: end - 1000, delivered: false, reminderId: null };
  await tickBudget(1, end - 1000, end, end);
  const { reminderId } = store[TIME_REMINDER_KEY];
  expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(1,
    expect.objectContaining({ type: 'SHOW_TIME_REMINDER', id: reminderId }));
  expect(await respondToTimer(reminderId, 'snooze')).toBe(true);
  expect(await respondToTimer(reminderId, 'snooze')).toBe(false);
});
