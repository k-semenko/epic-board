import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpHome } from './helpers.mjs';

tmpHome();
const store = await import('../server/store.mjs');
const { buildExport, bundleScript } = await import('../server/export.mjs');
store.createEpic({ id: '42', title: 'Epic </script><script>alert(1)</script>', goal: 'Goal' });
store.patchEpic('42', { tasks: [{ id: '420', title: 'Задача', role: 'main', steps: [{ id: 's', title: 'Шаг', state: 'active' }] }] });
const docsMod = await import('../server/docs.mjs');
const exportedDoc = docsMod.newDoc('42', { task: '420', step: 's', kind: 'spec', title: 'Спека' });

test('bundle is one classic script without imports that parses', () => {
  const js = bundleScript();
  assert.doesNotMatch(js, /^\s*import\s/m);
  assert.doesNotMatch(js, /^\s*export\s/m);
  assert.doesNotThrow(() => new vm.Script(js));
  assert.match(js, /buildOverview/);
});

test('export is a self-contained html page with the epic and its history', () => {
  const html = buildExport('42');
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<style>[\s\S]*--accent[\s\S]*<\/style>/);
  assert.doesNotMatch(html, /\/static\/|src="\//, 'nothing may point back at the local service');
  assert.doesNotMatch(html, /type="module"/);
  assert.match(html, /marked v15/, 'marked is inlined');
  assert.match(html, /DOMPurify/, 'DOMPurify is inlined');
  const data = html.match(/window\.__EPIC_EXPORT__ = (.*?);<\/script>/s);
  assert.ok(data, 'embedded data');
  const parsed = JSON.parse(data[1]);
  assert.equal(parsed.epic.id, '42');
  assert.ok(parsed.history.length >= 2);
  assert.deepEqual(parsed.settings.epicPageSizes, { waiting: 5, decisions: 5, history: 5 });
  assert.equal(parsed.docs.find((d) => d.id === exportedDoc.id).text, '# Спека\n');
  assert.ok(parsed.exportedAt);
  assert.equal(html.split('</script>').length - 1, html.split('<script').length - 1, 'a title cannot close the data script early');
  assert.match(html, /<title>42 · /);
});

test('unknown epic is 404', () => {
  assert.throws(() => buildExport('404'), { status: 404 });
});

test('export snapshots the shared section order and page sizes for offline viewing', () => {
  const file = join(process.env.EPIC_BOARD_HOME, 'settings.json');
  const settings = {
    epicSectionOrder: ['history', 'map', 'waiting', 'branches', 'sessions', 'decisions'],
    epicPageSizes: { waiting: 15, decisions: 10, history: 5 },
  };
  writeFileSync(file, JSON.stringify(settings));
  try {
    const html = buildExport('42');
    const data = JSON.parse(html.match(/window\.__EPIC_EXPORT__ = (.*?);<\/script>/s)[1]);
    assert.deepEqual(data.settings, settings);
  } finally {
    rmSync(file);
  }
});

test('export includes the full history beyond the numeric HTTP cap', () => {
  store.createEpic({ id: 'long-history', title: 'Full history export' });
  store.appendHistory('long-history', Array.from({ length: 620 }, (_, index) => ({
    op: 'set', path: 'title', after: `Title ${index + 1}`,
  })));
  const html = buildExport('long-history');
  const data = JSON.parse(html.match(/window\.__EPIC_EXPORT__ = (.*?);<\/script>/s)[1]);
  assert.equal(data.history.length, 621);
  assert.equal(data.history[0].after, 'Title 620');
  assert.equal(data.history.at(-1).path, 'epic');
});
