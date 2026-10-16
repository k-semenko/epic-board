import { buildLanes, layoutMap, buildOverview, defaultOpen, defaultStep } from './lanes.mjs';
import { icon, STATE_ICON, agentBadge, logo } from './icons.mjs';
import { describeEvent } from './history.mjs';
import { renderMarkdown } from './markdown.mjs';
import { t, getLang, setLang, locale } from './i18n.mjs';
import { bindSectionSettings } from './section-settings.mjs';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STALE_MS = 24 * 3600 * 1000;

// In an export, "N ago" is measured from the moment of export, not from when someone opens the file.
const nowMs = () => (typeof window !== 'undefined' && window.__EPIC_EXPORT__ ? Date.parse(window.__EPIC_EXPORT__.exportedAt) : Date.now());

function ago(iso) {
  if (!iso) return '—';
  const m = Math.max(0, Math.round((nowMs() - Date.parse(iso)) / 60000));
  return m < 60 ? t('unit.min', { n: m }) : m < 1440 ? t('unit.h', { n: Math.round(m / 60) }) : t('unit.d', { n: Math.round(m / 1440) });
}

// An exported page carries its data inline and is read-only: no service behind it.
const EXPORT = typeof window !== 'undefined' ? window.__EPIC_EXPORT__ || null : null;

function exportApi(path, method) {
  if (method !== 'GET') throw new Error(t('export.readOnly'));
  if (path === '/api/settings') return EXPORT.settings || {};
  if (/\/history/.test(path)) return EXPORT.history.slice(0, Number(new URLSearchParams(path.split('?')[1]).get('limit')) || 20);
  if (/\/docs-text$/.test(path)) return EXPORT.docs || [];
  const doc = path.match(/\/docs\/([^/]+)$/);
  if (doc) {
    const d = (EXPORT.docs || []).find((x) => x.id === decodeURIComponent(doc[1]));
    return { doc: (EXPORT.epic.docs || []).find((x) => x.id === decodeURIComponent(doc[1])), text: d ? d.text : '', mtimeMs: 0 };
  }
  if (/\/rev$/.test(path)) return { updatedAt: EXPORT.epic.updatedAt };
  return EXPORT.epic;
}

// Relative times are tagged with their timestamp and recounted in place, so "N ago" keeps moving
// even when the epic itself does not change and nothing re-renders.
function agoTag(iso) {
  return iso ? `<time data-ago="${esc(iso)}" title="${esc(new Date(iso).toLocaleString(locale()))}">${ago(iso)}</time>` : '—';
}
const agoText = (iso) => t('ago', { t: agoTag(iso) });
// A phrase with markup inside stays one flex item, so flex containers do not eat its spaces.
const phrase = (key, vars) => `<span class="phrase">${t(key, vars)}</span>`;

function tickAgo() {
  for (const el of document.querySelectorAll('time[data-ago]')) {
    const text = ago(el.dataset.ago);
    if (el.textContent !== text) el.textContent = text;
  }
}

if (typeof window !== 'undefined' && !window.__EPIC_EXPORT__) setInterval(tickAgo, 30000);

async function api(path, { method = 'GET', body } = {}) {
  if (EXPORT) return exportApi(path, method);
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.detail || data.error || res.statusText);
  return data;
}

const enc = encodeURIComponent;

// ---------- Language ----------

function applyI18n(root = document) {
  document.documentElement.lang = getLang();
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}

function bindLang(rerender) {
  const btn = $('#lang');
  if (!btn) return;
  const label = () => {
    btn.textContent = getLang() === 'ru' ? 'EN' : 'RU';
    btn.title = t('lang.switch');
  };
  label();
  btn.addEventListener('click', async () => {
    setLang(getLang() === 'ru' ? 'en' : 'ru');
    label();
    applyI18n();
    await rerender();
  });
}

// ---------- Index ----------

function dayLabel(iso) {
  if (!iso) return t('day.none');
  const d = new Date(iso);
  const today = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(today) - start(d)) / 86400000);
  if (days === 0) return t('day.today');
  if (days === 1) return t('day.yesterday');
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

let allEpics = [];

function renderEpicList() {
  const q = ($('#q')?.value || '').trim().toLowerCase();
  const found = allEpics.filter((e) => !q || [e.id, e.title, e.goal].some((v) => String(v ?? '').toLowerCase().includes(q)));
  if (!found.length) {
    $('#epics').innerHTML = `<p class="muted">${allEpics.length ? esc(t('index.none')) : t('index.empty')}</p>`;
    return;
  }
  const groups = new Map();
  for (const e of [...found].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))) {
    const label = dayLabel(e.createdAt);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(e);
  }
  $('#epics').innerHTML = [...groups].map(([label, list]) => `<section class="day"><h2 class="day-head">${esc(label)}</h2><ul class="cards">${list.map((e) => `<li><a href="/e/${enc(e.id)}" class="epic-link"><strong><span class="mono muted">${esc(e.id)}</span> · ${esc(e.title)}</strong></a><span class="muted">${esc(e.goal)}</span><span class="meta">${e.waiting ? `<span class="warn">${icon('clock')}${esc(t('index.waiting', { n: e.waiting }))}</span>` : `<span class="muted">${icon('check')}${esc(t('index.nothing'))}</span>`}<span class="muted">${icon('list')}${esc(t('index.tasks', { n: e.tasks ?? 0 }))}</span><span class="muted">${icon('branch')}${esc(t('index.branches', { n: e.branches ?? 0 }))}</span><span class="muted">${icon('refresh')}${phrase('index.updated', { t: agoText(e.updatedAt) })}</span></span></li>`).join('')}</ul></section>`).join('');
}

async function renderIndex() {
  allEpics = await api('/api/epics');
  const sum = (k) => allEpics.reduce((n, e) => n + (e[k] || 0), 0);
  $('#stats').innerHTML = [
    ['board', 'stat.epics', allEpics.length],
    ['list', 'stat.tasks', sum('tasks')],
    ['branch', 'stat.branches', sum('branches')],
    ['clock', 'stat.waiting', sum('waiting')],
  ].map(([i, label, n]) => `<div class="stat"><span class="stat-label">${icon(i)}${esc(t(label))}</span><span class="stat-value">${n}</span></div>`).join('');
  renderEpicList();
}

function fillIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.outerHTML = icon(el.dataset.icon);
  for (const el of root.querySelectorAll('[data-logo]')) el.outerHTML = logo();
}

const cap = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

// ---------- Popover: details on demand instead of separate blocks ----------

function showPopover(anchor, html) {
  const pop = $('#popover');
  pop.innerHTML = `<button type="button" class="icon-btn pop-close" aria-label="${esc(t('close'))}">${icon('close')}</button>${html}`;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(380, window.innerWidth - 24);
  pop.style.width = `${w}px`;
  // Anchored in page coordinates, so scrolling carries it along with the button that opened it.
  pop.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left)) + window.scrollX}px`;
  const below = r.bottom + 8;
  const top = below + pop.offsetHeight > window.innerHeight - 12 ? Math.max(12, r.top - pop.offsetHeight - 8) : below;
  pop.style.top = `${top + window.scrollY}px`;
  pop.dataset.anchor = anchor.dataset.info || '';
}

function hidePopover() {
  const pop = $('#popover');
  if (pop && !pop.hidden) pop.hidden = true;
}

// Stored URLs are validated on write, but a hand-edited file or a forge answer could still carry another scheme.
const isHttp = (url) => /^https?:\/\//i.test(String(url || ''));
const external = (url, label) => (isHttp(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="ext">${icon('link')}${esc(label)}</a>` : esc(label));

function taskInfo(epic, id) {
  const task = (epic.tasks || []).find((x) => x.id === id);
  if (!task) return `<p class="muted">${esc(t('nodata'))}</p>`;
  const steps = (task.steps || []).map((s) => `<li>${icon(STATE_ICON[s.state] || 'circle', `st-${s.state}`)}<span>${esc(s.title)}${s.note ? `<span class="note">${esc(s.note)}</span>` : ''}</span></li>`).join('');
  const open = (task.open || []).map((o) => `<li>${icon('alert', 'st-todo')}<span>${esc(o.text)}</span></li>`).join('');
  const branches = (task.branches || []).map((b) => {
    const f = epic.facts?.[`${b.repo}:${b.name}`];
    return `<li>${icon('branch', 'st-todo')}<span class="mono">${esc(b.repo)}:${esc(b.name)}${f?.head ? ` @ ${esc(f.head)}` : ''}${f?.unpushed ? ` <span class="warn">${esc(t('unpushed', { n: f.unpushed }))}</span>` : ''}</span></li>`;
  }).join('');
  return `<h4><span class="mono muted">${esc(task.id)}</span> ${esc(task.title)}</h4>
    <p class="pop-meta">${task.status ? `<span class="chip">${esc(task.status)}</span>` : ''}<span class="muted">${task.statusCheckedAt ? phrase('task.statusChecked', { t: agoText(task.statusCheckedAt) }) : esc(t('task.statusUnchecked'))}</span>${task.url ? external(task.url, task.tracker || t('task.open')) : ''}</p>
    ${steps ? `<h5>${esc(t('task.steps'))}</h5><ul class="steps">${steps}</ul>` : ''}
    ${open ? `<h5>${esc(t('task.open.items'))}</h5><ul class="steps">${open}</ul>` : ''}
    ${branches ? `<h5>${esc(t('task.branches'))}</h5><ul class="steps">${branches}</ul>` : ''}`;
}

