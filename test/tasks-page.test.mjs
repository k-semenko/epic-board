import test from 'node:test';
import assert from 'node:assert/strict';
import { setLang } from '../server/page/i18n.mjs';

const page = await import('../server/page/tasks.mjs').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const task = (epic, id, extra = {}) => ({
  epic: { id: epic, title: `Epic ${epic}` }, id, title: `Task ${id}`, status: null,
  statusCheckedAt: null, role: 'main', progress: { done: 0, total: 0 }, current: [],
  waiting: 0, url: `/e/${epic}#t-${id}`, ...extra,
});
const snapshot = (tasks, extra = {}) => ({
  tasks, epics: [{ id: 'alpha', title: 'Epic alpha' }, { id: 'beta', title: 'Epic beta' }],
  incomplete: false, errors: [], readAt: '2026-10-19T12:00:00Z', revision: 'one', ...extra,
});
const defaults = { q: '', epic: '', status: '', waiting: false, sort: 'source' };

// Moving side tasks into a main group or keying only by task ID would lose distinct tasks.
test('side tasks appear once above main groups and repeated IDs retain their epic', () => {
  assert.equal(typeof page.buildTaskView, 'function', 'tasks model is available');
  const input = snapshot([task('beta', 'S', { role: 'side' }), task('alpha', 'X'), task('beta', 'X'), task('alpha', 'S', { role: 'side' })]);
  const view = page.buildTaskView(input, defaults);
  assert.deepEqual(view.side.map((item) => `${item.epic.id}/${item.id}`), ['beta/S', 'alpha/S']);
  assert.deepEqual(view.groups.map((group) => [group.epic.id, group.tasks.map((item) => item.id)]), [['alpha', ['X']], ['beta', ['X']]]);
  assert.equal(view.total, 4);
});

test('search and exact tracker status apply to side and main tasks with empty groups omitted', () => {
  assert.equal(typeof page.buildTaskView, 'function', 'tasks model is available');
  const input = snapshot([
    task('alpha', 'A', { status: 'Review pending', waiting: 1 }),
    task('beta', 'B', { status: 'Review pending', role: 'side', waiting: 2 }),
    task('beta', 'C', { status: 'review pending', waiting: 1 }),
    task('alpha', 'D', { status: 'Review pending' }),
  ]);
  const view = page.buildTaskView(input, { ...defaults, q: 'EPIC BETA', status: 'Review pending', waiting: true });
  assert.deepEqual(view.side.map((item) => item.id), ['B']);
  assert.deepEqual(view.groups, []);
  assert.equal(page.buildTaskView(input, { ...defaults, epic: 'alpha', waiting: true }).total, 1);
  assert.equal(page.buildTaskView(input, { ...defaults, q: 'Task A' }).total, 1);
});

test('sorting remains stable, keeps zero-step tasks visible, and never changes source data', () => {
  assert.equal(typeof page.buildTaskView, 'function', 'tasks model is available');
  const input = snapshot([
    task('alpha', 'T10', { title: 'Zulu', progress: { done: 0, total: 0 } }),
    task('alpha', 'T2', { title: 'Alpha', progress: { done: 1, total: 2 } }),
    task('alpha', 'T3', { title: 'Beta', progress: { done: 2, total: 2 } }),
  ]);
  const before = JSON.stringify(input);
  const ids = (sort) => page.buildTaskView(input, { ...defaults, sort }).groups[0].tasks.map((item) => item.id);
  assert.deepEqual(ids('source'), ['T10', 'T2', 'T3']);
  assert.deepEqual(ids('id'), ['T2', 'T3', 'T10']);
  assert.deepEqual(ids('name'), ['T2', 'T3', 'T10']);
  assert.deepEqual(ids('progress'), ['T3', 'T2', 'T10']);
  assert.equal(JSON.stringify(input), before);
});

