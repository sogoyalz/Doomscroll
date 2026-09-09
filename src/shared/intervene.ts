// Deciding whether to interrupt, and how hard.
//
// Detection answers "is this feed doing something unusual". This answers the
// separate question of whether to say anything about it, which is governed by
// how long the run has gone on and by how recently the user was last
// interrupted. The two are deliberately not the same decision: detection can
// hold true for a hundred consecutive reels, and interrupting a hundred times
// would be the tool becoming the problem it exists to name.
//
// Pure. Everything here is a function of the inputs, so the escalation rules
// can be tested without a browser, a database, or a clock.

import type { InterventionLevel, InterventionLogEntry, UserSettings } from './types.js';

/** How each level is described to the user. */
export const LEVEL_LABELS: Record<InterventionLevel, string> = {
  notify: 'Notification',
  overlay: 'Full-screen prompt',
  block: 'Prompt with a delay',
};

export interface InterventionSummaryRow {
  level: InterventionLevel;
  shown: number;
  accepted: number;
  bypassed: number;
  /** Shown but never answered, or never delivered at all. */
  pending: number;
  /** Breaks that actually began — one per accepted prompt. */
  breaks: number;
  /**
   * Breaks cut short by returning to the feed inside the window.
   *
   * The only observed number in this table. Everything beside it records
   * which button was pressed, and a button press states an intention; this
   * records what happened afterwards.
   */
  brokenEarly: number;
}

/**
 * Per-level tally of what happened after each interruption.
 *
 * Only levels that have actually fired appear. A table row reading all zeros
 * invites reading a conclusion into an absence of evidence, and the question
 * this answers — is interrupting worth it — deserves better than that.
 */
export function summarizeInterventions(
  entries: InterventionLogEntry[],
): InterventionSummaryRow[] {
  const rows = new Map<InterventionLevel, InterventionSummaryRow>();

  for (const entry of entries) {
    const row = rows.get(entry.level) ?? {
      level: entry.level,
      shown: 0,
      accepted: 0,
      bypassed: 0,
      pending: 0,
      breaks: 0,
      brokenEarly: 0,
    };
    row.shown++;
    if (entry.outcome === 'accepted') row.accepted++;
    else if (entry.outcome === 'bypassed') row.bypassed++;
    else row.pending++;
    if (entry.breakStartedAt !== null) row.breaks++;
    if (entry.breakEndedEarlyAt !== null) row.brokenEarly++;
    rows.set(entry.level, row);
  }

  // Gentlest first, matching the order they escalate in.
  const order: InterventionLevel[] = ['notify', 'overlay', 'block'];
  return order.filter((l) => rows.has(l)).map((l) => rows.get(l)!);
}

/** Strongest first — escalation checks in this order. */
export const LEVELS: readonly InterventionLevel[] = ['block', 'overlay', 'notify'];

/**
 * How long each level waits before it may fire again.
 *
 * Notify and overlay carry fixed cooldowns; block reads the user's own
 * `blockCooldownMs` because it is the only level that meaningfully costs them
 * something, and it is the one they should be able to set.
 *
 * These are floors on annoyance, not on detection. Detection keeps running and
 * keeps logging throughout — the cooldown governs speech, not attention.
 */
export const COOLDOWN_MS: Record<Exclude<InterventionLevel, 'block'>, number> = {
  notify: 10 * 60 * 1000,
  overlay: 20 * 60 * 1000,
};

/**
 * Per-level state, persisted so it survives the service worker being torn
 * down — which happens every 30 idle seconds, far more often than any of these
 * cooldowns elapse. Held in memory, a cooldown would effectively not exist.
 */
export interface InterventionState {
  /** Last time each level actually fired. */
  lastFiredAt: Partial<Record<InterventionLevel, number>>;
  /** The session `firedInSession` refers to. */
  sessionId: string | null;
  /** Levels already used in that session. */
  firedInSession: InterventionLevel[];
}

export const EMPTY_STATE: InterventionState = {
  lastFiredAt: {},
  sessionId: null,
  firedInSession: [],
};

/**
 * The strongest level a run of this length has earned, or null for none.
 *
 * Thresholds are compared strongest-first so a long run reaches `block`
 * directly rather than climbing the ladder one interruption at a time. Someone
 * twenty reels into a loop does not need to be notified first; they have
 * already scrolled past the point the gentler nudge was for.
 */
