import { describe, test, expect } from 'vitest';
import { escapeCSV, toCSV } from '../src/lib/csv.ts';

describe('escapeCSV', () => {
  test('wraps values in quotes and doubles internal quotes', () => {
    expect(escapeCSV('plain')).toBe('"plain"');
    expect(escapeCSV('say "hi"')).toBe('"say ""hi"""');
  });

  test('coerces null/undefined to an empty quoted field', () => {
    expect(escapeCSV(null)).toBe('""');
    expect(escapeCSV(undefined)).toBe('""');
    expect(escapeCSV(1500)).toBe('"1500"');
  });

  test('neutralizes formula-injection triggers with a leading quote', () => {
    // Scraped IG captions are attacker-controlled; cells starting with these
    // must not execute as formulas in Excel/Sheets.
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      const out = escapeCSV(`${lead}cmd`);
      expect(out).toBe(`"'${lead}cmd"`);
    }
  });

  test('leaves safe values untouched apart from quoting', () => {
    expect(escapeCSV('happy')).toBe('"happy"');
    expect(escapeCSV('a=b')).toBe('"a=b"'); // = not at the start is fine
  });
});

describe('toCSV', () => {
  test('joins a header and escaped rows with newlines', () => {
    const csv = toCSV(['mood', 'note'], [['happy', 'great =day']]);
    expect(csv).toBe('mood,note\n"happy","great =day"');
  });

  test('escapes a dangerous cell inside a row', () => {
    const csv = toCSV(['caption'], [['=HYPERLINK("evil")']]);
    expect(csv).toBe('caption\n"\'=HYPERLINK(""evil"")"');
  });
});
