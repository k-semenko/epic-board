import { icon, logo } from './icons.mjs';
import { t, getLang, setLang, locale } from './i18n.mjs';
import { renderMarkdown } from './markdown.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, opts) {
  const res = await fetch(path, opts);
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.detail || data.error || res.statusText);
  return data;
}

export function fillChrome(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.outerHTML = icon(el.dataset.icon);
  for (const el of root.querySelectorAll('[data-logo]')) el.outerHTML = logo();
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', t(el.dataset.i18nTitle));
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.setAttribute('placeholder', t(el.dataset.i18nPh));
  const lang = document.querySelector('#lang');
  if (lang) lang.textContent = getLang() === 'ru' ? 'EN' : 'RU';
  document.documentElement.lang = getLang();
}

function renderBadge(summary) {
  const badge = document.querySelector('#feed-badge');
  if (!badge) return;
  if (!summary?.unmarked) {
    badge.hidden = true;
    badge.textContent = '';
    badge.classList.remove('is-fire');
    return;
  }
  badge.hidden = false;
  badge.classList.toggle('is-fire', summary.fire > 0);
  // Red marks fires; the count stays short so the badge never covers the next header button.
  badge.textContent = String(summary.unmarked);
  badge.parentElement?.setAttribute?.('title', summary.fire > 0 ? `${t('nav.feed')} · 🔥${summary.fire}` : t('nav.feed'));
}

let feedRev = null;
let searchTimer = 0;
let searchSeq = 0;

async function refreshFeedBadge() {
  try {
    const rev = await api('/api/feed/rev');
    if (feedRev === rev.rev && feedRev !== null) return;
    feedRev = rev.rev;
    renderBadge(await api('/api/feed/summary'));
  } catch {
    /* service may be offline in export */
  }
}

function groupLabel(type) {
  return t(`search.group.${type}`) || type;
}

// Escapes each segment separately so matched text never becomes markup.
export function markText(text, marks = []) {
  let out = '';
  let at = 0;
  for (const [a, b] of marks) {
    if (a < at || b > text.length) continue;
    out += `${esc(text.slice(at, a))}<b>${esc(text.slice(a, b))}</b>`;
    at = b;
  }
  return out + esc(text.slice(at));
}

const PER_GROUP = 5;
let lastResults = null;
const expanded = new Set();

function hitHtml(item) {
  return `<a class="search-hit" href="${esc(item.href)}" data-search-href="${esc(item.href)}" data-search-title="${esc(item.text)}">
    <span class="search-hit-main"><span class="search-hit-text">${markText(item.text, item.marks)}</span>${item.snippet && !item.marks?.length ? `<span class="search-hit-snippet muted">${markText(item.snippet, item.snippetMarks)}</span>` : ''}</span>
    <span class="muted search-hit-where">${esc(item.where || '')}</span>
  </a>`;
}

function renderSearchResults(data) {
  const box = document.querySelector('#search-results');
  if (!box) return;
  lastResults = data;
  box.hidden = false;
  if (!data?.groups?.length) {
    box.innerHTML = `<p class="muted">${esc(t('search.empty'))}</p>`;
    return;
  }
  box.innerHTML = data.groups.map((group) => {
    const shown = expanded.has(group.type) ? group.items : group.items.slice(0, PER_GROUP);
    const rest = group.total - shown.length;
    return `<section class="search-group">
      <h4>${esc(groupLabel(group.type))}</h4>
      ${shown.map(hitHtml).join('')}
      ${rest > 0 && shown.length < group.items.length ? `<button type="button" class="search-more" data-search-more="${esc(group.type)}">${esc(t('search.more', { n: rest }))}</button>` : ''}
    </section>`;
  }).join('');
}

function rememberOpened(link) {
  try {
    const opened = JSON.parse(localStorage.getItem('epic-board.opened') || '[]');
    const item = { href: link.dataset.searchHref, title: link.dataset.searchTitle || link.textContent.trim() };
    localStorage.setItem('epic-board.opened', JSON.stringify([item, ...opened.filter((x) => x.href !== item.href)].slice(0, 5)));
  } catch { /* storage may be unavailable */ }
}

