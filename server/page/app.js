import { buildLanes, layoutMap, buildOverview, sideStack, cycleSide, defaultOpen, defaultStep, MERGE_ID, GOAL_ID } from './lanes.mjs';
import { icon, STATE_ICON, agentBadge, logo } from './icons.mjs';
import { describeEvent, historyEntries } from './history.mjs';
import { renderMarkdown } from './markdown.mjs';
import { t, getLang, setLang, locale } from './i18n.mjs';
import { bindSectionSettings } from './section-settings.mjs';
import { DecisionDrafts, renderWaitingCard, waitingCounts, waitingSearchText } from './waiting.mjs';
import { paginate, renderPagination } from './pagination.mjs';
import { createDocEditor } from './doc-editor.mjs';
import { linkPollState, renderStepLinks, renderLinkBadge, renderRelatedEpics, renderLinkStatus, updateLinksDom, indexRevision } from './links.mjs';
import { bindShell } from './shell.mjs';

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
  if (path === '/api/settings') return { rev: 0, values: EXPORT.settings || {} };
  if (/\/history/.test(path)) {
    const limit = new URLSearchParams(path.split('?')[1]).get('limit');
    return limit === 'all' ? EXPORT.history : EXPORT.history.slice(0, Number(limit) || 20);
  }
  if (/\/docs-text$/.test(path)) return EXPORT.docs || [];
  if (/\/links$/.test(path)) return EXPORT.links;
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
  if (!res.ok) {
    const error = new Error(data.detail || data.error || res.statusText);
    error.status = res.status;
    throw error;
  }
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
let dashboard = null;
let pinnedEpics = new Set();
let settingsRev = 0;
let savingPin = false;
let indexLinksState = null;
let indexPolling = false;
let indexSort = 'created';

function bindIndexSort() {
  const select = $('#epic-sort');
  const restore = () => {
    const params = typeof URLSearchParams === 'function' ? new URLSearchParams(location.search || '') : null;
    indexSort = params?.get('sort') === 'updated' ? 'updated' : 'created';
    if (select) select.value = indexSort;
  };
  restore();
  select?.addEventListener('change', () => {
    indexSort = select.value === 'updated' ? 'updated' : 'created';
    const params = new URLSearchParams(location.search || '');
    if (indexSort === 'updated') params.set('sort', 'updated');
    else params.delete('sort');
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash || ''}`);
    renderEpicList();
  });
}

function replaceEpicCards(html) {
  const root = $('#epics');
  if (root.innerHTML === html) return;
  const controls = [...root.querySelectorAll('a[href], [data-pin]')];
  const active = controls.includes(document.activeElement) ? document.activeElement : null;
  const pin = active?.dataset.pin;
  const href = active?.getAttribute?.('href');
  const owner = active?.closest?.('[data-epic-card]')?.dataset.epicCard;
  root.innerHTML = html;
  if (active) [...root.querySelectorAll('a[href], [data-pin]')].find((control) => pin ? control.dataset.pin === pin : control.getAttribute?.('href') === href && control.closest?.('[data-epic-card]')?.dataset.epicCard === owner)?.focus({ preventScroll: true });
}

function renderEpicList() {
  if (indexLinksState?.stale && !indexLinksState.data && !allEpics.length) {
    replaceEpicCards(`<p class="muted">${esc(t('links.indexUnavailable'))}</p>`);
    return;
  }
  const q = ($('#q')?.value || '').trim().toLowerCase();
  const found = allEpics.filter((e) => !q || [e.id, e.title, e.goal].some((v) => String(v ?? '').toLowerCase().includes(q)));
  if (!found.length) {
    replaceEpicCards(`<p class="muted">${allEpics.length ? esc(t('index.none')) : t('index.empty')}</p>`);
    return;
  }
  const dateField = indexSort === 'updated' ? 'updatedAt' : 'createdAt';
  const sorted = [...found].sort((a, b) => String(b[dateField] || '').localeCompare(String(a[dateField] || '')));
  const pinned = sorted.filter((e) => pinnedEpics.has(e.id));
  const groups = new Map();
  for (const e of sorted) {
    if (pinnedEpics.has(e.id)) continue;
    const label = dayLabel(e[dateField]);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(e);
  }
  const sections = pinned.length ? [[t('index.pinned'), pinned], ...groups] : [...groups];
  replaceEpicCards(sections.map(([label, list]) => `<section class="day"><h2 class="day-head">${esc(label)}</h2><ul class="cards">${list.map(epicCard).join('')}</ul></section>`).join(''));
}

// Keep the pin button outside the link so toggling it never opens the epic.
function epicCard(e) {
  const pinned = pinnedEpics.has(e.id);
  const pinLabel = esc(t(pinned ? 'index.unpin' : 'index.pin', { title: e.title }));
  const waiting = e.waiting
    ? `<span class="warn">${icon('clock')}${esc(t('index.waiting', { n: e.waiting }))}</span>`
    : `<span class="muted">${icon('check')}${esc(t('index.nothing'))}</span>`;
  return `<li data-epic-card="${esc(e.id)}"><a href="/e/${enc(e.id)}" class="epic-link"><strong><span class="mono muted">${esc(e.id)}</span> · ${esc(e.title)}</strong><span class="muted">${esc(e.goal)}</span><span class="meta">${waiting}<span class="muted">${icon('list')}${esc(t('index.tasks', { n: e.tasks ?? 0 }))}</span><span class="muted">${icon('branch')}${esc(t('index.branches', { n: e.branches ?? 0 }))}</span><span class="muted">${icon('refresh')}${phrase('index.updated', { t: agoText(e.updatedAt) })}</span></span></a>${renderRelatedEpics(e.relatedEpics, { incomplete: e.incomplete })}<button type="button" class="icon-btn epic-pin" data-pin="${esc(e.id)}" aria-pressed="${pinned}" aria-label="${pinLabel}" title="${pinLabel}"${savingPin ? ' disabled' : ''}>${icon('pin')}</button></li>`;
}

const asDashboard = (value) => (value?.epics && value?.connectors && value?.feed ? value : null);

function sparkline(values, { width = 96, height = 22 } = {}) {
  if (!values?.length) return '';
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
  return `<svg class="stat-spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function dashboardTiles(d) {
  const silent = d.connectors.silent || [];
  return [
    { icon: 'board', label: 'dash.epics', value: d.epics.total, meta: t('dash.epicsMeta', { total: d.epics.total, pinned: d.epics.pinned }), href: d.epics.href },
    { icon: 'list', label: 'dash.tasks', value: d.tasks.inWork, meta: t('dash.tasksMeta', { blocked: d.tasks.blocked, waiting: d.tasks.waiting }), href: d.tasks.href, warn: d.tasks.blocked > 0 },
    { icon: 'clock', label: 'dash.waiting', value: d.waiting.open, meta: d.waiting.oldestDays === null ? '' : t('dash.waitingMeta', { n: d.waiting.oldestDays }), href: d.waiting.href, warn: d.waiting.open > 0 },
    { icon: 'branch', label: 'dash.mr', value: d.mr.open, meta: t('dash.mrMeta', { n: d.mr.red }), href: d.mr.href, warn: d.mr.red > 0 },
    { icon: 'inbox', label: 'dash.feed', value: d.feed.unmarked, meta: d.feed.fire ? `🔥${d.feed.fire}` : '', spark: d.feed.spark, href: d.feed.href, warn: d.feed.fire > 0 },
    { icon: 'link', label: 'dash.connectors', value: d.connectors.active, meta: silent.length ? t('dash.connectorsSilent', { n: silent.length }) : t('dash.connectorsOk'), title: silent.join(', '), href: d.connectors.href, warn: silent.length > 0 },
  ].map((tile) => {
    const body = `<span class="stat-label">${icon(tile.icon)}${esc(t(tile.label))}</span><span class="stat-value">${tile.value}${tile.spark ? sparkline(tile.spark) : ''}</span><span class="stat-meta">${esc(tile.meta || '')}</span>`;
    const attrs = `class="stat${tile.warn ? ' is-warn' : ''}"${tile.title ? ` title="${esc(tile.title)}"` : ''}`;
    return tile.href ? `<a ${attrs} href="${tile.href}">${body}</a>` : `<div ${attrs}>${body}</div>`;
  }).join('');
}

function renderIndexContent() {
  const sum = (k) => allEpics.reduce((n, e) => n + (e[k] || 0), 0);
  $('#stats').classList?.toggle?.('dash', Boolean(dashboard));
  if (dashboard) {
    $('#stats').innerHTML = dashboardTiles(dashboard);
    renderEpicList();
    renderIndexLinksStatus();
    return;
  }
  $('#stats').innerHTML = [
    ['board', 'stat.epics', allEpics.length, '/'],
    ['list', 'stat.tasks', sum('tasks'), '/tasks'],
    ['branch', 'stat.branches', sum('branches'), ''],
    ['clock', 'stat.waiting', sum('waiting'), '/tasks?waiting=1'],
  ].map(([i, label, n, href]) => {
    const body = `<span class="stat-label">${icon(i)}${esc(t(label))}</span><span class="stat-value">${n}</span>`;
    return href ? `<a class="stat" href="${href}">${body}</a>` : `<div class="stat">${body}</div>`;
  }).join('');
  renderEpicList();
  renderIndexLinksStatus();
}

async function renderIndex() {
  const [epics, settings, dash] = await Promise.allSettled([api('/api/epics'), api('/api/settings'), EXPORT ? Promise.reject() : api('/api/dashboard')]);
  dashboard = dash.status === 'fulfilled' ? asDashboard(dash.value) : null;
  if (settings.status === 'fulfilled') {
    settingsRev = Number.isInteger(settings.value.rev) ? settings.value.rev : 0;
    pinnedEpics = new Set(settings.value.values?.['epic.pinned'] || settings.value.pinnedEpics || []);
  }
  if (epics.status === 'fulfilled') acceptIndex(epics.value);
  else indexLinksState = linkPollState(indexLinksState, null, true);
  renderIndexContent();
}

function acceptIndex(epics) {
  const snapshot = { revision: indexRevision(epics), readAt: epics.find((epic) => epic.readAt)?.readAt || new Date().toISOString() };
  indexLinksState = linkPollState(indexLinksState, snapshot);
  allEpics = epics;
}

function renderIndexLinksStatus() {
  let status = $('#index-links-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'index-links-status';
    $('#stats')?.after?.(status);
  }
  status.innerHTML = renderLinkStatus(indexLinksState, { index: true });
}

async function pollIndex() {
  if (indexPolling || savingPin) return;
  indexPolling = true;
  try {
    const revision = indexLinksState?.data?.revision;
    acceptIndex(await api('/api/epics'));
    // Feed and MR facts change without touching the epic list, so the tiles are compared on their own.
    const nextDash = asDashboard(await api('/api/dashboard').catch(() => dashboard));
    const dashChanged = JSON.stringify(nextDash) !== JSON.stringify(dashboard);
    dashboard = nextDash;
    if (revision !== indexLinksState.data.revision) renderIndexContent();
    else if (dashChanged && dashboard) $('#stats').innerHTML = dashboardTiles(dashboard);
  } catch {
    indexLinksState = linkPollState(indexLinksState, null, true);
  } finally {
    indexPolling = false;
    renderIndexLinksStatus();
  }
}

function bindEpicPins() {
  $('#epics').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-pin]');
    if (!button || savingPin) return;
    const hadFocus = document.activeElement === button;
    const id = button.dataset.pin;
    const next = new Set(pinnedEpics);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    savingPin = true;
    for (const pin of $('#epics').querySelectorAll('[data-pin]')) pin.disabled = true;
    try {
      const settings = await api('/api/settings', { method: 'PUT', body: { rev: settingsRev, patch: { 'epic.pinned': [...next] } } });
      settingsRev = settings.rev;
      pinnedEpics = new Set(settings.values['epic.pinned']);
    } catch (e) {
      alertBox(e.message);
    } finally {
      const restoreFocus = hadFocus && (document.activeElement === button || document.activeElement === document.body);
      savingPin = false;
      for (const pin of $('#epics').querySelectorAll('[data-pin]')) pin.disabled = false;
      renderEpicList();
      if (restoreFocus) [...$('#epics').querySelectorAll('[data-pin]')].find((pin) => pin.dataset.pin === id)?.focus({ preventScroll: true });
    }
  });
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
let linksState = null;
let linksPolling = false;
const pageSizes = { waiting: 5, decisions: 5, history: 5 };
const sectionPages = { waiting: 1, decisions: 1, history: 1 };
const waitingExpansion = new Map();
let savingPageSizes = false;

