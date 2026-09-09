import { describe, it, expect } from 'vitest';
import {
  COOLDOWN_MS,
  EMPTY_STATE,
  cooldownFor,
  decideIntervention,
  levelForStreak,
  recordFired,
  summarizeInterventions,
} from '../src/shared/intervene.ts';
import { DEFAULT_SETTINGS } from '../src/shared/defaults.ts';

const LEVELS = DEFAULT_SETTINGS.interventionLevels;
const on = { ...DEFAULT_SETTINGS, interventionEnabled: true };
const NOW = 1_700_000_000_000;

const input = (over = {}) => ({
  detected: true,
  streak: LEVELS.notifyAfterStreak,
  settings: on,
  state: EMPTY_STATE,
  sessionId: 'session-1',
  now: NOW,
  onBreak: false,
  ...over,
});

describe('levelForStreak', () => {
  it('earns nothing below the gentlest threshold', () => {
    expect(levelForStreak(LEVELS.notifyAfterStreak - 1, LEVELS)).toBeNull();
  });

  it('escalates with the length of the run', () => {
    expect(levelForStreak(LEVELS.notifyAfterStreak, LEVELS)).toBe('notify');
    expect(levelForStreak(LEVELS.overlayAfterStreak, LEVELS)).toBe('overlay');
    expect(levelForStreak(LEVELS.blockAfterStreak, LEVELS)).toBe('block');
  });

  it('goes straight to the level a long run earned', () => {
    // Someone twenty reels deep does not need to be notified first — they have
    // already scrolled past the point the gentler nudge was for.
    expect(levelForStreak(LEVELS.blockAfterStreak + 50, LEVELS)).toBe('block');
  });
});

