// What each day was made of, one bar per day.
//
// Complements the popup's trend line rather than repeating it. The trend
// answers "is the charged share moving"; this answers "moving because of
// what" — a rise driven by `sad` and one driven by `romantic` are the same
// line and very different feeds.
//
// Bars are normalized to full height because composition is the question. That
// makes a three-reel day look as authoritative as a three-hundred-reel one, so
// thin days are dimmed rather than left to mislead. The counts are on the
// tooltip for anyone who wants the absolute numbers.

import { colorForCategory, UNCLASSIFIED_COLOR } from '@shared/palette.js';
import { UNCLASSIFIED } from '@shared/aggregation.js';
import { BAND_ORDER, TOPICS_BAND, type DayStack } from '@shared/insights.js';

interface Props {
  days: DayStack[];
}

/** Below this many days a per-day comparison has nothing to compare. */
const MIN_DAYS = 3;

/**
 * The two bands with no entry in the category palette.
 *
 * `topics` is an aggregate rather than a category, drawn in a single muted
 * grey so it reads as the context it is; `no text` keeps the palette's
 * near-background fill so it recedes.
 */
const BAND_COLORS: Record<string, string> = {
  // Distinctly lighter than the palette's neutral (#5a5a63). The two sit
  // adjacent in every bar and the first attempt put them a shade apart, which
  // read as one undifferentiated grey mass across the whole series.
  [TOPICS_BAND]: '#8a8a95',
  [UNCLASSIFIED]: UNCLASSIFIED_COLOR,
};

function colorFor(key: string): string {
  return BAND_COLORS[key] ?? colorForCategory(key);
}

function labelFor(key: string): string {
  if (key === TOPICS_BAND) return 'topics';
  if (key === UNCLASSIFIED) return 'no text';
  return key;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Day of the month alone.
 *
 * A bar is around twenty pixels wide across a month, and "30 Aug" is wider
 * than that — set to not wrap, it pushed the plot past its container and
 * raised a scrollbar that clipped the most recent bar. The month lives in the
 * caption below instead, where it is said once rather than thirty times.
 */
function dayNumber(date: string): string {
  return String(Number(date.split('-')[2]));
}

/** `2026-08-01` .. `2026-08-30` -> `1 Aug – 30 Aug`. */
function rangeCaption(days: DayStack[]): string {
  const label = (date: string) => {
    const [, month, day] = date.split('-');
    return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''}`;
  };
  return `${label(days[0]!.date)} – ${label(days[days.length - 1]!.date)}`;
}

/**
 * Which day labels to draw.
 *
 * A label under all thirty bars is unreadable at this width, and dropping them
 * entirely leaves the series unanchored in time. Roughly six, always including
 * the most recent day, which is the one being read.
 */
function labelledDates(days: DayStack[]): Set<string> {
  const step = Math.max(1, Math.round(days.length / 6));
  const dates = new Set<string>();
  for (let i = days.length - 1; i >= 0; i -= step) dates.add(days[i]!.date);
  return dates;
}

export function DayStacks({ days }: Props) {
  if (days.length < MIN_DAYS) return null;

  const labelled = labelledDates(days);
  // Legend covers only what is actually present, so a feed that never serves
  // `angry` does not carry a swatch implying it might.
  const seen = new Set(days.flatMap((d) => d.bands.map((b) => b.key)));
  const present = BAND_ORDER.filter((key) => seen.has(key));

  return (
    <div className="stacks">
      <div className="stacks-plot">
        {days.map((day) => (
          <div className={`stack-col${day.thin ? ' is-thin' : ''}`} key={day.date}>
            <div
              className="stack-bar"
              title={
                `${day.date} — ${day.totalReels} reel${day.totalReels === 1 ? '' : 's'}\n` +
                day.bands
                  .map((b) => `${labelFor(b.key)}: ${b.count} (${Math.round(b.share * 100)}%)`)
                  .join('\n')
              }
            >
              {/* Reversed: the first band should sit at the BOTTOM of the bar,
                  and a column flexbox stacks downward. Charged registers
                  anchored to a common edge is what makes them comparable
                  across days. */}
              {[...day.bands].reverse().map((band) => (
                <span
                  key={band.key}
                  className="stack-band"
                  style={{ height: `${band.share * 100}%`, background: colorFor(band.key) }}
                />
              ))}
            </div>
            <span className="stack-date">{labelled.has(day.date) ? dayNumber(day.date) : ''}</span>
          </div>
        ))}
      </div>

      <div className="stacks-range">{rangeCaption(days)}</div>

      <div className="stacks-legend">
        {present.map((key) => (
          <span className="stacks-key" key={key}>
            <span className="dot" style={{ background: colorFor(key) }} />
            {labelFor(key)}
          </span>
        ))}
      </div>
    </div>
  );
}
