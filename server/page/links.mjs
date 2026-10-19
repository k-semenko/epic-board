import { t, locale } from './i18n.mjs';
import { icon } from './icons.mjs';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function linkPollState(previous, data, failed = false) {
  const old = previous || { data: null, stale: false };
  if (failed) return { ...old, stale: true, changed: !old.stale };
  return { data, stale: false, changed: old.stale || !old.data || old.data.revision !== data.revision };
}

function stepEdges(state, epic, task, step) {
  const matches = (endpoint) => endpoint.epic === String(epic) && endpoint.task === String(task) && endpoint.step === String(step);
  const foreign = (edge) => edge.source.epic !== edge.target.epic;
  return {
    outgoing: (state?.data?.outgoing || []).filter((edge) => foreign(edge) && matches(edge.source)),
    incoming: (state?.data?.incoming || []).filter((edge) => foreign(edge) && matches(edge.target)),
  };
}

function resolutionText(status) {
  return status === 'unavailable' ? t('links.unavailableTarget') : status === 'resolved' ? '' : t('links.missing');
}

function endpointLink(endpoint, status) {
  const label = endpoint.title ? `${endpoint.epicTitle || endpoint.epic} → ${endpoint.title}` : endpoint.address;
  const href = safeUrl(endpoint.url);
  const name = href ? `<a href="${esc(href)}" title="${esc(endpoint.address)}">${esc(label)}</a>` : `<span title="${esc(endpoint.address)}">${esc(label)}</span>`;
  const state = status === 'resolved' ? t(`state.${endpoint.state || 'todo'}`) : resolutionText(status);
  return `${name} <span class="${status === 'resolved' ? 'muted' : 'warn'}">· ${esc(state)}</span>`;
}

function snapshotTime(readAt) {
  const date = new Date(readAt);
  const label = Number.isFinite(date.getTime()) ? date.toLocaleString(locale()) : readAt;
  return `<time datetime="${esc(readAt)}">${esc(label)}</time>`;
}

export function renderLinkStatus(state, { exported = false, index = false } = {}) {
  if (!state?.data) return `<p class="links-status muted" role="status">${esc(t(state?.stale ? index ? 'links.indexUnavailable' : 'links.unavailable' : 'loading'))}</p>`;
  const data = state.data;
  const stamp = data.readAt ? snapshotTime(data.readAt) : '—';
  const status = state.stale
    ? `<p class="links-status warn" role="status">${esc(t(index ? 'links.indexStale' : 'links.stale'))} ${stamp}</p>`
    : `<p class="links-status muted">${esc(t(exported ? 'links.snapshot' : 'links.checked'))} ${stamp}</p>`;
  const warning = data.incomplete ? `<p class="links-status warn" title="${esc((data.errors || []).map((error) => error.id).join(', '))}">${icon('alert')}${esc(t('links.incomplete'))}</p>` : '';
  return `${status}${warning}`;
}

export function renderStepLinks(state, epic, task, step, options = {}) {
  const { outgoing, incoming } = stepEdges(state, epic, task, step);
  const rows = (edges, direction) => edges.map((edge) => `<li data-cross-link-row="${esc(`${direction}:${edge.source.address}:${edge.target.address}`)}">${icon('link')}<span><span class="cross-link-direction">${esc(t(direction === 'outgoing' ? 'links.outgoing' : 'links.incoming'))}</span> ${endpointLink(edge[direction === 'outgoing' ? 'target' : 'source'], direction === 'incoming' ? 'resolved' : edge.status)}${edge.label ? ` <em>${esc(edge.label)}</em>` : ''}</span></li>`).join('');
  const list = outgoing.length || incoming.length ? `<ul class="links cross-links">${rows(outgoing, 'outgoing')}${rows(incoming, 'incoming')}</ul>` : state?.data ? `<p class="muted">${esc(t('links.none'))}</p>` : '';
  return `<h5>${esc(t('links.title'))}</h5>${list}${renderLinkStatus(state, options)}`;
}

export function renderLinkBadge(state, epic, task, step) {
  const edges = stepEdges(state, epic, task, step);
  const count = edges.outgoing.length + edges.incoming.length;
  return count ? `<span class="cross-link-badge${state.stale ? ' stale' : ''}" title="${esc(t('links.badge', { n: count }))}" aria-label="${esc(t('links.badge', { n: count }))}">${icon('link')}${count}</span>` : '';
}

export function renderRelatedEpics(related = [], { incomplete = false } = {}) {
  const links = related.map((epic) => {
    const title = epic.title || epic.id;
    const label = title === epic.id ? epic.id : `${epic.id} · ${title}`;
    const href = safeUrl(epic.url);
    const link = href ? `<a href="${esc(href)}">${esc(label)}</a>` : `<span>${esc(label)}</span>`;
    return `${link}${epic.status !== 'resolved' ? ` <span class="warn">(${esc(resolutionText(epic.status))})</span>` : ''}`;
  });
  if (!links.length && !incomplete) return '';
  return `<div class="related-epics">${links.length ? `<span class="muted">${esc(t('links.related'))}</span> ${links.join('<span class="muted"> · </span>')}` : ''}${incomplete ? `<span class="warn">${icon('alert')}${esc(t('links.incomplete'))}</span>` : ''}</div>`;
}

export function updateLinksDom(root, state, epic, options = {}) {
  for (const panel of root.querySelectorAll('[data-cross-step-links]')) replaceLinkMarkup(panel, renderStepLinks(state, epic, panel.dataset.task, panel.dataset.step, options));
  for (const badge of root.querySelectorAll('[data-cross-link-badge]')) replaceLinkMarkup(badge, renderLinkBadge(state, epic, badge.dataset.task, badge.dataset.step));
}

function replaceLinkMarkup(node, html) {
  if (node.innerHTML === html) return;
  const active = node.ownerDocument?.activeElement;
  const href = active && node.contains(active) ? active.getAttribute?.('href') : null;
  const row = active?.closest?.('[data-cross-link-row]')?.dataset.crossLinkRow;
  node.innerHTML = html;
  if (href) [...node.querySelectorAll('a[href]')].find((anchor) => anchor.getAttribute('href') === href && anchor.closest('[data-cross-link-row]')?.dataset.crossLinkRow === row)?.focus({ preventScroll: true });
}

export function indexRevision(epics) {
  return JSON.stringify(epics.map(({ readAt, ...epic }) => epic));
}
