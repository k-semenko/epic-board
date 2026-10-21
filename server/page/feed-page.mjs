import { bindShell, api, esc, t, fillChrome, locale } from './shell.mjs';
import { renderMarkdown } from './markdown.mjs';
import { icon } from './icons.mjs';

bindShell();

let tab = 'unmarked';
let items = [];
let rev = 0;
let focus = 0;
let selected = new Set();
let filters = { source: '', severity: '', mark: '' };
let undo = null;
let toastTimer = 0;
let knownIds = new Set();
let pending = null;
const SEVERITIES = ['fire', 'important', 'normal', 'noise'];
let groupBy = (() => { try { return localStorage.getItem('epic-board.feedGroup') === 'severity' ? 'severity' : 'source'; } catch { return 'source'; } })();
let profileSource = '';
let profileOpen = false;

const MARKS = [
  { value: 'important', key: '1', label: 'feed.mark.important', icon: 'thumbUp' },
  { value: 'unimportant', key: '2', label: 'feed.mark.unimportant', icon: 'thumbDown' },
  { value: 'noise', key: '3', label: 'feed.mark.noise', icon: 'trash' },
];

function actionButton(attrs, iconName, label, active = false) {
  return `<button type="button" class="icon-btn feed-act${active ? ' is-active' : ''}" ${attrs} title="${esc(label)}" aria-label="${esc(label)}"${active ? ' aria-pressed="true"' : ''}>${icon(iconName)}</button>`;
}

function isUnmarked(item) {
  return !item.mark || item.changedSinceMark;
}

function filtered() {
  let list = items.filter((item) => (tab === 'unmarked' ? isUnmarked(item) : Boolean(item.mark)));
  if (filters.source) list = list.filter((item) => item.source === filters.source);
  if (filters.severity) list = list.filter((item) => item.severity === filters.severity);
  if (tab === 'history' && filters.mark) list = list.filter((item) => item.mark?.value === filters.mark);
  const at = (item) => String(tab === 'history' ? item.mark?.at || item.updatedAt : item.ts || item.updatedAt);
  return list.sort((a, b) => at(b).localeCompare(at(a)));
}

// Groups in drawing order. By source, fires still sit on top in their own group so they are never buried.
function groups() {
  const list = filtered();
  const out = [];
  if (groupBy === 'severity') {
    for (const sev of SEVERITIES) {
      const part = list.filter((item) => item.severity === sev);
      if (part.length) out.push({ key: sev, label: t(`feed.sev.${sev}`), items: part, sev, noise: sev !== 'fire' });
    }
    return out;
  }
  const fire = list.filter((item) => item.severity === 'fire');
  if (fire.length) out.push({ key: 'fire', label: t('feed.fire'), items: fire, sev: 'fire', noise: false });
  const bySource = new Map();
  for (const item of list.filter((x) => x.severity !== 'fire')) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source).push(item);
  }
  for (const [source, part] of bySource) out.push({ key: source, label: source, items: part, noise: true });
  return out;
}

// Keyboard focus indexes into exactly what the page draws.
function visible() {
  return groups().flatMap((group) => group.items);
}

function ago(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? t('unit.min', { n: m }) : m < 1440 ? t('unit.h', { n: Math.round(m / 60) }) : t('unit.d', { n: Math.round(m / 1440) });
}

function needsComment(item, value) {
  if ((item.severity === 'fire' || item.severity === 'important') && value === 'noise') return true;
  if (item.severity === 'noise' && value === 'important') return true;
  return false;
}

