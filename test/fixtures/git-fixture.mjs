import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

// origin (bare) ← clone with master pushed, feat/x pushed with 1 commit plus 1 unpushed, worktree for feat/x.
export function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'eb-git-'));
  const origin = join(root, 'origin.git');
  const clone = join(root, 'clone');
  const worktree = join(root, 'wt');
  git(root, 'init', '-q', '--bare', '-b', 'master', origin);
  git(root, 'clone', '-q', origin, clone);
  writeFileSync(join(clone, 'a.txt'), '1');
  git(clone, 'add', 'a.txt');
  git(clone, 'commit', '-qm', 'base');
  git(clone, 'push', '-q', 'origin', 'master');
  git(clone, 'worktree', 'add', '-q', '-b', 'feat/x', worktree);
  writeFileSync(join(worktree, 'b.txt'), '1');
  git(worktree, 'add', 'b.txt');
  git(worktree, 'commit', '-qm', 'feature');
  git(worktree, 'push', '-q', 'origin', 'feat/x');
  writeFileSync(join(worktree, 'c.txt'), '1');
  git(worktree, 'add', 'c.txt');
  git(worktree, 'commit', '-qm', 'local only');
  writeFileSync(join(worktree, 'dirty.txt'), '1');
  return { root, origin, clone, worktree, git };
}
