import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type Database from 'better-sqlite3';
import type { Principal } from './principal.js';

export const WORKER_OWNER = 'x-hotstep-worker-owner';
export const WORKER_ROLE = 'x-hotstep-worker-role';
/** A configured controller is trusted to attest its authenticated owner. This
 * credential never comes from browser state and is restricted to worker APIs. */
export function workerIdentity(req:Request, db:Database.Database, token?:string):Principal|undefined {
  if(!token || !/^\/api\/(?:training(?:\/|$)|health$)/.test(req.originalUrl.split('?')[0]))return;
  const supplied=Buffer.from(req.get('x-hotstep-worker-token')??''),expected=Buffer.from(token);
  if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))return;
  const id=req.get(WORKER_OWNER);
  if(!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))return;
  const role=req.get(WORKER_ROLE)==='admin'?'admin':'user';
  // No credential/email is created: this identity can only be used by the
  // authenticated controller, never by public sign-in or registration.
  db.prepare('INSERT OR IGNORE INTO users(id,username) VALUES(?,?)').run(id,`worker:${id}`);
  return {id,role,sessionId:'worker-delegation'};
}
