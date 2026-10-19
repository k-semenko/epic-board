import { t, getLang, setLang, locale } from './i18n.mjs';
import { icon, logo } from './icons.mjs';
import { refreshFeedBadge, bindBoardSearch } from './shell.mjs';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SORTS = ['source', 'name', 'id', 'progress'];
const taskKey = (task) => `${task.epic.id}/${task.id}`;
const compareText = (a, b) => String(a).localeCompare(String(b), locale(), { numeric: true });

export function readTaskFilters(search) {
  const params = new URLSearchParams(search);
  return {
    q: params.get('q') || '', epic: params.get('epic') || '', status: params.get('status') || '',
    waiting: params.get('waiting') === '1', sort: SORTS.includes(params.get('sort')) ? params.get('sort') : 'source',
  };
}

export function taskFiltersUrl(href, filters) {
  const url = new URL(href);
  for (const key of ['q', 'epic', 'status', 'waiting', 'sort']) {
    const value = key === 'waiting' ? (filters.waiting ? '1' : '') : key === 'sort' && filters.sort === 'source' ? '' : filters[key];
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildTaskView(snapshot, filters) {
  const query = filters.q.trim().toLocaleLowerCase();
  const tasks = snapshot.tasks.filter((task) =>
    (!filters.epic || task.epic.id === filters.epic)
    && (!filters.status || task.status === filters.status)
    && (!filters.waiting || task.waiting > 0)
    && (!query || [task.id, task.title, task.epic.id, task.epic.title].some((value) => String(value).toLocaleLowerCase().includes(query))));
  const sort = (items) => [...items].sort((a, b) => {
    if (filters.sort === 'name') return compareText(a.title, b.title);
    if (filters.sort === 'id') return compareText(a.id, b.id);
    if (filters.sort === 'progress') {
      const ratio = (task) => task.progress.total ? task.progress.done / task.progress.total : -1;
      return ratio(b) - ratio(a);
    }
    return 0;
  });
  const grouped = new Map();
  for (const epic of snapshot.epics) grouped.set(epic.id, { epic, tasks: [] });
  for (const task of tasks.filter((item) => item.role !== 'side')) {
    if (!grouped.has(task.epic.id)) grouped.set(task.epic.id, { epic: task.epic, tasks: [] });
    grouped.get(task.epic.id).tasks.push(task);
  }
  return {
    side: sort(tasks.filter((task) => task.role === 'side')),
    groups: [...grouped.values()].filter((group) => group.tasks.length).map((group) => ({ ...group, tasks: sort(group.tasks) })),
    total: tasks.length,
  };
}

function taskRow(task, source) {
  const { done, total } = task.progress;
  const pct = total ? Math.round(done / total * 100) : 0;
  const href = /^\/e\/[^/?#]+#t-[^/]+$/.test(task.url) ? task.url : `/e/${encodeURIComponent(task.epic.id)}#t-${encodeURIComponent(task.id)}`;
  const status = task.status ? `<span class="chip task-tracker-status">${esc(task.status)}</span>` : `<span class="muted task-tracker-status">${esc(t('tasks.noStatus'))}</span>`;
  return `<li><a class="task-row" data-task-key="${esc(taskKey(task))}" data-task-focus="task:${esc(taskKey(task))}" href="${esc(href)}">
    <span class="task-row-main"><span class="task-row-heading"><span class="mono">${esc(task.id)}</span><strong>${esc(task.title)}</strong></span>${source ? `<span class="task-source muted">${esc(task.epic.title)} <span class="mono">${esc(task.epic.id)}</span></span>` : ''}</span>
    ${status}<span class="task-progress"><span class="mono">${done}/${total}</span><progress max="100" value="${pct}" aria-label="${esc(t('tasks.progress', { done, total }))}">${pct}%</progress></span>
    <span class="task-pending${task.waiting ? ' warn' : ' muted'}">${icon(task.waiting ? 'clock' : 'check')}<span>${esc(t(task.waiting ? 'tasks.waiting' : 'tasks.noWaiting', { n: task.waiting }))}</span></span>${icon('arrowRight')}
  </a></li>`;
}

export function renderTaskGroups(view) {
  const list = (tasks, source) => `<ul class="task-rows">${tasks.map((task) => taskRow(task, source)).join('')}</ul>`;
  const side = view.side.length ? `<section class="tasks-group tasks-side"><h2>${esc(t('tasks.side'))}<span class="tasks-group-count mono">${view.side.length}</span></h2>${list(view.side, true)}</section>` : '';
  return side + view.groups.map(({ epic, tasks }) => `<section class="tasks-group"><h2><a data-task-focus="epic:${esc(epic.id)}" href="/e/${encodeURIComponent(epic.id)}"><span class="mono">${esc(epic.id)}</span> · ${esc(epic.title)}</a><span class="tasks-group-count mono">${tasks.length}</span></h2>${list(tasks, false)}</section>`).join('');
}

function translate(document) {
  document.documentElement.lang = getLang();
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-ph]')) element.placeholder = t(element.dataset.i18nPh);
  for (const element of document.querySelectorAll('[data-i18n-aria]')) element.setAttribute('aria-label', t(element.dataset.i18nAria));
}

export async function initTasksPage({ document = globalThis.document, window = globalThis.window, fetch = globalThis.fetch, interval = globalThis.setInterval } = {}) {
  const byId = (id) => document.getElementById(id);
  const controls = { q: byId('q'), epic: byId('tasks-epic'), status: byId('tasks-status'), waiting: byId('tasks-waiting'), sort: byId('tasks-sort') };
  const list = byId('tasks-list');
  let filters = readTaskFilters(window.location.search);
  let snapshot = null;
  let failed = false;
  let loading = true;
  let busy = false;

  const options = (control, items, value) => {
    const html = items.map(([id, title]) => `<option value="${esc(id)}">${esc(title)}</option>`).join('');
    if (control.innerHTML !== html) control.innerHTML = html;
    if (control.value !== value) control.value = value;
  };
  const render = () => {
    translate(document);
    byId('lang').textContent = getLang() === 'ru' ? 'EN' : 'RU';
    byId('lang').title = t('lang.switch');
    if (controls.q.value !== filters.q) controls.q.value = filters.q;
    controls.waiting.checked = filters.waiting;
    const epics = (snapshot?.epics || []).map((epic) => [epic.id, epic.title]);
    if (filters.epic && !epics.some(([id]) => id === filters.epic)) epics.push([filters.epic, filters.epic]);
    options(controls.epic, [['', t('tasks.allEpics')], ...epics], filters.epic);
    const statuses = [...new Set((snapshot?.tasks || []).map((task) => task.status).filter(Boolean))].sort(compareText);
    if (filters.status && !statuses.includes(filters.status)) statuses.push(filters.status);
    options(controls.status, [['', t('tasks.allStatuses')], ...statuses.map((status) => [status, status])], filters.status);
    options(controls.sort, SORTS.map((sort) => [sort, t(`tasks.sort.${sort}`)]), filters.sort);
    const view = snapshot ? buildTaskView(snapshot, filters) : null;
    const html = view ? (view.total ? renderTaskGroups(view) : `<p class="muted tasks-empty">${esc(t(snapshot.tasks.length ? 'tasks.noMatches' : 'tasks.empty'))}</p>`) : '';
    if (list.innerHTML !== html) {
      const active = document.activeElement;
      const key = list.contains(active) ? active?.dataset?.taskFocus : null;
      list.innerHTML = html;
      if (key) [...list.querySelectorAll('[data-task-focus]')].find((element) => element.dataset.taskFocus === key)?.focus({ preventScroll: true });
    }
    byId('tasks-summary').textContent = view ? t('tasks.count', { n: view.total, total: snapshot.tasks.length }) : '';
    const messages = [];
    if (loading) messages.push(t('loading'));
    else if (failed) {
      messages.push(t(snapshot ? 'tasks.stale' : 'tasks.unavailable'));
      if (snapshot?.readAt) messages.push(new Date(snapshot.readAt).toLocaleString(locale()));
    }
    if (snapshot?.incomplete) messages.push(t('tasks.partial'));
    byId('tasks-message').textContent = messages.join(' · ');
    byId('tasks-message').hidden = !messages.length;
  };
  const refresh = async () => {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch('/api/tasks');
      if (!response.ok) throw new Error('tasks unavailable');
      const next = await response.json();
      if (!next || !Array.isArray(next.tasks) || !Array.isArray(next.epics)) throw new Error('invalid tasks snapshot');
      snapshot = next;
      failed = false;
    } catch {
      failed = true;
    } finally {
      busy = false;
      loading = false;
      render();
      void refreshFeedBadge();
    }
  };
  for (const [key, control] of Object.entries(controls)) {
    control.addEventListener(key === 'q' ? 'input' : 'change', () => {
      filters = { ...filters, [key]: key === 'waiting' ? control.checked : control.value };
      const next = taskFiltersUrl(window.location.href, filters);
      const current = new URL(window.location.href);
      if (next !== `${current.pathname}${current.search}${current.hash}`) window.history[key === 'q' ? 'replaceState' : 'pushState'](null, '', next);
      render();
    });
  }
  window.addEventListener('popstate', () => { filters = readTaskFilters(window.location.search); render(); });
  byId('lang').addEventListener('click', () => { setLang(getLang() === 'ru' ? 'en' : 'ru'); render(); });
  for (const element of document.querySelectorAll('[data-icon]')) element.outerHTML = icon(element.dataset.icon);
  for (const element of document.querySelectorAll('[data-logo]')) element.outerHTML = logo();
  render();
  await refresh();
  interval(refresh, 10000);
}

if (typeof document !== 'undefined' && document.getElementById('tasks-list')) {
  void initTasksPage();
  bindBoardSearch();
}
