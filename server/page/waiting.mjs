import { t, locale } from './i18n.mjs';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = (value) => JSON.parse(JSON.stringify(value));

function submissionToken() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const statusOf = (item) => item.status || (item.doneAt ? 'closed' : 'open');
const date = (value) => value ? `<time datetime="${esc(value)}">${esc(new Date(value).toLocaleString(locale()))}</time>` : '';
const requestText = (request) => [request.title, request.details, request.revisionReason, ...(request.input?.options || []).flatMap((o) => [o.text, o.hint]), ...(request.checklist || []).map((c) => c.text)].filter(Boolean).join(' · ');

export function waitingCounts(items) {
  const counts = { open: 0, answered: 0, closed: 0 };
  for (const item of items) counts[statusOf(item)]++;
  return counts;
}

export function waitingSearchText(item) {
  return [requestText(item), item.resolution, ...(item.rounds || []).flatMap((round) => [requestText(round.request), round.response.comment, round.review?.text]), item.legacyClosure ? requestText(item.legacyClosure.request) : '', item.legacyClosure?.resolution].filter(Boolean).join(' · ');
}

function optionsList(request) {
  return `<ul class="wait-option-list">${(request.input?.options || []).map((option) => `<li>${esc(option.text)}${option.hint ? ` <small>${esc(option.hint)}</small>` : ''}${option.recommended ? ` <small>${esc(t('w.recommended'))}</small>` : ''}</li>`).join('')}</ul>`;
}

function responseMarkup(request, response) {
  const labels = (response.selected || []).map((id) => request.input?.options?.find((option) => option.id === id)?.text || id);
  const conditions = (response.checked || []).map((id) => request.checklist?.find((item) => item.id === id)?.text || id);
  const lead = response.clarification ? 'w.clarified' : request.input?.type === 'confirm' ? 'w.confirmed' : '';
  return `<div class="wait-answer"><div class="wait-label">${esc(t('w.answer'))} · ${date(response.at)}${response.by ? ` · ${esc(response.by)}` : ''}</div>
    ${lead ? `<p>${esc(t(lead))}</p>` : `<ul>${labels.map((label) => `<li>${esc(label)}</li>`).join('')}</ul>`}
    ${conditions.length ? `<div class="wait-label">${esc(t('w.prerequisites'))}</div><ul>${conditions.map((text) => `<li>${esc(text)}</li>`).join('')}</ul>` : ''}
    ${response.comment ? `<p class="wait-answer-comment">${esc(response.comment)}</p>` : ''}</div>`;
}

function reviewMarkup(review) {
  return review ? `<div class="wait-outcome ${review.outcome === 'revised' ? 'revised' : ''}"><div class="wait-label">${esc(t(review.outcome === 'revised' ? 'w.returned' : 'w.agentOutcome'))} · ${date(review.at)}${review.by ? ` · ${esc(review.by)}` : ''}</div><p>${esc(review.text)}</p></div>` : '';
}

function requestMarkup(request, renderDetails, refChip) {
  return `<h4>${esc(request.title)}</h4>${request.details ? `<div class="wait-details md">${renderDetails(request.details)}</div>` : ''}
    ${request.revisionReason ? `<p>${esc(request.revisionReason)}</p>` : ''}
    ${request.task ? `<span class="chip">${esc(request.task)}</span>` : ''}${(request.refs || []).map(refChip).join('')}
    ${optionsList(request)}${request.checklist?.length ? `<div class="wait-label">${esc(t('w.prerequisites'))}</div><ul>${request.checklist.map((item) => `<li>${esc(item.text)}</li>`).join('')}</ul>` : ''}`;
}

function historyMarkup(item, currentRound, renderDetails, refChip, revealHistory) {
  const previous = (item.rounds || []).filter((round) => round !== currentRound);
  const legacy = item.legacyClosure;
  if (!previous.length && !legacy) return '';
  return `<details class="wait-history"${revealHistory ? ' open' : ''} data-wait-part="history"><summary>${esc(t('w.history'))} · ${previous.length + (legacy ? 1 : 0)}</summary>
    ${previous.map((round) => `<section class="wait-history-round"><div class="wait-label">${esc(t('w.revision', { n: round.revision }))}</div>${requestMarkup(round.request, renderDetails, refChip)}${responseMarkup(round.request, round.response)}${reviewMarkup(round.review)}</section>`).join('')}
    ${legacy ? `<section class="wait-history-round"><div class="wait-label">${esc(t('w.legacy'))} · ${date(legacy.doneAt)}</div>${requestMarkup(legacy.request, renderDetails, refChip)}${legacy.resolution ? `<p>${esc(legacy.resolution)}</p>` : ''}${legacy.checked?.length ? `<ul>${legacy.checked.map((id) => `<li>${esc(legacy.request.checklist?.find((c) => c.id === id)?.text || id)}</li>`).join('')}</ul>` : ''}</section>` : ''}</details>`;
}

