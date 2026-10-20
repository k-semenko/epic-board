import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.mjs';
import { SETTINGS_REGISTRY } from './settings-registry.mjs';
import { listFeedItems } from './feed.mjs';
import { docsDir } from './docs.mjs';
import { DICT } from './page/i18n.mjs';

const RU = 'ёйцукенгшщзхъфывапролджэячсмитьбю';
const EN = '`qwertyuiop[]asdfghjkl;\'zxcvbnm,.';
const RU_UP = 'ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ';
const EN_UP = '~QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>';

function layoutMap(from, to) {
  const map = new Map();
  for (let i = 0; i < from.length; i++) map.set(from[i], to[i]);
  return map;
}

const TO_EN = layoutMap(RU + RU_UP, EN + EN_UP);
const TO_RU = layoutMap(EN + EN_UP, RU + RU_UP);

export function normalizeSearchText(text) {
  return String(text ?? '').toLowerCase().replace(/ё/g, 'е');
}

export function flipLayout(text, map) {
  return [...text].map((ch) => map.get(ch) ?? ch).join('');
}

export function queryVariants(q) {
  const base = normalizeSearchText(q.trim());
  if (base.length < 2) return [];
  const variants = new Set([base]);
  variants.add(normalizeSearchText(flipLayout(q.trim(), TO_EN)));
  variants.add(normalizeSearchText(flipLayout(q.trim(), TO_RU)));
  return [...variants].filter(Boolean);
}

function words(text) {
  return text.split(/[^a-z0-9а-я_+.-]+/i).filter(Boolean);
}

function matchScore(haystack, needle, { title = false } = {}) {
  const norm = normalizeSearchText(haystack);
  const idx = norm.indexOf(needle);
  if (idx === -1) return 0;
  const wordStart = idx === 0 || /[^a-z0-9а-я_+.-]/i.test(norm[idx - 1]);
  let score = title ? 100 : 40;
  if (wordStart) score += 30;
  else score += 10;
  score += Math.max(0, 20 - idx);
  return score;
}

function scoreText(fields, queryWords) {
  let total = 0;
  const matched = [];
  for (const word of queryWords) {
    let best = 0;
    let bestField = null;
    for (const field of fields) {
      const score = matchScore(field.text, word, { title: field.title });
      if (score > best) {
        best = score;
        bestField = field;
      }
    }
    if (!best) return null;
    total += best;
    matched.push({ word, field: bestField });
  }
  return { score: total, matched };
}

