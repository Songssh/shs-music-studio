import assert from 'node:assert/strict';
import test from 'node:test';
import { constrainFloatingBox, recoverFloatingBox, resizeFloatingBox, windowBox } from './floatingBounds';
import { floatingGroups, windowGroups } from './dockviewWindows';

const desktop = { width: 1200, height: 800 };
const box = { left: 100, top: 80, width: 600, height: 400 };
test('drag permits 30% sideways and 25% below while retaining the title bar', () => {
  assert.equal(constrainFloatingBox({ ...box, left: -500 }, desktop).left, -180);
  assert.equal(constrainFloatingBox({ ...box, left: 1300 }, desktop).left, 780);
  assert.equal(constrainFloatingBox({ ...box, top: 1000 }, desktop).top, 500);
  assert.equal(constrainFloatingBox({ ...box, top: -100 }, desktop).top, 0);
});
test('large windows use pixel caps and small viewports still retain a grab area', () => {
  const large = constrainFloatingBox({ left: -5000, top: 9000, width: 2400, height: 1600 }, { width: 3000, height: 2000 });
  assert.equal(large.left, -320); assert.equal(large.top, 640);
  const small = constrainFloatingBox({ ...box, left: -900, top: 900 }, { width: 250, height: 180 });
  assert.ok(small.left + small.width >= 160); assert.ok(small.left <= 90);
  assert.ok(small.top >= 0 && small.top <= 140);
});
test('recovery preserves reachable edge placements and sizes without centering', () => {
  const edge = { ...box, left: -180, top: 500 };
  assert.deepEqual(recoverFloatingBox(edge, desktop), edge);
  assert.deepEqual(recoverFloatingBox(edge, { width: 900, height: 600 }), edge);
  const recovered = recoverFloatingBox({ ...box, left: 1800, top: 900 }, { width: 700, height: 500 });
  assert.deepEqual(recovered, { ...box, left: 540, top: 460 });
  assert.equal(recoverFloatingBox({ ...box, left: -900, top: -40 }, desktop).left, -440);
});
test('resizing permits overflow and respects minimum sizes', () => {
  const resized = resizeFloatingBox({ ...box, left: 600, top: 400 }, 'bottomright', 150, 100, desktop);
  assert.equal(resized.width, 750); assert.equal(resized.height, 500);
  assert.ok(resized.left + resized.width > desktop.width);
  assert.ok(resized.top + resized.height > desktop.height);
  const small = resizeFloatingBox(box, 'topleft', 1000, 1000, desktop);
  assert.equal(small.width, 320); assert.equal(small.height, 240);
});
test('right/bottom anchored positions become equivalent viewport coordinates', () => {
  assert.deepEqual(windowBox({ right: -180, bottom: -100, width: 600, height: 400 }, desktop), { left: 780, top: 500, width: 600, height: 400 });
});
test('nested floating serialization preserves groups and tab order', () => {
  const first = { id: 'a', views: ['one', 'two'], activeView: 'two' }, second = { id: 'b', views: ['three'], activeView: 'three' };
  const position = box;
  assert.deepEqual(floatingGroups({ data: first, position }), [first]);
  assert.deepEqual(floatingGroups({ grid: { root: { type: 'branch', data: [{ type: 'leaf', data: first }, { type: 'branch', data: [{ type: 'leaf', data: second }] }] }, width: 600, height: 400, orientation: 'HORIZONTAL' as never }, position }), [first, second]);
});
test('window membership is resolved again after a group moves to another float', () => {
  const a = {}, b = {}, c = {}, first = {}, second = {};
  const ownership = new Map([[a, first], [b, first], [c, second]]);
  const component = { api: { groups: [a, b, c] }, getFloatingWindowForGroup: (group: object) => ownership.get(group) };
  assert.deepEqual(windowGroups(component as never, a as never), [a, b]);
  ownership.set(b, second);
  assert.deepEqual(windowGroups(component as never, a as never), [a]);
  assert.deepEqual(windowGroups(component as never, b as never), [b, c]);
  ownership.delete(b);
  assert.deepEqual(windowGroups(component as never, b as never), [b]);
});
