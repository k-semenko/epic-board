import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundleScript } from '../server/export.mjs';
import { setLang } from '../server/page/i18n.mjs';
import { linkPollState, renderStepLinks, renderLinkBadge, renderRelatedEpics, updateLinksDom, indexRevision } from '../server/page/links.mjs';

const endpoint = (epic, task, step, title, state = 'todo') => ({ epic, task, step, address: `${epic}/${task}/${step}`, epicTitle: `Epic ${epic}`, title, state, url: `http://board.test/e/${epic}#t-${task}/${step}` });
const source = endpoint('alpha', 'task', 'use', 'Consumer', 'active');
const target = endpoint('beta', 'engine', 'api', 'Contract', 'done');
const edge = { source, target, label: 'list/run/stop', status: 'resolved' };
const view = (extra = {}) => ({ outgoing: [edge], incoming: [], relatedEpics: [{ id: 'beta', title: 'Engine', url: 'http://board.test/e/beta', status: 'resolved' }], incomplete: false, errors: [], readAt: '2026-10-18T10:00:00.000Z', revision: 'one', ...extra });

test('selected step shows outgoing target state and incoming source state with labels and full addresses', () => {
  setLang('en', { persist: false });
  const outgoing = renderStepLinks(linkPollState(null, view()), 'alpha', 'task', 'use');
  assert.match(outgoing, /Related to/);
  assert.match(outgoing, /Contract/);
  assert.match(outgoing, /done/);
  assert.match(outgoing, /list\/run\/stop/);
  assert.match(outgoing, /title="beta\/engine\/api"/);
  const incoming = renderStepLinks(linkPollState(null, view({ outgoing: [], incoming: [edge] })), 'beta', 'engine', 'api');
  assert.match(incoming, /Used in/);
  assert.match(incoming, /Consumer/);
  assert.match(incoming, /we are here/);
  assert.doesNotMatch(renderStepLinks(linkPollState(null, view()), 'alpha', 'task', 'another'), /Contract/);
});

test('step badges count both directions and ignore other steps and local links', () => {
  const other = { ...edge, source: endpoint('alpha', 'side', 'check', 'Side') };
  const local = { ...edge, target: endpoint('alpha', 'local', 'check', 'Local') };
  const state = linkPollState(null, view({ outgoing: [edge, other, local], incoming: [{ ...edge, source: target, target: source }] }));
  assert.match(renderLinkBadge(state, 'alpha', 'task', 'use'), />2<\/span>/);
  assert.match(renderLinkBadge(state, 'alpha', 'side', 'check'), />1<\/span>/);
  assert.equal(renderLinkBadge(state, 'alpha', 'side', 'absent'), '');
});

test('legacy numeric epic, task and step IDs match string link identities in both directions', () => {
  setLang('en', { persist: false });
  const numeric = endpoint('42', '7', '3', 'Numeric consumer', 'active');
  const outgoing = linkPollState(null, view({ outgoing: [{ ...edge, source: numeric }] }));
  assert.match(renderStepLinks(outgoing, 42, 7, 3), /Contract/);
  assert.match(renderLinkBadge(outgoing, 42, 7, 3), />1<\/span>/);
  const incoming = linkPollState(null, view({ outgoing: [], incoming: [{ ...edge, source: target, target: numeric }] }));
  assert.match(renderStepLinks(incoming, 42, 7, 3), /Contract/);
  assert.match(renderLinkBadge(incoming, 42, 7, 3), />1<\/span>/);
});

test('untrusted labels, titles and hrefs cannot create markup or executable links', () => {
  const unsafe = { ...edge, target: { ...target, title: '<img onerror="bad()">', epicTitle: '<script>x</script>', url: 'javascript:bad()' }, label: '<svg onload="bad()">' };
  const html = renderStepLinks(linkPollState(null, view({ outgoing: [unsafe] })), 'alpha', 'task', 'use');
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;svg/);
  assert.doesNotMatch(html, /<img|<script|<svg onload|javascript:/);
  const related = renderRelatedEpics([{ id: 'x', title: '<b>Title</b>', url: 'data:text/html,bad', status: 'resolved' }]);
  assert.match(related, /&lt;b&gt;Title&lt;\/b&gt;/);
  assert.doesNotMatch(related, /href=|<b>Title/);
});

