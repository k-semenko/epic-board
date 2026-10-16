import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const store = await import('../../server/store.mjs');
const [, , id, times] = process.argv;
const file = join(process.env.EPIC_BOARD_HOME, 'counter.txt');
for (let i = 0; i < Number(times); i++) {
  store.withLock(id, () => {
    const n = Number(readFileSync(file, 'utf8'));
    store.writeAtomic(file, String(n + 1));
  });
}
