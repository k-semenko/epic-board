import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.mjs';
import { readEpic, patchEpic, writeAtomic, checkId } from './store.mjs';
import { BoardError } from './errors.mjs';

export const DOC_KINDS = ['spec', 'plan', 'log', 'review', 'note'];

export function docsDir(id) {
  return path.join(dataDir(), 'epics', checkId(id), 'docs');
}

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
function allowedRoots(epic) {
  const roots = [docsDir(epic.id), ...Object.values(epic.repos || {}).map((r) => r.path)];
  for (const t of epic.tasks || []) for (const b of t.branches || []) if (b.worktree) roots.push(b.worktree);
  return roots.filter(Boolean).map(real);
}

function checkPath(epic, file) {
  const full = real(path.resolve(file));
  if (!full.endsWith('.md')) throw new BoardError(400, 'not-md', `documents are .md files only: ${file}`);
  if (!allowedRoots(epic).some((root) => full === root || full.startsWith(root + path.sep))) {
    throw new BoardError(403, 'outside', `file is outside the epic's folders (repos, worktrees, board documents): ${file}`);
  }
  return full;
}

function checkPlace(epic, { task, step, kind, title }) {
  if (!DOC_KINDS.includes(kind)) throw new BoardError(400, 'bad-kind', `kind — ${DOC_KINDS.join(', ')}`);
  if (!title) throw new BoardError(400, 'no-title', 'a document needs a title (--title)');
  if (step && !task) throw new BoardError(400, 'no-task', 'a step goes with its task: <task>/<step>');
  if (task) {
    const t = (epic.tasks || []).find((x) => x.id === task);
    if (!t) throw new BoardError(400, 'bad-task', `epic has no task ${task}`);
    if (step && !(t.steps || []).some((s) => s.id === step)) throw new BoardError(400, 'bad-step', `task ${task} has no step ${step}`);
  }
}

const newId = () => `doc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = (title) => String(title).toLowerCase().replace(/[^a-zа-яё0-9]+/giu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'doc';

function register(id, doc) {
  const { epic } = patchEpic(id, { docs: [doc] }, { by: 'cli' });
  return epic.docs.find((d) => d.id === doc.id);
}

function ownedPath(id, { task, step, kind, title }, docId) {
  const dir = path.join(docsDir(id), task || 'epic', step || '_');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${kind}-${slug(title)}-${docId.slice(-4)}.md`);
}

function base(fields, docId, extra) {
  const doc = { id: docId, kind: fields.kind, title: fields.title, createdAt: new Date().toISOString(), ...extra };
  if (fields.task) doc.task = fields.task;
  if (fields.step) doc.step = fields.step;
  return doc;
}

export function newDoc(id, fields) {
  const epic = readEpic(id);
  checkPlace(epic, fields);
  const docId = newId();
  const file = ownedPath(id, fields, docId);
  if (!fs.existsSync(file)) writeAtomic(file, `# ${fields.title}\n`);
  return register(id, base(fields, docId, { path: file, owned: true }));
}

export function linkDoc(id, fields) {
  const epic = readEpic(id);
  checkPlace(epic, fields);
  const file = checkPath(epic, fields.path);
  if (!fs.existsSync(file)) throw new BoardError(404, 'no-file', `no such file: ${fields.path}`);
  return register(id, base(fields, newId(), { path: file, owned: false }));
}

export function importDoc(id, fields) {
  const epic = readEpic(id);
  checkPlace(epic, fields);
  const source = checkPath(epic, fields.path);
  if (!fs.existsSync(source)) throw new BoardError(404, 'no-file', `no such file: ${fields.path}`);
  const docId = newId();
  const file = ownedPath(id, fields, docId);
  writeAtomic(file, fs.readFileSync(source, 'utf8'));
  return register(id, base(fields, docId, { path: file, owned: true, importedFrom: source }));
}

function findDoc(id, docId) {
  const epic = readEpic(id);
  const doc = (epic.docs || []).find((d) => d.id === docId);
  if (!doc) throw new BoardError(404, 'no-doc', `no document ${docId}`);
  return { epic, doc, file: checkPath(epic, doc.path) };
}

export function readDoc(id, docId) {
  const { doc, file } = findDoc(id, docId);
  if (!fs.existsSync(file)) throw new BoardError(404, 'no-file', `document file is gone: ${file}`);
  return { doc, text: fs.readFileSync(file, 'utf8'), mtimeMs: fs.statSync(file).mtimeMs };
}

const versionsDir = (id, docId) => path.join(docsDir(id), '.versions', docId);

// A save based on a stale read is refused: an agent may have rewritten the file meanwhile.
export function writeDoc(id, docId, text, baseMtimeMs) {
  const { file } = findDoc(id, docId);
  if (typeof text !== 'string') throw new BoardError(400, 'no-text', 'document text is required');
  const exists = fs.existsSync(file);
  if (exists && Math.abs(fs.statSync(file).mtimeMs - Number(baseMtimeMs)) > 1) {
    throw new BoardError(409, 'changed', 'the file changed while you were editing it: reload the document');
  }
  if (exists) {
    const dir = versionsDir(id, docId);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(file, path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.md`));
  }
  writeAtomic(file, text);
  return { mtimeMs: fs.statSync(file).mtimeMs };
}

export function listVersions(id, docId) {
  findDoc(id, docId);
  const dir = versionsDir(id, docId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort().reverse().map((n) => {
    const v = n.slice(0, -3);
    const iso = v.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1:$2:$3.$4Z');
    return { id: v, at: iso };
  });
}

export function readVersion(id, docId, versionId) {
  findDoc(id, docId);
  if (!/^[\w-]+$/.test(String(versionId))) throw new BoardError(400, 'bad-version', 'bad version id');
  const file = path.join(versionsDir(id, docId), `${versionId}.md`);
  if (!fs.existsSync(file)) throw new BoardError(404, 'no-version', 'no such version');
  return fs.readFileSync(file, 'utf8');
}

export function removeDoc(id, docId) {
  findDoc(id, docId);
  return patchEpic(id, { docs: [{ id: docId, $delete: true }] }, { by: 'cli' }).epic;
}

export function allTexts(id) {
  const out = [];
  for (const d of readEpic(id).docs || []) {
    try {
      out.push({ id: d.id, title: d.title, text: readDoc(id, d.id).text });
    } catch {}
  }
  return out;
}