// Ranges, not inline markers: titles may contain any character, guillemets included.
export function matchRanges(text, wordsToMark) {
  const norm = normalizeSearchText(text);
  const found = [];
  for (const word of wordsToMark) {
    for (let at = norm.indexOf(word); at !== -1; at = norm.indexOf(word, at + word.length)) found.push([at, at + word.length]);
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

const SNIPPET = 160;

function snippetAround(body, wordsToMark) {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  const ranges = matchRanges(text, wordsToMark);
  if (!ranges.length) return { snippet: '', snippetMarks: [] };
  const start = Math.max(0, Math.min(ranges[0][0] - 40, text.length - SNIPPET));
  const end = Math.min(text.length, start + SNIPPET);
  const lead = start > 0 ? '…' : '';
  const snippet = `${lead}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  const snippetMarks = ranges
    .filter(([a, b]) => a >= start && b <= end)
    .map(([a, b]) => [a - start + lead.length, b - start + lead.length]);
  return { snippet, snippetMarks };
}

const parts = new Map(); // key -> { mtime, entries }

function epicFiles() {
  const dir = join(dataDir(), 'epics');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => join(dir, name));
}

function feedFiles() {
  const dir = join(dataDir(), 'feed', 'items');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => join(dir, name));
}

function indexEpicFile(file) {
  const epic = JSON.parse(readFileSync(file, 'utf8'));
  const entries = [];
  const push = (entry) => entries.push(entry);
  push({
    type: 'epic', id: epic.id, title: epic.title || epic.id, body: epic.goal || '',
    href: `/e/${encodeURIComponent(epic.id)}`, where: '', at: epic.updatedAt,
    fields: [
      { text: epic.id, title: true }, { text: epic.title || '', title: true }, { text: epic.goal || '', title: false },
    ],
  });
  for (const task of epic.tasks || []) {
    push({
      type: 'task', id: `${epic.id}/${task.id}`, title: task.title || task.id, body: task.status || '',
      href: `/e/${encodeURIComponent(epic.id)}#t-${encodeURIComponent(task.id)}`, where: epic.id, at: epic.updatedAt,
      fields: [
        { text: task.id, title: true }, { text: task.title || '', title: true }, { text: task.status || '', title: false },
      ],
    });
    for (const step of task.steps || []) {
      push({
        type: 'step', id: `${epic.id}/${task.id}/${step.id}`, title: step.title || step.id, body: step.note || '',
        href: `/e/${encodeURIComponent(epic.id)}#t-${encodeURIComponent(task.id)}/${encodeURIComponent(step.id)}`,
        where: `${epic.id} · ${task.id}`, at: epic.updatedAt,
        fields: [
          { text: step.id, title: true }, { text: step.title || '', title: true }, { text: step.note || '', title: false }, { text: step.label || '', title: false },
        ],
      });
    }
    for (const open of task.open || []) {
      push({
        type: 'open', id: `${epic.id}/${task.id}/${open.id}`, title: open.text || open.id, body: '',
        href: `/e/${encodeURIComponent(epic.id)}#t-${encodeURIComponent(task.id)}`, where: `${epic.id} · ${task.id}`, at: epic.updatedAt,
        fields: [{ text: open.text || '', title: true }],
      });
    }
    for (const branch of task.branches || []) {
      push({
        type: 'branch', id: `${branch.repo}:${branch.name}`, title: `${branch.repo}:${branch.name}`, body: '',
        href: `/e/${encodeURIComponent(epic.id)}#branches`, where: `${epic.id} · ${task.id}`, at: epic.updatedAt,
        fields: [{ text: `${branch.repo}:${branch.name}`, title: true }],
      });
    }
  }
  for (const waiting of epic.waiting || []) {
    push({
      type: 'waiting', id: waiting.id, title: waiting.title || waiting.id, body: waiting.details || '',
      href: `/e/${encodeURIComponent(epic.id)}#waiting-${encodeURIComponent(waiting.id)}`, where: epic.id, at: waiting.since || epic.updatedAt,
      fields: [
        { text: waiting.id, title: true }, { text: waiting.title || '', title: true }, { text: waiting.details || '', title: false },
      ],
    });
  }
  for (const decision of epic.decisions || []) {
    push({
      type: 'decision', id: decision.id, title: decision.text || decision.id, body: '',
      href: `/e/${encodeURIComponent(epic.id)}#decisions`, where: epic.id, at: decision.at,
      fields: [{ text: decision.text || '', title: true }, { text: decision.by || '', title: false }],
    });
  }
  for (const session of epic.sessions || []) {
    push({
      type: 'session', id: session.id, title: session.doing || session.id, body: session.next || '',
      href: `/e/${encodeURIComponent(epic.id)}#sessions`, where: epic.id, at: session.lastAt,
      fields: [
        { text: session.id, title: true }, { text: session.doing || '', title: true }, { text: session.next || '', title: false }, { text: session.agent || '', title: false },
      ],
    });
  }
  for (const doc of epic.docs || []) {
    let text = '';
    try {
      text = readFileSync(join(docsDir(epic.id), doc.path.split('/').pop()), 'utf8');
    } catch {
      try { text = readFileSync(doc.path, 'utf8'); } catch {}
    }
    for (const [i, para] of text.split(/\n{2,}/).entries()) {
      if (!para.trim()) continue;
      push({
        type: 'doc', id: `${doc.id}:${i}`, title: doc.title || doc.id, body: para.slice(0, 240),
        href: `/e/${encodeURIComponent(epic.id)}#doc-${encodeURIComponent(doc.id)}`, where: epic.id, at: epic.updatedAt,
        fields: [{ text: doc.title || '', title: true }, { text: para, title: false }],
      });
    }
  }
  return epic.archived ? entries.map((entry) => ({ ...entry, archived: true })) : entries;
}

