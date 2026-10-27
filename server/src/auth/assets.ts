import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { RequestHandler } from 'express';
import { principalOf } from './principal.js';

export class OwnershipError extends Error { readonly status=404; constructor(){super('Resource not found');} }
export function canonical(file:string):string {
  const resolved=path.resolve(file);
  // Resolve the existing ancestor as well: a missing output under a junction is not safe.
  let ancestor=resolved;const tail:string[]=[];
  while(!fs.existsSync(ancestor)){const parent=path.dirname(ancestor);if(parent===ancestor)throw new OwnershipError();tail.unshift(path.basename(ancestor));ancestor=parent;}
  const real=path.join(fs.realpathSync.native(ancestor),...tail);
  return process.platform==='win32'?real.toLowerCase():real;
}
export function inside(file:string,root:string):boolean {const rel=path.relative(root,file);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
export class AssetOwnership {
  constructor(readonly db:Database.Database,readonly dataDir:string,readonly audioDir=path.join(dataDir,'audio')){}
  register(file:string,userId:string,kind='file'):string {
    const value=canonical(file);
    const prior=this.db.prepare('SELECT id,user_id FROM user_assets WHERE path=?').get(value) as {id:string;user_id:string}|undefined;
    if(prior){if(prior.user_id!==userId)throw new OwnershipError();return prior.id;}
    const others=this.db.prepare('SELECT path,kind FROM user_assets WHERE user_id<>?').all(userId) as {path:string;kind:string}[];
    if(others.some(a=>(a.kind==='directory'&&inside(value,a.path))||(kind==='directory'&&inside(a.path,value))))throw new OwnershipError();
    const id=randomUUID();this.db.prepare('INSERT INTO user_assets VALUES(?,?,?,?,?)').run(id,userId,value,kind,Date.now());return id;
  }
  resolve(value:string):string {
    if(value.includes('\0') || value.includes('\\') && value.startsWith('/'))throw new OwnershipError();
    if(value.startsWith('/audio/')||value.startsWith('/references/')) {
      const audio=value.startsWith('/audio/');const root=canonical(audio?this.audioDir:path.join(this.dataDir,'references'));
      let name:string;try{name=decodeURIComponent(value.slice(audio?7:12));}catch{throw new OwnershipError();}
      const target=canonical(path.resolve(root,name));if(!inside(target,root))throw new OwnershipError();return target;
    }
    if(!path.isAbsolute(value))throw new OwnershipError();
    return canonical(value);
  }
  owns(file:string,userId:string):boolean {
    let target:string;try{target=this.resolve(file);}catch{return false;}
    const asset=this.db.prepare('SELECT user_id FROM user_assets WHERE path=?').get(target) as {user_id:string}|undefined;
    if(asset)return asset.user_id===userId;
    if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='audio_assets'").get()){
      const uploads=this.db.prepare('SELECT url FROM audio_assets WHERE user_id=?').all(userId) as {url:string}[];
      if(uploads.some(a=>{try{return this.resolve(a.url)===target;}catch{return false;}}))return true;
    }
    // New server output is linked by the existing song row; no pathname-only grant.
    const columns=(this.db.prepare('PRAGMA table_info(songs)').all() as {name:string}[]).map(c=>c.name).filter(c=>c.endsWith('_url'));
    if(columns.length){const songs=this.db.prepare(`SELECT ${columns.join(',')} FROM songs WHERE user_id=?`).all(userId) as Record<string,string>[];
      for(const row of songs)for(const value of Object.values(row))if(value){try{
        const original=this.resolve(value);if(original===target)return true;
        const stem=original.replace(/\.[^.\\/]+$/,'');if(['.lrc','.lyrics.json','.score.abc'].some(ext=>stem+ext===target))return true;
      }catch{}}
    }
    const dirs=this.db.prepare("SELECT path FROM user_assets WHERE user_id=? AND kind='directory'").all(userId) as {path:string}[];
    return dirs.some(d=>inside(target,d.path));
  }
  require(file:string,userId:string):string {if(!this.owns(file,userId))throw new OwnershipError();return this.resolve(file);}
  middleware:RequestHandler=(req,res,next)=>{const user=principalOf(req);try{
    if(!user)throw new OwnershipError();this.require(req.baseUrl+req.path,user.id);next();
  }catch{res.status(404).json({error:'Resource not found'});}};
}
