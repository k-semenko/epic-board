import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('demo boots with all input formats and truthful submitted/closed sample states', async () => {
  const data = mkdtempSync(join(tmpdir(), 'epic-board-demo-test-'));
  const child = spawn(process.execPath, [new URL('../scripts/demo.mjs', import.meta.url).pathname], { env: { ...process.env, EPIC_BOARD_HOME: data, EPIC_BOARD_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`demo did not start: ${stderr}`)), 5000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`demo exited ${code}: ${stderr}`)); });
      child.stdout.on('data', (chunk) => {
        const match = String(chunk).match(/http:\/\/localhost:(\d+)\/e\/SHOP-1/);
        if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
      });
    });
    const response = await fetch(`${url}/api/epics/SHOP-1`);
    assert.equal(response.status, 200);
    const epic = await response.json();
    assert.deepEqual(new Set(epic.waiting.map((item) => item.input.type)), new Set(['confirm', 'single', 'multi']));
    assert.ok(epic.waiting.some((item) => item.status === 'answered' && !item.doneAt));
    assert.ok(epic.waiting.some((item) => item.status === 'closed' && item.rounds[0]?.review?.outcome === 'accepted'));
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  }
});