test('missing targets retain their address and distinguish unavailable data', () => {
  setLang('en', { persist: false });
  for (const status of ['missing-epic', 'missing-task', 'missing-step', 'unavailable']) {
    const missing = { ...edge, status, target: { ...target, title: null, state: null } };
    const html = renderStepLinks(linkPollState(null, view({ outgoing: [missing] })), 'alpha', 'task', 'use');
    assert.match(html, /beta\/engine\/api/);
    assert.match(html, status === 'unavailable' ? /unavailable/ : /not found/);
    assert.doesNotMatch(html, /we are here|>ahead</);
  }
});

test('failed polls retain a stale snapshot and same-revision recovery clears the error', () => {
  setLang('en', { persist: false });
  const initial = linkPollState(null, null, true);
  assert.match(renderStepLinks(initial, 'alpha', 'task', 'use'), /Links unavailable/);
  const loaded = linkPollState(initial, view());
  const failed = linkPollState(loaded, null, true);
  assert.equal(failed.data, loaded.data);
  assert.match(renderStepLinks(failed, 'alpha', 'task', 'use'), /Could not refresh/);
  assert.match(renderStepLinks(failed, 'alpha', 'task', 'use'), /2026-10-18T10:00:00.000Z/);
  const recovered = linkPollState(failed, view());
  assert.equal(recovered.stale, false);
  assert.equal(recovered.changed, true);
  assert.doesNotMatch(renderStepLinks(recovered, 'alpha', 'task', 'use'), /Could not refresh/);
  assert.equal(linkPollState(recovered, view({ readAt: '2026-10-18T10:01:00.000Z' })).changed, false);
});

test('partial backlinks and export snapshots show their read timestamp in both languages', () => {
  for (const lang of ['en', 'ru']) {
    setLang(lang, { persist: false });
    const html = renderStepLinks(linkPollState(null, view({ incomplete: true, errors: [{ id: '<broken>', status: 'unavailable' }] })), 'alpha', 'task', 'use', { exported: true });
    assert.match(html, lang === 'en' ? /Backlinks may be incomplete/ : /Обратные ссылки могут быть неполными/);
    assert.match(html, lang === 'en' ? /Snapshot/ : /Снимок/);
    assert.match(html, /datetime="2026-10-18T10:00:00.000Z"/);
    assert.doesNotMatch(html, /<broken>/);
  }
});

test('links updates touch only dedicated panels and badges, retaining unrelated form and document nodes', () => {
  setLang('en', { persist: false });
  const panel = { dataset: { task: 'task', step: 'use' }, innerHTML: '' };
  const badge = { dataset: { task: 'side', step: 'check' }, innerHTML: '' };
  const waiting = { value: 'Unsubmitted answer' };
  const documentEditor = { value: 'Unsaved document', selectionStart: 4 };
  const root = {
    querySelectorAll(selector) {
      if (selector === '[data-cross-step-links]') return [panel];
      if (selector === '[data-cross-link-badge]') return [badge];
      throw new Error(`Unexpected DOM access: ${selector}`);
    },
  };
  const state = linkPollState(null, view({ outgoing: [edge, { ...edge, source: endpoint('alpha', 'side', 'check', 'Side') }] }));
  updateLinksDom(root, state, 'alpha');
  assert.match(panel.innerHTML, /Contract/);
  assert.match(badge.innerHTML, />1<\/span>/);
  assert.equal(waiting.value, 'Unsubmitted answer');
  assert.equal(documentEditor.value, 'Unsaved document');
  assert.equal(documentEditor.selectionStart, 4);
});

function focusableLinksPanel() {
  const document = { body: {}, activeElement: null };
  let anchors = [];
  let html = '';
  const panel = {
    ownerDocument: document, dataset: { task: 'task', step: 'use' },
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      if (anchors.includes(document.activeElement)) document.activeElement = document.body;
      anchors = [...value.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)].flatMap(([, attrs, body]) => {
        const row = { dataset: { crossLinkRow: attrs.match(/data-cross-link-row="([^"]+)"/)?.[1] } };
        return [...body.matchAll(/href="([^"]+)"/g)].map((match) => ({
          direction: body.match(/cross-link-direction">([^<]+)/)?.[1],
          getAttribute: () => match[1], closest: () => row,
          focus(options) { document.activeElement = this; this.focusOptions = options; },
        }));
      });
    },
    contains: (node) => anchors.includes(node),
    querySelectorAll: () => anchors,
  };
  const root = { querySelectorAll: (selector) => selector === '[data-cross-step-links]' ? [panel] : [] };
  return { root, document, anchors: () => anchors };
}

