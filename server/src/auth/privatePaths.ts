import path from 'node:path';
import fs from 'node:fs';
import { principalOf } from './principal.js';
import { config } from '../config.js';
import { getDb } from '../db/database.js';
import { assets } from './ownership.js';
/** Shared engines still use the common model root. Only personal artifacts use this helper. */
export function privateDirectory(category:string,legacyPath:string):string {
  const user=principalOf();if(!user)return legacyPath; // engine startup/internal system inventory
  const legacy=(getDb().prepare('SELECT legacy_user_id FROM registration_settings WHERE id=1').get() as {legacy_user_id:string|null}).legacy_user_id;
  const dir=user.id===legacy?legacyPath:path.join(config.data.dir,'users',user.id,category);
  fs.mkdirSync(dir,{recursive:true});
  // Category roots never contain another user's output; common audio/references are not passed here.
  assets().register(dir,user.id,'directory');return dir;
}
export function privateAdapters():string {return privateDirectory('lora',config.aceServer.adapters);}

export function privateFile(category:string,legacyFile:string):string {
  const user=principalOf();if(!user)return legacyFile;
  const legacy=(getDb().prepare('SELECT legacy_user_id FROM registration_settings WHERE id=1').get() as {legacy_user_id:string|null}).legacy_user_id;
  const file=user.id===legacy?legacyFile:path.join(config.data.dir,'users',user.id,category,path.basename(legacyFile));
  fs.mkdirSync(path.dirname(file),{recursive:true});assets().register(file,user.id);return file;
}
