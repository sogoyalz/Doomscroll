// CSV serialization helpers shared by the popup and options export buttons.
//
// Reel caption/context text is scraped from instagram.com — i.e. fully
// attacker-controlled. Beyond normal quote-escaping we must also defend
// against CSV formula injection: a cell beginning with = + - @ (or a
// leading tab/CR) is interpreted as a live formula by Excel/Sheets/Numbers,
// so `=HYPERLINK(...)` in a caption would execute on open. We neutralize it
// by prefixing a single quote, which spreadsheets treat as "literal text".

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function escapeCSV(value: unknown): string {
  let s = (value ?? '').toString();
  if (FORMULA_TRIGGER.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// Serialize rows (already in column order) plus a header into a CSV string.
export function toCSV(header: string[], rows: (string | number)[][]): string {
  const lines = rows.map((row) => row.map((cell) => escapeCSV(cell)).join(','));
  return [header.join(','), ...lines].join('\n');
}

// Trigger a browser download of the given CSV text.
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
