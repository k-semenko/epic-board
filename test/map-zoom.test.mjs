import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundleScript } from '../server/export.mjs';
import { sampleEpic } from './fixtures/sample-epic.mjs';

function mapApp() {
  const listeners = new Map();
  let html = '';
  let overview = box();
  let chain = box();
  const frame = box();
  const scrolls = [];
  const svg = {
    dataset: { w: '800' },
    style: {},
    parentElement: null,
    getBoundingClientRect() {
      return { width: Number.parseFloat(this.style.width) || 400, height: 200, left: 10, top: 20 };
    },
  };
  const label = { textContent: '' };
  const reset = { disabled: false };
  function box() {
    return { scrollLeft: 0, scrollTop: 0, scrollWidth: 0, scrollHeight: 0, clientWidth: 200, clientHeight: 120, isConnected: true };
  }
  svg.parentElement = chain;
  const map = {
    set innerHTML(value) {
      html = value;
      overview = box();
      chain = box();
      svg.parentElement = chain;
    },
    get innerHTML() { return html; },
  };
  const document = {
    body: {},
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    querySelector(selector) {
      if (selector === '#map') return map;
      if (selector === '.overview') return overview;
      if (selector === '.ov-scroll') return chain;
      if (selector === '.ov-svg') return svg;
      if (selector === '.map-zoom-scale') return label;
      if (selector === '[data-map-zoom-reset]') return reset;
      if (selector === '#map-frame') return frame;
      if (selector === '#tl-scroll') return null;
      return null;
    },
  };
  const bundle = bundleScript();
  const bootstrap = bundle.lastIndexOf('\nif (EXPORT || location.pathname');
  assert.ok(bootstrap > 0, 'app bootstrap is available');
  const script = `${bundle.slice(0, bootstrap)}
    globalThis.app = { nextMapScale, formatMapScale, tlState, renderMapArea, zoomOverview, resetOverviewScale, bindMapTools };
    current = epic;
  })();`;
  const context = vm.createContext({
    document,
    epic: sampleEpic(),
    window: { scrollX: 12, scrollY: 340, innerHeight: 800, scrollTo(x, y) { scrolls.push([x, y]); } },
    history: { replaceState() {} },
    location: { pathname: '/e/shop', hash: '' },
    setInterval() {},
  });
  vm.runInContext(script, context);
  return {
    app: context.app, scrolls, listeners, svg, label, reset,
    get html() { return html; },
    get overview() { return overview; },
    get chain() { return chain; },
    get frame() { return frame; },
  };
}

function wheel(partial) {
  const event = {
    ctrlKey: false, metaKey: false, deltaY: 0, deltaX: 0, deltaMode: 0, clientX: 40, clientY: 50,
    target: { closest: (selector) => (selector === '.overview-main' ? {} : null) },
    preventDefault() { event.defaultPrevented = true; },
    ...partial,
  };
  return event;
}

test('wheel up zooms in and the scale stays between 50% and 250%', () => {
  const { app } = mapApp();
  assert.ok(app.nextMapScale(1, -100) > 1);
  assert.ok(app.nextMapScale(1, 100) < 1);
  assert.equal(app.nextMapScale(1, 0), 1);
  assert.equal(app.nextMapScale(0.5, 500), 0.5);
  assert.equal(app.nextMapScale(2.5, -500), 2.5);
  assert.equal(app.formatMapScale(1), '100%');
  assert.equal(app.formatMapScale(1.004), '100%');
  assert.equal(app.formatMapScale(1.25), '125%');
});

test('the chain shows its scale and a reset to 100%', () => {
  const harness = mapApp();
  harness.app.renderMapArea(sampleEpic());
  assert.match(harness.html, /class="ov-head"/);
  assert.match(harness.html, /class="map-zoom"/);
  assert.match(harness.html, /map-zoom-scale">100%</);
  assert.match(harness.html, /data-map-zoom-reset disabled>Reset</);
});

test('opening another task keeps the task chain scrolled and the page still', () => {
  const harness = mapApp();
  const epic = sampleEpic();
  harness.app.renderMapArea(epic);
  harness.overview.scrollTop = 180;
  harness.overview.scrollLeft = 24;
  harness.chain.scrollTop = 40;
  harness.chain.scrollLeft = 90;
  harness.frame.scrollTop = 15;
  harness.app.tlState.open = 'API-7';
  harness.app.renderMapArea(epic);
  assert.equal(harness.overview.scrollTop, 180);
  assert.equal(harness.overview.scrollLeft, 24);
  assert.equal(harness.chain.scrollTop, 40);
  assert.equal(harness.chain.scrollLeft, 90);
  assert.equal(harness.frame.scrollTop, 15);
  assert.deepEqual(harness.scrolls.at(-1), [12, 340]);
});

test('ctrl or command wheel over the chain zooms it and blocks the page zoom', () => {
  const harness = mapApp();
  harness.app.renderMapArea(sampleEpic());
  harness.app.bindMapTools();
  const zoomIn = wheel({ ctrlKey: true, deltaY: -120 });
  for (const handler of harness.listeners.get('wheel')) handler(zoomIn);
  assert.equal(zoomIn.defaultPrevented, true);
  assert.ok(harness.app.tlState.mapScale > 1);
  assert.equal(harness.reset.disabled, false);
  assert.match(harness.label.textContent, /%$/);
  const scaled = harness.app.tlState.mapScale;

  const plain = wheel({ deltaY: -120 });
  for (const handler of harness.listeners.get('wheel')) handler(plain);
  assert.equal(plain.defaultPrevented, undefined);
  assert.equal(harness.app.tlState.mapScale, scaled);

  const command = wheel({ metaKey: true, deltaY: 80 });
  for (const handler of harness.listeners.get('wheel')) handler(command);
  assert.equal(command.defaultPrevented, true);
  assert.ok(harness.app.tlState.mapScale < scaled);
});

test('reset returns the chain to 100%', () => {
  const harness = mapApp();
  harness.app.renderMapArea(sampleEpic());
  harness.app.bindMapTools();
  harness.app.tlState.mapScale = 1.8;
  const event = { target: { closest: (selector) => (selector === '[data-map-zoom-reset]' ? {} : null) } };
  for (const handler of harness.listeners.get('click')) handler(event);
  assert.equal(harness.app.tlState.mapScale, 1);
  assert.equal(harness.label.textContent, '100%');
  assert.equal(harness.reset.disabled, true);
});

test('a click on a task card does not let the browser scroll the focused card into view', () => {
  const harness = mapApp();
  harness.app.bindMapTools();
  const card = {
    button: 0,
    defaultPrevented: false,
    preventDefault() { card.defaultPrevented = true; },
    target: { closest: (selector) => (selector === '#map [data-open]' ? {} : null) },
  };
  for (const handler of harness.listeners.get('mousedown')) handler(card);
  assert.equal(card.defaultPrevented, true);
  const info = {
    button: 0,
    defaultPrevented: false,
    preventDefault() { info.defaultPrevented = true; },
    target: { closest: (selector) => (selector === '[data-info]' || selector === '#map [data-open]' ? {} : null) },
  };
  for (const handler of harness.listeners.get('mousedown')) handler(info);
  assert.equal(info.defaultPrevented, false);
});
