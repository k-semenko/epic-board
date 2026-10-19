import { createBoardServer } from './http.mjs';
import { port, dataDir } from './paths.mjs';
import { VERSION } from './version.mjs';
import { pruneFeed } from './feed.mjs';

const p = port();

function runPrune() {
  try {
    pruneFeed();
  } catch (error) {
    console.error('feed prune failed', error);
  }
}

// Loopback only: the board has no authentication and must never be reachable from the network.
createBoardServer({ port: p }).listen(p, '127.0.0.1', () => {
  console.log(`epic-board ${VERSION} ${new Date().toISOString()} node ${process.version} data ${dataDir()} http://127.0.0.1:${p}`);
  runPrune();
  setInterval(runPrune, 60 * 60 * 1000).unref?.();
});
