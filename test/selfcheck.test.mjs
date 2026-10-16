import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpHome } from './helpers.mjs';

tmpHome();
const { selfcheck } = await import('../server/selfcheck.mjs');

test('selfcheck reports tools, ls-remote and auth per forge host', async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === '/usr/bin/which') return args[0] === 'gh' ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: `/usr/bin/${args[0]}\n`, stderr: '' };
    if (cmd === 'git') return { code: 0, stdout: 'abc\tHEAD\n', stderr: '' };
    return { code: 1, stdout: '', stderr: 'not logged in' };
  };
  const epics = [{ repos: { a: { path: '/w/a', provider: 'gitlab', project: 'gitlab.example.com/g/a' }, b: { path: '/w/b', provider: 'github', project: 'github.com/o/b' } } }];
  const r = await selfcheck({ run, epics });
  assert.match(r.version, /^\d+\.\d+\.\d+/);
  assert.deepEqual(r.tools, { git: '/usr/bin/git', glab: '/usr/bin/glab', gh: null });
  assert.deepEqual(r.lsRemote, { repo: '/w/a', ok: true, detail: 'abc\tHEAD' });
  assert.deepEqual(r.auth.map((a) => [a.provider, a.host, a.ok]), [['gitlab', 'gitlab.example.com', false], ['github', 'github.com', false]]);
  assert.ok(calls.includes('gh auth status --hostname github.com'));
});

test('selfcheck without epics does not call git', async () => {
  const run = async (cmd) => (cmd === 'git' ? assert.fail('git must not run') : { code: 0, stdout: '/x\n', stderr: '' });
  const r = await selfcheck({ run, epics: [] });
  assert.equal(r.lsRemote.ok, null);
  assert.deepEqual(r.auth, []);
});