function moveSearchFocus(box, delta) {
  const hits = [...box.querySelectorAll('.search-hit, .search-more')];
  if (!hits.length) return;
  const at = hits.indexOf(document.activeElement);
  const next = at === -1 ? (delta > 0 ? 0 : hits.length - 1) : Math.max(0, Math.min(hits.length - 1, at + delta));
  hits[next].focus();
}

async function runSearch(q) {
  const seq = ++searchSeq;
  if (q.trim().length < 2) {
    document.querySelector('#search-results').hidden = true;
    return;
  }
  const scope = location.pathname.startsWith('/e/') ? `epic:${decodeURIComponent(location.pathname.slice(3))}` : 'all';
  const data = await api(`/api/search?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scope)}&lang=${getLang()}`);
  if (seq !== searchSeq) return;
  const recent = JSON.parse(localStorage.getItem('epic-board.searchRecent') || '[]');
  localStorage.setItem('epic-board.searchRecent', JSON.stringify([q, ...recent.filter((x) => x !== q)].slice(0, 5)));
  expanded.clear();
  renderSearchResults(data);
}

export function bindShell({ pollMs = 8000, search = true } = {}) {
  fillChrome();
  document.querySelector('#lang')?.addEventListener('click', () => {
    setLang(getLang() === 'ru' ? 'en' : 'ru');
    fillChrome();
    if (typeof Event === 'function') document.dispatchEvent(new Event('epic-board:lang'));
  });
  void refreshFeedBadge();
  setInterval(() => { void refreshFeedBadge(); }, pollMs);
  if (search) bindBoardSearch();
  bindFeedPopover();
  bindStatusStrip({ pollMs });
}

// ---------- Status strip: board-wide work status above every page ----------

const isDashboard = (value) => Boolean(value?.epics && value?.connectors && value?.feed);