test('a focused counterpart anchor is restored after its links panel changes', () => {
  const { root, document, anchors } = focusableLinksPanel();
  const initial = linkPollState(null, view());
  updateLinksDom(root, initial, 'alpha');
  document.activeElement = anchors()[0];
  updateLinksDom(root, linkPollState(initial, view({ revision: 'two', outgoing: [{ ...edge, target: { ...target, state: 'active' } }] })), 'alpha');
  assert.equal(document.activeElement.getAttribute('href'), 'http://board.test/e/beta#t-engine/api');
  assert.equal(document.activeElement.focusOptions.preventScroll, true);
});

test('mutual counterpart links restore focus within the same incoming row', () => {
  setLang('en', { persist: false });
  const { root, document, anchors } = focusableLinksPanel();
  const initial = linkPollState(null, view({ incoming: [{ ...edge, source: target, target: source }] }));
  updateLinksDom(root, initial, 'alpha');
  assert.equal(anchors().length, 2);
  document.activeElement = anchors()[1];
  updateLinksDom(root, linkPollState(initial, { ...initial.data, revision: 'two', readAt: '2026-10-18T10:01:00.000Z' }), 'alpha');
  assert.equal(document.activeElement.direction, 'Used in:');
  assert.equal(document.activeElement.focusOptions.preventScroll, true);
});

test('index change detection ignores read timestamps but includes related state and incompleteness', () => {
  const entry = { id: 'alpha', title: 'Alpha', relatedEpics: view().relatedEpics, incomplete: false, readAt: 'first' };
  assert.equal(indexRevision([entry]), indexRevision([{ ...entry, readAt: 'second' }]));
  assert.notEqual(indexRevision([entry]), indexRevision([{ ...entry, incomplete: true }]));
  assert.notEqual(indexRevision([entry]), indexRevision([{ ...entry, relatedEpics: [{ ...entry.relatedEpics[0], status: 'missing-epic' }] }]));
});

function appHarness({ request = async () => view(), exported = null } = {}) {
  const writes = new Map();
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', markup: '', dataset: {}, controls: [],
      get innerHTML() { return this.markup; },
      set innerHTML(html) {
        this.markup = html;
        writes.set(selector, (writes.get(selector) || 0) + 1);
        this.controls = [...html.matchAll(/data-pin="([^"]+)"/g)].map((match) => ({
          dataset: { pin: match[1] }, focus() { document.activeElement = this; },
        }));
        for (const [, attrs, body] of html.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)) {
          const card = { dataset: { epicCard: attrs.match(/data-epic-card="([^"]+)"/)?.[1] } };
          this.controls.push(...[...body.matchAll(/href="([^"]+)"/g)].map((match) => ({
            dataset: {}, ownerId: body.match(/data-pin="([^"]+)"/)?.[1],
            getAttribute: () => match[1], closest: () => card,
            focus(options) { document.activeElement = this; this.focusOptions = options; },
          })));
        }
      },
      querySelectorAll() { return this.controls; },
      after(node) { elements.set(`#${node.id}`, node); },
    });
    return elements.get(selector);
  };
  for (const selector of ['#q', '#epics', '#stats']) element(selector);
  const panels = [{
    dataset: { task: 'task', step: 'use' }, markup: '', controls: [],
    get innerHTML() { return this.markup; },
    set innerHTML(html) {
      this.markup = html;
      this.controls = [...html.matchAll(/href="([^"]+)"/g)].map((match) => ({ href: match[1] }));
    },
  }];
  const badges = [{ dataset: { task: 'task', step: 'use' }, innerHTML: '' }];
  const waiting = { value: 'Draft answer' };
  const editor = { value: 'Draft document', selectionStart: 3 };
  const document = {
    body: {}, activeElement: waiting, addEventListener() {},
    querySelector(selector) { return elements.get(selector) || null; },
    querySelectorAll(selector) {
      if (selector === '[data-cross-step-links]') return panels;
      if (selector === '[data-cross-link-badge]') return badges;
      return [];
    },
    createElement() { return { id: '', innerHTML: '', className: '' }; },
  };
  const bundle = bundleScript();
  const script = `${bundle.slice(0, bundle.lastIndexOf('\nif (EXPORT || location.pathname'))}
    globalThis.app = {
      detail(epic, data, task) { current = epic; currentHistory = []; linksState = __links.linkPollState(null, data); tlState.step = null; return renderDetail(buildLanes(epic), task); },
      async links(data) { current = { id: 'alpha' }; return pollEpicLinks('alpha'); },
      exportLinks() { return exportApi('/api/epics/alpha/links', 'GET'); },
      renderIndex, pollIndex,
      showIndex(list, pins = []) { allEpics = list; pinnedEpics = new Set(pins); renderEpicList(); },
    };
  })();`;
  const context = vm.createContext({
    document, window: exported ? { __EPIC_EXPORT__: exported } : {}, URL, URLSearchParams,
    setInterval() {}, setTimeout() {}, location: { pathname: '/', hash: '' },
    async fetch(path, options) {
      const data = await request(path, options);
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => data };
    },
  });
  vm.runInContext(script, context);
  return { app: context.app, panels, badges, waiting, editor, document, element, writes };
}

