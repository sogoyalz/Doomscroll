// Packages dist/ into an uploadable zip, after checking the things that are
// easy to get wrong and invisible until Chrome rejects the upload — or worse,
// accepts it and the extension quietly does nothing.
//
// Run via `npm run package`.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

if (!existsSync(join(dist, 'manifest.json'))) {
  fail('dist/manifest.json is missing. Run `npm run build` first.');
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const problems = [];

if (manifest.version !== pkg.version) {
  // Chrome uses the manifest version; package.json is what everything else
  // reads. Letting them drift makes released builds hard to identify.
  problems.push(`manifest version ${manifest.version} != package.json ${pkg.version}`);
}

for (const size of ['16', '48', '128']) {
  const icon = manifest.icons?.[size];
  if (!icon) problems.push(`manifest declares no ${size}px icon`);
  else if (!existsSync(join(dist, icon))) problems.push(`icon missing from build: ${icon}`);
}

const scripts = manifest.content_scripts ?? [];
if (scripts.length < 2) {
  problems.push('expected two content scripts (isolated + MAIN world)');
}
if (!scripts.some((s) => s.world === 'MAIN')) {
  // Without this the React fiber bridge never runs and every reel falls back
  // to a derived identity — the extension still "works" but loses shortcodes.
  problems.push('no content script registered with "world": "MAIN"');
}
for (const script of scripts) {
  for (const file of script.js ?? []) {
    if (!existsSync(join(dist, file))) problems.push(`content script missing: ${file}`);
  }
}

const worker = manifest.background?.service_worker;
if (!worker) problems.push('no background service worker declared');
else if (!existsSync(join(dist, worker))) problems.push(`service worker missing: ${worker}`);

if (problems.length) {
  console.error('\n  Packaging checks failed:');
  for (const problem of problems) console.error(`    ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

const zipName = `doomscroll-${pkg.version}.zip`;
const zipPath = join(root, zipName);
rmSync(zipPath, { force: true });

try {
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: dist, stdio: 'inherit' });
} catch (err) {
  if (err.code === 'ENOENT') fail('`zip` is not installed or not on PATH.');
  throw err;
}

console.log(`\n  ✓ ${zipName}`);
console.log(`    ${scripts.length} content scripts, icons 16/48/128, worker ${worker}`);

// The store listing blocks on assets that live outside this repo, so nothing
// here can verify them. What it can do is say so at the one moment it matters:
// the zip is built and the next step is uploading it. A warning rather than a
// failure — the build is fine, the submission is not yet.
const listing = join(root, 'docs', 'store-listing.md');
if (existsSync(listing)) {
  const outstanding = readFileSync(listing, 'utf8')
    .split('\n')
    .filter((line) => line.includes('TODO'))
    .map((line) => line.split('|')[1]?.trim())
    .filter(Boolean);

  if (outstanding.length) {
    console.log('\n  Still needed before this can be submitted:');
    for (const item of outstanding) console.log(`    • ${item}`);
    console.log('    (docs/store-listing.md)');
  }
}
console.log('');
