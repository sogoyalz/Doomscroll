import { describe, it, expect } from 'vitest';
import { escapeCSV, interventionLogToCSV, reelEventsToCSV, toCSV } from '../src/shared/csv.ts';

describe('escapeCSV', () => {
  it('wraps values in quotes', () => {
    expect(escapeCSV('hello')).toBe('"hello"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeCSV('say "hi"')).toBe('"say ""hi"""');
  });

  it('renders null and undefined as empty', () => {
    expect(escapeCSV(null)).toBe('""');
    expect(escapeCSV(undefined)).toBe('""');
  });

  it('preserves newlines inside a quoted cell', () => {
    expect(escapeCSV('line1\nline2')).toBe('"line1\nline2"');
  });

  // Captions come from Instagram, so cells are attacker-controlled.
  describe('formula injection', () => {
    it.each([
      ['=HYPERLINK("http://evil","click")', '='],
      ['+1+1', '+'],
      ['-1+1', '-'],
      ['@SUM(A1)', '@'],
      ['\ttabbed', 'tab'],
      ['\rcarriage', 'CR'],
    ])('neutralizes a cell starting with %s (%s)', (input) => {
      expect(escapeCSV(input)).toBe(`"'${input.replace(/"/g, '""')}"`);
    });

    it('leaves an interior trigger character alone', () => {
      expect(escapeCSV('2+2 equals 4')).toBe('"2+2 equals 4"');
    });

    it('does not escape the neutralizing quote itself', () => {
      // The prefix is a single quote, which needs no CSV escaping.
      expect(escapeCSV('=evil')).toBe(`"'=evil"`);
    });
  });
});

describe('toCSV', () => {
  it('emits a header followed by escaped rows', () => {
    const csv = toCSV(['a', 'b'], [
      [1, 'x'],
      [2, 'y'],
    ]);
    expect(csv).toBe('a,b\n"1","x"\n"2","y"');
  });

  it('emits just the header for no rows', () => {
    expect(toCSV(['a', 'b'], [])).toBe('a,b');
  });
});

describe('reelEventsToCSV', () => {
  const event = {
    id: 'e1',
    reelShortcode: 'SYNTH-00001',
    sessionId: 's1',
    startedAt: 1700000000000,
    endedAt: 1700000005000,
    watchDurationMs: 5000,
    captionText: 'hello',
    hashtags: ['fyp', 'animation'],
    audioName: 'Sample Artist · Sample Track',
    category: 'joyful',
    categoryConfidence: 0.82,
    subtags: ['dance'],
  };

  it('writes timestamps as ISO strings', () => {
    const csv = reelEventsToCSV([event]);
    expect(csv).toContain(new Date(1700000000000).toISOString());
  });

  it('space-joins array fields', () => {
    expect(reelEventsToCSV([event])).toContain('"fyp animation"');
  });

  it('renders an unclassified event as empty cells, not "null"', () => {
    const csv = reelEventsToCSV([
      { ...event, category: null, categoryConfidence: null, subtags: [], captionText: null },
    ]);
    expect(csv).not.toContain('null');
  });

  it('neutralizes a formula-injecting caption', () => {
    const csv = reelEventsToCSV([{ ...event, captionText: '=cmd|calc' }]);
    expect(csv).toContain(`"'=cmd|calc"`);
  });

  it('emits only a header when there is nothing to export', () => {
    expect(reelEventsToCSV([]).split('\n')).toHaveLength(1);
  });

  it('exports the author handle', () => {
    expect(reelEventsToCSV([{ ...event, authorHandle: 'samplecreator' }])).toContain(
      '"samplecreator"',
    );
  });

  it('leaves the author cell empty for history recorded before it was captured', () => {
    // Events written before authorHandle existed carry no such field at all.
    // Export is how the user gets their data out, so an older row must still
    // serialize — as a blank cell, not as "undefined".
    const csv = reelEventsToCSV([event]);
    expect(csv).not.toContain('undefined');
    expect(csv.split('\n')).toHaveLength(2);
  });
});

describe('export survives corrupt rows', () => {
  const row = (over = {}) => ({
    id: 'e1',
    reelShortcode: 'abc',
    sessionId: 's1',
    startedAt: 1700000000000,
    endedAt: 1700000005000,
    watchDurationMs: 5000,
    captionText: 'hello',
    hashtags: [],
    audioName: null,
    category: 'sad',
    categoryConfidence: 0.8,
    subtags: [],
    ...over,
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['beyond the Date range', 8.64e15 + 1],
  ])('does not throw on a %s timestamp', (_label, bad) => {
    // Export is the only way the user gets their data out, so one unrepresentable
    // timestamp must not take the whole file down — new Date(NaN).toISOString()
    // throws RangeError, which previously failed the entire export.
    expect(() => reelEventsToCSV([row({ startedAt: bad })])).not.toThrow();
    expect(() => reelEventsToCSV([row({ endedAt: bad })])).not.toThrow();
  });

  it('blanks only the bad cell and still exports the rest of the row', () => {
    const csv = reelEventsToCSV([row({ startedAt: NaN })]);
    expect(csv).toContain('hello');
    expect(csv).toContain('abc');
    // The good timestamp on the same row survives.
    expect(csv).toContain(new Date(1700000005000).toISOString());
  });

  it('still exports the good rows alongside a corrupt one', () => {
    const csv = reelEventsToCSV([row({ id: 'good' }), row({ id: 'bad', startedAt: NaN })]);
    expect(csv.split('\n')).toHaveLength(3); // header + 2 rows
    expect(csv).toContain('good');
    expect(csv).toContain('bad');
  });
});

describe('interventionLogToCSV', () => {
  const entry = (over = {}) => ({
    id: 'i1',
    at: 1700000000000,
    sessionId: 's1',
    level: 'overlay',
    category: 'sad',
    streak: 12,
    share: 0.8,
    ratio: 2.125,
    outcome: 'accepted',
    respondedAt: 1700000004500,
    ...over,
  });

  it('derives how long the prompt was sat with', () => {
    expect(interventionLogToCSV([entry()])).toContain('"4500"');
  });

  it('leaves the response columns empty when it was never answered', () => {
    // 'pending' is real data — the prompt was decided on and never answered,
    // which includes never having been delivered.
    const csv = interventionLogToCSV([entry({ outcome: 'pending', respondedAt: null })]);
    expect(csv).toContain('"pending"');
    expect(csv).not.toContain('null');
  });

  it('writes an unbounded ratio as inf rather than crashing a spreadsheet', () => {
    expect(interventionLogToCSV([entry({ ratio: Infinity })])).toContain('"inf"');
  });

  it('neutralizes a formula-injecting category', () => {
    // The category is derived from scraped caption text.
    expect(interventionLogToCSV([entry({ category: '=cmd|calc' })])).toContain(`"'=cmd|calc"`);
  });

  it('emits only a header when nothing has been shown', () => {
    expect(interventionLogToCSV([]).split('\n')).toHaveLength(1);
  });
});
