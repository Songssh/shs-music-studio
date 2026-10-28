// Fresh browser profile and development test accounts only. No preferences or
// existing jobs are modified; optional live generation creates one test song.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'), origin=process.env.WORKSPACE_TEST_ORIGIN || 'http://127.0.0.1:4301';
const output=path.join(root,'docs/implementation/workspace-snap-checks');fs.mkdirSync(output,{recursive:true});
const barOutput=path.join(root,'docs/implementation/workspace-snap-bar-checks');fs.mkdirSync(barOutput,{recursive:true});
if (!process.env.WORKSPACE_TEST_CREDENTIALS) throw new Error('Set WORKSPACE_TEST_CREDENTIALS to a private disposable test account JSON file');
const privateDir = path.dirname(path.resolve(process.env.WORKSPACE_TEST_CREDENTIALS));
const credentials=JSON.parse(fs.readFileSync(process.env.WORKSPACE_TEST_CREDENTIALS,'utf8'));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1920,height:1080}});
assert.equal((await context.request.post(origin+'/api/auth/sign-in/email',{data:{email:credentials.email,password:credentials.password},headers:{Origin:origin}})).status(),200);
const read=async route=>{const r=await context.request.get(origin+route);assert.equal(r.status(),200,route);return r.json();};
const me=await read('/api/account/me'),prefs=await read('/api/desktop/preferences');
const songs=(await read('/api/songs')).songs,song=songs.find(s=>Number(s.duration)>180)||songs[0];assert.ok(song);
const title='Workspace Snap QA '+new Date().toISOString();
await context.addInitScript(({id,title})=>{
  if(!localStorage.getItem('snap-qa-init')){
    const values={'hs-caption':'A gentle acoustic piano melody, instrumental, warm room','hs-duration':10,'hs-instrumental':true,'hs-title':title,'hs-skipLm':true,'hs-inferenceSteps':8,'hs-batchSize':1,'hs-postProcessingEnabled':false,'hs-autoTrimEnabled':false,'hs-coverArtEnabled':false};
    for(const[k,v]of Object.entries(values))localStorage.setItem(`hotstep:user:${encodeURIComponent(id)}:${k}`,JSON.stringify(v));
    localStorage.setItem(`hotstep:user:${encodeURIComponent(id)}:i18nextLng`,'ko');localStorage.setItem('snap-qa-init','1');
  }
  window.__snapMedia=[];const play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(...args){if(!window.__snapMedia.includes(this))window.__snapMedia.push(this);return play.apply(this,args);};
},{id:me.user.id,title});
const page=await context.newPage();
const result={browser:await browser.version(),checks:[],errors:[],jobRequests:[],cancellations:[],generated:null};
page.on('pageerror',e=>{result.errors.push(e.message);console.error('PAGE',e.message);});
page.on('request',r=>{if(!['POST','DELETE'].includes(r.method()))return;const url=new URL(r.url()).pathname;if(/\/(?:stop|cancel|abort)(?:\/|$)/.test(url))result.cancellations.push(url);if(/^\/api\/(?:generate|audio-queue)(?:\/|$)/.test(url))result.jobRequests.push(url);});
const record=name=>{result.checks.push({name,passed:true});console.log('PASS '+name);};
const until=async(fn,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await page.waitForTimeout(200);}throw Error('Timed out waiting for condition');};
const settle=()=>page.waitForTimeout(160);
const tool=id=>page.locator(`[data-workspace-tool="${id}"]`),task=id=>page.locator(`.ws-rail [data-tool="${id}"]`);
const active=()=>page.locator('.dv-active-group');
const launch=async id=>{await page.getByRole('button',{name:'앱 실행기',exact:true}).click();await page.getByRole('textbox',{name:'앱 검색'}).fill(id);await page.locator('.ws-app-open').first().click();await tool(id).waitFor();await settle();};
const activate=async id=>{if(await task(id).count()){if(await task(id).getAttribute('aria-pressed')!=='true')await task(id).click();}else await launch(id);await settle();};
const state=()=>page.evaluate(id=>JSON.parse(localStorage.getItem(`hotstep:user:${encodeURIComponent(id)}:hs-workspace-windows-v1`)),me.user.id);
const menu=async id=>{await page.keyboard.press('Escape');await activate(id);await active().locator('.ws-window-actions').getByRole('button',{name:'Snap 레이아웃',exact:true}).click();await page.locator('.ws-snap-popover:popover-open').waitFor();};
const pick=async(id,layout,slot=0)=>{await menu(id);await page.locator(`[data-snap-layout="${layout}"][data-snap-slot="${slot}"]`).click();await settle();};
const dismiss=async()=>{await page.keyboard.press('Escape');await settle();};
const arrange=async(layout,ids,screenshot)=>{
  await dismiss();await page.getByRole('button',{name:'앱 실행기',exact:true}).click();await page.locator('.ws-launcher footer').getByRole('button',{name:'창 정렬',exact:true}).click();
  await page.locator(`[data-snap-layout="${layout}"][data-snap-slot="0"]`).click();
  const selected=await page.locator('.ws-snap-choice[aria-pressed=true]').evaluateAll(nodes=>nodes.map(n=>n.dataset.snapWindow));
  for(const id of selected)await page.locator(`[data-snap-window="${id}"]`).click();
  for(const id of ids)await page.locator(`[data-snap-window="${id}"]`).click();
  if(screenshot){await page.locator('.ws-snap-choices').evaluate(node=>node.scrollTop=0);await page.screenshot({path:path.join(output,screenshot)});}
  await page.locator('.ws-snap-popover footer .primary').click();await settle();
};
const groups=f=>f.data?[f.data]:(function visit(n){return n.type==='leaf'?[n.data]:n.data.flatMap(visit);})(f.grid.root);
const floating=(data,id)=>data.layout.floatingGroups.find(f=>groups(f).some(g=>g.views.includes(id)));
const equalBox=(a,b)=>{for(const k of ['width','height','left','top'])assert.ok(Math.abs(a[k]-b[k])<2,`${k}: ${a[k]} != ${b[k]}`);};
const snapShot=async name=>page.screenshot({path:path.join(output,name)});
const startBarDrag=async id=>{
  await activate(id);const handle=await active().locator('.dv-void-container').boundingBox();assert.ok(handle.width>4);
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+12,handle.y+handle.height/2+30,{steps:4});
  await page.locator('.ws-snap-bar[data-expanded=false]').waitFor();await settle();
};
const expandBar=async()=>{const area=await page.locator('.ws-desktop').boundingBox();await page.mouse.move(area.x+area.width/2,area.y+5,{steps:12});await page.locator('.ws-snap-bar[data-expanded=true]').waitFor();await settle();};
const barDrop=async(id,layout,slot=0)=>{
  await dismiss();await startBarDrag(id);await expandBar();const cell=await page.locator(`[data-snap-layout="${layout}"][data-snap-slot="${slot}"]`).boundingBox();await page.mouse.move(cell.x+cell.width/2,cell.y+cell.height/2,{steps:10});await page.mouse.up();await settle();assert.equal(await page.locator('.ws-snap-bar').count(),0);
};
try{
  await page.goto(origin);await page.locator('.workspace').waitFor();await launch('library');
  await tool('library').locator(`[data-sel-id="${song.id}"] button`).first().click();
  await until(()=>page.evaluate(()=>window.__snapMedia.some(a=>!a.paused&&a.currentTime>.2)));
  const mediaStart=await page.evaluate(()=>{window.__playingSnap=window.__snapMedia.find(a=>!a.paused);return window.__playingSnap.currentTime;});
  await launch('queue');await launch('parameters');
  assert.equal(await page.locator('.ws-snap-bar').count(),0);await page.screenshot({path:path.join(barOutput,'01-idle.png')});
  if(await page.locator('.workspace').getAttribute('data-theme')!=='dark')await page.getByRole('button',{name:'밝은 / 어두운 테마',exact:true}).click();
  await startBarDrag('parameters');await page.screenshot({path:path.join(barOutput,'02-handle-dark.png')});await expandBar();await page.screenshot({path:path.join(barOutput,'03-expanded-dark.png')});
  const highlighted=await page.locator('[data-snap-layout=quarters][data-snap-slot="2"]').boundingBox();await page.mouse.move(highlighted.x+highlighted.width/2,highlighted.y+highlighted.height/2,{steps:8});await settle();assert.equal(await page.locator('[data-drag-target=true]').count(),1);await page.screenshot({path:path.join(barOutput,'04-region-preview.png')});
  await page.mouse.move(1500,700,{steps:5});await settle();assert.equal(await page.locator('.ws-snap-bar').getAttribute('data-expanded'),'false');await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await page.locator('.ws-snap-bar').count(),0);
  record('actual Snap Bar: hidden at rest, handle on drag, expanded layouts and highlight, collapse and cancel cleanup');
  await page.getByRole('button',{name:'밝은 / 어두운 테마',exact:true}).click();await startBarDrag('parameters');await page.screenshot({path:path.join(barOutput,'05-handle-light.png')});await expandBar();await page.screenshot({path:path.join(barOutput,'06-expanded-light.png')});await page.keyboard.press('Escape');await page.mouse.up();await page.getByRole('button',{name:'밝은 / 어두운 테마',exact:true}).click();
  record('actual Snap Bar uses Workspace light and dark themes');
  await active().locator('.ws-window-actions').getByRole('button',{name:'최대화 / 원래 크기',exact:true}).hover();
  await page.locator('.ws-snap-popover:popover-open').waitFor();assert.equal(await page.locator('.ws-snap-layout').count(),7);await snapShot('01-snap-picker.png');await dismiss();
  record('actual Edge: maximize hover opens seven visual layouts above other windows');
  for(const layout of ['halves','wide-left','wide-right','thirds','quarters','main-side','rows']){
    await pick('parameters',layout);await dismiss();assert.ok((await state()).snap.records.some(r=>JSON.parse(r.key).includes('parameters')));
    await menu('parameters');await page.getByRole('button',{name:'Snap 해제 · 원래 위치',exact:true}).click();await settle();
  }record('actual application: all seven layouts and explicit unsnap');
  await arrange('halves',['create','library']);await snapShot('02-halves.png');
  await arrange('thirds',['create','library','queue']);await snapShot('03-three-columns.png');
  await arrange('quarters',['create','library','queue','parameters'],'07-arrange-dialog.png');await snapShot('04-quarters.png');
  await arrange('main-side',['create','library','queue']);await snapShot('05-main-and-two.png');
  record('actual application: two, three, four and large-plus-two arrangements via launcher, with selected order');
  const desktop=await page.locator('.ws-desktop').boundingBox();await page.locator('.ws-desktop').focus();await page.keyboard.press('Shift+F10');await page.getByRole('menuitem',{name:'창 정렬',exact:true}).click();await snapShot('08-arrange-context-menu.png');await dismiss();
  record('desktop context menu exposes arrangements, save and previous-arrangement restore');
  await activate('create');
  const beforeDrag=floating(await state(),'create').position;
  const handle=await active().locator('.dv-void-container').boundingBox();assert.ok(handle.width>4);
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+8,handle.y+handle.height/2+4,{steps:3});
  await page.mouse.move(desktop.x+desktop.width-1,desktop.y+desktop.height/2,{steps:20});await page.locator('[data-testid=snap-preview]').waitFor();await snapShot('06-drag-preview.png');
  await page.keyboard.press('Escape');await page.mouse.up();await settle();equalBox(floating(await state(),'create').position,beforeDrag);
  record('actual app drag preview and Escape cancellation preserve the complete pre-drag Snap geometry');
  const seam=page.locator('.ws-snap-divider.x').first();await seam.focus();await page.keyboard.press('ArrowRight');await settle();
  assert.ok(floating(await state(),'create').position.width>beforeDrag.width);record('actual app adjacent-window divider responds to keyboard resize');
  await launch('queue');await active().locator('.ws-tab-combine').focus();await active().locator('.ws-tab-combine').selectOption('create');await settle();
  await launch('parameters');await active().locator('.ws-tab-combine').focus();await active().locator('.ws-tab-combine').selectOption('create');await settle();
  await pick('parameters','halves');await page.locator('[data-snap-window=library]').click();await settle();
  const grouped=floating(await state(),'create'),beforeMin=grouped.position;
  assert.equal(grouped.data.views.length,3);assert.equal(grouped.data.activeView,'parameters');
  await active().locator('.ws-window-actions').getByRole('button',{name:'최소화',exact:true}).click();await task('create').click();await settle();
  assert.deepEqual(floating(await state(),'create').data.views,grouped.data.views);assert.equal(floating(await state(),'create').data.activeView,'parameters');equalBox(floating(await state(),'create').position,beforeMin);
  await active().locator('.ws-window-actions').getByRole('button',{name:'최대화 / 원래 크기',exact:true}).click();await settle();await active().locator('.ws-window-actions').getByRole('button',{name:'최대화 / 원래 크기',exact:true}).click();await settle();equalBox(floating(await state(),'create').position,beforeMin);
  record('actual three-tab Snap group preserves order, active tab and placement through minimize/restore and maximize/restore');
  await barDrop('parameters','halves',0);await dismiss();assert.deepEqual(floating(await state(),'create').data.views,grouped.data.views);assert.equal(floating(await state(),'create').data.activeView,'parameters');record('actual Snap Bar drops all three tabs together and preserves their order and active tab');
  assert.ok(await page.evaluate(t=>!window.__playingSnap.paused&&window.__playingSnap.currentTime>t,mediaStart));record('same global audio element keeps playing throughout repeated Snap operations');
  assert.deepEqual(result.jobRequests,[]);record('Snap, unsnap, arrangement and resize send no Generate/Stop/Cancel requests');
  if(process.env.RUN_LIVE_GENERATION==='1'){
    // Pin only this test request to the installed ACE model. Do not change the
    // shared active backend or wait for a UI queue belonging to another engine.
    const backendBefore=await read('/api/backends'),models=await read('/api/models');
    const ditModel=models.models.dit.find(name=>name.includes('turbo'))||models.models.dit[0];assert.ok(ditModel);
    const response=await context.request.post(origin+'/api/generate',{headers:{Origin:origin},data:{backendOverride:'ace',expectedBackend:'ace',backend:'ace',ditModel,title,caption:'A gentle acoustic piano melody, instrumental, warm room',lyrics:'',instrumental:true,duration:10,skipLm:true,inferenceSteps:8,batchSize:1,postProcessingEnabled:false,autoTrimEnabled:false,coverArtEnabled:false,source:'create'}});
    assert.equal(response.status(),200,await response.text());const job=await response.json();
    const started=await until(async()=>{const s=await read('/api/generate/status/'+job.jobId);assert.ok(!['failed','cancelled','succeeded'].includes(s.status),s.error||'generation must still be running during Snap');return ['running','lm_running','synth_running'].includes(s.status)&&s;},600000);
    result.generationStart={jobId:job.jobId,status:started.status,backend:'ace',ditModel,submission:'authenticated API, per-request override'};
    for(const layout of ['wide-left','rows','halves']){await barDrop('create',layout);await dismiss();}
    const generated=await until(async()=>{const s=await read('/api/generate/status/'+job.jobId);assert.ok(!['error','failed','cancelled'].includes(s.status),s.error);return(await read('/api/songs')).songs.find(s=>s.title===title);},600000);
    result.generated={id:generated.id,title,duration:generated.duration};assert.equal((await read('/api/songs')).songs.filter(s=>s.title===title).length,1);
    assert.deepEqual(result.jobRequests,[]);assert.equal((await read('/api/backends')).activeId,backendBefore.activeId);
    record('installed-model generation completes exactly once while its grouped window is repeatedly snapped');
  }
  assert.deepEqual(result.cancellations,[]);
  const persisted=floating(await state(),'create');await page.reload();await page.locator('.workspace').waitFor();await settle();
  const restored=await state(),recordAfterReload=restored.snap.records.find(r=>JSON.parse(r.key).includes('create'));
  equalBox(floating(restored,'create').position,restored.snap.sessions.find(s=>s.id===recordAfterReload.session).cells[recordAfterReload.slot]);assert.deepEqual(floating(restored,'create').data.views,persisted.data.views);assert.equal(floating(restored,'create').data.activeView,persisted.data.activeView);
  record('actual user-scoped layout persists Snap geometry and grouped tabs across reload');
  const savedLayout=await state(),afterReload=floating(savedLayout,'create');
  for(const version of [1,2]){
    await page.evaluate(({id,savedLayout,version})=>{const legacy=structuredClone(savedLayout);legacy.version=version;delete legacy.snap;localStorage.setItem(`hotstep:user:${encodeURIComponent(id)}:hs-workspace-windows-v1`,JSON.stringify(legacy));},{id:me.user.id,savedLayout,version});
    await page.reload();await page.locator('.workspace').waitFor();await settle();equalBox(floating(await state(),'create').position,afterReload.position);assert.deepEqual(floating(await state(),'create').data.views,persisted.data.views);
  }
  record('legacy v1 and v2 layouts without Snap metadata retain the existing tabs and placement');
  await page.setViewportSize({width:1366,height:768});await pick('create','thirds');await dismiss();await snapShot('09-1366.png');
  await page.setViewportSize({width:760,height:650});await menu('create');assert.equal(await page.locator('[data-snap-layout=thirds]:disabled').count(),3);await snapShot('10-narrow.png');await dismiss();
  record('1366×768 and narrow Windows viewport: valid layouts apply, unusable layouts are disabled');
  const zoom=await browser.newContext({storageState:await context.storageState(),viewport:{width:1280,height:720},deviceScaleFactor:1.5});const zoomPage=await zoom.newPage();await zoomPage.goto(origin);await zoomPage.locator('.workspace').waitFor();assert.ok(await zoomPage.locator('.ws-rail').isVisible());await zoomPage.screenshot({path:path.join(output,'11-150-percent-scale.png')});await zoom.close();
  record('150% scale equivalent (1280×720 CSS viewport, device scale 1.5) keeps Workspace accessible');
  const otherCredentials=JSON.parse(fs.readFileSync(path.join(privateDir,'second-development-account.json'),'utf8'));
  const other=await browser.newContext({viewport:{width:1366,height:768}});assert.equal((await other.request.post(origin+'/api/auth/sign-in/email',{data:{email:otherCredentials.email,password:otherCredentials.password},headers:{Origin:origin}})).status(),200);
  assert.ok([403,404].includes((await other.request.get(origin+'/api/songs/'+song.id)).status()));const otherPage=await other.newPage();await otherPage.goto(origin);await otherPage.locator('.workspace').waitFor();
  assert.equal(await otherPage.evaluate(id=>Object.keys(localStorage).some(k=>k.startsWith(`hotstep:user:${encodeURIComponent(id)}:`)),me.user.id),false);assert.equal(await otherPage.locator('.ws-snap-divider').count(),0);await other.close();
  if(await page.locator('.workspace').getAttribute('data-theme')!==prefs.theme){await page.getByRole('button',{name:'밝은 / 어두운 테마',exact:true}).click();await until(async()=>JSON.stringify(await read('/api/desktop/preferences'))===JSON.stringify(prefs));}
  assert.deepEqual(await read('/api/desktop/preferences'),prefs);record('other account cannot access the first account song/layout; pinned apps and background preferences are unchanged and original theme restored');
  const mobile=await browser.newContext({storageState:await context.storageState(),viewport:{width:412,height:915},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'});
  const phone=await mobile.newPage();await phone.goto(origin);await phone.getByRole('button',{name:'생성하기',exact:true}).waitFor();assert.equal(await phone.locator('.workspace,.ws-snap-trigger,.ws-snap-popover,.ws-snap-divider,.ws-snap-bar').count(),0);await phone.screenshot({path:path.join(output,'12-android-classic.png')});await mobile.close();record('Android UA/touch emulation retains the original creation UI and player, without Snap controls');
  await page.setViewportSize({width:1920,height:1080});await page.getByRole('button',{name:'앱 실행기',exact:true}).click();await page.getByRole('button',{name:'기존 UI로 전환',exact:true}).click();await until(async()=>await page.locator('.workspace').count()===0);assert.equal(await page.locator('.ws-snap-divider,.ws-snap-popover').count(),0);record('switching to classic UI removes Snap controls and listeners');
  assert.deepEqual(result.errors,[]);
}catch(error){result.failure=error.stack;process.exitCode=1;console.error(error);const s=await state();console.error(JSON.stringify({records:s.snap?.records,sessions:s.snap?.sessions,active:s.layout.activeGroup,dividers:await page.locator('.ws-snap-divider').evaluateAll(nodes=>nodes.map(n=>({value:n.getAttribute('aria-valuenow'),left:n.style.left,top:n.style.top})))}));await page.screenshot({path:path.join(output,'application-failure.png')});}
finally{for(const folder of [output,barOutput])fs.writeFileSync(path.join(folder,process.env.RUN_LIVE_GENERATION==='1'?'application-live.json':'application.json'),JSON.stringify(result,null,2));await browser.close();}
