import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLanes, buildOverview } from '../server/page/lanes.mjs';

test('stored full local addresses retain their existing graph dependency', () => {
  const epic = { id: 'shop', tasks: [
    { id: 'api', steps: [{ id: 'contract', title: 'Contract', state: 'done' }] },
    { id: 'plugin', steps: [{ id: 'mcp', title: 'MCP', after: ['shop/api/contract', 'foreign/api/contract'], label: 'API' }] },
  ] };
  const model = buildLanes(epic);
  assert.deepEqual(model.lanes[1].steps[0].deps, [{ task: 'api', step: 'contract', title: 'Contract', label: 'API' }]);
  assert.deepEqual(buildOverview(epic).edges.find((edge) => edge.to === 'plugin'), { from: 'api', to: 'plugin', labels: ['API'] });
});

test('a foreign address does not add local edges or shift local graph columns', () => {
  const model = buildOverview({ id: 'shop', tasks: [
    { id: 'api', steps: [{ id: 'contract', title: 'Contract' }] },
    { id: 'plugin', steps: [{ id: 'mcp', title: 'MCP', state: 'active', after: ['other/api/contract'] }] },
  ] });
  assert.deepEqual(model.nodes.filter((node) => node.kind === 'task').map((node) => [node.id, node.col]), [['api', 0], ['plugin', 0]]);
  assert.equal(model.edges.some((edge) => edge.from === 'api' && edge.to === 'plugin'), false);
});
