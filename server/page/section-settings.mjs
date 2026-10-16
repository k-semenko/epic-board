import { normalizeSectionOrder, moveSection } from './section-order.mjs';
import { icon } from './icons.mjs';
import { t } from './i18n.mjs';

export function applySectionOrder(value) {
  const order = normalizeSectionOrder(value);
  const root = document.querySelector('#epic');
  const sections = [...root.querySelectorAll(':scope > [data-section]')];
  if (sections.map((el) => el.dataset.section).join() === order.join()) return;
  for (const id of order) {
    const section = sections.find((el) => el.dataset.section === id);
    if (section) root.append(section);
  }
}

export function bindSectionSettings({ api, onError, onSettings = () => {}, readOnly = false }) {
  let acceptedSettings = {};
  let epoch = 0;
  let latestRead = 0;
  let pendingSaves = 0;
  let saveQueue = Promise.resolve();
  const currentOrder = () => normalizeSectionOrder(acceptedSettings.epicSectionOrder);
  const applySettings = (settings) => {
    acceptedSettings = settings;
    applySectionOrder(settings.epicSectionOrder);
    onSettings(settings);
    return settings;
  };
  const reload = async () => {
    if (pendingSaves) return currentOrder();
    const startedEpoch = epoch;
    const read = ++latestRead;
    const isCurrent = () => startedEpoch === epoch && read === latestRead && !pendingSaves;
    try {
      const settings = await api('/api/settings');
      if (isCurrent()) applySettings(settings);
    } catch (error) {
      if (isCurrent()) throw error;
    }
    return currentOrder();
  };
  if (readOnly) return { reload };
  const save = (body) => {
    epoch++;
    pendingSaves++;
    const saving = saveQueue.then(async () => applySettings(await api('/api/settings', { method: 'PUT', body })));
    saveQueue = saving.catch(() => {});
    return saving.finally(() => { pendingSaves--; });
  };

  const toggle = document.querySelector('#settings-toggle');
  const menu = document.querySelector('#settings-menu');
  const openButton = document.querySelector('#section-order-open');
  const dialog = document.createElement('dialog');
  dialog.className = 'section-order-dialog';
  dialog.setAttribute('aria-labelledby', 'section-order-title');
  document.body.append(dialog);
  let draft = [];
  let saving = false;
  let dragged = null;

  const closeMenu = () => {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };
  const showMenu = () => {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    openButton.focus();
  };
  const renderRows = () => {
    dialog.querySelector('.section-order-list').innerHTML = draft.map((id, index) => {
      const name = t(`sec.${id}`);
      return `<li data-order-id="${id}"><span class="order-grip">${icon('grip')}</span><span class="order-name">${name}</span>
        <span class="order-controls"><button type="button" class="icon-btn" data-move="-1" aria-label="${t('settings.up', { name })}" ${index === 0 ? 'disabled' : ''}>${icon('arrowUp')}</button><button type="button" class="icon-btn" data-move="1" aria-label="${t('settings.down', { name })}" ${index === draft.length - 1 ? 'disabled' : ''}>${icon('arrowDown')}</button></span></li>`;
    }).join('');
  };
  const move = (id, index) => {
    draft = moveSection(draft, id, index);
    renderRows();
    dialog.querySelector('.order-status').textContent = t('settings.moved', { name: t(`sec.${id}`), n: draft.indexOf(id) + 1, total: draft.length });
  };
  const openDialog = async () => {
    closeMenu();
    openButton.disabled = true;
    try {
      draft = await reload();
      dialog.innerHTML = `<div class="modal">
        <header class="modal-head"><h3 id="section-order-title">${t('settings.order')}</h3><button type="button" class="icon-btn" data-order-cancel aria-label="${t('close')}">${icon('close')}</button></header>
        <p class="modal-text" id="section-order-hint">${t('settings.hint')}</p>
        <ol class="section-order-list" aria-describedby="section-order-hint"></ol>
        <span class="order-status sr-only" role="status" aria-live="polite"></span>
        <p class="order-error crit" role="alert" hidden></p>
        <footer class="modal-foot"><button type="button" data-order-cancel>${t('cancel')}</button><button type="button" class="primary" data-order-save>${icon('save')}<span>${t('settings.save')}</span></button></footer>
      </div>`;
      renderRows();
      dialog.showModal();
    } catch (err) {
      onError(err.message);
      toggle.focus();
    } finally {
      openButton.disabled = false;
    }
  };

  toggle.addEventListener('click', () => menu.hidden ? showMenu() : closeMenu());
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      showMenu();
    }
  });
  openButton.addEventListener('click', openDialog);
  menu.addEventListener('keydown', (e) => {
    if (['Escape', 'Tab'].includes(e.key)) closeMenu();
    if (e.key === 'Escape') toggle.focus();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.settings-control')) closeMenu();
  });
  dialog.addEventListener('cancel', (e) => {
    if (saving) e.preventDefault();
  });
  dialog.addEventListener('close', () => toggle.focus());
  dialog.addEventListener('click', async (e) => {
    if (saving) return;
    if (e.target.closest('[data-order-cancel]')) return dialog.close();
    const control = e.target.closest('[data-move]');
    if (control) {
      const id = control.closest('[data-order-id]').dataset.orderId;
      const delta = Number(control.dataset.move);
      const index = draft.indexOf(id) + delta;
      move(id, index);
      const row = dialog.querySelector(`[data-order-id="${id}"]`);
      const next = row.querySelector(`[data-move="${delta}"]`);
      (next.disabled ? row.querySelector('button:not(:disabled)') : next).focus();
      return;
    }
    if (!e.target.closest('[data-order-save]')) return;
    const error = dialog.querySelector('.order-error');
    error.hidden = true;
    saving = true;
    for (const button of dialog.querySelectorAll('button')) button.disabled = true;
    dialog.querySelector('[data-order-save] span').textContent = t('settings.saving');
    try {
      await save({ epicSectionOrder: draft });
      dialog.close();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      saving = false;
      for (const button of dialog.querySelectorAll('button')) button.disabled = false;
      dialog.querySelector('[data-order-save] span').textContent = t('settings.save');
      renderRows();
      if (dialog.open) dialog.querySelector('[data-order-save]').focus();
    }
  });
  dialog.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('[data-order-id]');
    if (!row || e.target.closest('button') || saving || e.button !== 0 || !e.isPrimary) return;
    dragged = { id: row.dataset.orderId, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false, target: null };
    dialog.setPointerCapture(e.pointerId);
  });
  dialog.addEventListener('pointermove', (e) => {
    if (!dragged || dragged.pointerId !== e.pointerId || saving) return;
    if (!dragged.active && Math.hypot(e.clientX - dragged.x, e.clientY - dragged.y) < 5) return;
    e.preventDefault();
    dragged.active = true;
    dialog.classList.add('order-reordering');
    dialog.querySelector(`[data-order-id="${dragged.id}"]`).classList.add('order-dragging');
    for (const item of dialog.querySelectorAll('[data-order-id]')) item.classList.remove('order-drop-before', 'order-drop-after');
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-order-id]');
    dragged.target = null;
    if (!row || !dialog.contains(row) || row.dataset.orderId === dragged.id) return;
    const rect = row.getBoundingClientRect();
    dragged.target = row.dataset.orderId;
    dragged.after = e.clientY >= rect.top + rect.height / 2;
    row.classList.add(dragged.after ? 'order-drop-after' : 'order-drop-before');
  });
  const clearDrag = () => {
    if (dragged && dialog.hasPointerCapture(dragged.pointerId)) dialog.releasePointerCapture(dragged.pointerId);
    dragged = null;
    dialog.classList.remove('order-reordering');
    for (const row of dialog.querySelectorAll('[data-order-id]')) row.classList.remove('order-dragging', 'order-drop-before', 'order-drop-after');
  };
  dialog.addEventListener('pointerup', (e) => {
    if (!dragged || dragged.pointerId !== e.pointerId) return;
    const { id, active, target, after } = dragged;
    clearDrag();
    if (active && target && !saving) {
      const remaining = draft.filter((key) => key !== id);
      move(id, remaining.indexOf(target) + (after ? 1 : 0));
    }
  });
  dialog.addEventListener('pointercancel', clearDrag);
  dialog.addEventListener('lostpointercapture', clearDrag);
  dialog.addEventListener('close', clearDrag);
  return { reload, save };
}
