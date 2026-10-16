import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, utimesSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tmpHome } from './helpers.mjs';

const home = tmpHome();
const store = await import('../server/store.mjs');
const docs = await import('../server/docs.mjs');
const repo = mkdtempSync(join(tmpdir(), 'eb-repo-'));
const outside = mkdtempSync(join(tmpdir(), 'eb-out-'));

store.createEpic({ id: '7', title: 'E' });
store.patchEpic('7', {
  repos: { r: { path: repo, base: 'main' } },
  tasks: [{ id: '70', title: 'T', steps: [{ id: 's1', title: 'A', state: 'active' }] }],
});

test('new doc: file inside the board, registered on the step', () => {
  const d = docs.newDoc('7', { task: '70', step: 's1', kind: 'plan', title: 'План этапа 1' });
  assert.equal(d.owned, true);
  assert.ok(d.path.startsWith(join(home, 'epics', '7', 'docs', '70', 's1')));
  assert.match(d.path, /plan-.*\.md$/);
  assert.equal(readFileSync(d.path, 'utf8'), '# План этапа 1\n');
  assert.equal(store.readEpic('7').docs[0].id, d.id);
});

test('link: an existing md inside a repo of the epic', () => {
  const file = join(repo, 'spec.md');
  writeFileSync(file, '# Спека\n');
  const d = docs.linkDoc('7', { path: file, kind: 'spec', title: 'Спека аренды' });
  assert.equal(d.owned, false);
  assert.equal(d.path, realpathSync(file));
  assert.equal(d.task, undefined);
});

test('link refuses files outside the epic, non-md and missing files', () => {
  const file = join(outside, 'x.md');
  writeFileSync(file, 'x');
  assert.throws(() => docs.linkDoc('7', { path: file, kind: 'note', title: 'x' }), { status: 403 });
  writeFileSync(join(repo, 'a.txt'), 'x');
  assert.throws(() => docs.linkDoc('7', { path: join(repo, 'a.txt'), kind: 'note', title: 'x' }), { status: 400 });
  assert.throws(() => docs.linkDoc('7', { path: join(repo, 'nope.md'), kind: 'note', title: 'x' }), { status: 404 });
  assert.throws(() => docs.linkDoc('7', { path: join(repo, '..', 'x.md'), kind: 'note', title: 'x' }), { status: 403 });
});

test('bad kind or step reference is 400', () => {
  assert.throws(() => docs.newDoc('7', { task: '70', step: 'nope', kind: 'plan', title: 'x' }), { status: 400 });
  assert.throws(() => docs.newDoc('7', { kind: 'poem', title: 'x' }), { status: 400 });
});

test('import copies a file into the board as owned', () => {
  const file = join(repo, 'log.md');
  writeFileSync(file, '# Журнал\nстрока\n');
  const d = docs.importDoc('7', { path: file, task: '70', step: 's1', kind: 'log', title: 'Журнал' });
  assert.equal(d.owned, true);
  assert.notEqual(d.path, file);
  assert.equal(readFileSync(d.path, 'utf8'), '# Журнал\nстрока\n');
});

test('read and write with conflict check and versions', () => {
  const d = store.readEpic('7').docs.find((x) => x.kind === 'plan');
  const first = docs.readDoc('7', d.id);
  assert.equal(first.text, '# План этапа 1\n');
  const saved = docs.writeDoc('7', d.id, '# План этапа 1\nновое\n', first.mtimeMs);
  assert.equal(readFileSync(d.path, 'utf8'), '# План этапа 1\nновое\n');
  const versions = docs.listVersions('7', d.id);
  assert.equal(versions.length, 1);
  assert.equal(docs.readVersion('7', d.id, versions[0].id), '# План этапа 1\n');
  // Someone else changed the file after it was read: the stale save must be refused.
  writeFileSync(d.path, 'агент\n');
  utimesSync(d.path, new Date(), new Date(Date.now() + 5000));
  assert.throws(() => docs.writeDoc('7', d.id, 'моё\n', saved.mtimeMs), { status: 409 });
  assert.equal(readFileSync(d.path, 'utf8'), 'агент\n');
  assert.throws(() => docs.readVersion('7', d.id, '../../x'), { status: 400 });
});

test('remove unregisters and keeps the file', () => {
  const d = store.readEpic('7').docs.find((x) => x.kind === 'spec');
  docs.removeDoc('7', d.id);
  assert.equal(store.readEpic('7').docs.some((x) => x.id === d.id), false);
  assert.ok(existsSync(d.path));
});

test('all texts for search', () => {
  const all = docs.allTexts('7');
  assert.ok(all.some((x) => x.text.includes('агент')));
});
