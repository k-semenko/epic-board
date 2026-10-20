import { moveSection } from './section-order.mjs';
import { icon } from './icons.mjs';
import { bindShell, api, esc, t, fillChrome } from './shell.mjs';

bindShell();
const $ = (sel) => document.querySelector(sel);

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const GROUP_LABEL = { epic: 'settings.group.epic', feed: 'settings.group.feed', notify: 'settings.group.notify' };

let registry = [];
let rev = 0;
let saved = {};
let draft = {};
let group = 'epic';
let conflict = false;

function uiEntries() {
  return registry.filter((entry) => entry.ui !== false);
}

function groups() {
  return [...new Set(uiEntries().map((entry) => entry.group))];
}

function dirty() {
  return uiEntries().some((entry) => !same(draft[entry.key], saved[entry.key]));
}

function showError(message) {
  const box = $('#settings-error');
  if (!message) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  box.hidden = false;
  box.textContent = message;
}

function renderDraftBar() {
  const bar = $('#settings-draft');
  bar.hidden = !dirty();
}

function renderGroups() {
  const nav = $('#settings-groups');
  nav.innerHTML = groups().map((id) => (
    `<button type="button" class="settings-group${id === group ? ' is-active' : ''}" data-group="${esc(id)}">${esc(t(GROUP_LABEL[id] || id))}</button>`
  )).join('');
}

function durationText(value) {
  if (value === 0 || value === '0') return '∞';
  const unit = { d: 'settings.dayUnit', h: 'settings.hourUnit', m: 'settings.minuteUnit' }[String(value).slice(-1)];
  return unit ? `${String(value).slice(0, -1)}${t(unit)}` : String(value);
}

