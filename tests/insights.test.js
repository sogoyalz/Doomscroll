import { describe, it, expect } from 'vitest';
import {
  HALF_SCALE,
  THIN_DAY_SAMPLE,
  authorBreakdown,
  chargedShareByDay,
  longestChargedRun,
  MIN_TREND_POINTS,
  planTrend,
  runsOf,
  stackByDay,
  summarizeSession,
  TOPICS_BAND,
} from '../src/shared/insights.ts';
import { currentStreak } from '../src/shared/patterns.ts';
import { UNCLASSIFIED } from '../src/shared/aggregation.ts';

const day = (date, categoryBreakdown) => ({
  date,
  totalReels: Object.values(categoryBreakdown).reduce((a, b) => a + b, 0),
  totalMinutes: 5,
  avgReelsPerSec: 0.2,
  longestBingeMs: 1000,
  categoryBreakdown,
});

let nextId = 0;
const reel = (over = {}) => ({
  id: `e${nextId++}`,
  reelShortcode: 'abc',
  sessionId: 's1',
  startedAt: 1000,
  endedAt: 6000,
  watchDurationMs: 5000,
  captionText: null,
  hashtags: [],
  audioName: null,
  authorHandle: 'creator',
  category: 'comedy',
  categoryConfidence: 0.8,
  subtags: [],
  ...over,
});

