import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Request } from 'express';
import type { Principal } from './principal.js';

const digest=(key:string)=>createHash('sha256').update(key).digest('hex');
export function issueDawKey(db:Database.Database,id:string){
  const key=randomBytes(32).toString('base64url'),expiresAt=Date.now()+30*86400_000;
  db.prepare('INSERT INTO auth_daw_keys(user_id,digest,expires_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET digest=excluded.digest,expires_at=excluded.expires_at').run(id,digest(key),expiresAt);
  return {key,expiresAt};
}
/** Restricted credential for existing native DAW clients, which cannot store browser cookies. */
export function dawIdentity(req:Request,db:Database.Database):Principal|undefined {
  if(!req.originalUrl.startsWith('/api/v1/daw/') || req.headers.origin)return;
  const key=req.get('X-DAW-Key');if(!key)return;
  const row=db.prepare('SELECT u.id,u.role FROM auth_daw_keys k JOIN users u ON u.id=k.user_id WHERE k.digest=? AND k.expires_at>? AND u.banned=0').get(digest(key),Date.now()) as {id:string;role:'admin'|'user'}|undefined;
  if(row)return {...row,sessionId:'daw-key'};
  // Preserve an explicitly configured pre-upgrade secret, bound to the legacy owner only.
  const configured=process.env.HOTSTEP_DAW_KEY;
  if(!configured || configured.length<32)return;
  const a=Buffer.from(key),b=Buffer.from(configured);if(a.length!==b.length||!timingSafeEqual(a,b))return;
  const legacy=db.prepare('SELECT u.id,u.role FROM registration_settings r JOIN users u ON u.id=r.legacy_user_id WHERE r.bootstrap_complete=1 AND u.banned=0').get() as {id:string;role:'admin'|'user'}|undefined;
  return legacy?{...legacy,sessionId:'daw-key'}:undefined;
}
