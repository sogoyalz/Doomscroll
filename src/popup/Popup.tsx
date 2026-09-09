// Popup dashboard.
//
// Copy discipline: everything here describes the CONTENT the feed served,
// never the person watching it. "Breakup was 70% of what you were shown" is a
// statement about Instagram and is supportable. "You seem heartbroken" would
// be a statement about the user, and this data cannot carry it.

import { useCallback, useEffect, useState } from 'react';
import { send } from '@shared/client.js';
import { UNCLASSIFIED } from '@shared/aggregation.js';
import { isCharged } from '@shared/taxonomy.js';
import { MIN_BASELINE_DAYS } from '@shared/patterns.js';
import { colorForCategory, UNCLASSIFIED_COLOR } from '@shared/palette.js';
import {
  chargedShareByDay,
  planTrend,
  THIN_DAY_SAMPLE,
  type DayShare,
} from '@shared/insights.js';
import { TrendChart } from './TrendChart.js';
import {
  isDrifting,
  isShortcodeDegraded,
  readHealth,
  type ExtractionHealth,
} from '@shared/health.js';
import { formatDuration, formatPace, formatPercent } from '@shared/format.js';
import { localDateKey } from '@shared/time.js';
import { readStorageFailure } from '@shared/storage-health.js';
import type { DailyAggregate } from '@shared/types.js';
import './popup.css';

type Range = 'today' | '7d' | '30d';

const RANGE_TABS: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Week' },
  { value: '30d', label: 'Month' },
];

interface Slice {
  category: string;
  count: number;
  share: number;
}

interface Totals {
  reels: number;
  minutes: number;
  longestBingeMs: number;
  pace: number;
  slices: Slice[];
}

function summarize(days: DailyAggregate[]): Totals {
  const counts: Record<string, number> = {};
  let reels = 0;
  let minutes = 0;
  let longestBingeMs = 0;

  for (const day of days) {
    reels += day.totalReels;
    minutes += day.totalMinutes;
    longestBingeMs = Math.max(longestBingeMs, day.longestBingeMs);
    for (const [category, n] of Object.entries(day.categoryBreakdown)) {
      counts[category] = (counts[category] ?? 0) + n;
    }
  }

  // Rank tier: charged findings first (what the tool is about), then topics,
  // then neutral, then no-text — each block sorted by count within itself.
  const rankOf = (category: string): number => {
    if (category === UNCLASSIFIED) return 3;
    if (category === 'neutral') return 2;
    return isCharged(category) ? 0 : 1;
  };

  const slices = Object.entries(counts)
    .map(([category, count]) => ({ category, count, share: reels ? count / reels : 0 }))
    .sort((a, b) => rankOf(a.category) - rankOf(b.category) || b.count - a.count);

  return {
    reels,
    minutes,
    longestBingeMs,
    pace: minutes > 0 ? reels / (minutes * 60) : 0,
    slices,
  };
}

/** Splits "1h 24m" so the units can be set quieter than the numbers. */
function heroParts(ms: number): { value: string; unit: string }[] {
  return formatDuration(ms)
    .split(' ')
    .map((part) => {
      const match = /^(\d+)(\D+)$/.exec(part);
      return match ? { value: match[1]!, unit: match[2]! } : { value: part, unit: '' };
    });
}

/** Days of history the trend is drawn over. */
const TREND_DAYS = 30;

/**
 * Change worth naming, in share points.
 *
 * Below this the halves are describing the same feed, and calling it a rise
 * would be inviting the reader to see a direction in noise.
 */
const TREND_MOVE = 0.1;

/**
 * A sentence about the direction, or none.
 *
 * Compares the first half of the period against the second rather than the
 * first day against the last: two single days are the noisiest possible
 * summary of a month.
 *
 * Copy rule, as everywhere: this describes what the feed served, never what
 * the reader is feeling. A rise in charged content is a fact about Instagram's
 * ranking; it is not evidence about the person watching.
 */