export function levelForStreak(
  streak: number,
  levels: UserSettings['interventionLevels'],
): InterventionLevel | null {
  if (streak >= levels.blockAfterStreak) return 'block';
  if (streak >= levels.overlayAfterStreak) return 'overlay';
  if (streak >= levels.notifyAfterStreak) return 'notify';
  return null;
}

export type SuppressionReason =
  | 'no-level-earned'
  | 'already-fired-this-session'
  | 'cooling-down'
  | 'on-a-break'
  | 'disabled';

export interface InterventionDecision {
  act: boolean;
  level: InterventionLevel | null;
  reason: SuppressionReason | null;
}

export interface InterventionInput {
  detected: boolean;
  streak: number;
  settings: UserSettings;
  state: InterventionState;
  sessionId: string;
  now: number;
  /** Whether a break the user asked for is still running. */
  onBreak: boolean;
}

/**
 * The part of the decision that needs nothing fetched.
 *
 * Split out so the caller can skip reading state it will not use. Detection
 * runs on every reel and almost none of them can produce an interruption —
 * most do not fire at all, and by default the feature is off entirely — so
 * loading the cooldowns and the break for each one is work done to reach a
 * conclusion already available from the arguments.
 *
 * Exported rather than inlined at the call site so the shortcut and the full
 * decision cannot disagree about what makes an interruption impossible.
 */
export function couldIntervene(detected: boolean, settings: UserSettings): boolean {
  return detected && settings.interventionEnabled;
}

/**
 * Whether to interrupt, at what level, and if not, why not.
 *
 * The suppression reason is returned rather than folded into a bare `false`
 * because it is the interesting half: a week of 'cooling-down' means the
 * cooldowns are too long to ever escalate, and a week of
 * 'already-fired-this-session' means sessions are being cut too coarsely for
 * the once-per-session rule to mean what it says.
 */
export function decideIntervention(input: InterventionInput): InterventionDecision {
  const { detected, streak, settings, state, sessionId, now, onBreak } = input;

  if (!couldIntervene(detected, settings)) {
    return { act: false, level: null, reason: 'disabled' };
  }

  // Interrupting someone during a break they just agreed to is the tool being
  // the thing it exists to name. Checked before anything else because it
  // outranks every other consideration: they have already been told, and
  // already acted on it.
  //
  // Not merely cosmetic. Without this the worker still writes the record and
  // spends the cooldown and the once-per-session slot, while the page declines
  // to show anything over the break reminder — so the interruption is burned
  // invisibly and that level can never fire again in the session.
  if (onBreak) return { act: false, level: null, reason: 'on-a-break' };

  const level = levelForStreak(streak, settings.interventionLevels);
  if (!level) return { act: false, level: null, reason: 'no-level-earned' };

  // Once per level per session. Without this, a run that stays above a
  // threshold re-fires on every reel, and the cooldown alone would still allow
  // an interruption every ten minutes for as long as the loop lasts.
  const sameSession = state.sessionId === sessionId;
  if (sameSession && state.firedInSession.includes(level)) {
    return { act: false, level, reason: 'already-fired-this-session' };
  }

  const cooldown = cooldownFor(level, settings);
  const lastFired = state.lastFiredAt[level];
  if (lastFired !== undefined && now - lastFired < cooldown) {
    return { act: false, level, reason: 'cooling-down' };
  }

  return { act: true, level, reason: null };
}

export function cooldownFor(level: InterventionLevel, settings: UserSettings): number {
  return level === 'block'
    ? settings.interventionLevels.blockCooldownMs
    : COOLDOWN_MS[level];
}

/**
 * State after a level fires.
 *
 * A new session resets the per-session list but NOT the cooldown timestamps:
 * closing the tab and reopening it is not a reason to be interrupted again
 * thirty seconds later, and treating it as one would make the cooldown
 * trivially bypassable by the exact behaviour being interrupted.
 */
export function recordFired(
  state: InterventionState,
  level: InterventionLevel,
  sessionId: string,
  now: number,
): InterventionState {
  const sameSession = state.sessionId === sessionId;
  return {
    lastFiredAt: { ...state.lastFiredAt, [level]: now },
    sessionId,
    firedInSession: sameSession ? [...new Set([...state.firedInSession, level])] : [level],
  };
}
