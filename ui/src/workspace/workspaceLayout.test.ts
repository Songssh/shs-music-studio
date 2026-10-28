import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateWorkspaceOrigin, type WorkspaceLayout } from './workspaceLayout';

test('legacy inset migration preserves floating size and screen position, including minimized and anchored boxes', () => {
  const data = { version: 2, layout: { floatingGroups: [{ position: { left: -20, top: 50, width: 600, height: 400 } }, { position: { right: 15, bottom: 25, width: 500, height: 300 } }] },
    placements: { tool: { x: -20, y: 50, width: 600, height: 400 } }, minimizedWindows: [{ floating: { position: { left: 40, top: 60, width: 600, height: 400 } } }],
    snap: { records: [{ before: { left: -20, top: 50, width: 600, height: 400 } }], sessions: [] } } as unknown as WorkspaceLayout;
  migrateWorkspaceOrigin(data);
  assert.deepEqual(data.layout.floatingGroups![0].position, { left: -10, top: 60, width: 600, height: 400 });
  assert.deepEqual(data.layout.floatingGroups![1].position, { right: 25, bottom: 35, width: 500, height: 300 });
  assert.equal(data.placements.tool.x, -10); assert.equal(data.placements.tool.y, 60);
  assert.deepEqual(data.minimizedWindows![0].floating!.position, { left: 50, top: 70, width: 600, height: 400 });
  assert.deepEqual(data.snap!.records[0].before, { left: -10, top: 60, width: 600, height: 400 });
  const once = structuredClone(data); migrateWorkspaceOrigin(data); assert.deepEqual(data, once);
});
