#!/usr/bin/env node
// Verifies that every manifest carries the same version, the CHANGELOG has a dated
// section for it and, with --tag vX.Y.Z, that the tag matches.
import { parseArgs } from 'node:util';
import { readJson, readText, changelogSection, fail } from './lib.mjs';

const { values } = parseArgs({ options: { tag: { type: 'string' } } });

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const found = [];

const pkg = readJson('package.json');
found.push(['package.json version', pkg.version]);

const plugin = readJson('.claude-plugin/plugin.json');
found.push(['.claude-plugin/plugin.json version', plugin.version]);

const market = readJson('.claude-plugin/marketplace.json');
const entry = (market.plugins ?? []).find((p) => p.name === plugin.name) ?? (market.plugins ?? [])[0];
if (!entry) fail('.claude-plugin/marketplace.json has no plugins[] entry');
if (entry.version !== undefined) found.push([`.claude-plugin/marketplace.json plugins[${entry.name}].version`, entry.version]);
if (market.metadata?.version !== undefined) found.push(['.claude-plugin/marketplace.json metadata.version', market.metadata.version]);

const cursorPlugin = readJson('.cursor-plugin/plugin.json');
found.push(['.cursor-plugin/plugin.json version', cursorPlugin.version]);

const codexPlugin = readJson('.codex-plugin/plugin.json');
found.push(['.codex-plugin/plugin.json version', codexPlugin.version]);

const cursorMarket = readJson('.cursor-plugin/marketplace.json');
const cursorEntry = (cursorMarket.plugins ?? []).find((p) => p.name === cursorPlugin.name) ?? (cursorMarket.plugins ?? [])[0];
if (!cursorEntry) fail('.cursor-plugin/marketplace.json has no plugins[] entry');
if (cursorEntry.version !== undefined) found.push([`.cursor-plugin/marketplace.json plugins[${cursorEntry.name}].version`, cursorEntry.version]);
if (cursorMarket.metadata?.version !== undefined) found.push(['.cursor-plugin/marketplace.json metadata.version', cursorMarket.metadata.version]);

const problems = [];
for (const [where, v] of found) {
  if (typeof v !== 'string' || !SEMVER.test(v)) problems.push(`${where} is not a semver string: ${JSON.stringify(v)}`);
}

const version = pkg.version;
const mismatched = found.filter(([, v]) => v !== version);
if (mismatched.length) {
  problems.push(
    'versions differ:\n' + found.map(([w, v]) => `    ${w} = ${v}`).join('\n'),
  );
}

if (values.tag !== undefined) {
  if (values.tag !== `v${version}`) problems.push(`tag ${values.tag} does not match version v${version}`);
}

const section = changelogSection(readText('CHANGELOG.md'), version);
if (section === null) problems.push(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section`);
else if (!section) problems.push(`CHANGELOG.md section [${version}] is empty`);

if (problems.length) {
  for (const p of problems) console.error(`error: ${p}`);
  process.exit(1);
}
console.log(`versions ok: ${version}${values.tag ? ` (tag ${values.tag})` : ''}`);
