// Settings and the detection log.
//
// The log table is the point of this page. Pattern detection currently runs
// in log-only mode, and its thresholds are guesses until they have been
// checked against a real week of one person's scrolling — that check happens
// here, which is why each tuning field names the log value that tells you it
// needs changing.

import { useCallback, useEffect, useRef, useState } from 'react';
import { send } from '@shared/client.js';
import type { ExportKind } from '@shared/messages.js';
import { CHARGED_CATEGORIES } from '@shared/taxonomy.js';
import { MIN_BASELINE_DAYS, baselineStatus } from '@shared/patterns.js';
import { MINUTE_MS, SETTING_BOUNDS } from '@shared/defaults.js';
import { colorForCategory } from '@shared/palette.js';
import { formatDuration, formatPercent } from '@shared/format.js';
import { readStorageFailure, type StorageFailure } from '@shared/storage-health.js';
import {
  isAudioDark,
  isDrifting,
  isShortcodeDegraded,
  readHealth,
  textlessShare,
  type ExtractionHealth,
} from '@shared/health.js';
import { LEVEL_LABELS, summarizeInterventions } from '@shared/intervene.js';
import { stackByDay, type AuthorBreakdown, type SessionSummary } from '@shared/insights.js';
import { Alerts } from './Alerts.js';
import { DayStacks } from './DayStacks.js';
import { DetectionLogPanel } from './DetectionLogPanel.js';
import { ExtractionHealthPanel } from './ExtractionHealthPanel.js';
import { TuningPanel } from './TuningPanel.js';
import { Sessions } from './Sessions.js';
import type { TuningReport } from '@shared/tuning.js';
import type {
  DailyAggregate,
  DetectionLogEntry,
  InterventionLogEntry,
  UserSettings,
} from '@shared/types.js';
import './options.css';

const LOG_LIMIT = 100;

