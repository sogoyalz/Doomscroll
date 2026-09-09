// Settings and the detection log.
//
// The log table is the point of this page. Pattern detection currently runs
// in log-only mode, and its thresholds are guesses until they have been
// checked against a real week of one person's scrolling — that check happens
// here, which is why each tuning field names the log value that tells you it
// needs changing.

import { useCallback, useEffect, useState } from 'react';
import { send } from '@shared/client.js';
import { CHARGED_CATEGORIES } from '@shared/taxonomy.js';
import { MIN_BASELINE_DAYS } from '@shared/patterns.js';
import { MINUTE_MS, SETTING_BOUNDS } from '@shared/defaults.js';
import { colorForCategory } from '@shared/palette.js';
import {
  formatDuration,
  formatPercent,
  formatRatio,
  formatTimestamp,
  reasonLabel,
} from '@shared/format.js';
import { localDateKey } from '@shared/time.js';
import { readStorageFailure, type StorageFailure } from '@shared/storage-health.js';
import {
  fallbackIdentityShare,
  isAudioDark,
  isDrifting,
  isShortcodeDegraded,
  readHealth,
  textlessShare,
  type ExtractionHealth,
} from '@shared/health.js';
import { LEVEL_LABELS, summarizeInterventions } from '@shared/intervene.js';
import {
  stackByDay,
  type AuthorBreakdown,
  type SessionSummary,
} from '@shared/insights.js';
import { DayStacks } from './DayStacks.js';
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
      panel(
        chrome.permissions.contains({ permissions: ['notifications'] }),
        setCanNotify,
      ),
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

  const patch = useCallback(async (update: Partial<UserSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...update } : prev));
    await send('UPDATE_SETTINGS', update);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
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
  const baselineReady = log.some((e) => e.reason !== 'insufficient-history');
  const daysSeen = new Set(log.map((e) => localDateKey(e.at))).size;
  const flagged = log.filter((e) => e.detected).length;
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

      {brandNew && (
        <div className="alert info welcome">
          <h2>You&rsquo;re set up. There&rsquo;s nothing else to do.</h2>
          <p>
            Go and use Instagram the way you normally would — this watches the Reels you
            actually stop on and works out what they have in common. Everything stays on this
            machine.
          </p>
          <p>
            It will look idle for about a week, and that is the design. It flags a category
            only when it runs well above <em>your own</em> usual rate for it, so it needs to
            learn your usual rate first. A fixed threshold would spend that week accusing you
            of a problem it had no way to measure.
          </p>
          <p>
            Nothing will interrupt you unless you switch it on below, and that switch stays
            disabled until the baseline exists. Come back in a few days and the popup will
            show how far along it is.
          </p>
        </div>
      )}

      {writeFailure && (
        <div className="alert danger">
          <h2>Reels aren&rsquo;t being saved</h2>
          <p>
            A write to the local database failed at {formatTimestamp(writeFailure.at)}. The
            usual causes are a full disk or site data blocked for this Chrome profile.
            Watching carries on and saving resumes by itself once writes succeed again, but
            reels watched in the meantime are lost, and every number on this page is stale
            until then.
          </p>
          <p className="fine">{writeFailure.message}</p>
        </div>
      )}

      {drifting && health && (
        <div className="alert danger">
          <h2>Tracking is probably broken</h2>
          <p>
            The creator name couldn&rsquo;t be read on{' '}
            {formatPercent(health.missingAuthor / health.samples)} of recent reels. That field
            is on every real reel, so Instagram has most likely changed its page layout and
            the extension needs updating. Treat the numbers below as unreliable.
          </p>
        </div>
      )}

      {!drifting && shortcodeDegraded && health && (
        <div className="alert danger">
          <h2>Reels aren&rsquo;t being identified reliably</h2>
          <p>
            {health.bridgeStatus === 'no-fiber'
              ? 'Instagram no longer exposes the internals the extension reads a reel’s ID from.'
              : `The reel ID couldn’t be read on ${formatPercent(
                  fallbackIdentityShare(health),
                )} of recent reels.`}{' '}
            Watch time is still being recorded, but reels are being identified by creator and
            video filename instead — which stops matching once Instagram rotates its video
            URLs, so the same reel can be counted twice. The extension needs updating.
          </p>
        </div>
      )}

      {!drifting && !shortcodeDegraded && audioDark && health && (
        <div className="alert danger">
          <h2>Audio isn&rsquo;t being read</h2>
          <p>
            The song/audio name resolved on almost none of your recent reels
            ({formatPercent(1 - health.missingAudio / health.samples)}). Most reels use
            licensed audio, so this points to a broken audio selector rather than the reels
            genuinely lacking it — and audio is a real signal for mood. The extraction code
            needs updating against Instagram&rsquo;s current layout.
          </p>
        </div>
      )}

      {!drifting && !shortcodeDegraded && !audioDark && textless > 0.6 && (
        <div className="alert info">
          <h2>Most of your reels have no text</h2>
          <p>
            {formatPercent(textless)} carried no caption, hashtags, or audio name, so they
            can&rsquo;t be categorised. Text is the only signal available — this is a limit of
            the approach, not a fault.
          </p>
        </div>
      )}

      <section className="section">
        <h2 className="section-label">Tracking</h2>
        <p className="section-note">
          When off, nothing is observed or recorded at all — the extension stops watching
          the page. Your existing history is kept.
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

      {health && health.samples > 0 && (
        <section className="section">
          <h2 className="section-label">Extraction health</h2>
          <p className="section-note">
            What the extension managed to read from your last {health.samples} reels. Captions,
            hashtags, and audio are all legitimately missing sometimes; the creator name and
            the reel ID are not, so those two are the ones worth watching.
          </p>
          <table className="log">
            <tbody>
              <tr>
                <td>Reel ID resolved</td>
                <td>{formatPercent(1 - fallbackIdentityShare(health))}</td>
              </tr>
              <tr>
                <td>Creator name resolved</td>
                <td>{formatPercent(1 - health.missingAuthor / health.samples)}</td>
              </tr>
              <tr>
                <td>Some readable text</td>
                <td>{formatPercent(1 - textless)}</td>
              </tr>
              <tr>
                <td>Audio name resolved</td>
                <td>{formatPercent(1 - health.missingAudio / health.samples)}</td>
              </tr>
              <tr>
                <td>Audio read via</td>
                <td>
                  {Object.entries(health.audioChannels).length
                    ? Object.entries(health.audioChannels)
                        .sort(([, a], [, b]) => b - a)
                        .map(([channel, count]) => `${channel} (${count})`)
                        .join(', ')
                    : 'nothing matched'}
                </td>
              </tr>
              <tr>
                <td>Page bridge</td>
                <td>
                  {health.bridgeStatus === 'ok'
                    ? 'working'
                    : health.bridgeStatus === 'no-fiber'
                      ? 'ran, but found nothing to read'
                      : 'not seen yet'}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <section className="section">
        <h2 className="section-label">Interventions</h2>
        <p className="section-note">
          Detection runs either way. With this off, results only go to the log below — which
          is how the first week is best spent.
        </p>

        {!baselineReady && (
          <div className="gate">
            <strong>Not available yet.</strong> Detection measures against your own normal,
            which needs roughly {MIN_BASELINE_DAYS} days of history to exist. Until then it
            refuses to guess rather than falling back on a fixed rule that would flag
            perfectly ordinary scrolling. {daysSeen} day{daysSeen === 1 ? '' : 's'} recorded
            so far.
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
          <h2 className="section-label">Did interrupting help?</h2>
          <p className="section-note">
            A tool that interrupts you has no business assuming the answer. If most of these
            were dismissed and the scrolling carried on regardless, the interruption is costing
            you attention and buying nothing — turn it off, or raise the thresholds.{' '}
            <strong>Breaks held</strong> is the closest thing here to a record of what
            happened rather than which button you pressed: taking a break leaves the feed, and
            a break only stops counting as held if you choose to end it early. Bouncing off
            the reminder and carrying on with the break still counts as held — as does closing
            the tab on it, which is the gap in this number worth knowing about.
          </p>
          <table className="log">
            <thead>
              <tr>
                <th>Level</th>
                <th className="num">Shown</th>
                <th className="num">Took a break</th>
                <th className="num">Kept scrolling</th>
                <th className="num">No answer</th>
                <th className="num">Breaks held</th>
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
            <div className="field-name">Recent window</div>
            <div className="field-hint">How many of your latest reels are examined.</div>
          </div>
          <input
            type="number"
            min={SETTING_BOUNDS.patternWindowSize.min}
            max={SETTING_BOUNDS.patternWindowSize.max}
            value={settings.patternWindowSize}
            onChange={(e) => void patch({ patternWindowSize: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <div>
            <div className="field-name">Dominance</div>
            <div className="field-hint">
              Share of that window one category must hold. Raise it if the log rarely says
              &ldquo;no single category dominated&rdquo;.
            </div>
          </div>
          <input
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
            <div className="field-name">Above normal</div>
            <div className="field-hint">
              How many times your own trailing rate it must exceed. Lower it if the log is
              full of &ldquo;normal for you&rdquo;.
            </div>
          </div>
          <input
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
            <div className="field-name">Session gap</div>
            <div className="field-hint">Minutes away before a new session starts.</div>
          </div>
          <input
            type="number"
            min={SETTING_BOUNDS.sessionGapMinutes.min}
            max={SETTING_BOUNDS.sessionGapMinutes.max}
            value={Math.round(settings.sessionGapThresholdMs / MINUTE_MS)}
            onChange={(e) =>
              void patch({ sessionGapThresholdMs: Number(e.target.value) * MINUTE_MS })
            }
          />
        </div>
      </section>

      <section className="section">
        <h2 className="section-label">Categories worth flagging</h2>
        <p className="section-note">
          Only these can trigger an intervention. Being shown a lot of joyful content is not
          a problem worth interrupting.
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

      {tuning && tuning.neutralReels > 0 && (
        <section className="section">
          <h2 className="section-label">Why so much neutral</h2>
          <p className="section-note">
            {tuning.neutralReels} of {tuning.totalReels} reels had readable text that matched
            nothing in the word list. These are the terms that came up most often in them.
            If they look like feelings, they are worth adding to{' '}
            <code>src/shared/lexicon.ts</code>. If they look like recipes, cricket, or
            product names, the feed genuinely is not emotional and neutral is the right
            answer.
          </p>

          <div className="terms">
            <div>
              <h3 className="terms-label">Hashtags</h3>
              {tuning.topHashtags.length === 0 ? (
                <p className="empty">None.</p>
              ) : (
                <ul className="term-list">
                  {tuning.topHashtags.map(({ term, count }) => (
                    <li key={term}>
                      <span>#{term}</span>
                      <span className="term-count">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="terms-label">Words</h3>
              {tuning.topWords.length === 0 ? (
                <p className="empty">None.</p>
              ) : (
                <ul className="term-list">
                  {tuning.topWords.map(({ term, count }) => (
                    <li key={term}>
                      <span>{term}</span>
                      <span className="term-count">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {tuning.sampleCaptions.length > 0 && (
            <>
              <h3 className="terms-label" style={{ marginTop: 22 }}>
                Captions that matched nothing
              </h3>
              <ul className="samples">
                {tuning.sampleCaptions.map((caption, i) => (
                  <li key={i}>{caption}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="section">
        <h2 className="section-label">Detection log</h2>
        <p className="section-note">
          Every check, including the ones that didn&rsquo;t fire — those are the useful half. An
          unbroken run of the same outcome is collapsed into one row; &ldquo;checks&rdquo; is how
          many reels it held for. &ldquo;Normal&rdquo; is your own rate over the last fortnight,
          weighted toward recent days; &ldquo;usual&rdquo; is the same thing over two months. When
          those two disagree, your feed has shifted recently.
          {flagged > 0
            ? ` ${flagged} of the last ${log.length} would have interrupted you.`
            : ' Nothing would have interrupted you yet.'}
        </p>

        {log.length === 0 ? (
          <p className="empty">No checks recorded yet. Scroll some reels and come back.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Category</th>
                  <th className="num">Share</th>
                  <th className="num">Normal</th>
                  <th className="num">Usual</th>
                  <th className="num">Ratio</th>
                  <th className="num">Run</th>
                  <th className="num">Checks</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {log.map((entry) => (
                  <tr key={entry.id}>
                    <td className="when">{formatTimestamp(entry.at)}</td>
                    <td className="cat">{entry.category ?? '—'}</td>
                    <td className="num">{entry.category ? formatPercent(entry.share) : '—'}</td>
                    <td className="num">
                      {entry.category ? formatPercent(entry.baselineShare) : '—'}
                    </td>
                    <td className="num">
                      {entry.category && entry.baselineShareLong !== undefined
                        ? formatPercent(entry.baselineShareLong)
                        : '—'}
                    </td>
                    <td className="num">{entry.category ? formatRatio(entry.ratio) : '—'}</td>
                    <td className="num">{entry.streak || '—'}</td>
                    <td className="num">{entry.occurrences ?? 1}</td>
                    <td>
                      <span className={`outcome${entry.detected ? ' hit' : ''}`}>
                        {reasonLabel(entry.reason)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {daily.length >= 3 && (
        <section className="section">
          <h2 className="section-label">What each day was made of</h2>
          <p className="section-note">
            One bar per day, scaled to the same height so the mix is comparable — a day you
            barely opened Instagram is dimmed, since three reels should not read as
            confidently as three hundred. The thirteen topic categories are pooled into one
            band: they are context, not the finding, and twenty-one colours in a bar this size
            is a texture rather than a chart. Hover a bar for the counts.
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
                {authors.unattributed} older reel{authors.unattributed === 1 ? '' : 's'}{' '}
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
            onClick={() =>
              void send('EXPORT_DATA', {}).then(({ reelsCsv }) =>
                download('doomscroll-reels.csv', reelsCsv),
              )
            }
          >
            Export reels
          </button>
          <button
            className="action"
            onClick={() =>
              void send('EXPORT_DATA', {}).then(({ detectionCsv }) =>
                download('doomscroll-detection-log.csv', detectionCsv),
              )
            }
          >
            Export detection log
          </button>
          {interventions.length > 0 && (
            <button
              className="action"
              onClick={() =>
                void send('EXPORT_DATA', {}).then(({ interventionsCsv }) =>
                  download('doomscroll-interventions.csv', interventionsCsv),
                )
              }
            >
              Export interruptions
            </button>
          )}
          <button
            className="action danger"
            onClick={() => {
              if (!confirm('Delete all tracked history? Settings are kept.')) return;
              void send('CLEAR_DATA', {}).then(() => load());
            }}
          >
            Delete history
          </button>
          {saved && <span className="saved">Saved</span>}
        </div>
      </section>
    </div>
  );
}
