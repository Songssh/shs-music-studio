// Geometry measurements against the actual built app, using a fresh dev profile.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),origin=process.env.WORKSPACE_TEST_ORIGIN || 'http://127.0.0.1:4301';
const output=path.join(root,'docs/implementation/workspace-snap-edge-checks');fs.mkdirSync(output,{recursive:true});
const before=process.env.BEFORE_SNAP_FIX==='1';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1920,height:1080}});
const credentials=JSON.parse(fs.readFileSync(process.env.WORKSPACE_TEST_CREDENTIALS,'utf8'));
assert.equal((await context.request.post(origin+'/api/auth/sign-in/email',{data:{email:credentials.email,password:credentials.password},headers:{Origin:origin}})).status(),200);
const me=await(await context.request.get(origin+'/api/account/me')).json();
const preferences=await(await context.request.get(origin+'/api/desktop/preferences')).json();
await context.addInitScript(id=>localStorage.setItem(`hotstep:user:${encodeURIComponent(id)}:i18nextLng`,'ko'),me.user.id);
await context.addInitScript(id=>{const next=sessionStorage.getItem('snap-edge-next-layout');if(next){localStorage.setItem(`hotstep:user:${encodeURIComponent(id)}:hs-workspace-windows-v1`,next);sessionStorage.removeItem('snap-edge-next-layout');}},me.user.id);
const page=await context.newPage(),result={browser:await browser.version(),before,checks:[],measurements:[],errors:[],requests:[]};
page.on('pageerror',e=>result.errors.push(e.message));page.on('request',r=>{if(['POST','DELETE'].includes(r.method())&&/\/api\/(generate|audio-queue)|\/(stop|cancel|abort)(\/|$)/.test(r.url()))result.requests.push(new URL(r.url()).pathname);});
const settle=()=>page.waitForTimeout(220),pass=name=>{result.checks.push({name,passed:true});console.log('PASS '+name);};
const active=()=>page.locator('.dv-active-group');
const task=id=>page.locator(`.ws-rail [data-tool="${id}"]`);
const launch=async id=>{await page.getByRole('button',{name:'앱 실행기',exact:true}).click();await page.getByRole('textbox',{name:'앱 검색'}).fill(id);await page.locator('.ws-app-open').first().click();await settle();};
const activate=async id=>{if(await task(id).getAttribute('aria-pressed')!=='true')await task(id).click();await settle();};
const frame=id=>page.locator('.dv-resize-container').filter({has:page.locator(`[data-tab-panel-id="${id}"]`)});
const sameBox=(a,b)=>{for(const k of ['x','y','width','height'])assert.ok(Math.abs(a[k]-b[k])<.1,`${k}: ${a[k]} != ${b[k]}`);};
const picker=async id=>{await page.keyboard.press('Escape');await activate(id);await active().locator('.ws-window-actions').getByRole('button',{name:'Snap 레이아웃',exact:true}).click();};
const state=()=>page.evaluate(id=>JSON.parse(localStorage.getItem(`hotstep:user:${encodeURIComponent(id)}:hs-workspace-windows-v1`)),me.user.id);
const loadLayout=async layout=>{await page.evaluate(layout=>sessionStorage.setItem('snap-edge-next-layout',JSON.stringify(layout)),layout);await page.reload();await page.locator('.workspace').waitFor();await settle();};
const layoutNames=['halves','wide-left','wide-right','thirds','quarters','main-side','rows'];
const ids=['create','library','queue','parameters'];
const members=layout=>ids.slice(0,layout==='quarters'?4:['thirds','main-side'].includes(layout)?3:2);
const arrange=async(layout,selected)=>{
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'앱 실행기',exact:true}).click();await page.locator('.ws-launcher footer').getByRole('button',{name:'창 정렬',exact:true}).click();
  const option=page.locator(`[data-snap-layout="${layout}"][data-snap-slot="0"]`);
  if(await option.isDisabled()){await page.keyboard.press('Escape');return false;}
  await option.click();for(const id of await page.locator('.ws-snap-choice[aria-pressed=true]').evaluateAll(nodes=>nodes.map(n=>n.dataset.snapWindow)))await page.locator(`[data-snap-window="${id}"]`).click();
  for(const id of selected)await page.locator(`[data-snap-window="${id}"]`).click();await page.locator('.ws-snap-popover footer .primary').click();await settle();return true;
};
const measure=async(label,selected,strict=!before)=>{
  const data=await page.evaluate(({label,selected})=>{
    const rect=node=>{const r=node.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const area=rect(document.querySelector('.ws-center')),desktop=rect(document.querySelector('.ws-desktop')),rail=rect(document.querySelector('.ws-rail'));
    const windows=selected.map(id=>{const tab=document.querySelector(`[data-tab-panel-id="${id}"]`),outer=tab.closest('.dv-resize-container'),group=tab.closest('.dv-groupview');return{id,...rect(outer),radius:getComputedStyle(group).borderRadius,outerBorder:getComputedStyle(outer).borderWidth};});
    const outside={left:Math.min(...windows.map(w=>w.left))-area.left,top:Math.min(...windows.map(w=>w.top))-area.top,right:area.right-Math.max(...windows.map(w=>w.right)),bottom:area.bottom-Math.max(...windows.map(w=>w.bottom))};
    return{label,viewport:{width:innerWidth,height:innerHeight},area,desktop,rail,windows,outside};
  },{label,selected});result.measurements.push(data);
  if(strict){for(const value of Object.values(data.outside))assert.ok(Math.abs(value)<=.1,`${label}: outer inset ${JSON.stringify(data.outside)}`);assert.ok(Math.abs(data.area.left-data.rail.right)<=.1);
    assert.ok(Math.abs(data.windows.reduce((s,w)=>s+w.width*w.height,0)-data.area.width*data.area.height)<1,`${label}: uncovered area`);
    for(const [i,a]of data.windows.entries()){assert.equal(a.radius,'0px');for(const b of data.windows.slice(i+1))assert.ok(a.right<=b.left+.1||b.right<=a.left+.1||a.bottom<=b.top+.1||b.bottom<=a.top+.1,`${label}: overlap`);}}
  return data;
};
try{
  await page.goto(origin);await page.locator('.workspace').waitFor();await launch('queue');await launch('parameters');
  if(before){
    const normal=await frame('parameters').boundingBox();fs.writeFileSync(path.join(output,'legacy-layout.json'),JSON.stringify({layout:await state(),normal},null,2));
  }else{
    const legacy=JSON.parse(fs.readFileSync(path.join(output,'legacy-layout.json'),'utf8'));
    await loadLayout(legacy.layout);
    const normal=await frame('parameters').boundingBox();for(const k of ['x','y','width','height'])assert.ok(Math.abs(normal[k]-legacy.normal[k])<1,`legacy floating ${k}`);pass('legacy inset canvas migrates ordinary floating windows without moving or resizing them on screen');
  }
  for(const layout of layoutNames){assert.ok(await arrange(layout,members(layout)));await measure('1920-'+layout,members(layout));if(['halves','thirds','quarters'].includes(layout))await page.screenshot({path:path.join(output,`${before?'before':'after'}-${layout}.png`)});}
  pass('all seven layouts measured at 1920×1080');
  if(before)fs.writeFileSync(path.join(output,'legacy-snapped-layout.json'),JSON.stringify(await state(),null,2));
  else{
    await picker('parameters');await page.getByRole('button',{name:'Snap 해제 · 원래 위치',exact:true}).click();await settle();const free=await frame('parameters').boundingBox();
    for(const layout of layoutNames){
      await page.keyboard.press('Escape');await activate('parameters');const handle=await active().locator('.dv-void-container').boundingBox(),area=await page.locator('.ws-desktop').boundingBox();
      await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+12,handle.y+handle.height/2+30,{steps:4});
      await page.mouse.move(area.x+area.width/2,area.y+5,{steps:12});await page.locator('.ws-snap-bar[data-expanded=true]').waitFor();await settle();
      const cell=await page.locator(`[data-snap-layout="${layout}"][data-snap-slot="0"]`).boundingBox();await page.mouse.move(cell.x+cell.width/2,cell.y+cell.height/2,{steps:8});await settle();
      const preview=await page.locator('[data-testid=snap-preview]').boundingBox();await page.mouse.up();await settle();sameBox(await frame('parameters').boundingBox(),preview);
      const selected=['parameters',...members(layout).filter(id=>id!=='parameters').slice(0,members(layout).length-1)];
      for(const id of selected.slice(1)){await page.locator(`[data-snap-window="${id}"]`).click();await settle();}
      await measure('bar-preview-assist-'+layout,selected);
    }pass('all seven Snap Bar previews equal final window bounds; Snap Assist fills every remaining region with zero gaps');
    await picker('parameters');await page.getByRole('button',{name:'Snap 해제 · 원래 위치',exact:true}).click();await settle();sameBox(await frame('parameters').boundingBox(),free);assert.equal(await frame('parameters').evaluate(n=>getComputedStyle(n.querySelector('.dv-groupview')).borderRadius),'6px');pass('unsnap restores original floating position, size and rounded frame');
    await activate('parameters');const handle=await active().locator('.dv-void-container').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(200,400,{steps:12});await page.mouse.up();await settle();const offscreen=await frame('parameters').boundingBox();assert.ok(offscreen.x<64);await page.reload();await page.locator('.workspace').waitFor();await settle();sameBox(await frame('parameters').boundingBox(),offscreen);pass('normal floating windows can remain partly outside the workspace through reload');
    await arrange('halves',members('halves'));const saved=await state();await activate('create');const seam=page.locator('.ws-snap-divider.x').first();await seam.focus();await page.keyboard.press('ArrowRight');await settle();await measure('keyboard-resize',members('halves'));
    const divider=await seam.boundingBox();await page.mouse.move(divider.x+divider.width/2,divider.y+100);await page.mouse.down();await page.mouse.move(divider.x+104,divider.y+100,{steps:12});await page.mouse.up();await settle();await measure('pointer-resize',members('halves'));pass('linked keyboard and pointer resize keep a shared zero-gap boundary');
    await active().locator('.ws-window-actions').getByRole('button',{name:'최소화',exact:true}).click();await task('create').click();await settle();await measure('minimized-restore',members('halves'));
    await page.reload();await page.locator('.workspace').waitFor();await settle();await measure('reload',members('halves'));pass('zero-gap geometry survives minimize/restore and reload');
    for(const layout of ['thirds','quarters','main-side']){
      await arrange(layout,members(layout));await activate('create');await page.locator('.ws-snap-divider.x').first().focus();await page.keyboard.press('ArrowRight');await settle();
      if(await page.locator('.ws-snap-divider.y').count()){await page.locator('.ws-snap-divider.y').first().focus();await page.keyboard.press('ArrowDown');await settle();}
      await measure('linked-resize-'+layout,members(layout));
    }pass('three columns, four quarters and T-junction linked resizing keep every shared boundary aligned');
    await arrange('halves',members('halves'));
    await activate('create');await active().locator('.ws-window-actions').getByRole('button',{name:'최대화 / 원래 크기',exact:true}).click();await page.setViewportSize({width:1366,height:768});await settle();await active().locator('.ws-window-actions').getByRole('button',{name:'최대화 / 원래 크기',exact:true}).click();await settle();await measure('resize-while-maximized',members('halves'));
    await activate('library');await active().locator('.ws-window-actions').getByRole('button',{name:'최소화',exact:true}).click();await page.setViewportSize({width:1200,height:800});await settle();await task('library').click();await settle();await measure('resize-while-minimized',members('halves'));pass('maximized and minimized Snap windows restore to updated shared boundaries after browser resize');
    for(const viewport of [{width:1366,height:768},{width:1200,height:800}]){
      await page.setViewportSize(viewport);await settle();await measure('responsive-existing-'+viewport.width,members('halves'));
      for(const layout of layoutNames){assert.ok(await arrange(layout,members(layout)));await measure(viewport.width+'-'+layout,members(layout));}
    }pass('existing Snap and all seven new layouts fill 1366×768 and small 1200×800 Windows viewports');
    await page.setViewportSize({width:1365,height:769});await settle();await arrange('thirds',members('thirds'));await measure('odd-size-thirds',members('thirds'));pass('odd pixel boundaries share one rounded edge without gaps or overlaps');
    await page.getByRole('button',{name:'밝은 / 어두운 테마',exact:true}).click();await arrange('quarters',ids);await measure('other-theme-quarters',ids);await page.screenshot({path:path.join(output,'after-other-theme.png')});pass('edge-to-edge frames retain thin separators in the other theme');
    await page.setViewportSize({width:1920,height:1080});await settle();await loadLayout(JSON.parse(fs.readFileSync(path.join(output,'legacy-snapped-layout.json'),'utf8')));await measure('legacy-snapped-upgrade',members('rows'));pass('old gapped Snap layout upgrades to full workspace bounds');
    assert.ok(saved.snap.records.length);assert.deepEqual(result.requests,[]);
    if(await page.locator('.workspace').getAttribute('data-theme')!==preferences.theme){await page.getByRole('button',{name:'밝은 / 어두운 테마',exact:true}).click();await settle();}
  }
  assert.deepEqual(result.errors,[]);
}catch(error){result.failure=error.stack;process.exitCode=1;console.error(error);await page.screenshot({path:path.join(output,'failure.png')});}
finally{fs.writeFileSync(path.join(output,before?'before.json':'after.json'),JSON.stringify(result,null,2));await browser.close();}