const stateText = (state) => t(`state.${state}`);
const stateIcon = (state) => icon(STATE_ICON[state] || 'circle', `st-${state}`);

// ---------- Overview: one card per task ----------

const OV = { w: 280, h: 160, gapX: 188, gapY: 44, pad: 14 };
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

function renderSideStack(side, open) {
  const { front, back } = sideStack(side, tlState.side, open);
  if (!front) return '';
  tlState.side = front.id;
  const cards = [front, ...back].map((n, i) => {
    const selected = open === n.id;
    const body = `${cardBody(n)}<span class="side-action">${icon(selected ? 'check' : 'arrowRight')}${esc(t(selected ? 'map.stepsOpen' : 'map.openSteps'))}</span>`;
    const card = i === 0
      ? `<button type="button" class="ov-card k-task ${cardState(n)}${selected ? ' selected' : ''}" data-open="${esc(n.id)}" aria-expanded="${selected}" aria-controls="detail">${body}</button><button type="button" class="icon-btn info-btn ov-info" data-info="${esc(n.id)}" aria-label="${esc(t('task.more', { id: n.id }))}">${icon('info')}</button>`
      : `<div class="ov-card k-task ${cardState(n)}" aria-hidden="true">${body}</div><button type="button" class="side-pick" data-side-pick="${esc(n.id)}" aria-label="${esc(t('map.showTask', { id: n.id }))}: ${esc(n.fullTitle)}" title="${esc(n.fullTitle)}"></button>`;
    return `<div class="side-layer${i === 0 ? ' side-current' : ''}" data-side-id="${esc(n.id)}" style="--depth:${Math.min(i, 2)}"${i > 2 ? ' hidden' : ''}>${card}</div>`;
  }).join('');
  const position = side.findIndex((n) => n.id === front.id) + 1;
  const controls = side.length > 1 ? `<div class="side-controls"><button type="button" class="icon-btn" data-side-turn="-1" aria-label="${esc(t('map.previousTask'))}" title="${esc(t('map.previousTask'))}">${icon('arrowUp')}</button><span class="mono" role="status" aria-live="polite">${esc(t('map.sidePosition', { n: position, total: side.length }))}</span><button type="button" class="icon-btn" data-side-turn="1" aria-label="${esc(t('map.nextTask'))}" title="${esc(t('map.nextTask'))}">${icon('arrowDown')}</button></div>` : '';
  return `<section class="overview-side" aria-label="${esc(t('map.side'))}"><h3 class="ov-section-title">${icon('layers')}<span>${esc(t('map.side'))}</span><span class="mono">${side.length}</span></h3>
    <div class="side-carousel" role="group" aria-roledescription="${esc(t('map.carousel'))}" aria-label="${esc(t('map.side'))}"><div class="side-deck${back.length ? '' : ' side-single'}">${cards}</div>${controls}</div>
  </section>`;
}

async function rotateSide(direction, target) {
  if (tlState.sideBusy) return;
  const side = buildOverview(current).side;
  for (const n of side) n.docs = (current.docs || []).filter((d) => d.task === n.id).length;
  const next = target || cycleSide(side, tlState.side, direction);
  if (!next || next === tlState.side) return;
  const deck = $('.side-deck');
  const cards = [...deck.querySelectorAll('[data-side-id]')];
  const outgoing = cards.find((el) => el.dataset.sideId === tlState.side);
  const incoming = cards.find((el) => el.dataset.sideId === next);
  const active = document.activeElement;
  const focus = active.closest('.side-carousel') ? active.dataset.sideTurn || 'front' : null;
  tlState.sideBusy = true;
  deck.setAttribute('aria-busy', 'true');
  try {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      incoming.hidden = false;
      incoming.style.zIndex = direction < 0 ? '5' : '3';
      outgoing.style.zIndex = direction < 0 ? '4' : '5';
      const full = { transform: 'translateY(0) scale(1)', opacity: 1 };
      const behind = { transform: 'translateY(-22px) scale(.96)', opacity: 1 };
      const below = { transform: 'translateY(190px) scale(.94)', opacity: 0 };
      const options = { duration: 300, easing: 'cubic-bezier(.22,.68,.3,1)', fill: 'forwards' };
      await Promise.all([
        outgoing.animate([full, direction < 0 ? behind : below], options).finished.catch(() => {}),
        incoming.animate([direction < 0 ? below : { transform: getComputedStyle(incoming).transform, opacity: 1 }, full], options).finished.catch(() => {}),
      ]);
    }
    if (!deck.isConnected) return;
    if (target) toggleDetail(next);
    else {
      tlState.side = next;
      deck.closest('.overview-side').outerHTML = renderSideStack(side, tlState.open || defaultOpen(buildLanes(current)));
    }
    if (focus === 'front') $('.side-current [data-open]')?.focus({ preventScroll: true });
    else if (focus) $(`[data-side-turn="${focus}"]`)?.focus({ preventScroll: true });
  } finally {
    tlState.sideBusy = false;
    deck.removeAttribute('aria-busy');
  }
}

function bindSideCarousel() {
  let lastWheel = 0;
  let wheelAmount = 0;
  let wheelUsed = false;
  document.addEventListener('wheel', (e) => {
    const carousel = e.target.closest('.side-carousel');
    if (!carousel?.querySelector('[data-side-turn]') || e.ctrlKey || e.metaKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheel > 180) { wheelAmount = 0; wheelUsed = false; }
    lastWheel = now;
    if (wheelUsed) return;
    wheelAmount += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 200 : 1);
    if (Math.abs(wheelAmount) < 40) return;
    wheelUsed = true;
    void rotateSide(wheelAmount > 0 ? 1 : -1);
  }, { passive: false });
}

// Quarter-circle corners. The stroke leaves the card sideways, then turns up in the gap.
function roundedSkip(xLeave, yLeave, xTip, yTip, arch) {
  const dir = xTip >= xLeave ? 1 : -1;
  const yOut = yLeave - 36;
  const roomX = Math.abs(xTip - xLeave);
  const roomY = Math.min(yOut - arch, yTip - arch);
  const R = Math.max(12, Math.min(36, roomX / 5, (roomY - 8) / 2));
  const k = R * 0.5523;
  const n = (v) => Math.round(v * 10) / 10;
  const xRise = xLeave + dir * R;
  const xDrop = xTip - dir * R;
  const yRise = yOut - R;
  const yDrop = yTip - R;
  const leave = `M${n(xLeave)},${n(yOut)} C${n(xLeave + dir * k)},${n(yOut)} ${n(xRise)},${n(yRise + k)} ${n(xRise)},${n(yRise)}`;
  const arrive = `C${n(xDrop)},${n(yDrop + k)} ${n(xTip - dir * k)},${n(yTip)} ${n(xTip)},${n(yTip)}`;
  // A short hop has no room for a flat crest; one curve clears the gap.
  if (roomX < 260) {
    const yCrest = Math.min(yRise, yDrop, arch) - 18;
    return `${leave} C${n(xRise)},${n(yCrest)} ${n(xDrop)},${n(yCrest)} ${n(xDrop)},${n(yDrop)} ${arrive}`;
  }
  const xLane = xLeave + dir * 2 * R;
  const xLaneEnd = xTip - dir * 2 * R;
  const yTop = arch + R;
  return `${leave} V${n(yTop)} C${n(xRise)},${n(yTop - k)} ${n(xLane - dir * k)},${n(arch)} ${n(xLane)},${n(arch)} H${n(xLaneEnd)} C${n(xLaneEnd + dir * k)},${n(arch)} ${n(xDrop)},${n(arch + k)} ${n(xDrop)},${n(yTop)} V${n(yDrop)} ${arrive}`;
}

