import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appDir, baseDir, dataDir, port, boardUrl, configPath, readConfig } from './paths.mjs';
import { VERSION } from './version.mjs';

export const LABEL = 'epic-board';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PARTS = ['server', 'vendor', 'cli', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function servicePath({ env = process.env, platform = process.platform } = {}) {
  const home = env.HOME || homedir();
  if (platform === 'darwin') return join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (platform === 'linux') return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'systemd', 'user', `${LABEL}.service`);
  return null;
}

// The service sees a bare PATH, so the directories of the tools found now are pinned into it.
export function servicePathVar(tools, node = process.execPath) {
  const dirs = [dirname(node), ...Object.values(tools).filter(Boolean).map((p) => dirname(p)), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  return [...new Set(dirs)].join(delimiter);
}

export function plistXml({ node, app, data, log, path }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(join(app, 'server', 'index.mjs'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(app)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(path)}</string>
    <key>EPIC_BOARD_HOME</key><string>${xml(data)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

// systemd expands % specifiers everywhere in a unit, so a literal % is written as %%.
const quote = (s) => `"${String(s).replace(/%/g, '%%').replace(/(["\\$`])/g, '\\$1')}"`;

export function systemdUnit({ node, app, data, path }) {
  return `[Unit]
Description=epic-board local dashboard

[Service]
ExecStart=${quote(node)} ${quote(join(app, 'server', 'index.mjs'))}
WorkingDirectory=${String(app).replace(/%/g, '%%')}
Environment=${quote(`PATH=${path}`)}
Environment=${quote(`EPIC_BOARD_HOME=${data}`)}
Restart=on-failure
RestartSec=2
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;
}

// A copy next to the data survives plugin updates; the swap is a rename, so the service never sees half a tree.
export function copyApp({ from = ROOT, to = appDir() } = {}) {
  const staging = `${to}.new-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const part of PARTS) if (existsSync(join(from, part))) cpSync(join(from, part), join(staging, part), { recursive: true });
  const old = `${to}.old-${process.pid}`;
  if (existsSync(to)) renameSync(to, old);
  renameSync(staging, to);
  rmSync(old, { recursive: true, force: true });
  return to;
}

// Written only after the service restarted on the new copy, so a failed restart is retried later.
const MARKER = 'installed.json';

export function installedVersion(app = appDir()) {
  try {
    return JSON.parse(readFileSync(join(app, MARKER), 'utf8')).version || null;
  } catch {
    return null;
  }
}

const parts = (v) => String(v).split('-')[0].split('.').map((n) => Number(n) || 0);

