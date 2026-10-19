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
let pending = null; // { id, value } waits for an optional "why?" before marking

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

function visible() {
  let list = items.filter((item) => (tab === 'unmarked' ? isUnmarked(item) : Boolean(item.mark)));
  if (filters.source) list = list.filter((item) => item.source === filters.source);
  if (filters.severity) list = list.filter((item) => item.severity === filters.severity);
  if (tab === 'history' && filters.mark) list = list.filter((item) => item.mark?.value === filters.mark);
  if (tab === 'unmarked') {
    // Same order the page draws: fires, then one group per source; keyboard focus indexes into it.
    const fire = list.filter((item) => item.severity === 'fire');
    const bySource = new Map();
    for (const item of list.filter((x) => x.severity !== 'fire')) {
      if (!bySource.has(item.source)) bySource.set(item.source, []);
      bySource.get(item.source).push(item);
    }
    return [...fire, ...[...bySource.values()].flat()];
  }
  return list.sort((a, b) => String(b.mark?.at || b.updatedAt).localeCompare(String(a.mark?.at || a.updatedAt)));
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

function renderFilters() {
  const sources = [...new Set(items.map((item) => item.source))].sort();
  $('#feed-filters').innerHTML = `
    <label>${esc(t('feed.filter.source'))}
      <select data-filter="source"><option value="">${esc(t('feed.filter.all'))}</option>${sources.map((s) => `<option value="${esc(s)}" ${filters.source === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
    </label>
    <label>${esc(t('feed.filter.severity'))}
      <select data-filter="severity"><option value="">${esc(t('feed.filter.all'))}</option>${['fire', 'important', 'normal', 'noise'].map((s) => `<option value="${s}" ${filters.severity === s ? 'selected' : ''}>${esc(t(`feed.sev.${s}`))}</option>`).join('')}</select>
    </label>
    ${tab === 'history' ? `<label>${esc(t('feed.filter.mark'))}
      <select data-filter="mark"><option value="">${esc(t('feed.filter.all'))}</option>${MARKS.map((m) => `<option value="${m.value}" ${filters.mark === m.value ? 'selected' : ''}>${esc(t(m.label))}</option>`).join('')}</select>
    </label>` : ''}`;
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
  return lines.join('\n');
}

const LONG_BODY = 320;
const isLong = (body) => body.length > LONG_BODY || body.split('\n').length > 5;

function headHtml(item) {
  return `<span class="feed-sev sev-${esc(item.severity)}">${esc(t(`feed.sev.${item.severity}`))}</span>
    <span class="feed-source">${esc(item.source)}</span>
    ${item.channel ? `<span class="feed-channel">${esc(item.channel)}</span>` : ''}
    <span class="feed-card-meta">
      ${item.changedSinceMark ? `<span class="chip chip-warn">${esc(t('feed.changed'))}</span>` : ''}
      ${item.count > 1 ? `<span class="chip" title="${esc(t('feed.repeats', { n: item.count }))}">×${item.count}</span>` : ''}
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
    <h3 class="feed-title"><button type="button" class="feed-open" data-open>${esc(item.title)}</button></h3>
    ${body ? `<div class="feed-preview markdown${isLong(body) ? ' is-clamped' : ''}" data-open>${renderMarkdown(body).html}</div>` : ''}
    ${body && isLong(body) ? `<button type="button" class="feed-readmore" data-open>${esc(t('feed.readMore'))}</button>` : ''}
    <div class="feed-comment" hidden><input type="text" data-i18n-ph="feed.why" placeholder="${esc(t('feed.why'))}"></div>
    <footer class="feed-card-foot">
      <div class="feed-refs">${tab === 'history' ? markNote(item) : ''}${refChips(item)}</div>
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
    <footer class="modal-foot feed-item-foot">${actionsHtml(item, { labels: true })}</footer>`;
  if (!dlg.open) dlg.showModal();
}

function closeItem() {
  openId = null;
  const dlg = $('#feed-item');
  if (dlg.open) dlg.close();
}

function renderList() {
  const list = visible();
  const root = $('#feed-list');
  if (!list.length) {
    const noiseToday = items.filter((item) => item.mark?.value === 'noise' && item.mark.at?.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
    root.innerHTML = `<p class="feed-empty">${esc(t('feed.empty'))}<br><span class="muted">${esc(t('feed.emptyNoise', { n: noiseToday }))}</span><br><button type="button" data-open-how>${esc(t('feed.how'))}</button></p>`;
    return;
  }
  if (tab === 'unmarked') {
    const fire = list.filter((item) => item.severity === 'fire');
    const bySource = new Map();
    for (const item of list.filter((item) => item.severity !== 'fire')) {
      if (!bySource.has(item.source)) bySource.set(item.source, []);
      bySource.get(item.source).push(item);
    }
    let html = '';
    let index = 0;
    if (fire.length) {
      html += `<section class="feed-group"><header class="day-head"><h2>${esc(t('feed.fire'))} · ${fire.length}</h2></header><ul class="list feed-rows">${fire.map((item) => rowHtml(item, index++)).join('')}</ul></section>`;
    }
    for (const [source, group] of bySource) {
      html += `<section class="feed-group" data-source="${esc(source)}"><header class="day-head">
        <h2>${esc(source)} · ${group.length}</h2>
        <button type="button" class="feed-group-noise" data-noise-group="${esc(source)}">${icon('trash')}<span>${esc(t('feed.allNoise'))}</span></button>
      </header><ul class="list feed-rows">${group.map((item) => rowHtml(item, index++)).join('')}</ul></section>`;
    }
    root.innerHTML = html;
  } else {
    root.innerHTML = `<ul class="list feed-rows">${list.map((item, index) => rowHtml(item, index)).join('')}</ul>`;
  }
  focus = Math.min(focus, Math.max(0, list.length - 1));
  root.querySelector(`[data-index="${focus}"]`)?.classList.add('is-focus');
  void renderProfile();
}

async function renderProfile() {
  const panel = $('#feed-profile');
  if (!filters.source) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  panel.hidden = false;
  try {
    const [agg, text] = await Promise.all([
      api(`/api/feed/profile?source=${encodeURIComponent(filters.source)}`),
      api(`/api/feed/profile?source=${encodeURIComponent(filters.source)}&text=1`),
    ]);
    panel.innerHTML = `<h3>${esc(filters.source)}</h3>
      <pre class="feed-profile-text">${esc(text.text || t('feed.noProfile'))}</pre>
      <table class="feed-matrix">${Object.entries(agg.matrix).filter(([, n]) => n).map(([k, n]) => `<tr><td>${esc(k)}</td><td>${n}</td></tr>`).join('')}</table>`;
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

$('#feed-filters').addEventListener('change', (event) => {
  const sel = event.target.closest('[data-filter]');
  if (!sel) return;
  filters[sel.dataset.filter] = sel.value;
  focus = 0;
  renderList();
});

$('#feed-list').addEventListener('click', async (event) => {
  const row = event.target.closest('[data-id]');
  if (row) focus = Number(row.dataset.index);
  if (event.target.closest('[data-noise-group]')) {
    const source = event.target.closest('[data-noise-group]').dataset.noiseGroup;
    const ids = visible().filter((item) => item.source === source && item.severity !== 'fire').map((item) => item.id);
    await markIds(ids, 'noise');
    return;
  }
  if (event.target.closest('[data-mark]')) {
    const value = event.target.closest('[data-mark]').dataset.mark;
    const item = items.find((x) => x.id === row.dataset.id);
    await requestMark(item, value);
    return;
  }
  if (event.target.closest('[data-open]') && !event.target.closest('a')) {
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
