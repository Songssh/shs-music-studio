import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const priv=path.resolve(root,'../auth-environment/runtime/library/auth-private');
const origin='http://127.0.0.1:4301';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/ssh15/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1600,height:1000},storageState:path.join(priv,'workspace-browser-session.json')});
const page=await context.newPage();const evidence={at:new Date().toISOString(),checks:[],errors:[]};
page.on('pageerror',e=>evidence.errors.push(e.message));
const json=async(route,body)=>{const r=body?await context.request.post(origin+route,{data:body,headers:{Origin:origin}}):await context.request.get(origin+route);assert.ok(r.ok(),route+' '+r.status());return r.json();};
try{
  const datasets=await json('/api/training/datasets');
  const ds=datasets.datasets.find(d=>d.name==='Authentication regression dataset');assert.ok(ds,'Existing development training fixture');
  await page.goto(origin+'/training-studio/dataset/'+ds.id+'/train');
  await page.locator('[data-workspace-tool=training-studio]').waitFor();
  const submitted=await json('/api/training/datasets/'+ds.id+'/yue2-train',{lmType:'bf16',steps:1,rank:4,alpha:4,saveEvery:1,logEvery:1,warmup:0,gradAccum:1,kvCache:16,target:'attn'});
  console.log('Real YuE2 1-step training submitted');
  await page.locator('.dv-active-group .ws-window-actions').getByRole('button',{name:'창 닫기',exact:true}).click();
  let observedRunning=false,job;
  for(let i=0;i<360;i++){
    const result=await json('/api/training/jobs/'+submitted.jobId);job=result.job??result;
    if(['running','pending','queued'].includes(job.status))observedRunning=true;
    if(['succeeded','completed','failed','cancelled','done'].includes(job.status))break;
    if(i===2){await page.locator('.ws-rail nav button').filter({has:page.locator('span',{hasText:'Training'})}).click();await page.locator('.dv-active-group .ws-window-actions').getByRole('button',{name:'최소화',exact:true}).click();}
    await page.waitForTimeout(1000);
  }
  assert.ok(['succeeded','completed','done'].includes(job.status),job.error??job.status);
  await page.locator('.ws-rail nav button').filter({has:page.locator('span',{hasText:'Training'})}).click();
  await page.waitForTimeout(1000);
  evidence.checks.push({name:'실제 YuE2 NAR LoRA 1-step: 기존 API로 제출 후 Training 닫기·재열기·최소화 중 동일 job 완료',passed:true,jobId:submitted.jobId,status:job.status,observedRunning});
  assert.deepEqual(evidence.errors,[]);
  console.log('PASS real training '+job.status);
}catch(error){evidence.failure=String(error.message).split('Call log:')[0];console.error(evidence.failure);process.exitCode=1;}
finally{fs.writeFileSync(path.join(root,'docs/implementation/workspace-training-checks.json'),JSON.stringify(evidence,null,2));await browser.close();}
