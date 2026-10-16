import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

export function readText(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns the body of `## [version] - YYYY-MM-DD` up to the next `## ` heading, or null.
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const head = new RegExp(`^## \\[${escapeRe(version)}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`);
  const start = lines.findIndex((l) => head.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

export function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}
