import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import express from 'express';
import { createIdentityService } from './service.js';
import { installIdentityHTTP } from './http.js';
import { principalOf, principalContext } from './principal.js';
import { runOnGpuLane } from '../services/generation/gpuLane.js';
import { onTrainingGpu } from '../services/training/sharedGpu.js';
import { setSkipThinking,resetSkipThinking,shouldSkipThinking } from '../services/lireek/llm/types.js';

async function fixture(t:test.TestContext){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hs-security-')),db=new Database(':memory:');
 db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,bio TEXT DEFAULT '',avatar_url TEXT DEFAULT '',banner_url TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP); INSERT INTO users(id,username) VALUES('admin-a','Legacy');");
 const app=express(),server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const service=await createIdentityService({db,dataDir:dir,baseURL:origin,allowHttpLoopback:true});installIdentityHTTP(app,service);
 app.get('/api/private',(_req,res)=>res.json({owner:principalOf()!.id}));
 app.get('/api/events',(_req,res)=>{res.setHeader('Content-Type','text/event-stream');res.write(`data: ${JSON.stringify({owner:principalOf()!.id})}\n\n`);});
 app.get('/api/v1/daw/status',(_req,res)=>res.json({owner:principalOf()!.id}));
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const call=(url:string,cookie='',method='GET',body?:unknown,headers:Record<string,string>={})=>fetch(origin+url,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const admin={email:'a@example.test',password:'Only-Test-Password-12345',name:'Admin'};
 assert.equal((await call('/api/account/setup','','POST',{...admin,setupToken:fs.readFileSync(service.setupFile,'utf8')})).status,200);
 const login=async(body:unknown)=>{const r=await call('/api/auth/sign-in/email','','POST',body);assert.equal(r.status,200);return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');};
 return {dir,db,app,origin,service,call,login,admin};
}

test('device sessions, password change/reset, CSRF, expiry and long stream revocation',async t=>{
 const f=await fixture(t),{call,db,admin}=f;
 const a=await f.login(admin);
 const bUser={email:'b@example.test',password:'Only-Test-Password-B-123',name:'B'};
 assert.equal((await call('/api/account/register','','POST',bUser)).status,201);
 const b1=await f.login(bUser),b2=await f.login(bUser);
 const me=await (await call('/api/account/me',b1)).json() as {user:{id:string}};
 assert.equal((await fetch(f.origin+'/api/account/profile',{method:'PATCH',headers:{Cookie:b1,'Content-Type':'application/json'},body:JSON.stringify({name:'forbidden'})})).status,403);
 assert.equal((await call('/api/private','', 'GET',undefined,{Authorization:'Bearer admin-a'})).status,401);
 assert.equal((await call('/api/auth/change-password',b1,'POST',{currentPassword:bUser.password,newPassword:'Changed-Test-Password-B-123',revokeOtherSessions:true})).status,200);
 assert.equal((await call('/api/private',b2)).status,401);
 // Better Auth rotates the current cookie on password change; sign in again as a separate device.
 const b3=await f.login({...bUser,password:'Changed-Test-Password-B-123'});
 const sse=await call('/api/events',b3),reader=sse.body!.getReader();
 assert.match(new TextDecoder().decode((await reader.read()).value),new RegExp(me.user.id));
 assert.equal((await call(`/api/account/admin/users/${me.user.id}/password`,a,'POST',{password:'Reset-Test-Password-B-1234'})).status,200);
 assert.equal((await call('/api/private',b3)).status,401);
 const ended=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Revoked SSE remained open')),2500);timer.unref();})]);assert.equal(ended.done,true);reader.releaseLock();
 const aSession=db.prepare('SELECT id FROM auth_sessions WHERE userId=?').get('admin-a') as {id:string};
 db.prepare('UPDATE auth_sessions SET expiresAt=? WHERE id=?').run(Date.now()-1000,aSession.id);
 assert.equal((await call('/api/private',a)).status,401);
});

test('HTTPS cookies, login throttling, DAW key scope and explicit revocation',async t=>{
 const f=await fixture(t),a=await f.login(f.admin);
 const secure=await createIdentityService({db:f.db,dataDir:f.dir,baseURL:'https://hotstep.example.test'});
 const login=await secure.auth.handler(new Request('https://hotstep.example.test/api/auth/sign-in/email',{method:'POST',headers:{Origin:'https://hotstep.example.test','Content-Type':'application/json'},body:JSON.stringify(f.admin)}));
 assert.equal(login.status,200);assert.match(login.headers.getSetCookie().join(';'),/; Secure/i);assert.match(login.headers.getSetCookie().join(';'),/HttpOnly/i);
 const key=await (await f.call('/api/account/daw-key',a,'POST',{})).json() as {key:string};
 const daw=()=>fetch(f.origin+'/api/v1/daw/status',{headers:{'X-DAW-Key':key.key}});
 assert.equal((await daw()).status,200);
 assert.equal((await fetch(f.origin+'/api/private',{headers:{'X-DAW-Key':key.key}})).status,401);
 assert.equal((await f.call('/api/account/daw-key',a,'DELETE')).status,200);assert.equal((await daw()).status,401);
 let blocked=false;for(let i=0;i<7;i++){const r=await f.call('/api/auth/sign-in/email','','POST',{email:f.admin.email,password:'wrong'},{'x-forwarded-for':`192.0.2.${i+1}`,'x-hotstep-client-ip':`192.0.2.${i+1}`});if(r.status===429){blocked=true;break;}}
 assert.equal(blocked,true);
});

test('queued shared GPU callbacks retain the submitting account after the previous owner releases',async()=>{
 let release!:()=>void;const held=new Promise<void>(r=>release=r),seen:string[]=[];
 const a=principalContext.run({id:'a',role:'user',sessionId:'a'},()=>runOnGpuLane(async()=>{seen.push(principalOf()!.id);await held;seen.push(principalOf()!.id);}));
 const b=principalContext.run({id:'b',role:'user',sessionId:'b'},()=>runOnGpuLane(async()=>{seen.push(principalOf()!.id);}));
 await Promise.resolve();release();await Promise.all([a,b]);assert.deepEqual(seen,['a','a','b']);
});

test('training waits for generation and its nested fallback cannot deadlock the shared GPU',async()=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve),seen:string[]=[];
 const generation=runOnGpuLane(async()=>{seen.push('generation');await held;});
 const training=onTrainingGpu(async()=>{seen.push('training');await onTrainingGpu(async()=>{seen.push('fallback');},{label:'fallback'});},{label:'training'});
 await Promise.resolve();assert.deepEqual(seen,['generation']);release();await Promise.all([generation,training]);assert.deepEqual(seen,['generation','training','fallback']);
});

test('LLM skip-thinking belongs to the submitting account',()=>{
 const a=<T>(fn:()=>T)=>principalContext.run({id:'a',role:'user',sessionId:'fixture'},fn);
 const b=<T>(fn:()=>T)=>principalContext.run({id:'b',role:'user',sessionId:'fixture'},fn);
 a(setSkipThinking);assert.equal(a(shouldSkipThinking),true);assert.equal(b(shouldSkipThinking),false);
 b(resetSkipThinking);assert.equal(a(shouldSkipThinking),true);a(resetSkipThinking);assert.equal(a(shouldSkipThinking),false);
});
