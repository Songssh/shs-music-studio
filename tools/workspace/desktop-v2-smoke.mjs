import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'docs/implementation/desktop-v2-screenshots');fs.mkdirSync(out,{recursive:true});
const {chromium}=await import(pathToFileURL('C:/Users/ssh15/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1600,height:1000}});
const origin='http://127.0.0.1:4301';
const credentials=JSON.parse(fs.readFileSync(path.resolve(root,'../auth-environment/runtime/library/auth-private/development-credentials.json'),'utf8'));
const response=await context.request.post(origin+'/api/auth/sign-in/email',{data:credentials,headers:{Origin:origin}});
if(!response.ok())throw Error('Login '+response.status());
const page=await context.newPage();page.on('pageerror',error=>console.log('PAGE ERROR: '+error.message));
try {
  await page.goto(origin);await page.locator('.workspace').waitFor();await page.waitForTimeout(1000);
  await page.screenshot({path:path.join(out,'00-initial.png')});
  await page.getByRole('button',{name:'앱 실행기',exact:true}).click();
  await page.screenshot({path:path.join(out,'02-launcher.png')});
  await page.getByRole('textbox',{name:'앱 검색'}).fill('images');
  await page.locator('.ws-app-open').click();await page.locator('[data-workspace-tool=images]').waitFor();
  await page.screenshot({path:path.join(out,'04-images-initial.png')});
  console.log(JSON.stringify({title:await page.title(),tools:await page.locator('[data-workspace-tool]').evaluateAll(nodes=>nodes.map(n=>n.dataset.workspaceTool)),imageCards:await page.locator('.ws-image-card').count(),bodyError:await page.locator('.ws-error').allTextContents()}));
} finally {await browser.close();}
