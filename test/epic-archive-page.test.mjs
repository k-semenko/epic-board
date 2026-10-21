import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundleScript } from '../server/export.mjs';

function epicPage({ exported = false } = {}) {
  const document = {
    body: { classes: new Set(), classList: { add(c) { document.body.classes.add(c); }, toggle(c, on) { if (on) document.body.classes.add(c); else document.body.classes.delete(c); } } },
    documentElement: {},
    addEventListener() {},
    createElement() { return { remove() {} }; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    dispatchEvent() {},
  };
  const bundle = bundleScript();
  const bootstrap = bundle.lastIndexOf('\nif (EXPORT || location.pathname');
  assert.ok(bootstrap > 0);
  const script = `${bundle.slice(0, bootstrap)}
    globalThis.page = { archivedNoteHtml, archiveDialogHtml, epicReadOnly, renderArchiveState, setCurrent(epic) { current = epic; }, bodyClasses: () => [...document.body.classes] };
  })();`;
  const context = vm.createContext({
    document,
    window: exported ? { __EPIC_EXPORT__: { epic: { id: 'x' }, exportedAt: '2026-10-20T00:00:00Z' } } : {},
    setInterval() {}, setTimeout() {}, URLSearchParams,
    history: { replaceState() {} }, location: { pathname: '/e/x', search: '' },
  });
  vm.runInContext(script, context);
  return context.page;
}

const epic = {
  id: 'x', title: 'X',
  tasks: [{ id: 'done', steps: [{ id: 's', state: 'done' }] }, { id: 'half', steps: [{ id: 's', state: 'active' }] }, { id: 'empty', steps: [] }],
  waiting: [{ id: 'w1', status: 'open' }, { id: 'w2', status: 'answered' }, { id: 'w3', status: 'closed', doneAt: '2026-10-19T00:00:00Z' }],
};
const archived = { ...epic, archived: { at: '2026-10-20T10:00:00.000Z', by: 'ui', summary: 'Delivered <b>hub</b>' } };

test('the done dialog counts what is left and starts with confirm disabled', () => {
  const html = epicPage().archiveDialogHtml(epic);
  assert.match(html, /\b2\b[\s\S]*\b2\b/);
  assert.match(html, /<textarea[^>]*id="archive-summary"/);
  assert.match(html, /<button[^>]*data-archive-confirm[^>]*disabled/);
});

test('an archived epic is read-only and shows its summary with a way back', () => {
  const page = epicPage();
  page.setCurrent(epic);
  assert.equal(page.epicReadOnly(), false);
  page.setCurrent(archived);
  assert.equal(page.epicReadOnly(), true);
  const note = page.archivedNoteHtml(archived);
  assert.match(note, /Delivered &lt;b&gt;hub&lt;\/b&gt;/);
  assert.match(note, /id="reopen-epic"/);
});

test('an exported archived epic keeps the note but not the reopen button', () => {
  const page = epicPage({ exported: true });
  page.setCurrent(epic);
  assert.equal(page.epicReadOnly(), true);
  const note = page.archivedNoteHtml(archived);
  assert.match(note, /Delivered/);
  assert.doesNotMatch(note, /reopen-epic/);
});

test('an archived epic hides write controls but keeps export available', async () => {
  const page = epicPage();
  page.setCurrent(archived);
  page.renderArchiveState(archived);
  assert.deepEqual(Array.from(page.bodyClasses()), ['archived']);
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../server/page/style.css', import.meta.url), 'utf8');
  assert.match(css, /body\.archived \.live-only:not\(#export-link\)\s*\{\s*display: none !important;/);
  page.setCurrent(epic);
  page.renderArchiveState(epic);
  assert.deepEqual(Array.from(page.bodyClasses()), []);
});