// Arrows are drawn between whole tasks; the step-level links live in the opened task.
function renderOverview(ov, open) {
  const at = new Map(ov.nodes.map((n) => [n.id, n]));
  const drawn = ov.edges.filter((e) => at.has(e.from) && at.has(e.to));
  const routed = drawn.map((e) => {
    const a = at.get(e.from);
    const b = at.get(e.to);
    const span = b.col - a.col;
    if (span === 1) return { e, a, b, span };
    // Verticals stay in the column gap. The arrow still arrives on the facing side.
    const xUp = span > 1 ? ovX(a.col) + OV.w + 2 : ovX(a.col) - 2;
    const tip = span > 1 ? ovX(b.col) - 2 : ovX(b.col) + OV.w;
    return { e, a, b, span, xUp, tip, x0: Math.min(xUp, tip), x1: Math.max(xUp, tip) };
  });
  const skips = routed.filter((r) => r.span !== 1).sort((p, q) => p.x0 - q.x0 || p.x1 - q.x1);
  const lanes = [];
  for (const skip of skips) {
    const lane = lanes.find((taken) => taken.every(([from, to]) => skip.x1 < from - 28 || skip.x0 > to + 28));
    if (lane) lane.push([skip.x0, skip.x1]);
    else lanes.push([[skip.x0, skip.x1]]);
    skip.slot = lane ? lanes.indexOf(lane) : lanes.length - 1;
  }
  // A bezier between card centers still crosses the cards in between, so skips use the gutter.
  const laneGap = 22;
  const corner = 36;
  const aboveCard = corner + 8;
  const topRoom = 12;
  const gutter = lanes.length ? topRoom + aboveCard + (lanes.length - 1) * laneGap - OV.pad : 0;
  const yOf = (row) => OV.pad + gutter + row * (OV.h + OV.gapY);
  const width = OV.pad * 2 + ov.cols * OV.w + (ov.cols - 1) * OV.gapX;
  const height = OV.pad * 2 + gutter + ov.rows * OV.h + (ov.rows - 1) * OV.gapY;
  const archOf = (slot) => yOf(0) - aboveCard - slot * laneGap;
  const hot = new Set();
  if (open) {
    for (const edge of drawn) {
      if (edge.from === open || edge.to === open) {
        hot.add(edge.from);
        hot.add(edge.to);
      }
    }
  }
  const captionFor = (labels, x, y, on) => {
    const text = labels.join(', ');
    return `<foreignObject x="${x}" y="${y}" width="${OV.gapX - 24}" height="46"><div xmlns="http://www.w3.org/1999/xhtml" class="ov-edge-label${on ? ' lit' : ''}">${esc(text)}</div></foreignObject>`;
  };
  const edges = routed.map((r) => {
    const y1 = yOf(r.a.row) + OV.h / 2;
    const y2 = yOf(r.b.row) + OV.h / 2;
    const on = Boolean(open) && (r.e.from === open || r.e.to === open);
    let d;
    let caption = '';
    if (r.span === 1) {
      const x1 = ovX(r.a.col) + OV.w;
      const x2 = ovX(r.b.col);
      const bend = Math.max(20, (x2 - x1) / 2);
      d = y1 === y2 ? `M${x1},${y1} L${x2 - 2},${y2}` : `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2 - 2},${y2}`;
      // The caption sits under the stroke and inside the gap, so it cannot cover either card.
      if (r.e.labels.length) caption = captionFor(r.e.labels, x1 + 12, Math.min(y1, y2) + 8, on);
    } else {
      const arch = archOf(r.slot);
      // Land above the neighbour arrow so the two strokes do not share the gap.
      const approach = y2 - 36;
      d = roundedSkip(r.xUp, y1, r.tip, approach, arch);
    }
    const tip = r.e.labels.length ? `<title>${esc(r.e.labels.join(', '))}</title>` : '';
    return `<path class="tl-edge${r.e.labels.length ? ' cross' : ''}${on ? ' lit' : ''}" d="${d}" marker-end="url(#${on ? 'ov-arrow-lit' : 'ov-arrow'})">${tip}</path>${caption}`;
  }).join('');
  const cards = ov.nodes.map((n) => {
    const picked = open === n.id;
    const attrs = n.kind === 'goal' ? '' : ` role="button" tabindex="0" data-open="${esc(n.id)}" aria-expanded="${picked}"`;
    const info = n.kind === 'task' ? `<button type="button" class="icon-btn info-btn ov-info" data-info="${esc(n.id)}" aria-label="${esc(t('task.more', { id: n.id }))}">${icon('info')}</button>` : '';
    const mark = picked ? ' picked' : hot.has(n.id) ? ' lit' : '';
    return `<foreignObject class="ov-node${mark}" x="${ovX(n.col)}" y="${yOf(n.row)}" width="${OV.w}" height="${OV.h}"><div xmlns="http://www.w3.org/1999/xhtml" class="ov-card k-${n.kind} ${cardState(n)}${picked ? ' selected' : ''}${hot.has(n.id) && !picked ? ' lit' : ''}"${attrs}>${info}${cardBody(n)}</div></foreignObject>`;
  }).join('');
  const chainTitle = ov.side.length ? `<h3 class="ov-section-title">${esc(t('map.chain'))}</h3>` : '';
  const canLocate = [...ov.nodes, ...ov.side].some((n) => n.kind === 'task' && (n.current.length || n.id === open));
  return `<div class="overview${ov.side.length ? ' has-side' : ''}${mapHeightClass()}"><section class="overview-main"${ov.side.length ? ` aria-label="${esc(t('map.chain'))}"` : ''}><div class="ov-head">${chainTitle}${mapHeightControl(Boolean(ov.side.length))}${mapZoomControl()}${mapLocateControl(canLocate)}</div><div class="ov-scroll"><svg class="ov-svg" viewBox="0 0 ${width} ${height}" data-w="${width}" data-h="${height}" style="max-width:${width}px">
    <defs><marker id="ov-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="tl-arrowhead"/></marker><marker id="ov-arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="tl-arrowhead hot"/></marker></defs>
    ${edges}${cards}</svg></div></section>${renderSideStack(ov.side, open)}</div>`;
}

// ---------- Detail: the steps of one task ----------

function crossLinkBadge(task, step) {
  return `<span data-cross-link-badge data-task="${esc(task)}" data-step="${esc(step)}">${renderLinkBadge(linksState, current?.id, task, step)}</span>`;
}

function stepChip(step, task) {
  const tip = [stateText(step.state), step.title, step.note].filter(Boolean).join(' — ');
  return `<li class="step ${esc(step.state)}" title="${esc(tip)}"><span class="step-title">${stateIcon(step.state)}${esc(step.title)}</span>${task ? crossLinkBadge(task, step.id) : ''}</li>`;
}

function narrowFlow(steps, task) {
  return `<ol class="flow">${steps.map((step) => stepChip(step, task)).join('') || `<li class="muted">${esc(t('step.none'))}</li>`}</ol>`;
}

const TL = { colW: 200, nodeW: 168, nodeH: 84, rowH: 100, pad: 24 };
const tlState = { focused: null, focusedStep: null, open: null, step: null, allDocs: false, side: null, sideBusy: false, mapScale: 1 };

function nodeX(col) { return TL.pad + col * TL.colW; }
function rowY(i) { return i * TL.rowH + (TL.rowH - TL.nodeH) / 2; }

function timelineSize(layout) {
  return {
    width: TL.pad * 2 + layout.cols * TL.colW - (TL.colW - TL.nodeW),
    height: layout.rows.length * TL.rowH,
  };
}

// The steps are drawn from data: columns come from layoutMap, so a new step needs no drawing.
function renderTimeline(layout) {
  const { width, height } = timelineSize(layout);
  const edges = layout.edges.map((e) => {
    const x1 = nodeX(e.from.col) + TL.nodeW;
    const x2 = nodeX(e.to.col);
    const y = rowY(0) + TL.nodeH / 2;
    return `<path class="tl-edge" d="M${x1},${y} L${x2 - 2},${y}" marker-end="url(#tl-arrow)"/>`;
  }).join('');
  const nodes = layout.rows.map((r, i) => r.cells.map((c) => {
    const tip = [stateText(c.state), c.title, c.note, c.branch].filter(Boolean).join(' — ');
    const n = r.kind === 'merge' ? `<span class="n">${c.n}</span>` : '';
    const docCount = (current?.docs || []).filter((d) => d.task === r.id && d.step === c.id).length;
    const badge = docCount ? `<span class="tl-docs" title="${esc(t('step.docCount', { n: docCount }))}">${icon('file')}${docCount}</span>` : '';
    return `<foreignObject x="${nodeX(c.col)}" y="${rowY(i)}" width="${TL.nodeW}" height="${TL.nodeH}"><div xmlns="http://www.w3.org/1999/xhtml" class="tl-node ${esc(c.state)}${docCount ? ' has-docs' : ''}${r.kind === 'lane' && c.id === tlState.step ? ' selected' : ''}"${r.kind === 'lane' ? ` data-step="${esc(c.id)}"` : ''} data-sid="st-${esc(r.id)}-${esc(c.id)}" title="${esc(tip)}"><span class="tl-title">${stateIcon(c.state)}${n}${esc(c.title)}</span>${r.kind === 'lane' ? crossLinkBadge(r.id, c.id) : ''}${badge}</div></foreignObject>`;
  }).join('')).join('');
  return `<div class="tl" id="tl"><div class="tl-scroll" id="tl-scroll"><svg class="tl-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <defs><marker id="tl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="tl-arrowhead"/></marker></defs>
      ${edges}${nodes}</svg></div></div>`;
}

// One row only: other lanes are left out, so cross-task links become the lists beside the steps.
function detailLayout(map, open) {
  const single = open === MERGE_ID
    ? { lanes: [], merge: map.merge, goal: map.goal, here: [] }
    : { lanes: [...map.lanes, ...map.side].filter((l) => l.id === open), merge: [], goal: map.goal, here: [] };
  const full = layoutMap(single);
  const rows = full.rows.filter((r) => r.kind !== 'goal');
  const cols = Math.max(0, ...rows.flatMap((r) => r.cells.map((c) => c.col + 1)));
  return { rows, cols, edges: full.edges.filter((e) => e.from.row === e.to.row && e.to.row !== GOAL_ID), focus: full.focus };
}

function linksOf(map, open) {
  if (open === MERGE_ID) {
    const branches = new Set(map.merge.map((m) => m.branch).filter(Boolean));
    const incoming = map.lanes.filter((l) => l.branches.some((b) => branches.has(b))).map((l) => `<li>${icon('branch')}<span>${esc(l.id)} · ${esc(l.title)}</span></li>`);
    return { incoming, outgoing: [`<li>${icon('flag')}<span>${esc(map.goal)}</span></li>`] };
  }
  const lanes = [...map.lanes, ...map.side];
  const lane = lanes.find((l) => l.id === open);
  const incoming = lane.steps.flatMap((s) => s.deps.map((d) => `<li>${icon('dep')}<span><b>${esc(d.task)} · ${esc(d.title)}</b> ${icon('arrowRight', 'inl')}${esc(s.title)}${d.label ? ` <em>${esc(d.label)}</em>` : ''}</span></li>`));
  const outgoing = lanes.filter((l) => l.id !== open).flatMap((l) => l.steps.flatMap((s) => s.deps.filter((d) => d.task === open).map((d) => `<li>${icon('arrowRight')}<span>${esc(d.title)} ${icon('arrowRight', 'inl')}<b>${esc(l.id)} · ${esc(s.title)}</b>${d.label ? ` <em>${esc(d.label)}</em>` : ''}</span></li>`)));
  const mergeBranches = new Set(map.merge.map((m) => m.branch).filter(Boolean));
  if (lane.branches.some((b) => mergeBranches.has(b))) outgoing.push(`<li>${icon('merge')}<span>${esc(t('detail.toMerge'))}</span></li>`);
  return { incoming, outgoing };
}