// Every control sits in the same slot in both tabs: a label above, a 34px control below.
function renderFilters() {
  const sources = [...new Set(items.map((item) => item.source))].sort();
  const select = (key, options) => `<select data-filter="${key}"><option value="">${esc(t('feed.filter.all'))}</option>${options.map(([value, label]) => `<option value="${esc(value)}" ${filters[key] === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  const history = tab === 'history';
  $('#feed-filters').innerHTML = `
    <label class="feed-filter">${esc(t('feed.filter.source'))}${select('source', sources.map((s) => [s, s]))}</label>
    <label class="feed-filter">${esc(t('feed.filter.severity'))}${select('severity', SEVERITIES.map((s) => [s, t(`feed.sev.${s}`)]))}</label>
    <div class="feed-filter feed-groupby"><span>${esc(t('feed.groupBy'))}</span><div class="view-nav" role="radiogroup" aria-label="${esc(t('feed.groupBy'))}">
      ${['source', 'severity'].map((key) => `<button type="button" role="radio" aria-checked="${groupBy === key}" class="${groupBy === key ? 'is-active' : ''}" data-group-by="${key}">${esc(t(`feed.groupBy.${key}`))}</button>`).join('')}
    </div></div>
    <label class="feed-filter${history ? '' : ' is-idle'}"${history ? '' : ' aria-hidden="true"'}>${esc(t('feed.filter.mark'))}${select('mark', MARKS.map((m) => [m.value, t(m.label)]))}</label>`;
  if (!history) $('#feed-filters [data-filter="mark"]').disabled = true;
}

function refChips(item) {
  return (item.refs || []).map((r) => {
    if (r.startsWith('epic:')) return `<a class="chip" href="/e/${esc(r.slice(5))}">${icon('board')}${esc(r.slice(5))}</a>`;
    const task = r.match(/^task:([^/]+)\/(.+)$/);
    if (task) return `<a class="chip" href="/e/${esc(task[1])}#t-${esc(task[2])}">${icon('list')}${esc(task[2])}</a>`;
    if (/^https?:\/\//.test(r)) {
      let host = r;
      try { host = new URL(r).host; } catch {}
      return `<a class="chip" href="${esc(r)}" target="_blank" rel="noopener" title="${esc(r)}">${icon('link')}${esc(host)}</a>`;
    }
    return '';
  }).join('');
}

const sameDay = (a, b) => a.toDateString() === b.toDateString();

// Created time reads as "today, 14:32" so a glance tells how fresh the signal is.
function stamp(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const now = new Date();
  const time = at.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(at, now)) return t('feed.today', { time });
  if (sameDay(at, yesterday)) return t('feed.yesterday', { time });
  return `${at.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}, ${time}`;
}

function stampTitle(item) {
  const full = (iso) => new Date(iso).toLocaleString(locale());
  const lines = [t('feed.created', { at: full(item.ts) })];
  if (item.updatedAt && item.updatedAt !== item.ts) lines.push(t('feed.updated', { at: full(item.updatedAt), ago: ago(item.updatedAt) }));
  if (item.count > 1) lines.push(t('feed.repeats', { n: item.count }));
  if (item.changedSinceMark) lines.push(t('feed.changedHint'));
  return lines.join('\n');
}

const LONG_BODY = 180;
const isLong = (body) => body.length > LONG_BODY || body.split('\n').length > 3;

function headHtml(item) {
  const changed = item.changedSinceMark
    ? `<span class="feed-changed" title="${esc(t('feed.changedHint'))}"><span class="sr-only">${esc(t('feed.changedHint'))}</span></span>`
    : '';
  return `<span class="feed-sev sev-${esc(item.severity)}"><span class="sr-only">${esc(t(`feed.sev.${item.severity}`))}</span></span>
    ${item.channel ? `<span class="feed-channel">${esc(item.channel)}</span>` : ''}
    <span class="feed-card-meta">
      ${changed}
      ${item.count > 1 ? `<span class="feed-count" title="${esc(t('feed.repeats', { n: item.count }))}">×${item.count}</span>` : ''}
      <time datetime="${esc(item.ts)}" title="${esc(stampTitle(item))}">${esc(stamp(item.ts))}</time>
    </span>`;
}

function actionsHtml(item, { labels = false } = {}) {
  const btn = (attrs, iconName, label, active) => labels
    ? `<button type="button" class="feed-act-wide${active ? ' is-active' : ''}" ${attrs}>${icon(iconName)}<span>${esc(label)}</span></button>`
    : actionButton(attrs, iconName, label, active);
  return `${tab === 'history' ? btn('data-unmark', 'undo', t('feed.unmark')) : ''}
    ${MARKS.map((m) => btn(`data-mark="${m.value}"`, m.icon, labels ? t(m.label) : `${t(m.label)} · ${m.key}`, item.mark?.value === m.value)).join('')}
    ${tab === 'history' ? btn('data-delete', 'close', t('feed.delete')) : ''}`;
}

function markNote(item) {
  if (!item.mark) return '';
  const label = MARKS.find((m) => m.value === item.mark.value);
  return `<span class="feed-mark-note">${label ? icon(label.icon) : ''}${esc(label ? t(label.label) : item.mark.value)}${item.mark.comment ? ` · ${esc(item.mark.comment)}` : ''}</span>`;
}

