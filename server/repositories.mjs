import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export function inspectRepository(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath) return null;
  try {
    if (!statSync(repoPath).isDirectory()) return null;
    const git = (...args) => execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf8', timeout: 3000, maxBuffer: 1 << 20, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const commonDir = realpathSync(git('rev-parse', '--path-format=absolute', '--git-common-dir').trim());
    const first = git('worktree', 'list', '--porcelain', '-z').split('\0').find((field) => field.startsWith('worktree '));
    if (!first) return null;
    const primary = first.slice('worktree '.length);
    let root;
    try {
      root = realpathSync(primary);
    } catch {
      root = resolve(primary);
    }
    return { root, commonDir };
  } catch {
    return null;
  }
}