function renderDetail(map, open) {
  const lane = open === MERGE_ID ? null : [...map.lanes, ...map.side].find((l) => l.id === open);
  if (lane && (!tlState.step || !lane.steps.some((st) => st.id === tlState.step))) tlState.step = defaultStep(lane);
  const raw = lane ? (current?.tasks || []).find((x) => x.id === lane.id) : null;
  const title = lane ? `<span class="mono muted">${esc(lane.id)}</span> ${esc(lane.fullTitle)}` : `${icon('merge')} ${esc(t('card.merge'))}`;
  const heading = `<h3>${title}</h3>`;
  const { incoming, outgoing } = linksOf(map, open);
  const list = (items, empty) => (items.length ? `<ul class="links">${items.join('')}</ul>` : `<p class="muted">${esc(empty)}</p>`);
  const links = `<div class="detail-links"><div><h4>${esc(t('detail.dependsOn'))}</h4>${list(incoming, t('detail.noIn'))}</div><div><h4>${esc(t('detail.leadsTo'))}</h4>${list(outgoing, t('detail.noOut'))}</div></div>`;
  const steps = lane ? lane.steps : map.merge.map((m) => ({ id: `m${m.n}`, title: `${m.n}. ${m.text}`, state: m.waiting ? 'waiting' : 'todo', note: m.branch, deps: [] }));
  // Merge uses the same right-hand card as a task step (Depends on / Leads to), not a strip under the title.
  const below = lane
    ? stepSplit(lane, links)
    : `<div class="step-split"><div></div><div class="step-info">${links}</div></div>`;
  return `<section class="detail${lane ? '' : ' detail-merge'}" id="detail" aria-label="${esc(t('detail.aria'))}">
    <header class="detail-head">${heading}${lane?.status ? `<span class="chip">${esc(lane.status)}</span>` : ''}${raw?.url ? external(raw.url, raw.tracker || t('task.open')) : ''}</header>
    ${renderTimeline(detailLayout(map, open))}
    ${below}
    <div class="lanes-narrow">${narrowFlow(steps, lane?.id)}</div>
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

function stepInfo(lane, stepId, links) {
  const step = lane.steps.find((st) => st.id === stepId);
  if (!step) return `<div class="step-info"><p class="muted">${esc(t('step.none'))}</p>${links}</div>`;
  const raw = (current?.tasks || []).find((x) => x.id === lane.id)?.steps?.find((st) => st.id === stepId) || {};
  const prefix = `tasks[${lane.id}].steps[${stepId}]`;
  const changes = currentHistory.filter((h) => String(h.path).startsWith(prefix)).slice(0, 6).map((h) => {
    const d = describeEvent(h);
    const value = d.change === 'add' ? t('step.added') : `${cap(d.what)}: ${d.before ?? '—'} → ${d.after ?? '—'}`;
    return `<li><span class="muted">${agoTag(h.at)}</span><span>${esc(value)}</span></li>`;
  }).join('');
  return `<div class="step-info">
    <div class="step-info-head">${stateIcon(step.state)}<span class="chip">${esc(cap(stateText(step.state)))}</span><span class="mono muted">${esc(lane.id)}/${esc(step.id)}</span></div>
    <h4 class="step-info-title">${esc(step.title)}</h4>
    ${step.note ? `<p class="step-info-note">${esc(step.note)}</p>` : `<p class="muted">${esc(t('step.noDescription'))}</p>`}
    ${links}
    <section class="step-cross-links" data-cross-step-links data-task="${esc(lane.id)}" data-step="${esc(step.id)}">${renderStepLinks(linksState, current?.id, lane.id, step.id, { exported: Boolean(EXPORT) })}</section>
    ${raw.label ? `<dl class="step-info-meta"><dt>${esc(t('step.label'))}</dt><dd>${esc(raw.label)}</dd></dl>` : ''}
    ${changes ? `<h5>${esc(t('step.changes'))}</h5><ul class="step-changes">${changes}</ul>` : ''}
  </div>`;
}

function stepSplit(lane, links) {
  if (!tlState.step || !lane.steps.some((st) => st.id === tlState.step)) tlState.step = defaultStep(lane);
  return `<div class="step-split">${docsBlock(lane, tlState.step, tlState.allDocs)}${stepInfo(lane, tlState.step, links)}</div>`;
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

const docState = { id: null, text: '', draft: null, mtimeMs: 0, mode: 'view', dirty: false, ready: false, saving: false };
let docEditor = null;
let docRequest = 0;

function disposeDocEditor() {
  const editor = docEditor;
  docEditor = null;
  docState.ready = false;
  docState.saving = false;
  editor?.destroy();
}

function updateDocButtons() {
  const save = $('[data-doc-save]');
  if (save) save.disabled = !docState.ready || docState.saving || !docState.dirty;
  for (const selector of ['[data-doc-cancel]', '[data-doc-restore]']) {
    const control = $(selector);
    if (control) control.disabled = docState.saving;
  }
}

function setDocExtra(html) {
  const extra = $('#doc-extra');
  extra.innerHTML = html;
  extra.hidden = !html;
  updateDocButtons();
}

function docError(error) {
  setDocExtra(`<p class="doc-error" role="alert">${icon('alert')}${esc(error.message)} <button type="button" data-doc-reload>${icon('refresh')}${esc(t('doc.reload'))}</button></p>`);
}

function positionDocPanel(panel) {
  const bottom = $('.topbar')?.getBoundingClientRect().bottom || 0;
  panel.style.top = `${Math.max(0, Math.ceil(bottom)) + 8}px`;
}

function docPanel() {
  let panel = $('#doc-panel');
  if (!panel) {
    panel = document.createElement('aside');
    panel.id = 'doc-panel';
    panel.className = 'doc-panel';
    panel.hidden = true;
    document.body.appendChild(panel);
    const header = $('.topbar');
    if (header) new ResizeObserver(() => positionDocPanel(panel)).observe(header);
    window.addEventListener('resize', () => positionDocPanel(panel));
  }
  return panel;
}

function showDocPanel(panel) {
  if ($('#map-frame')?.classList.contains('map-full')) setFull(false);
  positionDocPanel(panel);
  panel.hidden = false;
}

function renderDocPanel(doc, extra = '') {
  disposeDocEditor();
  const panel = docPanel();
  const { html, toc } = renderMd(docState.text);
  const tocHtml = toc.length ? `<nav class="doc-toc"><h5>${esc(t('doc.toc'))}</h5>${toc.map((x) => `<a href="#${esc(x.id)}" class="lvl${x.level}" data-toc="${esc(x.id)}">${esc(x.text)}</a>`).join('')}</nav>` : '';
  const where = [doc.task, doc.step].filter(Boolean).join(' · ') || t('doc.wholeEpic');
  const head = `<header class="doc-head">
      <div class="doc-head-title"><span class="chip">${esc(kindText(doc.kind))}</span><h3>${esc(doc.title)}</h3></div>
      <div class="doc-actions">
        ${docState.mode === 'edit'
          ? `<button type="button" data-doc-save>${icon('save')}${esc(t('doc.save'))}</button><button type="button" data-doc-cancel>${esc(t('cancel'))}</button>`
          : `<button type="button" class="live-only" data-doc-edit>${icon('edit')}${esc(t('doc.edit'))}</button>`}
        <button type="button" class="live-only" data-doc-versions>${icon('versions')}${esc(t('doc.versions'))}</button>
        <button type="button" class="icon-btn" data-doc-close aria-label="${esc(t('close'))}">${icon('close')}</button>
      </div>
      <p class="doc-meta muted">${esc(where)} · ${esc(t(doc.owned ? 'doc.owned' : 'doc.linked'))} · <span class="mono">${esc(doc.path || '')}</span></p>
    </header><div class="doc-extra" id="doc-extra"${extra ? '' : ' hidden'}>${extra}</div>`;
  const body = docState.mode === 'edit'
    ? `<div class="doc-edit" id="doc-editor"></div>`
    : `<div class="doc-body">${tocHtml}<article class="md">${html}</article></div>`;
  panel.innerHTML = head + body;
  showDocPanel(panel);
  if (docState.mode === 'edit') {
    let editor;
    editor = createDocEditor({
      container: $('#doc-editor'), text: docState.draft ?? docState.text, lang: getLang(), title: t('doc.editor'),
      onChange(text) {
        if (docEditor !== editor) return;
        docState.draft = text;
        docState.dirty = text !== docState.text;
        updateDocButtons();
      },
      onSave: () => saveDoc(),
      onError(error) { if (docEditor === editor) docError(error); },
    });
    docEditor = editor;
    editor.ready.then(() => {
      if (docEditor !== editor) return;
      docState.ready = true;
      updateDocButtons();
    }).catch(() => {});
    updateDocButtons();
  }
}

async function openDoc(id, mode = EXPORT ? 'view' : 'edit') {
  const request = ++docRequest;
  const r = await api(`/api/epics/${enc(current.id)}/docs/${enc(id)}`);
  if (request !== docRequest) return;
  if (docState.mode === 'edit' && docState.dirty && !window.confirm(t('doc.unsavedClose'))) return;
  Object.assign(docState, { id, text: r.text, draft: r.text, mtimeMs: r.mtimeMs, mode, dirty: false, saving: false, doc: r.doc });
  renderDocPanel(r.doc);
}

function closeDoc() {
  docRequest++;
  if (docState.mode === 'edit' && docState.dirty && !window.confirm(t('doc.unsavedClose'))) return;
  disposeDocEditor();
  docPanel().hidden = true;
  docState.id = null;
}

async function saveDoc() {
  const editor = docEditor;
  const id = docState.id;
  if (!editor || docState.saving) return;
  docState.saving = true;
  updateDocButtons();
  try {
    const text = await editor.getMarkdown();
    if (docEditor !== editor || docState.id !== id || text === docState.text) return;
    const r = await api(`/api/epics/${enc(current.id)}/docs/${enc(id)}`, { method: 'PUT', body: { text, mtimeMs: docState.mtimeMs } });
    if (docEditor !== editor || docState.id !== id) return;
    Object.assign(docState, { text, mtimeMs: r.mtimeMs });
    const draft = await editor.getMarkdown();
    if (docEditor !== editor || docState.id !== id) return;
    Object.assign(docState, { draft, dirty: draft !== text });
    setDocExtra('');
  } catch (e) {
    if (docEditor === editor && docState.id === id) docError(e);
  } finally {
    if (docEditor === editor && docState.id === id) {
      docState.saving = false;
      updateDocButtons();
    }
  }
}

async function showVersions() {
  const id = docState.id;
  const list = await api(`/api/epics/${enc(current.id)}/docs/${enc(id)}/versions`);
  if (docState.id !== id) return;
  const rows = list.length
    ? list.map((v) => `<li><button type="button" data-doc-version="${esc(v.id)}">${icon('versions')}${esc(new Date(v.at).toLocaleString(locale()))}</button></li>`).join('')
    : `<li class="muted">${esc(t('doc.noVersions'))}</li>`;
  setDocExtra(`<div class="doc-versions"><h5>${esc(t('doc.versions'))}</h5><ul>${rows}</ul></div>`);
}

async function showVersion(versionId) {
  const id = docState.id;
  const { text } = await api(`/api/epics/${enc(current.id)}/docs/${enc(id)}/versions/${enc(versionId)}`);
  if (docState.id !== id) return;
  const { html } = renderMd(text);
  setDocExtra(`<div class="doc-versions"><h5>${esc(t('doc.versionOf', { t: versionId.slice(0, 16).replace('T', ' ') }))}</h5>
    <button type="button" data-doc-restore="${esc(versionId)}">${icon('undo')}${esc(t('doc.restore'))}</button><article class="md doc-version-view">${html}</article></div>`);
  docState.versionText = text;
}

function addDocForm(taskId) {
  docRequest++;
  if (docState.mode === 'edit' && docState.dirty && !window.confirm(t('doc.unsavedClose'))) return;
  disposeDocEditor();
  docState.id = null;
  docState.mode = 'view';
  docState.dirty = false;
  const map = buildLanes(current);
  const lane = [...map.lanes, ...map.side].find((l) => l.id === taskId);
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
  showDocPanel(panel);
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
      await openDoc(doc.id);
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
      docRequest++;
      docState.mode = 'edit';
      docState.draft = docState.text;
      return renderDocPanel(docState.doc);
    }
    if (el.closest('[data-doc-cancel]')) {
      docRequest++;
      if (docState.dirty && !window.confirm(t('doc.unsavedCancel'))) return;
      docState.mode = 'view';
      docState.dirty = false;
      docState.draft = docState.text;
      return renderDocPanel(docState.doc);
    }
    if (el.closest('[data-doc-save]')) return void saveDoc();
    if (el.closest('[data-doc-reload]')) return void openDoc(docState.id);
    if (el.closest('[data-doc-versions]')) return void showVersions().catch((err) => alertBox(err.message));
    const ver = el.closest('[data-doc-version]');
    if (ver) return void showVersion(ver.dataset.docVersion).catch((err) => alertBox(err.message));
    if (el.closest('[data-doc-restore]')) {
      docRequest++;
      if (docState.mode === 'edit' && docState.dirty && !window.confirm(t('doc.unsavedCancel'))) return;
      Object.assign(docState, { mode: 'edit', dirty: docState.versionText !== docState.text, draft: docState.versionText });
      return renderDocPanel(docState.doc);
    }
    const toc = el.closest('[data-toc]');
    if (toc) {
      e.preventDefault();
      document.getElementById(toc.dataset.toc)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
  // Full screen changes the width the chain fits into, so the same scale has to be measured again.
  fitLargeMap();
  globalThis.requestAnimationFrame?.(() => {
    applyOverviewScale();
    fitLargeMap();
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#map-frame')?.classList.contains('map-full')) setFull(false);
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && $('#map-frame')?.classList.contains('map-full')) setFull(false);
});

// 100% is a card at its drawn size. The block is only a window, so a long chain scrolls.
const MAP_SCALE_MIN = 0.5;
const MAP_SCALE_MAX = 2.5;

function clampMapScale(scale) {
  return Math.min(MAP_SCALE_MAX, Math.max(MAP_SCALE_MIN, scale));
}

function nextMapScale(scale, deltaY) {
  return clampMapScale(scale * Math.exp(-deltaY * 0.0014));
}

function formatMapScale(scale) {
  return `${Math.round(scale * 100)}%`;
}

let mapHeight = null;
let saveSettings = async () => {};

function mapHeightClass() {
  return mapHeight ? ` map-h-${mapHeight}` : '';
}

// Until a height is saved, the pressed mode matches the height the layout already uses.
function effectiveMapHeight(hasSide) {
  return mapHeight || (hasSide ? 'm' : 's');
}

function mapHeightControl(hasSide) {
  const current = effectiveMapHeight(hasSide);
  const button = (id) => `<button type="button" data-map-height="${id}" aria-pressed="${current === id}" title="${esc(t(`map.height.${id}Tip`))}">${esc(t(`map.height.${id}`))}</button>`;
  return `<div class="map-size" role="group" aria-label="${esc(t('map.height'))}">${['s', 'm', 'l'].map(button).join('')}</div>`;
}

function mapZoomControl() {
  const scale = tlState.mapScale || 1;
  const idle = Math.round(scale * 100) === 100;
  return `<div class="map-zoom" role="group" aria-label="${esc(t('map.zoom'))}"><span class="map-zoom-scale">${formatMapScale(scale)}</span><button type="button" data-map-zoom-reset${idle ? ' disabled' : ''}>${esc(t('map.reset'))}</button></div>`;
}

function mapLocateControl(canLocate) {
  return `<button type="button" class="icon-btn map-locate" data-map-locate aria-label="${esc(t('map.locate'))}" title="${esc(t('map.locate'))}"${canLocate ? '' : ' disabled'}>${icon('target')}</button>`;
}

function applyMapHeightClass() {
  const ov = $('.overview');
  if (!ov) return;
  ov.classList.remove('map-h-s', 'map-h-m', 'map-h-l');
  if (mapHeight) ov.classList.add(`map-h-${mapHeight}`);
  const current = effectiveMapHeight(ov.classList.contains('has-side'));
  for (const button of document.querySelectorAll('[data-map-height]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mapHeight === current));
  }
  fitLargeMap();
}

// 128px is the old frame offset and misses the epic title, so the box would run past the screen.
function fitLargeMap() {
  const ov = $('.overview');
  if (!ov?.getBoundingClientRect || !ov.style?.setProperty) return;
  const full = $('#map-frame')?.classList.contains('map-full');
  if (mapHeight !== 'l' || full) {
    ov.style.removeProperty('--map-l-cut');
    return;
  }
  const top = ov.getBoundingClientRect().top + (globalThis.scrollY || 0);
  ov.style.setProperty('--map-l-cut', `${Math.max(0, Math.round(top + 12))}px`);
}

function scrollToActiveCard() {
  const card = $('.ov-svg .ov-card.active') || $('.ov-svg .ov-card.selected');
  const scroller = $('.ov-scroll');
  if (!card || !scroller?.getBoundingClientRect) return;
  const s = scroller.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const maxX = Math.max(0, (scroller.scrollWidth || 0) - (scroller.clientWidth || 0));
  const maxY = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
  const left = (scroller.scrollLeft || 0) + (c.left + c.width / 2) - (s.left + s.width / 2);
  const top = (scroller.scrollTop || 0) + (c.top + c.height / 2) - (s.top + s.height / 2);
  const next = { left: Math.min(maxX, Math.max(0, left)), top: Math.min(maxY, Math.max(0, top)) };
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (!reduce && scroller.scrollTo) scroller.scrollTo({ ...next, behavior: 'smooth' });
  else {
    scroller.scrollLeft = next.left;
    scroller.scrollTop = next.top;
  }
}

async function saveMapHeight(mode) {
  const previous = mapHeight;
  mapHeight = mode;
  applyMapHeightClass();
  try {
    await saveSettings({ 'epic.mapHeight': mode });
  } catch (error) {
    mapHeight = previous;
    applyMapHeightClass();
    alertBox(error.message);
  }
}

function applyOverviewScale() {
  const scale = tlState.mapScale || 1;
  const label = $('.map-zoom-scale');
  if (label) label.textContent = formatMapScale(scale);
  const reset = $('[data-map-zoom-reset]');
  if (reset) reset.disabled = Math.round(scale * 100) === 100;
  const svg = $('.ov-svg');
  if (!svg) return;
  const natural = Number(svg.dataset?.w) || 0;
  if (!natural) {
    if (scale === 1) {
      svg.style.width = '';
      svg.style.maxWidth = '';
      svg.style.minWidth = '';
    }
    return;
  }
  svg.style.minWidth = '0';
  svg.style.maxWidth = 'none';
  svg.style.width = `${natural * scale}px`;
}

// The point under the cursor stays put while the chain grows or shrinks around it.
function keepZoomPoint(svg, clientX, clientY, px, py) {
  const rect = svg.getBoundingClientRect();
  let dx = rect.left + px * rect.width - clientX;
  let dy = rect.top + py * rect.height - clientY;
  let node = svg.parentElement;
  while (node && node !== document.body && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
    const left = node.scrollLeft || 0;
    const top = node.scrollTop || 0;
    if ((node.scrollWidth || 0) > (node.clientWidth || 0) + 1) node.scrollLeft = left + dx;
    if ((node.scrollHeight || 0) > (node.clientHeight || 0) + 1) node.scrollTop = top + dy;
    dx -= (node.scrollLeft || 0) - left;
    dy -= (node.scrollTop || 0) - top;
    node = node.parentElement;
  }
}

function zoomOverview(deltaY, clientX, clientY) {
  const svg = $('.ov-svg');
  const next = nextMapScale(tlState.mapScale || 1, deltaY);
  if (!svg?.getBoundingClientRect || next === tlState.mapScale) {
    tlState.mapScale = next;
    applyOverviewScale();
    return;
  }
  const before = svg.getBoundingClientRect();
  const px = before.width ? (clientX - before.left) / before.width : 0.5;
  const py = before.height ? (clientY - before.top) / before.height : 0.5;
  tlState.mapScale = next;
  applyOverviewScale();
  keepZoomPoint(svg, clientX, clientY, px, py);
}

function resetOverviewScale() {
  const svg = $('.ov-svg');
  const before = svg?.getBoundingClientRect?.();
  tlState.mapScale = 1;
  applyOverviewScale();
  if (svg && before?.width) keepZoomPoint(svg, before.left + before.width / 2, before.top + before.height / 2, 0.5, 0.5);
}

function readBoxScroll(sel) {
  const el = $(sel);
  return { x: el?.scrollLeft || 0, y: el?.scrollTop || 0 };
}

function writeBoxScroll(sel, saved) {
  const el = $(sel);
  if (!el || !saved) return;
  el.scrollLeft = saved.x;
  el.scrollTop = saved.y;
}

function pageScroll() {
  const frame = $('#map-frame');
  return {
    x: globalThis.window?.scrollX || 0,
    y: globalThis.window?.scrollY || 0,
    frameX: frame?.scrollLeft || 0,
    frameY: frame?.scrollTop || 0,
  };
}

function restorePageScroll(saved) {
  if (!saved) return;
  globalThis.window?.scrollTo?.(saved.x, saved.y);
  const frame = $('#map-frame');
  if (!frame) return;
  frame.scrollLeft = saved.frameX;
  frame.scrollTop = saved.frameY;
}

function holdMapScroll(saved) {
  writeBoxScroll('.overview', saved.overview);
  writeBoxScroll('.ov-scroll', saved.chain);
  restorePageScroll(saved.page);
}

function bindMapTools() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('.map-tools [data-fullscreen]')) setFull(!$('#map-frame').classList.contains('map-full'));
    if (e.target.closest('[data-map-zoom-reset]')) resetOverviewScale();
    if (e.target.closest('[data-map-locate]')) scrollToActiveCard();
    const height = e.target.closest('[data-map-height]');
    if (height && !EXPORT && ['s', 'm', 'l'].includes(height.dataset.mapHeight) && height.dataset.mapHeight !== mapHeight) {
      void saveMapHeight(height.dataset.mapHeight);
    }
  });
  document.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.target.closest?.('.overview-main')) return;
    e.preventDefault();
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (globalThis.window?.innerHeight || 800) : 1);
    zoomOverview(delta, e.clientX, e.clientY);
  }, { passive: false });
  // A click focuses the card inside the SVG and the browser scrolls that focus into view, which throws the chain off.
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest?.('[data-info]')) return;
    if (e.target.closest?.('#map [data-open]')) e.preventDefault();
  });
  globalThis.window?.addEventListener?.('resize', () => {
    applyOverviewScale();
    fitLargeMap();
  });
}

// Center the open step. A step near either end stays pinned there instead of scrolling past the strip.
function placeInView(offset, size, view, total) {
  const max = Math.max(0, total - view);
  return Math.min(max, Math.max(0, offset + size / 2 - view / 2));
}

function stepAnchor(layout, stepId) {
  if (!stepId) return null;
  for (let row = 0; row < layout.rows.length; row++) {
    const cell = layout.rows[row].cells.find((c) => c.id === stepId);
    if (cell) return { x: nodeX(cell.col), y: rowY(row) };
  }
  return null;
}

function focusTimeline(layout) {
  const scroller = $('#tl-scroll');
  const anchor = stepAnchor(layout, tlState.step);
  if (!scroller || !anchor) return;
  const size = timelineSize(layout);
  const apply = () => {
    const viewW = scroller.clientWidth || 0;
    if (!viewW) return false;
    const totalW = Math.max(scroller.scrollWidth || 0, size.width);
    const totalH = Math.max(scroller.scrollHeight || 0, size.height);
    scroller.scrollLeft = placeInView(anchor.x, TL.nodeW, viewW, totalW);
    const viewH = scroller.clientHeight || 0;
    if (viewH) scroller.scrollTop = placeInView(anchor.y, TL.nodeH, viewH, totalH);
    return true;
  };
  if (!apply()) globalThis.requestAnimationFrame?.(() => apply());
}

// The inner scroller takes what it can; whatever is left moves the outer one.
function panScroll(el, axis, from, delta) {
  if (!el) return delta;
  const horizontal = axis === 'x';
  const max = Math.max(0, (el[horizontal ? 'scrollWidth' : 'scrollHeight'] || 0) - (el[horizontal ? 'clientWidth' : 'clientHeight'] || 0));
  const next = Math.min(max, Math.max(0, from - delta));
  el[horizontal ? 'scrollLeft' : 'scrollTop'] = next;
  return delta - (from - next);
}

// A few pixels of travel starts a pan. A shorter press stays a click.
function bindHandPan(scroller, apply, moved = (dx, dy) => Math.hypot(dx, dy) > 4) {
  if (!scroller || scroller.dataset.bound) return;
  scroller.dataset.bound = '1';
  let drag = null;
  scroller.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moving: false, origin: apply() };
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moving && moved(dx, dy)) {
      drag.moving = true;
      scroller.setPointerCapture?.(drag.id);
      scroller.classList.add('dragging');
    }
    if (drag.moving) apply(drag.origin, dx, dy);
  });
  const stop = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    if (drag.moving) scroller.dataset.dragEnd = String(Date.now());
    drag = null;
    scroller.classList.remove('dragging');
  };
  scroller.addEventListener('pointerup', stop);
  scroller.addEventListener('pointercancel', stop);
  scroller.addEventListener('click', (e) => {
    if (Date.now() - Number(scroller.dataset.dragEnd || 0) > 200) return;
    e.preventDefault();
    e.stopPropagation();
  });
}

// Drag to pan the steps of the opened task: a long task is wider than the screen by design.
function bindPan() {
  const scroller = $('#tl-scroll');
  bindHandPan(scroller, (origin, dx) => {
    if (!origin) return { left: scroller.scrollLeft };
    scroller.scrollLeft = origin.left - dx;
  }, (dx) => Math.abs(dx) > 4);
}

// The off-chain column is outside this scroller, so a drag never moves it.
function bindOverviewPan() {
  const scroller = $('.ov-scroll');
  bindHandPan(scroller, (origin, dx, dy) => {
    if (!origin) return { left: scroller.scrollLeft, top: scroller.scrollTop };
    panScroll(scroller, 'x', origin.left, dx);
    panScroll(scroller, 'y', origin.top, dy);
  });
}

// ---------- Map area ----------

function openFromHash() {
  const m = location.hash.match(/^#t-([^/]+)(?:\/([\w.-]+))?$/);
  if (!m) return null;
  tlState.step = m[2] || null;
  return decodeURIComponent(m[1]);
}

function renderMapArea(epic) {
  const map = buildLanes(epic);
  const ov = buildOverview(epic);
  const allNodes = [...ov.nodes, ...ov.side];
  for (const n of allNodes) n.docs = (epic.docs || []).filter((d) => d.task === n.id).length;
  if (tlState.open === 'merge' && !allNodes.some((n) => n.kind === 'task' && n.id === 'merge')) tlState.open = MERGE_ID;
  if (tlState.open && !allNodes.some((n) => n.id === tlState.open && n.kind !== 'goal')) tlState.open = null;
  const open = tlState.open || defaultOpen(map);
  const prev = $('#tl-scroll');
  const stepBefore = tlState.step;
  const keep = prev && tlState.focused === open && tlState.focusedStep === stepBefore ? prev.scrollLeft : null;
  // Rebuilding the chain drops its scroll; opening a task must not jump back to the first cards.
  const held = { overview: readBoxScroll('.overview'), chain: readBoxScroll('.ov-scroll'), page: pageScroll() };
  $('#map').innerHTML = renderOverview(ov, open)
    + (open ? renderDetail(map, open) : '');
  applyOverviewScale();
  fitLargeMap();
  holdMapScroll(held);
  globalThis.requestAnimationFrame?.(() => {
    fitLargeMap();
    holdMapScroll(held);
  });
  bindOverviewPan();
  if (!open) return;
  bindPan();
  if (keep !== null && tlState.step === stepBefore) $('#tl-scroll').scrollLeft = keep;
  else {
    tlState.focused = open;
    tlState.focusedStep = tlState.step;
    focusTimeline(detailLayout(map, open));
  }
}

function toggleDetail(id, focusStack = false) {
  if ((tlState.open || defaultOpen(buildLanes(current))) !== id) tlState.step = null;
  tlState.open = id;
  if ((current.tasks || []).some((task) => task.id === id && task.role === 'side')) tlState.side = id;
  history.replaceState(null, '', `#t-${enc(id)}${tlState.step ? `/${enc(tlState.step)}` : ''}`);
  renderMapArea(current);
  if (focusStack) $('.side-current [data-open]')?.focus({ preventScroll: true });
}