let current = null;
let currentHistory = [];

const stateText = (state) => t(`state.${state}`);
const stateIcon = (state) => icon(STATE_ICON[state] || 'circle', `st-${state}`);

// ---------- Overview: one card per task ----------

const OV = { w: 232, h: 140, gapX: 84, gapY: 18, pad: 14 };
const ovX = (col) => OV.pad + col * (OV.w + OV.gapX);
const ovY = (row) => OV.pad + row * (OV.h + OV.gapY);

function cardBody(n) {
  if (n.kind === 'goal') {
    return `<div class="ov-top">${icon('flag')}<span class="ov-kind">${esc(t('card.goal'))}</span></div><div class="ov-title ov-goal-text">${esc(n.title)}</div>`;
  }
  if (n.kind === 'merge') {
    const wait = n.waiting ? `<div class="ov-line warn">${icon('clock')}<span>${esc(n.current.join(', '))}</span></div>` : '';
    return `<div class="ov-top">${icon('merge')}<span class="ov-kind">${esc(t('card.merge'))}</span></div><div class="ov-title">${esc(t('card.mergeSteps', { n: n.progress.total }))}</div>${wait}`;
  }
  const pct = n.progress.total ? Math.round((n.progress.done / n.progress.total) * 100) : 0;
  const allDone = n.progress.total && n.progress.done === n.progress.total;
  const now = n.current.length
    ? `<div class="ov-line now">${icon('play')}<span>${esc(n.current.join('; '))}</span></div>`
    : `<div class="ov-line muted">${icon(allDone ? 'check' : 'circle')}<span>${esc(t(allDone ? 'card.allDone' : 'card.noActive'))}</span></div>`;
  const flags = [
    n.waiting ? `<span class="warn">${icon('clock')}${esc(t('card.waiting', { n: n.waiting }))}</span>` : '',
    n.unpushed ? `<span class="warn">${icon('branch')}${esc(t('unpushed.short'))}</span>` : '',
    n.dirty ? `<span class="warn">${icon('alert')}${esc(t('dirty'))}</span>` : '',
    n.docs ? `<span class="muted">${icon('file')}${n.docs}</span>` : '',
  ].filter(Boolean).join('');
  return `<div class="ov-top"><span class="mono">${esc(n.id)}</span>${n.status ? `<span class="chip">${esc(n.status)}</span>` : ''}</div>
    <div class="ov-title" title="${esc(n.fullTitle)}">${esc(n.title)}</div>
    <div class="ov-progress"><span class="bar"><i style="width:${pct}%"></i></span><span class="mono">${n.progress.done}/${n.progress.total}</span></div>
    ${now}${flags ? `<div class="ov-flags">${flags}</div>` : ''}`;
}

function cardState(n) {
  if (n.kind !== 'task') return n.kind;
  if (n.current.length) return 'active';
  if (n.progress.total && n.progress.done === n.progress.total) return 'done';
  return 'todo';
}

// Arrows are drawn between whole tasks; the step-level links live in the opened task.
function renderOverview(ov, open) {
  const width = OV.pad * 2 + ov.cols * OV.w + (ov.cols - 1) * OV.gapX;
  const height = OV.pad * 2 + ov.rows * OV.h + (ov.rows - 1) * OV.gapY;
  const at = new Map(ov.nodes.map((n) => [n.id, n]));
  const edges = ov.edges.filter((e) => at.has(e.from) && at.has(e.to)).map((e) => {
    const a = at.get(e.from);
    const b = at.get(e.to);
    const x1 = ovX(a.col) + OV.w;
    const y1 = ovY(a.row) + OV.h / 2;
    const x2 = ovX(b.col);
    const y2 = ovY(b.row) + OV.h / 2;
    const bend = Math.max(20, (x2 - x1) / 2);
    const d = y1 === y2 ? `M${x1},${y1} L${x2 - 2},${y2}` : `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2 - 2},${y2}`;
    const label = e.labels.length ? `<text class="tl-label" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle">${esc(e.labels.join(', '))}</text>` : '';
    return `<path class="tl-edge${e.labels.length ? ' cross' : ''}" d="${d}" marker-end="url(#ov-arrow)"/>${label}`;
  }).join('');
  const cards = ov.nodes.map((n) => {
    const attrs = n.kind === 'goal' ? '' : ` role="button" tabindex="0" data-open="${esc(n.id)}" aria-expanded="${open === n.id}"`;
    const info = n.kind === 'task' ? `<button type="button" class="icon-btn info-btn ov-info" data-info="${esc(n.id)}" aria-label="${esc(t('task.more', { id: n.id }))}">${icon('info')}</button>` : '';
    return `<foreignObject x="${ovX(n.col)}" y="${ovY(n.row)}" width="${OV.w}" height="${OV.h}"><div xmlns="http://www.w3.org/1999/xhtml" class="ov-card k-${n.kind} ${cardState(n)}${open === n.id ? ' selected' : ''}"${attrs}>${info}${cardBody(n)}</div></foreignObject>`;
  }).join('');
  return `<div class="ov-scroll"><svg class="ov-svg" viewBox="0 0 ${width} ${height}" data-w="${width}" style="max-width:${width}px">
    <defs><marker id="ov-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="tl-arrowhead"/></marker></defs>
    ${edges}${cards}</svg></div>`;
}

// ---------- Detail: the steps of one task ----------

function stepChip(step) {
  const deps = step.deps.map((d) => `<span class="dep">${icon('dep')}${esc(t('step.after', { task: d.task, title: d.title }))}${d.label ? ` <em>${esc(d.label)}</em>` : ''}</span>`).join('');
  const tip = [stateText(step.state), step.note].filter(Boolean).join(' — ');
  return `<li class="step ${esc(step.state)}" title="${esc(tip)}"><span class="step-title">${stateIcon(step.state)}${esc(step.title)}</span>${deps}</li>`;
}

function narrowFlow(steps) {
  return `<ol class="flow">${steps.map(stepChip).join('') || `<li class="muted">${esc(t('step.none'))}</li>`}</ol>`;
}

const TL = { colW: 200, nodeW: 168, nodeH: 84, rowH: 100, pad: 24 };
const tlState = { focused: null, open: null, step: null, allDocs: false };

function nodeX(col) { return TL.pad + col * TL.colW; }
function rowY(i) { return i * TL.rowH + (TL.rowH - TL.nodeH) / 2; }

// The steps are drawn from data: columns come from layoutMap, so a new step needs no drawing.
function renderTimeline(layout) {
  const width = TL.pad * 2 + layout.cols * TL.colW - (TL.colW - TL.nodeW);
  const height = layout.rows.length * TL.rowH;
  const edges = layout.edges.map((e) => {
    const x1 = nodeX(e.from.col) + TL.nodeW;
    const x2 = nodeX(e.to.col);
    const y = rowY(0) + TL.nodeH / 2;
    return `<path class="tl-edge" d="M${x1},${y} L${x2 - 2},${y}" marker-end="url(#tl-arrow)"/>`;
  }).join('');
  const nodes = layout.rows.map((r, i) => r.cells.map((c) => {
    const tip = [stateText(c.state), c.note, c.branch].filter(Boolean).join(' — ');
    const n = r.kind === 'merge' ? `<span class="n">${c.n}</span>` : '';
    const note = c.note ? `<span class="tl-note">${esc(c.note)}</span>` : c.branch ? `<span class="tl-note mono">${esc(c.branch)}</span>` : '';
    const docCount = (current?.docs || []).filter((d) => d.task === r.id && d.step === c.id).length;
    const badge = docCount ? `<span class="tl-docs" title="${esc(t('step.docCount', { n: docCount }))}">${icon('file')}${docCount}</span>` : '';
    return `<foreignObject x="${nodeX(c.col)}" y="${rowY(i)}" width="${TL.nodeW}" height="${TL.nodeH}"><div xmlns="http://www.w3.org/1999/xhtml" class="tl-node ${esc(c.state)}${docCount ? ' has-docs' : ''}${r.kind === 'lane' && c.id === tlState.step ? ' selected' : ''}"${r.kind === 'lane' ? ` data-step="${esc(c.id)}"` : ''} data-sid="st-${esc(r.id)}-${esc(c.id)}" title="${esc(tip)}"><span class="tl-title">${stateIcon(c.state)}${n}${esc(c.title)}</span>${note}${badge}</div></foreignObject>`;
  }).join('')).join('');
  return `<div class="tl" id="tl"><div class="tl-scroll" id="tl-scroll"><svg class="tl-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <defs><marker id="tl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="tl-arrowhead"/></marker></defs>
      ${edges}${nodes}</svg></div></div>`;
}