test('URL filters round-trip special statuses while keeping unrelated URL parameters and hash', () => {
  assert.equal(typeof page.readTaskFilters, 'function', 'URL filters are available');
  const filters = page.readTaskFilters('?q=call&epic=alpha&status=QA+%26+Review&waiting=1&sort=progress');
  assert.deepEqual(filters, { q: 'call', epic: 'alpha', status: 'QA & Review', waiting: true, sort: 'progress' });
  assert.equal(page.taskFiltersUrl('http://board.test/tasks?keep=1#top', filters), '/tasks?keep=1&q=call&epic=alpha&status=QA+%26+Review&waiting=1&sort=progress#top');
  assert.deepEqual(page.readTaskFilters('?sort=unsafe&waiting=true'), defaults);
});

test('rendered task rows escape tracker content and use only local task navigation', () => {
  assert.equal(typeof page.renderTaskGroups, 'function', 'task rendering is available');
  setLang('en', { persist: false });
  const data = snapshot([task('alpha', 'X', { role: 'side', title: '<img src=x onerror=alert(1)>', status: '<QA>', waiting: 2, progress: { done: 1, total: 2 } }), task('beta', 'Y', { url: 'javascript:alert(1)' })]);
  const html = page.renderTaskGroups(page.buildTaskView(data, defaults));
  assert.match(html, /Out of scope/);
  assert.match(html, /Epic alpha/);
  assert.match(html, /href="\/e\/alpha#t-X"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;QA&gt;/);
  assert.match(html, /1\/2/);
  assert.match(html, /Needs decision: 2/);
  assert.doesNotMatch(html, /href="javascript:|<img/);
});

function harness(responses, search = '') {
  const listeners = new Map();
  const elements = new Map();
  const document = { documentElement: { lang: 'en' }, activeElement: null, querySelectorAll: () => [], getElementById: (id) => elements.get(id) };
  for (const id of ['q', 'tasks-epic', 'tasks-status', 'tasks-waiting', 'tasks-sort', 'tasks-list', 'tasks-message', 'tasks-summary', 'lang']) {
    const element = {
      id, value: '', checked: false, innerHTML: '', textContent: '', hidden: false,
      addEventListener(type, callback) { listeners.set(`${id}:${type}`, callback); },
      contains: (child) => child?.owner === id,
      querySelectorAll: () => [],
    };
    elements.set(id, element);
  }
  const list = elements.get('tasks-list');
  let listHtml = '';
  let anchors = [];
  Object.defineProperty(list, 'innerHTML', {
    get: () => listHtml,
    set(html) {
      if (list.contains(document.activeElement)) document.activeElement = null;
      listHtml = html;
      anchors = [...html.matchAll(/<a\b([^>]*)>/g)].map(([, attrs]) => ({
        owner: 'tasks-list', href: attrs.match(/href="([^"]+)"/)?.[1],
        dataset: Object.fromEntries([...attrs.matchAll(/data-([\w-]+)="([^"]+)"/g)].map(([, key, value]) => [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
        focus() { document.activeElement = this; },
      }));
    },
  });
  list.querySelectorAll = (selector) => selector === 'a' ? anchors : anchors.filter((anchor) => selector === '[data-task-key]' ? anchor.dataset.taskKey : anchor.dataset.taskFocus);
  const location = { href: `http://board.test/tasks${search}`, search };
  const navigate = (url) => { const next = new URL(url, location.href); location.href = next.href; location.search = next.search; };
  const window = { location, history: { pushState(_a, _b, url) { navigate(url); }, replaceState(_a, _b, url) { navigate(url); } }, addEventListener(type, callback) { listeners.set(type, callback); } };
  let tick;
  const fetch = async (path) => {
    assert.equal(path, '/api/tasks');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return { ok: true, json: async () => response };
  };
  return {
    document, window, fetch, interval(callback, ms) { assert.equal(ms, 10000); tick = callback; },
    elements, listeners, tick: () => tick(),
    async change(id, value, type = 'change') { const element = elements.get(id); if (id === 'tasks-waiting') element.checked = value; else element.value = value; await listeners.get(`${id}:${type}`)(); },
    async back(search) { navigate(`/tasks${search}`); await listeners.get('popstate')(); },
  };
}

test('polling and language retain URL filters, control focus and the last good snapshot on failures', async () => {
  assert.equal(typeof page.initTasksPage, 'function', 'tasks page is available');
  setLang('en', { persist: false });
  const data = snapshot([task('alpha', 'A', { status: 'Testing', waiting: 1 })]);
  const h = harness([data, new Error('offline'), { ...data, revision: 'two' }], '?status=Testing&waiting=1');
  await page.initTasksPage(h);
  assert.match(h.elements.get('tasks-list').innerHTML, /Task A/);
  await h.change('q', 'Task A', 'input');
  h.document.activeElement = h.elements.get('q');
  const html = h.elements.get('tasks-list').innerHTML;
  await h.tick();
  assert.equal(h.elements.get('tasks-list').innerHTML, html);
  assert.match(h.elements.get('tasks-message').textContent, /Could not refresh/);
  assert.equal(h.elements.get('q').value, 'Task A');
  assert.equal(h.document.activeElement, h.elements.get('q'));
  assert.match(h.window.location.search, /status=Testing/);
  assert.match(h.window.location.search, /q=Task\+A/);
  await h.listeners.get('lang:click')();
  assert.match(h.elements.get('tasks-list').innerHTML, /Нужны решения: 1/);
  await h.tick();
  assert.doesNotMatch(h.elements.get('tasks-message').textContent, /Could not refresh|Не удалось обновить/);
  assert.equal(h.elements.get('tasks-status').value, 'Testing');
  assert.equal(h.elements.get('tasks-waiting').checked, true);
});

test('back restores task filters and partial snapshots remain visible with an explicit warning', async () => {
  assert.equal(typeof page.initTasksPage, 'function', 'tasks page is available');
  setLang('en', { persist: false });
  const h = harness([snapshot([task('alpha', 'A'), task('beta', 'B')], { incomplete: true, errors: [{ id: 'broken', status: 'unavailable' }] })]);
  await page.initTasksPage(h);
  assert.match(h.elements.get('tasks-message').textContent, /Some epics could not be read/);
  await h.change('tasks-epic', 'alpha');
  assert.doesNotMatch(h.elements.get('tasks-list').innerHTML, /Task B/);
  await h.back('?epic=beta');
  assert.match(h.elements.get('tasks-list').innerHTML, /Task B/);
  assert.doesNotMatch(h.elements.get('tasks-list').innerHTML, /Task A/);
  assert.equal(h.elements.get('tasks-epic').value, 'beta');
});

test('initial read failure reports unavailable data rather than an empty board', async () => {
  assert.equal(typeof page.initTasksPage, 'function', 'tasks page is available');
  setLang('en', { persist: false });
  const h = harness([new Error('offline')]);
  await page.initTasksPage(h);
  assert.match(h.elements.get('tasks-message').textContent, /Task list unavailable/);
  assert.doesNotMatch(h.elements.get('tasks-list').innerHTML, /No tasks yet/);
});

test('a focused epic group link survives polling when tasks in that group change', async () => {
  setLang('en', { persist: false });
  const h = harness([snapshot([task('alpha', 'A')]), snapshot([task('alpha', 'A', { waiting: 1 })], { revision: 'two' })]);
  await page.initTasksPage(h);
  const heading = h.elements.get('tasks-list').querySelectorAll('a').find((anchor) => anchor.href === '/e/alpha');
  heading.focus();
  await h.tick();
  assert.notEqual(h.document.activeElement, heading, 'the changed group was rendered');
  assert.equal(h.document.activeElement?.href, '/e/alpha');
});
