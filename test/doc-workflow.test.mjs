import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundleScript } from '../server/export.mjs';

const original = '# Saved plan\n\nOriginal text.';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function documentWorkflow({ exported = false, put = () => ({ mtimeMs: 11 }), read, load, confirm = () => true, versionText = '# Archived note' } = {}) {
  const calls = [];
  const mounts = [];
  const listeners = new Map();
  const doc = { id: 'plan', title: 'Checkout plan', kind: 'plan', task: 'WEB-8', step: 'check', owned: true };
  const epic = { id: 'fixture', title: 'Checkout', tasks: [], docs: [doc] };
  let mountedPanel = false;
  let paneWrites = 0;
  let markup = '';
  let host;
  let extra;
  let saveButton;
  const panel = {
    hidden: true, style: {},
    get innerHTML() { return markup; },
    set innerHTML(html) {
      paneWrites++;
      markup = html;
      extra = { innerHTML: '', hidden: true };
      saveButton = html.includes('data-doc-save') ? { disabled: false } : null;
      host = html.includes('id="doc-editor"') ? {
        ownerDocument: document, children: [],
        appendChild(frame) { this.children.push(frame); queueMicrotask(() => frame.dispatchEvent(new Event('load'))); },
      } : null;
    },
  };
  const document = {
    body: { appendChild() { mountedPanel = true; } },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    querySelector(selector) {
      if (selector === '#doc-panel') return mountedPanel ? panel : null;
      if (selector === '#doc-editor') return host;
      if (selector === '#doc-extra') return extra;
      if (selector === '[data-doc-save]') return saveButton;
      if (selector === '.topbar') return { getBoundingClientRect: () => ({ bottom: 64 }) };
      return null;
    },
    createElement(tag) {
      if (tag === 'aside') return panel;
      assert.equal(tag, 'iframe');
      const owner = host;
      const frame = Object.assign(new EventTarget(), {
        contentDocument: { querySelector: () => ({}) },
        contentWindow: { EpicMarkdown: { mountMarkdownEditor(options) {
          const previous = [];
          const editor = {
            frame, markdown: options.text, reads: 0, destroys: 0,
            getMarkdown() { this.reads++; return read ? read(this, this.reads) : this.markdown; },
            destroy() { this.destroys++; },
            change(text) { previous.push(this.markdown); this.markdown = text; options.onChange(text); },
            undo() { if (previous.length) { this.markdown = previous.pop(); options.onChange(this.markdown); } },
          };
          mounts.push(editor);
          return editor;
        } } },
        remove() { owner.children.splice(owner.children.indexOf(frame), 1); },
      });
      return frame;
    },
  };
  const json = (data, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => data });
  const fetch = async (path, { method = 'GET', body } = {}) => {
    const payload = body ? JSON.parse(body) : undefined;
    calls.push({ path, method, body: payload });
    if (path === '/api/epics/fixture/docs/plan' && method === 'GET') {
      const snapshot = { doc, text: original, mtimeMs: 10 };
      return json(load ? await load(snapshot) : snapshot);
    }
    if (path === '/api/epics/fixture/docs/plan' && method === 'PUT') {
      const result = await put(payload);
      return json(result.data || result, result.status || 200);
    }
    if (path === '/api/epics/fixture/docs/plan/versions') return json([{ id: 'version-1', at: '2026-10-16T12:00:00Z' }]);
    if (path === '/api/epics/fixture/docs/plan/versions/version-1') return json({ text: versionText });
    assert.fail(`unexpected request: ${method} ${path}`);
  };
  const window = { confirm, addEventListener() {} };
  if (exported) window.__EPIC_EXPORT__ = { epic, docs: [{ id: 'plan', text: original }], history: [], exportedAt: '2026-10-16T12:00:00Z' };
  const bundle = bundleScript();
  const bootstrap = bundle.lastIndexOf('\nif (EXPORT || location.pathname');
  assert.ok(bootstrap > 0, 'app bootstrap is available');
  // Keep app save/cancel/version logic and the real iframe adapter; replace only browser I/O.
  const script = `${bundle.slice(0, bootstrap)}
    globalThis.app = {
      openDoc, saveDoc, closeDoc, showVersions, showVersion, docState,
      controller: () => docEditor,
      seed(epic) { current = epic; bindDocs(); }
    };
  })();`;
  const context = vm.createContext({ document, window, fetch, setInterval() {}, ResizeObserver: class { observe() {} } });
  vm.runInContext(script, context);
  context.app.seed(epic);
  return {
    app: context.app, state: context.app.docState, panel, mounts, calls,
    get editor() { return mounts.at(-1); },
    get extra() { return extra; },
    get paneWrites() { return paneWrites; },
    get writes() { return calls.filter((call) => call.method === 'PUT'); },
    get saveDisabled() { return saveButton?.disabled; },
    async open() { await context.app.openDoc('plan'); await context.app.controller()?.ready; },
    async click(selector) {
      const target = { closest: (value) => value === selector ? target : null };
      for (const callback of listeners.get('click') || []) await callback({ target, preventDefault() {} });
    },
  };
}