// One row only: other lanes are left out, so cross-task links become the lists beside the steps.
function detailLayout(map, open) {
  const single = open === 'merge'
    ? { lanes: [], merge: map.merge, goal: map.goal, here: [] }
    : { lanes: map.lanes.filter((l) => l.id === open), merge: [], goal: map.goal, here: [] };
  const full = layoutMap(single);
  const rows = full.rows.filter((r) => r.kind !== 'goal');
  const cols = Math.max(0, ...rows.flatMap((r) => r.cells.map((c) => c.col + 1)));
  return { rows, cols, edges: full.edges.filter((e) => e.from.row === e.to.row && e.to.row !== 'goal'), focus: full.focus };
}

function linksOf(map, open) {
  if (open === 'merge') {
    const branches = new Set(map.merge.map((m) => m.branch).filter(Boolean));
    const incoming = map.lanes.filter((l) => l.branches.some((b) => branches.has(b))).map((l) => `<li>${icon('branch')}<span>${esc(l.id)} · ${esc(l.title)}</span></li>`);
    return { incoming, outgoing: [`<li>${icon('flag')}<span>${esc(map.goal)}</span></li>`] };
  }
  const lane = map.lanes.find((l) => l.id === open);
  const incoming = lane.steps.flatMap((s) => s.deps.map((d) => `<li>${icon('dep')}<span><b>${esc(d.task)} · ${esc(d.title)}</b> ${icon('arrowRight', 'inl')}${esc(s.title)}${d.label ? ` <em>${esc(d.label)}</em>` : ''}</span></li>`));
  const outgoing = map.lanes.filter((l) => l.id !== open).flatMap((l) => l.steps.flatMap((s) => s.deps.filter((d) => d.task === open).map((d) => `<li>${icon('arrowRight')}<span>${esc(d.title)} ${icon('arrowRight', 'inl')}<b>${esc(l.id)} · ${esc(s.title)}</b>${d.label ? ` <em>${esc(d.label)}</em>` : ''}</span></li>`)));
  const mergeBranches = new Set(map.merge.map((m) => m.branch).filter(Boolean));
  if (lane.branches.some((b) => mergeBranches.has(b))) outgoing.push(`<li>${icon('merge')}<span>${esc(t('detail.toMerge'))}</span></li>`);
  return { incoming, outgoing };
}

function renderDetail(map, open) {
  const lane = open === 'merge' ? null : map.lanes.find((l) => l.id === open);
  if (lane && (!tlState.step || !lane.steps.some((st) => st.id === tlState.step))) tlState.step = defaultStep(lane);
  const raw = lane ? (current?.tasks || []).find((x) => x.id === lane.id) : null;
  const title = lane ? `<span class="mono muted">${esc(lane.id)}</span> ${esc(lane.fullTitle)}` : `${icon('merge')} ${esc(t('card.merge'))}`;
  const { incoming, outgoing } = linksOf(map, open);
  const list = (items, empty) => (items.length ? `<ul class="links">${items.join('')}</ul>` : `<p class="muted">${esc(empty)}</p>`);
  const steps = lane ? lane.steps : map.merge.map((m) => ({ id: `m${m.n}`, title: `${m.n}. ${m.text}`, state: m.waiting ? 'waiting' : 'todo', note: m.branch, deps: [] }));
  return `<section class="detail" id="detail" aria-label="${esc(t('detail.aria'))}">
    <header class="detail-head"><h3>${title}</h3>${lane?.status ? `<span class="chip">${esc(lane.status)}</span>` : ''}${raw?.url ? external(raw.url, raw.tracker || t('task.open')) : ''}</header>
    <div class="detail-links"><div><h4>${esc(t('detail.dependsOn'))}</h4>${list(incoming, t('detail.noIn'))}</div><div><h4>${esc(t('detail.leadsTo'))}</h4>${list(outgoing, t('detail.noOut'))}</div></div>
    ${renderTimeline(detailLayout(map, open))}
    ${lane ? stepSplit(lane) : ''}
    <div class="lanes-narrow">${narrowFlow(steps)}</div>
  </section>`;
}

// ---------- Stage documents ----------

const KINDS = ['spec', 'plan', 'log', 'review', 'note'];
const kindText = (kind) => (KINDS.includes(kind) ? t(`kind.${kind}`) : kind);