export function sparkline(values, { width = 96, height = 22 } = {}) {
  if (!values?.length) return '';
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
  return `<svg class="stat-spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

export function dashboardTiles(d) {
  const silent = d.connectors.silent || [];
  return [
    { icon: 'board', label: 'dash.epics', value: d.epics.total, meta: t('dash.epicsMeta', { total: d.epics.total, pinned: d.epics.pinned }), href: '/' },
    { icon: 'list', label: 'dash.tasks', value: d.tasks.inWork, meta: t('dash.tasksMeta', { blocked: d.tasks.blocked, waiting: d.tasks.waiting }), href: '/tasks', warn: d.tasks.blocked > 0 },
    { icon: 'clock', label: 'dash.waiting', value: d.waiting.open, meta: d.waiting.oldestDays === null ? '' : t('dash.waitingMeta', { n: d.waiting.oldestDays }), href: '/tasks?waiting=1', warn: d.waiting.open > 0 },
    { icon: 'branch', label: 'dash.mr', value: d.mr.open, meta: t('dash.mrMeta', { n: d.mr.red }), action: 'data-open-mr', warn: d.mr.red > 0 },
    { icon: 'inbox', label: 'dash.feed', value: d.feed.unmarked, meta: d.feed.fire ? `🔥${d.feed.fire}` : '', spark: d.feed.spark, action: 'data-open-feed', href: '/feed', warn: d.feed.fire > 0 },
    { icon: 'link', label: 'dash.connectors', value: d.connectors.active, meta: silent.length ? t('dash.connectorsSilent', { n: silent.length }) : t('dash.connectorsOk'), title: silent.join(', '), href: '/feed', warn: silent.length > 0 },
  ].map((tile) => {
    const body = `<span class="stat-label">${icon(tile.icon)}${esc(t(tile.label))}</span><span class="stat-value">${tile.value}${tile.spark ? sparkline(tile.spark) : ''}</span><span class="stat-meta">${esc(tile.meta || '')}</span>`;
    const cls = `stat${tile.warn ? ' is-warn' : ''}`;
    const title = tile.title ? ` title="${esc(tile.title)}"` : '';
    if (tile.action && !tile.href) return `<button type="button" class="${cls}" ${tile.action}${title}>${body}</button>`;
    return `<a class="${cls}" href="${tile.href}"${tile.action ? ` ${tile.action}` : ''}${title}>${body}</a>`;
  }).join('');
}

// The overview pages carry the strip; epic and settings pages keep their space for their own content.
const STRIP_PAGES = ['/', '/tasks', '/feed'];

export function bindStatusStrip({ pollMs = 8000 } = {}) {
  if (!STRIP_PAGES.includes(location.pathname)) return;
  const main = document.querySelector('main.wrap');
  if (!main || !main.prepend || document.querySelector('#status-strip')) return;
  const strip = Object.assign(document.createElement('section'), { id: 'status-strip', className: 'stats dash status-strip' });
  strip.setAttribute('aria-label', t('dash.title'));
  main.prepend(strip);
  let last = '';
  const draw = async () => {
    try {
      const data = await api('/api/dashboard');
      if (!isDashboard(data)) return;
      const html = dashboardTiles(data);
      if (html !== last) { strip.innerHTML = html; last = html; }
    } catch { /* service may be offline */ }
  };
  void draw();
  setInterval(() => { void draw(); }, pollMs);
  document.addEventListener('epic-board:lang', () => { last = ''; void draw(); });
  strip.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-mr]')) { event.preventDefault(); void openMergeRequests(); return; }
    const feed = event.target.closest('[data-open-feed]');
    // The feed tile opens the header popover where there is one, so triage never leaves the page.
    if (feed && document.querySelector('#feed-pop') && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      document.querySelector('.topbar-feed')?.click();
    }
  });
}

// ---------- Merge requests dialog ----------

// Staleness shows in the check time on the right, so it is not repeated as a chip.
const MR_PROBLEMS = ['pipeline', 'sha', 'unpushed', 'missing', 'error'];
let mrTab = 'open';
let mrItems = [];

function mrRow(mr) {
  const ago = mr.checkedAt ? agoShort(mr.checkedAt) : null;
  const pipe = mr.pipeline ? `<span class="mr-pipe pipe-${esc(mr.pipeline)}" title="${esc(t('mr.pipeline', { s: mr.pipeline }))}">${esc(t(`mr.pipe.${mr.pipeline}`) || mr.pipeline)}</span>` : '';
  const problems = mr.problems.filter((p) => MR_PROBLEMS.includes(p)).map((p) => `<span class="chip chip-warn">${esc(t(`mr.problem.${p}`, { n: mr.unpushed ?? 0, ago: ago || '—' }))}</span>`).join('');
  const drift = [mr.behind ? `↓${mr.behind}` : '', mr.ahead ? `↑${mr.ahead}` : ''].filter(Boolean).join(' ');
  return `<li class="mr-row state-${esc(mr.state)}" data-mr-epic="${esc(mr.epic)}" data-mr-branch="${esc(`${mr.repo}:${mr.branch}`)}">
    <div class="mr-main">
      <div class="mr-line">
        <span class="mr-state">${esc(t(`mr.state.${mr.state}`))}</span>
        ${mr.url ? `<a href="${esc(mr.url)}" target="_blank" rel="noopener" class="mr-iid">!${esc(mr.iid ?? '')}</a>` : `<span class="mr-iid">!${esc(mr.iid ?? '')}</span>`}
        <a href="/e/${encodeURIComponent(mr.epic)}#t-${encodeURIComponent(mr.task)}" class="mr-task">${esc(mr.taskTitle || mr.task)}</a>
        ${pipe}
      </div>
      <div class="mr-sub"><code>${esc(mr.repo)}:${esc(mr.branch)}</code>${mr.base ? ` → <code>${esc(mr.base)}</code>` : ''}${drift ? ` <span title="${esc(t('mr.drift'))}">${esc(drift)}</span>` : ''}${mr.subject ? ` · <span class="mr-subject">${esc(mr.subject)}</span>` : ''}</div>
      ${problems ? `<div class="mr-problems">${problems}</div>` : ''}
    </div>
    <div class="mr-side">
      <span class="muted${mr.problems.includes('stale') ? ' is-stale' : ''}" title="${esc(mr.checkedAt || '')}">${esc(ago ? t('mr.checked', { ago }) : t('mr.neverChecked'))}</span>
      <button type="button" class="icon-btn" data-mr-refresh title="${esc(t('mr.refresh'))}" aria-label="${esc(t('mr.refresh'))}">${icon('refresh')}</button>
    </div>
  </li>`;
}

function renderMergeRequests() {
  const dlg = document.querySelector('#mr-dialog');
  if (!dlg) return;
  const open = mrItems.filter((mr) => ['opened', 'draft', 'unchecked'].includes(mr.state));
  const list = mrTab === 'open' ? open : mrItems;
  const byEpic = new Map();
  for (const mr of list) {
    if (!byEpic.has(mr.epic)) byEpic.set(mr.epic, { title: mr.epicTitle, items: [] });
    byEpic.get(mr.epic).items.push(mr);
  }
  dlg.querySelector('.modal').innerHTML = `
    <header class="modal-head"><h3>${icon('branch')}${esc(t('dash.mr'))}</h3><button type="button" class="icon-btn" data-mr-close aria-label="${esc(t('close'))}">${icon('close')}</button></header>
    <div class="mr-toolbar">
      <div class="view-nav" role="tablist">
        <button type="button" class="${mrTab === 'open' ? 'is-active' : ''}" data-mr-tab="open">${esc(t('mr.tab.open', { n: open.length }))}</button>
        <button type="button" class="${mrTab === 'all' ? 'is-active' : ''}" data-mr-tab="all">${esc(t('mr.tab.all', { n: mrItems.length }))}</button>
      </div>
      <button type="button" data-mr-refresh-all ${open.length ? '' : 'disabled'}>${icon('refresh')}<span>${esc(t('mr.refreshAll'))}</span></button>
    </div>
    ${list.length ? [...byEpic.entries()].map(([id, group]) => `<section class="mr-epic">
      <h4><a href="/e/${encodeURIComponent(id)}">${esc(id)} · ${esc(group.title || '')}</a></h4>
      <ul class="mr-list">${group.items.map(mrRow).join('')}</ul>
    </section>`).join('') : `<p class="muted mr-empty">${esc(t(mrTab === 'open' ? 'mr.emptyOpen' : 'mr.emptyAll'))}</p>`}`;
}

async function loadMergeRequests() {
  mrItems = (await api('/api/merge-requests')).items || [];
  renderMergeRequests();
}

const refreshBranch = (epic, branch) => api(`/api/epics/${encodeURIComponent(epic)}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(branch ? { scope: 'branch', branch } : {}) });

