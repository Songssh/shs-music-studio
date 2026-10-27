import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const root = path.dirname(fileURLToPath(import.meta.url));
const command = process.argv[2] || 'start';
const args = process.argv.slice(3);
const option = name => { const i=args.indexOf(name); if(i<0)return undefined; if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`Missing value for ${name}`); return args[i+1]; };
const configFile = path.resolve(option('--config') || path.join(root, 'portable.json'));
const inside = (a,b) => { const r=path.relative(a,b); return !r||(!r.startsWith('..')&&!path.isAbsolute(r)); };
function validate(s) {
  const url=new URL(s.url);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Use an HTTPS origin without a path or credentials');
  if(inside(root,s.dataDir))throw Error('Data directory must be outside the application folder');
  if(![s.port,s.enginePort].every(p=>Number.isInteger(p)&&p>0&&p<=65535)||s.port===s.enginePort)throw Error('Invalid or conflicting ports');
  if(!['self-signed','pem','proxy'].includes(s.tls))throw Error('Invalid TLS mode');
  if(s.tls!=='proxy'&&s.port!==Number(url.port||443))throw Error('HTTPS address port must match listener port');
  if(s.tls==='proxy'&&s.host!=='127.0.0.1')throw Error('Reverse proxy listener must bind to 127.0.0.1');
  return s;
}
function loadSettings() {
  const s=JSON.parse(fs.readFileSync(configFile,'utf8'));
  s.dataDir=path.resolve(root,s.dataDir);
  return validate(s);
}
function protect(directory) {
  const who=spawnSync(path.join(process.env.SystemRoot,'System32/whoami.exe'),['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});
  const sid=who.stdout?.match(/S-1-5-[0-9-]+/)?.[0];
  if(!sid)throw Error('Cannot resolve current Windows account SID');
  const r=spawnSync(path.join(process.env.SystemRoot,'System32/icacls.exe'),[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{encoding:'utf8',windowsHide:true});
  if(r.status!==0)throw Error(`Cannot protect private directory: ${r.stderr||r.stdout}`);
}
async function setup() {
  if(fs.existsSync(configFile)){console.log('Already configured. Edit portable.json to change the data folder or address; existing data is preserved.');return;}
  const unattended=args.includes('--yes');
  const rl=unattended?null:createInterface({input:process.stdin,output:process.stdout});
  const ask=async(label,value)=>unattended?value:(await rl.question(`${label} [${value}]: `)).trim()||value;
  try {
    const dataDir=path.resolve(root,option('--data-dir')||await ask('Separate data directory','../SHS-Music-Studio-Data'));
    const url=new URL(option('--url')||await ask('HTTPS address','https://localhost:3443'));
    const tls=args.includes('--proxy')?'proxy':option('--cert')?'pem':'self-signed';
    if(tls==='pem'&&!option('--key'))throw Error('--cert requires --key');
    const host=tls==='proxy'?'127.0.0.1':['localhost','127.0.0.1','[::1]'].includes(url.hostname)?'127.0.0.1':'0.0.0.0';
    const s=validate({dataDir,url:url.href,host,port:Number(option('--port')||(tls==='proxy'?3001:url.port||443)),enginePort:Number(option('--engine-port')||8085),tls});
    for(const dir of ['settings','settings/tls','profile','library','library/auth-private','models','adapters'])fs.mkdirSync(path.join(dataDir,dir),{recursive:true});
    protect(path.join(dataDir,'settings/tls'));protect(path.join(dataDir,'library/auth-private'));
    const tlsDir=path.join(dataDir,'settings/tls');
    if(tls==='self-signed'&&!fs.existsSync(path.join(tlsDir,'server.pfx'))) {
      const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
      const r=spawnSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'create-certificate.ps1'),'-Directory',tlsDir,'-DnsName',url.hostname.replace(/^\[|\]$/g,'')],{stdio:'inherit',windowsHide:true});
      if(r.status!==0)throw Error('Certificate generation failed');
    } else if(tls==='pem') {
      fs.copyFileSync(path.resolve(option('--cert')),path.join(tlsDir,'server.crt'));
      fs.copyFileSync(path.resolve(option('--key')),path.join(tlsDir,'server.key'));
    }
    fs.writeFileSync(configFile,JSON.stringify({...s,url:url.origin,dataDir:path.relative(root,dataDir)||dataDir},null,2)+'\n',{flag:'wx'});
    console.log(`Configured ${url.origin}\nData: ${dataDir}`);
    if(tls==='self-signed')console.log(`Local certificate: ${path.join(tlsDir,'server.crt')}\nTrust this certificate on each client (see README.txt); it is not automatically trusted.`);
  } finally {rl?.close();}
}
function applySettings(s) {
  Object.assign(process.env,{HOT_STEP_ROOT:root,HOT_STEP_DATA_ROOT:s.dataDir,HOT_STEP_PROFILE_DIR:path.join(s.dataDir,'profile'),SERVER_HOST:s.host,SERVER_PORT:String(s.port),ACESTEPCPP_PORT:String(s.enginePort),ACESTEPCPP_HOST:'127.0.0.1',HOT_STEP_AUTH_URL:s.url,NODE_ENV:'production'});
  for(const k of ['HOT_STEP_AUTH_HTTP_LOOPBACK','HOT_STEP_TLS_PFX','HOT_STEP_TLS_CERT','HOT_STEP_TLS_KEY','HOT_STEP_REVERSE_PROXY'])delete process.env[k];
  const tlsDir=path.join(s.dataDir,'settings/tls');
  if(s.tls==='self-signed')process.env.HOT_STEP_TLS_PFX=path.join(tlsDir,'server.pfx');
  if(s.tls==='pem'){process.env.HOT_STEP_TLS_CERT=path.join(tlsDir,'server.crt');process.env.HOT_STEP_TLS_KEY=path.join(tlsDir,'server.key');}
  if(s.tls==='proxy')process.env.HOT_STEP_REVERSE_PROXY='1';
}
try {
  if(command==='setup')await setup();
  else if(command==='consume-restart') {
    const s=loadSettings(),marker=path.join(s.dataDir,'profile/restart-requested');
    if(fs.existsSync(marker)){fs.unlinkSync(marker);process.exitCode=42;}
  } else if(command==='start') {
    if(!fs.existsSync(configFile))await setup();
    const s=loadSettings();applySettings(s);
    for(const [port,host] of [[s.port,s.host],[s.enginePort,'127.0.0.1']])await new Promise((resolve,reject)=>{
      const probe=net.createServer();probe.once('error',reject);probe.listen(port,host,()=>probe.close(resolve));
    });
    console.log(`SHS Music Studio: ${s.url}\nData: ${s.dataDir}\nInitial administrator token: ${path.join(s.dataDir,'library/auth-private/bootstrap-token')}`);
    process.chdir(root);
    await import('./server/server.mjs');
    if(!args.includes('--no-browser')) {
      const timer=setInterval(()=>{
        const request=https.get(s.url+'/api/account/status',{rejectUnauthorized:false},res=>{
          res.resume();if(res.statusCode!==200)return;clearInterval(timer);
          spawn(path.join(process.env.SystemRoot,'explorer.exe'),[s.url],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});
        });request.on('error',()=>{});request.setTimeout(1500,()=>request.destroy());
      },1000);timer.unref();setTimeout(()=>clearInterval(timer),30000).unref();
    }
  } else throw Error(`Unknown command: ${command}`);
} catch(error){console.error(`[Portable] ${error.message}`);process.exitCode=1;}