function docsBlock(lane, step, all) {
  const docs = (current?.docs || []).filter((d) => d.task === lane.id && (all || d.step === step));
  const stepTitle = new Map(lane.steps.map((st) => [st.id, st.title]));
  const groups = new Map();
  for (const d of docs) {
    const key = d.step || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const order = ['', ...lane.steps.map((st) => st.id)].filter((k) => groups.has(k));
  const rows = order.map((k) => `<div class="doc-group"><h5>${esc(k ? stepTitle.get(k) || k : t('docs.wholeTask'))}</h5><ul class="doc-tiles">${groups.get(k).map((d) => `<li><button type="button" class="doc-tile k-${esc(d.kind)}" data-doc="${esc(d.id)}" title="${esc(d.owned ? d.title : `${d.title}\n${d.path}`)}"><span class="doc-tile-top"><span class="doc-kind">${icon('file')}${esc(kindText(d.kind))}</span>${d.owned ? '' : `<span class="doc-linked">${icon('link')}</span>`}</span><span class="doc-title">${esc(d.title)}</span></button></li>`).join('')}</ul></div>`).join('');
  const total = (current?.docs || []).filter((d) => d.task === lane.id).length;
  const toggle = `<button type="button" data-docs-all>${all ? `${icon('target')}${esc(t('docs.onlyStep'))}` : `${icon('file')}${esc(t('docs.allTask', { n: total }))}`}</button>`;
  return `<div class="docs-block"><div class="docs-head"><h4>${esc(t(all ? 'docs.taskTitle' : 'docs.stepTitle'))} · ${docs.length}</h4><div class="docs-tools">${toggle}<button type="button" class="live-only" data-doc-add="${esc(lane.id)}">${icon('plus')}${esc(t('docs.add'))}</button></div></div><div class="docs-scroll">${rows || `<p class="muted">${esc(t(all ? 'docs.taskNone' : 'docs.stepNone'))}</p>`}</div></div>`;
}

function stepInfo(lane, stepId) {
  const step = lane.steps.find((st) => st.id === stepId);
  if (!step) return `<div class="step-info"><p class="muted">${esc(t('step.none'))}</p></div>`;
  const raw = (current?.tasks || []).find((x) => x.id === lane.id)?.steps?.find((st) => st.id === stepId) || {};
  const deps = step.deps.map((d) => `<li>${icon('dep')}<span>${esc(d.task)} · ${esc(d.title)}${d.label ? ` <em>${esc(d.label)}</em>` : ''}</span></li>`).join('');
  const prefix = `tasks[${lane.id}].steps[${stepId}]`;
  const changes = currentHistory.filter((h) => String(h.path).startsWith(prefix)).slice(0, 6).map((h) => {
    const d = describeEvent(h);
    const value = d.change === 'add' ? t('step.added') : `${cap(d.what)}: ${d.before ?? '—'} → ${d.after ?? '—'}`;
    return `<li><span class="muted">${agoTag(h.at)}</span><span>${esc(value)}</span></li>`;
  }).join('');
  const docCount = (current?.docs || []).filter((d) => d.task === lane.id && d.step === stepId).length;
  return `<div class="step-info">
    <div class="step-info-head">${stateIcon(step.state)}<span class="chip">${esc(cap(stateText(step.state)))}</span><span class="mono muted">${esc(lane.id)}/${esc(step.id)}</span></div>
    <h4 class="step-info-title">${esc(step.title)}</h4>
    ${step.note ? `<p class="step-info-note">${esc(step.note)}</p>` : `<p class="muted">${esc(t('step.noDescription'))}</p>`}
    <dl class="step-info-meta">
      <dt>${esc(t('step.dependsOn'))}</dt><dd>${deps ? `<ul class="links">${deps}</ul>` : esc(t('step.prev'))}</dd>
      <dt>${esc(t('step.docs'))}</dt><dd>${docCount}</dd>
      ${raw.label ? `<dt>${esc(t('step.label'))}</dt><dd>${esc(raw.label)}</dd>` : ''}
    </dl>
    ${changes ? `<h5>${esc(t('step.changes'))}</h5><ul class="step-changes">${changes}</ul>` : ''}
  </div>`;
}

function stepSplit(lane) {
  if (!tlState.step || !lane.steps.some((st) => st.id === tlState.step)) tlState.step = defaultStep(lane);
  return `<div class="step-split">${docsBlock(lane, tlState.step, tlState.allDocs)}${stepInfo(lane, tlState.step)}</div>`;
}

// One renderer for the whole page: vendored marked + DOMPurify when present, the built-in one otherwise.
function renderMd(text) {
  if (window.marked && window.DOMPurify) {
    const html = window.DOMPurify.sanitize(window.marked.parse(String(text ?? ''), { gfm: true }));
    const box = document.createElement('div');
    box.innerHTML = html;
    const toc = [];
    const seen = new Map();
    for (const h of box.querySelectorAll('h1,h2,h3,h4')) {
      let id = h.textContent.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
      const n = seen.get(id) || 0;
      seen.set(id, n + 1);
      if (n) id = `${id}-${n + 1}`;
      h.id = id;
      toc.push({ level: Number(h.tagName[1]), text: h.textContent, id });
    }
    for (const a of box.querySelectorAll('a[href]')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    return { html: box.innerHTML, toc };
  }
  return renderMarkdown(text);
}

const docState = { id: null, text: '', mtimeMs: 0, mode: 'view', dirty: false };

function docPanel() {
  let panel = $('#doc-panel');
  if (!panel) {
    panel = document.createElement('aside');
    panel.id = 'doc-panel';
    panel.className = 'doc-panel';
    panel.hidden = true;
    document.body.appendChild(panel);
  }
  return panel;
}

function renderDocPanel(doc, extra = '') {
  const panel = docPanel();
  const { html, toc } = renderMd(docState.text);
  const tocHtml = toc.length ? `<nav class="doc-toc"><h5>${esc(t('doc.toc'))}</h5>${toc.map((x) => `<a href="#${esc(x.id)}" class="lvl${x.level}" data-toc="${esc(x.id)}">${esc(x.text)}</a>`).join('')}</nav>` : '';
  const where = [doc.task, doc.step].filter(Boolean).join(' · ') || t('doc.wholeEpic');
  const head = `<header class="doc-head">
      <div class="doc-head-title"><span class="chip">${esc(kindText(doc.kind))}</span><h3>${esc(doc.title)}</h3></div>
      <div class="doc-actions">
        ${docState.mode === 'edit'
          ? `<button type="button" data-doc-save>${icon('save')}${esc(t('doc.save'))}</button><button type="button" data-doc-cancel>${esc(t('cancel'))}</button>`
          : `<button type="button" class="live-only" data-doc-edit>${icon('edit')}${esc(t('doc.edit'))}</button><button type="button" class="live-only" data-doc-versions>${icon('versions')}${esc(t('doc.versions'))}</button>`}
        <button type="button" class="icon-btn" data-doc-close aria-label="${esc(t('close'))}">${icon('close')}</button>
      </div>
      <p class="doc-meta muted">${esc(where)} · ${esc(t(doc.owned ? 'doc.owned' : 'doc.linked'))} · <span class="mono">${esc(doc.path || '')}</span></p>
    </header>${extra}`;
  const body = docState.mode === 'edit'
    ? `<div class="doc-edit"><textarea id="doc-text" spellcheck="false">${esc(docState.text)}</textarea><div class="doc-preview md" id="doc-preview">${html}</div></div>`
    : `<div class="doc-body">${tocHtml}<article class="md">${html}</article></div>`;
  panel.innerHTML = head + body;
  panel.hidden = false;
  document.body.classList.add('doc-open');
}

async function openDoc(id, mode = 'view') {
  const r = await api(`/api/epics/${enc(current.id)}/docs/${enc(id)}`);
  Object.assign(docState, { id, text: r.text, mtimeMs: r.mtimeMs, mode, dirty: false, doc: r.doc });
  renderDocPanel(r.doc);
}

function closeDoc() {
  if (docState.mode === 'edit' && docState.dirty && !window.confirm(t('doc.unsavedClose'))) return;
  docPanel().hidden = true;
  document.body.classList.remove('doc-open');
  docState.id = null;
}

async function saveDoc() {
  const text = $('#doc-text').value;
  try {
    const r = await api(`/api/epics/${enc(current.id)}/docs/${enc(docState.id)}`, { method: 'PUT', body: { text, mtimeMs: docState.mtimeMs } });
    Object.assign(docState, { text, mtimeMs: r.mtimeMs, mode: 'view', dirty: false });
    renderDocPanel(docState.doc);
  } catch (e) {
    renderDocPanel(docState.doc, `<p class="doc-error">${icon('alert')}${esc(e.message)} <button type="button" data-doc-reload>${icon('refresh')}${esc(t('doc.reload'))}</button></p>`);
    $('#doc-text').value = text;
  }
}

async function showVersions() {
  const list = await api(`/api/epics/${enc(current.id)}/docs/${enc(docState.id)}/versions`);
  const rows = list.length
    ? list.map((v) => `<li><button type="button" data-doc-version="${esc(v.id)}">${icon('versions')}${esc(new Date(v.at).toLocaleString(locale()))}</button></li>`).join('')
    : `<li class="muted">${esc(t('doc.noVersions'))}</li>`;
  renderDocPanel(docState.doc, `<div class="doc-versions"><h5>${esc(t('doc.versions'))}</h5><ul>${rows}</ul></div>`);
}

async function showVersion(versionId) {
  const { text } = await api(`/api/epics/${enc(current.id)}/docs/${enc(docState.id)}/versions/${enc(versionId)}`);
  const { html } = renderMd(text);
  renderDocPanel(docState.doc, `<div class="doc-versions"><h5>${esc(t('doc.versionOf', { t: versionId.slice(0, 16).replace('T', ' ') }))}</h5>
    <button type="button" data-doc-restore="${esc(versionId)}">${icon('undo')}${esc(t('doc.restore'))}</button><article class="md doc-version-view">${html}</article></div>`);
  docState.versionText = text;
}

function addDocForm(taskId) {
  const lane = buildLanes(current).lanes.find((l) => l.id === taskId);
  const panel = docPanel();
  const mode = current.docsMode === 'linked' ? 'doc.mode.linked' : current.docsMode === 'board' ? 'doc.mode.board' : 'doc.mode.none';
  panel.innerHTML = `<header class="doc-head"><div class="doc-head-title"><h3>${esc(t('doc.new', { task: taskId }))}</h3></div><div class="doc-actions"><button type="button" class="icon-btn" data-doc-close aria-label="${esc(t('close'))}">${icon('close')}</button></div></header>
    <form class="doc-form" id="doc-form">
      <label>${esc(t('doc.kind'))} <select id="df-kind">${KINDS.map((k) => `<option value="${k}">${esc(t(`kind.${k}`))}</option>`).join('')}</select></label>
      <label>${esc(t('doc.step'))} <select id="df-step"><option value="">${esc(t('docs.wholeTask'))}</option>${lane.steps.map((st) => `<option value="${esc(st.id)}"${st.state === 'active' ? ' selected' : ''}>${esc(st.title)}</option>`).join('')}</select></label>
      <label>${esc(t('doc.title'))} <input id="df-title" required placeholder="${esc(t('doc.titlePh'))}"></label>
      <fieldset><legend>${esc(t('doc.where'))}</legend>
        <label class="inline"><input type="radio" name="df-mode" value="new" checked> ${esc(t('doc.onBoard'))}</label>
        <label class="inline"><input type="radio" name="df-mode" value="link"> ${esc(t('doc.link'))}</label>
      </fieldset>
      <label id="df-path-row" hidden>${esc(t('doc.path'))} <input id="df-path" placeholder="/path/to/repo/docs/spec.md"></label>
      <p class="muted">${esc(t(mode))}</p>
      <div class="doc-actions"><button type="submit">${icon('plus')}${esc(t('doc.create'))}</button></div>
    </form>`;
  panel.hidden = false;
  document.body.classList.add('doc-open');
  if (current.docsMode === 'linked') panel.querySelector('input[value="link"]').checked = true;
  const syncPath = () => {
    $('#df-path-row').hidden = panel.querySelector('input[name="df-mode"]:checked').value !== 'link';
  };
  syncPath();
  panel.querySelectorAll('input[name="df-mode"]').forEach((r) => r.addEventListener('change', syncPath));
  $('#doc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const how = panel.querySelector('input[name="df-mode"]:checked').value;
    try {
      const doc = await api(`/api/epics/${enc(current.id)}/docs`, { method: 'POST', body: { mode: how, task: taskId, step: $('#df-step').value || undefined, kind: $('#df-kind').value, title: $('#df-title').value.trim(), path: $('#df-path').value.trim() || undefined } });
      current = await api(`/api/epics/${enc(current.id)}`);
      renderMapArea(current);
      await openDoc(doc.id, how === 'new' ? 'edit' : 'view');
    } catch (err) {
      alertBox(err.message);
    }
  });
}

function bindDocs() {
  document.addEventListener('click', (e) => {
    const el = e.target;
    const open = el.closest('[data-doc]');
    if (open) return void openDoc(open.dataset.doc).catch((err) => alertBox(err.message));
    const add = el.closest('[data-doc-add]');
    if (add) return void addDocForm(add.dataset.docAdd);
    if (el.closest('[data-doc-close]')) return closeDoc();
    if (el.closest('[data-doc-edit]')) {
      docState.mode = 'edit';
      return renderDocPanel(docState.doc);
    }
    if (el.closest('[data-doc-cancel]')) {
      if (docState.dirty && !window.confirm(t('doc.unsavedCancel'))) return;
      docState.mode = 'view';
      docState.dirty = false;
      return renderDocPanel(docState.doc);
    }
    if (el.closest('[data-doc-save]')) return void saveDoc();
    if (el.closest('[data-doc-reload]')) return void openDoc(docState.id, 'view');
    if (el.closest('[data-doc-versions]')) return void showVersions().catch((err) => alertBox(err.message));
    const ver = el.closest('[data-doc-version]');
    if (ver) return void showVersion(ver.dataset.docVersion).catch((err) => alertBox(err.message));
    if (el.closest('[data-doc-restore]')) {
      Object.assign(docState, { mode: 'edit', dirty: true, text: docState.versionText });
      return renderDocPanel(docState.doc);
    }
    const toc = el.closest('[data-toc]');
    if (toc) {
      e.preventDefault();
      document.getElementById(toc.dataset.toc)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'doc-text') return;
    docState.dirty = true;
    $('#doc-preview').innerHTML = renderMd(e.target.value).html;
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && docState.mode === 'edit' && !$('#doc-panel').hidden) {
      e.preventDefault();
      saveDoc();
    }
    if (e.key === 'Escape' && docState.id && docState.mode !== 'edit') closeDoc();
  });
}

