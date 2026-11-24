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