test('live documents open directly in one editor while exports open a read-only view', async () => {
  const live = documentWorkflow();
  await live.open();
  assert.equal(live.state.mode, 'edit');
  assert.equal(live.state.ready, true);
  assert.equal(live.mounts.length, 1);
  assert.equal(live.editor.markdown, original);
  assert.equal(live.state.text, original);
  assert.equal(live.state.draft, original);
  assert.match(live.panel.innerHTML, /id="doc-editor"/);
  assert.doesNotMatch(live.panel.innerHTML, /id="doc-text"|id="doc-preview"/);
  const exported = documentWorkflow({ exported: true });
  await exported.open();
  assert.equal(exported.state.mode, 'view');
  assert.equal(exported.app.controller(), null);
  assert.equal(exported.mounts.length, 0);
  assert.match(exported.panel.innerHTML, /class="doc-body"/);
  assert.deepEqual(exported.calls, []);
});

test('saving unchanged markdown skips PUT and keeps the editor ready', async () => {
  const harness = documentWorkflow();
  await harness.open();
  const controller = harness.app.controller();
  await harness.app.saveDoc();
  assert.deepEqual(harness.writes, []);
  assert.equal(harness.app.controller(), controller);
  assert.equal(harness.state.mtimeMs, 10);
  assert.equal(harness.state.dirty, false);
  assert.equal(harness.state.saving, false);
  assert.equal(harness.state.ready, true);
  assert.equal(harness.saveDisabled, true);
  assert.equal(harness.paneWrites, 1);
});

test('save waits for markdown and sends its revision timestamp', async () => {
  const reading = deferred();
  const harness = documentWorkflow({ read: (editor, count) => count === 1 ? reading.promise : editor.markdown });
  await harness.open();
  harness.editor.change('# Editor snapshot');
  const saving = harness.app.saveDoc();
  assert.equal(harness.state.saving, true);
  assert.equal(harness.saveDisabled, true);
  assert.deepEqual(harness.writes, []);
  reading.resolve('# Editor snapshot');
  await saving;
  assert.deepEqual(harness.writes.map((call) => call.body), [{ text: '# Editor snapshot', mtimeMs: 10 }]);
  assert.equal(harness.state.text, '# Editor snapshot');
  assert.equal(harness.state.mtimeMs, 11);
});

test('successful save keeps the same editor and its undo history', async () => {
  const harness = documentWorkflow();
  await harness.open();
  const controller = harness.app.controller();
  harness.editor.change('# First draft');
  harness.editor.change('# Final draft');
  assert.equal(harness.state.text, original);
  await harness.app.saveDoc();
  assert.equal(harness.state.text, '# Final draft');
  assert.equal(harness.state.dirty, false);
  assert.equal(harness.state.mode, 'edit');
  assert.equal(harness.app.controller(), controller);
  assert.equal(harness.mounts.length, 1);
  assert.equal(harness.editor.destroys, 0);
  assert.equal(harness.paneWrites, 1);
  harness.editor.undo();
  assert.equal(harness.state.text, '# Final draft');
  assert.equal(harness.state.draft, '# First draft');
  assert.equal(harness.state.dirty, true);
});

test('409 keeps the draft, editor and timestamp and shows a local error', async () => {
  const harness = documentWorkflow({ put: () => ({ status: 409, data: { detail: 'Changed on disk' } }) });
  await harness.open();
  const controller = harness.app.controller();
  harness.editor.change('# Unsaved draft');
  await harness.app.saveDoc();
  assert.equal(harness.state.text, original);
  assert.equal(harness.state.draft, '# Unsaved draft');
  assert.equal(harness.state.dirty, true);
  assert.equal(harness.state.mtimeMs, 10);
  assert.equal(harness.state.saving, false);
  assert.equal(harness.saveDisabled, false);
  assert.equal(harness.app.controller(), controller);
  assert.equal(harness.mounts.length, 1);
  assert.equal(harness.editor.destroys, 0);
  assert.equal(harness.paneWrites, 1);
  assert.match(harness.extra.innerHTML, /role="alert"/);
  assert.match(harness.extra.innerHTML, /Changed on disk/);
  assert.equal(harness.extra.hidden, false);
});

test('edits made during PUT remain dirty after the earlier snapshot is saved', async () => {
  const sent = deferred();
  const response = deferred();
  const harness = documentWorkflow({ put: (payload) => { sent.resolve(payload); return response.promise; } });
  await harness.open();
  const controller = harness.app.controller();
  harness.editor.change('# Snapshot being saved');
  const saving = harness.app.saveDoc();
  assert.deepEqual(await sent.promise, { text: '# Snapshot being saved', mtimeMs: 10 });
  harness.editor.change('# Later edit');
  response.resolve({ mtimeMs: 11 });
  await saving;
  assert.equal(harness.state.text, '# Snapshot being saved');
  assert.equal(harness.state.draft, '# Later edit');
  assert.equal(harness.state.dirty, true);
  assert.equal(harness.state.mtimeMs, 11);
  assert.equal(harness.app.controller(), controller);
  assert.equal(harness.mounts.length, 1);
  assert.equal(harness.paneWrites, 1);
});

