import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tmpHome } from './helpers.mjs';

tmpHome();
const home = mkdtempSync(join(tmpdir(), 'eb-proxy-'));
mkdirSync(join(home, '.config', 'epic-board'), { recursive: true });
writeFileSync(join(home, '.config', 'epic-board', 'config.json'), JSON.stringify({ publicUrl: 'https://board.test' }));
process.env.HOME = home;
delete process.env.XDG_CONFIG_HOME;
const { createBoardServer } = await import('../server/http.mjs');
const server = createBoardServer({ port: 0 });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const raw = (path, headers, method = 'GET', body) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject);
  req.end(body);
});

test('a reverse proxy without a port is allowed, other hosts and origins are not', async () => {
  assert.equal(await raw('/api/health', { Host: 'board.test' }), 200);
  assert.equal(await raw('/api/health', { Host: 'evil.test' }), 403);
  const post = (origin) => raw('/api/epics', { Host: 'board.test', Origin: origin, 'Content-Type': 'application/json' }, 'POST', JSON.stringify({ id: 'P', title: 'p' }));
  assert.equal(await post('https://board.test'), 201);
  assert.equal(await post('https://evil.test'), 403);
});

test.after(() => server.close());
