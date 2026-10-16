import test from 'node:test';
import assert from 'node:assert/strict';
import { bindSectionSettings } from '../server/page/section-settings.mjs';

const defaultOrder = ['waiting', 'map', 'branches', 'sessions', 'decisions', 'history'];
const mapFirst = ['map', 'waiting', 'branches', 'sessions', 'decisions', 'history'];
const snapshot = (waiting, order = defaultOrder, history = 5) => ({
  epicSectionOrder: [...order], epicPageSizes: { waiting, decisions: 5, history },
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function settingsHarness(t, api, { readOnly = false } = {}) {
  const previousDocument = globalThis.document;
  const sections = defaultOrder.map((section) => ({ dataset: { section } }));
  const element = () => ({ addEventListener() {}, setAttribute() {}, focus() {} });
  const root = {
    querySelectorAll: () => sections,
    append(section) { sections.splice(sections.indexOf(section), 1); sections.push(section); },
  };
  const elements = new Map([
    ['#epic', root], ['#settings-toggle', element()], ['#settings-menu', element()], ['#section-order-open', element()],
  ]);
  globalThis.document = {
    querySelector: (selector) => elements.get(selector), createElement: element,
    body: { append() {} }, addEventListener() {},
  };
  t.after(() => { globalThis.document = previousDocument; });
  const applied = [];
  const controller = bindSectionSettings({ api, onError: assert.fail, onSettings: (settings) => applied.push(settings), readOnly });
  return { controller, applied, order: () => sections.map((section) => section.dataset.section) };
}

test('an older settings GET cannot replace the result of a newer GET', async (t) => {
  const first = deferred();
  const second = deferred();
  let reads = 0;
  const { controller, applied, order } = settingsHarness(t, () => (++reads === 1 ? first.promise : second.promise));
  const oldRead = controller.reload();
  const newRead = controller.reload();
  second.resolve(snapshot(15, mapFirst));
  assert.deepEqual(await newRead, mapFirst);
  first.resolve(snapshot(5));
  assert.deepEqual(await oldRead, mapFirst);
  assert.deepEqual(applied.map((settings) => settings.epicPageSizes.waiting), [15]);
  assert.deepEqual(order(), mapFirst);
});

test('a settings GET started before a save cannot roll back the saved page size', async (t) => {
  const read = deferred();
  const write = deferred();
  const { controller, applied, order } = settingsHarness(t, (_path, options) => options?.method === 'PUT' ? write.promise : read.promise);
  assert.equal(typeof controller.save, 'function');
  const polling = controller.reload();
  const saving = controller.save({ epicPageSizes: { waiting: 15 } });
  write.resolve(snapshot(15, mapFirst));
  assert.deepEqual(await saving, snapshot(15, mapFirst));
  read.resolve(snapshot(5));
  assert.deepEqual(await polling, mapFirst);
  assert.deepEqual(applied.map((settings) => settings.epicPageSizes.waiting), [15]);
  assert.deepEqual(order(), mapFirst);
});

test('partial settings saves run in order and reload skips GET while any save is pending', async (t) => {
  const first = deferred();
  const second = deferred();
  const writes = [];
  const { controller, applied } = settingsHarness(t, (_path, options) => {
    assert.equal(options?.method, 'PUT', 'reload must use its accepted cache while writes are pending');
    writes.push(options.body);
    return writes.length === 1 ? first.promise : second.promise;
  });
  assert.equal(typeof controller.save, 'function');
  const one = controller.save({ epicPageSizes: { waiting: 10 } });
  const two = controller.save({ epicPageSizes: { history: 15 } });
  assert.deepEqual(await controller.reload(), defaultOrder);
  assert.deepEqual(writes, [{ epicPageSizes: { waiting: 10 } }]);
  first.resolve(snapshot(10, mapFirst));
  await one;
  assert.deepEqual(await controller.reload(), mapFirst);
  assert.deepEqual(writes, [{ epicPageSizes: { waiting: 10 } }, { epicPageSizes: { history: 15 } }]);
  second.resolve(snapshot(10, mapFirst, 15));
  await two;
  assert.deepEqual(applied.map((settings) => settings.epicPageSizes), [
    { waiting: 10, decisions: 5, history: 5 }, { waiting: 10, decisions: 5, history: 15 },
  ]);
});

test('a failed settings save rejects its caller without blocking the following save or reload', async (t) => {
  const first = deferred();
  const second = deferred();
  let writes = 0;
  let reads = 0;
  const { controller, applied } = settingsHarness(t, (_path, options) => {
    if (options?.method === 'PUT') return ++writes === 1 ? first.promise : second.promise;
    reads++;
    return Promise.resolve(snapshot(15));
  });
  assert.equal(typeof controller.save, 'function');
  const rejected = assert.rejects(controller.save({ epicPageSizes: { waiting: 10 } }), /save failed/);
  const recovered = controller.save({ epicPageSizes: { waiting: 15 } });
  first.reject(new Error('save failed'));
  await rejected;
  assert.deepEqual(await controller.reload(), defaultOrder);
  assert.equal(reads, 0);
  second.resolve(snapshot(15));
  assert.deepEqual(await recovered, snapshot(15));
  assert.deepEqual(await controller.reload(), defaultOrder);
  assert.equal(reads, 1);
  assert.equal(writes, 2);
  assert.deepEqual(applied.map((settings) => settings.epicPageSizes.waiting), [15, 15]);
});

test('read-only settings load normally and expose no save operation', async (t) => {
  const { controller, applied } = settingsHarness(t, async () => snapshot(10, mapFirst), { readOnly: true });
  assert.equal(controller.save, undefined);
  assert.deepEqual(await controller.reload(), mapFirst);
  assert.equal(applied[0].epicPageSizes.waiting, 10);
});
