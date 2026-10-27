import { getDb } from '../db/database.js';
import { config } from '../config.js';
import { AssetOwnership, OwnershipError } from './assets.js';
import { principalOf } from './principal.js';
export function assets(){return new AssetOwnership(getDb(),config.data.dir,config.data.audioDir);}
export function claimFile(file:string,userId=principalOf()?.id,kind='file'){if(!userId)throw new OwnershipError();return assets().register(file,userId,kind);}
export function requireFile(file:string,userId=principalOf()?.id){if(!userId)throw new OwnershipError();return assets().require(file,userId);}
export function claimResource(kind:string,id:string,userId=principalOf()?.id){
  if(!userId)throw new OwnershipError();const db=getDb();
  const row=db.prepare('SELECT user_id FROM resource_owners WHERE kind=? AND resource_id=?').get(kind,id) as {user_id:string}|undefined;
  if(row&&row.user_id!==userId)throw new OwnershipError();
  db.prepare('INSERT OR IGNORE INTO resource_owners VALUES(?,?,?)').run(kind,id,userId);
}
export function ownsResource(kind:string,id:string,userId=principalOf()?.id):boolean{
  return !!userId && !!getDb().prepare('SELECT 1 FROM resource_owners WHERE kind=? AND resource_id=? AND user_id=?').get(kind,id,userId);
}
