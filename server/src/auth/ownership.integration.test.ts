import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createIdentityService } from './service.js';
import { installIdentityHTTP } from './http.js';
import { AssetOwnership } from './assets.js';
import { principalContext } from './principal.js';
import { AudioIntentQueue } from '../services/audioQueue/intentQueue.js';

test('two accounts: private songs, range media, queue dedup/cancel, datasets and scoped lyric reads',async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hotstep-isolation-'));
  process.env.DATA_DIR=temp;process.env.TRAINING_DIR=path.join(temp,'training');
  process.env.ACESTEPCPP_MODELS=path.join(temp,'models');process.env.ACESTEPCPP_ADAPTERS=path.join(temp,'adapters');
  fs.mkdirSync(process.env.ACESTEPCPP_MODELS,{recursive:true});
  const {initDb,getDb,closeDb}=await import('../db/database.js');initDb();const db=getDb();
  db.prepare('INSERT INTO users(id,username) VALUES(?,?)').run('owner-a','Original owner');
  const app=express(),server=app.listen(0,'127.0.0.1');
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));closeDb();fs.rmSync(temp,{recursive:true,force:true});});
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const service=await createIdentityService({db,dataDir:temp,baseURL:origin,allowHttpLoopback:true});
  installIdentityHTTP(app,service);app.use(express.json());
  const {roleBoundary,personalInputBoundary}=await import('./boundary.js');
  app.use('/api',roleBoundary,personalInputBoundary);
  app.post('/api/generation-input',(_req,res)=>res.json({ok:true}));
  app.post('/api/settings/env',(_req,res)=>res.json({ok:true}));
  const {default:songs}=await import('../routes/songs.js');app.use('/api/songs',songs);
  const {default:training}=await import('../routes/training.js');app.use('/api/training',training);
  const media=new AssetOwnership(db,temp);app.use('/audio',media.middleware,express.static(path.join(temp,'audio')));
  fs.mkdirSync(path.join(temp,'references'),{recursive:true});
  app.use('/references',media.middleware,express.static(path.join(temp,'references')));
  async function call(url:string,cookie='',method='GET',body?:unknown,headers:Record<string,string>={}){
    return fetch(origin+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  }
  const setup=await call('/api/account/setup','','POST',{email:'a@example.test',name:'Account A',password:'Testing-Account-A-Only!',setupToken:fs.readFileSync(service.setupFile,'utf8')});assert.equal(setup.status,200,await setup.text());
  const signin=async(email:string,password:string)=>{const res=await call('/api/auth/sign-in/email','','POST',{email,password});assert.equal(res.status,200);return res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');};
  const a=await signin('a@example.test','Testing-Account-A-Only!');
  assert.equal((await call('/api/account/register','','POST',{email:'b@example.test',name:'Account B',password:'Testing-Account-B-Only!'})).status,201);
  assert.equal((await call('/api/account/register','','POST',{email:'B@EXAMPLE.TEST',name:'Duplicate',password:'Testing-Account-B-Only!'})).status,400);
  const b=await signin('b@example.test','Testing-Account-B-Only!');
  const bId=(db.prepare('SELECT id FROM users WHERE email=?').get('b@example.test') as {id:string}).id;
  const bytes=Buffer.from('RIFF-private-audio-fixture');fs.writeFileSync(path.join(temp,'audio','a.wav'),bytes);
  db.prepare('INSERT INTO songs(id,user_id,title,audio_url) VALUES(?,?,?,?)').run('song-a','owner-a','Private song','/audio/a.wav');
  assert.equal((await call('/api/songs/song-a',b)).status,404);
  assert.equal((await (await call('/api/songs',b)).json() as {songs:unknown[]}).songs.length,0);
  assert.equal((await call('/audio/a.wav')).status,401);
  assert.equal((await call('/audio/a.wav',b)).status,404);
  const range=await call('/audio/a.wav',a,'GET',undefined,{Range:'bytes=0-3'});assert.equal(range.status,206);assert.equal(await range.text(),'RIFF');
  assert.equal((await call('/api/songs',a,'GET',undefined,{'X-Hotstep-User':bId})).status,401);
  assert.equal((await call('/references/%2e%2e%2fauth-private/session-secret',a)).status,404);
  fs.writeFileSync(path.join(temp,'references','a.wav'),bytes);media.register(path.join(temp,'references','a.wav'),'owner-a');
  assert.equal((await call('/references/a.wav',a)).status,200);
  assert.equal((await call('/references/a.wav',b)).status,404);
  assert.equal((await call('/api/settings/env',b,'POST',{})).status,403);
  assert.equal((await call('/api/generation-input',b,'POST',{sourceAudioUrl:origin+'/audio/a.wav'})).status,404);
  assert.equal((await call('/api/generation-input',a,'POST',{sourceAudioUrl:'/audio/a.wav'})).status,200);
  assert.equal((await call('/api/generation-input',a,'POST',{sourcePath:'../auth-private/session-secret'})).status,404);
  const adapter=path.join(process.env.ACESTEPCPP_ADAPTERS!,'private-a.safetensors');fs.mkdirSync(path.dirname(adapter),{recursive:true});fs.writeFileSync(adapter,'fixture');media.register(adapter,'owner-a');
  assert.equal((await call('/api/generation-input',b,'POST',{loraStack:[{path:adapter}]})).status,404);
  assert.equal((await call('/api/generation-input',a,'POST',{loraStack:[{path:adapter}]})).status,200);
  const {translateParams}=await import('../services/generation/translateParams.js');
  assert.throws(()=>principalContext.run({id:bId,role:'user',sessionId:'fixture'},()=>translateParams({loraPath:adapter})),/not found/i);
  // A queued neural split must keep the shared GPU until its engine job ends.
  // This uses a fake engine; actual neural weights are a separate live test gate.
  const {config}=await import('../config.js'),oldEngineHost=config.aceServer.host;
  config.aceServer.host='supersep-test.invalid';
  const {default:supersep}=await import('../routes/supersep.js');app.use('/api/supersep',supersep);
  const wav=Buffer.alloc(44+1920);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(192000,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1920,40);
  fs.writeFileSync(path.join(temp,'audio','a.wav'),wav);
  const nativeFetch=globalThis.fetch;let engineDone=false,startedResolve!:()=>void;
  const started=new Promise<void>(resolve=>startedResolve=resolve);
  globalThis.fetch=async(input,init)=>{
    const url=String(input);if(!url.startsWith('http://supersep-test.invalid'))return nativeFetch(input,init);
    if(url.includes('/models/loaded'))return new Response(JSON.stringify({loaded:[]}));
    if(url.includes('/unload'))return new Response(JSON.stringify({unloaded:true,lm_resident:false,vae_resident:false}));
    if(url.includes('/separate')){startedResolve();return new Response(JSON.stringify({id:'engine-private'}));}
    return new Response(JSON.stringify({status:engineDone?'done':'running',progress:engineDone?100:10,message:''}));
  };
  const {runOnGpuLane}=await import('../services/generation/gpuLane.js');let following:Promise<unknown>|undefined;
  try{
    const split=await (await call('/api/supersep/separate',a,'POST',{audioUrl:'/audio/a.wav'})).json() as {id:string};
    await Promise.race([started,new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Split did not start')),3000);timer.unref();})]);
    assert.equal((await call('/api/supersep/'+split.id+'/progress',b)).status,404);
    let generationStarted=false;following=runOnGpuLane(async()=>{generationStarted=true;});
    await Promise.resolve();assert.equal(generationStarted,false);
    engineDone=true;await following;assert.equal(generationStarted,true);
  }finally{engineDone=true;await following;globalThis.fetch=nativeFetch;config.aceServer.host=oldEngineHost;}
  const q=new AudioIntentQueue({db,activeEngine:()=> 'ace',isEngine:()=>true,getJob:()=>undefined,cancelJob:()=>true,submit:async()=>({ok:true,jobId:'simulated'})});
  const qa=q.enqueue({idempotencyKey:'same-key',request:{seed:1}},'owner-a');
  assert.equal(q.enqueue({idempotencyKey:'same-key',request:{seed:1}},'owner-a').created,false);
  const qb=q.enqueue({idempotencyKey:'same-key',request:{seed:1}},bId);assert.notEqual(qa.item.id,qb.item.id);
  assert.throws(()=>q.cancel(qa.item.id,bId),/not found/i);assert.equal(q.list(undefined,bId).length,1);
  q.setPaused(true,'owner-a');assert.equal(q.state(bId).paused,false);
  const asA=<T>(work:()=>T)=>principalContext.run({id:'owner-a',role:'admin',sessionId:'fixture'},work);
  asA(()=>db.prepare('INSERT INTO training_datasets(id,slug,name,source_dir) VALUES(?,?,?,?)').run('dataset-a','dataset-a','A',temp));
  assert.equal((await (await call('/api/training/datasets',b)).json() as {datasets:unknown[]}).datasets.length,0);
  assert.equal((await call('/api/training/datasets/dataset-a',b)).status,404);
  asA(()=>db.prepare('INSERT INTO artists(name) VALUES(?)').run('A private artist'));
  const visible=principalContext.run({id:bId,role:'user',sessionId:'fixture'},()=>db.prepare('SELECT * FROM auth_owned_artists').all());assert.equal(visible.length,0);
  assert.equal((db.pragma('integrity_check') as {integrity_check:string}[])[0].integrity_check,'ok');
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
