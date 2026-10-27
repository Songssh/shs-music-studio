import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIdentityService } from './service.js';
import { installIdentityHTTP } from './http.js';
import { principalOf } from './principal.js';

test('cookie sessions, legacy bootstrap, registration policies and account authorization',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hotstep-auth-test-'));
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,bio TEXT DEFAULT '',avatar_url TEXT DEFAULT '',banner_url TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id,username) VALUES('legacy-id','Producer');
    CREATE TABLE songs(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id)); INSERT INTO songs VALUES('existing-song','legacy-id');`);
  const app=express();const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const service=await createIdentityService({db,dataDir:temp,baseURL:origin,allowHttpLoopback:true});
  installIdentityHTTP(app,service);
  app.get('/api/private',(req,res)=>res.json({id:principalOf(req)!.id}));
  let cookie='';
  async function request(url:string,method='GET',body?:unknown,session=cookie,source=origin){
    const response=await fetch(origin+url,{method,headers:{Origin:source,'Content-Type':'application/json',...(session?{Cookie:session}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json(),cookies:response.headers.getSetCookie()};
  }
  try{
    assert.equal((await request('/api/private')).status,401);
    assert.equal((await request('/api/auth/sign-up/email','POST',{email:'bypass@example.test',password:'LongPassword123!',name:'Bypass'})).status,404);
    const setupToken=fs.readFileSync(service.setupFile,'utf8');
    const setup=await request('/api/account/setup','POST',{email:'admin@example.test',password:'LongAdminPassword123!',name:'Administrator',setupToken});
    assert.equal(setup.status,200,JSON.stringify(setup.body));
    assert.equal((db.prepare('SELECT user_id FROM songs').get() as {user_id:string}).user_id,'legacy-id');
    assert.equal((await request('/api/account/setup','POST',{email:'other@example.test',password:'LongAdminPassword123!',name:'Other',setupToken})).status,409);
    assert.equal((await request('/api/auth/sign-in/email','POST',{email:'admin@example.test',password:'wrong'})).status,401);
    const login=await request('/api/auth/sign-in/email','POST',{email:'admin@example.test',password:'LongAdminPassword123!'});
    assert.equal(login.status,200,JSON.stringify(login.body));
    assert.match(login.cookies.join(';'),/HttpOnly/i);assert.match(login.cookies.join(';'),/SameSite=Lax/i);
    cookie=login.cookies.map(c=>c.split(';')[0]).join('; ');
    assert.equal((await request('/api/private')).body.id,'legacy-id');
    assert.equal((await request('/api/account/admin/registration','PUT',{mode:'closed'},cookie,'https://attacker.invalid')).status,403);
    assert.equal((await request('/api/account/admin/registration','PUT',{mode:'closed'})).status,200);
    assert.equal((await request('/api/account/register','POST',{email:'user@example.test',password:'LongUserPassword123!',name:'User'})).status,403);
    assert.equal((await request('/api/account/admin/registration','PUT',{mode:'invite'})).status,200);
    const invitation=await request('/api/account/admin/invitations','POST',{});
    assert.equal(invitation.status,201);
    const registration=await request('/api/account/register','POST',{email:'user@example.test',password:'LongUserPassword123!',name:'User',inviteCode:invitation.body.code});
    assert.equal(registration.status,201,JSON.stringify(registration.body));
    assert.equal((await request('/api/account/register','POST',{email:'second@example.test',password:'LongUserPassword123!',name:'Other',inviteCode:invitation.body.code})).status,403);
    const userLogin=await request('/api/auth/sign-in/email','POST',{email:'user@example.test',password:'LongUserPassword123!'},'');
    const userCookie=userLogin.cookies.map(c=>c.split(';')[0]).join('; ');
    assert.equal((await request('/api/account/admin/users','GET',undefined,userCookie)).status,403);
    assert.equal((await request('/api/auth/sign-out','POST',{},userCookie)).status,200);
    assert.equal((await request('/api/private','GET',undefined,userCookie)).status,401);
    assert.equal((await request('/api/account/admin/users/legacy-id','PATCH',{banned:true})).status,409);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();fs.rmSync(temp,{recursive:true,force:true});}
});