export async function openMergeRequests() {
  let dlg = document.querySelector('#mr-dialog');
  if (!dlg) {
    dlg = Object.assign(document.createElement('dialog'), { id: 'mr-dialog', className: 'board-dialog' });
    dlg.innerHTML = '<div class="modal mr-modal"></div>';
    document.body.append(dlg);
    dlg.addEventListener('click', async (event) => {
      if (event.target === dlg || event.target.closest('[data-mr-close]')) { dlg.close(); return; }
      const tab = event.target.closest('[data-mr-tab]');
      if (tab) { mrTab = tab.dataset.mrTab; renderMergeRequests(); return; }
      const one = event.target.closest('[data-mr-refresh]');
      if (one) {
        const row = one.closest('[data-mr-epic]');
        row.classList.add('is-busy');
        one.disabled = true;
        try { await refreshBranch(row.dataset.mrEpic, row.dataset.mrBranch); } catch (error) { row.querySelector('.mr-side .muted').textContent = error.message; }
        await loadMergeRequests();
        return;
      }
      const all = event.target.closest('[data-mr-refresh-all]');
      if (all) {
        all.disabled = true;
        all.querySelector('span').textContent = t('mr.refreshing');
        const epics = [...new Set(mrItems.filter((mr) => ['opened', 'draft', 'unchecked'].includes(mr.state)).map((mr) => mr.epic))];
        // One epic at a time: each refresh fetches git and asks the forge, and the board limits parallel work itself.
        for (const id of epics) { try { await refreshBranch(id); } catch { /* the row shows the error after reload */ } }
        await loadMergeRequests();
      }
    });
  }
  dlg.querySelector('.modal').innerHTML = `<p class="muted">${esc(t('loading'))}</p>`;
  if (!dlg.open) dlg.showModal();
  try { await loadMergeRequests(); } catch (error) { dlg.querySelector('.modal').innerHTML = `<p class="crit">${esc(error.message)}</p>`; }
}

