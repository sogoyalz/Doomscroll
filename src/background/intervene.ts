// Acting on a detection: the storage, permissions, and messaging around the
// pure escalation rules in shared/intervene.ts.
//
// Kept separate from detect.ts because detection must keep working, and keep
// logging, whether or not anything is ever allowed to interrupt. That
// separation is what made a log-only phase possible, and it is worth
// preserving now that acting is wired up.

import { getInterventionById, putInterventionLog } from './db.js';
import {
  BREAK_DESTINATION,
  BREAK_KEY,
  isBreakActive,
  isBreakState,
  newBreak,
  type BreakState,
} from '@shared/break.js';
import {
  couldIntervene,
  decideIntervention,
  EMPTY_STATE,
  recordFired,
  type InterventionState,
} from '@shared/intervene.js';
import type { PatternDetection } from '@shared/patterns.js';
import type { InterventionLevel, InterventionLogEntry, UserSettings } from '@shared/types.js';

const STATE_KEY = 'doomscroll:interventionState';

/**
 * Cooldown state lives in chrome.storage.local rather than IndexedDB.
 *
 * It is a single small record read on every reel and written rarely, which is
 * what chrome.storage is good at, and unlike the logs it is not history — it
 * is the worker's memory of what it has already said.
 */
export async function readState(): Promise<InterventionState> {
  try {
    const { [STATE_KEY]: stored } = await chrome.storage.local.get(STATE_KEY);
    if (!stored || typeof stored !== 'object') return { ...EMPTY_STATE };
    const state = stored as Partial<InterventionState>;
    return {
      lastFiredAt: state.lastFiredAt ?? {},
      sessionId: state.sessionId ?? null,
      firedInSession: state.firedInSession ?? [],
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function writeState(state: InterventionState): Promise<void> {
  try {
    await chrome.storage.local.set({ [STATE_KEY]: state });
  } catch {
    // A cooldown that fails to persist re-allows an interruption sooner than
    // intended. Annoying, but not a reason to break the write path that
    // brought us here.
  }
}

/**
 * Considers interrupting, and does so if the rules allow.
 *
 * Returns the level actually shown, or null. Callers must not treat null as an
 * error: most reels produce null, and that is the system working.
 */
export async function maybeIntervene(
  detection: PatternDetection,
  settings: UserSettings,
  sessionId: string,
  tabId: number | undefined,
  now: number = Date.now(),
): Promise<InterventionLevel | null> {
  // Nothing is read until it can matter. Two storage round trips per reel, at
  // a dozen reels a minute, for a feature that ships off and stays off for
  // anyone who never turns it on.
  if (!couldIntervene(detection.detected, settings)) return null;

  const [state, currentBreak] = await Promise.all([readState(), readBreak()]);
  const decision = decideIntervention({
    detected: detection.detected,
    streak: detection.streak,
    settings,
    state,
    sessionId,
    now,
    onBreak: isBreakActive(currentBreak, now),
  });

  if (!decision.act || !decision.level) return null;

  const level = decision.level;

  // Recorded before it is shown, and before the state is updated. If the
  // delivery fails the row still exists with outcome 'pending', which is the
  // truth: something was decided and the user may never have seen it. Writing
  // it afterwards would silently lose exactly the failures worth counting.
  const entry: InterventionLogEntry = {
    id: crypto.randomUUID(),
    at: now,
    sessionId,
    level,
    category: detection.category,
    streak: detection.streak,
    share: detection.share,
    ratio: detection.ratio,
    outcome: 'pending',
    respondedAt: null,
    breakStartedAt: null,
    breakEndedEarlyAt: null,
  };
  await putInterventionLog(entry);
  await writeState(recordFired(state, level, sessionId, now));

  if (level === 'notify') await notify(detection);
  else await sendToTab(tabId, entry.id, level, detection);

  return level;
}

/**
 * Copy rule, applied everywhere the user can read it: describe the feed, never
 * the viewer. "You seem sad" is not supportable by keyword counts over
 * captions, and would be a guess about someone's inner state delivered as a
 * finding.
 */
function notificationText(detection: PatternDetection): string {
  const what = detection.category ? `${detection.category} content` : 'similar content';
  return (
    `The last ${detection.streak} reels in a row have been ${what} — ` +
    'more than your feed usually serves you.'
  );
}

/**
 * Raises the gentlest rung, if it is available.
 *
 * `notifications` is an optional permission, requested when the user switches
 * interventions on rather than at install — the install prompt is where
 * permissions cost the most, and this one is unused by default and unusable
 * until a week of history exists. So `chrome.notifications` may simply not be
 * there, which is a decision the user made and not a fault.
 */
async function notify(detection: PatternDetection): Promise<void> {
  if (!chrome.notifications) return;

  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
      title: 'Your feed has narrowed',
      message: notificationText(detection),
      // Not silent, but not requiring interaction either: a notification the
      // user must dismiss is a second interruption on top of the first.
      requireInteraction: false,
    });
  } catch (err) {
    console.warn('Doomscroll: notification failed', err);
  }
}

