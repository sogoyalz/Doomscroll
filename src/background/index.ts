// Service worker — message router and scheduled maintenance.
//
// Never touches the page. Owns every write to persistent storage, so
// concurrent tabs cannot race each other: content scripts only report what
// they saw and this decides what to keep.
//
// MV3 service workers are killed after ~30s idle, so nothing may be held in
// module scope across events. Anything periodic runs off chrome.alarms, which
// survives the worker being torn down and restarted.

import {
  clearAllData,
  getAllReelEvents,
  getDailyAggregates,
  getDetectionLog,
  getInterventionLog,
  getRecentSessions,
  getSessionEvents,
  pruneOldData,
  recordReelView,
} from './db.js';
import {
  AGGREGATE_ALARM,
  backfillMissingAggregates,
  clearDirtyDays,
  flushDirtyDays,
  markDayDirty,
  recomputeDay,
  scheduleAggregateFlush,
} from './aggregator.js';
import { classifyReel } from './classify.js';
import { runDetection } from './detect.js';
import { beginBreak, endBreak, maybeIntervene, recordOutcome } from './intervene.js';
import { reclassifyIfLexiconChanged } from './reclassify.js';
import { getSettings, updateSettings } from '@shared/settings.js';
import { noteStorageFailure, noteStorageWorking } from '@shared/storage-health.js';
import { detectionLogToCSV, interventionLogToCSV, reelEventsToCSV } from '@shared/csv.js';
import { buildTuningReport } from '@shared/tuning.js';
import { authorBreakdown, summarizeSession } from '@shared/insights.js';
import { localDateKey, startOfLocalDayBefore } from '@shared/time.js';
import type { ExtensionMessage, MessageResponses } from '@shared/messages.js';

const PRUNE_ALARM = 'doomscroll:prune';
const PRUNE_PERIOD_MINUTES = 24 * 60;


const STATS_RANGE_DAYS: Record<'today' | '7d' | '30d', number> = {
  today: 0,
  '7d': 6,
  '30d': 29,
};

/**
 * Handlers receive the sender as well as the payload.
 *
 * Only the intervention path uses it, and only for the tab id: an overlay has
 * to be delivered to the tab the reel was reported from, and trusting a tab id
 * carried in the payload would let any sender aim an interruption at any tab.
 */
type HandlerMap = {
  [M in ExtensionMessage as M['type']]?: (
    payload: M['payload'],
    sender: chrome.runtime.MessageSender,
  ) => Promise<MessageResponses[M['type']]>;
};