test('another edit can be saved after cancel is attempted during an in-flight PUT', async () => {
  const sent = deferred();
  const response = deferred();
  let attempts = 0;
  const harness = documentWorkflow({ put: (payload) => {
    if (++attempts === 1) { sent.resolve(payload); return response.promise; }
    return { mtimeMs: 12 };
  } });
  await harness.open();
  harness.editor.change('# First save');
  const saving = harness.app.saveDoc();
  await sent.promise;
  await harness.click('[data-doc-cancel]');
  response.resolve({ mtimeMs: 11 });
  await saving;
  if (harness.state.mode === 'view') {
    await harness.click('[data-doc-edit]');
    await harness.app.controller().ready;
  }
  harness.editor.change('# Next save');
  await harness.app.saveDoc();
  assert.equal(harness.writes.length, 2);
  assert.equal(harness.writes[1].body.text, '# Next save');
  assert.equal(harness.state.saving, false);
});

test('closing while a document GET is pending keeps the late response from reopening its panel', async () => {
  const requested = deferred();
  const response = deferred();
  const harness = documentWorkflow({ load: (snapshot) => { requested.resolve(snapshot); return response.promise; } });
  const opening = harness.app.openDoc('plan');
  const snapshot = await requested.promise;
  harness.app.closeDoc();
  response.resolve(snapshot);
  await opening;
  assert.equal(harness.panel.hidden, true);
  assert.equal(harness.state.id, null);
  assert.equal(harness.app.controller(), null);
});

test('a declined replacement preserves edits made while the document GET was pending', async () => {
  const requested = deferred();
  const response = deferred();
  let reads = 0;
  const harness = documentWorkflow({ confirm: () => false, load: (snapshot) => {
    if (++reads === 1) return snapshot;
    requested.resolve(snapshot);
    return response.promise;
  } });
  await harness.open();
  const controller = harness.app.controller();
  const opening = harness.app.openDoc('plan');
  const snapshot = await requested.promise;
  harness.editor.change('# Typed while loading');
  response.resolve({ ...snapshot, text: '# Remote update', mtimeMs: 20 });
  await opening;
  assert.equal(harness.app.controller(), controller);
  assert.equal(harness.state.text, original);
  assert.equal(harness.state.draft, '# Typed while loading');
  assert.equal(harness.state.dirty, true);
});

test('declining version restore preserves a dirty editor even when the version equals the saved source', async () => {
  const harness = documentWorkflow({ confirm: () => false, versionText: original });
  await harness.open();
  const controller = harness.app.controller();
  harness.editor.change('# Keep this draft');
  await harness.app.showVersion('version-1');
  await harness.click('[data-doc-restore]');
  assert.equal(harness.app.controller(), controller);
  assert.equal(harness.state.text, original);
  assert.equal(harness.state.draft, '# Keep this draft');
  assert.equal(harness.state.dirty, true);
});

test('versions render beside the current draft without remounting the editor', async () => {
  const harness = documentWorkflow();
  await harness.open();
  const controller = harness.app.controller();
  harness.editor.change('# Current draft');
  await harness.app.showVersions();
  assert.match(harness.extra.innerHTML, /data-doc-version="version-1"/);
  await harness.app.showVersion('version-1');
  assert.match(harness.extra.innerHTML, /Archived note/);
  assert.equal(harness.state.text, original);
  assert.equal(harness.state.draft, '# Current draft');
  assert.equal(harness.app.controller(), controller);
  assert.equal(harness.mounts.length, 1);
  assert.equal(harness.editor.destroys, 0);
  assert.equal(harness.paneWrites, 1);
});

test('cancel restores the saved view and destroys the discarded editor', async () => {
  const harness = documentWorkflow();
  await harness.open();
  const editor = harness.editor;
  editor.change('# Discard this draft');
  await harness.click('[data-doc-cancel]');
  assert.equal(harness.state.mode, 'view');
  assert.equal(harness.state.text, original);
  assert.equal(harness.state.draft, original);
  assert.equal(harness.state.dirty, false);
  assert.equal(harness.app.controller(), null);
  assert.equal(editor.destroys, 1);
  assert.match(harness.panel.innerHTML, /class="doc-body"/);
  assert.match(harness.panel.innerHTML, /Original text/);
  assert.doesNotMatch(harness.panel.innerHTML, /Discard this draft|id="doc-editor"/);
  assert.deepEqual(harness.writes, []);
});

test('closing the document destroys its controller and hides the panel', async () => {
  const harness = documentWorkflow();
  await harness.open();
  const editor = harness.editor;
  editor.change('# Draft before close');
  harness.app.closeDoc();
  assert.equal(harness.app.controller(), null);
  assert.equal(editor.destroys, 1);
  assert.equal(harness.panel.hidden, true);
  assert.equal(harness.state.id, null);
  assert.equal(harness.state.ready, false);
  assert.deepEqual(harness.writes, []);
});
