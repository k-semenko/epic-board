import { normalizeSectionOrder, moveSection } from './section-order.mjs';

export { moveSection };

export function applySectionOrder(value) {
  const order = normalizeSectionOrder(value);
  const root = document.querySelector('#epic');
  if (!root) return;
  const sections = [...root.querySelectorAll(':scope > [data-section]')];
  if (sections.map((el) => el.dataset.section).join() === order.join()) return;
  for (const id of order) {
    const section = sections.find((el) => el.dataset.section === id);
    if (section) root.append(section);
  }
}

function asValues(payload) {
  if (payload && typeof payload === 'object' && payload.values && typeof payload.values === 'object') return payload.values;
  return payload || {};
}

/** Load/apply board settings and save patches against the registry keys. */
export function bindSectionSettings({ api, onError, onSettings = () => {}, readOnly = false }) {
  let accepted = { rev: 0, values: {} };
  let epoch = 0;
  let latestRead = 0;
  let pendingSaves = 0;
  let saveQueue = Promise.resolve();

  const applySettings = (payload) => {
    const values = asValues(payload);
    accepted = { rev: Number.isInteger(payload?.rev) ? payload.rev : accepted.rev, values };
    applySectionOrder(values['epic.sectionOrder']);
    onSettings(values);
    return accepted;
  };

  const reload = async () => {
    if (pendingSaves) return accepted.values;
    const startedEpoch = epoch;
    const read = ++latestRead;
    const isCurrent = () => startedEpoch === epoch && read === latestRead && !pendingSaves;
    try {
      const settings = await api('/api/settings');
      if (isCurrent()) applySettings(settings);
    } catch (error) {
      if (isCurrent()) throw error;
    }
    return accepted.values;
  };

  if (readOnly) return { reload, values: () => accepted.values };

  const save = (patch) => {
    epoch++;
    pendingSaves++;
    const saving = saveQueue.then(async () => {
      const body = { rev: accepted.rev, patch };
      return applySettings(await api('/api/settings', { method: 'PUT', body }));
    });
    saveQueue = saving.catch(() => {});
    return saving.finally(() => { pendingSaves--; }).then(() => accepted);
  };

  // Keep the unused onError parameter for call-site compatibility.
  void onError;

  return { reload, save, values: () => accepted.values };
}
