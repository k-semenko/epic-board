#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const root = resolve(source, '../..');
const temporary = mkdtempSync(join(tmpdir(), 'epic-board-editor-build-'));
const output = join(root, 'vendor');
try {
  for (const name of ['package.json', 'package-lock.json']) copyFileSync(join(source, name), join(temporary, name));
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: temporary, stdio: 'inherit' });
  const vditor = join(temporary, 'node_modules/vditor');
  const files = {
    'dist/index.min.js': 'vditor.min.js', 'dist/index.css': 'vditor.css',
    'dist/js/lute/lute.min.js': 'vditor-lute.min.js', 'dist/js/icons/ant.js': 'vditor-icons.js',
    LICENSE: 'vditor.LICENSE.txt',
  };
  mkdirSync(output, { recursive: true });
  for (const [from, to] of Object.entries(files)) {
    if (from.endsWith('.css')) writeFileSync(join(output, to), `${readFileSync(join(vditor, from), 'utf8').trimEnd()}\n`);
    else copyFileSync(join(vditor, from), join(output, to));
    chmodSync(join(output, to), 0o644);
  }
  const en = readFileSync(join(vditor, 'dist/js/i18n/en_US.js'), 'utf8');
  const ru = readFileSync(join(vditor, 'dist/js/i18n/ru_RU.js'), 'utf8');
  writeFileSync(join(output, 'vditor-i18n.js'), `(()=>{${en};const en=window.VditorI18n;${ru};globalThis.EpicVditorI18n={en,ru:window.VditorI18n};})();\n`);
  const preserve = readFileSync(join(source, 'preserve.mjs'), 'utf8').replace(/^export /gm, '');
  const entry = readFileSync(join(source, 'entry.mjs'), 'utf8').replace(/^import .* from '\.\/preserve\.mjs';\n/m, '');
  writeFileSync(join(output, 'vditor-adapter.js'), `(()=>{\n${preserve}\n${entry}\n})();\n`);
  copyFileSync(join(source, 'licenses/lute.LICENSE.txt'), join(output, 'vditor-lute.LICENSE.txt'));
  copyFileSync(join(temporary, 'node_modules/diff-match-patch/LICENSE'), join(output, 'vditor-diff-match-patch.LICENSE.txt'));
  for (const file of ['milkdown.min.js', 'milkdown.LICENSE.txt', 'milkdown-format.LICENSE.txt']) rmSync(join(output, file), { force: true });
  console.log('Vditor 4.0.0 assets, local adapter, translations and licenses rebuilt');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