describe('decideIntervention', () => {
  it('does nothing when the user has not switched interventions on', () => {
    const result = decideIntervention(input({ settings: DEFAULT_SETTINGS }));
    expect(result.act).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('does nothing when detection did not fire', () => {
    expect(decideIntervention(input({ detected: false })).act).toBe(false);
  });

  it('does nothing for a run too short to have earned a level', () => {
    const result = decideIntervention(input({ streak: 1 }));
    expect(result.act).toBe(false);
    expect(result.reason).toBe('no-level-earned');
  });

  it('acts on a qualifying run', () => {
    const result = decideIntervention(input());
    expect(result.act).toBe(true);
    expect(result.level).toBe('notify');
  });

  it('fires each level only once per session', () => {
    // Without this, a run that stays above a threshold re-fires on every reel.
    const state = recordFired(EMPTY_STATE, 'notify', 'session-1', NOW);
    const result = decideIntervention(input({ state, now: NOW + 60 * 60 * 1000 }));
    expect(result.act).toBe(false);
    expect(result.reason).toBe('already-fired-this-session');
  });

  it('still escalates to a stronger level within the same session', () => {
    // Having been notified is not a reason to stay silent when the run gets
    // long enough to have earned more.
    const state = recordFired(EMPTY_STATE, 'notify', 'session-1', NOW);
    const result = decideIntervention({
      ...input({ state }),
      streak: LEVELS.overlayAfterStreak,
    });
    expect(result.act).toBe(true);
    expect(result.level).toBe('overlay');
  });

  it('holds a level during its cooldown, even in a new session', () => {
    // Closing the tab and reopening it must not buy a fresh interruption —
    // that would make the cooldown bypassable by the very behaviour being
    // interrupted.
    const state = recordFired(EMPTY_STATE, 'notify', 'session-1', NOW);
    const result = decideIntervention(
      input({ state, sessionId: 'session-2', now: NOW + COOLDOWN_MS.notify - 1 }),
    );
    expect(result.act).toBe(false);
    expect(result.reason).toBe('cooling-down');
  });

  it('allows the level again once the cooldown has elapsed', () => {
    const state = recordFired(EMPTY_STATE, 'notify', 'session-1', NOW);
    const result = decideIntervention(
      input({ state, sessionId: 'session-2', now: NOW + COOLDOWN_MS.notify + 1 }),
    );
    expect(result.act).toBe(true);
  });

  it('uses the user\'s own cooldown for the block level', () => {
    expect(cooldownFor('block', on)).toBe(LEVELS.blockCooldownMs);
    expect(cooldownFor('notify', on)).toBe(COOLDOWN_MS.notify);
    expect(cooldownFor('overlay', on)).toBe(COOLDOWN_MS.overlay);
  });

  it('reports why it stayed quiet, not just that it did', () => {
    // The suppression reason is the interesting half: a week of 'cooling-down'
    // means the cooldowns are too long to ever escalate.
    const reasons = [
      decideIntervention(input({ settings: DEFAULT_SETTINGS })).reason,
      decideIntervention(input({ streak: 0 })).reason,
    ];
    expect(reasons).toEqual(['disabled', 'no-level-earned']);
  });
});

describe('a break outranks everything', () => {
  it('says nothing while a break is running', () => {
    // Interrupting during a break the user just agreed to is the tool being
    // the thing it exists to name.
    const result = decideIntervention(input({ onBreak: true, streak: LEVELS.blockAfterStreak }));
    expect(result.act).toBe(false);
    expect(result.reason).toBe('on-a-break');
  });

  it('does not even name a level, so nothing is spent on it', () => {
    // The cost of getting this wrong is not cosmetic: naming a level meant the
    // worker wrote a record and burned the cooldown and the once-per-session
    // slot for an interruption the page then declined to show over the break
    // reminder.
    expect(decideIntervention(input({ onBreak: true })).level).toBeNull();
  });

  it('resumes normally once the break is over', () => {
    expect(decideIntervention(input({ onBreak: false })).act).toBe(true);
  });
});

describe('recordFired', () => {
  it('remembers the level for the session', () => {
    const state = recordFired(EMPTY_STATE, 'overlay', 'session-1', NOW);
    expect(state.firedInSession).toEqual(['overlay']);
    expect(state.lastFiredAt.overlay).toBe(NOW);
  });

  it('accumulates levels within one session', () => {
    let state = recordFired(EMPTY_STATE, 'notify', 'session-1', NOW);
    state = recordFired(state, 'overlay', 'session-1', NOW + 1000);
    expect(state.firedInSession).toEqual(['notify', 'overlay']);
  });

  it('does not duplicate a level fired twice in a session', () => {
    let state = recordFired(EMPTY_STATE, 'notify', 'session-1', NOW);
    state = recordFired(state, 'notify', 'session-1', NOW + 1000);
    expect(state.firedInSession).toEqual(['notify']);
  });

  it('resets the per-session list but keeps the cooldown clocks', () => {
    let state = recordFired(EMPTY_STATE, 'notify', 'session-1', NOW);
    state = recordFired(state, 'overlay', 'session-2', NOW + 1000);
    expect(state.firedInSession).toEqual(['overlay']);
    // The notify cooldown survives the session boundary on purpose.
    expect(state.lastFiredAt.notify).toBe(NOW);
  });
});

describe('summarizeInterventions', () => {
  const entry = (over = {}) => ({
    id: `i${Math.random()}`,
    at: NOW,
    sessionId: 's1',
    level: 'notify',
    category: 'sad',
    streak: 5,
    share: 0.7,
    ratio: 2,
    outcome: 'pending',
    respondedAt: null,
    breakStartedAt: null,
    breakEndedEarlyAt: null,
    ...over,
  });

  it('tallies outcomes per level', () => {
    const rows = summarizeInterventions([
      entry({ level: 'notify', outcome: 'accepted' }),
      entry({ level: 'notify', outcome: 'bypassed' }),
      entry({ level: 'notify', outcome: 'bypassed' }),
      entry({ level: 'overlay', outcome: 'accepted' }),
    ]);

    expect(rows).toEqual([
      { level: 'notify', shown: 3, accepted: 1, bypassed: 2, pending: 0, breaks: 0, brokenEarly: 0 },
      { level: 'overlay', shown: 1, accepted: 1, bypassed: 0, pending: 0, breaks: 0, brokenEarly: 0 },
    ]);
  });

  it('counts an unanswered interruption rather than dropping it', () => {
    // A row stuck pending means the tab closed, or delivery failed — which is
    // itself worth being able to see.
    const [row] = summarizeInterventions([entry({ outcome: 'pending' })]);
    expect(row.pending).toBe(1);
    expect(row.shown).toBe(1);
  });

  it('omits levels that never fired rather than showing empty rows', () => {
    // An all-zero row invites reading a conclusion into an absence of evidence.
    const rows = summarizeInterventions([entry({ level: 'block', outcome: 'accepted' })]);
    expect(rows.map((r) => r.level)).toEqual(['block']);
  });

  it('orders levels gentlest first, as they escalate', () => {
    const rows = summarizeInterventions([
      entry({ level: 'block' }),
      entry({ level: 'notify' }),
      entry({ level: 'overlay' }),
    ]);
    expect(rows.map((r) => r.level)).toEqual(['notify', 'overlay', 'block']);
  });

  it('returns nothing when nothing has been shown', () => {
    expect(summarizeInterventions([])).toEqual([]);
  });
});

describe('breaks, the one observed outcome', () => {
  const entry = (over = {}) => ({
    id: `i${Math.random()}`,
    at: NOW,
    sessionId: 's1',
    level: 'overlay',
    category: 'sad',
    streak: 12,
    share: 0.7,
    ratio: 2,
    outcome: 'accepted',
    respondedAt: NOW + 500,
    breakStartedAt: null,
    breakEndedEarlyAt: null,
    ...over,
  });

  it('counts a break that began', () => {
    const [row] = summarizeInterventions([entry({ breakStartedAt: NOW + 500 })]);
    expect(row.breaks).toBe(1);
    expect(row.brokenEarly).toBe(0);
  });

  it('counts a break cut short by going back to the feed', () => {
    const [row] = summarizeInterventions([
      entry({ breakStartedAt: NOW + 500, breakEndedEarlyAt: NOW + 90_000 }),
    ]);
    expect(row.breaks).toBe(1);
    expect(row.brokenEarly).toBe(1);
  });

  it('separates accepting from a break actually happening', () => {
    // Accepting is a button press; the break is what followed. They came
    // apart the moment "Take a break" started doing something, and the
    // difference is the only evidence the ladder works.
    const [row] = summarizeInterventions([
      entry({ outcome: 'accepted', breakStartedAt: null }),
    ]);
    expect(row.accepted).toBe(1);
    expect(row.breaks).toBe(0);
  });

  it('never counts a break against a dismissal', () => {
    const [row] = summarizeInterventions([entry({ outcome: 'bypassed' })]);
    expect(row.bypassed).toBe(1);
    expect(row.breaks).toBe(0);
  });
});
