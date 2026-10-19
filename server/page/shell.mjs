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
  badge.textContent = String(summary.unmarked);
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

function renderSearchResults(data) {
  const box = document.querySelector('#search-results');
  if (!box) return;
  if (!data?.groups?.length) {
    box.hidden = false;
    box.innerHTML = `<p class="muted">${esc(t('search.empty'))}</p>`;
    return;
  }
  box.hidden = false;
  box.innerHTML = data.groups.map((group) => `
    <section class="search-group">
      <h4>${esc(groupLabel(group.type))}</h4>
      ${group.items.map((item) => `
        <a class="search-hit" href="${esc(item.href)}" data-search-href="${esc(item.href)}">
          <span class="search-hit-text">${esc(item.text).replaceAll('«', '<b>').replaceAll('»', '</b>')}</span>
          <span class="muted">${esc(item.where || '')}</span>
        </a>`).join('')}
      ${group.total > group.items.length ? `<button type="button" class="search-more" data-type="${esc(group.type)}">${esc(t('search.more', { n: group.total - group.items.length }))}</button>` : ''}
    </section>`).join('');
}

async function runSearch(q) {
  const seq = ++searchSeq;
  if (q.trim().length < 2) {
    document.querySelector('#search-results').hidden = true;
    return;
  }
  const scope = location.pathname.startsWith('/e/') ? `epic:${decodeURIComponent(location.pathname.slice(3))}` : 'all';
  const data = await api(`/api/search?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scope)}`);
  if (seq !== searchSeq) return;
  const recent = JSON.parse(localStorage.getItem('epic-board.searchRecent') || '[]');
  localStorage.setItem('epic-board.searchRecent', JSON.stringify([q, ...recent.filter((x) => x !== q)].slice(0, 5)));
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
          ${opened.map((item) => `<a class="search-hit" href="${esc(item.href)}">${esc(item.title)}</a>`).join('') || `<p class="muted">${esc(t('search.emptyRecent'))}</p>`}
        </section>`;
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.top-search')) box.hidden = true;
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
    if (event.key === 'Escape') box.hidden = true;
  });
}

export { api, esc, locale, t, getLang, setLang, refreshFeedBadge, renderBadge };