function rowHtml(item, index) {
  const active = index === focus ? ' is-focus' : '';
  const sel = selected.has(item.id) ? ' is-selected' : '';
  const body = item.body || '';
  return `<li class="feed-row feed-card sev-${esc(item.severity)}${active}${sel}" data-id="${esc(item.id)}" data-index="${index}">
    <header class="feed-card-head">${headHtml(item)}</header>
    <h3 class="feed-title">${esc(item.title)}</h3>
    ${body ? `<div class="feed-preview markdown${isLong(body) ? ' is-clamped' : ''}">${renderMarkdown(body).html}</div>` : ''}
    <div class="feed-comment" hidden><input type="text" data-i18n-ph="feed.why" placeholder="${esc(t('feed.why'))}"></div>
    <footer class="feed-card-foot">
      <div class="feed-refs"><span class="feed-source">${esc(item.source)}</span>${tab === 'history' ? markNote(item) : ''}${refChips(item)}</div>
      <div class="feed-actions">${actionsHtml(item)}</div>
    </footer>
  </li>`;
}

// The full item opens in a dialog: long chat summaries are read there, and marked without leaving it.
let openId = null;

function openItem(id) {
  const item = items.find((x) => x.id === id);
  if (!item) return;
  openId = id;
  pending = null;
  const dlg = $('#feed-item');
  dlg.querySelector('.modal').innerHTML = `
    <header class="modal-head feed-card-head">${headHtml(item)}<button type="button" class="icon-btn" data-item-close aria-label="${esc(t('close'))}">${icon('close')}</button></header>
    <h2 class="feed-item-title">${esc(item.title)}</h2>
    <p class="muted feed-item-times">${esc(stampTitle(item)).replaceAll('\n', ' · ')}</p>
    ${item.body ? `<div class="markdown feed-item-body">${renderMarkdown(item.body).html}</div>` : `<p class="muted">${esc(t('feed.noBody'))}</p>`}
    ${item.refs?.length ? `<div class="feed-refs">${refChips(item)}</div>` : ''}
    ${tab === 'history' && item.mark ? `<p>${markNote(item)}</p>` : ''}
    <div class="feed-comment" hidden><input type="text" placeholder="${esc(t('feed.why'))}"></div>
    <footer class="modal-foot feed-item-foot"><span class="feed-source">${esc(item.source)}</span><div class="feed-item-acts">${actionsHtml(item, { labels: true })}</div></footer>`;
  if (!dlg.open) dlg.showModal();
}

function closeItem() {
  openId = null;
  const dlg = $('#feed-item');
  if (dlg.open) dlg.close();
}

// Three different empties: nothing ever arrived, filters hide everything, or everything is triaged.
function emptyHtml() {
  const card = (iconName, title, text, actions) => `<div class="feed-empty">
    <span class="feed-empty-icon">${icon(iconName)}</span>
    <h2>${esc(title)}</h2>
    ${text ? `<p class="muted">${text}</p>` : ''}
    <div class="feed-empty-actions">${actions}</div>
  </div>`;
  const howBtn = (cls = '') => `<button type="button" class="${cls}" data-open-how>${icon('info')}<span>${esc(t('feed.how'))}</span></button>`;
  if (!items.length) {
    return card('inbox', t('feed.emptyNone'), esc(t('feed.emptyNoneText')), `<button type="button" class="primary" data-open-how-ai>${esc(t('feed.howAi'))}</button>${howBtn()}`);
  }
  if (filters.source || filters.severity || (tab === 'history' && filters.mark)) {
    return card('search', t('feed.emptyFiltered'), '', `<button type="button" class="primary" data-clear-filters>${esc(t('feed.clearFilters'))}</button>`);
  }
  if (tab === 'history') return card('undo', t('feed.emptyHistory'), esc(t('feed.emptyHistoryText')), '');
  const today = new Date().toDateString();
  const marked = items.filter((item) => item.mark?.at && new Date(item.mark.at).toDateString() === today);
  const count = (value) => marked.filter((item) => item.mark.value === value).length;
  const stats = MARKS.map((m) => `<span class="feed-empty-stat">${icon(m.icon)}${esc(t(m.label))} <b>${count(m.value)}</b></span>`).join('');
  const last = items.reduce((max, item) => (String(item.updatedAt) > max ? String(item.updatedAt) : max), '');
  return card('check', t('feed.empty'), `${esc(t('feed.emptyToday'))}</p><div class="feed-empty-stats">${stats}</div><p class="muted">${esc(t('feed.emptyLast', { ago: ago(last) }))}`,
    `<button type="button" data-show-history>${esc(t('feed.openHistory'))}</button>${howBtn()}`);
}

