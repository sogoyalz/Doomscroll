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
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { auditSourceTree } from './lib/store-permissions.mjs';

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
        /^models\/nli-deberta-v3-xsmall\/(?:config.json|tokenizer.json|tokenizer_config.json|special_tokens_map.json|onnx\/model_quantized.onnx)$/.test(
          path,
        ) ||
        /^runtime\/ort-wasm-simd-threaded(?:\.jsep|\.asyncify)?\.(?:mjs|wasm)$/.test(path) ||
        path === 'MODEL-LICENSE.txt' ||
        path === 'service-worker-loader.js' ||
        /^assets\/[^/]+\.(?:js|css|wasm|mjs)$/.test(path) ||
        /^assets\/icons\/icon(?:16|48|128)\.png$/.test(path) ||
        /^src\/(?:popup|options|model)\/index\.html$/.test(path)
      )
    )
      problems.push(`unexpected file in build: ${path}`);
  }
}
inspect(dist);
// Refuse a missing or tampered model even when packaging an existing dist.
const modelAssets = JSON.parse(readFileSync(join(root, 'scripts/model-assets.json'), 'utf8'));
for (const [file, expected] of Object.entries(modelAssets.files)) {
  const path = join(dist, 'models/nli-deberta-v3-xsmall', file);
  if (
    !existsSync(path) ||
    createHash('sha256').update(readFileSync(path)).digest('hex') !== expected
  ) {
    problems.push(`missing or altered model asset: ${file}`);
  }
}
for (const file of [
  'src/model/index.html',
  'runtime/ort-wasm-simd-threaded.asyncify.mjs',
  'runtime/ort-wasm-simd-threaded.asyncify.wasm',
  'MODEL-LICENSE.txt',
]) {
  if (!existsSync(join(dist, file))) problems.push(`missing model runtime: ${file}`);
}

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

// The store form is reviewed against the manifest. A permission the code does
// not use, or a network call the listing denies, is a rejection.
problems.push(...auditSourceTree(manifest, join(root, 'src')));

if (problems.length) {
  console.error('\n  Packaging checks failed:');
  for (const problem of problems) console.error(`    ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

const zipName = `doomscroll-${pkg.version}.zip`;
const zipPath = join(root, zipName);
rmSync(zipPath, { force: true });

// Stable order, timestamps, permissions and stripped host metadata make the
// archive reproducible without changing the working build's file metadata.
const staging = mkdtempSync(join(tmpdir(), 'doomscroll-package-'));
const archiveFiles = [];
function stage(directory, prefix = '') {
  for (const name of readdirSync(directory).sort()) {
    const relative = prefix + name;
    const source = join(directory, name);
    const target = join(staging, relative);
    if (lstatSync(source).isDirectory()) {
      mkdirSync(target, { recursive: true });
      stage(source, relative + '/');
    } else {
      copyFileSync(source, target);
      chmodSync(target, 0o644);
      const timestamp = new Date('2000-01-01T00:00:00Z');
      utimesSync(target, timestamp, timestamp);
      archiveFiles.push(relative);
    }
  }
}
try {
  stage(dist);
  execFileSync('zip', ['-Xq', zipPath, ...archiveFiles], {
    cwd: staging,
    env: { ...process.env, TZ: 'UTC' },
    stdio: 'inherit',
  });
} catch (err) {
  rmSync(zipPath, { force: true });
  if (err.code === 'ENOENT') fail('`zip` is not installed or not on PATH.');
  throw err;
} finally {
  rmSync(staging, { recursive: true, force: true });
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
