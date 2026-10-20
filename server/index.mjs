import { createBoardServer } from './http.mjs';
import { port, dataDir } from './paths.mjs';
import { VERSION } from './version.mjs';
import { pruneFeed } from './feed.mjs';
import { createNotifier } from './notifier.mjs';

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
  // Connectors write through the CLI, bypassing the service, so the feed is watched rather than hooked.
  const notifier = createNotifier();
  setInterval(() => {
    try {
      const sounded = notifier.tick();
      if (sounded) console.log(`feed notify: ${sounded.level}, ${sounded.count} item(s)`);
    } catch (error) {
      console.error('feed notifier failed', error);
    }
  }, 3000).unref?.();
});
