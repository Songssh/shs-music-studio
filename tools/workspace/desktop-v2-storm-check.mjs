import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),origin='http://127.0.0.1:4301';
const priv=path.resolve(root,'../auth-environment/runtime/library/auth-private');
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/ssh15/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1600,height:1000},storageState:path.join(priv,'workspace-browser-session.json')});
const json=async url=>{const r=await context.request.get(origin+url);assert.equal(r.status(),200);return r.json();};
const me=await json('/api/account/me');
await context.addInitScript(id=>{
  const values={'hs-storm-caption':'A short gentle piano instrumental','hs-storm-instrumental':true,'hs-storm-duration-v2':10,'hs-storm-auto-expand':false,'hs-storm-lss':0};
  for(const [key,value] of Object.entries(values))localStorage.setItem(`hotstep:user:${encodeURIComponent(id)}:${key}`,JSON.stringify(value));
  window.__decoded=0;const Base=window.AudioContext;window.AudioContext=class extends Base{async decodeAudioData(...args){const result=await super.decodeAudioData(...args);window.__decoded++;return result;}};
},me.user.id);
const page=await context.newPage(),evidence={at:new Date().toISOString(),checks:[],errors:[]};let started=false,stopRequests=0;
page.on('pageerror',e=>evidence.errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/storm/stop'))stopRequests++;});
const record=name=>{evidence.checks.push({name,passed:true});console.log('PASS '+name);};
const open=async id=>{await page.getByRole('button',{name:'앱 실행기',exact:true}).click();await page.getByRole('textbox',{name:'앱 검색'}).fill(id);await page.locator('.ws-app-open').first().click();};
const activeButton=name=>page.locator('.dv-active-group .ws-window-actions').getByRole('button',{name,exact:true});
const until=async(fn,timeout=60000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await page.waitForTimeout(500);}throw Error('Timed out');};
try{
  await page.goto(origin);await page.locator('.workspace').waitFor();await open('images');
  await page.locator('[data-workspace-tool=images] h1').click({button:'right'});assert.equal(await page.locator('.ws-context-menu').count(),0);await page.keyboard.press('Escape');
  await activeButton('최소화').click();await page.setViewportSize({width:1050,height:720});await page.locator('.ws-rail [data-tool=images]').click();
  const bounds=await page.locator('.dv-active-group').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1051&&bounds.y+bounds.height<=721);
  record('Studio 일반 텍스트 우클릭 비침범 및 작은 화면에서 최소화 창 좌표 복원');
  await page.setViewportSize({width:1600,height:1000});
  const before=await json('/api/generate/storm/control?streamId=storm-main');assert.equal(before.running,false,'A pre-existing stream must remain untouched');
  await open('storm');await page.locator('[data-workspace-tool=storm]').getByRole('button',{name:'Start',exact:true}).click();started=true;
  await until(async()=>(await json('/api/generate/storm/control?streamId=storm-main')).running);
  await activeButton('창 닫기').click();await page.waitForTimeout(900);
  assert.equal((await json('/api/generate/storm/control?streamId=storm-main')).running,true);assert.equal(stopRequests,0);
  const icon=page.locator('.ws-rail [data-tool=storm]');await icon.waitFor();assert.match(await icon.getAttribute('aria-label'),/닫힘.*실행 1/);assert.equal(await icon.locator('.ws-badge').innerText(),'1');
  await icon.click();await page.locator('[data-workspace-tool=storm]').getByRole('button',{name:'Stop',exact:true}).waitFor();
  await until(()=>page.evaluate(()=>window.__decoded>0),240000);
  record('실제 STORM 생성·디코딩: 창 닫기에도 stream과 작업 아이콘 유지, 재열기 복원');
  await page.locator('[data-workspace-tool=storm]').getByRole('button',{name:'Stop',exact:true}).click();await until(async()=>!(await json('/api/generate/storm/control?streamId=storm-main')).running);assert.equal(stopRequests,1);started=false;
  await activeButton('창 닫기').click();await until(async()=>await page.locator('.ws-rail [data-tool=storm]').count()===0);
  record('명시적 Stop 1회 후 미고정·닫힌 STORM 아이콘 제거');assert.deepEqual(evidence.errors,[]);
}catch(error){evidence.failure=error.stack;process.exitCode=1;console.error(error.message);await page.screenshot({path:path.join(root,'docs/implementation/desktop-v2-screenshots/storm-failure.png')});}
finally{if(started)await context.request.post(origin+'/api/generate/storm/stop',{data:{streamId:'storm-main'},headers:{Origin:origin}});fs.writeFileSync(path.join(root,'docs/implementation/desktop-v2-storm-checks.json'),JSON.stringify(evidence,null,2));await browser.close();}
