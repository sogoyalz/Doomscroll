// A single session budget shared by all Reel tabs. Intervals can overlap on focus changes.
export const TIME_REMINDER_KEY = 'doomscroll:timeReminder';
export const SAMPLE_MS = 5000;
export const SNOOZE_MS = 5 * 60000;

export interface TimeBudget {
  limitMinutes: number;
  spentMs: number;
  targetMs: number;
  lastEnd: number;
  reminderId: string | null;
  delivered: boolean;
}

export function readTimeBudget(value: unknown): TimeBudget | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const state = value as Partial<TimeBudget>;
  if (
    ![state.limitMinutes, state.spentMs, state.targetMs, state.lastEnd].every(
      (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0,
    ) ||
    typeof state.delivered !== 'boolean' ||
    !(state.reminderId === null || typeof state.reminderId === 'string')
  )
    return undefined;
  return state as TimeBudget;
}

export function addActiveTime(
  previous: TimeBudget | undefined,
  limitMinutes: number,
  gapMs: number,
  start: number,
  end: number,
): TimeBudget {
  const state =
    previous && previous.limitMinutes === limitMinutes && start - previous.lastEnd <= gapMs
      ? previous
      : {
          limitMinutes,
          spentMs: 0,
          targetMs: limitMinutes * 60000,
          lastEnd: start,
          reminderId: null,
          delivered: false,
        };
  return {
    ...state,
    spentMs: state.spentMs + Math.max(0, end - Math.max(start, state.lastEnd)),
    lastEnd: Math.max(end, state.lastEnd),
  };
}
