import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocEditor } from '../server/page/doc-editor.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function editorFrame(mount) {
  const root = {};
  const children = [];
  let frame;
  let removals = 0;
  const container = {
    ownerDocument: {
      createElement(tag) {
        assert.equal(tag, 'iframe');
        frame = Object.assign(new EventTarget(), {
          contentDocument: { querySelector: (selector) => selector === '#editor-root' ? root : null },
          contentWindow: { EpicMarkdown: { mountMarkdownEditor: mount } },
          remove() {
            removals++;
            const index = children.indexOf(this);
            if (index !== -1) children.splice(index, 1);
          },
        });
        return frame;
      },
    },
    appendChild(child) { children.push(child); },
  };
  return {
    container, root, children,
    get frame() { return frame; },
    get removals() { return removals; },
    load() { frame.dispatchEvent(new Event('load')); },
    fail() { frame.dispatchEvent(new Event('error')); },
  };
}

test('iframe editor waits for mount and reads the current markdown', async () => {
  const mounting = deferred();
  const changes = [];
  const saves = [];
  let options;
  let markdown = '# Initial';
  const harness = editorFrame((value) => { options = value; return mounting.promise; });
  const editor = createDocEditor({
    container: harness.container, text: '# Initial', lang: 'ru', title: 'Edit plan',
    onChange: (...args) => changes.push(args), onSave: (...args) => saves.push(args),
  });
  assert.equal(harness.children.length, 1);
  assert.equal(harness.frame.className, 'doc-editor-frame');
  assert.equal(harness.frame.src, '/editor');
  assert.equal(harness.frame.title, 'Edit plan');
  let readFinished = false;
  const reading = editor.getMarkdown().then((value) => { readFinished = true; return value; });
  await Promise.resolve();
  assert.equal(readFinished, false);
  harness.load();
  assert.equal(options.root, harness.root);
  assert.equal(options.text, '# Initial');
  assert.equal(options.lang, 'ru');
  options.onChange('# Changed');
  options.onSave();
  assert.deepEqual(changes, [['# Changed']]);
  assert.deepEqual(saves, [[]]);
  assert.equal(readFinished, false);
  mounting.resolve({ getMarkdown: () => markdown, destroy() {} });
  await editor.ready;
  assert.equal(await reading, '# Initial');
  markdown = '# Latest';
  assert.equal(await editor.getMarkdown(), '# Latest');
  editor.destroy();
});

test('destroy before load settles pending reads and ignores later frame events', async () => {
  let mounts = 0;
  const errors = [];
  const harness = editorFrame(() => { mounts++; });
  const editor = createDocEditor({ container: harness.container, onError: (error) => errors.push(error) });
  const ready = assert.rejects(editor.ready, { name: 'AbortError' });
  const reading = assert.rejects(editor.getMarkdown(), { name: 'AbortError' });
  editor.destroy();
  editor.destroy();
  harness.load();
  harness.fail();
  await Promise.all([ready, reading]);
  assert.equal(mounts, 0);
  assert.equal(harness.removals, 1);
  assert.equal(harness.children.length, 0);
  assert.deepEqual(errors, []);
});

test('destroy during mount suppresses stale callbacks and disposes the late editor', async () => {
  const mounting = deferred();
  const callbacks = [];
  let options;
  let disposals = 0;
  const harness = editorFrame((value) => { options = value; return mounting.promise; });
  const editor = createDocEditor({
    container: harness.container,
    onChange: () => callbacks.push('change'), onSave: () => callbacks.push('save'), onError: () => callbacks.push('error'),
  });
  harness.load();
  const ready = assert.rejects(editor.ready, { name: 'AbortError' });
  editor.destroy();
  options.onChange('stale');
  options.onSave();
  mounting.resolve({ getMarkdown: () => 'stale', destroy() { disposals++; } });
  await ready;
  await Promise.resolve();
  editor.destroy();
  assert.equal(disposals, 1);
  assert.deepEqual(callbacks, []);
  await assert.rejects(editor.getMarkdown(), { name: 'AbortError' });
});

test('destroy after mount is idempotent and disables the old editor callbacks', async () => {
  let options;
  let disposals = 0;
  const callbacks = [];
  const harness = editorFrame((value) => {
    options = value;
    return { getMarkdown: () => 'text', destroy() { disposals++; } };
  });
  const editor = createDocEditor({
    container: harness.container, onChange: () => callbacks.push('change'), onSave: () => callbacks.push('save'),
  });
  harness.load();
  await editor.ready;
  editor.destroy();
  editor.destroy();
  options.onChange('stale');
  options.onSave();
  harness.load();
  assert.equal(disposals, 1);
  assert.equal(harness.removals, 1);
  assert.deepEqual(callbacks, []);
  await assert.rejects(editor.getMarkdown(), { name: 'AbortError' });
});

test('frame load errors reject ready and report one initialization error', async () => {
  let mounts = 0;
  const errors = [];
  const harness = editorFrame(() => { mounts++; });
  const editor = createDocEditor({ container: harness.container, onError: (error) => errors.push(error) });
  harness.fail();
  harness.fail();
  harness.load();
  await assert.rejects(editor.ready, /load/i);
  await assert.rejects(editor.getMarkdown(), /load/i);
  assert.equal(mounts, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Error);
  editor.destroy();
});

test('mount failures are handled before the caller starts waiting', async () => {
  const failure = new Error('Mount failed');
  const errors = [];
  const harness = editorFrame(async () => { throw failure; });
  const editor = createDocEditor({ container: harness.container, onError: (error) => errors.push(error) });
  harness.load();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(editor.ready, (error) => error === failure);
  await assert.rejects(editor.getMarkdown(), (error) => error === failure);
  assert.deepEqual(errors, [failure]);
  editor.destroy();
});

test('missing frame root or API reports initialization failure', async () => {
  for (const missing of ['root', 'api']) {
    const errors = [];
    const harness = editorFrame(() => assert.fail('mount must not run'));
    const editor = createDocEditor({ container: harness.container, onError: (error) => errors.push(error) });
    if (missing === 'root') harness.frame.contentDocument.querySelector = () => null;
    else harness.frame.contentWindow.EpicMarkdown = undefined;
    harness.load();
    await assert.rejects(editor.ready, /editor/i);
    assert.equal(errors.length, 1);
    editor.destroy();
  }
});

test('a mount rejection after destroy does not report an obsolete error', async () => {
  const mounting = deferred();
  const errors = [];
  const harness = editorFrame(() => mounting.promise);
  const editor = createDocEditor({ container: harness.container, onError: (error) => errors.push(error) });
  harness.load();
  const ready = assert.rejects(editor.ready, { name: 'AbortError' });
  editor.destroy();
  mounting.reject(new Error('Obsolete mount failure'));
  await ready;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, []);
});