function renderList() {
  const list = visible();
  const root = $('#feed-list');
  // Filters and grouping only make sense when there is something to sort; active filters stay so they can be cleared.
  const filtering = Boolean(filters.source || filters.severity || (tab === 'history' && filters.mark));
  $('#feed-filters').hidden = !list.length && !filtering;
  if (!list.length) {
    root.innerHTML = emptyHtml();
    void renderProfile();
    return;
  }
  let html = '';
  let index = 0;
  for (const group of groups()) {
    const noise = tab === 'unmarked' && group.noise;
    html += `<section class="feed-group"${group.sev ? ` data-sev="${esc(group.sev)}"` : ''}><header class="day-head">
      <h2>${group.sev ? `<span class="feed-sev sev-${esc(group.sev)}"></span>` : ''}${esc(group.label)} · ${group.items.length}</h2>
      ${noise ? `<button type="button" class="feed-group-noise" data-noise-group="${esc(group.key)}">${icon('trash')}<span>${esc(t('feed.allNoise'))}</span></button>` : ''}
    </header><ul class="list feed-rows">${group.items.map((item) => rowHtml(item, index++)).join('')}</ul></section>`;
  }
  root.innerHTML = html;
  focus = Math.min(focus, Math.max(0, list.length - 1));
  root.querySelector(`[data-index="${focus}"]`)?.classList.add('is-focus');
  void renderProfile();
}

