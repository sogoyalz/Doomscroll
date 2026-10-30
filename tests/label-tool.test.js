import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, describe, expect, it } from 'vitest';

// Run the actual standalone tool, including its export serializer.
const page = new JSDOM(readFileSync(resolve('tools/label.html'), 'utf8'), {
  runScripts: 'dangerously',
});
afterAll(() => page.window.close());

describe('labeling tool CSV export', () => {
  it.each(['=1+1', '+1+1', '-1+1', '@SUM(A1)', '\ttabbed', '\rcarriage'])(
    'neutralizes spreadsheet formula input %j',
    (input) => {
      const output = page.window.cell(input);
      expect(page.window.parseCSV('value\n' + output)[1][0]).toBe("'" + input);
    },
  );

  it.each(['ordinary caption', 'a,b', 'say "hello"', 'two\nlines'])(
    'preserves ordinary text %j through CSV parsing',
    (input) => {
      expect(page.window.parseCSV('value\n' + page.window.cell(input))[1][0]).toBe(input);
    },
  );
});
