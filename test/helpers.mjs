import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tmpHome() {
  const dir = mkdtempSync(join(tmpdir(), 'epic-board-'));
  process.env.EPIC_BOARD_HOME = dir;
  return dir;
}