// Defaults read like the controls they belong to, not like stored JSON.
function defaultLabel(entry) {
  const value = entry.default;
  if (entry.type === 'order') return value.map((id) => t(`sec.${id}`)).join(' → ');
  if (entry.type === 'record') return Object.entries(value).map(([id, n]) => `${t(`sec.${id}`)} ${n}`).join(' · ');
  if (entry.type === 'duration') return durationText(value);
  if (entry.type === 'bool') return t(value ? 'settings.on' : 'settings.off');
  if (entry.widget === 'sound') return soundLabel(value);
  if (entry.widget === 'select') return t(`${entry.valueLabel || ''}${value}`);
  if (entry.widget === 'range') return `${value}%`;
  if (entry.widget === 'quiet') return value ? value.replace('-', '–') : t('settings.off');
  if (entry.type === 'string' && value === '') return t('settings.empty');
  if (value === null || value === undefined) return t('settings.auto');
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function renderOrder(entry) {
  const order = [...(draft[entry.key] || [])];
  return `<ol class="section-order-list settings-order" data-key="${esc(entry.key)}">${order.map((id, index) => {
    const name = t(`sec.${id}`);
    return `<li data-order-id="${esc(id)}"><span class="order-grip">${icon('grip')}</span><span class="order-name">${esc(name)}</span>
      <span class="order-controls">
        <button type="button" class="icon-btn" data-move="-1" aria-label="${esc(t('settings.up', { name }))}" ${index === 0 ? 'disabled' : ''}>${icon('arrowUp')}</button>
        <button type="button" class="icon-btn" data-move="1" aria-label="${esc(t('settings.down', { name }))}" ${index === order.length - 1 ? 'disabled' : ''}>${icon('arrowDown')}</button>
      </span></li>`;
  }).join('')}</ol>`;
}

function renderRecord(entry) {
  const fields = entry.constraints?.fields || {};
  const value = draft[entry.key] || {};
  return `<div class="settings-record" data-key="${esc(entry.key)}">${Object.keys(fields).map((id) => `
    <label class="settings-field-inline"><span>${esc(t(`sec.${id}`))}</span>
      <select class="settings-select" data-record-field="${esc(id)}">${fields[id].values.map((option) => `<option value="${option}" ${value[id] === option ? 'selected' : ''}>${option}</option>`).join('')}</select>
    </label>`).join('')}</div>`;
}

function renderEnum(entry) {
  const values = entry.constraints?.values || [];
  const current = draft[entry.key];
  return `<div class="settings-enum" data-key="${esc(entry.key)}">${values.map((option) => `
    <button type="button" class="chip${current === option ? ' is-active' : ''}" data-enum="${esc(option)}">${esc(t(`map.height.${option}`) || option)}</button>`).join('')}
    <button type="button" class="chip${current === null ? ' is-active' : ''}" data-enum="">${esc(t('settings.default'))}</button>
  </div>`;
}

function soundLabel(id) {
  if (id === 'none') return t('sound.none');
  const [kind, name] = id.split(':');
  return kind === 'board' ? t(`sound.${name}`) || name : name;
}

const SOUND_GROUPS = [
  ['sound.group.quiet', ['pop', 'droplet', 'tick']],
  ['sound.group.notable', ['chime', 'marimba', 'bell', 'ping']],
  ['sound.group.loud', ['alarm', 'siren', 'klaxon', 'redalert']],
];

function renderSound(entry, off) {
  const values = entry.constraints?.values || [];
  const option = (id) => `<option value="${esc(id)}" ${draft[entry.key] === id ? 'selected' : ''}>${esc(soundLabel(id))}</option>`;
  const board = SOUND_GROUPS.map(([label, names]) => `<optgroup label="${esc(t(label))}">${names.map((n) => `board:${n}`).filter((id) => values.includes(id)).map(option).join('')}</optgroup>`).join('');
  const mac = `<optgroup label="${esc(t('sound.group.mac'))}">${values.filter((id) => id.startsWith('mac:')).map(option).join('')}</optgroup>`;
  return `<div class="settings-sound">
    <select class="settings-select" data-select ${off ? 'disabled' : ''}>${option('none')}${board}${mac}</select>
    <button type="button" class="icon-btn settings-play" data-play ${off || draft[entry.key] === 'none' ? 'disabled' : ''} title="${esc(t('sound.play'))}" aria-label="${esc(t('sound.play'))}">${icon('play')}</button>
  </div>`;
}

function renderSelect(entry, off) {
  const values = entry.constraints?.values || [];
  return `<select class="settings-select" data-select ${off ? 'disabled' : ''}>${values.map((id) => `<option value="${esc(id)}" ${draft[entry.key] === id ? 'selected' : ''}>${esc(t(`${entry.valueLabel || ''}${id}`))}</option>`).join('')}</select>`;
}

function renderRange(entry, off) {
  const { min = 0, max = 100 } = entry.constraints || {};
  return `<label class="settings-range"><input type="range" min="${min}" max="${max}" step="5" value="${esc(draft[entry.key])}" data-range ${off ? 'disabled' : ''} aria-label="${esc(t(entry.label))}"><output>${esc(draft[entry.key])}%</output></label>`;
}

// Stored as "HH:MM-HH:MM" or ""; edited as a switch and two time fields.
function renderQuiet(entry, off) {
  const value = draft[entry.key] || '';
  const [from = '22:00', to = '08:00'] = value ? value.split('-') : [];
  return `<div class="settings-quiet">
    <label class="settings-toggle"><input type="checkbox" role="switch" data-quiet-toggle ${value ? 'checked' : ''} ${off ? 'disabled' : ''} aria-label="${esc(t(entry.label))}"></label>
    <label class="settings-time"><span>${esc(t('settings.quiet.from'))}</span><input type="time" class="settings-input" data-quiet-from value="${esc(from)}" ${off || !value ? 'disabled' : ''}></label>
    <label class="settings-time"><span>${esc(t('settings.quiet.to'))}</span><input type="time" class="settings-input" data-quiet-to value="${esc(to)}" ${off || !value ? 'disabled' : ''}></label>
  </div>`;
}

// While notifications are off, everything else in the group is shown dimmed and cannot be changed.
const isOff = (entry) => entry.key.startsWith('feed.notify.') && entry.key !== 'feed.notify.enabled' && !draft['feed.notify.enabled'];

function renderControl(entry, off) {
  if (entry.type === 'order') return renderOrder(entry);
  if (entry.type === 'record') return renderRecord(entry);
  if (entry.widget === 'sound') return renderSound(entry, off);
  if (entry.widget === 'select') return renderSelect(entry, off);
  if (entry.widget === 'range') return renderRange(entry, off);
  if (entry.widget === 'quiet') return renderQuiet(entry, off);
  if (entry.type === 'enum') return renderEnum(entry);
  if (entry.type === 'bool') {
    return `<label class="settings-toggle"><input type="checkbox" role="switch" data-bool ${draft[entry.key] ? 'checked' : ''} ${off ? 'disabled' : ''} aria-label="${esc(t(entry.label))}"></label>`;
  }
  if (entry.type === 'duration') {
    const chips = ['7d', '14d', '30d', '180d', '0'];
    return `<div class="settings-duration" data-key="${esc(entry.key)}">${chips.map((chip) => `
      <button type="button" class="chip${draft[entry.key] === chip || (chip === '0' && draft[entry.key] === 0) ? ' is-active' : ''}" data-duration="${chip}">${durationText(chip)}</button>`).join('')}
      <input type="text" class="settings-input settings-duration-input" data-duration-input placeholder="${esc(t('settings.durationHint'))}" value="${esc(draft[entry.key] === 0 ? '0' : draft[entry.key] ?? '')}" spellcheck="false" aria-label="${esc(t(entry.label))}">
    </div>`;
  }
  return `<input type="text" class="settings-input" data-text value="${esc(typeof draft[entry.key] === 'string' ? draft[entry.key] : JSON.stringify(draft[entry.key]))}" aria-label="${esc(t(entry.label))}">`;
}

function renderField(entry) {
  const changed = !same(draft[entry.key], saved[entry.key]);
  const off = isOff(entry);
  const wide = entry.type === 'order' || entry.type === 'record';
  const tip = `${t(entry.hint)}\n${t('settings.defaultValue', { value: defaultLabel(entry) })}`;
  return `<section class="settings-row${wide ? ' is-wide' : ''}${changed ? ' is-changed' : ''}${off ? ' is-off' : ''}" data-setting="${esc(entry.key)}">
    <div class="settings-row-label">
      <span class="settings-row-title">${esc(t(entry.label))}</span>
      <span class="settings-hint" tabindex="0" role="img" aria-label="${esc(tip)}" data-tip="${esc(tip)}">?</span>
    </div>
    <div class="settings-row-control">${renderControl(entry, off)}</div>
  </section>`;
}

function renderFields() {
  const entries = uiEntries().filter((entry) => entry.group === group);
  const allDefault = entries.every((entry) => same(draft[entry.key], entry.default));
  $('#settings-fields').innerHTML = entries.length
    ? `<div class="settings-card">${entries.map(renderField).join('')}</div>
      <div class="settings-card-foot"><button type="button" data-reset-group ${allDefault ? 'disabled' : ''}>${icon('undo')}<span>${esc(t('settings.resetGroup'))}</span></button></div>`
    : `<p class="muted">${esc(t('settings.emptyGroup'))}</p>`;
  fillChrome($('#settings-fields'));
  renderDraftBar();
}

function render() {
  fillChrome();
  renderGroups();
  renderFields();
  if (conflict) showError(t('settings.conflict'));
}

function setDraft(key, value) {
  draft = { ...draft, [key]: value };
  conflict = false;
  showError('');
  renderFields();
}

async function load() {
  const [reg, state] = await Promise.all([api('/api/settings/registry'), api('/api/settings')]);
  registry = reg.settings || [];
  rev = state.rev;
  saved = { ...state.values };
  draft = structuredClone(saved);
  const available = groups();
  if (!available.includes(group)) group = available[0] || 'epic';
  if (!showLinked()) render();
}

// Search links land on `/settings#<key>`: open that key's group and bring it into view.
function showLinked() {
  const linked = registry.find((entry) => entry.key === decodeURIComponent(location.hash.slice(1)));
  if (!linked) return false;
  group = linked.group;
  render();
  document.querySelector(`[data-setting="${CSS.escape(linked.key)}"]`)?.scrollIntoView({ block: 'center' });
  return true;
}
addEventListener('hashchange', showLinked);

async function save() {
  const patch = {};
  for (const entry of uiEntries()) {
    if (!same(draft[entry.key], saved[entry.key])) patch[entry.key] = draft[entry.key];
  }
  if (!Object.keys(patch).length) return;
  try {
    const state = await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev, patch }) });
    rev = state.rev;
    saved = { ...state.values };
    draft = structuredClone(saved);
    conflict = false;
    showError('');
    render();
  } catch (error) {
    if (/rev is|settings-conflict|409/.test(error.message)) {
      conflict = true;
      const state = await api('/api/settings');
      rev = state.rev;
      saved = { ...state.values };
      render();
      showError(t('settings.conflict'));
      return;
    }
    showError(error.message);
  }
}

