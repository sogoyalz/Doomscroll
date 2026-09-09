// Shared plumbing for the offline analysis scripts.
//
// Extracted from eval.mjs when a second script needed the same CSV parsing,
// the same esbuild-from-source loader, and — critically — the same notion of
// what a classifier input is. Two copies of `inputOf` drifting apart would
// mean the labeling sheet and the benchmark disagreed about what the
// classifier was even shown, which is the one thing this tooling exists to
// pin down.

import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Minimal RFC-4180 CSV parser. */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ''));
}

export function toObjects(rows) {
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** Reads a CSV file straight to records. */
export function readRecords(file) {
  return toObjects(parseCSV(readFileSync(file, 'utf8')));
}

export function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Bundles a TS module through esbuild's Node API and imports it.
 *
 * The point is that these scripts measure exactly what ships — there is no
 * parallel implementation to keep in sync.
 */
export async function loadModule(entry) {
  const esbuild = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'doomscroll-eval-'));
  const out = join(dir, 'mod.mjs');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'silent',
  });
  return import(pathToFileURL(out).href);
}

export const loadClassifier = () => loadModule('src/shared/classifier.ts');
export const loadTuning = () => loadModule('src/shared/tuning.ts');
export const loadTaxonomy = () => loadModule('src/shared/taxonomy.ts');

/** A CSV row as the classifier sees it. */
export function inputOf(rec) {
  return {
    captionText: rec.captionText || null,
    hashtags: (rec.hashtags || '').split(/\s+/).filter(Boolean),
    audioName: rec.audioName || null,
  };
}

/** True when a row carries anything the classifier could read. */
export function hasText(rec) {
  const input = inputOf(rec);
  return Boolean(input.captionText || input.hashtags.length || input.audioName);
}

/**
 * Identity for de-duplicating rows across sheets.
 *
 * The labeling sheets drop the id column, so rows can only be matched on the
 * text the labeler actually saw.
 */
export function rowKey(rec) {
  // Joined on a character that cannot occur in the fields, so a caption ending
  // in what looks like a hashtag list cannot collide with a different row.
  // Written as an escape, never a literal: a raw NUL in the source makes git
  // treat this file as binary and stop diffing it.
  return [rec.captionText || '', rec.hashtags || '', rec.audioName || ''].join('\u0000');
}
