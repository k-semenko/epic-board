import { bindShell, api, esc, t, fillChrome } from './shell.mjs';
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
  { value: 'important', key: '1', label: 'feed.mark.important' },
  { value: 'unimportant', key: '2', label: 'feed.mark.unimportant' },
  { value: 'noise', key: '3', label: 'feed.mark.noise' },
];

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

function rowHtml(item, index) {
  const active = index === focus ? ' is-focus' : '';
  const sel = selected.has(item.id) ? ' is-selected' : '';
  const refs = (item.refs || []).filter((r) => r.startsWith('epic:') || r.startsWith('task:')).slice(0, 3)
    .map((r) => {
      if (r.startsWith('epic:')) return `<a href="/e/${esc(r.slice(5))}">${esc(r.slice(5))}</a>`;
      const [, epic, task] = r.match(/^task:([^/]+)\/(.+)$/) || [];
      return epic ? `<a href="/e/${esc(epic)}#t-${esc(task)}">${esc(task)}</a>` : '';
    }).join(' ');
  return `<li class="feed-row${active}${sel}" data-id="${esc(item.id)}" data-index="${index}">
    <button type="button" class="feed-dot sev-${esc(item.severity)}" aria-label="${esc(item.severity)}"></button>
    <div class="feed-main">
      <div class="feed-line">
        <span class="feed-source">${esc(item.source)}</span>
        ${item.channel ? `<span class="muted">${esc(item.channel)}</span>` : ''}
        <strong>${esc(item.title)}</strong>
        <span class="muted">${esc(ago(item.updatedAt))}</span>
        ${item.count > 1 ? `<span class="chip">×${item.count}</span>` : ''}
        ${item.changedSinceMark ? `<span class="chip">${esc(t('feed.changed'))}</span>` : ''}
        <span class="feed-refs">${refs}</span>
      </div>
      <div class="feed-body" hidden></div>
      <div class="feed-comment" hidden><input type="text" data-i18n-ph="feed.why" placeholder="${esc(t('feed.why'))}"></div>
      <div class="feed-actions">
        ${tab === 'unmarked' ? MARKS.map((m) => `<button type="button" data-mark="${m.value}">${esc(t(m.label))}</button>`).join('') : `
          <button type="button" data-unmark>${esc(t('feed.unmark'))}</button>
          ${MARKS.map((m) => `<button type="button" data-mark="${m.value}">${esc(t(m.label))}</button>`).join('')}
          <button type="button" data-delete>${esc(t('feed.delete'))}</button>`}
      </div>
    </div>
  </li>`;
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
        <button type="button" data-noise-group="${esc(source)}">${esc(t('feed.allNoise'))}</button>
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
  const field = rowOf(item.id)?.querySelector('.feed-comment');
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

$('#feed-list').addEventListener('dblclick', (event) => {
  const row = event.target.closest('[data-id]');
  if (!row) return;
  const body = row.querySelector('.feed-body');
  const item = items.find((x) => x.id === row.dataset.id);
  body.hidden = !body.hidden;
  if (!body.hidden) body.innerHTML = renderMarkdown(item.body || '');
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
  if (event.key === 'Enter') {
    const row = document.querySelector('.feed-row.is-focus');
    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }
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
    if (selected.size) {
      const ids = [...selected];
      selected.clear();
      await markIds(ids, mark.value);
    } else if (currentItem()) await requestMark(currentItem(), mark.value);
  }
});

function openHow() {
  $('#feed-how-prompt').textContent = t('feed.agentPrompt');
  $('#feed-how').showModal();
}

$('#feed-how-open').addEventListener('click', openHow);
$('#feed-list').addEventListener('click', (event) => {
  if (event.target.closest('[data-open-how]')) openHow();
});
$('#feed-how').addEventListener('click', (event) => {
  if (event.target.closest('[data-how-close]')) $('#feed-how').close();
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