test('main and side task renderers include selected-step links and badges in timeline and narrow flow', () => {
  const page = appHarness();
  for (const role of ['main', 'side']) {
    const epic = { id: 'alpha', title: 'Alpha', tasks: [{ id: 'task', title: 'Task', role, steps: [{ id: 'use', title: 'Use', after: ['beta/engine/api'] }] }] };
    const html = page.app.detail(epic, view(), 'task');
    assert.match(html, /data-cross-step-links[^>]*data-task="task"[^>]*data-step="use"/);
    assert.match(html, /Contract/);
    assert.equal((html.match(/data-cross-link-badge/g) || []).length, 2);
    assert.equal((html.match(/class="tl-edge"/g) || []).length, 0, 'foreign links must not affect the local chain');
  }
});

test('related index links are siblings of the main epic anchor', () => {
  const page = appHarness();
  page.app.showIndex([{ id: 'alpha', title: 'Alpha', relatedEpics: view().relatedEpics }]);
  const html = page.element('#epics').innerHTML;
  assert.match(html, /<\/a><div class="related-epics">/);
  assert.match(html, /href="http:\/\/board.test\/e\/beta"/);
  assert.doesNotMatch(html.match(/class="epic-link">([\s\S]*?)<\/a>/)[1], /related-epics/);
});

test('independent links polling refreshes and recovers while drafts, focus and document selection stay intact', async () => {
  let fail = false;
  let data = view();
  const paths = [];
  const page = appHarness({ request: async (path) => {
    paths.push(path);
    if (fail) throw new Error('Offline');
    return data;
  } });
  await page.app.links();
  assert.match(page.panels[0].innerHTML, /Contract/);
  data = view({ revision: 'two', outgoing: [{ ...edge, target: { ...target, title: 'Renamed', state: 'active' } }] });
  await page.app.links();
  assert.match(page.panels[0].innerHTML, /Renamed/);
  fail = true;
  await page.app.links();
  assert.match(page.panels[0].innerHTML, /Could not refresh/);
  fail = false;
  await page.app.links();
  assert.doesNotMatch(page.panels[0].innerHTML, /Could not refresh/);
  assert.equal(page.document.activeElement, page.waiting);
  assert.equal(page.waiting.value, 'Draft answer');
  assert.equal(page.editor.value, 'Draft document');
  assert.equal(page.editor.selectionStart, 3);
  assert.deepEqual(paths, Array(4).fill('/api/epics/alpha/links'));
});

