import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const privateDir = path.resolve(root, '../auth-environment/runtime/library/auth-private');
const report = path.join(root, 'docs/implementation/workspace-live-checks.json');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/ssh15/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const context = await browser.newContext({viewport:{width:1600,height:1000},storageState:path.join(privateDir,'workspace-browser-session.json')});
const origin='http://127.0.0.1:4301';
const me=await (await context.request.get(origin+'/api/account/me')).json();
const title='Workspace live '+new Date().toISOString();
await context.addInitScript(({id,title})=>{
  if (!localStorage.getItem('workspace-qa-seeded')) {
    const settings={'hs-caption':'A short gentle acoustic piano melody, instrumental, warm room','hs-duration':10,'hs-instrumental':true,'hs-title':title,
      'hs-skipLm':true,'hs-inferenceSteps':8,'hs-batchSize':1,'hs-postProcessingEnabled':false,'hs-autoTrimEnabled':false,
      'hs-storm-caption':'A short gentle piano instrumental','hs-storm-instrumental':true,'hs-storm-duration-v2':10,'hs-storm-auto-expand':false,'hs-storm-lss':0};
    for(const [key,value] of Object.entries(settings))localStorage.setItem(`hotstep:user:${encodeURIComponent(id)}:${key}`,JSON.stringify(value));
    localStorage.setItem('workspace-qa-seeded','1');
  }
  window.__qaMedia=[]; window.__qaDecoded=0; window.__qaContexts=[];
  const BaseContext=window.AudioContext;
  window.AudioContext=class extends BaseContext {
    constructor(options){super(options);window.__qaContexts.push(this);}
    async decodeAudioData(...args){const audio=await super.decodeAudioData(...args);window.__qaDecoded++;return audio;}
  };
  const play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(...args){if(!window.__qaMedia.includes(this))window.__qaMedia.push(this);return play.apply(this,args);};
  window.__qaPageIdentity=Math.random();
},{id:me.user.id,title});
const page=await context.newPage(); const evidence={at:new Date().toISOString(),checks:[],errors:[]};
const save=()=>fs.writeFileSync(report,JSON.stringify(evidence,null,2));
const record=(name,detail)=>{evidence.checks.push({name,passed:true,detail});save();console.log('PASS '+name);};
page.on('pageerror',e=>evidence.errors.push(e.message));
const submissions=[];const stops=[];
page.on('request',request=>{
  if(request.method()==='POST' && /\/api\/(generate$|audio-queue\/items$)/.test(request.url()))submissions.push(request.url());
  if(request.method()==='POST' && /\/storm\/stop$/.test(request.url()))stops.push(request.url());
});
const open=async title=>page.locator('.ws-rail nav button').filter({has:page.locator('span',{hasText:title})}).click();
const activeButton=label=>page.locator('.dv-active-group .ws-window-actions').getByRole('button',{name:label,exact:true});
const json=async route=>{const r=await context.request.get(origin+route);assert.ok(r.ok(),route+' '+r.status());return r.json();};
async function until(fn,timeout=180000){const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await page.waitForTimeout(1000);}throw new Error('Timed out waiting for real engine result');}
try{
  await page.goto(origin);await page.locator('[data-workspace-tool=create]').waitFor();
  await page.locator('[data-workspace-tool=create]').getByRole('button',{name:'생성하기',exact:true}).click();
  await until(()=>submissions.length===1,15000);
  await activeButton('창 닫기').click();
  await open('Training');await activeButton('창 닫기').click();
  await open('음악 생성 · Custom-Gen');await activeButton('최소화').click();
  const song=await until(async()=> (await json('/api/songs')).songs.find(s=>s.title===title),600000);
  assert.equal(submissions.length,1);
  assert.equal((await json('/api/songs')).songs.filter(s=>s.title===title).length,1);
  record('실제 ACE 생성: 닫기·재열기·최소화 뒤 완료, 요청·결과 각 1회',{songId:song.id,title,duration:song.duration});
  const audio=await context.request.get(origin+song.audio_url,{headers:{Range:'bytes=0-63'}});
  assert.equal(audio.status(),206);assert.equal((await audio.body()).subarray(0,4).toString(),'RIFF');record('실제 생성 WAV 및 Range 응답');
  await open('내 음악');
  const all=(await json('/api/songs')).songs;const long=all.find(s=>Number(s.duration)>90)??song;
  const row=page.locator(`[data-workspace-tool=library] [data-sel-id="${long.id}"]`);
  await row.locator('button').first().click();
  await until(()=>page.evaluate(()=>window.__qaMedia.some(a=>!a.paused&&a.currentTime>0)),15000);
  const before=await page.evaluate(()=>{const a=window.__qaMedia.find(a=>!a.paused);return {time:a.currentTime,src:a.src,count:window.__qaMedia.length,identity:window.__qaPageIdentity};});
  await open('음악 생성 · Custom-Gen');await page.getByRole('button',{name:'창 분리',exact:true}).click();
  await activeButton('최대화 / 원래 크기').click();await activeButton('최대화 / 원래 크기').click();
  await page.getByRole('button',{name:'기존 UI로 전환',exact:true}).click();
  await page.mouse.move(10,970);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'새 Workspace 사용',exact:true}).click();
  await page.waitForTimeout(1600);
  const after=await page.evaluate(()=>{const a=window.__qaMedia.find(a=>!a.paused);return a&&{time:a.currentTime,src:a.src,count:window.__qaMedia.length,identity:window.__qaPageIdentity};});
  assert.ok(after&&after.time>before.time&&after.src===before.src&&after.count===before.count&&after.identity===before.identity);
  record('실제 재생: 창 분리·최대화·기존 UI 왕복 중 동일 오디오·페이지·재생시간 유지',{before:before.time,after:after.time,mediaElements:after.count});
  await page.evaluate(()=>window.__qaMedia.forEach(a=>a.pause()));
  await open('STORM');
  const decodedBefore=await page.evaluate(()=>window.__qaDecoded);
  await page.locator('[data-workspace-tool=storm]').getByRole('button',{name:'Start',exact:true}).click();
  await until(async()=> (await json('/api/generate/storm/control?streamId=storm-main')).running,30000);
  await activeButton('창 닫기').click();await page.waitForTimeout(1500);
  assert.equal((await json('/api/generate/storm/control?streamId=storm-main')).running,true);assert.equal(stops.length,0);
  await open('STORM');await page.locator('[data-workspace-tool=storm]').getByRole('button',{name:'Stop',exact:true}).waitFor();
  await until(()=>page.evaluate(n=>window.__qaDecoded>n,decodedBefore),300000);
  await page.waitForTimeout(3000);
  await page.screenshot({path:path.join(root,'docs/implementation/workspace-screenshots/08-storm-live.png')});
  record('실제 STORM: 창 닫기 후 서버 stream 유지, 재열기 Stop 상태 복원',{control:await json('/api/generate/storm/control?streamId=storm-main')});
  await page.locator('[data-workspace-tool=storm]').getByRole('button',{name:'Stop',exact:true}).click();
  await until(async()=>!(await json('/api/generate/storm/control?streamId=storm-main')).running,15000);assert.equal(stops.length,1);
  record('STORM 명시적 Stop만 1회 실행');
  assert.deepEqual(evidence.errors,[]);record('실제 모델 브라우저 예외 없음');
}catch(error){evidence.failure=String(error.message).split('Call log:')[0];console.error(evidence.failure);await page.screenshot({path:path.join(root,'docs/implementation/workspace-screenshots/live-failure.png')});process.exitCode=1;}
finally{save();await context.request.post(origin+'/api/generate/storm/stop',{data:{streamId:'storm-main'},headers:{Origin:origin}}).catch(()=>{});await browser.close();}
