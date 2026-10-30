import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const script = resolve('scripts/check-sensitive.mjs');
let directory;
const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
const check = (...args) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd: directory,
    encoding: 'utf8',
  });
function add(path, text) {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(join(directory, path), text);
  git('add', '--', path);
}
function commit() {
  git(
    '-c',
    'user.name=Security Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'fixture',
  );
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'doomscroll-security-test-'));
  git('init');
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('sensitive-data push guard', () => {
  it('accepts clean files and history', () => {
    add('src/example.js', 'export const count = 1;');
    commit();
    expect(check().status).toBe(0);
    expect(check('HEAD').status).toBe(0);
  });

  it('rejects a private export even after it is deleted', () => {
    add('private export.csv', 'synthetic fixture');
    commit();
    git('rm', 'private export.csv');
    commit();
    expect(check('HEAD').status).toBe(1);
  });

  it('rejects Instagram exports independently of their file format', () => {
    add('instagram-example-2026-01-01-export/messages/index.html', 'synthetic fixture');
    commit();
    expect(check('HEAD').status).toBe(1);
  });

  it('rejects a deleted secret without printing its value', () => {
    const secret = 'ghp_' + 'x'.repeat(36);
    add('config.txt', secret);
    commit();
    git('rm', 'config.txt');
    commit();
    const result = check('HEAD');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GitHub token');
    expect(result.stderr + result.stdout).not.toContain(secret);
  });

  it('rejects tracked environment files in the working tree', () => {
    add('.env.production', 'EXAMPLE=fixture');
    expect(check().status).toBe(1);
  });
});