async function sendToTab(
  tabId: number | undefined,
  id: string,
  level: InterventionLevel,
  detection: PatternDetection,
): Promise<void> {
  if (tabId === undefined) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'INTERVENE',
      payload: { id, level, category: detection.category, streak: detection.streak },
    });
  } catch {
    // The tab closed or navigated between the reel being reported and this
    // being sent. The log row stays 'pending'.
  }
}

/**
 * Records what the user did about a specific interruption.
 *
 * Correlated by the record's own id, carried out to the overlay and echoed
 * back. Resolving "the most recent pending one" instead would mis-attribute a
 * dismissal to a stale row left behind when a tab was closed on an earlier
 * interruption without answering it.
 *
 * A row that already has an outcome is left alone: the first answer is the
 * real one, and a duplicate message must not rewrite it.
 */
export async function recordOutcome(
  id: string,
  userAction: 'accepted' | 'bypassed',
  now: number = Date.now(),
): Promise<void> {
  const entry = await getInterventionById(id);
  if (!entry || entry.outcome !== 'pending') return;
  await putInterventionLog({ ...entry, outcome: userAction, respondedAt: now });
}

/**
 * Begins a break, and stamps the record that offered it.
 *
 * The state is written before the destination is returned, so a page that
 * navigates immediately still finds the break in place when it lands.
 */
export async function beginBreak(
  interventionId: string,
  now: number = Date.now(),
): Promise<{ goTo: string }> {
  const state = newBreak(interventionId, now);
  try {
    await chrome.storage.local.set({ [BREAK_KEY]: state });
  } catch {
    // Losing the state costs the reminder and the observation, not the break
    // itself — the page still leaves the feed, which is the substantive half.
  }

  const entry = await getInterventionById(interventionId);
  if (entry) await putInterventionLog({ ...entry, breakStartedAt: now });

  return { goTo: BREAK_DESTINATION };
}

export async function readBreak(): Promise<BreakState | null> {
  try {
    const { [BREAK_KEY]: stored } = await chrome.storage.local.get(BREAK_KEY);
    return isBreakState(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Ends the current break.
 *
 * `early` distinguishes the user choosing to go back — the one finding here,
 * and the closest the ladder gets to being measured by behaviour rather than
 * by which button was pressed — from ending it for a reason that says nothing
 * about them, which today means their history being deleted underneath it.
 *
 * A break that simply runs out needs neither: it lapses at `endsAt` on its own.
 */
export async function endBreak(early: boolean, now: number = Date.now()): Promise<void> {
  const state = await readBreak();

  try {
    await chrome.storage.local.remove(BREAK_KEY);
  } catch {
    // A break that fails to clear lapses on its own at endsAt.
  }

  if (!early || !state || !isBreakActive(state, now)) return;

  const entry = await getInterventionById(state.interventionId);
  // Left alone if already stamped: the first return is the one that ended it.
  if (entry && entry.breakEndedEarlyAt === null) {
    await putInterventionLog({ ...entry, breakEndedEarlyAt: now });
  }
}
