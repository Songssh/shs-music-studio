// Test fixtures only. Production never imports this module.
import fs from 'node:fs';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createIdentityService } from './service.js';
import { installIdentityHTTP } from './http.js';
import { principalContext } from './principal.js';
import { prepareIdentitySchema } from './migration.js';
import { migrateOwnership } from './dataMigration.js';

export function prepareTestOwner(db:Database.Database,dir:string,id='fixture-owner') {
  db.prepare('INSERT OR IGNORE INTO users(id,username) VALUES(?,?)').run(id,id);
  prepareIdentitySchema(db);migrateOwnership(db,dir);
  principalContext.enterWith({id,role:'admin',sessionId:'test-fixture'});
  return id;
}
export async function authenticatedTestServer(app:Express,db:Database.Database,dir:string) {
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const identity=await createIdentityService({db,dataDir:dir,baseURL:base,allowHttpLoopback:true});
  installIdentityHTTP(app,identity);
  const headers={Origin:base,'Content-Type':'application/json'};
  const body={email:'fixture@example.test',name:'Fixture',password:'Only-A-Test-Password-123!'};
  const setup=await fetch(`${base}/api/account/setup`,{method:'POST',headers,body:JSON.stringify({...body,setupToken:fs.readFileSync(identity.setupFile,'utf8')})});
  if(!setup.ok)throw new Error('Test setup failed: '+await setup.text());
  const login=await fetch(`${base}/api/auth/sign-in/email`,{method:'POST',headers,body:JSON.stringify(body)});
  if(!login.ok)throw new Error('Test login failed');
  const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const me=await fetch(`${base}/api/account/me`,{headers:{Cookie:cookie}});
  const {user}=await me.json() as {user:{id:string}};
  return {server,base,cookie,user};
}
