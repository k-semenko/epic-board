import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundleScript } from '../server/export.mjs';
import { sampleEpic } from './fixtures/sample-epic.mjs';

function carouselApp({ open = 'WEB-8', step = 's3' } = {}) {
  const listeners = new Map();
  const calls = [];
  const location = { pathname: '/e/shop', hash: `#t-${open}/${step}` };
  let detail;
  let deck;
  let sideHtml = '';
  let mapWrites = 0;
  let front;
  const carousel = { querySelector: () => ({}) };
  const target = (dataset) => ({
    dataset,
    classList: { contains: () => false },
    closest(selector) {
      if (selector === '.side-carousel') return carousel;
      return Object.entries({ open: '[data-open]', sideTurn: '[data-side-turn]', sidePick: '[data-side-pick]' })
        .some(([key, match]) => dataset[key] !== undefined && selector === match) ? this : null;
    },
    focus() {},
  });
  const replaceSide = (html) => {
    if (deck) deck.isConnected = false;
    sideHtml = html.match(/<section class="overview-side"[\s\S]*?<\/section>/)?.[0] || html;
    const layers = [...sideHtml.matchAll(/data-side-id="([^"]+)"/g)].map((m) => ({ dataset: { sideId: m[1] }, style: {} }));
    front = layers[0]?.dataset.sideId;
    deck = {
      isConnected: true, querySelectorAll: () => layers,
      closest: (selector) => selector === '.overview-side' ? sideGroup : null,
      setAttribute() {}, removeAttribute() {},
    };
  };
  const sideGroup = { set outerHTML(html) { replaceSide(html); }, get outerHTML() { return sideHtml; } };
  const map = {
    set innerHTML(html) {
      mapWrites++;
      detail = { markup: html.match(/<section class="detail[\s\S]*?<\/section>/)?.[0] };
      replaceSide(html);
    },
  };
  const document = {
    activeElement: { closest: () => null },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    querySelector(selector) {
      if (selector === '#map') return map;
      if (selector === '#detail') return detail;
      if (selector === '.overview-side') return sideGroup;
      if (selector === '.side-deck') return deck;
      if (selector === '#popover') return { hidden: true };
      if (selector === '.side-current [data-open]') return target({ open: front });
      if (selector.startsWith('[data-side-turn=')) return target({ sideTurn: '1' });
      return null;
    },
  };
  const bundle = bundleScript();
  const boot = bundle.indexOf('async function bootEpic()');
  const handlersStart = bundle.indexOf("  document.addEventListener('click', (e) => {", boot);
  const handlersEnd = bundle.indexOf('  if (!EXPORT) setInterval(', handlersStart);
  const bootstrap = bundle.lastIndexOf('\nif (EXPORT || location.pathname');
  assert.ok(handlersStart > boot && handlersEnd > handlersStart && bootstrap > handlersEnd, 'app event handlers and bootstrap are available');
  // Keep the real handlers and app functions; skip network and unrelated page setup.
  const script = `${bundle.slice(0, bootstrap)}
    const originalToggleDetail = toggleDetail;
    toggleDetail = (...args) => { openCalls.push(args[0]); return originalToggleDetail(...args); };
    globalThis.app = {
      rotateSide, tlState,
      seed(epic, open, step) { current = epic; Object.assign(tlState, { open, step, side: null }); renderMapArea(epic); },
      bind() { bindSideCarousel(); ${bundle.slice(handlersStart, handlersEnd)} }
    };
  })();`;
  const context = vm.createContext({
    document, location, openCalls: calls,
    history: { replaceState(_state, _title, hash) { location.hash = hash; } },
    matchMedia: () => ({ matches: true }),
    performance: { now: () => 1000 },
  });
  vm.runInContext(script, context);
  const epic = sampleEpic();
  epic.tasks.find((task) => task.id === 'OPS-3').steps = [{ id: 'cert', title: 'Issue certificate', state: 'todo' }];
  epic.tasks.push(
    { id: 'DOC-4', title: '[docs] Staging guide', role: 'side', steps: [{ id: 'check', title: 'Check guide', state: 'todo' }] },
    { id: 'QA-5', title: '[qa] Staging acceptance', role: 'side', steps: [{ id: 'check', title: 'Check staging', state: 'todo' }] },
  );
  context.app.seed(epic, open, step);
  context.app.bind();
  return {
    app: context.app, calls, location, target,
    get detail() { return detail; },
    get front() { return front; },
    get mapWrites() { return mapWrites; },
    async dispatch(type, dataset = {}, extras = {}) {
      const event = { target: target(dataset), preventDefault() {}, stopPropagation() {}, ...extras };
      for (const handler of listeners.get(type) || []) await handler(event);
    },
  };
}

function browsingSnapshot(harness) {
  return { open: harness.app.tlState.open, step: harness.app.tlState.step, hash: harness.location.hash, detail: harness.detail, writes: harness.mapWrites };
}

function assertOnlyFrontChanged(harness, before, front) {
  assert.equal(harness.front, front);
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(browsingSnapshot(harness), before);
}

for (const selected of [{ open: 'WEB-8', step: 's3' }, { open: 'OPS-3', step: 'cert' }]) {
  test(`carousel wheel browses cards while ${selected.open} and its step stay open`, async () => {
    const harness = carouselApp(selected);
    const before = browsingSnapshot(harness);
    await harness.dispatch('wheel', {}, { deltaY: 60, deltaX: 0, deltaMode: 0, ctrlKey: false });
    assertOnlyFrontChanged(harness, before, 'DOC-4');
  });
}

test('carousel navigation buttons and arrow keys browse without replacing task details', async () => {
  const harness = carouselApp();
  const before = browsingSnapshot(harness);
  await harness.dispatch('click', { sideTurn: '1' });
  assertOnlyFrontChanged(harness, before, 'DOC-4');
  await harness.dispatch('keydown', {}, { key: 'ArrowDown' });
  assertOnlyFrontChanged(harness, before, 'QA-5');
});

test('clicking the front card explicitly opens its task details', async () => {
  const harness = carouselApp();
  const before = harness.detail;
  await harness.dispatch('click', { open: 'OPS-3' });
  assert.deepEqual(harness.calls, ['OPS-3']);
  assert.equal(harness.app.tlState.open, 'OPS-3');
  assert.equal(harness.app.tlState.step, 'cert');
  assert.equal(harness.location.hash, '#t-OPS-3');
  assert.notEqual(harness.detail, before);
});

test('clicking a back card explicitly brings it forward and opens its task details', async () => {
  const harness = carouselApp();
  const before = harness.detail;
  await harness.dispatch('click', { sidePick: 'DOC-4' });
  assert.deepEqual(harness.calls, ['DOC-4']);
  assert.equal(harness.front, 'DOC-4');
  assert.equal(harness.app.tlState.open, 'DOC-4');
  assert.equal(harness.app.tlState.step, 'check');
  assert.equal(harness.location.hash, '#t-DOC-4');
  assert.notEqual(harness.detail, before);
});
