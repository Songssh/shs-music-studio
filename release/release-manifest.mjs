import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const [root,version,variant,engineSource]=process.argv.slice(2);
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const lock=JSON.parse(fs.readFileSync(path.join(root,'server/package-lock.json')));
const packages=Object.entries(lock.packages).filter(([p])=>p&&fs.existsSync(path.join(root,'server',p,'package.json'))).map(([p,v])=>({path:p,version:v.version,integrity:v.integrity,license:v.license}));
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const uiLock=JSON.parse(fs.readFileSync(path.join(sourceRoot,'ui/package-lock.json')));
const uiPackages=Object.entries(uiLock.packages).filter(([p,v])=>p&&!v.dev).map(([p,v])=>({path:p,version:v.version,integrity:v.integrity,license:v.license}));
const notices=['Frontend dependency notices. Server licenses are retained under server/node_modules.\n'];
for(const p of uiPackages){
  const dir=path.join(sourceRoot,'ui',p.path);
  notices.push(`\n${p.path} ${p.version} (${p.license || 'see package'})\n`);
  if(fs.existsSync(dir))for(const name of fs.readdirSync(dir).filter(n=>/^(license|licence|copying|notice)(\.|$)/i.test(n))) {
    if(fs.statSync(path.join(dir,name)).isFile())notices.push(fs.readFileSync(path.join(dir,name),'utf8'));
  }
}
fs.writeFileSync(path.join(root,'THIRD-PARTY-NOTICES.txt'),notices.join('\n'));
fs.writeFileSync(path.join(root,'release-manifest.json'),JSON.stringify({version,variant,node:process.version,abi:process.versions.modules,createdAt:new Date().toISOString(),engine:{source:path.basename(engineSource),files:walk(path.join(root,'engine')).filter(f=>/\.(exe|dll)$/.test(f)).map(f=>({path:path.relative(root,f),sha256:sha(f)}))},packages,uiPackages},null,2)+'\n');
