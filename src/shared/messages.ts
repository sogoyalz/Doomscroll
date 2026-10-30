// The extension has no HTTP backend — these chrome.runtime.sendMessage
// contracts are its entire API surface. All background-side handlers live
// behind a single onMessage listener in src/background/index.ts.

import type {
  DailyAggregate,
  DetectionLogEntry,
  InterventionLevel,
  InterventionLogEntry,
  NewReelEvent,
  ReelEvent,
  UserSettings,
} from './types.js';
import type { TuningReport } from './tuning.js';
import type { AuthorBreakdown, SessionSummary } from './insights.js';

/**
 * Which history the user asked to export.
 *
 * Named rather than a bare union of strings because the background switches
 * on it to decide what to read: the three exports draw from three different
 * stores, and building all of them for every click meant reading the whole
 * database three times over for two results that were thrown away.
 */
export type ExportKind = 'reels' | 'detection' | 'interventions';

export type ExtensionMessage =
  | { type: 'GET_SESSION_ID'; payload: { startedAt: number; endedAt: number } }
  | { type: 'REEL_VIEW_LOGGED'; payload: NewReelEvent }
  // Background -> content script, via chrome.tabs.sendMessage. The only
  // message that travels in that direction, and the reason the content script
  // has an onMessage listener at all.
  | {
      type: 'INTERVENE';
      payload: {
        /** The interventionLog row this belongs to, echoed back on dismissal. */
        id: string;
        level: InterventionLevel;
        category: string | null;
        streak: number;
      };
    }
  | {
      type: 'INTERVENTION_DISMISSED';
      payload: { id: string; userAction: 'bypassed' | 'accepted' };
    }
  | { type: 'GET_INTERVENTION_LOG'; payload: { limit?: number } }
  // Taking a break, and cutting one short. Both come from the content script:
  // the first when the prompt is accepted, the second when the reels feed
  // reappears while a break is still running.
  | { type: 'START_BREAK'; payload: { id: string } }
  | { type: 'END_BREAK'; payload: { early: boolean } }
  | { type: 'GET_STATS'; payload: { range: 'today' | '7d' | '30d' } }
  | { type: 'GET_DETECTION_LOG'; payload: { limit?: number } }
  | { type: 'GET_TUNING_REPORT'; payload: { limit?: number } }
  | { type: 'GET_AUTHOR_STATS'; payload: { limit?: number } }
  | { type: 'GET_SESSIONS'; payload: { limit?: number } }
  | { type: 'GET_SESSION_REELS'; payload: { sessionId: string } }
  | { type: 'GET_SETTINGS'; payload: Record<string, never> }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<UserSettings> }
  | { type: 'EXPORT_DATA'; payload: { which: ExportKind } }
  | { type: 'CLEAR_DATA'; payload: Record<string, never> };

export type MessageType = ExtensionMessage['type'];

/**
 * Envelope every background handler replies with.
 *
 * Handler failures come back as `ok: false` rather than a rejected
 * sendMessage, so a caller that forgets to catch does not produce an
 * unhandled rejection in the page.
 */
export type MessageResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Response shape per route, so senders get a typed result back.
export interface MessageResponses {
  GET_SESSION_ID: { id: string };
  REEL_VIEW_LOGGED: { queued: boolean };
  /** Whether the content script actually put something on screen. */
  INTERVENE: { shown: boolean };
  INTERVENTION_DISMISSED: { ok: true };
  GET_INTERVENTION_LOG: InterventionLogEntry[];
  /** Where the page should send the user, so the break is a real one. */
  START_BREAK: { goTo: string };
  END_BREAK: { ok: true };
  GET_STATS: DailyAggregate[];
  GET_DETECTION_LOG: DetectionLogEntry[];
  GET_TUNING_REPORT: TuningReport;
  GET_AUTHOR_STATS: AuthorBreakdown;
  GET_SESSIONS: SessionSummary[];
  /** One session's reels, oldest first — the sequence, not a rollup. */
  GET_SESSION_REELS: ReelEvent[];
  GET_SETTINGS: UserSettings;
  /**
   * The settings as they were actually stored, not the patch that was sent.
   *
   * Every numeric field is clamped on the way in, so the two differ whenever
   * the caller sent something out of range. Returning the stored object lets
   * the options page render what is true rather than what it asked for — it
   * applies the patch optimistically, and a typed 999 would otherwise sit in
   * the field looking saved while detection ran on the clamped 100.
   */
  UPDATE_SETTINGS: UserSettings;
  /** One CSV, the one that was asked for. */
  EXPORT_DATA: { filename: string; csv: string };
  CLEAR_DATA: { ok: true };
}