// ---------- Full screen of the whole map block ----------

// The in-page overlay always works; the browser's own fullscreen is a bonus some embeds refuse.
function setFull(on) {
  const frame = $('#map-frame');
  if (!frame) return;
  frame.classList.toggle('map-full', on);
  document.body.classList.toggle('tl-locked', on);
  const btn = $('[data-fullscreen]');
  if (btn) btn.innerHTML = on ? `${icon('collapse')}<span>${esc(t('map.collapse'))}</span>` : `${icon('expand')}<span>${esc(t('map.full'))}</span>`;
  const tools = $('.map-tools');
  if (tools) on ? frame.prepend(tools) : $('.map-section .section-head').appendChild(tools);
  if (on && frame.requestFullscreen && !document.fullscreenElement) frame.requestFullscreen().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#map-frame')?.classList.contains('map-full')) setFull(false);
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && $('#map-frame')?.classList.contains('map-full')) setFull(false);
});

// The map is always drawn at 100%; enlarging is left to the browser's own zoom.
function bindMapTools() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('.map-tools [data-fullscreen]')) setFull(!$('#map-frame').classList.contains('map-full'));
  });
}

function focusTimeline(layout) {
  const scroller = $('#tl-scroll');
  if (!scroller || !layout.focus) return;
  scroller.scrollLeft = nodeX(layout.focus.col) + TL.nodeW / 2 - scroller.clientWidth / 2;
}

// Drag to pan the steps of the opened task: a long task is wider than the screen by design.
function bindPan() {
  const scroller = $('#tl-scroll');
  if (!scroller || scroller.dataset.bound) return;
  scroller.dataset.bound = '1';
  let drag = null;
  // Panning starts only after the pointer travels a few pixels, so a click still selects a step.
  scroller.addEventListener('pointerdown', (e) => {
    if (e.button === 0) drag = { x: e.clientX, left: scroller.scrollLeft, id: e.pointerId, moving: false };
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moving && Math.abs(e.clientX - drag.x) > 4) {
      drag.moving = true;
      scroller.setPointerCapture(drag.id);
      scroller.classList.add('dragging');
    }
    if (drag.moving) scroller.scrollLeft = drag.left - (e.clientX - drag.x);
  });
  const stop = () => {
    if (drag?.moving) scroller.dataset.dragEnd = String(Date.now());
    drag = null;
    scroller.classList.remove('dragging');
  };
  scroller.addEventListener('pointerup', stop);
  scroller.addEventListener('pointercancel', stop);
}

// ---------- Map area ----------

function sideTasks(map) {
  if (!map.side.length) return '';
  return `<div class="side-row"><span class="muted">${esc(t('map.side'))}</span>${map.side.map((l) => `<span class="chip" title="${esc(l.fullTitle)}">${esc(l.id)} · ${esc(l.title)}${l.status ? ` · ${esc(l.status)}` : ''}</span>`).join('')}</div>`;
}

