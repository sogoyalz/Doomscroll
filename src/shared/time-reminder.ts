// A single session budget shared by all Reel tabs. Intervals can overlap on focus changes.
export const TIME_REMINDER_KEY = 'doomscroll:timeReminder';
export const SAMPLE_MS = 5000;
export const SNOOZE_MS = 5 * 60000;

export interface TimeBudget {
  limitMinutes: number;
  spentMs: number;
  targetMs: number;
  lastEnd: number;
  // Before this boundary, the total is final. Older budgets only stored lastEnd.
  finalizedBefore?: number;
  recentIntervals?: [number, number][];
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
  if (
    (state.finalizedBefore === undefined) !== (state.recentIntervals === undefined) ||
    state.recentIntervals !== undefined &&
    (!Array.isArray(state.recentIntervals) ||
      !Number.isFinite(state.finalizedBefore) ||
      !state.recentIntervals.every(
        (pair, index, pairs) => Array.isArray(pair) && pair.length === 2 &&
          pair.every(Number.isFinite) && pair[0] < pair[1] && pair[0] >= state.finalizedBefore! &&
          pair[1] <= state.lastEnd! && (!index || pairs[index - 1]![1] < pair[0]),
      ))
  ) return undefined;
  return state as TimeBudget;
}

export function addActiveTime(
  previous: TimeBudget | undefined,
  limitMinutes: number,
  gapMs: number,
  start: number,
  end: number,
): TimeBudget {
  const state: TimeBudget =
    previous && previous.limitMinutes === limitMinutes && start - previous.lastEnd <= gapMs
      ? previous
      : {
          limitMinutes,
          spentMs: 0,
          targetMs: limitMinutes * 60000,
          lastEnd: start,
          finalizedBefore: 0,
          recentIntervals: [],
          reminderId: null,
          delivered: false,
        };
  const lastEnd = Math.max(end, state.lastEnd);
  // tickBudget accepts samples up to two periods late and two periods long.
  const finalizedBefore = Math.max(state.finalizedBefore ?? state.lastEnd, lastEnd - 4 * SAMPLE_MS);
  const intervals: [number, number][] = [];
  let left = Math.max(start, finalizedBefore);
  let right = end;
  let added = Math.max(0, right - left);
  for (const [from, to] of state.recentIntervals ?? []) {
    if (to <= finalizedBefore) continue;
    const begin = Math.max(from, finalizedBefore);
    if (end <= finalizedBefore || to < left || begin > right) {
      intervals.push([begin, to]);
    } else {
      added -= Math.max(0, Math.min(end, to) - Math.max(start, begin));
      left = Math.min(left, begin);
      right = Math.max(right, to);
    }
  }
  if (right > left && end > finalizedBefore) intervals.push([left, right]);
  return {
    ...state,
    spentMs: state.spentMs + added,
    lastEnd,
    finalizedBefore,
    recentIntervals: intervals.sort((a, b) => a[0] - b[0]),
  };
}