function discard() {
  draft = structuredClone(saved);
  conflict = false;
  showError('');
  render();
}

$('#settings-groups').addEventListener('click', (event) => {
  const button = event.target.closest('[data-group]');
  if (!button) return;
  group = button.dataset.group;
  render();
});

$('#settings-fields').addEventListener('click', (event) => {
  // One reset per group: it fills the draft with defaults, and Save or Discard decides.
  if (event.target.closest('[data-reset-group]')) {
    const entries = uiEntries().filter((entry) => entry.group === group);
    if (!confirm(t('settings.resetGroupConfirm', { group: t(GROUP_LABEL[group] || group) }))) return;
    draft = { ...draft, ...Object.fromEntries(entries.map((entry) => [entry.key, structuredClone(entry.default)])) };
    conflict = false;
    showError('');
    renderFields();
    return;
  }
  const item = event.target.closest('[data-setting]');
  if (!item) return;
  const key = item.dataset.setting;
  const entry = registry.find((row) => row.key === key);
  if (!entry) return;
  const move = event.target.closest('[data-move]');
  if (move && entry.type === 'order') {
    const id = move.closest('[data-order-id]').dataset.orderId;
    const delta = Number(move.dataset.move);
    const order = [...draft[key]];
    setDraft(key, moveSection(order, id, order.indexOf(id) + delta));
    return;
  }
  if (event.target.closest('[data-play]')) {
    void api('/api/notify/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sound: draft[key], volume: draft['feed.notify.volume'] }) })
      .catch((error) => showError(error.message));
    return;
  }
  const enumBtn = event.target.closest('[data-enum]');
  if (enumBtn && entry.type === 'enum') {
    setDraft(key, enumBtn.dataset.enum === '' ? null : enumBtn.dataset.enum);
    return;
  }
  const duration = event.target.closest('[data-duration]');
  if (duration && entry.type === 'duration') {
    const value = duration.dataset.duration === '0' ? 0 : duration.dataset.duration;
    setDraft(key, value);
  }
});

$('#settings-fields').addEventListener('change', (event) => {
  const item = event.target.closest('[data-setting]');
  if (!item) return;
  const key = item.dataset.setting;
  const entry = registry.find((row) => row.key === key);
  if (!entry) return;
  if (event.target.matches('[data-bool]')) {
    setDraft(key, event.target.checked);
    return;
  }
  if (event.target.matches('[data-quiet-toggle]')) {
    setDraft(key, event.target.checked ? '22:00-08:00' : '');
    return;
  }
  if (event.target.matches('[data-quiet-from], [data-quiet-to]')) {
    const from = item.querySelector('[data-quiet-from]').value;
    const to = item.querySelector('[data-quiet-to]').value;
    if (from && to) setDraft(key, `${from}-${to}`);
    return;
  }
  if (event.target.matches('[data-select]')) {
    setDraft(key, event.target.value);
    return;
  }
  if (event.target.matches('[data-range]')) {
    setDraft(key, Number(event.target.value));
    return;
  }
  if (event.target.matches('[data-record-field]')) {
    setDraft(key, { ...draft[key], [event.target.dataset.recordField]: Number(event.target.value) });
  }
});

$('#settings-fields').addEventListener('change', (event) => {
  if (!event.target.matches('[data-duration-input],[data-text]')) return;
  const item = event.target.closest('[data-setting]');
  if (!item) return;
  const key = item.dataset.setting;
  const entry = registry.find((row) => row.key === key);
  if (!entry) return;
  if (entry.type === 'duration') {
    const text = event.target.value.trim();
    setDraft(key, text === '0' ? 0 : text);
    return;
  }
  try {
    setDraft(key, JSON.parse(event.target.value));
  } catch {
    setDraft(key, event.target.value);
  }
});

$('#settings-fields').addEventListener('input', (event) => {
  if (event.target.matches('[data-range]')) event.target.nextElementSibling.textContent = `${event.target.value}%`;
});

$('#settings-save').addEventListener('click', () => { void save(); });
$('#settings-discard').addEventListener('click', discard);
document.addEventListener('epic-board:lang', render);

window.addEventListener('beforeunload', (event) => {
  if (!dirty()) return;
  event.preventDefault();
  event.returnValue = '';
});

load().catch((error) => showError(error.message));