function openFromHash() {
  const m = location.hash.match(/^#t-([^/]+)(?:\/([\w.-]+))?$/);
  if (!m) return null;
  tlState.step = m[2] || null;
  return decodeURIComponent(m[1]);
}

function renderMapArea(epic) {
  const map = buildLanes(epic);
  const ov = buildOverview(epic);
  for (const n of ov.nodes) n.docs = (epic.docs || []).filter((d) => d.task === n.id).length;
  if (tlState.open && !ov.nodes.some((n) => n.id === tlState.open && n.kind !== 'goal')) tlState.open = null;
  const open = tlState.open || defaultOpen(map);
  const here = map.here.length ? map.here.map((h) => `${esc(h.task)} · ${esc(h.title)}`).join('; ') : esc(t('map.noActive'));
  const prev = $('#tl-scroll');
  const keep = prev && tlState.focused === open ? prev.scrollLeft : null;
  $('#map').innerHTML = `<p class="here"><span class="chip active-chip">${icon('target')}${esc(t('map.here'))}</span>${here}</p>`
    + renderOverview(ov, open)
    + (open ? renderDetail(map, open) : '')
    + sideTasks(map);
  if (!open) return;
  bindPan();
  if (keep !== null) $('#tl-scroll').scrollLeft = keep;
  else {
    tlState.focused = open;
    focusTimeline(detailLayout(map, open));
  }
}

function toggleDetail(id) {
  if (tlState.open !== id) tlState.step = null;
  tlState.open = id;
  history.replaceState(null, '', `#t-${enc(id)}`);
  renderMapArea(current);
}

function selectStep(stepId) {
  tlState.step = stepId;
  history.replaceState(null, '', `#t-${enc(tlState.open || defaultOpen(buildLanes(current)))}/${stepId}`);
  renderMapArea(current);
}

// ---------- Needs decision ----------

const WAIT_KINDS = ['decision', 'approval', 'review', 'action', 'other'];
const waitKind = (kind) => t(`w.kind.${WAIT_KINDS.includes(kind) ? kind : 'other'}`);

// A link from a pending item to something already on the board: a chip that jumps there.
function refChip(epic, ref) {
  if (/^https?:\/\//i.test(ref)) {
    let label = ref;
    try {
      const u = new URL(ref);
      label = `${u.host}${u.pathname.length > 1 ? u.pathname : ''}`;
    } catch {}
    return external(ref, label.length > 48 ? `${label.slice(0, 47)}…` : label);
  }
  const [kind, ...rest] = ref.split(':');
  const value = rest.join(':');
  const tasks = epic.tasks || [];
  let label = null;
  let attrs = '';
  let ic = 'link';
  if (kind === 'task') {
    const task = tasks.find((x) => x.id === value);
    if (task) [label, attrs, ic] = [`${task.id} · ${task.title}`, `data-jump-task="${esc(task.id)}"`, 'list'];
  } else if (kind === 'step') {
    const [tid, sid] = value.split('/');
    const step = tasks.find((x) => x.id === tid)?.steps?.find((s) => s.id === sid);
    if (step) [label, attrs, ic] = [`${tid} · ${step.title}`, `data-jump-task="${esc(tid)}" data-jump-step="${esc(sid)}"`, STATE_ICON[step.state] || 'circle'];
  } else if (kind === 'branch') {
    if (tasks.some((x) => (x.branches || []).some((b) => `${b.repo}:${b.name}` === value))) [label, attrs, ic] = [value, `data-jump-sid="b-${esc(value)}"`, 'branch'];
  } else if (kind === 'doc') {
    const doc = (epic.docs || []).find((d) => d.id === value);
    if (doc) [label, attrs, ic] = [`${kindText(doc.kind)} · ${doc.title}`, `data-doc="${esc(doc.id)}"`, 'file'];
  } else if (kind === 'decision') {
    const d = (epic.decisions || []).find((x) => x.id === value);
    if (d) [label, attrs, ic] = [`${t('w.ref.decision')}: ${d.text.length > 40 ? `${d.text.slice(0, 39)}…` : d.text}`, `data-jump-sid="d-${esc(d.id)}"`, 'flag'];
  }
  if (!label) return `<span class="ref missing" title="${esc(t('w.missing'))}">${icon('alert')}${esc(ref)}</span>`;
  return `<button type="button" class="ref" ${attrs}>${icon(ic)}<span>${esc(label)}</span></button>`;
}

function waitingItem(epic, w) {
  const task = w.task ? `<button type="button" class="ref ref-task" data-jump-task="${esc(w.task)}">${esc(w.task)}</button>` : '';
  if (w.doneAt) {
    return `<li class="wait done" data-sid="w-${esc(w.id)}"><div class="wait-row"><span class="chip">${esc(waitKind(w.kind))}</span><span class="wait-text"><span class="wt">${esc(w.title)}</span><span class="wait-meta">${icon('check', 'st-done')}${phrase('w.doneAt', { t: agoText(w.doneAt) })}${task}</span>${w.resolution ? `<span class="wait-resolution">${esc(w.resolution)}</span>` : ''}</span><button type="button" class="live-only" data-undo="${esc(w.id)}">${icon('undo')}${esc(t('w.undo'))}</button></div></li>`;
  }
  const details = w.details ? `<div class="wait-details md">${renderMd(w.details).html}</div>` : '';
  const refs = (w.refs || []).length ? `<div class="wait-refs"><span class="muted">${esc(t('w.links'))}:</span>${w.refs.map((r) => refChip(epic, r)).join('')}</div>` : '';
  const checklist = (w.checklist || []).length ? `<ul class="wait-checklist">${w.checklist.map((c) => `<li>${icon('circle', 'st-todo')}<span>${esc(c.text)}</span></li>`).join('')}</ul>` : '';
  return `<li class="wait" data-sid="w-${esc(w.id)}">
    <div class="wait-row"><span class="chip">${esc(waitKind(w.kind))}</span><span class="wait-text"><span class="wt">${esc(w.title)}</span><span class="wait-meta">${task}${phrase('w.since', { t: agoTag(w.since) })}${(w.checklist || []).length ? `<span>${icon('list')}${esc(t('w.checklist', { n: w.checklist.length }))}</span>` : ''}</span></span><button type="button" class="live-only primary" data-done="${esc(w.id)}">${icon('check')}${esc(t('w.done'))}</button></div>
    ${details}${refs}${checklist}
  </li>`;
}

function renderWaiting(epic) {
  const waiting = [...(epic.waiting || [])].sort((a, b) => Boolean(a.doneAt) - Boolean(b.doneAt) || String(a.since).localeCompare(String(b.since)));
  $('#waiting').innerHTML = waiting.map((w) => waitingItem(epic, w)).join('') || `<li class="muted">${esc(t('none.waiting'))}</li>`;
  const open = waiting.filter((w) => !w.doneAt).length;
  const count = $('#waiting-count');
  if (count) count.textContent = open ? String(open) : '';
}

function modalHost(id) {
  let modal = $(`#${id}`);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = id;
    modal.className = 'modal-backdrop';
    document.body.appendChild(modal);
  }
  return modal;
}

// "Done" is a confirmation: when the item carries a checklist, every point must be ticked first.
function confirmModal(epic, itemId) {
  const w = (epic.waiting || []).find((x) => x.id === itemId);
  if (!w) return;
  const modal = modalHost('confirm-modal');
  const list = w.checklist || [];
  modal.innerHTML = `<div class="modal" role="dialog" aria-label="${esc(t('w.confirmTitle'))}">
      <header class="modal-head"><h3>${icon('check')}${esc(t('w.confirmTitle'))}</h3><span class="chip">${esc(waitKind(w.kind))}</span></header>
      <h4 class="confirm-title">${esc(w.title)}</h4>
      ${w.details ? `<div class="wait-details md">${renderMd(w.details).html}</div>` : ''}
      ${list.length ? `<p class="muted">${esc(t('w.confirmHint'))}</p><ul class="confirm-list">${list.map((c) => `<li><label><input type="checkbox" data-check="${esc(c.id)}"> ${esc(c.text)}</label></li>`).join('')}</ul>` : ''}
      <label class="confirm-note">${esc(t('w.resolution'))}<textarea id="confirm-resolution" rows="3"></textarea></label>
      <footer class="modal-foot"><button type="button" data-modal-close>${esc(t('cancel'))}</button><button type="button" class="primary" data-confirm="${esc(w.id)}"${list.length ? ' disabled' : ''}>${icon('check')}${esc(t('w.confirm'))}</button></footer></div>`;
  modal.hidden = false;
  const sync = () => {
    const boxes = [...modal.querySelectorAll('[data-check]')];
    modal.querySelector('[data-confirm]').disabled = !boxes.every((b) => b.checked);
  };
  modal.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('change', sync));
  (modal.querySelector('[data-check]') || modal.querySelector('#confirm-resolution')).focus();
}

function jumpToTask(taskId, stepId) {
  if (taskId !== (tlState.open || defaultOpen(buildLanes(current)))) toggleDetail(taskId);
  if (stepId) selectStep(stepId);
  requestAnimationFrame(() => (stepId ? flash(`st-${taskId}-${stepId}`) : $('#map-frame')?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
}

// ---------- The rest of the page ----------

function branchRows(epic) {
  const rows = [];
  for (const task of epic.tasks || []) {
    for (const b of task.branches || []) {
      const key = `${b.repo}:${b.name}`;
      const f = epic.facts?.[key];
      const stale = !f?.fetchedAt || nowMs() - Date.parse(f.fetchedAt) > STALE_MS;
      const mr = f?.mr && !f.mr.error
        ? `${isHttp(f.mr.url) ? `<a href="${esc(f.mr.url)}" target="_blank" rel="noopener noreferrer">#${b.mr.iid}</a>` : `#${b.mr.iid}`} ${esc(f.mr.draft ? 'draft' : f.mr.state)} <span class="${f.mr.pipeline === 'success' ? 'ok' : f.mr.pipeline === 'failed' ? 'crit' : 'warn'}">${esc(f.mr.pipeline ?? '')}</span>${f.mr.shaMatchesHead ? '' : ` <span class="warn">${esc(t('br.wrongHead'))}</span>`}`
        : f?.mr?.error ? `<span class="crit">${esc(f.mr.error)}</span>` : b.mr?.iid ? `#${b.mr.iid}` : '—';
      const counts = f
        ? `<span class="nowrap" title="${esc(t('br.behind'))}">${icon('arrowDown')}${f.behind ?? '?'}</span> <span class="nowrap" title="${esc(t('br.ahead'))}">${icon('arrowUp')}${f.ahead ?? '?'}</span>${f.unpushed ? ` <span class="warn nowrap">${icon('branch')}${esc(t('unpushed', { n: f.unpushed }))}</span>` : ''}${f.dirty ? ` <span class="warn nowrap">${icon('alert')}${esc(t('dirty'))}</span>` : ''}`
        : '—';
      rows.push(`<tr data-sid="b-${esc(key)}">
        <td>${esc(b.repo)}<div class="muted">${esc(task.id)}</div></td>
        <td class="mono">${esc(b.name)}</td>
        <td class="mono">${esc(f?.head ?? '—')}<div class="muted">${esc(f?.subject ?? '')}</div></td>
        <td class="mono">${counts}</td>
        <td>${mr}</td>
        <td class="mono ${stale ? 'stale' : 'muted'}">${agoTag(f?.fetchedAt)}${f?.error ? `<div class="crit">${esc(f.error)}</div>` : ''}</td>
        <td><button type="button" class="live-only" data-refresh="${esc(key)}">${icon('refresh')}${esc(t('br.refresh'))}</button></td>
      </tr>`);
    }
  }
  const th = ['br.repo', 'br.branch', 'br.head', 'br.base', 'br.mr', 'br.fact'].map((k) => `<th>${esc(t(k))}</th>`).join('');
  return rows.length ? `<tr>${th}<th></th></tr>${rows.join('')}` : `<tr><td class="muted">${esc(t('br.none'))}</td></tr>`;
}

async function renderEpic(id) {
  const [epic, history] = await Promise.all([api(`/api/epics/${enc(id)}`), api(`/api/epics/${enc(id)}/history?limit=200`).catch(() => [])]);
  currentHistory = history;
  current = epic;
  document.title = `${epic.id} · ${epic.title}`;
  $('#title').innerHTML = `<span class="mono muted">${esc(epic.id)}</span> · ${esc(epic.title)}${epic.url ? ` ${external(epic.url, '')}` : ''}`;
  $('#goal').textContent = epic.goal || '';
  const stamps = Object.values(epic.facts || {}).map((f) => f.fetchedAt).filter(Boolean).sort();
  $('#updated').innerHTML = stamps.length ? t('epic.factsUpdated', { a: agoText(stamps.at(-1)), b: agoText(epic.updatedAt) }) : t('epic.edited', { a: agoText(epic.updatedAt) });
  renderMapArea(epic);
  renderWaiting(epic);
  $('#branches').innerHTML = branchRows(epic);
  $('#decisions').innerHTML = [...(epic.decisions || [])].reverse().slice(0, 10).map((d) => `<li data-sid="d-${esc(d.id)}"><span class="mono muted">${esc(String(d.at).slice(0, 10))}</span>${d.task ? `<span class="chip">${esc(d.task)}</span>` : ''}<span>${esc(d.text)}</span>${d.by ? `<span class="muted">${esc(d.by)}</span>` : ''}</li>`).join('') || `<li class="muted">${esc(t('none.decisions'))}</li>`;
  $('#sessions').innerHTML = [...(epic.sessions || [])].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))).map((x) => `<li class="session" data-sid="s-${esc(x.id)}">
      <div class="session-head">${agentBadge(x.agent)}<code class="muted">${esc(x.id.slice(0, 8))}</code>${x.task ? `<span class="chip">${esc(x.task)}</span>` : ''}<span class="muted session-time">${icon('clock')}<span class="phrase">${agoText(x.lastAt)}</span></span></div>
      <dl class="session-body"><dt>${esc(t('session.doing'))}</dt><dd>${esc(x.doing ?? '—')}</dd><dt>${esc(t('session.next'))}</dt><dd>${esc(x.next ?? '—')}</dd></dl></li>`).join('') || `<li class="muted">${esc(t('none.sessions'))}</li>`;
  $('#history').innerHTML = history.slice(0, 20).map((h, n) => {
    const d = describeEvent(h);
    const value = d.change === 'add' ? `<span class="hv-new">${esc(d.after ?? '')}</span>`
      : d.change === 'remove' ? `<span class="hv-old">${esc(d.before ?? '')}</span>`
      : `<span class="hv-old">${esc(d.before ?? '—')}</span>${icon('arrowRight', 'inl')}<span class="hv-new">${esc(d.after ?? '—')}</span>`;
    const by = ['agent', 'cli', 'refresh', 'button', 'hook'].includes(h.by) ? t(`by.${h.by}`) : cap(h.by);
    return `<li data-sid="h-${n}"><div class="h-line"><span class="h-time muted">${agoTag(h.at)}</span><span class="chip">${esc(by)}</span><span class="h-where">${esc(cap(d.where))}</span></div>
      <div class="h-change"><span class="h-what muted">${esc(cap(d.what))}:</span> ${value}</div>${h.why ? `<div class="h-why muted">${esc(cap(h.why))}</div>` : ''}</li>`;
  }).join('') || `<li class="muted">${esc(t('none.history'))}</li>`;
  buildSearchIndex(epic, history);
}

