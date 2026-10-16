import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const svc = await import('../server/service.mjs');
const { VERSION } = await import('../server/version.mjs');

test('plist pins node, PATH and data dir', () => {
  const x = svc.plistXml({ node: '/n/bin/node', app: '/a/app', data: '/a/data', log: '/l.log', path: '/n/bin:/usr/bin' });
  assert.match(x, /<string>epic-board<\/string>/);
  assert.match(x, /<string>\/n\/bin\/node<\/string>\s*<string>\/a\/app\/server\/index\.mjs<\/string>/);
  assert.match(x, /<key>PATH<\/key><string>\/n\/bin:\/usr\/bin<\/string>/);
  assert.match(x, /<key>EPIC_BOARD_HOME<\/key><string>\/a\/data<\/string>/);
});

test('systemd unit quotes paths and runs unprivileged', () => {
  const u = svc.systemdUnit({ node: '/opt/node/bin/node', app: '/h/.local/share/epic-board/app', data: '/h/data dir', path: '/opt/node/bin:/usr/bin' });
  assert.match(u, /^ExecStart="\/opt\/node\/bin\/node" "\/h\/\.local\/share\/epic-board\/app\/server\/index\.mjs"$/m);
  assert.match(u, /^Environment="EPIC_BOARD_HOME=\/h\/data dir"$/m);
  assert.match(u, /NoNewPrivileges=true/);
  assert.match(u, /WantedBy=default.target/);
  assert.doesNotMatch(u, /PrivateTmp|network-online/, 'repos under /tmp must stay visible; network targets do nothing in user units');
  assert.match(svc.systemdUnit({ node: '/n', app: '/a/100%', data: '/d', path: '/p' }), /100%%/);
});

test('service file location per platform', () => {
  assert.equal(svc.servicePath({ env: { HOME: '/h' }, platform: 'darwin' }), '/h/Library/LaunchAgents/epic-board.plist');
  assert.equal(svc.servicePath({ env: { HOME: '/h' }, platform: 'linux' }), '/h/.config/systemd/user/epic-board.service');
  assert.equal(svc.servicePath({ env: { HOME: '/h' }, platform: 'win32' }), null);
});

test('PATH keeps tool dirs once, node first', () => {
  assert.equal(svc.servicePathVar({ git: '/usr/bin/git', gh: '/opt/homebrew/bin/gh', glab: null }, '/n/bin/node'), '/n/bin:/usr/bin:/opt/homebrew/bin:/usr/local/bin:/bin');
});

test('app copy replaces the previous one whole', () => {
  const to = join(mkdtempSync(join(tmpdir(), 'eb-app-')), 'app');
  mkdirSync(to);
  writeFileSync(join(to, 'stale.txt'), 'x');
  svc.copyApp({ to });
  assert.equal(existsSync(join(to, 'stale.txt')), false);
  assert.ok(existsSync(join(to, 'server', 'index.mjs')));
  assert.ok(existsSync(join(to, 'vendor', 'marked.min.js')));
  assert.equal(svc.installedVersion(to), null, 'a copy counts as installed only after the restart succeeded');
});

test('newer compares versions numerically', () => {
  assert.equal(svc.newer('0.10.0', '0.9.9'), true);
  assert.equal(svc.newer('0.5.0', '0.5.0'), false);
  assert.equal(svc.newer('0.4.9', '0.5.0'), false);
  assert.equal(svc.newer('1.0.0', null), true);
});

