import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), origin = process.env.WORKSPACE_TEST_ORIGIN || 'http://127.0.0.1:4301';
const output = path.join(root, 'docs/implementation/workspace-window-checks/storm-live.json');
const credentials = JSON.parse(fs.readFileSync(process.env.WORKSPACE_TEST_CREDENTIALS, 'utf8'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
assert.equal((await context.request.post(origin + '/api/auth/sign-in/email', { data: { email: credentials.email, password: credentials.password }, headers: { Origin: origin } })).status(), 200);
const json = async url => { const r = await context.request.get(origin + url); assert.equal(r.status(), 200); return r.json(); };
const me = await json('/api/account/me');
const result = { checks: [], errors: [], windowOperationStopRequests: 0, cleanupStopRequests: 0 };
let started = false;
await context.addInitScript(id => {
  for (const [key, value] of Object.entries({ 'hs-storm-caption': 'A short gentle piano instrumental', 'hs-storm-instrumental': true, 'hs-storm-duration-v2': 10, 'hs-storm-auto-expand': false, 'hs-storm-lss': 0 })) localStorage.setItem(`hotstep:user:${encodeURIComponent(id)}:${key}`, JSON.stringify(value));
  window.__decoded = 0; const Base = window.AudioContext;
  window.AudioContext = class extends Base { async decodeAudioData(...args) { const result = await super.decodeAudioData(...args); window.__decoded++; return result; } };
}, me.user.id);
const page = await context.newPage(); let cleaning = false;
page.on('pageerror', e => result.errors.push(e.message));
page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/storm/stop')) cleaning ? result.cleanupStopRequests++ : result.windowOperationStopRequests++; });
const record = name => { result.checks.push({ name, passed: true }); console.log('PASS ' + name); };
const until = async (fn, timeout = 240000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await page.waitForTimeout(500); } throw Error('STORM check timed out'); };
const open = async id => { await page.getByRole('button', { name: '앱 실행기', exact: true }).click(); await page.getByRole('textbox', { name: '앱 검색' }).fill(id); await page.locator('.ws-app-open').first().click(); };
const action = name => page.locator('.dv-active-group .ws-window-actions').getByRole('button', { name, exact: true });
try {
  assert.equal((await json('/api/generate/storm/control?streamId=storm-main')).running, false, 'Do not interrupt a pre-existing stream');
  await page.goto(origin); await page.locator('.workspace').waitFor(); await open('storm');
  await page.locator('[data-workspace-tool=storm]').getByRole('button', { name: 'Start', exact: true }).click(); started = true;
  await until(async () => (await json('/api/generate/storm/control?streamId=storm-main')).running);
  await open('queue'); await page.locator('.dv-active-group .ws-tab-combine').focus(); await page.locator('.dv-active-group .ws-tab-combine').selectOption('storm');
  await action('최소화').click(); assert.equal((await json('/api/generate/storm/control?streamId=storm-main')).running, true);
  await page.locator('.ws-rail [data-tool=storm]').click(); await action('창 닫기').click();
  assert.equal((await json('/api/generate/storm/control?streamId=storm-main')).running, true);
  assert.equal(result.windowOperationStopRequests, 0); record('real STORM session survives whole-window minimize, taskbar restore and close');
  await open('storm'); await until(() => page.evaluate(() => window.__decoded > 0));
  await page.locator('[data-workspace-tool=storm]').getByRole('button', { name: 'Stop', exact: true }).waitFor();
  record('same STORM session resumes its view and decodes actual generated WAV audio');
  cleaning = true;
  await page.locator('[data-workspace-tool=storm]').getByRole('button', { name: 'Stop', exact: true }).click();
  await until(async () => !(await json('/api/generate/storm/control?streamId=storm-main')).running);
  started = false; assert.equal(result.cleanupStopRequests, 1); assert.deepEqual(result.errors, []);
} catch (error) { result.failure = error.stack; process.exitCode = 1; console.error(error); }
finally {
  // Only the stream explicitly started by this test is stopped during cleanup.
  if (started) await context.request.post(origin + '/api/generate/storm/stop', { data: { streamId: 'storm-main' }, headers: { Origin: origin } });
  fs.writeFileSync(output, JSON.stringify(result, null, 2)); await browser.close();
}
