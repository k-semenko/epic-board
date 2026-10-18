import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { bundleScript } from '../server/export.mjs';

function indexApp({ request = async () => ({ pinnedEpics: [] }) } = {}) {
  const listeners = {};
  const query = { value: '', addEventListener() {} };
  const language = { addEventListener(type, listener) { listeners.language = listener; } };
  let buttons = [];
  const epics = {
    html: '',
    get innerHTML() { return this.html; },
    set innerHTML(html) {
      this.html = html;
      buttons = [...html.matchAll(/data-pin="([^"]+)"/g)].map((match) => ({
        dataset: { pin: match[1] },
        isDisabled: false,
        get disabled() { return this.isDisabled; },
        set disabled(value) {
          this.isDisabled = value;
          if (value && document.activeElement === this) document.activeElement = document.body;
        },
        focus(options) { document.activeElement = this; this.focusOptions = options; },
      }));
    },
    addEventListener(type, listener) { listeners[type] = listener; },
    querySelectorAll() { return buttons; },
  };
  const alerts = [];
  const document = {
    body: {},
    documentElement: {},
    activeElement: null,
    addEventListener() {},
    createElement() { return { remove() {} }; },
    querySelector(selector) {
      if (selector === '#epics') return epics;
      if (selector === '#q') return query;
      if (selector === '#lang') return language;
      if (selector === '#stats') return { innerHTML: '' };
      if (selector === '.head') return { after(node) { alerts.push(node.textContent); } };
      return null;
    },
    querySelectorAll() { return []; },
  };
  const bundle = bundleScript();
  const bootstrap = bundle.lastIndexOf('\nif (EXPORT || location.pathname');
  assert.ok(bootstrap > 0, 'app bootstrap is available');
  const script = `${bundle.slice(0, bootstrap)}
    globalThis.app = {
      show(list, pins = []) { allEpics = list; pinnedEpics = new Set(pins); renderEpicList(); },
      render: renderIndex,
      bindPins() { bindEpicPins(); },
      boot: bootIndex,
    };
  })();`;
  const context = vm.createContext({
    document,
    window: {},
    setInterval() {},
    setTimeout() {},
    async fetch(path, options) {
      const data = await request(path, options);
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => data };
    },
    location: { pathname: '/' },
  });
  vm.runInContext(script, context);
  return {
    app: context.app, epics, query, alerts,
    changeLanguage: () => listeners.language(),
    buttons: () => buttons,
    click(id) {
      const button = buttons.find((item) => item.dataset.pin === id);
      assert.ok(button, `pin button for ${id} exists`);
      document.activeElement = button;
      return listeners.click({ target: { closest: () => button } });
    },
  };
}

test('the whole epic card is the link, not only the title', () => {
  const { app, epics } = indexApp();
  app.show([{
    id: 'shop',
    title: 'Shop',
    goal: 'Ship the counter',
    waiting: 1,
    tasks: 2,
    branches: 3,
    createdAt: '2026-10-17T00:00:00.000Z',
    updatedAt: '2026-10-17T00:00:00.000Z',
  }]);
  const html = epics.innerHTML;
  const card = html.match(/<li\b[^>]*><a href="\/e\/shop" class="epic-link">([\s\S]*?)<\/a>([\s\S]*?)<\/li>/);
  assert.ok(card, html);
  assert.match(card[1], /Shop/);
  assert.match(card[1], /Ship the counter/);
  assert.match(card[1], /class="meta"/);
  assert.doesNotMatch(card[1], /<button/);
  assert.match(card[2], /<button[^>]*data-pin="shop"/);
});

test('epic card padding belongs to the link', () => {
  const css = readFileSync('server/page/style.css', 'utf8');
  assert.match(css, /\.cards li \{[^}]*padding: 0/);
  assert.match(css, /\.epic-link \{[^}]*display: grid[^}]*padding: 12px 14px/);
});

const sample = (id, createdAt = '2026-10-17T00:00:00.000Z') => ({ id, title: id, goal: `Goal ${id}`, createdAt, updatedAt: createdAt });

