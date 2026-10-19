import fs from 'node:fs';
import path from 'node:path';
import { BoardError } from './errors.mjs';

// Symlinks are resolved (macOS /var is /private/var); a missing file is resolved through its folder.
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(path.resolve(p))), path.basename(p));
    } catch {
      return path.resolve(p);
    }
  }
};

// Only the board's own docs folder and the epic's repositories and worktrees may be read or written.
function allowedRoots(epic, boardDocsRoot) {
  const roots = [boardDocsRoot, ...Object.values(epic.repos || {}).map((r) => r.path)];
  for (const t of epic.tasks || []) for (const b of t.branches || []) if (b.worktree) roots.push(b.worktree);
  return roots.filter(Boolean).map(real);
}

export function checkDocPath(epic, file, boardDocsRoot) {
  const full = real(path.resolve(file));
  if (!full.endsWith('.md')) throw new BoardError(400, 'not-md', `documents are .md files only: ${file}`);
  if (!allowedRoots(epic, boardDocsRoot).some((root) => full === root || full.startsWith(root + path.sep))) {
    throw new BoardError(403, 'outside', `file is outside the epic's folders (repos, worktrees, board documents): ${file}`);
  }
  return full;
}