function profileExcerpt(text, source) {
  const lines = String(text || '').split('\n').map((row) => row.trim().replace(/^#{1,6}\s*/, '').replace(/^[-*]\s*/, '').replace(/\s+/g, ' ')).filter(Boolean);
  const name = String(source || '').toLowerCase();
  for (const line of lines) {
    const rest = name && line.toLowerCase().startsWith(`${name}:`) ? line.slice(name.length + 1).trim() : line;
    if (rest && rest.toLowerCase() !== name) return rest;
  }
  return lines[0] || '';
}

function matrixCount(matrix, severity, mark) {
  return Number(matrix?.[`${severity}:${mark}`]) || 0;
}

function profileHtml(source, text, matrix) {
  const body = text.trim() ? text : t('feed.noProfile');
  const excerpt = profileExcerpt(body, source);
  const totals = MARKS.map((mark) => {
    const n = SEVERITIES.reduce((sum, severity) => sum + matrixCount(matrix, severity, mark.value), 0);
    return n ? `<span class="chip">${esc(t(mark.label))} ${n}</span>` : '';
  }).join('');
  const pairs = SEVERITIES.flatMap((severity) => MARKS.map((mark) => {
    const n = matrixCount(matrix, severity, mark.value);
    return n ? `<span class="chip">${esc(t(`feed.sev.${severity}`))} · ${esc(t(mark.label))} ${n}</span>` : '';
  })).join('');
  const open = profileOpen;
  return `<button type="button" class="feed-profile-bar" data-profile-toggle aria-expanded="${open}">
      <span class="feed-profile-name">${esc(source)}</span>
      <span class="feed-profile-excerpt">${esc(excerpt)}</span>
      ${totals ? `<span class="feed-profile-counts">${totals}</span>` : ''}
      <span class="feed-profile-toggle">${icon('arrowDown')}<span class="feed-profile-toggle-label">${esc(t(open ? 'feed.profileCollapse' : 'feed.profileExpand'))}</span></span>
    </button>
    <div class="feed-profile-body"${open ? '' : ' hidden'}>
      <pre class="feed-profile-text">${esc(body)}</pre>
      ${pairs ? `<div class="feed-profile-matrix">${pairs}</div>` : ''}
    </div>`;
}

async function renderProfile() {
  const panel = $('#feed-profile');
  if (!filters.source) {
    profileSource = '';
    profileOpen = false;
    panel.hidden = true;
    panel.classList.remove('is-open');
    panel.innerHTML = '';
    return;
  }
  if (profileSource !== filters.source) {
    profileSource = filters.source;
    profileOpen = false;
  }
  panel.hidden = false;
  panel.classList.toggle('is-open', profileOpen);
  try {
    const [agg, text] = await Promise.all([
      api(`/api/feed/profile?source=${encodeURIComponent(filters.source)}`),
      api(`/api/feed/profile?source=${encodeURIComponent(filters.source)}&text=1`),
    ]);
    if (filters.source !== profileSource) return;
    panel.innerHTML = profileHtml(filters.source, text.text || '', agg.matrix || {});
    panel.classList.toggle('is-open', profileOpen);
  } catch (error) {
    panel.innerHTML = `<p class="crit">${esc(error.message)}</p>`;
  }
}

function showToast(ids) {
  undo = ids;
  const toast = $('#feed-toast');
  toast.hidden = false;
  toast.innerHTML = `<span class="feed-toast-mark">${icon('check')}</span><span>${esc(t('feed.toast'))}</span><button type="button" data-undo>${icon('undo')}<span>${esc(t('feed.undo'))}</span></button>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; undo = null; }, 5000);
}

function commentOpen() {
  return [...document.querySelectorAll('.feed-comment')].some((field) => !field.hidden);
}

async function load({ soft = false } = {}) {
  const data = await api('/api/feed');
  if (soft && data.rev === rev) return;
  if (soft && commentOpen()) return;
  if (soft) {
    const fresh = data.items.filter((item) => !knownIds.has(item.id) && isUnmarked(item));
    if (fresh.length) {
      const bar = $('#feed-new');
      bar.hidden = false;
      bar.innerHTML = `${esc(t('feed.newCount', { n: fresh.length }))} <button type="button" data-show-new>${esc(t('feed.showNew'))}</button>`;
      return;
    }
  }
  items = data.items;
  rev = data.rev;
  knownIds = new Set(items.map((item) => item.id));
  $('#feed-new').hidden = true;
  renderFilters();
  renderList();
  fillChrome($('#feed-filters'));
}

async function postFeed(action, body) {
  await api(`/api/feed/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function markIds(ids, value, comment) {
  if (!ids.length) return;
  const previous = ids.map((id) => ({ id, mark: items.find((item) => item.id === id)?.mark || null }));
  pending = null;
  if (openId && ids.includes(openId)) closeItem();
  await postFeed('mark', { ids, value, comment });
  showToast(previous);
  await load();
}

// Undo puts back what was there: no mark, or the mark changed from History.
async function undoLast() {
  if (!undo) return;
  const restore = undo;
  undo = null;
  $('#feed-toast').hidden = true;
  const bare = restore.filter((x) => !x.mark).map((x) => x.id);
  if (bare.length) await postFeed('unmark', { ids: bare });
  for (const x of restore.filter((r) => r.mark)) await postFeed('mark', { ids: [x.id], value: x.mark.value, comment: x.mark.comment });
  await load();
}

function rowOf(id) {
  return [...document.querySelectorAll('.feed-row')].find((row) => row.dataset.id === id);
}

// A mark that disagrees with the connector asks "why?" first; Enter sends it, Esc or the same mark again skips it.
async function requestMark(item, value) {
  const scope = openId === item.id ? $('#feed-item') : rowOf(item.id);
  const field = scope?.querySelector('.feed-comment');
  const input = field?.querySelector('input');
  const typed = field && !field.hidden ? input.value.trim() : '';
  const again = pending && pending.id === item.id && pending.value === value;
  if (!typed && !again && field && needsComment(item, value)) {
    pending = { id: item.id, value };
    field.hidden = false;
    input.focus();
    return;
  }
  await markIds([item.id], value, typed || undefined);
}

function currentItem() {
  return visible()[focus];
}

function $(sel) { return document.querySelector(sel); }

document.querySelector('.view-nav[role="tablist"]').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-tab]');
  if (!btn) return;
  tab = btn.dataset.tab;
  for (const el of document.querySelectorAll('[data-tab]')) el.classList.toggle('is-active', el === btn);
  focus = 0;
  renderFilters();
  renderList();
});

$('#feed-filters').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-group-by]');
  if (!btn) return;
  groupBy = btn.dataset.groupBy;
  try { localStorage.setItem('epic-board.feedGroup', groupBy); } catch { /* per-viewer convenience only */ }
  focus = 0;
  renderFilters();
  renderList();
});