test('stable successful links polls retain panel control identity while later errors use the freshest timestamp', async () => {
  let data = view();
  let fail = false;
  const page = appHarness({ request: async () => {
    if (fail) throw new Error('Offline');
    return data;
  } });
  await page.app.links();
  const panel = page.panels[0];
  const control = panel.controls[0];
  const html = panel.innerHTML;
  data = view({ readAt: '2026-10-18T10:01:00.000Z' });
  await page.app.links();
  assert.equal(panel.controls[0], control, 'an unchanged revision keeps the existing counterpart anchor');
  assert.equal(panel.innerHTML, html);
  fail = true;
  await page.app.links();
  assert.match(panel.innerHTML, /Could not refresh/);
  assert.match(panel.innerHTML, /2026-10-18T10:01:00.000Z/);
  fail = false;
  await page.app.links();
  assert.doesNotMatch(panel.innerHTML, /Could not refresh/);
  const recoveredControl = panel.controls[0];
  data = view({ revision: 'two', outgoing: [{ ...edge, target: { ...target, title: 'New contract' } }] });
  await page.app.links();
  assert.match(panel.innerHTML, /New contract/);
  assert.notEqual(panel.controls[0], recoveredControl);
});

test('index polling retains query, pins, focused controls and cards during failures', async () => {
  let fail = false;
  let list = [{ id: 'alpha', title: 'Alpha', relatedEpics: view().relatedEpics, readAt: view().readAt }];
  const page = appHarness({ request: async (path) => {
    if (path === '/api/settings') return { rev: 0, values: { 'epic.pinned': ['alpha'] } };
    if (fail) throw new Error('Offline');
    return list;
  } });
  await page.app.renderIndex();
  page.element('#q').value = 'alpha';
  const card = page.element('#epics');
  const focused = card.controls[0];
  page.document.activeElement = focused;
  const before = page.writes.get('#epics');
  list = [{ ...list[0], readAt: '2026-10-18T10:01:00.000Z' }];
  await page.app.pollIndex();
  assert.equal(page.writes.get('#epics'), before, 'timestamp-only polls must retain control nodes');
  assert.equal(page.document.activeElement, focused);
  fail = true;
  await page.app.pollIndex();
  assert.match(page.element('#index-links-status').innerHTML, /Could not refresh epics/);
  assert.equal(page.writes.get('#epics'), before);
  fail = false;
  await page.app.pollIndex();
  assert.doesNotMatch(page.element('#index-links-status').innerHTML, /Could not refresh/);
  list = [{ ...list[0], title: 'Alpha renamed' }];
  await page.app.pollIndex();
  assert.match(card.innerHTML, /Alpha renamed/);
  assert.match(card.innerHTML, /aria-pressed="true"/);
  assert.equal(page.document.activeElement.dataset.pin, 'alpha');
  assert.equal(page.element('#q').value, 'alpha');
});

test('an initial index error reports unavailable data instead of declaring the board empty', async () => {
  const page = appHarness({ request: async () => { throw new Error('Offline'); } });
  await page.app.renderIndex();
  assert.match(page.element('#epics').innerHTML, /Epic list unavailable/);
  assert.doesNotMatch(page.element('#epics').innerHTML, /No epics yet|Create one/);
});

test('a related link retains focus in its owning epic card when another card has the same href', async () => {
  const common = { id: 'common', title: 'Common', url: 'http://board.test/e/common', status: 'resolved' };
  let list = ['first', 'second'].map((id) => ({ id, title: id, relatedEpics: [common] }));
  const page = appHarness({ request: async (path) => path === '/api/settings' ? { rev: 0, values: { 'epic.pinned': [] } } : list });
  await page.app.renderIndex();
  const controls = page.element('#epics').controls;
  page.document.activeElement = controls.find((control) => control.ownerId === 'second' && control.getAttribute?.('href') === common.url);
  assert.ok(page.document.activeElement);
  list = list.map((epic) => ({ ...epic, title: `${epic.title} updated` }));
  await page.app.pollIndex();
  assert.equal(page.document.activeElement.ownerId, 'second');
  assert.equal(page.document.activeElement.focusOptions.preventScroll, true);
});

test('export links are served from the embedded snapshot without network reads', () => {
  const snapshot = view();
  const page = appHarness({ exported: { epic: { id: 'alpha' }, links: snapshot }, request: () => { throw new Error('Unexpected network request'); } });
  assert.equal(page.app.exportLinks(), snapshot);
});
