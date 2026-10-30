// Prints file names and rule names only; never print matched secret values.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const refs = process.argv.slice(2);
const privatePath =
  /(?:^|\/)(?:Screenshot[^/]*|Screen Recording[^/]*|\.workspace-backup|\.env(?:\..*)?|\.aws|\.ssh|credentials(?:\..*)?|cookies(?:\..*)?|instagram-[^/]+-\d{4}-\d{2}-\d{2}[^/]*|(?:browser-)?profiles?)(?:\/|$)|\.(?:csv|tsv|har|pem|key|p12|pfx|sqlite3?|db|zip|ndjson|log|mov|mp4|webm)$/i;
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  [
    'provider API key',
    /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|AIza[A-Za-z0-9_-]{35}|xox[baprs]-[A-Za-z0-9-]{20,})\b/,
  ],
  ['credential in URL', /https?:\/\/[^\s/:]+:[^\s/@]+@/],
];
const findings = new Set();
let scanned = 0;

function scan(path, content) {
  if (privatePath.test(path)) findings.add(`${path}: private data file`);
  if (content.includes(0)) return;
  const text = content.toString('utf8');
  for (const [name, pattern] of rules) {
    if (pattern.test(text)) findings.add(`${path}: ${name}`);
  }
  scanned++;
}

if (refs.length) {
  // Scan every commit, including files deleted at the tip. Never use just
  // origin..HEAD: a force push could otherwise upload an old private ancestor.
  const objects = new Map();
  for (const ref of refs) {
    const output = git(
      'log',
      '--format=',
      '--raw',
      '-z',
      '--no-renames',
      '--no-abbrev',
      '--root',
      ref,
      '--',
    ).toString();
    const parts = output.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const match = parts[i].trim().match(/^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) [A-Z]$/);
      if (!match) continue;
      const path = parts[++i];
      if (!match || /^0+$/.test(match[1])) continue;
      const [, sha] = match;
      if (privatePath.test(path)) findings.add(`${path}: private data in Git history`);
      if (!objects.has(sha)) objects.set(sha, path);
    }
  }
  // Private history is already enough to reject a push; avoid reading a
  // potentially huge personal archive merely to find more reasons to reject it.
  for (const [sha, path] of findings.size ? [] : objects) {
    if (git('cat-file', '-t', sha).toString().trim() === 'blob')
      scan(path, git('cat-file', 'blob', sha));
  }
} else {
  for (const path of git('ls-files', '-z').toString().split('\0').filter(Boolean)) {
    try {
      scan(path, readFileSync(path));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

if (findings.size) {
  console.error('Sensitive-data check failed. No secret values are shown.');
  for (const finding of [...findings].slice(0, 25)) console.error(`- ${finding}`);
  if (findings.size > 25) console.error(`- ${findings.size - 25} additional findings`);
  console.error(
    'Do not push this history. Publish from a clean history after removing private data.',
  );
  process.exitCode = 1;
} else {
  console.log(`Sensitive-data check passed (${scanned} text files scanned).`);
}
