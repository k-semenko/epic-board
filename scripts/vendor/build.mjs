#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const source = dirname(fileURLToPath(import.meta.url));
const root = resolve(source, '../..');
const temporary = mkdtempSync(join(tmpdir(), 'epic-board-editor-build-'));
try {
  for (const name of ['package.json', 'package-lock.json', 'entry.mjs']) copyFileSync(join(source, name), join(temporary, name));
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: temporary, stdio: 'inherit' });
  const { build } = await import(pathToFileURL(join(temporary, 'node_modules/esbuild/lib/main.js')));
  const output = join(root, 'vendor/milkdown.min.js');
  mkdirSync(dirname(output), { recursive: true });
  const result = await build({
    absWorkingDir: temporary, entryPoints: ['entry.mjs'], outfile: output,
    bundle: true, format: 'iife', platform: 'browser', target: ['es2022'],
    minify: true, legalComments: 'inline', metafile: true,
    banner: { js: '/*! Milkdown 7.22.3 browser bundle. Licenses: milkdown.LICENSE.txt. Rebuild: node scripts/vendor/build.mjs */' },
  });
  if (Object.values(result.metafile.outputs).some((file) => file.imports.length)) throw new Error('The editor bundle has external imports');
  const packages = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.startsWith('node_modules/')) continue;
    let folder = dirname(join(temporary, input));
    while (!existsSync(join(folder, 'package.json'))) folder = dirname(folder);
    const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    packages.set(`${manifest.name}@${manifest.version}`, { folder, manifest });
  }
  const notices = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, { folder, manifest }]) => {
    const files = readdirSync(folder).filter((file) => /^(licen[cs]e|copying|notice)(\..+)?$/i.test(file)).sort();
    const supplemental = name === 'format@0.2.2' ? join(root, 'vendor/milkdown-format.LICENSE.txt') : null;
    if (!files.length && !supplemental) throw new Error(`No bundled license text found for ${name}`);
    const text = files.length
      ? files.map((file) => `${file}\n${readFileSync(join(folder, file), 'utf8').trim()}\n`).join('\n')
      : readFileSync(supplemental, 'utf8');
    const license = manifest.license || manifest.licenses?.map((item) => item.type).join(' OR ') || 'See license text';
    return `${name}\nLicense: ${license}\n${text}`;
  });
  writeFileSync(join(root, 'vendor/milkdown.LICENSE.txt'), `Licenses for packages included in milkdown.min.js\n\n${notices.join('\n--------------------\n\n')}`);
  const bundle = readFileSync(output);
  console.log(`milkdown.min.js: ${bundle.length} bytes, gzip ${gzipSync(bundle).length} bytes`);
  console.log(`${packages.size} bundled package licenses written to vendor/milkdown.LICENSE.txt`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
