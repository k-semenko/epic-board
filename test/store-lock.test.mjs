import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpHome } from './helpers.mjs';

const home = tmpHome();
mkdirSync(join(home, 'epics'), { recursive: true });
const store = await import('../server/store.mjs');
const lockFile = join(home, 'epics', '5.lock');

test('two processes do not lose increments', async () => {
  writeFileSync(join(home, 'counter.txt'), '0');
  const run = () => new Promise((resolve) => {
    const child = spawn(process.execPath, ['test/fixtures/lock-writer.mjs', '5', '50'], { env: process.env });
    child.on('exit', resolve);
  });
  await Promise.all([run(), run()]);
  assert.equal(readFileSync(join(home, 'counter.txt'), 'utf8'), '100');
});

test('live owner keeps the lock: 423 after timeout', () => {
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: 'x' }));
  assert.throws(() => store.withLock('5', () => 1, { timeoutMs: 100 }), { status: 423 });
  assert.ok(existsSync(lockFile));
});

test('dead owner lock is taken over', () => {
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  writeFileSync(lockFile, JSON.stringify({ pid: Number(dead.stdout.trim()), at: 'x' }));
  assert.equal(store.withLock('5', () => 42, { timeoutMs: 1000 }), 42);
  assert.ok(!existsSync(lockFile));
});
