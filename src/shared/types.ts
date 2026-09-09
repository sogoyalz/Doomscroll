export interface ReelEvent {
  id: string; // uuid v4
  /**
   * The reel's identity: the React fiber shortcode when the MAIN-world bridge
   * resolved one, else a derived `author|video-basename` key. Never from the
   * URL — the Reels URL does not track the active reel. See docs/dom-notes.md.
   */
  reelShortcode: string;
  sessionId: string; // FK -> Session.id
  startedAt: number; // epoch ms
  endedAt: number; // epoch ms
  watchDurationMs: number;
  captionText: string | null;
  hashtags: string[];
  audioName: string | null;
  /**
   * Who posted it. Added after the first 90 days of history, so events older
   * than that carry null and any per-author view must say so rather than
   * treating the gap as "no author".
   */
  authorHandle: string | null;
  category: string | null; // null until classified
  categoryConfidence: number | null; // 0-1
  subtags: string[];
}

export interface Session {
  id: string;
  startedAt: number;
  endedAt: number;
  reelCount: number;
  totalDurationMs: number;
  dominantCategory: string | null;
}

export interface DailyAggregate {
  date: string; // YYYY-MM-DD, local time
  totalReels: number;
  totalMinutes: number;
  avgReelsPerSec: number;
  longestBingeMs: number;
  categoryBreakdown: Record<string, number>; // category -> count
}

export type InterventionLevel = 'notify' | 'overlay' | 'block';

export interface UserSettings {
  /**
   * Whether reels are recorded at all.
   *
   * Separate from `interventionEnabled`: this stops observation entirely,
   * where that only governs whether detection is allowed to interrupt. A tool
   * that records what you watch needs an off switch that is not "uninstall".
   */
  trackingEnabled: boolean;
  interventionEnabled: boolean;
  /**
   * Renders the on-page diagnostic panel while scrolling Instagram.
   *
   * Extraction degrades to nulls rather than throwing, so the only way to know
   * the capture path is working during a live session is to watch it work.
   * See docs/live-session-protocol.md.
   */
  debugHud: boolean;
  classificationMode: 'local-rules' | 'local-ml' | 'cloud-llm';
  patternWindowSize: number; // e.g. 15
  patternDominantThreshold: number; // e.g. 0.6
  patternBaselineMultiplier: number; // e.g. 1.5 — how far above baseline counts as anomalous
  sessionGapThresholdMs: number; // e.g. 120000 (2 min)
  watchedCategories: string[]; // categories eligible to trigger intervention
  interventionLevels: {
    notifyAfterStreak: number;
    overlayAfterStreak: number;
    blockAfterStreak: number;
    blockCooldownMs: number;
  };
}

export interface ClassificationResult {
  category: string;
  confidence: number;
  subtags: string[];
}

/**
 * One pattern-detection decision, recorded whether or not it fired.
 *
 * Near-misses are the useful half: reviewing a week of these is how you tell
 * whether the thresholds are set sensibly before letting anything act on
 * them. Every input behind the decision is stored so a log line can be
 * understood later without re-deriving it.
 */
export interface DetectionLogEntry {
  id: string;
  /** When this outcome first began. */
  at: number;
  /** Most recent check that produced the same outcome. */
  lastAt: number;
  /**
   * Consecutive checks that produced this same outcome.
   *
   * Detection runs on every reel, and at a real scrolling pace that is a dozen
   * checks a minute. Collapsing an unbroken run into one row is what keeps the
   * log reviewable over a week instead of over eight minutes.
   */
  occurrences: number;
  sessionId: string;
  detected: boolean;
  category: string | null;
  share: number;
  baselineShare: number;
  ratio: number;
  windowSample: number;
  chargedSample: number;
  baselineSample: number;
  streak: number;
  reason: string | null;
  /** Which rule fired: 'dominance', or null when none did. */
  trigger: string | null;
  /**
   * The same category's share over a much longer horizon than the one the
   * decision used.
   *
   * Logged, never acted on. Close to `baselineShare` means a stable diet;
   * far below it means the diet shifted recently — the difference between
   * someone who has always watched sad content and someone sliding into it,
   * which the short baseline absorbs within about a week and therefore
   * cannot distinguish. See LONG_BASELINE_DAYS in background/detect.ts.
   */
  baselineShareLong: number;
  /**
   * Reels per second across the window at the moment of the check.
   *
   * Logged, never acted on. Whether pace should be allowed to trigger anything
   * is a real question, and the honest way to answer it is to record it beside
   * the decisions for a couple of weeks and look — the same discipline that
   * keeps intervention behind a week of log review.
   */
  pacePerSec: number;
  /**
   * Local hour, 0–23. Also logged only. The obvious next hypothesis is that
   * late-night scrolling is different, and a per-hour baseline needs months of
   * data; this field is what makes it cheap to check before building one.
   */
  hourOfDay: number;
  /** False while the user has intervention switched off. */
  wouldHaveActed: boolean;
}

/**
 * One interruption, and what the user did about it.
 *
 * Separate from the detection log because they answer different questions.
 * The detection log is "was the reading right"; this is "did saying something
 * help" — and a tool that interrupts people has no business assuming the
 * answer. If a week of these shows every overlay bypassed within two seconds
 * and the session continuing regardless, the honest conclusion is that the
 * interruption is costing attention and buying nothing.
 */
export interface InterventionLogEntry {
  id: string;
  at: number;
  sessionId: string;
  level: InterventionLevel;
  /** The content pattern that prompted it. Never a claim about the person. */
  category: string | null;
  streak: number;
  share: number;
  ratio: number;
  /**
   * What happened next.
   *
   * `accepted` — took the break. `bypassed` — dismissed and kept scrolling.
   * `pending` until one of those is known, which also covers the interruption
   * never being delivered and the tab closing with it still up. Those were
   * briefly a fourth state, `ignored`, with nothing able to produce it: the
   * page going away is precisely the case where no message gets sent, so
   * nothing is left to distinguish it from a prompt still waiting.
   */
  outcome: 'pending' | 'accepted' | 'bypassed';
  /** When the user responded, if they did. */
  respondedAt: number | null;
  /**
   * When the break this prompted actually began, if one did.
   *
   * Null means no break was taken — either the prompt was dismissed, or it
   * was never answered. Only `accepted` produces a value here.
   */
  breakStartedAt: number | null;
  /**
   * When the user chose to end the break early, from the reminder.
   *
   * The closest thing to an observed signal in this record: everything else is
   * which button was pressed on the prompt itself. Returning to the feed and
   * keeping the break is deliberately NOT counted here — bouncing off the
   * reminder is the break working.
   *
   * The known gap: closing the tab on the reminder sends nothing, so that
   * break reads as held. Fixing it needs a signal from a page that is going
   * away, which is exactly when a message is least likely to arrive.
   */
  breakEndedEarlyAt: number | null;
}

// What the content script sends: everything except the classification
// fields, which the background worker fills in.
export type NewReelEvent = Omit<ReelEvent, 'category' | 'categoryConfidence' | 'subtags'>;