const handlers: HandlerMap = {
  async REEL_VIEW_LOGGED(payload, sender) {
    const settings = await getSettings();

    // Enforce "paused = nothing recorded" here, not only in the content
    // script. Pausing tears the observers down per tab via a storage change
    // event, but an in-flight message, or a reel completing in a throttled
    // background tab during that race window, would otherwise still be
    // written. The write path is the one place the guarantee can be absolute.
    if (!settings.trackingEnabled) return { queued: false };

    // Classified before the write: the rules engine is pure and synchronous,
    // so there is no reason to store an unlabelled event and revisit it.
    //
    // A failure here is the one the user cannot otherwise see. Everything
    // downstream is skipped, correctly — there is nothing to aggregate — but
    // the popup would then read "Nothing tracked yet", which is what it also
    // says when you simply have not scrolled. Recording the failure is what
    // lets the dashboard tell those apart.
    // Classified outside the guard below, so that only the write is attributed
    // to storage. As an argument it sat inside it, and a classifier throwing
    // on a malformed payload would have been reported to the user as "reels
    // aren't being saved — usually a full disk", sending them to look at the
    // one thing that was fine.
    const classification = classifyReel(payload, settings.classificationMode);

    try {
      await recordReelView(payload, classification);
    } catch (err) {
      await noteStorageFailure(err);
      throw err;
    }
    await noteStorageWorking();

    // Bookkeeping immediately after the write, and BEFORE anything that reads
    // the history back. These two are what get the day rolled up, and the
    // rollups are what the detector's baseline is computed from — so a failure
    // in detection that skipped them would starve the very thing that failed,
    // silently and self-reinforcingly. The reel would sit in the store while
    // its day never became an aggregate.
    await markDayDirty(payload.startedAt);
    await scheduleAggregateFlush();

    // Everything below is analysis of what was just written. It must not be
    // able to fail the write: the reel is recorded either way, and that is
    // what this message promises. A thrown error here would otherwise be
    // swallowed by the content script's catch and lose the view entirely.
    try {
      // Detection always runs and always logs, whether or not anything is
      // allowed to act on it — that separation is what made the log-only
      // period possible and is worth keeping.
      const detection = await runDetection(payload.sessionId, settings);

      // Interrupting is a separate decision with its own thresholds and
      // cooldowns, and it no-ops unless the user has switched it on.
      await maybeIntervene(detection, settings, payload.sessionId, sender.tab?.id);
    } catch (err) {
      console.error('Doomscroll: detection failed for a recorded reel', err);
    }

    return { queued: true };
  },

  async GET_STATS({ range }) {
    const now = Date.now();
    const { sessionGapThresholdMs } = await getSettings();

    // Today's aggregate is only materialized on the debounced alarm, so
    // recompute it here — the dashboard should never show stale numbers for
    // a session the user is still in the middle of.
    const today = localDateKey(now);
    await recomputeDay(today, sessionGapThresholdMs);

    const from = localDateKey(startOfLocalDayBefore(now, STATS_RANGE_DAYS[range]));
    return getDailyAggregates(from, today);
  },

  async GET_SETTINGS() {
    return getSettings();
  },

  async UPDATE_SETTINGS(payload) {
    await updateSettings(payload);
    return { ok: true };
  },

  async GET_DETECTION_LOG({ limit }) {
    return getDetectionLog(limit);
  },

  async GET_INTERVENTION_LOG({ limit }) {
    return getInterventionLog(limit);
  },

  async INTERVENTION_DISMISSED({ id, userAction }) {
    await recordOutcome(id, userAction);
    return { ok: true };
  },

  async START_BREAK({ id }) {
    return beginBreak(id);
  },

  async END_BREAK({ early }) {
    await endBreak(early);
    return { ok: true };
  },

  async GET_TUNING_REPORT({ limit }) {
    return buildTuningReport(await getAllReelEvents(), limit);
  },

  async GET_AUTHOR_STATS({ limit }) {
    return authorBreakdown(await getAllReelEvents(), limit);
  },

  async GET_SESSIONS({ limit }) {
    const sessions = await getRecentSessions(limit);
    // Summarised here rather than in the page: the alternative is shipping
    // every reel of every session across the message boundary so the UI can
    // count them itself.
    return Promise.all(
      sessions.map(async (session) =>
        summarizeSession(session, await getSessionEvents(session.id)),
      ),
    );
  },

  async GET_SESSION_REELS({ sessionId }) {
    return getSessionEvents(sessionId);
  },

  async EXPORT_DATA() {
    const [events, log, interventions] = await Promise.all([
      getAllReelEvents(),
      getDetectionLog(Infinity),
      getInterventionLog(Infinity),
    ]);
    return {
      reelsCsv: reelEventsToCSV(events),
      detectionCsv: detectionLogToCSV(log),
      interventionsCsv: interventionLogToCSV(interventions),
    };
  },

  async CLEAR_DATA() {
    await clearAllData();
    // Two pieces of transient state in chrome.storage that outlive the wipe
    // and go on referring to history that is gone. A break would keep
    // interrupting someone who just asked for everything to be forgotten —
    // ended without attribution, since the row it would be recorded against no
    // longer exists. And the dirty-day queue would roll the deleted days up as
    // empty aggregates on the next alarm, putting them back on the charts.
    await Promise.all([endBreak(false), clearDirtyDays()]);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  const handler = handlers[message?.type as keyof HandlerMap] as
    | ((payload: unknown, sender: chrome.runtime.MessageSender) => Promise<unknown>)
    | undefined;

  // Returning false releases the channel, so unknown senders get a prompt
  // failure instead of hanging until the port closes.
  if (!handler) return false;

  handler(message.payload, sender)
    .then((result) => sendResponse({ ok: true, data: result }))
    .catch((err: unknown) => {
      console.error(`Doomscroll: ${message.type} failed`, err);
      sendResponse({ ok: false, error: String(err) });
    });

  return true; // response is async
});

async function flushPending(): Promise<void> {
  const { sessionGapThresholdMs } = await getSettings();
  await flushDirtyDays(sessionGapThresholdMs);
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(PRUNE_ALARM, { periodInMinutes: PRUNE_PERIOD_MINUTES });

  // Say something once, on a fresh install only — not on every update.
  //
  // This extension does nothing visible for its first week: it needs a
  // baseline before it can call anything unusual, and it deliberately never
  // interrupts until told to. Installed silently, that is indistinguishable
  // from broken, and the natural response to a tool that appears to do nothing
  // is to remove it. The options page opens with a panel explaining what
  // happens next, which disappears on its own once there is history.
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage(() => {
      // Ignored: failing to open a tab is not a reason to abort the install
      // tasks below, and chrome.runtime.lastError must be read or it logs.
      void chrome.runtime.lastError;
    });
  }

  void (async () => {
    const { sessionGapThresholdMs, classificationMode } = await getSettings();
    // Rolls up history recorded before aggregation existed.
    await backfillMissingAggregates(sessionGapThresholdMs);
    await flushDirtyDays(sessionGapThresholdMs);
    // Re-labels history if the lexicon moved since the last load.
    await reclassifyIfLexiconChanged(classificationMode, sessionGapThresholdMs);
  })().catch((err: unknown) => {
    console.error('Doomscroll: install tasks failed', err);
  });
});

// The browser may have closed before a debounced flush fired, leaving days
// marked dirty across restarts.
chrome.runtime.onStartup.addListener(() => {
  void flushPending().catch((err: unknown) => {
    console.error('Doomscroll: startup flush failed', err);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PRUNE_ALARM) {
    // Flush first: pruning destroys the events an aggregate is derived from,
    // so a day rolled up after its events are gone would read as empty.
    void flushPending()
      .then(() => pruneOldData())
      .catch((err: unknown) => {
        console.error('Doomscroll: prune failed', err);
      });
    return;
  }

  if (alarm.name === AGGREGATE_ALARM) {
    void flushPending().catch((err: unknown) => {
      console.error('Doomscroll: aggregate flush failed', err);
    });
  }
});