$('#feed-filters').addEventListener('change', (event) => {
  const sel = event.target.closest('[data-filter]');
  if (!sel) return;
  filters[sel.dataset.filter] = sel.value;
  focus = 0;
  renderList();
});

$('#feed-profile').addEventListener('click', (event) => {
  if (!event.target.closest('[data-profile-toggle]')) return;
  profileOpen = !profileOpen;
  const panel = $('#feed-profile');
  panel.classList.toggle('is-open', profileOpen);
  const body = panel.querySelector('.feed-profile-body');
  if (body) body.hidden = !profileOpen;
  const bar = panel.querySelector('[data-profile-toggle]');
  if (bar) bar.setAttribute('aria-expanded', String(profileOpen));
  const label = panel.querySelector('.feed-profile-toggle-label');
  if (label) label.textContent = t(profileOpen ? 'feed.profileCollapse' : 'feed.profileExpand');
});

$('#feed-list').addEventListener('click', async (event) => {
  const row = event.target.closest('[data-id]');
  if (row) focus = Number(row.dataset.index);
  if (event.target.closest('[data-noise-group]')) {
    const key = event.target.closest('[data-noise-group]').dataset.noiseGroup;
    const group = groups().find((g) => g.key === key);
    const ids = (group?.items || []).filter((item) => item.severity !== 'fire').map((item) => item.id);
    await markIds(ids, 'noise');
    return;
  }
  if (event.target.closest('[data-mark]')) {
    const value = event.target.closest('[data-mark]').dataset.mark;
    const item = items.find((x) => x.id === row.dataset.id);
    await requestMark(item, value);
    return;
  }
  if (event.target.closest('[data-unmark], [data-delete], a, input, button, .feed-comment')) {
    // handled below or by the browser
  } else if (row && !String(globalThis.getSelection?.() || '')) {
    // Selecting text to copy it must not open the dialog.
    openItem(row.dataset.id);
    return;
  }
  if (event.target.closest('[data-unmark]')) {
    await postFeed('unmark', { ids: [row.dataset.id] });
    await load();
    return;
  }
  if (event.target.closest('[data-delete]')) {
    if (!confirm(t('feed.confirmDelete'))) return;
    await postFeed('delete', { ids: [row.dataset.id] });
    await load();
  }
});

// Clicks and keys inside the item dialog act on the open item, like on its card.
$('#feed-item').addEventListener('click', async (event) => {
  if (event.target === $('#feed-item') || event.target.closest('[data-item-close]')) { closeItem(); return; }
  const item = items.find((x) => x.id === openId);
  if (!item) return;
  const markBtn = event.target.closest('[data-mark]');
  if (markBtn) { await requestMark(item, markBtn.dataset.mark); return; }
  if (event.target.closest('[data-unmark]')) { closeItem(); await postFeed('unmark', { ids: [item.id] }); await load(); return; }
  if (event.target.closest('[data-delete]') && confirm(t('feed.confirmDelete'))) { closeItem(); await postFeed('delete', { ids: [item.id] }); await load(); }
});
$('#feed-item').addEventListener('close', () => { openId = null; pending = null; });
$('#feed-item').addEventListener('keydown', async (event) => {
  const input = event.target.closest('.feed-comment input');
  if (!input || !pending) return;
  if (event.key === 'Enter') { event.preventDefault(); await markIds([pending.id], pending.value, input.value.trim() || undefined); }
});

$('#feed-new').addEventListener('click', (event) => {
  if (event.target.closest('[data-show-new]')) void load();
});

$('#feed-toast').addEventListener('click', async (event) => {
  if (event.target.closest('[data-undo]')) await undoLast();
});

$('#feed-list').addEventListener('keydown', async (event) => {
  const input = event.target.closest('.feed-comment input');
  if (!input) return;
  const row = input.closest('.feed-row');
  const item = items.find((x) => x.id === row?.dataset.id);
  if (!item) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    if (pending?.id === item.id) await markIds([item.id], pending.value, input.value.trim() || undefined);
    else input.blur();
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    if (pending?.id === item.id) await markIds([item.id], pending.value);
    else { input.closest('.feed-comment').hidden = true; input.blur(); }
  }
});