function describeTrend(days: DayShare[]): string {
  const usable = days.filter((d) => d.classified >= THIN_DAY_SAMPLE);
  if (usable.length < 6) return 'Not enough readable days yet to show a direction.';

  const mid = Math.floor(usable.length / 2);
  const mean = (rows: DayShare[]) => rows.reduce((sum, d) => sum + d.share, 0) / rows.length;
  const before = mean(usable.slice(0, mid));
  const after = mean(usable.slice(mid));
  const move = after - before;

  if (Math.abs(move) < TREND_MOVE) return 'Roughly steady across the period.';
  return move > 0
    ? `Your feed has been serving more of it lately — up ${formatPercent(move)} on the first half of the period.`
    : `Your feed has been serving less of it lately — down ${formatPercent(-move)} on the first half of the period.`;
}

/** Days with activity, excluding today — which the baseline ignores. */
function baselineDaysAvailable(days: DailyAggregate[], todayKey: string): number {
  return days.filter((d) => d.date !== todayKey && d.totalReels > 0).length;
}

export function Popup() {
  const [range, setRange] = useState<Range>('today');
  const [days, setDays] = useState<DailyAggregate[] | null>(null);
  const [history, setHistory] = useState<DailyAggregate[]>([]);
  const [health, setHealth] = useState<ExtractionHealth | null>(null);
  const [tracking, setTracking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [writeFailed, setWriteFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ranged, month, extraction, settings, failure] = await Promise.all([
        send('GET_STATS', { range }),
        send('GET_STATS', { range: '30d' }),
        readHealth(),
        send('GET_SETTINGS', {}),
        readStorageFailure(),
      ]);
      setDays(ranged);
      setHistory(month);
      setHealth(extraction);
      setTracking(settings.trackingEnabled);
      setWriteFailed(failure !== null);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [range]);

  const toggleTracking = useCallback(async () => {
    const next = !tracking;
    setTracking(next);
    await send('UPDATE_SETTINGS', { trackingEnabled: next });
  }, [tracking]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="state">
        <strong>Couldn&rsquo;t load your stats</strong>
        {error}
      </div>
    );
  }

  if (!days) return <div className="state">Loading</div>;

  const totals = summarize(days);
  // Must use the same helper that produced the stored `date` values, not a
  // locale-formatted lookalike — this key is compared against them.
  const todayKey = localDateKey(Date.now());
  const readyDays = baselineDaysAvailable(history, todayKey);
  const baselineReady = readyDays >= MIN_BASELINE_DAYS;
  // Two different breakages, one banner: from the popup's point of view both
  // mean "the numbers below are unreliable, go read Settings". Which one it is
  // matters when fixing it, and that detail lives in the Options alerts.
  const degraded = health ? isDrifting(health) || isShortcodeDegraded(health) : false;

  // Drawn from the 30-day history regardless of the selected range: a trend
  // needs more days than "today" has, and the point of it is the slow drift
  // that a short window cannot show.
  const trend = chargedShareByDay(history).slice(-TREND_DAYS);
  // Through planTrend, not off the end of the raw series. The last day is
  // often today with a handful of reels in it, and one classified reel gives a
  // "share" of 0% or 100% — quoting that as the headline is the same
  // misreading the chart already refuses to draw. Both now use one answer.
  const trendPlan = planTrend(trend);
  const trendLatest = trendPlan.plotted[trendPlan.plotted.length - 1];

  return (
    <>
      <header className="head">
        <h1 className="brand">Doomscroll</h1>
        <div className="tabs" role="tablist" aria-label="Time range">
          {RANGE_TABS.map((tab) => (
            <button
              key={tab.value}
              className="tab"
              role="tab"
              aria-selected={range === tab.value}
              onClick={() => setRange(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {!tracking && (
        <div className="paused">
          <span className="paused-dot" />
          Tracking is paused. Nothing is being recorded.
        </div>
      )}

      {writeFailed && (
        <div className="state alarm">
          <strong>Reels aren&rsquo;t being saved</strong>
          The last one couldn&rsquo;t be written to storage — usually a full disk, or site data
          blocked for this profile. Watching continues and saving resumes on its own once
          there is room; nothing below is up to date until then.
        </div>
      )}

      {totals.reels === 0 ? (
        <div className="state">
          <strong>Nothing tracked yet</strong>
          {tracking
            ? 'Open instagram.com and watch a few reels — this picks up the ones you actually stop on. Nothing to configure.'
            : 'Tracking is paused, so nothing is being recorded. Resume it below when you want it back.'}
        </div>
      ) : (
        <>
          <section className="hero">
            <div className="hero-value">
              {heroParts(totals.minutes * 60_000).map((part, i) => (
                <span key={i}>
                  {part.value}
                  <span className="unit">{part.unit}</span>
                </span>
              ))}
            </div>
            <div className="hero-meta">
              <span>{totals.reels} reels</span>
              <span className="sep">·</span>
              <span>{formatPace(totals.pace)}</span>
              <span className="sep">·</span>
              <span>{formatDuration(totals.longestBingeMs)} longest run</span>
            </div>
          </section>

          <section className="mix">
            <div className="mix-bar">
              {totals.slices.map(({ category, share }) => (
                <span
                  key={category}
                  className={`mix-seg${category === UNCLASSIFIED ? ' is-empty' : ''}`}
                  style={{
                    width: `${share * 100}%`,
                    background:
                      category === UNCLASSIFIED ? UNCLASSIFIED_COLOR : colorForCategory(category),
                  }}
                />
              ))}
            </div>

            <div className="legend">
              {totals.slices.map(({ category, count, share }) => {
                const empty = category === UNCLASSIFIED;
                return (
                  <div className={`legend-row${empty ? ' is-empty' : ''}`} key={category}>
                    <span
                      className={`dot${empty ? ' is-empty' : ''}`}
                      style={{ background: colorForCategory(category) }}
                    />
                    <span className="legend-name">{empty ? 'no text' : category}</span>
                    <span className="legend-count">{count}</span>
                    <span className="legend-pct">{formatPercent(share)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {trendPlan.drawable && trendLatest && (
            <section className="trend-block">
              <div className="trend-head">
                <span className="trend-label">Emotionally charged share</span>
                <span className="trend-value">{formatPercent(trendLatest.share)}</span>
              </div>
              <TrendChart days={trend} />
              <p className="trend-note">
                Share of readable reels carrying an emotional register, per day over the last{' '}
                {trend.length} days.{' '}
                {describeTrend(trend)}
              </p>
            </section>
          )}
        </>
      )}

      <section className="strip">
        <div className="strip-head">
          <span className="strip-label">Pattern detection</span>
          <span className="strip-value">
            {degraded ? 'needs attention' : baselineReady ? 'watching' : `${readyDays}/${MIN_BASELINE_DAYS} days`}
          </span>
        </div>

        {!baselineReady && !degraded && (
          <div className="ticks" aria-hidden="true">
            {Array.from({ length: MIN_BASELINE_DAYS }, (_, i) => (
              <span key={i} className={`tick${i < readyDays ? ' on' : ''}`} />
            ))}
          </div>
        )}

        <p className={`strip-note${degraded ? ' warn' : ''}`}>
          {degraded
            ? 'Instagram’s layout may have changed — these numbers are unreliable. See Settings.'
            : baselineReady
              ? 'Logging what it would flag. Nothing will interrupt you until you allow it in Settings.'
              : 'Compares against your own normal, so it needs a week of history first.'}
        </p>
      </section>

      <footer className="foot">
        <button className="link" onClick={() => chrome.runtime.openOptionsPage()}>
          Settings
        </button>
        <button
          className={`link${tracking ? '' : ' is-paused'}`}
          onClick={() => void toggleTracking()}
        >
          {tracking ? 'Pause tracking' : 'Resume tracking'}
        </button>
      </footer>
    </>
  );
}