test('linux install writes the unit, keeps config and restarts; sync only moves forward', async () => {
  const home = mkdtempSync(join(tmpdir(), 'eb-home-'));
  const env = { HOME: home, USER: 'u', EPIC_BOARD_PORT: '1' };
  const app = join(home, '.local/share/epic-board/app');
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === '/usr/bin/which') return `/usr/bin/${args[0]}\n`;
    return '';
  };
  await svc.install({ exec, env, platform: 'linux', wait: false });
  const unit = readFileSync(join(home, '.config/systemd/user/epic-board.service'), 'utf8');
  assert.match(unit, /\.local\/share\/epic-board\/app\/server\/index\.mjs/);
  assert.ok(calls.includes('systemctl --user restart epic-board'));
  assert.equal(JSON.parse(readFileSync(join(home, '.config/epic-board/config.json'), 'utf8')).dataDir, join(home, '.local/share/epic-board/data'));
  assert.equal(svc.installedVersion(app), VERSION);
  assert.equal(await svc.syncIfOutdated({ env, platform: 'linux', exec }), null);
  writeFileSync(join(app, 'installed.json'), JSON.stringify({ version: '99.0.0' }));
  assert.equal(await svc.syncIfOutdated({ env, platform: 'linux', exec }), null, 'an older plugin never downgrades a newer service');
  writeFileSync(join(app, 'installed.json'), JSON.stringify({ version: '0.0.1' }));
  assert.match(await svc.syncIfOutdated({ env: { ...env, EPIC_BOARD_HOME: '/tmp/demo' }, platform: 'linux', exec }), /0\.0\.1 -> /);
  assert.doesNotMatch(readFileSync(join(home, '.config/systemd/user/epic-board.service'), 'utf8'), /\/tmp\/demo/, 'a shell override must not leak into the service');
  assert.equal(svc.installedVersion(app), VERSION);
  assert.match(svc.uninstall({ exec, env, platform: 'linux' }), /data kept/);
  assert.equal(existsSync(join(home, '.config/systemd/user/epic-board.service')), false);
});

test('a failed restart is retried by the next sync', async () => {
  const home = mkdtempSync(join(tmpdir(), 'eb-home-'));
  const env = { HOME: home, EPIC_BOARD_PORT: '1' };
  let fail = true;
  const exec = (cmd, args) => {
    if (cmd === '/usr/bin/which') return '';
    if (fail && args.includes('restart')) throw new Error('Failed to connect to bus');
    return '';
  };
  await assert.rejects(svc.install({ exec, env, platform: 'linux', wait: false }), /bus/);
  assert.equal(svc.installedVersion(join(home, '.local/share/epic-board/app')), null);
  fail = false;
  assert.match(await svc.syncIfOutdated({ env, platform: 'linux', exec }), /\? -> /);
});

test('a second sync while one is running steps aside', async () => {
  const home = mkdtempSync(join(tmpdir(), 'eb-home-'));
  const env = { HOME: home, EPIC_BOARD_PORT: '1' };
  mkdirSync(join(home, '.config/systemd/user'), { recursive: true });
  writeFileSync(join(home, '.config/systemd/user/epic-board.service'), '');
  mkdirSync(join(home, '.local/share/epic-board'), { recursive: true });
  writeFileSync(join(home, '.local/share/epic-board/install.lock'), String(process.pid));
  assert.equal(await svc.syncIfOutdated({ env, platform: 'linux', exec: () => assert.fail('must not install') }), null);
});

test('sync does nothing when the service was never installed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'eb-home-'));
  assert.equal(await svc.syncIfOutdated({ env: { HOME: home }, platform: 'linux', exec: () => assert.fail('no exec') }), null);
});

test('bootstrap retries while launchd still unloads the old agent', async () => {
  let calls = 0;
  const exec = () => {
    calls++;
    if (calls < 3) throw Object.assign(new Error('Bootstrap failed: 5'), { status: 5 });
  };
  await svc.bootstrap({ exec, uid: 501, plist: '/p.plist', sleep: async () => {} });
  assert.equal(calls, 3);
  const always = () => {
    throw Object.assign(new Error('Bootstrap failed: 5'), { status: 5 });
  };
  await assert.rejects(svc.bootstrap({ exec: always, uid: 501, plist: '/p.plist', sleep: async () => {}, attempts: 4 }), /Bootstrap failed/);
});