document.addEventListener('keydown', async (event) => {
  if (/input|textarea/i.test(document.activeElement?.tagName)) return;
  if (openId) {
    const mark = MARKS.find((m) => m.key === event.key);
    const item = items.find((x) => x.id === openId);
    if (mark && item) {
      event.preventDefault();
      await requestMark(item, mark.value);
    }
    return;
  }
  const list = visible();
  if (event.key === 'j') { focus = Math.min(list.length - 1, focus + 1); renderList(); }
  if (event.key === 'k') { focus = Math.max(0, focus - 1); renderList(); }
  if (event.key === 'x') {
    const item = currentItem();
    if (!item) return;
    if (selected.has(item.id)) selected.delete(item.id);
    else selected.add(item.id);
    renderList();
  }
  if (event.key === 'Enter' && currentItem()) openItem(currentItem().id);
  if (event.key === 'c') {
    const row = document.querySelector('.feed-row.is-focus .feed-comment');
    if (row) { row.hidden = false; row.querySelector('input').focus(); }
  }
  if (event.key === 'u' && undo) await undoLast();
  if (event.key === '?') {
    const dlg = $('#feed-help');
    $('#feed-help-body').textContent = t('feed.helpBody');
    dlg.showModal();
  }
  const mark = MARKS.find((m) => m.key === event.key);
  if (mark && tab === 'unmarked') {
    // The key would otherwise land in the "why?" field that this mark may open.
    event.preventDefault();
    if (selected.size) {
      const ids = [...selected];
      selected.clear();
      await markIds(ids, mark.value);
    } else if (currentItem()) await requestMark(currentItem(), mark.value);
  }
});

function openHow() {
  $('#feed-guide').innerHTML = renderMarkdown(t('feed.guide')).html;
  $('#feed-ai-interface').innerHTML = renderMarkdown(t('feed.aiInterface')).html;
  $('#feed-how-prompt').textContent = t('feed.agentPrompt');
  $('#feed-how').showModal();
}

function showHowTab(name) {
  for (const btn of document.querySelectorAll('[data-how-tab]')) btn.classList.toggle('is-active', btn.dataset.howTab === name);
  for (const panel of document.querySelectorAll('[data-how-panel]')) panel.hidden = panel.dataset.howPanel !== name;
}

$('#feed-how-open').addEventListener('click', openHow);
$('#feed-list').addEventListener('click', (event) => {
  if (event.target.closest('[data-open-how]')) openHow();
  if (event.target.closest('[data-open-how-ai]')) { openHow(); showHowTab('ai'); }
  if (event.target.closest('[data-clear-filters]')) {
    filters = { source: '', severity: '', mark: '' };
    focus = 0;
    renderFilters();
    renderList();
  }
  if (event.target.closest('[data-show-history]')) document.querySelector('[data-tab="history"]')?.click();
});
$('#feed-how').addEventListener('click', (event) => {
  if (event.target.closest('[data-how-close]')) $('#feed-how').close();
  const howTab = event.target.closest('[data-how-tab]');
  if (howTab) showHowTab(howTab.dataset.howTab);
});
$('#feed-how-copy').addEventListener('click', async () => {
  const text = $('#feed-how-prompt').textContent;
  try {
    await navigator.clipboard.writeText(text);
    $('#feed-how-copy').textContent = t('feed.copied');
  } catch {
    $('#feed-how-copy').textContent = t('feed.copyFailed');
  }
});
$('#feed-help').addEventListener('click', (event) => {
  if (event.target.closest('[data-help-close]')) $('#feed-help').close();
});

document.addEventListener('epic-board:lang', () => {
  fillChrome();
  renderFilters();
  renderList();
});

// Search links point at `/feed#<id>`: open the tab holding the item and focus it.
function focusFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const item = id && items.find((x) => x.id === id);
  if (!item) return;
  tab = isUnmarked(item) ? 'unmarked' : 'history';
  for (const el of document.querySelectorAll('[data-tab]')) el.classList.toggle('is-active', el.dataset.tab === tab);
  filters = { source: '', severity: '', mark: '' };
  focus = Math.max(0, visible().findIndex((x) => x.id === id));
  renderFilters();
  renderList();
  rowOf(id)?.scrollIntoView({ block: 'center' });
}

load().then(focusFromHash).catch((error) => { $('#feed-list').innerHTML = `<p class="crit">${esc(error.message)}</p>`; });
addEventListener('hashchange', focusFromHash);
setInterval(() => { void load({ soft: true }); }, 8000);