describe('chargedShareByDay', () => {
  it('measures charged reels against classified ones', () => {
    const [row] = chargedShareByDay([day('2026-08-01', { sad: 3, comedy: 7 })]);
    expect(row.share).toBeCloseTo(0.3);
    expect(row.classified).toBe(10);
  });

  it('excludes unreadable reels from the denominator', () => {
    // Otherwise a day where half the feed had no text shows a suppressed
    // charged share for a reason that has nothing to do with the content.
    const [row] = chargedShareByDay([
      day('2026-08-01', { sad: 3, comedy: 7, [UNCLASSIFIED]: 90 }),
    ]);
    expect(row.share).toBeCloseTo(0.3);
    expect(row.classified).toBe(10);
  });

  it('counts neutral as classified, because it is', () => {
    // Neutral means the classifier read something and found nothing charged.
    const [row] = chargedShareByDay([day('2026-08-01', { sad: 1, neutral: 3 })]);
    expect(row.share).toBeCloseTo(0.25);
  });

  it('keeps a day where nothing could be read, rather than dropping it', () => {
    // A gap in the line would read as "did not scroll" instead of "little
    // could be read", which is the opposite impression.
    const rows = chargedShareByDay([
      day('2026-08-01', { sad: 5 }),
      day('2026-08-02', { [UNCLASSIFIED]: 40 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ share: 0, classified: 0 });
  });

  it('returns days oldest first regardless of input order', () => {
    const rows = chargedShareByDay([
      day('2026-08-03', { sad: 1 }),
      day('2026-08-01', { sad: 1 }),
      day('2026-08-02', { sad: 1 }),
    ]);
    expect(rows.map((r) => r.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('reports the sample so a thin day can be marked as such', () => {
    const [row] = chargedShareByDay([day('2026-08-01', { sad: 1 })]);
    expect(row.classified).toBeLessThan(THIN_DAY_SAMPLE);
  });

  it('shows a genuine drift that an adaptive baseline would absorb', () => {
    // The reason this chart exists: the detector's baseline adapts within
    // about a week, so a slow slide stops registering as unusual. Against a
    // fixed axis over a month it is plainly visible.
    const days = [];
    for (let i = 1; i <= 20; i++) {
      const sad = i <= 10 ? 1 : 8;
      days.push(day(`2026-08-${String(i).padStart(2, '0')}`, { sad, comedy: 9 }));
    }
    const rows = chargedShareByDay(days);
    expect(rows[0].share).toBeLessThan(0.2);
    expect(rows[rows.length - 1].share).toBeGreaterThan(0.4);
  });
});

describe('authorBreakdown', () => {
  it('ranks creators by time spent, not reel count', () => {
    // Thirty seconds on one creator says more than five reels flicked past.
    const { authors } = authorBreakdown([
      reel({ authorHandle: 'slow', watchDurationMs: 30_000 }),
      ...Array.from({ length: 5 }, () =>
        reel({ authorHandle: 'flicked', watchDurationMs: 1000 }),
      ),
    ]);
    expect(authors[0].author).toBe('slow');
    expect(authors[1].reels).toBe(5);
  });

  it('reports each creator’s charged share among their readable reels', () => {
    const { authors } = authorBreakdown([
      reel({ authorHandle: 'a', category: 'sad' }),
      reel({ authorHandle: 'a', category: 'comedy' }),
      reel({ authorHandle: 'a', category: null }),
    ]);
    expect(authors[0].classified).toBe(2);
    expect(authors[0].chargedShare).toBeCloseTo(0.5);
  });

  it('reports a zero share for a creator whose reels were all unreadable', () => {
    // classified is 0, so the UI can show a dash rather than claim 0%.
    const { authors } = authorBreakdown([reel({ authorHandle: 'a', category: null })]);
    expect(authors[0].classified).toBe(0);
    expect(authors[0].chargedShare).toBe(0);
  });

  it('counts reels with no author separately rather than dropping them', () => {
    // The honest caveat on the whole view: author handles were only stored
    // from a certain version on, so early history contributes nothing here.
    const result = authorBreakdown([
      reel({ authorHandle: 'a' }),
      reel({ authorHandle: null }),
      reel({ authorHandle: null }),
    ]);
    expect(result.attributed).toBe(1);
    expect(result.unattributed).toBe(2);
    expect(result.authors).toHaveLength(1);
  });

  it('honours the limit', () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      reel({ authorHandle: `creator${i}`, watchDurationMs: i * 1000 }),
    );
    expect(authorBreakdown(events, 5).authors).toHaveLength(5);
  });

  it('breaks ties by name so the order is stable', () => {
    const { authors } = authorBreakdown([
      reel({ authorHandle: 'zed', watchDurationMs: 1000 }),
      reel({ authorHandle: 'amy', watchDurationMs: 1000 }),
    ]);
    expect(authors.map((a) => a.author)).toEqual(['amy', 'zed']);
  });

  it('returns nothing usable from history with no authors at all', () => {
    const result = authorBreakdown([reel({ authorHandle: null })]);
    expect(result.authors).toEqual([]);
    expect(result.unattributed).toBe(1);
  });
});

describe('planTrend', () => {
  const share = (date, s, classified = 20) => ({ date, share: s, classified });

  it('plots only days with enough readable content', () => {
    const plan = planTrend([
      share('2026-08-01', 0.2),
      share('2026-08-02', 1.0, 1),
      share('2026-08-03', 0.3),
    ]);
    expect(plan.plotted.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-03']);
    expect(plan.thin.map((d) => d.date)).toEqual(['2026-08-02']);
  });

  it('keeps a one-reel day from becoming the tallest thing on the chart', () => {
    // The bug this exists to prevent: one classified reel gives a "share" of
    // 0% or 100%, and plotted it out-shouts every real movement.
    const plan = planTrend([
      share('2026-08-01', 0.2),
      share('2026-08-02', 1.0, 1),
      share('2026-08-03', 0.25),
      share('2026-08-04', 0.3),
    ]);
    expect(plan.plotted.every((d) => d.share <= 0.3)).toBe(true);
    expect(plan.ceiling).toBe(HALF_SCALE);
  });

  it('uses half scale for an ordinary month', () => {
    expect(planTrend([share('2026-08-01', 0.1), share('2026-08-02', 0.35)]).ceiling).toBe(
      HALF_SCALE,
    );
  });

  it('opens up to full scale only when a believable day exceeds half', () => {
    expect(planTrend([share('2026-08-01', 0.1), share('2026-08-02', 0.7)]).ceiling).toBe(1);
  });

  it('does not open the scale for a thin day’s extreme value', () => {
    // A single reel reading 100% must not rescale the whole chart and flatten
    // every real movement into the bottom half.
    expect(planTrend([share('2026-08-01', 0.2), share('2026-08-02', 1.0, 1)]).ceiling).toBe(
      HALF_SCALE,
    );
  });

  it('averages only the believable days', () => {
    const plan = planTrend([
      share('2026-08-01', 0.2),
      share('2026-08-02', 0.4),
      share('2026-08-03', 1.0, 1),
    ]);
    expect(plan.average).toBeCloseTo(0.3);
  });

  it('orders days oldest first regardless of input order', () => {
    const plan = planTrend([share('2026-08-03', 0.3), share('2026-08-01', 0.1)]);
    expect(plan.plotted.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-03']);
  });

  it('copes with a period where nothing was readable', () => {
    const plan = planTrend([share('2026-08-01', 0, 0), share('2026-08-02', 0, 0)]);
    expect(plan.plotted).toEqual([]);
    expect(plan.average).toBe(0);
    expect(plan.ceiling).toBe(HALF_SCALE);
  });
});

describe('stackByDay', () => {
  const bandsOf = (stack) => Object.fromEntries(stack.bands.map((b) => [b.key, b.count]));

  it('pools the thirteen topic categories into one band', () => {
    // Twenty-one stacked colours is a texture, not a chart. The taxonomy
    // already says topics are context and charged registers are the finding.
    const [stack] = stackByDay([
      day('2026-08-01', { comedy: 5, food: 3, gaming: 2, sad: 4 }),
    ]);
    expect(bandsOf(stack)).toEqual({ [TOPICS_BAND]: 10, sad: 4 });
  });

  it('keeps each charged category separate', () => {
    const [stack] = stackByDay([day('2026-08-01', { sad: 3, angry: 2, breakup: 1 })]);
    expect(bandsOf(stack)).toEqual({ sad: 3, angry: 2, breakup: 1 });
  });

  it('keeps neutral and no-text out of the topics band', () => {
    // Neutral means "read it, found nothing"; no-text means "nothing to read".
    // Folding either into topics would claim content that was never named.
    const [stack] = stackByDay([
      day('2026-08-01', { comedy: 2, neutral: 3, [UNCLASSIFIED]: 5 }),
    ]);
    expect(bandsOf(stack)).toEqual({ [TOPICS_BAND]: 2, neutral: 3, [UNCLASSIFIED]: 5 });
  });

  it('measures shares against the whole day, unreadable reels included', () => {
    // The no-text portion is a real part of what was watched; excluding it
    // would let a mostly-unreadable day present as confidently as any other.
    const [stack] = stackByDay([day('2026-08-01', { sad: 5, [UNCLASSIFIED]: 15 })]);
    expect(stack.totalReels).toBe(20);
    expect(stack.bands.find((b) => b.key === 'sad').share).toBeCloseTo(0.25);
  });

  it('orders bands the same way every day', () => {
    // A stacked bar whose bands reorder per day is unreadable — the eye tracks
    // a band's thickness across the series, which needs it in one place.
    const stacks = stackByDay([
      day('2026-08-01', { neutral: 1, sad: 1, comedy: 1 }),
      day('2026-08-02', { comedy: 1, neutral: 1, sad: 1 }),
    ]);
    expect(stacks[0].bands.map((b) => b.key)).toEqual(stacks[1].bands.map((b) => b.key));
  });

  it('puts charged categories at the start, so they share a common edge', () => {
    const [stack] = stackByDay([
      day('2026-08-01', { [UNCLASSIFIED]: 1, neutral: 1, comedy: 1, sad: 1 }),
    ]);
    expect(stack.bands.map((b) => b.key)).toEqual(['sad', TOPICS_BAND, 'neutral', UNCLASSIFIED]);
  });

  it('omits bands with nothing in them', () => {
    const [stack] = stackByDay([day('2026-08-01', { sad: 2 })]);
    expect(stack.bands).toHaveLength(1);
  });

  it('shares sum to one for any day with reels', () => {
    const [stack] = stackByDay([
      day('2026-08-01', { sad: 3, comedy: 7, neutral: 2, [UNCLASSIFIED]: 8 }),
    ]);
    expect(stack.bands.reduce((sum, b) => sum + b.share, 0)).toBeCloseTo(1);
  });

  it('flags a day too small for its mix to mean anything', () => {
    const [thin, solid] = stackByDay([
      day('2026-08-01', { sad: 2 }),
      day('2026-08-02', { sad: 40, comedy: 60 }),
    ]);
    expect(thin.thin).toBe(true);
    expect(solid.thin).toBe(false);
  });

  it('copes with a day that recorded nothing', () => {
    const [stack] = stackByDay([day('2026-08-01', {})]);
    expect(stack.bands).toEqual([]);
    expect(stack.totalReels).toBe(0);
    expect(stack.thin).toBe(true);
  });

  it('returns days oldest first regardless of input order', () => {
    const stacks = stackByDay([day('2026-08-03', { sad: 1 }), day('2026-08-01', { sad: 1 })]);
    expect(stacks.map((s) => s.date)).toEqual(['2026-08-01', '2026-08-03']);
  });
});

describe('runsOf', () => {
  const seq = (...categories) =>
    categories.map((category, i) => reel({ category, startedAt: 1000 + i * 10 }));

  it('finds contiguous runs in order', () => {
    const runs = runsOf(seq('sad', 'sad', 'comedy', 'sad'));
    expect(runs).toEqual([
      { category: 'sad', length: 2, startIndex: 0 },
      { category: 'comedy', length: 1, startIndex: 2 },
      { category: 'sad', length: 1, startIndex: 3 },
    ]);
  });

  it('lets an unreadable reel extend a run rather than break it', () => {
    // Must agree with currentStreak in patterns.ts: a text-free clip in the
    // middle of a stretch is not evidence the stretch ended, and counting it
    // as a break would make runs depend on how much happened to be readable.
    expect(runsOf(seq('sad', 'sad', null, 'sad'))[0]).toEqual({
      category: 'sad',
      length: 3,
      startIndex: 0,
    });
  });

  it('agrees with currentStreak on the run at the head of the feed', () => {
    // The drill-down shows what the detector acted on. If the two disagreed
    // the view would be worse than not having it.
    const events = seq('sad', 'sad', null, 'sad', 'comedy');
    const newestFirst = [...events].reverse();
    const trailing = runsOf(events).at(-1);
    expect(trailing.category).toBe('comedy');
    expect(currentStreak(newestFirst, 'comedy')).toBe(trailing.length);
  });

  it('returns nothing for a session with nothing readable', () => {
    expect(runsOf(seq(null, null))).toEqual([]);
  });

  it('returns nothing for an empty session', () => {
    expect(runsOf([])).toEqual([]);
  });
});

describe('longestChargedRun', () => {
  const seq = (...categories) =>
    categories.map((category, i) => reel({ category, startedAt: 1000 + i * 10 }));

  it('finds the longest run of an emotional register', () => {
    const run = longestChargedRun(seq('sad', 'sad', 'comedy', 'breakup', 'breakup', 'breakup'));
    expect(run).toMatchObject({ category: 'breakup', length: 3 });
  });

  it('ignores topic runs, however long', () => {
    // Being shown a lot of comedy is not what this tool is about.
    expect(longestChargedRun(seq('comedy', 'comedy', 'comedy', 'comedy'))).toBeNull();
  });

  it('ignores neutral runs', () => {
    expect(longestChargedRun(seq('neutral', 'neutral', 'neutral'))).toBeNull();
  });

  it('returns null for a session with no emotional content at all', () => {
    expect(longestChargedRun(seq('comedy', null, 'food'))).toBeNull();
  });
});

describe('summarizeSession', () => {
  const session = { id: 's1', startedAt: 1000, endedAt: 9000, reelCount: 99, totalDurationMs: 1, dominantCategory: null };
  const seq = (...categories) =>
    categories.map((category, i) =>
      reel({ category, startedAt: 1000 + i * 10, watchDurationMs: 2000 }),
    );

  it('bands the composition exactly as the per-day bars do', () => {
    // Same feed, two views: they must not disagree about what it contained.
    const summary = summarizeSession(session, seq('sad', 'comedy', 'food', 'neutral', null));
    expect(Object.fromEntries(summary.bands.map((b) => [b.key, b.count]))).toEqual({
      sad: 1,
      [TOPICS_BAND]: 2,
      neutral: 1,
      [UNCLASSIFIED]: 1,
    });
  });

  it('counts the reels actually stored, not the session record', () => {
    // The record is a running total maintained across writes; after a prune
    // the surviving events are the truth.
    const summary = summarizeSession(session, seq('sad', 'sad'));
    expect(summary.reelCount).toBe(2);
  });

  it('sums watch time from the events', () => {
    expect(summarizeSession(session, seq('sad', 'sad')).totalDurationMs).toBe(4000);
  });

  it('surfaces the longest emotional run', () => {
    const summary = summarizeSession(session, seq('sad', 'sad', 'sad', 'comedy'));
    expect(summary.longestRun).toMatchObject({ category: 'sad', length: 3 });
  });

  it('reports no run for an ordinary session', () => {
    expect(summarizeSession(session, seq('comedy', 'food', 'music')).longestRun).toBeNull();
  });

  it('copes with a session whose reels have all been pruned', () => {
    const summary = summarizeSession(session, []);
    expect(summary).toMatchObject({ reelCount: 0, totalDurationMs: 0, bands: [], longestRun: null });
  });

  it('carries the session’s own timestamps through', () => {
    const summary = summarizeSession(session, seq('sad'));
    expect(summary).toMatchObject({ id: 's1', startedAt: 1000, endedAt: 9000 });
  });
});

describe('planTrend drawability', () => {
  const share = (date, s, classified = 20) => ({ date, share: s, classified });

  it('is not drawable below the minimum believable days', () => {
    const plan = planTrend([share('2026-08-01', 0.2), share('2026-08-02', 0.3)]);
    expect(plan.plotted).toHaveLength(2);
    expect(plan.drawable).toBe(false);
  });

  it('is drawable at the minimum', () => {
    const plan = planTrend([
      share('2026-08-01', 0.2),
      share('2026-08-02', 0.3),
      share('2026-08-03', 0.25),
    ]);
    expect(plan.plotted).toHaveLength(MIN_TREND_POINTS);
    expect(plan.drawable).toBe(true);
  });

  it('is not drawable when every day is too thin, however many there are', () => {
    // The bug this closes: the popup gated its section on raw day count while
    // the chart gated on believable days, so four two-reel days rendered a
    // headline percentage above the empty space where the chart declined to
    // draw — and the percentage was a 1-of-2 day reading 50%.
    const days = ['01', '02', '03', '04'].map((d) => share(`2026-08-${d}`, 0.5, 2));
    const plan = planTrend(days);
    expect(days.length).toBeGreaterThanOrEqual(MIN_TREND_POINTS);
    expect(plan.drawable).toBe(false);
    expect(plan.plotted).toEqual([]);
  });

  it('offers no latest value to quote when nothing is believable', () => {
    const plan = planTrend([share('2026-08-01', 1.0, 1)]);
    expect(plan.plotted[plan.plotted.length - 1]).toBeUndefined();
  });
});