// ---------- Header search across everything the opened epic shows ----------

let searchIndex = [];

function buildSearchIndex(epic, history) {
  const items = [];
  const add = (section, text, target, extra = {}) => items.push({ section, text: String(text ?? ''), target, ...extra });
  for (const w of epic.waiting || []) add(t('search.waiting'), [w.title, w.details, ...(w.checklist || []).map((c) => c.text), w.resolution].filter(Boolean).join(' · '), `w-${w.id}`);
  for (const task of epic.tasks || []) {
    add(t('search.task'), `${task.id} · ${task.title}`, null, { open: task.id });
    for (const st of task.steps || []) add(t('search.step', { id: task.id }), [st.title, st.note].filter(Boolean).join(' — '), `st-${task.id}-${st.id}`, { open: task.id });
    for (const o of task.open || []) add(t('search.open', { id: task.id }), o.text, null, { open: task.id });
    for (const b of task.branches || []) {
      const f = epic.facts?.[`${b.repo}:${b.name}`];
      add(t('search.branch'), [`${b.repo}:${b.name}`, f?.head, f?.subject].filter(Boolean).join(' · '), `b-${b.repo}:${b.name}`);
    }
  }
  for (const x of epic.sessions || []) add(t('search.session'), [x.agent, x.doing, x.next].filter(Boolean).join(' · '), `s-${x.id}`);
  for (const d of epic.decisions || []) add(t('search.decision'), d.text, `d-${d.id}`);
  history.forEach((h, n) => {
    const d = describeEvent(h);
    add(t('search.history'), [d.where, d.what, d.before, d.after].filter(Boolean).join(' · '), `h-${n}`);
  });
  for (const d of epic.docs || []) add(t('search.doc', { t: kindText(d.kind) }), d.title, null, { doc: d.id });
  searchIndex = items;
  api(`/api/epics/${enc(epic.id)}/docs-text`).then((texts) => {
    for (const x of texts) {
      for (const para of x.text.split(/\n{2,}/)) if (para.trim()) items.push({ section: t('search.doc', { t: x.title }), text: para.replace(/\s+/g, ' ').trim(), target: null, doc: x.id });
    }
  }).catch(() => {});
}

function flash(sid) {
  const el = document.querySelector(`[data-sid="${CSS.escape(sid)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function runSearch() {
  const box = $('#search-results');
  const q = $('#q').value.trim().toLowerCase();
  if (!q) {
    box.hidden = true;
    return;
  }
  const hits = searchIndex.filter((it) => it.text.toLowerCase().includes(q)).slice(0, 14);
  const mark = (text) => {
    const i = text.toLowerCase().indexOf(q);
    return i < 0 ? esc(text) : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
  };
  box.innerHTML = hits.length
    ? hits.map((it, n) => `<button type="button" class="hit" data-hit="${n}"><span class="hit-section">${esc(it.section)}</span><span class="hit-text">${mark(it.text.slice(0, 160))}</span></button>`).join('')
    : `<p class="muted">${esc(t('search.none'))}</p>`;
  box.hidden = false;
  box.dataset.hits = JSON.stringify(hits);
}

function bindSearch() {
  const input = $('#q');
  if (!input) return;
  input.addEventListener('input', runSearch);
  input.addEventListener('focus', runSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      runSearch();
      input.blur();
    }
    if (e.key === 'Enter') $('#search-results .hit')?.click();
  });
  document.addEventListener('click', (e) => {
    const hit = e.target.closest('[data-hit]');
    if (hit) {
      const it = JSON.parse($('#search-results').dataset.hits)[Number(hit.dataset.hit)];
      $('#search-results').hidden = true;
      if (it.doc) {
        openDoc(it.doc).catch((err) => alertBox(err.message));
        return;
      }
      if (it.open && it.open !== (tlState.open || defaultOpen(buildLanes(current)))) toggleDetail(it.open);
      requestAnimationFrame(() => (it.target ? flash(it.target) : $('#map-frame')?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
      return;
    }
    if (!e.target.closest('.top-search')) $('#search-results').hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input && !e.target.closest('input, textarea')) {
      e.preventDefault();
      input.focus();
    }
  });
}

// ---------- Refresh with visible progress ----------

const FORGE_CLI = { gitlab: 'glab', github: 'gh' };

function refreshPlan(epic) {
  const repos = [...new Set((epic.tasks || []).flatMap((x) => (x.branches || []).map((b) => b.repo)))];
  const branches = (epic.tasks || []).flatMap((x) => (x.branches || []).map((b) => {
    const repo = epic.repos?.[b.repo] || {};
    return { key: `${b.repo}:${b.name}`, mr: b.mr?.iid, cli: repo.project ? FORGE_CLI[repo.provider] : null };
  }));
  return { repos, branches };
}

// Step one shows what will run and why; nothing touches git until the start button is pressed.
function refreshModal(epic) {
  const modal = modalHost('refresh-modal');
  const { repos, branches } = refreshPlan(epic);
  const row = (type, key, label, plan) => `<li class="pr-row pending" data-pr="${type}:${esc(key)}"><span class="pr-state">${icon('circle')}</span><span class="pr-label">${label}</span><span class="pr-detail muted">${plan}</span></li>`;
  modal.innerHTML = `<div class="modal" role="dialog" aria-label="${esc(t('refresh.aria'))}">
      <header class="modal-head"><h3>${icon('refresh')}${esc(t('refresh.title'))}</h3><span class="pr-summary muted" id="pr-summary">${esc(t('refresh.preview'))}</span></header>
      <p class="modal-text">${t('refresh.text')}</p>
      <h5>${esc(t('refresh.repos', { n: repos.length }))}</h5><ul class="pr-list">${repos.map((r) => row('repo', r, `<b>${esc(r)}</b>`, '<code>git fetch --prune origin</code>')).join('')}</ul>
      <h5>${esc(t('refresh.branches', { n: branches.length }))}</h5><ul class="pr-list">${branches.map((b) => row('branch', b.key, `<span class="mono">${esc(b.key)}</span>`, esc(b.mr && b.cli ? t('refresh.mr', { cli: b.cli, n: b.mr }) : t('refresh.git')))).join('')}</ul>
      <footer class="modal-foot"><button type="button" data-modal-close>${esc(t('cancel'))}</button><button type="button" class="primary" data-refresh-start>${icon('refresh')}${esc(t('refresh.start'))}</button></footer></div>`;
  modal.hidden = false;
  return modal;
}

function markProgress(modal, e) {
  const el = modal.querySelector(`[data-pr="${CSS.escape(`${e.type}:${e.key}`)}"]`);
  if (!el) return;
  el.className = `pr-row ${e.state === 'start' ? 'running' : e.state}`;
  el.querySelector('.pr-state').innerHTML = e.state === 'start' ? '<span class="spinner"></span>' : icon(e.state === 'ok' ? 'check' : 'alert');
  el.querySelector('.pr-detail').textContent = e.state === 'start' ? t('refresh.running') : e.state === 'ok' ? e.detail || t('refresh.ok') : cap(e.detail || t('refresh.error'));
}

async function runRefresh(id, modal) {
  for (const el of modal.querySelectorAll('.pr-row')) {
    el.className = 'pr-row queued';
    el.querySelector('.pr-state').innerHTML = '<span class="spinner"></span>';
    el.querySelector('.pr-detail').textContent = t('refresh.queued');
  }
  modal.querySelector('[data-refresh-start]').remove();
  const close = modal.querySelector('[data-modal-close]');
  close.disabled = true;
  close.textContent = t('close');
  $('#pr-summary').textContent = t('refresh.going');
  let ok = 0;
  let failed = 0;
  try {
    const res = await fetch(`/api/epics/${enc(id)}/refresh?stream=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'all' }) });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const e = JSON.parse(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (e.type === 'repo' || e.type === 'branch') {
          markProgress(modal, e);
          if (e.type === 'branch' && e.state === 'ok') ok++;
          if (e.type === 'branch' && e.state === 'error') failed++;
        }
        if (e.type === 'error') $('#pr-summary').innerHTML = `<span class="crit">${esc(t('refresh.errorText', { e: e.detail }))}</span>`;
        if (e.type === 'done') $('#pr-summary').innerHTML = failed ? `<span class="warn">${esc(t('refresh.doneWithErrors', { ok, failed }))}</span>` : `<span class="ok">${icon('check')}${esc(t('refresh.done', { ok }))}</span>`;
      }
    }
  } catch (e) {
    $('#pr-summary').innerHTML = `<span class="crit">${esc(t('refresh.errorText', { e: e.message }))}</span>`;
  } finally {
    close.disabled = false;
    await renderEpic(id);
  }
}

