import { icon } from './icons.mjs';
import { t } from './i18n.mjs';

export function paginate(items, page, size) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  page = Math.max(1, Math.min(pages, Number.isFinite(page) ? Math.trunc(page) : 1));
  const offset = (page - 1) * size;
  return { items: items.slice(offset, offset + size), page, pages, total: items.length, from: items.length ? offset + 1 : 0, to: Math.min(offset + size, items.length) };
}

export function renderPagination(block, data, size, { readOnly = false, saving = false } = {}) {
  return `<nav class="pagination" data-page-block="${block}" aria-label="${t('page.aria', { name: t(`sec.${block}`) })}">
    <label>${t('page.size')} <select data-page-size="${block}"${readOnly || saving ? ' disabled' : ''}>${[5, 10, 15].map((value) => `<option value="${value}"${value === size ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
    <span class="pagination-range">${t('page.range', { from: data.from, to: data.to, total: data.total })}</span>
    <div class="pagination-actions"><button type="button" class="icon-btn" data-page="${data.page - 1}"${data.page === 1 ? ' disabled' : ''} aria-label="${t('page.previous')}">${icon('arrowLeft')}</button><span>${t('page.number', { page: data.page, total: data.pages })}</span><button type="button" class="icon-btn" data-page="${data.page + 1}"${data.page === data.pages ? ' disabled' : ''} aria-label="${t('page.next')}">${icon('arrowRight')}</button></div>
  </nav>`;
}
