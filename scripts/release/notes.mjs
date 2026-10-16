#!/usr/bin/env node
// Prints the CHANGELOG.md section for a version: `node scripts/release/notes.mjs 1.2.3`.
import { readText, changelogSection, fail } from './lib.mjs';

const arg = process.argv[2];
if (!arg) fail('usage: notes.mjs <version>');
const version = arg.replace(/^v/, '');
const section = changelogSection(readText('CHANGELOG.md'), version);
if (section === null) fail(`CHANGELOG.md has no section for ${version}`);
if (!section) fail(`CHANGELOG.md section for ${version} is empty`);
process.stdout.write(section + '\n');