async function withButton(btn, fn) {
  btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    alertBox(e.message);
  } finally {
    btn.disabled = false;
  }
}

function alertBox(message) {
  const p = document.createElement('p');
  p.className = 'crit alert-box';
  p.textContent = message;
  ($('.modal-backdrop:not([hidden]) .modal-foot') || $('.head')).after(p);
  setTimeout(() => p.remove(), 8000);
}

function markExport() {
  document.body.classList.add('static');
  const note = $('#export-note');
  if (note) {
    note.hidden = false;
    note.innerHTML = `${icon('info')}${esc(t('export.note', { t: new Date(EXPORT.exportedAt).toLocaleString(locale(), { dateStyle: 'long', timeStyle: 'short' }) }))}`;
  }
  for (const a of document.querySelectorAll('a.brand')) a.removeAttribute('href');
}

function closeModals() {
  for (const modal of document.querySelectorAll('.modal-backdrop')) {
    const close = modal.querySelector('[data-modal-close]');
    if (!close || !close.disabled) modal.hidden = true;
  }
}

async function bootEpic() {
  const id = EXPORT ? EXPORT.epic.id : decodeURIComponent(location.pathname.split('/')[2]);
  applyI18n();
  if (EXPORT) markExport();
  const exp = $('#export-link');
  if (exp) exp.href = `/api/epics/${enc(id)}/export`;
  tlState.open = openFromHash();
  fillIcons();
  bindLang(async () => {
    setFull($('#map-frame')?.classList.contains('map-full') || false);
    if (EXPORT) markExport();
    await renderEpic(id);
  });
  bindMapTools();
  bindSearch();
  bindDocs();
  const sectionSettings = bindSectionSettings({ api, onError: alertBox, readOnly: Boolean(EXPORT) });
  await Promise.all([renderEpic(id), sectionSettings.reload().catch((err) => alertBox(err.message))]);
  $('#refresh-all').addEventListener('click', () => refreshModal(current));
  document.addEventListener('click', (e) => {
    const el = e.target;
    const info = el.closest('[data-info]');
    if (info) {
      e.stopPropagation();
      const pop = $('#popover');
      if (!pop.hidden && pop.dataset.anchor === info.dataset.info) hidePopover();
      else showPopover(info, taskInfo(current, info.dataset.info));
      return;
    }
    if (el.closest('.pop-close') || !el.closest('#popover')) hidePopover();
    if (el.closest('[data-refresh-start]')) return void runRefresh(id, $('#refresh-modal'));
    if (el.closest('[data-modal-close]') || el.classList.contains('modal-backdrop')) return closeModals();
    const jumpTask = el.closest('[data-jump-task]');
    if (jumpTask) return jumpToTask(jumpTask.dataset.jumpTask, jumpTask.dataset.jumpStep);
    const jumpSid = el.closest('[data-jump-sid]');
    if (jumpSid) return flash(jumpSid.dataset.jumpSid);
    const stepNode = el.closest('[data-step]');
    // A pan ends with a click on whatever is under the pointer; that click must not select a step.
    if (stepNode && Date.now() - Number($('#tl-scroll')?.dataset.dragEnd || 0) > 200) return void selectStep(stepNode.dataset.step);
    if (stepNode) return;
    if (el.closest('[data-docs-all]')) {
      tlState.allDocs = !tlState.allDocs;
      return void renderMapArea(current);
    }
    const openCard = el.closest('[data-open]');
    if (openCard) toggleDetail(openCard.dataset.open);
    const done = el.closest('[data-done]');
    if (done) return confirmModal(current, done.dataset.done);
    const confirm = el.closest('[data-confirm]');
    if (confirm) {
      const modal = $('#confirm-modal');
      const checked = [...modal.querySelectorAll('[data-check]:checked')].map((b) => b.dataset.check);
      const resolution = modal.querySelector('#confirm-resolution').value.trim() || undefined;
      return void withButton(confirm, async () => {
        await api(`/api/epics/${enc(id)}/waiting/${enc(confirm.dataset.confirm)}/done`, { method: 'POST', body: { checked, resolution } });
        modal.hidden = true;
        await renderEpic(id);
      });
    }
    const undo = el.closest('[data-undo]');
    if (undo) withButton(undo, async () => {
      await api(`/api/epics/${enc(id)}/waiting/${enc(undo.dataset.undo)}/undo`, { method: 'POST', body: {} });
      await renderEpic(id);
    });
    const refresh = el.closest('[data-refresh]');
    if (refresh) withButton(refresh, async () => {
      await api(`/api/epics/${enc(id)}/refresh`, { method: 'POST', body: { scope: 'branch', branch: refresh.dataset.refresh } });
      await renderEpic(id);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hidePopover();
      closeModals();
    }
    const card = e.target.closest?.('[data-open]');
    if (card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggleDetail(card.dataset.open);
    }
  });
  if (!EXPORT) setInterval(async () => {
    await sectionSettings.reload().catch(() => {});
    try {
      const { updatedAt } = await api(`/api/epics/${enc(id)}/rev`);
      if (current && updatedAt !== current.updatedAt && !$('#confirm-modal:not([hidden])')) await renderEpic(id);
    } catch {}
  }, 10000);
}

async function bootIndex() {
  applyI18n();
  fillIcons();
  bindLang(renderIndex);
  $('#q')?.addEventListener('input', renderEpicList);
  await renderIndex();
}

if (EXPORT || location.pathname.startsWith('/e/')) bootEpic().catch((e) => alertBox(e.message));
else bootIndex().catch((e) => alertBox(e.message));
