import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundleScript } from '../server/export.mjs';
import { sampleEpic } from './fixtures/sample-epic.mjs';

function documentApp({ mapFull = false } = {}) {
  const mutations = [];
  const classes = new Set(mapFull ? ['page-root', 'tl-locked'] : ['page-root']);
  const frameClasses = new Set(mapFull ? ['map-full'] : []);
  const frame = {
    classList: {
      contains: (value) => frameClasses.has(value),
      toggle(value, on) { on ? frameClasses.add(value) : frameClasses.delete(value); },
    },
  };
  const resizeCallbacks = [];
  let headerBottom = 72;
  let mounted = false;
  const radios = [{ value: 'new', checked: true, addEventListener() {} }, { value: 'link', checked: false, addEventListener() {} }];
  const panel = {
    hidden: true, innerHTML: '', style: {},
    querySelector: (selector) => selector === 'input[value="link"]' ? radios[1] : radios.find((r) => r.checked),
    querySelectorAll: () => radios,
  };
  const body = {
    classList: {
      add(value) { mutations.push(['class:add', value]); classes.add(value); },
      remove(value) { mutations.push(['class:remove', value]); classes.delete(value); },
      toggle(value, on) { mutations.push(['class:toggle', value, on]); on ? classes.add(value) : classes.delete(value); },
    },
    style: new Proxy({}, { set(target, key, value) { mutations.push(['style', key, value]); target[key] = value; return true; } }),
    appendChild() { mounted = true; },
  };
  const topbar = { getBoundingClientRect: () => ({ bottom: headerBottom, height: headerBottom }) };
  const saveButton = { disabled: false };
  const document = {
    body, documentElement: { scrollTop: 420 }, addEventListener() {},
    createElement(tag) {
      if (tag === 'aside') return panel;
      assert.equal(tag, 'iframe');
      const frame = Object.assign(new EventTarget(), {
        contentDocument: { querySelector: () => ({}) },
        contentWindow: { EpicMarkdown: { mountMarkdownEditor: ({ text }) => ({ getMarkdown: () => text, destroy() {} }) } },
        remove() { editorHost.children.splice(editorHost.children.indexOf(frame), 1); },
      });
      return frame;
    },
    querySelector(selector) {
      if (selector === '#doc-panel') return mounted ? panel : null;
      if (selector === '#map-frame') return frame;
      if (selector === '.topbar') return topbar;
      if (selector === '#df-path-row') return { hidden: true };
      if (selector === '#doc-form') return { addEventListener() {} };
      if (selector === '#doc-editor') return editorHost;
      if (selector === '[data-doc-save]') return panel.innerHTML.includes('data-doc-save') ? saveButton : null;
      return null;
    },
  };
  const editorHost = {
    ownerDocument: document, children: [],
    appendChild(frame) { this.children.push(frame); queueMicrotask(() => frame.dispatchEvent(new Event('load'))); },
  };
  const window = { scrollX: 17, scrollY: 420, confirm: () => true, addEventListener() {}, scrollTo: (...args) => mutations.push(['scrollTo', ...args]) };
  const bundle = bundleScript();
  const bootstrap = bundle.lastIndexOf('\nif (EXPORT || location.pathname');
  assert.ok(bootstrap > 0, 'app bootstrap is available');
  // Exercise the real document panel functions without booting the rest of the page.
  const script = `${bundle.slice(0, bootstrap)}
    globalThis.app = {
      renderDocPanel, addDocForm, closeDoc, docState,
      seed(epic) { current = epic; Object.assign(docState, { id: 'plan', text: '# Checkout plan\\n\\nPlan text.', mode: 'view', dirty: false }); }
    };
  })();`;
  class ResizeObserver {
    constructor(callback) { resizeCallbacks.push(callback); }
    observe() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserver;
  const context = vm.createContext({ document, window, ResizeObserver, setInterval() {}, requestAnimationFrame: (callback) => callback() });
  vm.runInContext(script, context);
  const epic = sampleEpic();
  epic.docsMode = 'board';
  epic.tasks.find((task) => task.id === 'OPS-3').steps = [{ id: 'cert', title: 'Issue certificate', state: 'active' }];
  context.app.seed(epic);
  const doc = { id: 'plan', title: 'Checkout plan', kind: 'plan', task: 'WEB-8', step: 's3', owned: true, path: '/board/docs/plan.md' };
  return {
    app: context.app, panel, doc, mutations,
    editorHost, ready: () => new Promise((resolve) => setImmediate(resolve)),
    isMapFull: () => frameClasses.has('map-full'),
    snapshot: () => ({ classes: [...classes], styles: { ...body.style }, scrollX: window.scrollX, scrollY: window.scrollY, scrollTop: document.documentElement.scrollTop }),
    resizeHeader(bottom) { headerBottom = bottom; for (const callback of resizeCallbacks) callback([{ target: topbar }]); },
  };
}

for (const mode of ['view', 'edit']) {
  test(`document ${mode} keeps the page body and scroll unchanged`, async () => {
    const harness = documentApp();
    const before = harness.snapshot();
    harness.app.docState.mode = mode;
    harness.app.renderDocPanel(harness.doc);
    await harness.ready();
    assert.equal(harness.panel.hidden, false);
    assert.ok(Number.parseFloat(harness.panel.style.top) >= 72);
    assert.match(harness.panel.innerHTML, mode === 'edit' ? /id="doc-editor"/ : /class="doc-body"/);
    assert.deepEqual(harness.mutations, []);
    assert.deepEqual(harness.snapshot(), before);
  });
}

test('document editing uses one formatted editing surface', async () => {
  const harness = documentApp();
  harness.app.docState.mode = 'edit';
  harness.app.renderDocPanel(harness.doc);
  await harness.ready();
  assert.match(harness.panel.innerHTML, /id="doc-editor"/);
  assert.doesNotMatch(harness.panel.innerHTML, /id="doc-text"|id="doc-preview"/);
  assert.equal(harness.editorHost.children.length, 1);
  assert.equal(harness.editorHost.children[0].src, '/editor');
  assert.equal(harness.app.docState.ready, true);
});

test('new document form keeps the page body and scroll unchanged', () => {
  const harness = documentApp();
  const before = harness.snapshot();
  harness.app.addDocForm('WEB-8');
  assert.equal(harness.panel.hidden, false);
  assert.ok(Number.parseFloat(harness.panel.style.top) >= 72);
  assert.match(harness.panel.innerHTML, /id="doc-form"/);
  assert.deepEqual(harness.mutations, []);
  assert.deepEqual(harness.snapshot(), before);
});

test('new document form lists steps of a side task without changing the page body', () => {
  const harness = documentApp();
  const before = harness.snapshot();
  harness.app.addDocForm('OPS-3');
  assert.equal(harness.panel.hidden, false);
  assert.match(harness.panel.innerHTML, /id="doc-form"/);
  assert.match(harness.panel.innerHTML, /<option value="cert" selected>Issue certificate<\/option>/);
  assert.ok(Number.parseFloat(harness.panel.style.top) >= 72);
  assert.deepEqual(harness.mutations, []);
  assert.deepEqual(harness.snapshot(), before);
});

test('opening a document exits the full map and releases its scroll lock', () => {
  const harness = documentApp({ mapFull: true });
  const before = harness.snapshot();
  harness.app.renderDocPanel(harness.doc);
  assert.equal(harness.panel.hidden, false);
  assert.equal(harness.isMapFull(), false);
  assert.deepEqual(harness.snapshot(), { ...before, classes: ['page-root'] });
  assert.ok(Number.parseFloat(harness.panel.style.top) >= 72);
});

test('closing a document hides its panel without changing the page body or scroll', () => {
  const harness = documentApp();
  harness.app.renderDocPanel(harness.doc);
  harness.mutations.length = 0;
  const before = harness.snapshot();
  harness.app.closeDoc();
  assert.equal(harness.panel.hidden, true);
  assert.equal(harness.app.docState.id, null);
  assert.deepEqual(harness.mutations, []);
  assert.deepEqual(harness.snapshot(), before);
});

test('document panel follows the bottom of the header when its height changes', () => {
  const harness = documentApp();
  harness.app.renderDocPanel(harness.doc);
  const initialTop = Number.parseFloat(harness.panel.style.top);
  assert.ok(initialTop >= 72);
  harness.resizeHeader(128);
  const resizedTop = Number.parseFloat(harness.panel.style.top);
  assert.ok(resizedTop >= 128);
  assert.equal(resizedTop - initialTop, 56);
  assert.deepEqual(harness.mutations, []);
});
