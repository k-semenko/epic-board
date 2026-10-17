import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundleScript } from '../server/export.mjs';
import { sampleEpic } from './fixtures/sample-epic.mjs';

function mapApp({ timeline = false } = {}) {
  const listeners = new Map();
  let html = '';
  let overview = box();
  let chain = box();
  const frame = box();
  const steps = timeline ? box() : null;
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
    const listeners = {};
    const el = {
      scrollLeft: 0, scrollTop: 0, scrollWidth: 0, scrollHeight: 0, clientWidth: 200, clientHeight: 120, isConnected: true,
      dataset: {}, className: '', captured: false, listeners,
      classList: { add(name) { el.className = name; }, remove() { el.className = ''; } },
      setPointerCapture() { el.captured = true; },
      addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
    };
    return el;
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
      if (selector === '#tl-scroll') return steps;
      return null;
    },
  };
  const bundle = bundleScript();
  const bootstrap = bundle.lastIndexOf('\nif (EXPORT || location.pathname');
  assert.ok(bootstrap > 0, 'app bootstrap is available');
  const script = `${bundle.slice(0, bootstrap)}
    globalThis.app = { nextMapScale, formatMapScale, placeInView, tlState, renderMapArea, zoomOverview, resetOverviewScale, bindMapTools };
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
    app: context.app, scrolls, listeners, svg, label, reset, timeline: steps,
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
  const zoom = harness.html.match(/<div class="map-zoom"[\s\S]*?<\/div>/);
  assert.ok(zoom);
  assert.doesNotMatch(zoom[0], /data-map-locate/);
  assert.match(harness.html, /class="icon-btn map-locate" data-map-locate/);
  assert.match(harness.html, /data-map-height="m"[^>]*aria-pressed="true"/);
  assert.match(harness.html, /data-map-height="s"[^>]*aria-pressed="false"/);
  assert.match(harness.html, /data-map-height="l"/);
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

function pointer(partial) {
  return { button: 0, pointerId: 1, clientX: 0, clientY: 0, ...partial };
}

test('dragging the chain pans it and leaves the off-chain column still', () => {
  const harness = mapApp();
  harness.app.renderMapArea(sampleEpic());
  const ov = harness.overview;
  const chain = harness.chain;
  ov.scrollTop = 12;
  ov.scrollLeft = 3;
  chain.scrollLeft = 50;
  chain.scrollTop = 80;
  chain.scrollWidth = 900;
  chain.scrollHeight = 400;
  chain.clientWidth = 200;
  chain.clientHeight = 40;
  const fire = (type, event) => chain.listeners[type][0](event);
  fire('pointerdown', pointer({ clientX: 100, clientY: 100 }));
  fire('pointermove', pointer({ clientX: 102, clientY: 101 }));
  assert.equal(chain.scrollTop, 80);
  assert.equal(chain.scrollLeft, 50);
  fire('pointermove', pointer({ clientX: 60, clientY: 140 }));
  assert.equal(chain.scrollLeft, 90);
  assert.equal(chain.scrollTop, 40);
  assert.equal(ov.scrollTop, 12);
  assert.equal(ov.scrollLeft, 3);
  assert.equal(chain.className, 'dragging');
  assert.equal(chain.captured, true);
  fire('pointerup', pointer({}));
  const dragged = { stopped: false, preventDefault() {}, stopPropagation() { dragged.stopped = true; } };
  fire('click', dragged);
  assert.equal(dragged.stopped, true);

  harness.app.renderMapArea(sampleEpic());
  const fresh = harness.chain;
  fresh.listeners.pointerdown[0](pointer({ clientX: 10, clientY: 10 }));
  fresh.listeners.pointerup[0](pointer({ clientX: 10, clientY: 10 }));
  const tap = { stopped: false, preventDefault() {}, stopPropagation() { tap.stopped = true; } };
  fresh.listeners.click[0](tap);
  assert.equal(tap.stopped, false);
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

test('100% draws the chain at card size and zoom multiplies that size', () => {
  const harness = mapApp();
  harness.app.renderMapArea(sampleEpic());
  assert.equal(harness.svg.style.width, '800px');
  harness.app.tlState.mapScale = 2.5;
  harness.app.zoomOverview(0, 0, 0);
  assert.equal(harness.svg.style.width, '2000px');
  harness.app.resetOverviewScale();
  assert.equal(harness.app.tlState.mapScale, 1);
  assert.equal(harness.svg.style.width, '800px');
});

test('the open step scrolls to the middle, and the last step stays at the end', () => {
  const harness = mapApp({ timeline: true });
  const view = 400;
  const total = 816;
  const nodeX = (col) => 24 + col * 200;
  harness.timeline.clientWidth = view;
  harness.app.renderMapArea(sampleEpic());
  assert.equal(harness.app.tlState.step, 's3');
  assert.equal(harness.timeline.scrollLeft, harness.app.placeInView(nodeX(2), 168, view, total));
  assert.ok(harness.timeline.scrollLeft > 0);

  harness.timeline.scrollLeft = 0;
  harness.app.renderMapArea(sampleEpic());
  assert.equal(harness.timeline.scrollLeft, 0);

  harness.app.tlState.step = 's4';
  harness.app.renderMapArea(sampleEpic());
  const end = harness.app.placeInView(nodeX(3), 168, view, total);
  assert.equal(end, total - view);
  assert.equal(harness.timeline.scrollLeft, end);
  assert.equal(harness.app.placeInView(nodeX(0), 168, view, total), 0);
});
