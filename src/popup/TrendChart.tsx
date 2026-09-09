// Charged share per day, drawn by hand.
//
// No chart library: the whole extension bundle is smaller than any of them,
// this draws one line, and a dependency here would be most of the download for
// a fraction of the value.
//
// The question it answers is the one the detector structurally cannot. A
// baseline that adapts — which it must, or it lectures anyone whose ordinary
// diet leans one way — absorbs a gradual slide within a week or two, so a slow
// drift into charged content stops registering as unusual. Drawn against a
// fixed axis over a month, the same drift is plainly visible. See
// LONG_BASELINE_DAYS in background/detect.ts for the same finding from the
// detector's side.
//
// The decisions — which days are believable, what the axis ceiling is — live
// in shared/insights.ts as planTrend(), so they can be tested without
// rendering anything. This file is only geometry.

import { planTrend, type DayShare } from '@shared/insights.js';

interface Props {
  days: DayShare[];
}

const WIDTH = 300;
const HEIGHT = 64;
const PAD_X = 2;
const PAD_Y = 6;

export function TrendChart({ days }: Props) {
  const { plotted, thin, ceiling, average, drawable } = planTrend(days);
  if (!drawable) return null;

  // Positions come from each day's place in the FULL series, so a gap where a
  // day was too thin to plot still occupies its share of the width — the line
  // spans it rather than compressing, and the ticks land under the right spot.
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const indexOf = new Map(ordered.map((d, i) => [d.date, i]));
  const count = ordered.length;

  const x = (date: string): number => {
    const i = indexOf.get(date) ?? 0;
    return count <= 1 ? WIDTH / 2 : PAD_X + (i / (count - 1)) * (WIDTH - PAD_X * 2);
  };
  const y = (share: number): number =>
    PAD_Y + (1 - Math.min(share / ceiling, 1)) * (HEIGHT - PAD_Y * 2);

  const line = plotted.map((d) => `${x(d.date).toFixed(1)},${y(d.share).toFixed(1)}`).join(' ');
  const latest = plotted[plotted.length - 1]!;

  return (
    <svg
      className="trend"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={
        `Emotionally charged share of readable reels, per day over ${count} days. ` +
        `Most recent ${Math.round(latest.share * 100)} percent, ` +
        `period average ${Math.round(average * 100)} percent.`
      }
    >
      {/* The period's own average, so the line has something to be read
          against. A bare line invites reading every wobble as a trend. */}
      <line
        x1={PAD_X}
        x2={WIDTH - PAD_X}
        y1={y(average)}
        y2={y(average)}
        className="trend-mean"
      />
      <polyline className="trend-line" points={line} />
      {plotted.map((d) => (
        <circle key={d.date} cx={x(d.date)} cy={y(d.share)} r={2} className="trend-dot" />
      ))}
      {/* Days too thin to assert a number for: marked as having happened,
          without a value being claimed. */}
      {thin.map((d) => (
        <line
          key={d.date}
          x1={x(d.date)}
          x2={x(d.date)}
          y1={HEIGHT - 2}
          y2={HEIGHT - 5}
          className="trend-thin-tick"
        />
      ))}
    </svg>
  );
}
