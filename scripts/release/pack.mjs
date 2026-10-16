#!/usr/bin/env node
// Builds dist/epic-board-vX.Y.Z.tar.gz from `git archive HEAD` plus dist/SHA256SUMS.
// Usage: node scripts/release/pack.mjs [--out-dir dist] [--ref HEAD]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, readJson } from './lib.mjs';

const { values } = parseArgs({
  options: {
    'out-dir': { type: 'string', default: 'dist' },
    ref: { type: 'string', default: 'HEAD' },
  },
});

// Repo-only files that users of the plugin do not need.
const EXCLUDE = ['.github', 'test', 'docs/releasing.md'];

const version = readJson('package.json').version;
const name = `epic-board-v${version}`;
const outDir = isAbsolute(values['out-dir']) ? values['out-dir'] : join(ROOT, values['out-dir']);
const tarball = join(outDir, `${name}.tar.gz`);
const sums = join(outDir, 'SHA256SUMS');

mkdirSync(outDir, { recursive: true });
rmSync(tarball, { force: true });
rmSync(sums, { force: true });

execFileSync('git', [
  'archive',
  '--format=tar.gz',
  `--prefix=${name}/`,
  '-o', tarball,
  values.ref,
  '--',
  '.',
  ...EXCLUDE.map((p) => `:(exclude)${p}`),
], { cwd: ROOT, stdio: 'inherit' });

const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex');
writeFileSync(sums, `${digest}  ${basename(tarball)}\n`);

console.log(`${tarball}\n${sums}\n${digest}  ${basename(tarball)}`);
