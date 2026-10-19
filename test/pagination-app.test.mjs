import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundleScript } from '../server/export.mjs';

function appHarness() {
  const elements = new Map();
  for (const id of ['waiting', 'decisions', 'history', 'waiting-count', 'waiting-pagination', 'decisions-pagination', 'history-pagination']) {
    const element = {
      markup: '', cards: [],
      get innerHTML() { return this.markup; },
      set innerHTML(html) {
        this.markup = html;
        this.cards = [...html.matchAll(/<li class="wait decision-card"[\s\S]*?<\/details><\/li>/g)].map(([markup]) => {
          const details = [...markup.matchAll(/<details\b([^>]*)>/g)].map(([, attrs]) => ({
            className: attrs.match(/class="([^"]+)"/)?.[1],
            dataset: { waitPart: attrs.match(/data-wait-part="([^"]+)"/)?.[1] },
            open: /\sopen(?:\s|$)/.test(attrs),
          }));
          return { dataset: { sid: markup.match(/data-sid="([^"]+)"/)[1] }, details, querySelectorAll: (selector) => selector === 'details[open]' ? details.filter((detail) => detail.open) : details };
        });
      },
      querySelectorAll(selector) { return selector === '[data-sid]' ? this.cards : []; },
    };
    elements.set(`#${id}`, element);
  }
  const document = { activeElement: null, addEventListener() {}, querySelector: (selector) => elements.get(selector) || null };
  const bundle = bundleScript();
  const script = `${bundle.slice(0, bundle.lastIndexOf('\nif (EXPORT || location.pathname'))}
    globalThis.app = {
      waiting: () => renderWaiting(current),
      decisions: () => renderDecisions(current), history: () => renderHistory(currentHistory),
      page: (block, page) => changeSectionPage(block, page),
      settings: (settings) => applyPageSettings(settings),
      reveal: (sid) => revealPaginatedTarget(sid),
      draft: (id, comment) => decisionDrafts.update(current.waiting.find(item => item.id === id), { selected: [], checked: [], comment }),
      seed(epic, history) { current = epic; currentHistory = history; decisionDrafts = new DecisionDrafts(epic.id, null); }
    };
  })();`;
  const context = vm.createContext({ document, window: {}, setInterval() {} });
  vm.runInContext(script, context);
  const epic = {
    id: 'fixture',
    waiting: Array.from({ length: 12 }, (_, i) => ({ id: `q${i + 1}`, title: `Question ${i + 1}`, status: 'open', version: `v${i + 1}`, revision: 1, input: { type: 'confirm' }, rounds: [] })),
    decisions: Array.from({ length: 12 }, (_, i) => ({ id: `d${i + 1}`, text: `Decision ${i + 1}`, at: '2026-10-16' })),
  };
  const history = Array.from({ length: 27 }, (_, i) => ({ path: 'goal', before: '', after: `Change ${i + 1}`, at: '2026-10-16', by: 'agent' }));
  context.app.seed(epic, history);
  return { app: context.app, html: (id) => elements.get(`#${id}`).innerHTML, cards: () => elements.get('#waiting').cards };
}

test('waiting starts with five questions and its page controls cover the remaining questions', () => {
  const { app, html } = appHarness();
  app.waiting();
  assert.equal((html('waiting').match(/data-sid="w-/g) || []).length, 5);
  assert.match(html('waiting'), /Question 5/);
  assert.doesNotMatch(html('waiting'), /Question 6/);
  app.page('waiting', 3);
  assert.match(html('waiting'), /Question 11/);
  assert.match(html('waiting'), /Question 12/);
  assert.doesNotMatch(html('waiting'), /Question 1<\/h3>/);
  assert.match(html('waiting-pagination'), /11–12/);
});

test('decisions and history page independently and history reaches records after the old limit', () => {
  const { app, html } = appHarness();
  app.decisions();
  app.history();
  app.page('decisions', 2);
  assert.match(html('decisions'), /data-sid="d-d7"/);
  assert.doesNotMatch(html('decisions'), /data-sid="d-d12"/);
  assert.match(html('history'), /data-sid="h-0"/);
  app.page('history', 6);
  assert.match(html('history'), /data-sid="h-26"/);
  assert.match(html('decisions'), /data-sid="d-d7"/);
});

test('shared settings give each block its own page size and rerenders retain the current page', () => {
  const { app, html } = appHarness();
  app.settings({ 'epic.pageSizes': { waiting: 10, decisions: 15, history: 5 } });
  assert.equal((html('waiting').match(/data-sid="w-/g) || []).length, 10);
  assert.equal((html('decisions').match(/data-sid="d-/g) || []).length, 12);
  app.page('waiting', 2);
  app.waiting();
  app.settings({ 'epic.pageSizes': { waiting: 10, decisions: 15, history: 5 } });
  assert.match(html('waiting'), /Question 11/);
  assert.doesNotMatch(html('waiting'), /Question 1<\/h3>/);
});

test('search targets reveal the correct page of every paginated block', () => {
  const { app, html } = appHarness();
  app.reveal('w-q12');
  assert.match(html('waiting'), /Question 12/);
  assert.match(html('waiting'), /<details class="wait-disclosure" open(?:\s[^>]*)?>/);
  app.reveal('d-d1');
  assert.match(html('decisions'), /data-sid="d-d1"/);
  app.reveal('h-26');
  assert.match(html('history'), /data-sid="h-26"/);
});

test('paging restores an open card and keeps its drafted comment visible', () => {
  const { app, html, cards } = appHarness();
  app.draft('q1', 'Keep this answer');
  app.waiting();
  const first = cards()[0];
  first.details.find((detail) => detail.dataset.waitPart === 'card').open = true;
  app.page('waiting', 2);
  app.page('waiting', 1);
  assert.equal(cards()[0].details.find((detail) => detail.dataset.waitPart === 'card').open, true);
  assert.match(html('waiting'), /<textarea name="comment" rows="2">Keep this answer<\/textarea>/);
  assert.doesNotMatch(html('waiting'), /<details class="wait-comment"/);
});