function draftMarkup(draft) {
  return `<div class="wait-history-round"><strong>${esc(draft.request.title)}</strong><div class="wait-label">${esc(t('w.revision', { n: draft.request.revision || 1 }))}</div>
    ${(draft.selected || []).length ? `<ul>${draft.selected.map((id) => `<li>${esc(draft.request.input?.options?.find((o) => o.id === id)?.text || id)}</li>`).join('')}</ul>` : ''}
    ${(draft.checked || []).length ? `<ul>${draft.checked.map((id) => `<li>${esc(draft.request.checklist?.find((c) => c.id === id)?.text || id)}</li>`).join('')}</ul>` : ''}
    ${draft.comment ? `<p class="wait-answer-comment">${esc(draft.comment)}</p>` : ''}</div>`;
}

function formMarkup(item, draft, stale) {
  const input = item.input || { type: 'confirm' };
  const selected = draft?.selected || [];
  const checked = draft?.checked || [];
  const comment = draft?.comment || '';
  return `<form class="wait-form" data-wait-form="${esc(item.id)}" data-version="${esc(item.version)}" aria-label="${esc(t('w.answerFor', { title: item.title }))}">
    <fieldset${stale || draft?.busy ? ' disabled' : ''}>
    ${input.type !== 'confirm' ? `<fieldset><legend>${esc(t(input.type === 'single' ? 'w.chooseSingle' : 'w.chooseMulti'))}</legend><div class="wait-options">${(input.options || []).map((option) => `<label class="wait-option"><input type="${input.type === 'single' ? 'radio' : 'checkbox'}" name="selected" value="${esc(option.id)}"${selected.includes(option.id) && !stale ? ' checked' : ''}><span><span>${esc(option.text)}</span>${option.hint ? `<small>${esc(option.hint)}</small>` : ''}${option.recommended ? `<small>${esc(t('w.recommended'))}</small>` : ''}</span></label>`).join('')}</div></fieldset>` : ''}
    ${item.checklist?.length ? `<fieldset class="wait-prerequisites"><legend>${esc(t('w.prerequisites'))}</legend>${item.checklist.map((condition) => `<label class="wait-option"><input type="checkbox" name="checked" value="${esc(condition.id)}"${checked.includes(condition.id) && !stale ? ' checked' : ''}><span>${esc(condition.text)}</span></label>`).join('')}</fieldset>` : ''}
    <label class="wait-comment"><span class="wait-label">${esc(t('w.comment'))}</span><textarea name="comment" rows="2">${esc(stale ? '' : comment)}</textarea></label>
    <div class="wait-actions"><button class="primary" type="submit" value="agree">${esc(t(draft?.busy && draft.intent !== 'clarify' ? 'w.submitting' : 'w.submit'))}</button><button type="submit" value="clarify">${esc(t(draft?.busy && draft.intent === 'clarify' ? 'w.submitting' : 'w.clarify'))}</button></div></fieldset>
    <p class="wait-error" data-wait-error role="alert"${draft?.error ? '' : ' hidden'}>${esc(draft?.error || '')}</p></form>`;
}

export function renderWaitingCard(item, { draft, readOnly = false, expanded = false, revealHistory = false, renderDetails = esc, refChip = (ref) => `<span class="ref">${esc(ref)}</span>` } = {}) {
  const status = statusOf(item);
  const currentRound = status !== 'open' ? (item.rounds || []).findLast((round) => round.revision === item.revision) : null;
  const stale = Boolean(draft && draft.version !== item.version);
  const type = item.input?.type || 'confirm';
  const oldDrafts = [...(draft?.previous || []), ...(stale ? [draft] : [])];
  return `<li class="wait decision-card" data-status="${esc(status)}" data-sid="w-${esc(item.id)}" id="waiting-${esc(item.id)}" aria-labelledby="waiting-title-${esc(item.id)}">
    <details class="wait-disclosure"${expanded ? ' open' : ''} data-wait-part="card">
    <summary class="wait-summary"><h3 id="waiting-title-${esc(item.id)}">${esc(item.title)}</h3>
    <div class="wait-card-top"><span class="wait-type">${esc(t(`w.type.${type}`))} · ${esc(t(`w.kind.${item.kind || 'other'}`))}</span><span class="wait-status">${esc(t(status === 'open' && item.revisionReason ? 'w.clarification' : `w.status.${status}`))}</span></div></summary>
    <div class="wait-card-body">${item.details ? `<div class="wait-details md">${renderDetails(item.details)}</div>` : ''}
    <div class="wait-meta"><span class="mono">${esc(item.id)}</span><span>${esc(t('w.revision', { n: item.revision || 1 }))}</span>${item.since ? date(item.since) : ''}${item.task ? refChip(`task:${item.task}`) : ''}</div>
    ${item.refs?.length ? `<div class="wait-refs">${item.refs.map(refChip).join('')}</div>` : ''}
    ${item.revisionReason ? `<div class="wait-outcome revised"><div class="wait-label">${esc(t('w.revisionReason'))}</div><p>${esc(item.revisionReason)}</p></div>` : ''}
    ${stale && !readOnly ? `<div class="wait-conflict" role="status"><p>${esc(t('w.stale'))}</p><button type="button" data-wait-refresh="${esc(item.id)}">${esc(t('w.readCurrent'))}</button></div>` : ''}
    ${oldDrafts.length && !readOnly ? `<details class="wait-history"${stale || revealHistory ? ' open' : ''} data-wait-part="drafts"><summary>${esc(t('w.previousDraft'))}</summary>${oldDrafts.map(draftMarkup).join('')}</details>` : ''}
    ${status === 'open' ? (readOnly ? `${optionsList(item)}${item.checklist?.length ? `<div class="wait-label">${esc(t('w.prerequisites'))}</div><ul>${item.checklist.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ul>` : ''}` : formMarkup(item, draft, stale)) : ''}
    ${currentRound ? responseMarkup(currentRound.request, currentRound.response) : ''}
    ${status === 'answered' ? `<p class="wait-next">${esc(t('w.manualHandoff'))}</p>` : ''}
    ${status === 'closed' && currentRound ? reviewMarkup(currentRound.review || { outcome: 'accepted', at: item.doneAt, text: item.resolution }) : ''}
    ${historyMarkup(item, currentRound, renderDetails, refChip, revealHistory)}</div></details></li>`;
}

