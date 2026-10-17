import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { bundleScript } from '../server/export.mjs';

function indexApp() {
  const epics = { innerHTML: '' };
  const document = {
    addEventListener() {},
    querySelector(selector) {
      if (selector === '#epics') return epics;
      if (selector === '#q') return { value: '' };
      return null;
    },
    querySelectorAll() { return []; },
  };
  const bundle = bundleScript();
  const bootstrap = bundle.lastIndexOf('\nif (EXPORT || location.pathname');
  assert.ok(bootstrap > 0, 'app bootstrap is available');
  const script = `${bundle.slice(0, bootstrap)}
    globalThis.app = { show(list) { allEpics = list; renderEpicList(); } };
  })();`;
  const context = vm.createContext({
    document,
    window: {},
    setInterval() {},
    location: { pathname: '/' },
  });
  vm.runInContext(script, context);
  return { app: context.app, epics };
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
  const card = html.match(/<li><a href="\/e\/shop" class="epic-link">([\s\S]*)<\/a><\/li>/);
  assert.ok(card, html);
  assert.match(card[1], /Shop/);
  assert.match(card[1], /Ship the counter/);
  assert.match(card[1], /class="meta"/);
});

test('epic card padding belongs to the link', () => {
  const css = readFileSync('server/page/style.css', 'utf8');
  assert.match(css, /\.cards li \{[^}]*padding: 0/);
  assert.match(css, /\.epic-link \{[^}]*display: grid[^}]*padding: 12px 14px/);
});
