import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = (env) => env.HOME || homedir();

export function configPath(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(home(env), '.config'), 'epic-board', 'config.json');
}

export function readConfig(env = process.env) {
  try {
    const config = JSON.parse(readFileSync(configPath(env), 'utf8'));
    return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  } catch {
    return {};
  }
}

export function baseDir(env = process.env) {
  return join(env.XDG_DATA_HOME || join(home(env), '.local', 'share'), 'epic-board');
}

// The plugin runs from a versioned cache copy, so the data dir must never derive from this file's location.
export function dataDir(env = process.env) {
  if (env.EPIC_BOARD_HOME) return env.EPIC_BOARD_HOME;
  const config = readConfig(env);
  if (typeof config.dataDir === 'string' && config.dataDir) return config.dataDir;
  return join(baseDir(env), 'data');
}

// The service runs from its own copy of the app, so a plugin update never pulls files from under it.
export function appDir(env = process.env) {
  return join(baseDir(env), 'app');
}

export function port(env = process.env) {
  const value = Number(env.EPIC_BOARD_PORT || readConfig(env).port || 4747);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : 4747;
}

export function host(env = process.env) {
  const value = readConfig(env).host;
  return typeof value === 'string' && /^[a-z0-9.-]+$/i.test(value) ? value : 'localhost';
}

// Behind a reverse proxy (http://board.example without a port) links use this address,
// and its Host is allowed too; only http(s) is taken.
export function publicUrl(env = process.env) {
  const value = readConfig(env).publicUrl;
  if (typeof value !== 'string' || !/^https?:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(value)) return null;
  return new URL(value);
}

export function allowedHosts(p = port(), env = process.env) {
  const pub = publicUrl(env);
  return [...new Set([...['localhost', '127.0.0.1', host(env)].map((h) => `${h}:${p}`), ...(pub ? [pub.host] : [])])];
}

// Some corporate proxies swallow traffic to internal git hosts, and NO_PROXY wildcards are not always honoured.
export function stripProxy(env = process.env) {
  return env.EPIC_BOARD_STRIP_PROXY === '1' || readConfig(env).stripProxy === true;
}

export function boardUrl(id, env = process.env) {
  const pub = publicUrl(env);
  const base = pub ? `${pub.protocol}//${pub.host}` : `http://${host(env)}:${port(env)}`;
  return id ? `${base}/e/${encodeURIComponent(id)}` : `${base}/`;
}