function selectStep(stepId) {
  tlState.step = stepId;
  history.replaceState(null, '', `#t-${enc(tlState.open || defaultOpen(buildLanes(current)))}/${stepId}`);
  renderMapArea(current);
}

// ---------- Needs decision ----------

let decisionDrafts = null;

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
  } else if (kind === 'waiting') {
    const item = (epic.waiting || []).find((x) => x.id === value);
    if (item) [label, attrs, ic] = [item.title, `data-jump-sid="w-${esc(item.id)}"`, 'clock'];
  } else if (kind === 'decision') {
    const d = (epic.decisions || []).find((x) => x.id === value);
    if (d) [label, attrs, ic] = [`${t('w.ref.decision')}: ${d.text.length > 40 ? `${d.text.slice(0, 39)}…` : d.text}`, `data-jump-sid="d-${esc(d.id)}"`, 'flag'];
  }
  if (!label) return `<span class="ref missing" title="${esc(t('w.missing'))}">${icon('alert')}${esc(ref)}</span>`;
  return `<button type="button" class="ref" ${attrs}>${icon(ic)}<span>${esc(label)}</span></button>`;
}

function sortedWaiting(epic) {
  const rank = { open: 0, answered: 1, closed: 2 };
  return [...(epic.waiting || [])].sort((a, b) => (rank[a.status] ?? (a.doneAt ? 2 : 0)) - (rank[b.status] ?? (b.doneAt ? 2 : 0)) || String(a.since).localeCompare(String(b.since)));
}

