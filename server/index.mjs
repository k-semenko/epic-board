import { createBoardServer } from './http.mjs';
import { port, dataDir } from './paths.mjs';
import { VERSION } from './version.mjs';

const p = port();
// Loopback only: the board has no authentication and must never be reachable from the network.
createBoardServer({ port: p }).listen(p, '127.0.0.1', () => {
  console.log(`epic-board ${VERSION} ${new Date().toISOString()} node ${process.version} data ${dataDir()} http://127.0.0.1:${p}`);
});
