import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataDir, appDir, port, host, allowedHosts, boardUrl, readConfig } from '../server/paths.mjs';

const homeWith = (config) => {
  const home = mkdtempSync(join(tmpdir(), 'eb-home-'));
  mkdirSync(join(home, '.config', 'epic-board'), { recursive: true });
  writeFileSync(join(home, '.config', 'epic-board', 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  return home;
};

test('EPIC_BOARD_HOME wins', () => {
  assert.equal(dataDir({ EPIC_BOARD_HOME: '/x/data', HOME: '/h' }), '/x/data');
});

test('config file is the second source', () => {
  assert.equal(dataDir({ HOME: homeWith({ dataDir: '/repo/data' }) }), '/repo/data');
});

test('default follows XDG, broken config ignored', () => {
  const home = homeWith('{oops');
  assert.equal(dataDir({ HOME: home }), join(home, '.local', 'share', 'epic-board', 'data'));
  assert.equal(dataDir({ HOME: home, XDG_DATA_HOME: '/xdg' }), join('/xdg', 'epic-board', 'data'));
  assert.equal(appDir({ HOME: home }), join(home, '.local', 'share', 'epic-board', 'app'));
  assert.deepEqual(readConfig({ HOME: home }), {});
});

test('port, host and url', () => {
  assert.equal(port({ HOME: '/nowhere' }), 4747);
  assert.equal(port({ EPIC_BOARD_PORT: '5000' }), 5000);
  assert.equal(port({ HOME: homeWith({ port: 4800 }) }), 4800);
  assert.equal(host({ HOME: '/nowhere' }), 'localhost');
  assert.equal(boardUrl('E-1', { HOME: '/nowhere' }), 'http://localhost:4747/e/E-1');
  const custom = { HOME: homeWith({ host: 'board.test', port: 5000 }) };
  assert.equal(boardUrl(undefined, custom), 'http://board.test:5000/');
  assert.deepEqual(allowedHosts(5000, custom), ['localhost:5000', '127.0.0.1:5000', 'board.test:5000']);
});
