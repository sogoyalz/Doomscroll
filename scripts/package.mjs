// Packages dist/ into an uploadable zip, after checking the things that are
// easy to get wrong and invisible until Chrome rejects the upload — or worse,
// accepts it and the extension quietly does nothing.
//
// Run via `npm run package`.

import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  lstatSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
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
const minimumChrome = Number(manifest.minimum_chrome_version?.split('.')[0]);
if (!Number.isInteger(minimumChrome) || minimumChrome < 116) {
  problems.push('minimum Chrome version must cover Promise-based notification delivery (116+)');
}

// An archive must contain only known build outputs. In particular, reject
// source maps, exports, credentials, browser profiles, and arbitrary public/
// files that Vite may have copied into dist.
function inspect(directory, prefix = '') {
  for (const name of readdirSync(directory)) {
    const path = prefix + name;
    const absolute = join(directory, name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) problems.push(`symlink in build: ${path}`);
    else if (stat.isDirectory()) inspect(absolute, path + '/');
    else if (
      !(
        path === 'manifest.json' ||
        path === 'service-worker-loader.js' ||
        /^assets\/[^/]+\.(?:js|css)$/.test(path) ||
        /^assets\/icons\/icon(?:16|48|128)\.png$/.test(path) ||
        /^src\/(?:popup|options)\/index\.html$/.test(path)
      )
    )
      problems.push(`unexpected file in build: ${path}`);
  }
}
inspect(dist);

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
const checksum = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
writeFileSync(zipPath + '.sha256', `${checksum}  ${zipName}\n`);
console.log(`    SHA-256 ${checksum}`);
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
