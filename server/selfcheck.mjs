import { execRunner } from './refresh.mjs';
import { listEpics, isArchived } from './store.mjs';
import { dataDir } from './paths.mjs';
import { VERSION } from './version.mjs';

const CLI = { gitlab: 'glab', github: 'gh' };

// Runs inside the service, so it shows exactly what PATH and credentials the service really has.
export async function selfcheck({ run = execRunner, repo, epics = listEpics().filter((epic) => !isArchived(epic)) } = {}) {
  const which = async (bin) => {
    const r = await run('/usr/bin/which', [bin]);
    return r.code === 0 ? r.stdout.trim() : null;
  };
  const repos = epics.flatMap((e) => Object.values(e.repos || {}));
  const target = repo || repos[0]?.path || null;
  let lsRemote = { repo: target, ok: null, detail: 'no repo described yet' };
  if (target) {
    const r = await run('git', ['-C', target, 'ls-remote', '--exit-code', 'origin', 'HEAD'], { timeoutMs: 30000 });
    lsRemote = { repo: target, ok: r.code === 0, detail: (r.code === 0 ? r.stdout : r.stderr).trim() };
  }
  const hosts = new Map();
  for (const r of repos) if (CLI[r.provider] && r.project) hosts.set(`${r.provider}:${r.project.split('/')[0]}`, { provider: r.provider, host: r.project.split('/')[0] });
  const auth = [];
  for (const { provider, host } of hosts.values()) {
    const r = await run(CLI[provider], ['auth', 'status', '--hostname', host]);
    auth.push({ provider, host, ok: r.code === 0, detail: (r.stderr || r.stdout).trim().split('\n').slice(0, 3).join(' ') });
  }
  return {
    version: VERSION,
    node: process.version,
    dataDir: dataDir(),
    tools: { git: await which('git'), glab: await which('glab'), gh: await which('gh') },
    lsRemote,
    auth,
  };
}