// ---------- Feed popover: triage from any page without leaving it ----------

const SEV_ORDER = ['fire', 'important', 'normal', 'noise'];
const POP_LIMIT = 20;
const POP_MARKS = [['important', 'thumbUp', 'feed.mark.important'], ['unimportant', 'thumbDown', 'feed.mark.unimportant'], ['noise', 'trash', 'feed.mark.noise']];

function agoShort(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? t('unit.min', { n: m }) : m < 1440 ? t('unit.h', { n: Math.round(m / 60) }) : t('unit.d', { n: Math.round(m / 1440) });
}

const postFeed = (action, body) => api(`/api/feed/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function bindFeedPopover() {
  const btn = document.querySelector('.topbar-feed');
  // On the feed page itself the button stays a plain link.
  if (!btn || !btn.closest || location.pathname === '/feed') return;
  const pop = Object.assign(document.createElement('div'), { id: 'feed-pop', className: 'feed-pop', hidden: true });
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', t('nav.feed'));
  btn.parentElement.append(pop);
  let items = [];
  let total = 0;
  let undo = null;

  const render = () => {
    const list = items.slice(0, POP_LIMIT);
    pop.innerHTML = `
      <header class="feed-pop-head"><strong>${esc(t('nav.feed'))}</strong><span class="muted">${esc(t('feed.pop.unseen', { n: total }))}</span><a href="/feed" class="feed-pop-open">${esc(t('feed.pop.open'))}</a></header>
      ${undo ? `<div class="feed-pop-undo">${icon('check')}<span>${esc(t('feed.toast'))}</span><button type="button" data-pop-undo>${esc(t('feed.undo'))}</button></div>` : ''}
      ${list.length ? `<ul class="feed-pop-list">${list.map((item) => `
        <li class="feed-pop-item sev-${esc(item.severity)}" data-pop-id="${esc(item.id)}">
          <button type="button" class="feed-pop-main" data-pop-toggle aria-expanded="false">
            <span class="feed-pop-title">${esc(item.title)}</span>
            <span class="feed-pop-meta">${esc(item.channel || item.source)} · ${esc(agoShort(item.ts || item.updatedAt))}${item.count > 1 ? ` · ×${item.count}` : ''}</span>
          </button>
          <div class="feed-pop-acts">${POP_MARKS.map(([value, ic, label]) => `<button type="button" class="icon-btn feed-act" data-pop-mark="${value}" title="${esc(t(label))}" aria-label="${esc(t(label))}">${icon(ic)}</button>`).join('')}</div>
          <div class="feed-pop-body markdown" hidden></div>
        </li>`).join('')}</ul>` : `<p class="feed-pop-empty muted">${esc(t('feed.empty'))}</p>`}
      ${total > list.length ? `<a href="/feed" class="feed-pop-more">${esc(t('feed.pop.more', { n: total - list.length }))}</a>` : ''}`;
  };

  const load = async () => {
    const data = await api('/api/feed?unmarked=1');
    const sorted = (data.items || []).sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || String(b.ts || b.updatedAt).localeCompare(String(a.ts || a.updatedAt)));
    items = sorted;
    total = sorted.length;
    render();
  };

  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const open = async () => {
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    pop.innerHTML = `<p class="feed-pop-empty muted">${esc(t('loading'))}</p>`;
    try { await load(); } catch (error) { pop.innerHTML = `<p class="feed-pop-empty crit">${esc(error.message)}</p>`; }
  };
  const refreshBadge = () => { feedRev = null; void refreshFeedBadge(); };

  btn.setAttribute('aria-haspopup', 'dialog');
  btn.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
    event.preventDefault();
    if (pop.hidden) void open();
    else close();
  });
  pop.addEventListener('click', async (event) => {
    const row = event.target.closest('[data-pop-id]');
    const markBtn = event.target.closest('[data-pop-mark]');
    if (markBtn && row) {
      const id = row.dataset.popId;
      await postFeed('mark', { ids: [id], value: markBtn.dataset.popMark });
      undo = id;
      items = items.filter((item) => item.id !== id);
      total -= 1;
      render();
      refreshBadge();
      return;
    }
    if (event.target.closest('[data-pop-undo]') && undo) {
      await postFeed('unmark', { ids: [undo] });
      undo = null;
      await load();
      refreshBadge();
      return;
    }
    const toggle = event.target.closest('[data-pop-toggle]');
    if (toggle && row) {
      const item = items.find((x) => x.id === row.dataset.popId);
      const body = row.querySelector('.feed-pop-body');
      body.hidden = !body.hidden;
      toggle.setAttribute('aria-expanded', String(!body.hidden));
      if (!body.hidden) body.innerHTML = item?.body ? renderMarkdown(item.body).html : `<p class="muted">${esc(t('feed.noBody'))}</p>`;
    }
  });
  document.addEventListener('click', (event) => {
    if (!pop.hidden && !event.target.closest('#feed-pop') && !event.target.closest('.topbar-feed')) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !pop.hidden) { close(); btn.focus(); }
  });
}

// The header field searches the whole board; pages may still filter their own list from the same field.
export function bindBoardSearch() {
  const input = document.querySelector('#q');
  let box = document.querySelector('#search-results');
  if (!input) return;
  if (!box) {
    const area = input.closest?.('.top-search');
    if (!area) return;
    box = Object.assign(document.createElement('div'), { id: 'search-results', className: 'search-results', hidden: true });
    area.append(box);
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { void runSearch(input.value).catch(() => {}); }, 150);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) void runSearch(input.value);
    else {
      const recent = JSON.parse(localStorage.getItem('epic-board.searchRecent') || '[]');
      const opened = JSON.parse(localStorage.getItem('epic-board.opened') || '[]');
      box.hidden = false;
      box.innerHTML = `
        <section class="search-group"><h4>${esc(t('search.recentQueries'))}</h4>
          ${recent.map((q) => `<button type="button" class="search-hit" data-search-fill="${esc(q)}">${esc(q)}</button>`).join('') || `<p class="muted">${esc(t('search.emptyRecent'))}</p>`}
        </section>
        <section class="search-group"><h4>${esc(t('search.recentOpened'))}</h4>
          ${opened.map((item) => `<a class="search-hit" href="${esc(item.href)}" data-search-href="${esc(item.href)}" data-search-title="${esc(item.title)}">${esc(item.title)}</a>`).join('') || `<p class="muted">${esc(t('search.emptyRecent'))}</p>`}
        </section>`;
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.top-search')) box.hidden = true;
    const more = event.target.closest('[data-search-more]');
    if (more) {
      expanded.add(more.dataset.searchMore);
      renderSearchResults(lastResults);
      return;
    }
    const link = event.target.closest('[data-search-href]');
    if (link) rememberOpened(link);
    const fill = event.target.closest('[data-search-fill]');
    if (fill) {
      input.value = fill.dataset.searchFill;
      void runSearch(input.value);
    }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !/input|textarea/i.test(document.activeElement?.tagName))) {
      event.preventDefault();
      input.focus();
      input.select();
    }
    if (event.key === 'Escape') {
      box.hidden = true;
      if (box.contains(document.activeElement)) input.focus();
    }
  });
  const searchArea = document.querySelector('.top-search');
  searchArea?.addEventListener('keydown', (event) => {
    if (box.hidden) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveSearchFocus(box, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key !== 'Enter') return;
    const link = document.activeElement?.closest?.('[data-search-href]') || (document.activeElement === input ? box.querySelector('[data-search-href]') : null);
    if (!link) return;
    event.preventDefault();
    rememberOpened(link);
    if (event.metaKey || event.ctrlKey) window.open(link.href, '_blank', 'noopener');
    else location.href = link.href;
  });
}

export { api, esc, locale, t, getLang, setLang, refreshFeedBadge, renderBadge };
