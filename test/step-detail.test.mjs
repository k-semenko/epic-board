import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundleScript } from '../server/export.mjs';

function detailRenderer() {
  const bundle = bundleScript();
  const bootstrap = bundle.lastIndexOf('\nif (EXPORT || location.pathname');
  assert.ok(bootstrap > 0, 'app bootstrap is available');
  const script = `${bundle.slice(0, bootstrap)}
    globalThis.renderStepDetail = (epic, id) => {
      current = epic; currentHistory = [];
      Object.assign(tlState, { step: null, allDocs: false });
      return renderDetail(buildLanes(epic), id);
    };
  })();`;
  const context = vm.createContext({ document: { addEventListener() {} } });
  vm.runInContext(script, context);
  return context.renderStepDetail;
}

for (const steps of [
  [{ id: 'plan', title: 'Prepare smoke plan', state: 'done' }, { id: 'check', title: 'Check staging', state: 'active', note: 'Verify the portal' }],
  [],
]) {
  test(`main and side tasks have identical step-panel structure with ${steps.length} steps`, () => {
    const render = detailRenderer();
    const epic = (role) => ({
      title: 'Staging readiness', goal: 'Portal smoke is checked',
      tasks: [{ id: 'QA-1', title: '[qa] Portal smoke', role, status: 'Testing', tracker: 'Bitrix24', url: 'https://tracker.example.com/QA-1', steps }],
      docs: steps.length ? [{ id: 'plan-doc', title: 'Smoke plan', task: 'QA-1', step: 'check', kind: 'plan', owned: true }] : [],
    });
    const main = render(epic('main'), 'QA-1');
    const side = render(epic('side'), 'QA-1');
    const header = (html) => html.match(/<header class="detail-head">[\s\S]*?<\/header>/)?.[0];
    assert.match(header(main), /<h3><span class="mono muted">QA-1<\/span> \[qa\] Portal smoke<\/h3>/);
    assert.match(header(main), /Testing/);
    assert.match(header(main), /Bitrix24/);
    assert.equal(header(side), header(main), 'changing the task role must not add another heading row');
    assert.equal(side, main);
  });
}

test('merge puts Depends on / Leads to in the right-hand card, not under the title', () => {
  const render = detailRenderer();
  const html = render({
    title: 'Ship SDK',
    goal: 'SDK is on main',
    tasks: [{ id: 'SDK-1', title: 'Cut the release', branches: [{ repo: 'sdk', name: 'feat/cut' }], steps: [{ id: 'cut', title: 'Cut', state: 'done' }] }],
    mergeOrder: [{ id: 'm1', text: 'feat/cut → main', branch: 'sdk:feat/cut' }],
  }, '@merge');
  assert.match(html, /detail-merge/);
  assert.match(html, /step-info[\s\S]*detail-links[\s\S]*SDK-1/);
  assert.match(html, /step-info[\s\S]*detail-links[\s\S]*SDK is on main/);
  const afterHeader = html.slice(html.indexOf('</header>'));
  const linksAt = afterHeader.indexOf('detail-links');
  const timelineAt = afterHeader.indexOf('class="tl"');
  assert.ok(timelineAt >= 0 && linksAt > timelineAt, 'links belong below the merge timeline, inside the side card');
});
