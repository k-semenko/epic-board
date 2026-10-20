import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, inQuietHours } from '../server/notifier.mjs';
import { soundFile, playSound, SOUND_IDS } from '../server/sounds.mjs';
import { existsSync } from 'node:fs';

const base = {
  'feed.notify.enabled': true,
  'feed.notify.minLevel': 'normal',
  'feed.notify.sound.fire': 'board:alarm',
  'feed.notify.sound.important': 'board:chime',
  'feed.notify.sound.normal': 'board:pop',
  'feed.notify.volume': 70,
  'feed.notify.banner': true,
  'feed.notify.quietHours': '',
};

function harness({ settings = {}, items = [] } = {}) {
  const state = { rev: 1, items, clock: 0, played: [], banners: [] };
  const n = createNotifier({
    readRev: () => state.rev,
    readItems: () => state.items,
    settings: () => ({ ...base, ...settings }),
    play: (id, opts) => state.played.push([id, opts.volume]),
    banner: (title, body) => state.banners.push([title, body]),
    now: () => state.clock,
    quietMs: 10,
    lang: 'en',
  });
  const write = (next) => { state.items = next; state.rev += 1; };
  const after = (ms) => { state.clock += ms; return n.tick(); };
  return { n, state, write, after };
}

const item = (id, severity, extra = {}) => ({ id, title: `T ${id}`, severity, updatedAt: '2026-10-20T08:00:00Z', count: 1, ...extra });

test('items present at start are learned, not announced', () => {
  const h = harness({ items: [item('a', 'fire')] });
  h.n.tick();
  assert.equal(h.after(100), null);
  assert.deepEqual(h.state.played, []);
});

test('a batch waits for quiet and sounds once at its most severe level', () => {
  const h = harness();
  h.n.tick();
  h.write([item('a', 'normal'), item('b', 'important')]);
  assert.equal(h.after(1), null);
  h.write([item('a', 'normal'), item('b', 'important'), item('c', 'noise')]);
  assert.equal(h.after(5), null);
  assert.deepEqual(h.after(20), { level: 'important', count: 3 });
  assert.deepEqual(h.state.played, [['board:chime', 70]]);
  assert.equal(h.state.banners.length, 1);
  assert.equal(h.after(100), null);
});

test('fire wins, and an update to an existing item counts as new', () => {
  const h = harness({ items: [item('a', 'normal')] });
  h.n.tick();
  h.write([item('a', 'fire', { updatedAt: '2026-10-20T09:00:00Z', count: 2 })]);
  h.after(1);
  assert.equal(h.after(20).level, 'fire');
  assert.deepEqual(h.state.played, [['board:alarm', 70]]);
});

test('a noise-only batch still gets the batch sound', () => {
  const h = harness();
  h.n.tick();
  h.write([item('a', 'noise')]);
  h.after(1);
  assert.equal(h.after(20).level, 'normal');
  assert.deepEqual(h.state.played, [['board:pop', 70]]);
});

test('marked items, the minimum level, quiet hours and the switch keep it silent', () => {
  for (const [settings, items] of [
    [{}, [item('a', 'fire', { mark: { value: 'noise' } })]],
    [{ 'feed.notify.minLevel': 'fire' }, [item('a', 'important')]],
    [{ 'feed.notify.enabled': false }, [item('a', 'fire')]],
    [{ 'feed.notify.sound.important': 'none', 'feed.notify.banner': false }, [item('a', 'important')]],
  ]) {
    const h = harness({ settings });
    h.n.tick();
    h.write(items);
    h.after(1);
    h.after(20);
    assert.deepEqual(h.state.played, [], JSON.stringify(settings));
  }
});

test('quiet hours wrap past midnight', () => {
  const at = (h, m) => new Date(2026, 9, 20, h, m);
  assert.equal(inQuietHours('22:00-08:00', at(23, 30)), true);
  assert.equal(inQuietHours('22:00-08:00', at(7, 59)), true);
  assert.equal(inQuietHours('22:00-08:00', at(8, 0)), false);
  assert.equal(inQuietHours('12:00-13:00', at(12, 30)), true);
  assert.equal(inQuietHours('', at(3, 0)), false);
});

test('every board sound ships and players get the right arguments', () => {
  for (const id of SOUND_IDS.filter((x) => x.startsWith('board:'))) assert.ok(existsSync(soundFile(id)), id);
  const calls = [];
  const spawnFn = (cmd, args) => { calls.push([cmd, ...args]); return { on() {}, unref() {} }; };
  assert.equal(playSound('board:pop', { volume: 50, platform: 'darwin', spawnFn }), true);
  assert.equal(playSound('mac:Hero', { volume: 50, platform: 'linux', spawnFn }), false);
  assert.equal(playSound('board:pop', { volume: 0, platform: 'darwin', spawnFn }), false);
  assert.equal(playSound('nope', { platform: 'darwin', spawnFn }), false);
  assert.deepEqual(calls[0].slice(0, 3), ['afplay', '-v', '0.50']);
});