function captureWaitingExpansion() {
  for (const card of $('#waiting').querySelectorAll('[data-sid]')) {
    waitingExpansion.set(card.dataset.sid, new Map([...card.querySelectorAll('details[data-wait-part]')].map((el) => [el.dataset.waitPart, el.open])));
  }
}

function pageItems(block, items) {
  const data = paginate(items, sectionPages[block], pageSizes[block]);
  sectionPages[block] = data.page;
  $(`#${block}-pagination`).innerHTML = renderPagination(block, data, pageSizes[block], { readOnly: Boolean(EXPORT), saving: savingPageSizes });
  return data.items;
}

function renderWaiting(epic, revealId, revealHistory = false) {
  const root = $('#waiting');
  const active = document.activeElement;
  const activeForm = active?.closest('[data-wait-form]');
  const focus = activeForm ? { id: activeForm.dataset.waitForm, name: active.name, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
  captureWaitingExpansion();
  if (revealId) {
    const expanded = waitingExpansion.get(revealId) || new Map();
    expanded.set('card', true);
    if (revealHistory) {
      expanded.set('history', true);
      expanded.set('drafts', true);
    }
    waitingExpansion.set(revealId, expanded);
  }
  const waiting = sortedWaiting(epic);
  root.innerHTML = pageItems('waiting', waiting).map((item) => renderWaitingCard(item, {
    readOnly: Boolean(EXPORT),
    expanded: waitingExpansion.get(`w-${item.id}`)?.get('card'),
    revealHistory: revealHistory && revealId === `w-${item.id}`,
    draft: EXPORT ? undefined : item.status === 'open' ? decisionDrafts.get(item) : decisionDrafts.peek(item.id),
    renderDetails: (text) => renderMd(text).html,
    refChip: (ref) => refChip(epic, ref),
  })).join('') || `<li class="muted">${esc(t('none.waiting'))}</li>`;
  for (const card of root.querySelectorAll('[data-sid]')) {
    for (const details of card.querySelectorAll('details[data-wait-part]')) {
      const expanded = waitingExpansion.get(card.dataset.sid);
      if (expanded?.has(details.dataset.waitPart)) details.open = expanded.get(details.dataset.waitPart);
    }
  }
  if (focus) {
    const form = [...root.querySelectorAll('[data-wait-form]')].find((el) => el.dataset.waitForm === focus.id);
    const input = [...(form?.elements || [])].find((el) => el.name === focus.name && (el.type === 'textarea' || el.value === focus.value));
    if (input && !input.disabled && !input.closest('fieldset[disabled]')) {
      input.focus({ preventScroll: true });
      if (input.setSelectionRange && focus.start !== null) input.setSelectionRange(focus.start, focus.end);
    }
  }
  const counts = waitingCounts(waiting);
  $('#waiting-count').innerHTML = ['open', 'answered', 'closed'].map((status) => `<span>${esc(t(`w.status.${status}`))} <b>${counts[status]}</b></span>`).join('');
}

function renderDecisions(epic) {
  $('#decisions').innerHTML = pageItems('decisions', [...(epic.decisions || [])].reverse()).map((d) => `<li data-sid="d-${esc(d.id)}"><span class="mono muted">${esc(String(d.at).slice(0, 10))}</span>${d.task ? `<span class="chip">${esc(d.task)}</span>` : ''}<span>${esc(d.text)}</span>${d.by ? `<span class="muted">${esc(d.by)}</span>` : ''}</li>`).join('') || `<li class="muted">${esc(t('none.decisions'))}</li>`;
}

function renderHistory(history) {
  $('#history').innerHTML = pageItems('history', historyEntries(history)).map(({ event: h, target, description: d }) => {
    const value = d.change === 'add' ? `<span class="hv-new">${esc(d.after ?? '')}</span>`
      : d.change === 'remove' ? `<span class="hv-old">${esc(d.before ?? '')}</span>`
      : `<span class="hv-old">${esc(d.before ?? '—')}</span>${icon('arrowRight', 'inl')}<span class="hv-new">${esc(d.after ?? '—')}</span>`;
    const by = ['agent', 'cli', 'refresh', 'button', 'hook'].includes(h.by) ? t(`by.${h.by}`) : cap(h.by);
    return `<li data-sid="${target}"><div class="h-line"><span class="h-time muted">${agoTag(h.at)}</span><span class="chip">${esc(by)}</span><span class="h-where">${esc(cap(d.where))}</span></div>
      <div class="h-change"><span class="h-what muted">${esc(cap(d.what))}:</span> ${value}</div>${h.why ? `<div class="h-why muted">${esc(cap(h.why))}</div>` : ''}</li>`;
  }).join('') || `<li class="muted">${esc(t('none.history'))}</li>`;
}

function renderSection(block) {
  if (block === 'waiting') renderWaiting(current);
  if (block === 'decisions') renderDecisions(current);
  if (block === 'history') renderHistory(currentHistory);
}

function changeSectionPage(block, page) {
  if (!Object.hasOwn(sectionPages, block)) return;
  sectionPages[block] = page;
  renderSection(block);
}

function applyPageSettings(settings) {
  const sizes = settings['epic.pageSizes'] || settings.epicPageSizes || {};
  for (const block of Object.keys(pageSizes)) {
    const value = sizes[block];
    const size = [5, 10, 15].includes(value) ? value : 5;
    if (pageSizes[block] === size) continue;
    pageSizes[block] = size;
    sectionPages[block] = 1;
    if (current) renderSection(block);
  }
  const height = settings['epic.mapHeight'] ?? settings.mapHeight;
  const next = ['s', 'm', 'l'].includes(height) ? height : null;
  if (next !== mapHeight) {
    mapHeight = next;
    applyMapHeightClass();
  }
}

function refreshPagers() {
  if (!current) return;
  for (const [block, items] of Object.entries({ waiting: sortedWaiting(current), decisions: current.decisions || [], history: historyEntries(currentHistory) })) pageItems(block, items);
}

function bindPagination(saveSettings) {
  $('#epic').addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    const block = button.closest('[data-page-block]').dataset.pageBlock;
    changeSectionPage(block, Number(button.dataset.page));
    const list = $(`#${block}`);
    list.tabIndex = -1;
    list.focus({ preventScroll: true });
  });
  $('#epic').addEventListener('change', async (event) => {
    const select = event.target.closest('[data-page-size]');
    if (!select || EXPORT || savingPageSizes) return;
    const block = select.dataset.pageSize;
    const size = Number(select.value);
    if (![5, 10, 15].includes(size)) return;
    savingPageSizes = true;
    refreshPagers();
    try {
      await saveSettings({ 'epic.pageSizes': { [block]: size } });
    } catch (error) {
      alertBox(error.message);
    } finally {
      savingPageSizes = false;
      refreshPagers();
      $(`[data-page-size="${block}"]`)?.focus({ preventScroll: true });
    }
  });
}

