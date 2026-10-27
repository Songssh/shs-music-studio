import { ownedAdapter } from './adapters.js';
import { privateAdapters } from './privatePaths.js';
import type { RequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { principalOf } from './principal.js';
import { assets } from './ownership.js';
import { canonical, inside, OwnershipError } from './assets.js';
import { config } from '../config.js';
import { getDb } from '../db/database.js';

export function personalRoot(id:string):string {
  if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new OwnershipError();
  const root=path.join(config.data.dir,'users',id);
  fs.mkdirSync(root,{recursive:true});assets().register(root,id,'directory');return root;
}
const management=[/^\/shutdown(?:\/|$)/,/^\/settings\/(?:env|data-folder)(?:\/|$)/,
  /^\/workers\/[^/]+\/update(?:\/|$)/,/^\/training\/worker\/update(?:\/|$)/,
  /^\/logs(?:\/|$)/,/^\/midi-studio\/hf-token$/];
const managedWrites=[/^\/model-manager(?:\/|$)/,/^\/plugins(?:\/|$)/,/^\/midi-studio\/models(?:\/|$)/];
/** Outer role boundary; personal ownership remains enforced even for administrators. */
export const roleBoundary:RequestHandler=(req,res,next)=>{
  const admin=principalOf(req)?.role==='admin';
  if(!admin && (management.some(r=>r.test(req.path))||(!['GET','HEAD'].includes(req.method)&&managedWrites.some(r=>r.test(req.path))))){res.status(403).json({error:'Administrator permission required'});return;}
  next();
};
/** Check file references before services resolve a path or invoke an engine. */
export const personalInputBoundary:RequestHandler=(req,res,next)=>{
  const user=principalOf(req);if(!user){res.status(401).json({error:'Authentication required'});return;}
  // System configuration has its own role boundary and may legitimately name shared binaries/models.
  if(management.some(r=>r.test(req.path))||managedWrites.some(r=>r.test(req.path))||req.path.startsWith('/training/worker/')){next();return;}
  try{
    personalRoot(user.id);privateAdapters();
    const visit=(value:unknown,key='',depth=0,parent=''):void=>{
      if(depth>32)throw new OwnershipError();
      if(Array.isArray(value)){for(const item of value)visit(item,key,depth+1,parent);return;}
      if(value && typeof value==='object'){for(const [name,item] of Object.entries(value))visit(item,name,depth+1,key);return;}
      if(typeof value!=='string'||!value)return;
      if(/^(song_?id|sourceSongId|baselineSongId)$/i.test(key)){
        if(!getDb().prepare('SELECT 1 FROM songs WHERE id=? AND user_id=?').get(value,user.id))throw new OwnershipError();return;
      }
      if(/^(?:loraPath|lmAdapter|lmAdapterAr|lmAdapterNar|yue2ArAdapterPath|yue2NarAdapterPath|mm3AdapterPath|adapter_path|lm_adapter_path)$/.test(key)||(key==='path'&&/adapter|lora/i.test(parent))){ownedAdapter(value,/lm/i.test(key));return;}
      if(key==='generation_params'){try{visit(JSON.parse(value),key,depth+1);}catch(err){if(err instanceof OwnershipError)throw err;}return;}
      if(req.path.startsWith('/vst/') && (key==='pluginPath'||key==='path'||key==='statePath'))return; // validated against the installed catalog; state paths are server-derived
      if(!(/(path|folder|directory|dir|url|reference)$/i.test(key)||value.startsWith('/audio/')||value.startsWith('/references/')))return;
      if(/^https?:\/\//i.test(value)){const url=new URL(value);if(url.pathname.startsWith('/audio/')||url.pathname.startsWith('/references/')){assets().require(url.pathname,user.id);return;}throw new OwnershipError();}
      if(value.startsWith('/audio/')||value.startsWith('/references/')||path.isAbsolute(value)){
        // Base model weights are common; adapters, inputs and outputs always need personal ownership.
        if(/model/i.test(key)&&!/(adapter|lora)/i.test(key)&&inside(canonical(value),canonical(config.aceServer.models)))return;
        assets().require(value,user.id);
      }else {
        if(/^(?:file:|\\\\)/i.test(value)||value.split(/[\\/]/).includes('..'))throw new OwnershipError();
        if(!/model/i.test(key))assets().require(path.join(config.data.dir,/reference$/i.test(key)?'references':'',value),user.id);
      }
    };
    visit(req.body);visit(req.query);next();
  }catch{res.status(404).json({error:'Resource not found'});}
};
