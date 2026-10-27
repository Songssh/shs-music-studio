import fs from 'node:fs';
import path from 'node:path';
import { privateAdapters } from './privatePaths.js';
import { assets } from './ownership.js';
import { ownerId } from './principal.js';
import { OwnershipError } from './assets.js';

export function ownedAdapter(ref:string,lm=false):string {
  if(path.isAbsolute(ref))return assets().require(ref,ownerId());
  if(ref.split(/[\\/]/).includes('..'))throw new OwnershipError();
  const root=privateAdapters();
  const candidates=[path.join(root,lm?'lm':'',ref),path.join(root,ref)];
  for(const candidate of candidates)for(const file of [candidate,candidate+'.safetensors',candidate+'.gguf']){
    if(fs.existsSync(file) && assets().owns(file,ownerId()))return file;
  }
  throw new OwnershipError();
}
export function privateAdapterNames(names:string[],lm=false):string[] {
  return names.filter(name=>{try{ownedAdapter(name,lm);return true;}catch{return false;}});
}
