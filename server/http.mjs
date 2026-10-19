import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.mjs';
import { refreshEpic, execRunner } from './refresh.mjs';
import { buildExport } from './export.mjs';
import { allowedHosts, publicUrl } from './paths.mjs';
import { VERSION } from './version.mjs';
import * as docs from './docs.mjs';
import { BoardError } from './errors.mjs';
import { readSettingsState, writeSettings, translateLegacyPatch, registryPublic } from './settings.mjs';
import * as feed from './feed.mjs';
import { searchBoard } from './search.mjs';
import { buildDashboard } from './dashboard.mjs';
import { tasksForBoard } from './tasks.mjs';
import { readBoardSnapshot, linksForEpic } from './links.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const BY = new Set(['agent', 'button', 'cli', 'hook']);
const VENDOR_FILES = new Set([
  'marked.min.js', 'purify.min.js', 'vditor.min.js', 'vditor.css',
  'vditor-lute.min.js', 'vditor-icons.js', 'vditor-i18n.js', 'vditor-adapter.js',
]);

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  if (Buffer.isBuffer(body)) res.end(body);
  else res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function serveFile(res, file, type) {
  if (!existsSync(file)) throw new BoardError(404, 'not-found', 'no such page');
  const mime = type || TYPES[extname(file)] || 'application/octet-stream';
  // A PNG read as text is corrupted; SVG stays text so the export can inline it.
  const body = mime.startsWith('image/') && !mime.includes('svg') ? readFileSync(file) : readFileSync(file, 'utf8');
  send(res, 200, body, mime);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1 << 20) reject(new BoardError(413, 'too-large', 'request body is larger than 1 MB'));
      else chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new BoardError(400, 'bad-json', 'request body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

function summary(epic) {
  const stamps = Object.values(epic.facts || {}).map((f) => f.fetchedAt).filter(Boolean).sort();
  return { id: epic.id, title: epic.title, goal: epic.goal, waiting: (epic.waiting || []).filter((w) => !w.doneAt).length, createdAt: epic.createdAt, updatedAt: epic.updatedAt, oldestFact: stamps[0] ?? null, tasks: (epic.tasks || []).length, branches: (epic.tasks || []).reduce((n, t) => n + (t.branches || []).length, 0) };
}

// Loopback is not enough: DNS rebinding lets any page reach 127.0.0.1, so Host and Origin are pinned.
function guard(req, port) {
  const allowed = allowedHosts(port);
  if (!allowed.includes(req.headers.host)) throw new BoardError(403, 'bad-host', `Host ${req.headers.host} is not allowed`);
  if (req.method === 'GET') return;
  const origin = req.headers.origin;
  const origins = [...allowed.map((h) => `http://${h}`), publicUrl()?.origin].filter(Boolean);
  if (origin && !origins.includes(origin)) throw new BoardError(403, 'bad-origin', `Origin ${origin} is not allowed`);
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new BoardError(415, 'not-json', 'Content-Type must be application/json');
}

export function createBoardServer({ port, run = execRunner } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const actualPort = port || server.address().port;
      guard(req, actualPort);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const m = req.method;

      if (m === 'GET' && parts.length === 0) return serveFile(res, join(ROOT, 'server/page/index.html'));
      if (m === 'GET' && parts.length === 1 && parts[0] === 'favicon.ico') return serveFile(res, join(ROOT, 'server/page/favicon.png'), 'image/png');
      if (m === 'GET' && parts.length === 1 && parts[0] === 'editor') return serveFile(res, join(ROOT, 'server/page/doc-editor.html'));
      if (m === 'GET' && parts.length === 1 && parts[0] === 'tasks') return serveFile(res, join(ROOT, 'server/page/tasks.html'));
      if (m === 'GET' && parts.length === 1 && parts[0] === 'settings') return serveFile(res, join(ROOT, 'server/page/settings.html'));
      if (m === 'GET' && parts.length === 1 && parts[0] === 'feed') return serveFile(res, join(ROOT, 'server/page/feed.html'));
      if (m === 'GET' && parts[0] === 'e' && parts.length === 2) {
        store.checkId(parts[1]);
        return serveFile(res, join(ROOT, 'server/page/epic.html'));
      }
      if (m === 'GET' && parts[0] === 'static' && parts.length === 2 && /^[\w.-]+$/.test(parts[1])) return serveFile(res, join(ROOT, 'server/page', parts[1]));
      // Only the vendored libraries listed here are served; the folder itself is not browsable.
      if (m === 'GET' && parts[0] === 'vendor' && parts.length === 2 && VENDOR_FILES.has(parts[1])) return serveFile(res, join(ROOT, 'vendor', parts[1]));
      if (parts[0] !== 'api') throw new BoardError(404, 'not-found', 'no such path');
      if (parts[1] === 'health' && m === 'GET') return send(res, 200, { ok: true, version: VERSION });
      if (parts[1] === 'settings') {
        if (parts.length === 3 && parts[2] === 'registry' && m === 'GET') return send(res, 200, { settings: registryPublic() });
        if (parts.length === 2 && m === 'GET') return send(res, 200, readSettingsState());
        if (parts.length === 2 && m === 'PUT') {
          const body = await readBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BoardError(400, 'bad-settings', 'settings body must be an object');
          if (Object.hasOwn(body, 'patch') || Object.hasOwn(body, 'rev')) {
            if (!body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) throw new BoardError(400, 'bad-settings', 'settings patch must be an object');
            return send(res, 200, writeSettings(body.patch, { rev: body.rev }));
          }
          return send(res, 200, writeSettings(translateLegacyPatch(body)));
        }
      }

      if (parts[1] === 'selfcheck' && m === 'GET') {
        const { selfcheck } = await import('./selfcheck.mjs');
        const repo = url.searchParams.get('repo');
        // Any page can fire a GET; git must never run in a directory the user did not register.
        const known = store.listEpics().flatMap((e) => Object.values(e.repos || {}).map((r) => r.path));
        if (repo && !known.includes(repo)) throw new BoardError(400, 'bad-repo', `repo ${repo} is not described in any epic`);
        return send(res, 200, await selfcheck({ run, repo }));
      }
      if (m === 'GET' && parts[1] === 'tasks' && parts.length === 2) return send(res, 200, tasksForBoard(readBoardSnapshot()));
      if (parts[1] === 'feed') {
        if (parts.length === 2 && m === 'GET') {
          return send(res, 200, {
            rev: feed.feedRev(),
            items: feed.listFeedItems({
              unmarked: url.searchParams.get('unmarked') === '1',
              source: url.searchParams.get('source') || undefined,
              since: url.searchParams.get('since') || undefined,
              severity: url.searchParams.get('severity') || undefined,
              mark: url.searchParams.get('mark') || undefined,
            }),
          });
        }
        if (parts.length === 2 && m === 'POST') return send(res, 200, feed.addFeedItems(await readBody(req)));
        if (parts.length === 3 && parts[2] === 'mark' && m === 'POST') {
          const body = await readBody(req);
          return send(res, 200, { items: feed.markFeedItems(body.ids, body.value, { comment: body.comment }) });
        }
        if (parts.length === 3 && parts[2] === 'unmark' && m === 'POST') {
          const body = await readBody(req);
          return send(res, 200, { items: feed.unmarkFeedItems(body.ids) });
        }
        if (parts.length === 3 && parts[2] === 'delete' && m === 'POST') {
          const body = await readBody(req);
          return send(res, 200, { items: feed.deleteFeedItems(body.ids) });
        }
        if (parts.length === 3 && parts[2] === 'summary' && m === 'GET') return send(res, 200, feed.feedSummary());
        if (parts.length === 3 && parts[2] === 'rev' && m === 'GET') return send(res, 200, { rev: feed.feedRev() });
        if (parts.length === 3 && parts[2] === 'profile' && m === 'GET') {
          const source = url.searchParams.get('source');
          if (url.searchParams.get('text') === '1') return send(res, 200, feed.showFeedProfile(source));
          return send(res, 200, feed.feedProfileAggregates(source));
        }
      }
      if (parts[1] === 'search' && m === 'GET' && parts.length === 2) {
        return send(res, 200, searchBoard(url.searchParams.get('q') || '', {
          scope: url.searchParams.get('scope') || 'all',
          limit: Math.min(Number(url.searchParams.get('limit')) || 40, 100),
          lang: url.searchParams.get('lang') === 'ru' ? 'ru' : 'en',
        }));
      }
      if (parts[1] === 'dashboard' && m === 'GET' && parts.length === 2) return send(res, 200, buildDashboard());
      if (parts[1] !== 'epics') throw new BoardError(404, 'not-found', 'no such path');
      if (parts.length === 2) {
        if (m === 'GET') {
          const snapshot = readBoardSnapshot();
          if (!snapshot.epics.length && snapshot.errors.length) throw new BoardError(500, 'unavailable-board', 'cannot read any epic files');
          return send(res, 200, [...snapshot.epics].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map((epic) => {
            const { relatedEpics, incomplete, readAt } = linksForEpic(snapshot, epic.id);
            return { ...summary(epic), relatedEpics, incomplete, readAt };
          }));
        }
        if (m === 'POST') {
          const body = await readBody(req);
          return send(res, 201, store.createEpic(body, { by: BY.has(body.by) ? body.by : 'agent' }));
        }
      }
      const id = store.checkId(parts[2]);
      const tail = parts.slice(3).join('/');
      if (m === 'GET' && tail === '') return send(res, 200, store.readEpic(id));
      if (m === 'GET' && tail === 'rev') return send(res, 200, { updatedAt: store.readEpic(id).updatedAt });
      if (m === 'GET' && tail === 'links') return send(res, 200, linksForEpic(readBoardSnapshot(), id));
      if (m === 'GET' && tail === 'history') {
        const limit = url.searchParams.get('limit');
        return send(res, 200, store.readHistory(id, { limit: limit === 'all' ? Infinity : Math.min(Number(limit) || 20, 500) }));
      }
      if (tail === 'docs' && m === 'POST') {
        const body = await readBody(req);
        const fields = { task: body.task || undefined, step: body.step || undefined, kind: body.kind, title: body.title, path: body.path };
        const doc = body.mode === 'link' ? docs.linkDoc(id, fields) : body.mode === 'import' ? docs.importDoc(id, fields) : docs.newDoc(id, fields);
        return send(res, 201, doc);
      }
      if (tail === 'docs-text' && m === 'GET') return send(res, 200, docs.allTexts(id));
      if (parts[3] === 'docs' && parts.length >= 5) {
        const docId = parts[4];
        if (parts.length === 5 && m === 'GET') return send(res, 200, docs.readDoc(id, docId));
        if (parts.length === 5 && m === 'PUT') {
          const body = await readBody(req);
          return send(res, 200, docs.writeDoc(id, docId, body.text, body.mtimeMs));
        }
        if (parts[5] === 'versions' && m === 'GET' && parts.length === 6) return send(res, 200, docs.listVersions(id, docId));
        if (parts[5] === 'versions' && m === 'GET' && parts.length === 7) return send(res, 200, { text: docs.readVersion(id, docId, parts[6]) });
      }
      if (m === 'GET' && tail === 'export') {
        const html = buildExport(id);
        const day = new Date().toISOString().slice(0, 10);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="epic-${id}-${day}.html"`, 'Cache-Control': 'no-store' });
        return res.end(html);
      }
      if (m === 'PATCH' && tail === '') {
        const body = await readBody(req);
        return send(res, 200, store.patchEpic(id, body.patch, { by: BY.has(body.by) ? body.by : 'agent', why: String(body.why || '') }));
      }
      if (m === 'POST' && tail === 'refresh' && url.searchParams.get('stream') === '1') {
        const body = await readBody(req);
        // Progress goes out line by line so the page can tick off repos and branches as they finish.
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
        const line = (obj) => res.write(`${JSON.stringify(obj)}\n`);
        try {
          const { epic } = await refreshEpic(id, { scope: body.scope || 'all', task: body.task, branch: body.branch, run, onProgress: line });
          line({ type: 'done', epic });
        } catch (e) {
          line({ type: 'error', detail: e.detail || e.message });
        }
        return res.end();
      }
      if (m === 'POST' && tail === 'refresh') {
        const body = await readBody(req);
        const { epic } = await refreshEpic(id, { scope: body.scope || 'all', task: body.task, branch: body.branch, run });
        return send(res, 200, epic);
      }
      if (m === 'POST' && parts[3] === 'waiting' && parts.length === 6) {
        const action = parts[5];
        if (action === 'done' || action === 'undo') {
          throw new BoardError(400, 'waiting-action', `Use waiting/${parts[4]}/${action === 'done' ? 'resolve with version, submissionId and resolution after human submission' : 'revise with version and reason'}`);
        }
        const mutate = new Map([['submit', store.submitWaiting], ['clarify', store.clarifyWaiting], ['resolve', store.resolveWaiting], ['revise', store.reviseWaiting], ['remove', store.removeWaiting]]).get(action);
        if (mutate) {
          const body = await readBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BoardError(400, 'bad-body', 'waiting action body must be an object');
          return send(res, 200, mutate(id, parts[4], body, { by: action === 'submit' || action === 'clarify' ? 'button' : 'agent' }));
        }
      }
      throw new BoardError(404, 'not-found', 'no such path');
    } catch (e) {
      const status = e instanceof BoardError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: e.code || 'internal', detail: e.detail || e.message });
    }
  });
  return server;
}
