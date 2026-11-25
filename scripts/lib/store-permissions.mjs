// The store listing asks for a human to confirm the packaged manifest
// declares no permission the code does not use. This is that check.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const DECLARED_PERMISSIONS = ['alarms', 'storage', 'offscreen'];
export const OPTIONAL_PERMISSIONS = ['notifications'];
export const HOST_PERMISSIONS = ['https://www.instagram.com/*'];

const FORBIDDEN = [
  { pattern: /\bfetch\s*\(/, label: 'network fetch' },
  { pattern: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { pattern: /\bWebSocket\b/, label: 'WebSocket' },
  { pattern: /\bsendBeacon\s*\(/, label: 'sendBeacon' },
  { pattern: /chrome\.cookies\b/, label: 'chrome.cookies' },
  { pattern: /chrome\.history\b/, label: 'chrome.history' },
  { pattern: /chrome\.identity\b/, label: 'chrome.identity' },
  { pattern: /chrome\.scripting\b/, label: 'chrome.scripting' },
  {
    pattern: /chrome\.tabs\.(?:query|create|update|captureVisibleTab)\b/,
    label: 'tabs permission API',
  },
];

function sourceFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(name)) files.push(path);
  }
  return files;
}

function codeLines(text) {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*');
    })
    .join('\n');
}

function sameSet(actual, expected) {
  const left = [...(actual ?? [])].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * Problems that would make the Chrome Web Store permission review untrue.
 * `sources` is a list of { path, text } so tests can pass fixtures.
 */
export function auditStorePermissions({ manifest, sources }) {
  const problems = [];
  if (!sameSet(manifest.permissions, DECLARED_PERMISSIONS)) {
    problems.push(
      `permissions must be exactly ${DECLARED_PERMISSIONS.join(', ')} (got ${(manifest.permissions ?? []).join(', ') || 'none'})`,
    );
  }
  if (!sameSet(manifest.optional_permissions, OPTIONAL_PERMISSIONS)) {
    problems.push(`optional_permissions must be exactly ${OPTIONAL_PERMISSIONS.join(', ')}`);
  }
  if (!sameSet(manifest.host_permissions, HOST_PERMISSIONS)) {
    problems.push(`host_permissions must be exactly ${HOST_PERMISSIONS.join(', ')}`);
  }

  const joined = sources.map((source) => codeLines(source.text)).join('\n');
  if (!joined.includes('chrome.storage')) problems.push('storage is declared but never used');
  if (!joined.includes('chrome.alarms')) problems.push('alarms is declared but never used');
  if (!joined.includes('chrome.notifications')) {
    problems.push('notifications is declared but never used');
  }
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(joined))
      problems.push(`source uses ${rule.label}, which the listing says it does not`);
  }

  for (const script of manifest.content_scripts ?? []) {
    if (!sameSet(script.matches, HOST_PERMISSIONS)) problems.push('unexpected content script hosts');
  }
  return problems;
}

export function auditSourceTree(manifest, sourceRoot) {
  const sources = sourceFiles(sourceRoot).map((path) => ({
    path,
    text: readFileSync(path, 'utf8'),
  }));
  const problems = auditStorePermissions({ manifest, sources });
  for (const entry of ['index.ts', 'main-world.ts']) {
    if (!readFileSync(join(sourceRoot, 'content', entry), 'utf8').trimEnd().endsWith('startOnTrackingSurface(start);')) {
      problems.push('content entry must defer startup on private routes: ' + entry);
    }
  }
  return problems;
}