function revealPaginatedTarget(sid, revealHistory = false) {
  if (!current) return;
  const lists = { waiting: sortedWaiting(current).map((item) => `w-${item.id}`), decisions: [...(current.decisions || [])].reverse().map((item) => `d-${item.id}`), history: historyEntries(currentHistory).map((item) => item.target) };
  for (const [block, ids] of Object.entries(lists)) {
    const index = ids.indexOf(sid);
    if (index < 0) continue;
    sectionPages[block] = Math.floor(index / pageSizes[block]) + 1;
    if (block === 'waiting') renderWaiting(current, sid, revealHistory);
    else renderSection(block);
    return;
  }
}

function bindDecisionForms(id) {
  const root = $('#waiting');
  const readForm = (form) => {
    const item = current.waiting.find((w) => w.id === form.dataset.waitForm);
    if (!item) return;
    const data = new FormData(form);
    decisionDrafts.update(item, { selected: data.getAll('selected'), checked: data.getAll('checked'), comment: String(data.get('comment') || '') });
  };
  root.addEventListener('input', (event) => {
    const form = event.target.closest('[data-wait-form]');
    if (form) {
      readForm(form);
      const error = form.querySelector('[data-wait-error]');
      if (error) error.hidden = true;
    }
  });
  root.addEventListener('change', (event) => {
    const form = event.target.closest('[data-wait-form]');
    if (form) readForm(form);
  });
  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-wait-form]');
    if (!form) return;
    event.preventDefault();
    if (EXPORT) return;
    const item = current.waiting.find((w) => w.id === form.dataset.waitForm);
    if (!item || decisionDrafts.get(item).busy) return;
    readForm(form);
    const intent = event.submitter?.value === 'clarify' ? 'clarify' : 'agree';
    const result = decisionDrafts.submit(item, (body) => api(`/api/epics/${enc(id)}/waiting/${enc(item.id)}/${intent === 'clarify' ? 'clarify' : 'submit'}`, { method: 'POST', body }), intent);
    renderWaiting(current);
    try {
      const epic = await result;
      if (!epic) return;
      current = epic;
      revealPaginatedTarget(`w-${item.id}`);
      $('#waiting-announcement').textContent = t('w.saved');
      await renderEpic(id).catch((error) => alertBox(error.message));
    } catch (error) {
      if (error.status === 409) await renderEpic(id).catch(() => {});
      revealPaginatedTarget(`w-${item.id}`);
      const card = [...root.querySelectorAll('[data-sid]')].find((el) => el.dataset.sid === `w-${item.id}`);
      const message = card?.querySelector('[data-wait-error]');
      if (message) {
        message.tabIndex = -1;
        message.focus({ preventScroll: true });
      }
    }
  });
  root.addEventListener('click', (event) => {
    const refresh = event.target.closest('[data-wait-refresh]');
    if (!refresh || EXPORT) return;
    const item = current.waiting.find((w) => w.id === refresh.dataset.waitRefresh);
    if (!item || decisionDrafts.get(item).busy) return;
    decisionDrafts.refresh(item);
    renderWaiting(current);
    const form = [...root.querySelectorAll('[data-wait-form]')].find((el) => el.dataset.waitForm === item.id);
    (form?.querySelector('input, textarea, button'))?.focus();
  });
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

