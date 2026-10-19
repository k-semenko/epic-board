import { icon, logo } from './icons.mjs';
import { t, getLang, setLang, locale } from './i18n.mjs';

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
  badge.textContent = summary.fire > 0 ? `${summary.unmarked} · 🔥${summary.fire}` : String(summary.unmarked);
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
  if (!search) return;

  const input = document.querySelector('#q');
  const box = document.querySelector('#search-results');
  if (!input || !box) return;

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
