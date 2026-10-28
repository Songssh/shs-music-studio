// Native browser page zoom in disposable Edge profiles, not CSS zoom or pinch scale.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),origin=process.env.WORKSPACE_TEST_ORIGIN || 'http://127.0.0.1:4301';
const output=path.join(root,'docs/implementation/workspace-snap-edge-checks');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const credentials=JSON.parse(fs.readFileSync(process.env.WORKSPACE_TEST_CREDENTIALS,'utf8'));
const result={checks:[],measurements:[],errors:[]};
for(const factor of [1.25,1.5]){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snap-edge-zoom-'));fs.mkdirSync(path.join(dir,'Default'));
  // Chromium ChromeZoomLevelPrefs uses "x" for the default storage partition.
  fs.writeFileSync(path.join(dir,'Default','Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(factor)/Math.log(1.2)}}}));
  const context=await chromium.launchPersistentContext(dir,{channel:'msedge',headless:true,viewport:null,args:['--window-size=1920,1080']});
  try{
    assert.equal((await context.request.post(origin+'/api/auth/sign-in/email',{data:credentials,headers:{Origin:origin}})).status(),200);
    const me=await(await context.request.get(origin+'/api/account/me')).json();await context.addInitScript(id=>localStorage.setItem(`hotstep:user:${encodeURIComponent(id)}:i18nextLng`,'ko'),me.user.id);
    const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));await page.goto(origin);await page.locator('.workspace').waitFor();const cdp=await context.newCDPSession(page);
    assert.ok(Math.abs(await page.evaluate(()=>devicePixelRatio)-factor)<.001);
    const settle=()=>page.waitForTimeout(220);
    for(const id of ['queue','parameters']){await page.getByRole('button',{name:'앱 실행기',exact:true}).click();await page.getByRole('textbox',{name:'앱 검색'}).fill(id);await page.locator('.ws-app-open').first().click();await settle();}
    const arrange=async(layout,ids)=>{
      await page.keyboard.press('Escape');await page.getByRole('button',{name:'앱 실행기',exact:true}).click();await page.locator('.ws-launcher footer').getByRole('button',{name:'창 정렬',exact:true}).click();await page.locator(`[data-snap-layout="${layout}"][data-snap-slot="0"]`).click();
      for(const id of await page.locator('.ws-snap-choice[aria-pressed=true]').evaluateAll(nodes=>nodes.map(n=>n.dataset.snapWindow)))await page.locator(`[data-snap-window="${id}"]`).click();
      for(const id of ids)await page.locator(`[data-snap-window="${id}"]`).click();await page.locator('.ws-snap-popover footer .primary').click();await settle();
    };
    const measure=async(layout,ids)=>{
      const data=await page.evaluate(({layout,ids})=>{
        const rect=n=>{const r=n.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        return{layout,dpr:devicePixelRatio,viewport:{width:innerWidth,height:innerHeight},area:rect(document.querySelector('.ws-center')),windows:ids.map(id=>rect(document.querySelector(`[data-tab-panel-id="${id}"]`).closest('.dv-resize-container')))};
      },{layout,ids});result.measurements.push(data);
      const {area,windows}=data;
      const outside=[Math.min(...windows.map(w=>w.left))-area.left,Math.min(...windows.map(w=>w.top))-area.top,area.right-Math.max(...windows.map(w=>w.right)),area.bottom-Math.max(...windows.map(w=>w.bottom))];
      for(const value of outside)assert.ok(Math.abs(value)<.05,`${factor} ${layout}: ${outside}`);
      for(const [i,a]of windows.entries())for(const b of windows.slice(i+1))assert.ok(a.right<=b.left+.02||b.right<=a.left+.02||a.bottom<=b.top+.02||b.bottom<=a.top+.02);
      assert.ok(Math.abs(windows.reduce((sum,w)=>sum+w.width*w.height,0)-area.width*area.height)<1,`${factor} ${layout}: uncovered area`);
    };
    for(const layout of ['halves','wide-left','wide-right','thirds','quarters','main-side','rows']){
      const ids=['create','library','queue','parameters'].slice(0,layout==='quarters'?4:['thirds','main-side'].includes(layout)?3:2);
      await arrange(layout,ids);await measure(layout,ids);if(layout==='thirds'){const shot=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});fs.writeFileSync(path.join(output,`after-native-zoom-${factor*100}.png`),Buffer.from(shot.data,'base64'));}
    }
    await arrange('halves',['create','library']);
    const {windowId}=await cdp.send('Browser.getWindowForTarget');await cdp.send('Browser.setWindowBounds',{windowId,bounds:{width:1366,height:768}});await settle();await measure('resized-native-window',['create','library']);
    await page.reload();await page.locator('.workspace').waitFor();await settle();await measure('reload-native-zoom',['create','library']);
    result.checks.push({factor,passed:true});console.log(`PASS native Edge ${factor*100}%: seven layouts, browser resize, reload`);
  }catch(error){result.failure=error.stack;process.exitCode=1;console.error(error);break;}
  finally{await context.close();if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('snap-edge-zoom-'))throw Error('Unexpected temporary path');fs.rmSync(dir,{recursive:true,force:true});}
}
assert.deepEqual(result.errors,[]);fs.writeFileSync(path.join(output,'native-zoom.json'),JSON.stringify(result,null,2));