function jumpToTask(taskId, stepId) {
  toggleDetail(taskId);
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
      const localUnavailable = f?.localUnavailable === true;
      const branchMissing = f?.branchMissing === true;
      const stale = branchMissing || localUnavailable || Boolean(f?.error) || !f?.fetchedAt || nowMs() - Date.parse(f.fetchedAt) > STALE_MS;
      const mrStale = Boolean(f?.mr?.error) || !f?.mr?.fetchedAt || nowMs() - Date.parse(f.mr.fetchedAt) > STALE_MS;
      const headMatch = branchMissing || localUnavailable || f?.error ? null : f?.mr?.shaMatchesHead;
      const comparison = headMatch === false ? ` <span class="warn">${esc(t('br.wrongHead'))}</span>` : headMatch == null ? ` <span class="muted">${esc(t('br.unknownHead'))}</span>` : '';
      const mrChecked = f?.mr?.fetchedAt ? `<div class="${mrStale ? 'stale' : 'muted'}">${phrase('br.mrChecked', { t: agoTag(f.mr.fetchedAt) })}</div>` : '';
      const mr = !b.mr?.iid ? '—' : f?.mr && !f.mr.error
        ? `${isHttp(f.mr.url) ? `<a href="${esc(f.mr.url)}" target="_blank" rel="noopener noreferrer">#${b.mr.iid}</a>` : `#${b.mr.iid}`} ${esc(f.mr.draft ? 'draft' : f.mr.state)} <span class="${f.mr.pipeline === 'success' ? 'ok' : f.mr.pipeline === 'failed' ? 'crit' : 'warn'}">${esc(f.mr.pipeline ?? '')}</span>${comparison}${mrChecked}`
        : f?.mr?.error ? `<span class="crit">${esc(f.mr.error)}</span>${mrChecked}` : b.mr?.iid ? `#${b.mr.iid}` : '—';
      const counts = f
        ? `<span class="nowrap" title="${esc(t('br.behind'))}">${icon('arrowDown')}${f.behind ?? '?'}</span> <span class="nowrap" title="${esc(t('br.ahead'))}">${icon('arrowUp')}${f.ahead ?? '?'}</span>${f.unpushed ? ` <span class="warn nowrap">${icon('branch')}${esc(t('unpushed', { n: f.unpushed }))}</span>` : ''}${f.dirty ? ` <span class="warn nowrap">${icon('alert')}${esc(t('dirty'))}</span>` : ''}`
        : '—';
      const localStatus = localUnavailable
        ? `<div class="muted">${esc(t('br.localUnavailable'))}${f.localReason ? ` · ${esc(f.localReason)}` : ''}</div>`
        : f?.error ? `<div class="crit">${esc(f.error)}</div>` : branchMissing ? `<div class="muted">${esc(t('br.branchMissing'))}</div>` : b.worktree && f?.worktreeExists === false ? `<div class="muted">${esc(t('br.worktreeRemoved'))}</div>` : '';
      rows.push(`<tr data-sid="b-${esc(key)}">
        <td>${esc(b.repo)}<div class="muted">${esc(task.id)}</div></td>
        <td class="mono">${esc(b.name)}</td>
        <td class="mono${stale ? ' stale' : ''}">${esc(f?.head ?? '—')}<div class="muted">${esc(f?.subject ?? '')}</div></td>
        <td class="mono${stale ? ' stale' : ''}">${counts}</td>
        <td>${mr}</td>
        <td class="mono ${stale ? 'stale' : 'muted'}">${f?.fetchedAt ? phrase('br.gitChecked', { t: agoTag(f.fetchedAt) }) : esc(t('br.gitUnchecked'))}${localStatus}</td>
        <td><button type="button" class="live-only" data-refresh="${esc(key)}">${icon('refresh')}${esc(t('br.refresh'))}</button></td>
      </tr>`);
    }
  }
  const th = ['br.repo', 'br.branch', 'br.head', 'br.base', 'br.mr', 'br.fact'].map((k) => `<th>${esc(t(k))}</th>`).join('');
  return rows.length ? `<tr>${th}<th></th></tr>${rows.join('')}` : `<tr><td class="muted">${esc(t('br.none'))}</td></tr>`;
}

async function renderEpic(id) {
  const [epic, history] = await Promise.all([api(`/api/epics/${enc(id)}`), api(`/api/epics/${enc(id)}/history?limit=all`).catch(() => [])]);
  currentHistory = history;
  current = epic;
  document.title = `${epic.id} · ${epic.title} · EpicBoard`;
  const epicId = $('#epic-id');
  if (epicId) {
    epicId.hidden = false;
    epicId.textContent = epic.id;
  }
  $('#title').innerHTML = `${esc(epic.title)}${epic.url ? ` ${external(epic.url, '')}` : ''}`;
  $('#goal').textContent = epic.goal || '';
  const stamps = Object.values(epic.facts || {}).map((f) => f.fetchedAt).filter(Boolean).sort();
  const plainAgo = (iso) => t('ago', { t: ago(iso) });
  const stampTip = stamps.length
    ? t('epic.factsUpdated', { a: plainAgo(stamps.at(-1)), b: plainAgo(epic.updatedAt) })
    : t('epic.edited', { a: plainAgo(epic.updatedAt) });
  const updated = $('#updated');
  updated.hidden = false;
  updated.removeAttribute('title');
  updated.setAttribute('aria-label', stampTip);
  updated.innerHTML = `${icon('clock')}<span class="tip" role="tooltip">${esc(stampTip)}</span>`;
  renderMapArea(epic);
  renderWaiting(epic);
  $('#branches').innerHTML = branchRows(epic);
  renderDecisions(epic);
  $('#sessions').innerHTML = [...(epic.sessions || [])].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))).map((x) => `<li class="session" data-sid="s-${esc(x.id)}">
      <div class="session-head">${agentBadge(x.agent)}<code class="muted">${esc(x.id.slice(0, 8))}</code>${x.task ? `<span class="chip">${esc(x.task)}</span>` : ''}<span class="muted session-time">${icon('clock')}<span class="phrase">${agoText(x.lastAt)}</span></span></div>
      <dl class="session-body"><dt>${esc(t('session.doing'))}</dt><dd>${esc(x.doing ?? '—')}</dd><dt>${esc(t('session.next'))}</dt><dd>${esc(x.next ?? '—')}</dd></dl></li>`).join('') || `<li class="muted">${esc(t('none.sessions'))}</li>`;
  renderHistory(history);
  // The live page uses the board-wide search; an export has no service and keeps its own index.
  if (EXPORT) buildSearchIndex(epic, history);
}

async function pollEpicLinks(id) {
  if (linksPolling) return;
  linksPolling = true;
  try {
    linksState = linkPollState(linksState, await api(`/api/epics/${enc(id)}/links`));
  } catch {
    linksState = linkPollState(linksState, null, true);
  } finally {
    linksPolling = false;
    if (linksState.changed) updateLinksDom(document, linksState, id, { exported: Boolean(EXPORT) });
  }
}

// ---------- Header search across everything the opened epic shows ----------

let searchIndex = [];

function buildSearchIndex(epic, history) {
  const items = [];
  const add = (section, text, target, extra = {}) => items.push({ section, text: String(text ?? ''), target, ...extra });
  for (const w of epic.waiting || []) add(t('search.waiting'), waitingSearchText(w), `w-${w.id}`);
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
  for (const { target, searchText } of historyEntries(history)) add(t('search.history'), searchText, target);
  for (const d of epic.docs || []) add(t('search.doc', { t: kindText(d.kind) }), d.title, null, { doc: d.id });
  searchIndex = items;
  api(`/api/epics/${enc(epic.id)}/docs-text`).then((texts) => {
    for (const x of texts) {
      for (const para of x.text.split(/\n{2,}/)) if (para.trim()) items.push({ section: t('search.doc', { t: x.title }), text: para.replace(/\s+/g, ' ').trim(), target: null, doc: x.id });
    }
  }).catch(() => {});
}

function flash(sid, revealHistory = false) {
  revealPaginatedTarget(sid, revealHistory);
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
      if (it.open) toggleDetail(it.open);
      requestAnimationFrame(() => (it.target ? flash(it.target, true) : $('#map-frame')?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
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
  el.querySelector('.pr-detail').textContent = e.state === 'start' ? t('refresh.running') : e.state === 'ok' ? e.detail || t('refresh.ok') : e.state === 'partial' ? e.detail || t('refresh.partial') : cap(e.detail || t('refresh.error'));
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
  let partial = 0;
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
          if (e.type === 'branch' && e.state === 'partial') partial++;
        }
        if (e.type === 'error') $('#pr-summary').innerHTML = `<span class="crit">${esc(t('refresh.errorText', { e: e.detail }))}</span>`;
        if (e.type === 'done') $('#pr-summary').innerHTML = partial ? `<span class="warn">${esc(t('refresh.donePartial', { ok, partial, failed }))}</span>` : failed ? `<span class="warn">${esc(t('refresh.doneWithErrors', { ok, failed }))}</span>` : `<span class="ok">${icon('check')}${esc(t('refresh.done', { ok }))}</span>`;
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
  decisionDrafts = new DecisionDrafts(id);
  applyI18n();
  if (EXPORT) markExport();
  const exp = $('#export-link');
  if (exp) exp.href = `/api/epics/${enc(id)}/export`;
  tlState.open = openFromHash();
  fillIcons();
  const rerenderLang = async () => {
    setFull($('#map-frame')?.classList.contains('map-full') || false);
    if (EXPORT) markExport();
    await renderEpic(id);
  };
  if (EXPORT) bindLang(rerenderLang);
  else {
    bindShell();
    document.addEventListener('epic-board:lang', () => { void rerenderLang(); });
    // Board search links to `#t-<task>[/<step>]` on the epic already open, which only changes the hash.
    addEventListener('hashchange', () => {
      const open = openFromHash();
      if (!open || !current) return;
      tlState.open = open;
      renderMapArea(current);
      $('#map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  bindMapTools();
  bindSideCarousel();
  if (EXPORT) bindSearch();
  bindDocs();
  if (!EXPORT) bindDecisionForms(id);
  const sectionSettings = bindSectionSettings({ api, onError: alertBox, onSettings: applyPageSettings, readOnly: Boolean(EXPORT) });
  if (sectionSettings.save) saveSettings = sectionSettings.save;
  bindPagination(sectionSettings.save);
  await Promise.all([renderEpic(id), pollEpicLinks(id), sectionSettings.reload().catch((err) => alertBox(err.message))]);
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
    const turn = el.closest('[data-side-turn]');
    if (turn) return void rotateSide(Number(turn.dataset.sideTurn));
    const pick = el.closest('[data-side-pick]');
    if (pick) return void rotateSide(1, pick.dataset.sidePick);
    const openCard = el.closest('[data-open]');
    if (openCard) toggleDetail(openCard.dataset.open, Boolean(openCard.closest('.side-carousel')));
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
    if (e.target.closest?.('.side-carousel') && ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) {
      e.preventDefault();
      return void rotateSide(['ArrowUp', 'ArrowLeft'].includes(e.key) ? -1 : 1);
    }
    const card = e.target.closest?.('[data-open]');
    if (card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggleDetail(card.dataset.open, Boolean(card.closest('.side-carousel')));
    }
  });
  if (!EXPORT) setInterval(async () => {
    await sectionSettings.reload().catch(() => {});
    try {
      const { updatedAt } = await api(`/api/epics/${enc(id)}/rev`);
      if (current && updatedAt !== current.updatedAt) await renderEpic(id);
    } catch {}
  }, 10000);
  if (!EXPORT) setInterval(() => pollEpicLinks(id), 10000);
}

async function bootIndex() {
  applyI18n();
  fillIcons();
  bindShell({ search: !EXPORT });
  document.addEventListener('epic-board:lang', renderIndexContent);
  bindIndexSort();
  $('#q')?.addEventListener('input', renderEpicList);
  bindEpicPins();
  await renderIndex();
  setInterval(pollIndex, 10000);
}

if (EXPORT || location.pathname.startsWith('/e/')) bootEpic().catch((e) => alertBox(e.message));
else bootIndex().catch((e) => alertBox(e.message));
