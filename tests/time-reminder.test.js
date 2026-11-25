import { describe, expect, it } from 'vitest';
import { addActiveTime, readTimeBudget } from '../src/shared/time-reminder.ts';

describe('active Reel time across tabs and worker wakes', () => {
  const count = (state, start, end, limit = 1) =>
    addActiveTime(state, limit, 60000, start, end);
  it('counts the overlapping part of two foreground samples only once', () => {
    const first = count(undefined, 1000, 6000);
    const next = count(readTimeBudget(structuredClone(first)), 5000, 9000);
    expect(next.spentMs).toBe(8000);
    expect(count(next, 1000, 6000)).toEqual(next);
  });
  it('counts reversed samples and fills gaps without counting replayed time', () => {
    let state = count(undefined, 10000, 15000);
    state = count(readTimeBudget(structuredClone(state)), 5000, 10000);
    expect(state.spentMs).toBe(10000);
    state = count(state, 18000, 20000);
    state = count(state, 14000, 19000);
    expect(state.spentMs).toBe(15000);
    expect(count(state, 6000, 14000)).toEqual(state);
    state = count(state, 50000, 55000);
    expect(state.recentIntervals).toEqual([[50000, 55000]]);
    expect(count(state, 5000, 10000)).toEqual(state);
  });
  it('preserves time from older stored budgets when a sample overlaps the upgrade', () => {
    const legacy = { limitMinutes: 1, spentMs: 7000, lastEnd: 10000,
      targetMs: 307000, delivered: false, reminderId: null };
    const state = count(readTimeBudget(legacy), 8000, 12000);
    expect(count(state, 9000, 11000)).toMatchObject({ spentMs: 9000, targetMs: 307000 });
  });
  it('preserves a snooze during the session and resets after inactivity or a limit change', () => {
    const snoozed = { ...count(undefined, 0, 5000), targetMs: 305000 };
    expect(count(snoozed, 15000, 20000).targetMs).toBe(305000);
    expect(count(snoozed, 70000, 73000)).toMatchObject({ spentMs: 3000, targetMs: 60000 });
    expect(count(snoozed, 5000, 10000, 10)).toMatchObject({ spentMs: 5000, targetMs: 600000 });
  });
  it('rejects incomplete or corrupt stored budgets', () => {
    expect(readTimeBudget({})).toBeUndefined();
    expect(readTimeBudget({ ...count(undefined, 0, 1000), spentMs: NaN })).toBeUndefined();
  });
});