export class DecisionDrafts {
  constructor(epicId, storage) {
    this.key = `epic-board.decisions.${epicId}`;
    if (storage === undefined) {
      try { storage = globalThis.sessionStorage; } catch {}
    }
    this.storage = storage;
    this.items = Object.create(null);
    try {
      const saved = JSON.parse(storage?.getItem(this.key) || '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const [id, draft] of Object.entries(saved)) {
          if (draft && typeof draft === 'object' && typeof draft.version === 'string' && draft.request && Array.isArray(draft.selected) && Array.isArray(draft.checked) && typeof draft.comment === 'string' && Array.isArray(draft.previous)) {
            this.items[id] = { ...draft, busy: false };
          }
        }
      }
    } catch {}
  }

  save() {
    try { this.storage?.setItem(this.key, JSON.stringify(this.items)); } catch {}
  }

  get(item) {
    if (!this.items[item.id]) this.items[item.id] = { version: item.version, request: clone(item), selected: [], checked: [], comment: '', previous: [] };
    return this.items[item.id];
  }

  peek(id) { return this.items[id]; }

  update(item, fields) {
    const draft = this.get(item);
    if (draft.version !== item.version || draft.busy) return draft;
    const changed = JSON.stringify([draft.selected, draft.checked, draft.comment]) !== JSON.stringify([fields.selected, fields.checked, fields.comment]);
    Object.assign(draft, clone(fields), { error: '' });
    if (changed) delete draft.payload;
    this.save();
    return draft;
  }

  refresh(item) {
    const old = this.get(item);
    const previous = [...(old.previous || []), { ...clone(old), previous: [], busy: false }];
    this.items[item.id] = { version: item.version, request: clone(item), selected: [], checked: [], comment: '', previous };
    this.save();
    return this.items[item.id];
  }

  prepare(item, intent = 'agree') {
    const draft = this.get(item);
    if (draft.version !== item.version) throw new Error(t('w.stale'));
    if (statusOf(item) !== 'open') throw new Error(t('w.stale'));
    if (intent === 'clarify') {
      const comment = draft.comment.trim();
      if (!comment) throw new Error(t('w.invalidClarification'));
      // A changed comment is a different request, so the retry id must not be reused.
      if (draft.intent !== 'clarify' || !draft.payload || draft.payload.comment !== comment) draft.payload = { version: draft.version, submissionId: submissionToken(), comment };
      draft.intent = 'clarify';
      this.save();
      return clone(draft.payload);
    }
    if (draft.intent !== 'agree') delete draft.payload;
    draft.intent = 'agree';
    const type = item.input?.type || 'confirm';
    if (type === 'single' && draft.selected.length !== 1) throw new Error(t('w.invalidSingle'));
    if (type === 'multi' && draft.selected.length < 1) throw new Error(t('w.invalidMulti'));
    if ((item.checklist || []).some((condition) => !draft.checked.includes(condition.id))) throw new Error(t('w.invalidChecklist'));
    if (!draft.payload) draft.payload = { version: draft.version, submissionId: submissionToken(), confirmed: type === 'confirm', selected: [...draft.selected], checked: [...draft.checked], comment: draft.comment };
    this.save();
    return clone(draft.payload);
  }

  async submit(item, send, intent = 'agree') {
    const draft = this.get(item);
    if (draft.busy) return null;
    try {
      const payload = this.prepare(item, intent);
      draft.busy = true;
      draft.error = '';
      this.save();
      const epic = await send(payload);
      this.complete(item.id, payload.version);
      return epic;
    } catch (error) {
      draft.error = error.message;
      throw error;
    } finally {
      draft.busy = false;
      this.save();
    }
  }

  complete(id, version) {
    if (this.items[id]?.version === version) delete this.items[id];
    this.save();
  }
}