function refreshParts() {
  const files = [
    ...epicFiles().map((file) => ({ key: `epic:${file}`, file, build: () => indexEpicFile(file) })),
    ...feedFiles().map((file) => ({
      key: `feed:${file}`,
      file,
      build: () => listFeedItems({ source: file.split('/').pop().replace(/\.json$/, '') }).map((item) => ({
        type: 'feed', id: item.id, title: item.title, body: item.body || '',
        href: `/feed#${encodeURIComponent(item.id)}`, where: item.source, at: item.updatedAt,
        fields: [
          { text: item.title, title: true }, { text: item.body || '', title: false },
          { text: item.channel || '', title: false }, { text: item.source, title: true },
        ],
      })),
    })),
    {
      key: 'settings',
      file: join(dataDir(), 'settings.json'),
      build: () => SETTINGS_REGISTRY.filter((entry) => entry.ui).map((entry) => ({
        type: 'setting', id: entry.key, title: entry.key, body: '',
        titles: Object.fromEntries(Object.entries(DICT).map(([lang, dict]) => [lang, dict[entry.label] || entry.key])),
        bodies: Object.fromEntries(Object.entries(DICT).map(([lang, dict]) => [lang, dict[entry.hint] || ''])),
        href: `/settings#${encodeURIComponent(entry.key)}`, where: entry.group, at: null,
        fields: [
          { text: entry.key, title: true },
          ...Object.values(DICT).flatMap((dict) => [{ text: dict[entry.label] || '', title: true }, { text: dict[entry.hint] || '', title: false }]),
        ],
      })),
    },
  ];
  for (const part of files) {
    let mtime = 0;
    try { mtime = statSync(part.file).mtimeMs; } catch { mtime = 0; }
    const prev = parts.get(part.key);
    if (!prev || prev.mtime !== mtime) {
      try {
        parts.set(part.key, { mtime, entries: part.build() });
      } catch {
        parts.set(part.key, { mtime, entries: [] });
      }
    }
  }
  // drop removed epics/feeds
  const live = new Set(files.map((f) => f.key));
  for (const key of parts.keys()) if (!live.has(key)) parts.delete(key);
}

export function searchBoard(q, { scope = 'all', limit = 40, lang = 'en' } = {}) {
  const variants = queryVariants(q);
  if (!variants.length) return { groups: [], q };
  refreshParts();
  const all = [...parts.values()].flatMap((part) => part.entries);
  const preferredEpic = scope.startsWith('epic:') ? scope.slice(5) : null;
  const hits = [];
  for (const entry of all) {
    for (const variant of variants) {
      const queryWords = words(variant);
      if (!queryWords.length) continue;
      const scored = scoreText(entry.fields, queryWords);
      if (!scored) continue;
      let score = scored.score;
      if (preferredEpic && (entry.id === preferredEpic || entry.where?.startsWith(preferredEpic) || entry.href?.includes(`/e/${preferredEpic}`))) score += 50;
      const text = String(entry.titles?.[lang] ?? entry.title ?? '');
      const body = entry.bodies?.[lang] ?? entry.body;
      hits.push({ ...entry, score, text, marks: matchRanges(text, queryWords), ...snippetAround(body, queryWords) });
      break;
    }
  }
  hits.sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)) || b.score - a.score || String(b.at || '').localeCompare(String(a.at || '')));
  const groupsMap = new Map();
  for (const hit of hits.slice(0, limit * 3)) {
    if (!groupsMap.has(hit.type)) groupsMap.set(hit.type, []);
    groupsMap.get(hit.type).push(hit);
  }
  const groups = [...groupsMap.entries()].map(([type, items]) => ({
    type,
    total: items.length,
    items: items.slice(0, 20).map(({ fields, matched, score, titles, bodies, ...rest }) => rest),
  }));
  return { q, groups };
}
