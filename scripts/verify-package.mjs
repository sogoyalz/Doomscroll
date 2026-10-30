// Build twice, independently, and compare the distributed bytes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const archive = resolve(root, `doomscroll-${version}.zip`);
function build() {
  execFileSync('npm', ['run', 'package'], { cwd: root, stdio: 'inherit' });
  return readFileSync(archive);
}
const first = build();
const second = build();
if (!first.equals(second)) throw new Error('Independent release builds differ');
console.log('Independent release builds are byte-for-byte identical.');