function download(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function Options() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [log, setLog] = useState<DetectionLogEntry[]>([]);
  const [health, setHealth] = useState<ExtractionHealth | null>(null);
  const [tuning, setTuning] = useState<TuningReport | null>(null);
  const [interventions, setInterventions] = useState<InterventionLogEntry[]>([]);
  const [authors, setAuthors] = useState<AuthorBreakdown | null>(null);
  const [daily, setDaily] = useState<DailyAggregate[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  // Granted separately from install, so it has to be read rather than assumed.
  const [canNotify, setCanNotify] = useState(true);
  const [writeFailure, setWriteFailure] = useState<StorageFailure | null>(null);
  // Panels fail silently on purpose, so "empty" and "never arrived" look the
  // same in state. Anything that reads meaning into emptiness has to know
  // which it is.
  const [panelsFailed, setPanelsFailed] = useState(0);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error`, which means the page could not load at all. This
  // one is a button that did not do what it said, on a page that otherwise
  // still works, so it is reported in place instead of replacing everything.
  const [actionError, setActionError] = useState<string | null>(null);
  /** The export being built, for the button's label and disabled state. */
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  /**
   * The same fact, readable synchronously.
   *
   * The guard cannot use the state value: a double-click dispatches both
   * handlers before React re-renders, so the second one closes over the
   * `null` the first one saw and starts a second full export. Disabling the
   * button is for the eye; this is what actually stops the work.
   */
  const exportingRef = useRef<ExportKind | null>(null);

  const load = useCallback(async () => {
    // Settings load on their own, and their failure is the only one that
    // blanks the page. Everything else here is a panel: a chart query that
    // fails should cost you that chart, not the tracking switch. Bundled into
    // one Promise.all they shared a fate, and a failing session query took the
    // privacy control down with it.
    try {
      setSettings(await send('GET_SETTINGS', {}));
      setError(null);
    } catch (err) {
      setError(String(err));
      return;
    }

    // Each panel settles independently. A rejection leaves that panel at its
    // initial empty state, which every one of them already renders as "nothing
    // to show yet" — the honest reading when the data could not be fetched.
    //
    // Counted, though, because one thing on this page does read meaning into
    // an empty state: the welcome below treats no log and no history as a
    // fresh install. Left uncounted, a user with months of history whose
    // queries happened to fail would be told they were new.
    setPanelsFailed(0);
    const panel = <T,>(p: Promise<T>, apply: (value: T) => void) =>
      p.then(apply).catch((err: unknown) => {
        console.error('Doomscroll: a dashboard panel failed to load', err);
        setPanelsFailed((n) => n + 1);
      });

    await Promise.all([
      panel(chrome.permissions.contains({ permissions: ['notifications'] }), setCanNotify),
      panel(send('GET_DETECTION_LOG', { limit: LOG_LIMIT }), setLog),
      panel(readHealth(), setHealth),
      panel(readStorageFailure(), setWriteFailure),
      panel(send('GET_TUNING_REPORT', { limit: 24 }), setTuning),
      panel(send('GET_INTERVENTION_LOG', { limit: LOG_LIMIT }), setInterventions),
      panel(send('GET_AUTHOR_STATS', { limit: 10 }), setAuthors),
      panel(send('GET_STATS', { range: '30d' }), setDaily),
      panel(send('GET_SESSIONS', { limit: 15 }), setSessions),
    ]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Writes a settings change and adopts whatever was actually stored.
   *
   * The reply is the clamped object, not the patch, and the difference is
   * visible: typing 999 into a field bounded at 100 used to leave 999 on
   * screen looking saved while detection ran on 100. Applied optimistically
   * first so the control still responds at typing speed.
   *
   * A failure has to be shown. The service worker is torn down after ~30s
   * idle and a send can genuinely fail; silently keeping the optimistic value
   * would leave the page reporting a setting that was never written.
   */
  const patch = useCallback(
    async (update: Partial<UserSettings>) => {
      setSettings((prev) => (prev ? { ...prev, ...update } : prev));
      try {
        setSettings(await send('UPDATE_SETTINGS', update));
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } catch (err) {
        setActionError(`Couldn’t save that setting. ${String(err)}`);
        // Back to what is actually stored, so the page stops showing a value
        // that only ever existed in this tab.
        void load();
      }
    },
    [load],
  );

  /**
   * Runs one export and hands the file to the browser.
   *
   * Guarded against a second click while the first is still reading: these
   * walk the whole history, and a double-click used to run two full exports
   * and save the same file twice.
   */
  const exportCsv = useCallback(async (which: ExportKind) => {
    if (exportingRef.current) return;
    exportingRef.current = which;
    setExporting(which);
    try {
      const { filename, csv } = await send('EXPORT_DATA', { which });
      download(filename, csv);
    } catch (err) {
      setActionError(`Couldn’t build that export. ${String(err)}`);
    } finally {
      exportingRef.current = null;
      setExporting(null);
    }
  }, []);

  /**
   * Turns interventions on, asking for the notification permission as it goes.
   *
   * Requested here rather than at install because this is the first moment it
   * can be used, and because a permission on the install prompt costs more
   * than one asked for in context. Must be called straight from the change
   * event: Chrome only grants a request that comes from a user gesture.
   *
   * A refusal is not a failure. The other two rungs need no permission, so
   * interventions still go on — the ladder simply starts at the full-screen
   * prompt, and the note below says so rather than leaving a rung that looks
   * enabled and silently does nothing.
   */
  async function enableInterventions(on: boolean): Promise<void> {
    if (on) {
      try {
        setCanNotify(await chrome.permissions.request({ permissions: ['notifications'] }));
      } catch {
        setCanNotify(false);
      }
    }
    await patch({ interventionEnabled: on });
  }

  if (error) return <div className="page empty">Couldn&rsquo;t load settings. {error}</div>;
  if (!settings) return <div className="page empty">Loading</div>;

  // Nothing observed and nothing rolled up, and we actually know that rather
  // than having failed to ask. Derived rather than stored, so the welcome
  // retires itself the moment there is history and there is no "dismissed"
  // flag to go stale.
  const brandNew = panelsFailed === 0 && log.length === 0 && daily.length === 0;
  const readiness = baselineStatus(daily);
  const baselineReady = readiness.ready;
  const daysSeen = readiness.days;
  const drifting = health ? isDrifting(health) : false;
  const shortcodeDegraded = health ? isShortcodeDegraded(health) : false;
  const audioDark = health ? isAudioDark(health) : false;
  const textless = health ? textlessShare(health) : 0;

  return (
    <div className="page">
      <header className="masthead">
        <h1>Doomscroll</h1>
        <p>
          Catches when the feed locks onto one kind of content and keeps serving it.
          <span className="fine">
            Everything stays on this machine. No account, no server, nothing sent anywhere.
          </span>
        </p>
      </header>

      <Alerts
        brandNew={brandNew}
        writeFailure={writeFailure}
        health={health}
        drifting={drifting}
        shortcodeDegraded={shortcodeDegraded}
        audioDark={audioDark}
        textless={textless}
      />

      <section className="section">
        <h2 className="section-label">Tracking</h2>
        <p className="section-note">
          When off, nothing is observed or recorded at all — the extension stops watching the
          page. Your existing history is kept.
        </p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.trackingEnabled}
            onChange={(e) => void patch({ trackingEnabled: e.target.checked })}
          />
          <span className="switch" />
          <span className="toggle-text">Record the reels I watch</span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.debugHud}
            onChange={(e) => void patch({ debugHud: e.target.checked })}
          />
          <span className="switch" />
          <span className="toggle-text">
            Show the diagnostic panel on Instagram
            <span className="fine">
              A small overlay listing what was read from each reel as you scroll. For checking
              the extension still works after an Instagram update — see the live session
              protocol in the docs.
            </span>
          </span>
        </label>
      </section>

      <ExtractionHealthPanel health={health} />

      <section className="section">
        <h2 className="section-label">Interventions</h2>
        <p className="section-note">
          Detection runs either way. With this off, results only go to the log below — which is
          how the first week is best spent.
        </p>

        {!baselineReady && (
          <div className="gate">
            <strong>Not available yet.</strong> Detection measures against your own normal,
            which needs roughly {MIN_BASELINE_DAYS} days of history to exist. Until then it
            refuses to guess rather than falling back on a fixed rule that would flag perfectly
            ordinary scrolling. {daysSeen} day{daysSeen === 1 ? '' : 's'} recorded so far.
          </div>
        )}

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.interventionEnabled}
            disabled={!baselineReady}
            onChange={(e) => void enableInterventions(e.target.checked)}
          />
          <span className="switch" />
          <span className="toggle-text">
            Allow Doomscroll to interrupt me
            {settings.interventionEnabled && !canNotify && (
              <span className="fine">
                Notifications are blocked, so the gentlest step can&rsquo;t run — the first
                thing you&rsquo;ll see is the full-screen prompt, further into a run. Allow
                notifications for this extension in Chrome to get the quieter nudge back.
              </span>
            )}
          </span>
        </label>
      </section>

      {interventions.length > 0 && (
        <section className="section">
          <h2 className="section-label">Intervention history</h2>
          <p className="section-note">
            These counts record intervention decisions and your responses. A decision may not
            have reached the page. “No early end recorded” means this extension did not receive
            a request to end the break early; it does not prove you stopped scrolling or measure
            activity on another device. These numbers do not establish effectiveness.
          </p>
          <table className="log">
            <thead>
              <tr>
                <th>Level</th>
                <th className="num">Decisions</th>
                <th className="num">Took a break</th>
                <th className="num">Dismissed</th>
                <th className="num">No recorded response</th>
                <th className="num">No early end recorded</th>
              </tr>
            </thead>
            <tbody>
              {summarizeInterventions(interventions).map((row) => (
                <tr key={row.level}>
                  <td>{LEVEL_LABELS[row.level]}</td>
                  <td className="num">{row.shown}</td>
                  <td className="num">{row.accepted}</td>
                  <td className="num">{row.bypassed}</td>
                  <td className="num">{row.pending}</td>
                  <td className="num">
                    {/* A dash, not 0 of 0: no breaks taken is an absence of
                        evidence about breaks, not evidence they fail. */}
                    {row.breaks > 0 ? `${row.breaks - row.brokenEarly} of ${row.breaks}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="section">
        <h2 className="section-label">What counts as a pattern</h2>
        <p className="section-note">
          A category is flagged only when it both dominates your recent reels and runs well
          above your own usual rate for it. Both have to be true.
        </p>

        <div className="field">
          <div>
            <label className="field-name" htmlFor="window-size">
              Recent window
            </label>
            <div className="field-hint">How many of your latest reels are examined.</div>
          </div>
          <input
            id="window-size"
            type="number"
            min={SETTING_BOUNDS.patternWindowSize.min}
            max={SETTING_BOUNDS.patternWindowSize.max}
            value={settings.patternWindowSize}
            onChange={(e) => void patch({ patternWindowSize: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <div>
            <label className="field-name" htmlFor="dominance">
              Dominance
            </label>
            <div className="field-hint">
              Share of that window one category must hold. Raise it if the log rarely says
              &ldquo;no single category dominated&rdquo;.
            </div>
          </div>
          <input
            id="dominance"
            type="number"
            min={SETTING_BOUNDS.patternDominantThreshold.min}
            max={SETTING_BOUNDS.patternDominantThreshold.max}
            step={SETTING_BOUNDS.patternDominantThreshold.step}
            value={settings.patternDominantThreshold}
            onChange={(e) => void patch({ patternDominantThreshold: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <div>
            <label className="field-name" htmlFor="above-normal">
              Above normal
            </label>
            <div className="field-hint">
              How many times your own trailing rate it must exceed. Lower it if the log is full
              of &ldquo;normal for you&rdquo;.
            </div>
          </div>
          <input
            id="above-normal"
            type="number"
            min={SETTING_BOUNDS.patternBaselineMultiplier.min}
            max={SETTING_BOUNDS.patternBaselineMultiplier.max}
            step={SETTING_BOUNDS.patternBaselineMultiplier.step}
            value={settings.patternBaselineMultiplier}
            onChange={(e) => void patch({ patternBaselineMultiplier: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <div>
            <label className="field-name" htmlFor="session-gap">
              Session gap
            </label>
            <div className="field-hint">Minutes away before a new session starts.</div>
          </div>
          <input
            id="session-gap"
            type="number"
            min={SETTING_BOUNDS.sessionGapMinutes.min}
            max={SETTING_BOUNDS.sessionGapMinutes.max}
            value={Math.round(settings.sessionGapThresholdMs / MINUTE_MS)}
            onChange={(e) =>
              void patch({
                sessionGapThresholdMs: Number(e.target.value) * MINUTE_MS,
              })
            }
          />
        </div>
      </section>

      <section className="section">
        <h2 className="section-label">Categories worth flagging</h2>
        <p className="section-note">
          Only these can trigger an intervention. Being shown a lot of joyful content is not a
          problem worth interrupting.
        </p>
        <div className="chips">
          {CHARGED_CATEGORIES.map((category) => {
            const on = settings.watchedCategories.includes(category);
            return (
              <label className={`chip${on ? ' on' : ''}`} key={category}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    void patch({
                      watchedCategories: e.target.checked
                        ? [...settings.watchedCategories, category]
                        : settings.watchedCategories.filter((c) => c !== category),
                    })
                  }
                />
                <span className="swatch" style={{ background: colorForCategory(category) }} />
                {category}
              </label>
            );
          })}
        </div>
      </section>

      <TuningPanel tuning={tuning} />

      <DetectionLogPanel log={log} />

      {daily.length >= 3 && (
        <section className="section">
          <h2 className="section-label">What each day was made of</h2>
          <p className="section-note">
            One bar per day, scaled to the same height so the mix is comparable — a day you
            barely opened Instagram is dimmed, since three reels should not read as confidently
            as three hundred. The thirteen topic categories are pooled into one band: they are
            context, not the finding, and twenty-one colours in a bar this size is a texture
            rather than a chart. Hover a bar for the counts.
          </p>
          <DayStacks days={stackByDay(daily)} />
        </section>
      )}

      {sessions.length > 0 && (
        <section className="section">
          <h2 className="section-label">Sessions</h2>
          <p className="section-note">
            Each continuous stretch of scrolling. Open one to see the reels in the order they
            arrived — a run of one category shows up as a block of one colour, which is the
            thing detection acts on and the one thing no summary can show you.
          </p>
          <Sessions sessions={sessions} />
        </section>
      )}

      {authors && authors.authors.length > 0 && (
        <section className="section">
          <h2 className="section-label">Who you watch most</h2>
          <p className="section-note">
            By time spent, not reel count — thirty seconds on one creator says more than five
            reels flicked past in as many seconds. The share is how much of that creator&rsquo;s
            readable content carried an emotional register.
            {authors.unattributed > 0 && (
              <>
                {' '}
                {authors.unattributed} older reel
                {authors.unattributed === 1 ? '' : 's'}{' '}
                {authors.unattributed === 1 ? 'is' : 'are'} missing from this — creator names
                were only recorded from a later version onward, so long-standing creators are
                understated here.
              </>
            )}
          </p>
          <table className="log">
            <thead>
              <tr>
                <th>Creator</th>
                <th className="num">Time</th>
                <th className="num">Reels</th>
                <th className="num">Charged</th>
              </tr>
            </thead>
            <tbody>
              {authors.authors.map((row) => (
                <tr key={row.author}>
                  <td className="cat">{row.author}</td>
                  <td className="num">{formatDuration(row.watchMs)}</td>
                  <td className="num">{row.reels}</td>
                  <td className="num">
                    {/* Blank rather than 0% when nothing of theirs could be read:
                        a zero would claim a finding the data cannot support. */}
                    {row.classified ? formatPercent(row.chargedShare) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="section">
        <h2 className="section-label">Your data</h2>
        <p className="section-note">
          Reel history is kept for 90 days. Daily summaries are kept longer.
        </p>
        <div className="row">
          <button
            className="action"
            disabled={exporting !== null}
            onClick={() => void exportCsv('reels')}
          >
            {exporting === 'reels' ? 'Building\u2026' : 'Export reels'}
          </button>
          <button
            className="action"
            disabled={exporting !== null}
            onClick={() => void exportCsv('detection')}
          >
            {exporting === 'detection' ? 'Building\u2026' : 'Export detection log'}
          </button>
          {interventions.length > 0 && (
            <button
              className="action"
              disabled={exporting !== null}
              onClick={() => void exportCsv('interventions')}
            >
              {exporting === 'interventions' ? 'Building\u2026' : 'Export interruptions'}
            </button>
          )}
          <button
            className="action danger"
            onClick={() => {
              if (!confirm('Delete all tracked history? Settings are kept.')) return;
              // Reported rather than swallowed: this is the one button whose
              // silent failure leaves someone believing their history is gone.
              void send('CLEAR_DATA', {})
                .then(() => load())
                .catch((err: unknown) => {
                  setActionError(`Your history was not deleted. ${String(err)}`);
                });
            }}
          >
            Delete history
          </button>
          {saved && <span className="saved">Saved</span>}
        </div>
        {actionError && <p className="action-error">{actionError}</p>}
      </section>
    </div>
  );
}
