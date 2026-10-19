#!/usr/bin/env node
// Example connector: read a JSONL file of {externalId,title,...} and push to the board feed.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const epic = join(dirname(fileURLToPath(import.meta.url)), '../../cli/epic.mjs');
const file = process.argv[2];
if (!file) {
  console.error('usage: jsonl-import.mjs <events.jsonl>');
  process.exit(2);
}

const items = readFileSync(file, 'utf8')
  .split(/\n+/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .map((row) => ({
    source: row.source || 'jsonl-import',
    externalId: String(row.externalId || row.id),
    kind: row.kind || 'info',
    severity: row.severity || 'normal',
    title: row.title,
    body: row.body,
    channel: row.channel,
    refs: row.refs,
  }));

const payload = JSON.stringify(items);
const result = spawnSync(process.execPath, [epic, 'feed', 'add', '-', '--json'], {
  input: payload,
  encoding: 'utf8',
});
if (result.status) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status);
}
console.log(result.stdout);
