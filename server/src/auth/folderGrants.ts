import fs from 'node:fs';
import path from 'node:path';
import { AssetOwnership, canonical, inside, OwnershipError } from './assets.js';
import type Database from 'better-sqlite3';
import { config, PROJECT_ROOT } from '../config.js';

/** An administrator explicitly assigns an existing import folder without moving its files. */
export function grantImportFolder(db:Database.Database,dataDir:string,folder:string,userId:string){
  if(!path.isAbsolute(folder)||!fs.statSync(folder).isDirectory())throw new OwnershipError();
  const target=canonical(folder),assets=new AssetOwnership(db,dataDir);
  if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId))throw new OwnershipError();
  if(assets.owns(target,userId))return assets.register(target,userId,'directory');
  const protectedRoots=[dataDir,PROJECT_ROOT,config.aceServer.models,process.env.SystemRoot,process.env.ProgramFiles,process.env.APPDATA,process.env.LOCALAPPDATA].filter((p):p is string=>!!p);
  if(target===path.parse(target).root||protectedRoots.some(p=>{const root=canonical(p);return inside(target,root)||inside(root,target);}))throw new OwnershipError();
  return assets.register(target,userId,'directory');
}
