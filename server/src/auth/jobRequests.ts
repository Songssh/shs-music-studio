import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { principalOf, type Principal } from './principal.js';

// One-use, short-lived capabilities for the existing internal training HTTP calls.
// They are not browser sessions, are never returned to a client and cannot call admin APIs.
const pending=new Map<string,{principal:Principal;method:string;path:string;expires:number}>();
export function takeJobRequest(req:Request):Principal|null {
  const value=req.headers['x-hotstep-job-request'];if(typeof value!=='string')return null;
  const entry=pending.get(value);pending.delete(value);
  if(!entry||entry.expires<Date.now()||entry.method!==req.method||entry.path!==req.originalUrl.split('?')[0])return null;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))return null;
  return entry.principal;
}
export async function jobFetch(input:string,init:RequestInit={}):Promise<Response> {
  const url=new URL(input);const port=process.env.SERVER_PORT||'3001';
  if(url.origin!==`http://127.0.0.1:${port}`)return fetch(input,init);
  const training=/^\/api\/training\/(?:datasets|jobs)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)?$/.test(url.pathname);
  const daw=/^\/api\/(?:health|models|capabilities|backends|analyze|generate(?:\/(?:status|cancel)\/[a-zA-Z0-9_-]+)?)$/.test(url.pathname);
  if(!training&&!daw)throw new Error('Unsupported internal job route');
  const owner=principalOf();if(!owner)throw new Error('Internal job request needs an owner');
  const now=Date.now();for(const [key,value] of pending)if(value.expires<=now)pending.delete(key);
  if(pending.size>=1000)throw new Error('Too many internal requests');
  const token=randomBytes(32).toString('base64url');
  pending.set(token,{principal:{...owner,role:'user',sessionId:'server-job'},method:(init.method??'GET').toUpperCase(),path:url.pathname,expires:now+30_000});
  const headers=new Headers(init.headers);headers.set('x-hotstep-job-request',token);
  try{return await fetch(input,{...init,headers});}finally{pending.delete(token);}
}
