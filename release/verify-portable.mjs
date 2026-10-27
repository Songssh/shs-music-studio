// Local packaged-runtime acceptance check. Does not claim a clean Windows VM.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.join(root,'server/package.json'));
const node=path.join(root,'runtime/node.exe');
const reportArg=process.argv.indexOf('--report');
const reportFile=reportArg<0?path.join(os.tmpdir(),`hotstep-verification-${Date.now()}.json`):path.resolve(process.argv[reportArg+1]);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'HOT-Step portable test '));
const data=path.join(tmp,'Data 한글');
const fixtureConfig=path.join(tmp,'portable.json');
const report={date:new Date().toISOString(),scope:'current Windows PC, bundled runtime, sanitized child PATH; not a clean VM',node:null,checks:[],passed:false};
const check=(name)=>{report.checks.push(name);console.log(`PASS ${name}`);};
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const env={SystemRoot:process.env.SystemRoot,SystemDrive:process.env.SystemDrive,WINDIR:process.env.WINDIR,COMSPEC:process.env.COMSPEC,TEMP:tmp,TMP:tmp,USERPROFILE:tmp,LOCALAPPDATA:path.join(tmp,'Local'),APPDATA:path.join(tmp,'Roaming'),PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot};${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`};
let child,exited,log='',cookie='',ca,origin,port,enginePort;
function call(route,method='GET',body,headers={}) {
  return new Promise((resolve,reject)=>{
    const bytes=body===undefined?undefined:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
    const req=https.request(`${origin}${route}`,{method,hostname:'127.0.0.1',servername:'localhost',ca,headers:{Host:new URL(origin).host,Origin:origin,...(cookie?{Cookie:cookie}:{}),...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{}),...headers}},res=>{
      const chunks=[];res.on('data',d=>chunks.push(d));res.on('end',()=>{const buffer=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.headers,buffer,json:()=>JSON.parse(buffer.toString())});});
    });req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('HTTPS request timeout')));req.end(bytes);
  });
}
async function boot() {
  child=spawn(node,[path.join(root,'portable.mjs'),'start','--no-browser','--config',fixtureConfig],{cwd:tmp,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  exited=false;child.once('exit',()=>{exited=true;});child.once('error',e=>{log+=e.message;exited=true;});
  for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{log+=d;});
  for(let i=0;i<120;i++){if(exited)throw Error('Server exited before ready');try{const r=await call('/api/account/status');if(r.status===200)return r.json();}catch{}await pause(500);}
  throw Error('Server startup timeout');
}
async function stop(restart=false) {
  if(!child||exited)return;
  // The authenticated shutdown endpoint owns and cleans up its engine child.
  if(cookie) {try{await call(restart?'/api/shutdown/restart':'/api/shutdown','POST',{});}catch{}}
  for(let i=0;i<40&&!exited;i++)await pause(250);
  if(!exited)spawnSync(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  for(let i=0;i<40&&!exited;i++)await pause(100);
  if(!exited)throw Error('Server process did not stop');
}
try {
  assert.equal(process.execPath.toLowerCase(),node.toLowerCase(),'Run Verify with the bundled Node');
  report.node={version:process.version,abi:process.versions.modules,arch:process.arch};
  const Database=require('better-sqlite3'),sharp=require('sharp');
  report.sharp=sharp.versions;
  const db=new Database(path.join(tmp,'native.db'));db.exec('CREATE TABLE probe(value); INSERT INTO probe VALUES(42)');assert.equal(db.prepare('SELECT value FROM probe').get().value,42);db.close();
  check('SQLite native ABI and database write');
  const pixel=await sharp({create:{width:640,height:320,channels:3,background:'#d05030'}}).png().toBuffer();
  for(const format of ['jpeg','png','webp'])assert.equal((await sharp(await sharp(pixel).toFormat(format).toBuffer()).metadata()).format,format);
  check('Sharp native decode and JPEG/PNG/WebP encode');
  assert.equal(spawnSync(path.join(root,'server/ffmpeg.exe'),['-version'],{env,windowsHide:true}).status,0);check('Bundled FFmpeg with system-only PATH');
  const backend=spawnSync(path.join(root,'engine/ace-server.exe'),['--backend-check'],{cwd:tmp,env,windowsHide:true,encoding:'utf8',timeout:30000});
  assert.equal(backend.status,0,backend.stderr);
  report.backends=JSON.parse(backend.stdout.split(/\r?\n/).find(l=>l.startsWith('{"registered"')));
  assert(report.backends.cpu.initialised);assert(!report.backends.files.some(f=>f.load_error));
  check('Packaged CPU/GPU backend DLLs load with system-only PATH');
  port=await freePort();enginePort=await freePort();origin=`https://localhost:${port}`;
  const setup=spawnSync(node,[path.join(root,'portable.mjs'),'setup','--yes','--config',fixtureConfig,'--data-dir',data,'--url',origin,'--engine-port',String(enginePort)],{cwd:tmp,env,windowsHide:true,encoding:'utf8',timeout:30000});
  if(setup.status!==0)throw Error(`Setup failed: ${setup.stdout}\n${setup.stderr}`);
  ca=fs.readFileSync(path.join(data,'settings/tls/server.crt'));
  check('First setup, separate Unicode data folder and self-signed certificate');
  assert.equal((await boot()).setupRequired,true);check('HTTPS boot with certificate verification and no development PATH');
  assert.equal((await call('/')).status,200);assert.match((await call('/')).buffer.toString(),/<html/i);check('Compiled UI served');
  assert.equal((await call('/api/images')).status,401);check('Anonymous private API denied');
  const account={email:'portable@example.test',password:randomBytes(24).toString('base64url'),name:'Portable Admin'};
  const tokenFile=path.join(data,'library/auth-private/bootstrap-token');
  assert.equal((await call('/api/account/setup','POST',{...account,setupToken:fs.readFileSync(tokenFile,'utf8').trim()})).status,200);
  assert.equal(fs.existsSync(tokenFile),false);check('Better Auth initial administrator and token consumed');
  const login=await call('/api/auth/sign-in/email','POST',account);assert.equal(login.status,200);
  const cookies=login.headers['set-cookie'];assert(cookies.some(c=>/Secure/i.test(c)&&/HttpOnly/i.test(c)));
  cookie=cookies.map(c=>c.split(';')[0]).join('; ');
  assert.equal((await call('/api/account/me')).json().user.role,'admin');check('Better Auth login, secure cookie and persisted session');
  const form=new FormData();form.append('image',new Blob([pixel],{type:'image/png'}),'portable.png');
  const request=new Request(origin,{method:'POST',body:form});
  const upload=await call('/api/images','POST',Buffer.from(await request.arrayBuffer()),{'Content-Type':request.headers.get('content-type')});
  assert.equal(upload.status,201,upload.buffer.toString());const item=upload.json().image;
  for(const [url,width] of [[item.originalUrl,640],[item.thumbnailUrl,320]]){const r=await call(url);assert.equal(r.status,200);assert.equal((await sharp(r.buffer).metadata()).width,width);}
  assert.equal((await call(item.screenUrl)).status,200);check('Image library upload, original, thumbnail and screen variant');
  const prefs={background:{mode:'image',imageId:item.id,color:'#151925',fit:'contain',x:50,y:50,dim:.4,blur:0}};
  assert.equal((await call('/api/desktop/preferences','PATCH',prefs)).status,200);check('Workspace background references uploaded image');
  let engineHealthy=false;
  for(let i=0;i<60;i++){if(log.includes('No models installed — waiting'))break;try{if((await fetch(`http://127.0.0.1:${enginePort}/health`)).ok){engineHealthy=true;break;}}catch{}await pause(500);}
  assert(engineHealthy||log.includes('No models installed — waiting'),'Bundled engine neither started nor reported an empty model directory');
  check(engineHealthy?'Bundled C++ engine healthy':'Bundled C++ executable loads; empty model directory handled without restart loop');
  await stop(true);
  assert.equal(spawnSync(node,[path.join(root,'portable.mjs'),'consume-restart','--config',fixtureConfig],{env,windowsHide:true}).status,42);
  assert.equal(spawnSync(node,[path.join(root,'portable.mjs'),'consume-restart','--config',fixtureConfig],{env,windowsHide:true}).status,0);
  check('Graceful restart and data-local restart marker consumed once');
  const state=await boot();assert.equal(state.setupRequired,false);
  assert.equal((await call('/api/account/me')).status,200);assert.equal((await call('/api/images')).json().images[0].id,item.id);
  check('Restart preserves administrator, session and image data');
  await stop();
  try{await fetch(`http://127.0.0.1:${enginePort}/health`,{signal:AbortSignal.timeout(1000)});throw Error('Engine remained alive');}catch(e){if(e.message==='Engine remained alive')throw e;}
  check('Shutdown leaves no engine listener');report.passed=true;
} catch(error) {report.error=error.stack;console.error(error);process.exitCode=1;}
finally {
  try{await stop();}catch(e){report.cleanupError=e.message;report.passed=false;process.exitCode=1;}
  fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(reportFile.replace(/\.json$/,'')+'.log',log);
  if(report.passed)fs.rmSync(tmp,{recursive:true,force:true});else console.error(`Diagnostic fixture retained: ${tmp}`);
  console.log(`Report: ${reportFile}`);
}