test('pinned epics form the first section without appearing again under dates', () => {
  const { app, epics } = indexApp();
  app.show([sample('new', '2026-10-18T00:00:00Z'), sample('old', '2026-10-10T00:00:00Z')], ['old']);
  const sections = [...epics.innerHTML.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/g)].map((match) => match[1]);
  assert.equal(sections.length, 2);
  assert.match(sections[0], /href="\/e\/old"/);
  assert.match(sections[0], /aria-pressed="true"/);
  assert.doesNotMatch(sections[0], /href="\/e\/new"/);
  assert.match(sections[1], /href="\/e\/new"/);
  assert.equal((epics.innerHTML.match(/href="\/e\/old"/g) || []).length, 1);
});

test('search filters pinned and dated epics together and hides empty sections', () => {
  const { app, epics, query } = indexApp();
  query.value = 'new';
  app.show([sample('new'), sample('old')], ['old']);
  assert.equal((epics.innerHTML.match(/<section/g) || []).length, 1);
  assert.match(epics.innerHTML, /href="\/e\/new"/);
  assert.doesNotMatch(epics.innerHTML, /href="\/e\/old"/);
  query.value = 'old';
  app.show([sample('new'), sample('old')], ['old']);
  assert.equal((epics.innerHTML.match(/<section/g) || []).length, 1);
  assert.match(epics.innerHTML, /href="\/e\/old"/);
  assert.doesNotMatch(epics.innerHTML, /href="\/e\/new"/);
});

test('the pin click handler persists toggles, restores keyboard focus, and reloads saved pins', async () => {
  let settings = { pinnedEpics: [] };
  const request = async (path, options) => {
    if (path === '/api/epics') return [sample('new'), sample('old')];
    assert.equal(path, '/api/settings');
    if (options.method === 'PUT') settings = JSON.parse(options.body);
    return settings;
  };
  const page = indexApp({ request });
  await page.app.render();
  page.app.bindPins();
  await page.click('old');
  assert.deepEqual(settings, { pinnedEpics: ['old'] });
  assert.equal(page.buttons()[0].dataset.pin, 'old');
  assert.equal(page.buttons()[0].focusOptions.preventScroll, true);
  const reloaded = indexApp({ request });
  await reloaded.app.render();
  assert.equal(reloaded.buttons()[0].dataset.pin, 'old');
  await page.click('old');
  assert.deepEqual(settings, { pinnedEpics: [] });
  assert.equal((page.epics.innerHTML.match(/<section/g) || []).length, 1);
});

test('a failed pin save keeps the previous grouping and re-enables the controls', async () => {
  const page = indexApp({ request: async () => { throw new Error('Save failed'); } });
  page.app.show([sample('new'), sample('old')]);
  page.app.bindPins();
  await page.click('old');
  assert.equal((page.epics.innerHTML.match(/<section/g) || []).length, 1);
  assert.match(page.epics.innerHTML, /aria-pressed="false"/);
  assert.ok(page.buttons().every((button) => !button.disabled));
  assert.deepEqual(page.alerts, ['Save failed']);
});

test('switching language during a pin save does not reload stale settings or lose pins', async () => {
  let settings = { pinnedEpics: [] };
  let settingsReads = 0;
  let finishSave;
  const page = indexApp({ request: async (path, options) => {
    if (path === '/api/epics') return [sample('new'), sample('old')];
    if (options.method === 'PUT') {
      await new Promise((resolve) => { finishSave = resolve; });
      settings = JSON.parse(options.body);
      return settings;
    }
    settingsReads++;
    return settings;
  } });
  await page.app.boot();
  const pending = page.click('old');
  await page.changeLanguage();
  assert.equal(settingsReads, 1);
  finishSave();
  await pending;
  assert.deepEqual(settings, { pinnedEpics: ['old'] });
  assert.equal(page.buttons()[0].dataset.pin, 'old');
  assert.match(page.epics.innerHTML, /aria-pressed="true"/);
});
