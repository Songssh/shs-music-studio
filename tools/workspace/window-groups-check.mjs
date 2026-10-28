import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'docs/implementation/workspace-window-checks');
fs.mkdirSync(output, { recursive: true });
const require = createRequire(path.join(root, 'server/package.json'));
await require('esbuild').build({ entryPoints: [path.join(root, 'tools/workspace/window-groups-harness.ts')], outfile: path.join(output, 'harness.js'), bundle: true, format: 'iife', platform: 'browser' });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const origin = process.env.WORKSPACE_TEST_ORIGIN || 'http://127.0.0.1:4301';
await context.route('**/__window_fixture/**', route => {
  const name = new URL(route.request().url()).pathname.split('/').at(-1);
  if (name === 'harness.js' || name === 'harness.css') return route.fulfill({ path: path.join(output, name), contentType: name.endsWith('js') ? 'text/javascript' : 'text/css' });
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><link rel="stylesheet" href="harness.css"><style>*{box-sizing:border-box}body{margin:0}#dock{position:relative;margin:30px 40px;width:calc(100vw - 80px);height:calc(100vh - 60px)}.actions{display:flex}.actions button{font-size:11px}.dv-resize-container{min-width:320px;min-height:240px}</style><div id="dock"></div><script src="harness.js"></script>' });
});
const page = await context.newPage();
const result = { checks: [], errors: [] };
page.on('pageerror', e => result.errors.push(e.message));
const check = name => { result.checks.push({ name, passed: true }); console.log('PASS ' + name); };
const state = () => page.evaluate(() => qa.state());
const box = id => page.evaluate(id => qa.box(id), id);
const equalBox = (a, b) => { for (const key of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(a[key] - b[key]) < 2, `${key}: ${a[key]} != ${b[key]}`); };
const settle = () => page.waitForTimeout(150);
// Resolve actions through Dockview's live rendered group element.
const action = async (id, name) => {
  await page.evaluate(({ id, name }) => qa.api.getPanel(id).group.element.querySelector(`[data-action="${name}"]`).click(), { id, name });
  await settle();
};
async function three() {
  await page.evaluate(() => { qa.reset(); qa.add('one'); qa.add('two'); qa.add('three'); qa.tab('two', 'one'); qa.tab('three', 'one'); qa.api.getPanel('two').api.setActive(); qa.add('other', 780, 100, 500, 400); qa.api.getPanel('two').api.setActive(); qa.save(); });
  await settle();
  assert.equal(await page.locator('.dv-resize-container').count(), 2, 'no orphan floating containers after layout reset');
}
try {
  await page.goto(origin + '/__window_fixture/index.html'); await page.waitForFunction(() => !!window.qa);
  await three(); const original = await box('one'); const other = await box('other');
  await action('one', 'minimize');
  assert.deepEqual(Object.keys((await state()).layout.panels), ['other']);
  assert.deepEqual(Object.keys((await state()).minimized[0].panels), ['one', 'two', 'three']);
  await page.evaluate(() => qa.actions.restore('three')); await settle();
  let s = await state(); assert.equal(s.active, 'two'); assert.deepEqual(s.layout.floatingGroups.find(f => f.data?.views.includes('one')).data.views, ['one', 'two', 'three']);
  equalBox(await box('one'), original); equalBox(await box('other'), other); check('three tabs minimize/restore together with order, active tab, geometry and unrelated window preserved');
  await action('one', 'maximize'); assert.ok((await box('one')).width > original.width);
  await action('one', 'maximize'); equalBox(await box('one'), original); assert.equal(Object.keys((await state()).layout.panels).length, 4); check('maximize/restore retains tabs and original floating geometry');
  await action('one', 'maximize'); const beforeMaxMin = await box('one'); await action('one', 'minimize');
  await page.reload(); await page.waitForFunction(() => !!window.qa);
  await page.evaluate(() => qa.actions.restore('three')); await settle(); equalBox(await box('one'), beforeMaxMin);
  await action('one', 'maximize'); equalBox(await box('one'), original); assert.equal((await state()).active, 'two');
  check('minimizing a maximized window retains maximization and normal restore geometry across reload');
  await action('other', 'minimize'); await action('one', 'maximize'); const maximizedBox = await box('one');
  await page.evaluate(() => qa.actions.restore('other')); await settle(); equalBox(await box('one'), maximizedBox);
  await action('one', 'maximize'); equalBox(await box('one'), original); check('restoring another minimized window preserves an unrelated maximized window and its restore size');
  await action('one', 'close'); assert.deepEqual(Object.keys((await state()).layout.panels), ['other']); check('window close removes all three tabs only');
  await three(); await page.evaluate(() => qa.api.removePanel(qa.api.getPanel('two'))); await settle(); assert.deepEqual(Object.keys((await state()).layout.panels).sort(), ['one', 'other', 'three']); check('individual panel close retains sibling tabs');
  await three(); await page.evaluate(() => qa.tab('three', 'other')); await action('one', 'close'); assert.deepEqual(Object.keys((await state()).layout.panels).sort(), ['other', 'three']); check('tab moved to another window is not closed with its former group');
  await three(); await page.evaluate(() => qa.split('three', 'one')); await settle();
  assert.equal((await state()).layout.floatingGroups.length, 2); assert.ok((await state()).layout.floatingGroups.some(f => f.grid));
  const nested = await box('three'); await action('three', 'minimize'); assert.deepEqual(Object.keys((await state()).layout.panels), ['other']);
  await page.reload(); await page.waitForFunction(() => !!window.qa);
  await page.evaluate(() => qa.actions.restore('one')); await settle();
  assert.ok((await state()).layout.floatingGroups.some(f => f.grid)); equalBox(await box('three'), nested);
  await action('three', 'maximize'); await action('one', 'maximize'); equalBox(await box('three'), nested);
  await action('three', 'close'); assert.deepEqual(Object.keys((await state()).layout.panels), ['other']); check('nested multi-group floating container acts as one window, including minimized reload');
  await three(); await page.evaluate(() => qa.split('three', 'one')); await page.evaluate(() => { qa.api.addFloatingGroup(qa.api.getPanel('one').group, { x: 50, y: 50, width: 500, height: 400 }); qa.save(); });
  await action('three', 'close'); assert.deepEqual(Object.keys((await state()).layout.panels).sort(), ['one', 'other', 'two']); check('floating anchor reassignment after group separation uses live ownership');
  await three(); await page.evaluate(() => { qa.api.getPanel('one').group.api.moveTo({ position: 'left' }); qa.save(); });
  await action('one', 'minimize'); await page.evaluate(() => qa.actions.restore('two')); await settle(); assert.equal(await page.evaluate(() => qa.api.getPanel('one').api.location.type), 'grid'); assert.equal((await state()).active, 'two'); check('docked tab group minimizes/restores as a group');
  await three();
  const drag = async (dx, dy) => {
    const rect = await page.evaluate(() => { const e = qa.api.getPanel('one').group.element.querySelector('.dv-void-container'); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width}; });
    assert.ok(rect.width > 0); await page.mouse.move(rect.x, rect.y); await page.mouse.down(); await page.mouse.move(rect.x + dx, rect.y + dy, { steps: 20 }); await page.mouse.up(); await settle();
  };
  await drag(-400, 0); assert.ok((await box('one')).left < 0); check('actual pointer drag permits left overflow');
  await page.evaluate(() => qa.position('one', { left: 500, top: 80 })); await drag(600, 0); const right = await box('one'); assert.ok(right.left + right.width > 1420); check('actual pointer drag permits right overflow');
  await page.evaluate(() => qa.position('one', { left: 200, top: 400 })); await drag(0, 400); const bottom = await box('one'); assert.ok(bottom.top + bottom.height > 940); check('actual pointer drag permits bottom overflow');
  await page.screenshot({ path: path.join(output, 'floating-bottom.png') });
  await page.reload(); await page.waitForFunction(() => !!window.qa); await settle(); equalBox(await box('one'), bottom); check('edge position survives layout save and browser reload');
  await action('one', 'minimize'); await page.evaluate(() => qa.actions.restore('three')); await settle(); equalBox(await box('one'), bottom);
  await action('one', 'maximize'); await action('one', 'maximize'); equalBox(await box('one'), bottom); check('minimize and maximize restoration preserve intentional edge positions');
  await page.setViewportSize({ width: 800, height: 600 }); await settle(); const recovered = await box('one'); assert.ok(recovered.top >= 0 && recovered.top <= 500); assert.ok(recovered.left + recovered.width >= 160 && recovered.left <= 560); check('resolution change recovers an accessible title bar');
  await page.setViewportSize({ width: 1500, height: 1000 }); await settle(); await three();
  await page.evaluate(() => qa.position('one', { left: 800, top: 400 }));
  const handle = await page.evaluate(() => { const r=qa.component.getFloatingWindowForGroup(qa.api.getPanel('one').group).overlay.element.querySelector('.dv-resize-handle-bottomright').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}; });
  await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(handle.x+180,handle.y+150,{steps:15});await page.mouse.up();await settle();
  const resized=await box('one');assert.ok(resized.width>600);assert.ok(resized.left+resized.width>1420);assert.ok(resized.top+resized.height>940);check('actual resize uses the same partial-overflow policy');
  await three();
  await page.locator('.dv-tab').filter({ hasText: /^three$/ }).dragTo(page.locator('.dv-tab').filter({ hasText: /^other$/ }));
  await settle();
  assert.equal(await page.evaluate(() => qa.group('three')), await page.evaluate(() => qa.group('other')));
  await action('one', 'close'); assert.deepEqual(Object.keys((await state()).layout.panels).sort(), ['other', 'three']);
  check('native tab drag between floating windows updates the next window-close target');
  await three(); await page.evaluate(() => qa.api.getPanel('one').group.api.moveTo({ position: 'left' }));
  await action('other', 'minimize'); await action('one', 'maximize'); await page.evaluate(() => qa.actions.restore('other')); await settle();
  assert.equal(await page.evaluate(() => qa.api.getPanel('one').group.api.isMaximized()), true);
  assert.equal((await state()).active, 'other');
  check('restoring a float preserves another docked group\'s native maximized state');
  assert.deepEqual(result.errors, []);
} catch (error) { result.failure = error.stack; process.exitCode = 1; console.error(error); await page.screenshot({ path: path.join(output, 'failure.png') }); }
finally { fs.writeFileSync(path.join(output, 'integration.json'), JSON.stringify(result, null, 2)); await browser.close(); }