export function newer(a, b) {
  if (!b) return true;
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

const which = (exec, bin) => {
  try {
    return exec('/usr/bin/which', [bin], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
};

async function waitHealthy(url, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${url}api/health`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

function writeConfig(env) {
  const config = readConfig(env);
  if (!config.dataDir) {
    mkdirSync(dirname(configPath(env)), { recursive: true });
    writeFileSync(configPath(env), `${JSON.stringify({ ...config, dataDir: dataDir(env) }, null, 2)}\n`);
  }
}

// launchctl bootout returns before the agent is gone, so bootstrap right after it can fail with error 5.
export async function bootstrap({ exec, uid, plist, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 20 }) {
  for (let i = 1; ; i++) {
    try {
      exec('launchctl', ['bootstrap', `gui/${uid}`, plist], { stdio: 'pipe' });
      return;
    } catch (e) {
      if (e.status !== 5 || i >= attempts) throw e;
      await sleep(250);
    }
  }
}

export async function install({ exec = execFileSync, env = process.env, platform = process.platform, wait = true } = {}) {
  const unit = servicePath({ env, platform });
  if (!unit) throw new Error(`no service manager support for ${platform}; run "node server/index.mjs" yourself`);
  const app = copyApp({ to: appDir(env) });
  const data = dataDir(env);
  mkdirSync(data, { recursive: true });
  writeConfig(env);
  const tools = { git: which(exec, 'git'), glab: which(exec, 'glab'), gh: which(exec, 'gh') };
  const spec = { node: process.execPath, app, data, path: servicePathVar(tools) };
  mkdirSync(dirname(unit), { recursive: true });
  if (platform === 'darwin') {
    const uid = process.getuid();
    const log = join(env.HOME || homedir(), 'Library', 'Logs', 'epic-board.log');
    writeFileSync(unit, plistXml({ ...spec, log }));
    try {
      exec('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
    } catch {}
    await bootstrap({ exec, uid, plist: unit });
  } else {
    writeFileSync(unit, systemdUnit(spec));
    exec('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
    exec('systemctl', ['--user', 'enable', LABEL], { stdio: 'pipe' });
    exec('systemctl', ['--user', 'restart', LABEL], { stdio: 'pipe' });
  }
  writeFileSync(join(app, MARKER), `${JSON.stringify({ version: VERSION, at: new Date().toISOString() })}\n`);
  if (!wait) return `epic-board ${VERSION} service restarted`;
  const health = await waitHealthy(`http://127.0.0.1:${port(env)}/`);
  const lines = [
    health ? `epic-board ${health.version} is running: ${boardUrl(undefined, env)}` : `the service did not answer on port ${port(env)}; check the log (${platform === 'darwin' ? '~/Library/Logs/epic-board.log' : `journalctl --user -u ${LABEL}`})`,
    `app: ${app}`,
    `data: ${data}`,
    `node pinned: ${process.execPath} (re-run "service install" after switching node versions)`,
    `tools: ${Object.entries(tools).map(([k, v]) => `${k} ${v ? 'ok' : 'missing'}`).join(', ')}`,
  ];
  if (platform === 'linux') lines.push(`to keep it running without an open session: loginctl enable-linger ${env.USER || '$USER'}`);
  return lines.join('\n');
}

export function uninstall({ exec = execFileSync, env = process.env, platform = process.platform } = {}) {
  const unit = servicePath({ env, platform });
  if (!unit) return 'nothing to remove';
  try {
    if (platform === 'darwin') exec('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { stdio: 'ignore' });
    else exec('systemctl', ['--user', 'disable', '--now', LABEL], { stdio: 'pipe' });
  } catch {}
  if (existsSync(unit)) unlinkSync(unit);
  return `service removed; data kept in ${dataDir(env)}`;
}

export async function status({ env = process.env, platform = process.platform } = {}) {
  const unit = servicePath({ env, platform });
  const installed = Boolean(unit && existsSync(unit));
  let health = null;
  try {
    const r = await fetch(`http://127.0.0.1:${port(env)}/api/health`);
    if (r.ok) health = await r.json();
  } catch {}
  return [
    `service: ${installed ? unit : 'not installed'}`,
    `running: ${health ? `yes, ${health.version}` : 'no'}`,
    `app copy: ${installedVersion(appDir(env)) ?? 'none'}; this plugin: ${VERSION}`,
    `page: ${boardUrl(undefined, env)}`,
  ].join('\n');
}

// The service copy is newer than this plugin: the agent runs stale skills until the plugin is updated.
export function pluginBehind({ env = process.env, platform = process.platform } = {}) {
  const unit = servicePath({ env, platform });
  if (!unit || !existsSync(unit)) return null;
  const have = installedVersion(appDir(env));
  return have && newer(have, VERSION) ? { plugin: VERSION, service: have } : null;
}

// Called from the SessionStart hook: after a plugin update the service picks up the new code by itself.
// Only forward: a second, older copy of the plugin (a clone next to the marketplace one) never downgrades.
export async function syncIfOutdated({ env = process.env, platform = process.platform, exec = execFileSync } = {}) {
  const unit = servicePath({ env, platform });
  if (!unit || !existsSync(unit)) return null;
  const have = installedVersion(appDir(env));
  if (have && !newer(VERSION, have)) return null;
  const lock = join(baseDir(env), 'install.lock');
  mkdirSync(dirname(lock), { recursive: true });
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx' });
  } catch {
    // Another session is installing right now; a lock older than two minutes is a leftover.
    try {
      if (Date.now() - statSync(lock).mtimeMs < 120000) return null;
      writeFileSync(lock, String(process.pid));
    } catch {
      return null;
    }
  }
  try {
    // A shell that exported EPIC_BOARD_HOME for a demo must not repoint the real service.
    const { EPIC_BOARD_HOME, ...clean } = env;
    await install({ env: clean, platform, exec, wait: false });
    return `epic-board service updated ${have ?? '?'} -> ${VERSION}`;
  } finally {
    rmSync(lock, { force: true });
  }
}
