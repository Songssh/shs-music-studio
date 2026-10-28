import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SNAP_LAYOUTS, layoutCells, cellBox, fitsCell, fitSnapCells, edgeSnap, withinSnapBar, sharedBoundaries, resizeCells, windowKey } from './snapLayouts';

test('all seven layouts cover the viewport with no overlapping cells', () => {
  for (const layout of SNAP_LAYOUTS) {
    const cells = layoutCells(layout.id, { width: 1837, height: 931 });
    assert.equal(cells.reduce((sum, c) => sum + c.width * c.height, 0), 1837 * 931);
    for (const [i, a] of cells.entries()) for (const b of cells.slice(i + 1)) {
      assert.ok(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top);
    }
    assert.ok(cells.every(c => fitsCell(c)));
  }
});
test('minimum size disables narrow columns and short quarters without disabling usable rows', () => {
  assert.equal(layoutCells('thirds', { width: 850, height: 700 }).every(c => fitsCell(c)), false);
  assert.equal(layoutCells('rows', { width: 850, height: 700 }).every(c => fitsCell(c)), true);
  assert.equal(layoutCells('quarters', { width: 1300, height: 479 }).every(c => fitsCell(c)), false);
  assert.equal(fitsCell(layoutCells('halves', { width: 1300, height: 800 })[0], { width: 700, height: 240 }), false);
});
test('Snap windows exactly cover their cells without outer inset or shared-edge gaps', () => {
  const [left, right] = layoutCells('halves', { width: 1000, height: 600 }).map(cellBox);
  assert.equal(left.left, 0); assert.equal(left.top, 0); assert.equal(right.left - left.left - left.width, 0); assert.equal(right.left + right.width, 1000); assert.equal(left.height, 600);
});

test('responsive shared boundaries cover odd-sized viewports in all seven layouts', () => {
  for (const layout of SNAP_LAYOUTS) {
    const cells = fitSnapCells(layoutCells(layout.id, { width: 1856, height: 1023 }), { width: 1301, height: 713 }, [])!;
    assert.ok(cells); assert.equal(cells.reduce((sum, c) => sum + c.width * c.height, 0), 1301 * 713);
    for (const [i, a] of cells.entries()) for (const b of cells.slice(i + 1)) assert.ok(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top);
    assert.ok(cells.every(c => fitsCell(c)));
  }
});

test('fractional Workspace edges are retained instead of truncating a strip above the player', () => {
  const size = { width: 1301.625, height: 711.1875 };
  for (const layout of SNAP_LAYOUTS) {
    const cells = layoutCells(layout.id, size);
    assert.equal(Math.max(...cells.map(c => c.left + c.width)), size.width);
    assert.equal(Math.max(...cells.map(c => c.top + c.height)), size.height);
    assert.ok(Math.abs(cells.reduce((sum, c) => sum + c.width * c.height, 0) - size.width * size.height) < .0001);
  }
});

test('responsive Snap preserves resized proportions and clamps shared seams to minimums', () => {
  const cells = [{ left: 0, top: 0, width: 1200, height: 900 }, { left: 1200, top: 0, width: 800, height: 900 }];
  assert.equal(fitSnapCells(cells, { width: 1000, height: 600 }, [])![0].width, 600);
  const tight = fitSnapCells(cells, { width: 650, height: 600 }, [])!;
  assert.equal(tight[0].width, 330); assert.equal(tight[1].left, 330); assert.equal(tight[1].width, 320);
  assert.equal(fitSnapCells(cells, { width: 639, height: 600 }, []), undefined);
});
test('pointer edges, corners and top center have deliberate snap targets', () => {
  const v = { width: 1000, height: 700 };
  for (const [x, y, slot] of [[1, 1, 0], [999, 1, 1], [1, 699, 2], [999, 699, 3]]) assert.deepEqual(edgeSnap(x, y, v), { layout: 'quarters', slot });
  assert.deepEqual(edgeSnap(1, 350, v), { layout: 'halves', slot: 0 });
  assert.deepEqual(edgeSnap(999, 350, v), { layout: 'halves', slot: 1 });
  assert.equal(edgeSnap(500, 4, v), 'picker');
  assert.equal(edgeSnap(500, 350, v), undefined);
  assert.equal(edgeSnap(-45, 350, v), undefined);
});
test('linked resize produces 60:40 and clamps to both window minimums', () => {
  const cells = layoutCells('halves', { width: 1000, height: 700 }), seam = sharedBoundaries(cells)[0];
  const next = resizeCells(cells, seam, 600, []);
  assert.equal(next[0].width, 600); assert.equal(next[1].width, 400);
  const limited = resizeCells(cells, seam, 950, []);
  assert.equal(cellBox(limited[1]).width, 320);
  assert.equal(limited[1].left + limited[1].width, 1000);
});
test('T-junction linked resize moves both right-hand windows together', () => {
  const cells = layoutCells('main-side', { width: 1500, height: 900 }), seam = sharedBoundaries(cells).find(b => b.axis === 'x')!;
  const next = resizeCells(cells, seam, 1000, []);
  assert.equal(next[0].width, 1000); assert.equal(next[1].left, 1000); assert.equal(next[2].left, 1000);
  assert.equal(next[1].height, 450); assert.equal(next[2].top, 450);
});
test('impossible linked resize keeps the existing layout', () => {
  const cells = layoutCells('halves', { width: 600, height: 700 });
  assert.equal(resizeCells(cells, sharedBoundaries(cells)[0], 400, []), cells);
});
test('window identity survives tab ordering but cannot follow a separated or merged tab', () => {
  assert.equal(windowKey(['a', 'b']), windowKey(['b', 'a']));
  assert.notEqual(windowKey(['a', 'b']), windowKey(['a']));
  assert.notEqual(windowKey(['a', 'b']), windowKey(['a', 'b', 'c']));
});

test('Snap Bar entry follows the handle; the expanded tray has a wider exit margin', () => {
  const size = { width: 1200, height: 800 }, tray = { left: 418, top: 0, width: 364, height: 360 };
  assert.ok(withinSnapBar(600, 40, size));
  assert.equal(withinSnapBar(500, 40, size), false);
  assert.equal(withinSnapBar(600, 60, size), false);
  assert.ok(withinSnapBar(410, 200, size, tray));
  assert.ok(withinSnapBar(600, 380, size, tray));
  assert.equal(withinSnapBar(380, 200, size, tray), false);
  assert.equal(withinSnapBar(600, 400, size, tray), false);
  assert.ok(withinSnapBar(350, 40, { width: 700, height: 500 }));
});
