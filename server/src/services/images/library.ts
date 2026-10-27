import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { z } from 'zod';
import { getDb } from '../../db/database.js';
import { config } from '../../config.js';
import { assets } from '../../auth/ownership.js';
import { OwnershipError } from '../../auth/assets.js';

export const cropSchema = z.object({ x:z.number().min(0).max(1), y:z.number().min(0).max(1), zoom:z.number().min(1).max(4) }).strict();
export const backgroundSchema = z.object({ mode:z.enum(['default','solid','image']), imageId:z.string().max(80).nullable(), color:z.string().regex(/^#[0-9a-fA-F]{6}$/), fit:z.enum(['cover','contain','center']), x:z.number().min(0).max(100), y:z.number().min(0).max(100), dim:z.number().min(0).max(.9), blur:z.number().min(0).max(24) }).strict();
export const preferencePatch = z.object({ background:backgroundSchema.optional(), pinned:z.array(z.string().regex(/^[a-z-]+$/).max(40)).max(40).transform(v=>[...new Set(v)]).optional(), theme:z.enum(['light','dark']).nullable().optional() }).strict();
export const defaults = { background:{mode:'default' as 'default'|'solid'|'image',imageId:null as string|null,color:'#151925',fit:'cover' as 'cover'|'contain'|'center',x:50,y:50,dim:.25,blur:0}, pinned:['create','library','queue'], theme:null as 'light'|'dark'|null };
type Row = { id:string; path:string; name:string; format:string; width:number; height:number; bytes:number; source:string; registered_at:number; sha256:string };
const select = `SELECT i.*,a.id,a.path FROM image_library i JOIN user_assets a ON a.id=i.asset_id`;
const fail = (message:string,status=400) => Object.assign(new Error(message),{status});
/** Multipart filename parameters default to Latin-1 in busboy. Recover valid UTF-8 only. */
export function uploadImageName(name:string) {
  if([...name].some(c=>c.charCodeAt(0)>255))return name;
  const decoded=Buffer.from(name,'latin1').toString('utf8');
  return decoded.includes('\uFFFD')?name:decoded;
}
export function imageRow(id:string,userId:string):Row {
  const row=getDb().prepare(`${select} WHERE a.id=? AND a.user_id=?`).get(id,userId) as Row|undefined;
  if(!row)throw new OwnershipError();
  assets().require(row.path,userId);return row;
}
export function preferences(userId:string) {
  const row=getDb().prepare('SELECT data FROM desktop_preferences WHERE user_id=?').get(userId) as {data:string}|undefined;
  return row ? {...defaults,...JSON.parse(row.data)} as typeof defaults : structuredClone(defaults);
}
export function savePreferences(userId:string,input:unknown) {
  const patch=preferencePatch.parse(input);
  if(patch.background?.mode==='image') {
    if(!patch.background.imageId)throw fail('이미지를 선택하세요.');
    imageRow(patch.background.imageId,userId);
  }
  if(patch.background && patch.background.mode!=='image')patch.background.imageId=null;
  const value={...preferences(userId),...patch};
  getDb().prepare('INSERT INTO desktop_preferences VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(userId,JSON.stringify(value),Date.now());
  return value;
}
export function imageUsages(id:string,userId:string) {
  const row=imageRow(id,userId);
  const urls=[`/audio/${path.basename(row.path)}`,...(getDb().prepare('SELECT a.path FROM image_variants v JOIN user_assets a ON a.id=v.asset_id WHERE image_id=?').all(id) as {path:string}[]).map(v=>`/audio/${path.basename(v.path)}`)];
  const songs=getDb().prepare(`SELECT id,title FROM songs WHERE user_id=? AND (cover_url IN (${urls.map(()=>'?').join(',')}) OR id IN (SELECT song_id FROM song_image_refs WHERE image_id=? AND cover_url=songs.cover_url))`).all(userId,...urls,id) as {id:string;title:string}[];
  const playlists=getDb().prepare(`SELECT id,name FROM playlists WHERE user_id=? AND cover_url IN (${urls.map(()=>'?').join(',')})`).all(userId,...urls) as {id:string;name:string}[];
  const bg=preferences(userId).background;
  return {songs,playlists,background:bg.mode==='image'&&bg.imageId===id};
}
export function publicImage(row:Row,userId:string) {
  return {id:row.id,name:row.name,format:row.format,width:row.width,height:row.height,bytes:row.bytes,source:row.source,createdAt:row.registered_at,
    originalUrl:`/api/images/${row.id}/file/original`,thumbnailUrl:`/api/images/${row.id}/file/thumbnail`,screenUrl:`/api/images/${row.id}/file/screen`,usages:imageUsages(row.id,userId)};
}
export async function registerImage(userId:string,bytes:Buffer,name:string,source:'upload'|'generated'|'legacy',existing?:string) {
  if(bytes.length>20*1024*1024)throw fail('이미지는 최대 20 MB까지 지원합니다.',413);
  let meta:Metadata;
  try {
    meta=await sharp(bytes,{limitInputPixels:40_000_000,failOn:'warning'}).metadata();
    if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw Error();
    // Decode all pixels; a plausible header alone is not an accepted image.
    await sharp(bytes,{limitInputPixels:40_000_000,failOn:'warning'}).rotate().resize(1,1).toBuffer();
  }catch{throw fail('정적 JPEG, PNG, WebP 이미지만 지원합니다 (최대 4천만 화소).');}
  const digest=createHash('sha256').update(bytes).digest('hex');
  const same=getDb().prepare(`${select} WHERE a.user_id=? AND i.sha256=?`).get(userId,digest) as Row|undefined;
  if(same){
    if(existing && assets().resolve(existing)!==same.path){
      assets().require(existing,userId);
      const alias=assets().register(existing,userId,'image');
      getDb().prepare('INSERT OR IGNORE INTO image_variants VALUES(?,?,?)').run(same.id,`legacy-original:${alias}`,alias);
    }
    return same;
  }
  if(existing)assets().require(existing,userId);
  const file=existing??path.join(config.data.audioDir,`image_${randomUUID()}.${meta.format==='jpeg'?'jpg':meta.format}`);
  if(!existing)fs.writeFileSync(file,bytes,{flag:'wx'});
  const id=assets().register(file,userId,'image');
  const rotated=[5,6,7,8].includes(meta.orientation??0);
  getDb().prepare('INSERT OR IGNORE INTO image_library VALUES(?,?,?,?,?,?,?,?,?)').run(id,(source==='upload'?uploadImageName(name):name).slice(0,160)||'이미지',meta.format,rotated?meta.height:meta.width,rotated?meta.width:meta.height,bytes.length,digest,source,Date.now());
  return imageRow(id,userId);
}
export async function registerSongCover(songId:string,userId:string,source:'generated'|'legacy'='legacy') {
  const song=getDb().prepare('SELECT cover_url,title FROM songs WHERE id=? AND user_id=?').get(songId,userId) as {cover_url:string;title:string}|undefined;
  if(!song)throw new OwnershipError();
  const linked=getDb().prepare('SELECT image_id FROM song_image_refs WHERE song_id=? AND cover_url=?').get(songId,song.cover_url) as {image_id:string}|undefined;
  if(linked)return imageRow(linked.image_id,userId);
  if(!song.cover_url?.startsWith('/audio/'))throw fail('소유한 커버 이미지가 없습니다.');
  // Do not assign ambiguous shared legacy covers, even if a song references them.
  if(getDb().prepare('SELECT 1 FROM songs WHERE cover_url=? AND user_id<>?').get(song.cover_url,userId))throw new OwnershipError();
  const file=assets().require(song.cover_url,userId);
  const known=getDb().prepare('SELECT image_id FROM image_variants v JOIN user_assets a ON a.id=v.asset_id WHERE a.path=? AND a.user_id=?').get(file,userId) as {image_id:string}|undefined;
  const row=known?imageRow(known.image_id,userId):await registerImage(userId,fs.readFileSync(file),song.title,source,file);
  // The song may have been edited/deleted while decoding. Never restore an old reference.
  if(getDb().prepare('SELECT 1 FROM songs WHERE id=? AND user_id=? AND cover_url=?').get(songId,userId,song.cover_url)) {
    getDb().prepare('INSERT INTO song_image_refs VALUES(?,?,NULL,?) ON CONFLICT(song_id) DO UPDATE SET image_id=excluded.image_id,crop=NULL,cover_url=excluded.cover_url').run(songId,row.id,song.cover_url);
  }
  return row;
}
const variantsInFlight=new Map<string,Promise<string>>();
export async function variant(id:string,userId:string,kind:'thumbnail'|'screen'|'cover',crop?:z.infer<typeof cropSchema>) {
  const row=imageRow(id,userId);
  const transform=JSON.stringify({version:1,kind,...(crop?{crop}:{})});
  const cache=getDb().prepare('SELECT a.path FROM image_variants v JOIN user_assets a ON a.id=v.asset_id WHERE image_id=? AND transform=?').get(id,transform) as {path:string}|undefined;
  if(cache&&fs.existsSync(cache.path))return assets().require(cache.path,userId);
  const key=id+transform;
  if(variantsInFlight.has(key))return variantsInFlight.get(key)!;
  const work=(async()=>{
    // Buffer input avoids libvips retaining an open Windows file handle after decoding.
    let pipeline=sharp(fs.readFileSync(row.path),{limitInputPixels:40_000_000}).rotate();
    if(kind==='cover'&&crop){
      const size=Math.max(1,Math.floor(Math.min(row.width,row.height)/crop.zoom));
      pipeline=pipeline.extract({left:Math.round((row.width-size)*crop.x),top:Math.round((row.height-size)*crop.y),width:size,height:size}).resize(1024,1024,{withoutEnlargement:true});
    } else pipeline=pipeline.resize(kind==='thumbnail'?320:2560,kind==='thumbnail'?320:1600,{fit:'inside',withoutEnlargement:true});
    const bytes=await pipeline.flatten({background:'#fff'}).jpeg({quality:kind==='thumbnail'?80:90}).toBuffer();
    // Recheck after async work; deletion cannot resurrect an image.
    imageRow(id,userId);
    const file=path.join(config.data.audioDir,`image_${id}_${createHash('sha256').update(transform).digest('hex').slice(0,20)}.jpg`);
    fs.writeFileSync(file,bytes);
    const assetId=assets().register(file,userId,'image-variant');
    getDb().prepare('INSERT OR REPLACE INTO image_variants VALUES(?,?,?)').run(id,transform,assetId);return file;
  })().finally(()=>variantsInFlight.delete(key));
  variantsInFlight.set(key,work);return work;
}
export async function applyCover(id:string,userId:string,songId:string,input:unknown) {
  const crop=cropSchema.parse(input);
  const check=()=>{imageRow(id,userId);if(!getDb().prepare('SELECT 1 FROM songs WHERE id=? AND user_id=?').get(songId,userId))throw new OwnershipError();};
  check();const file=await variant(id,userId,'cover',crop);check();
  const url=`/audio/${path.basename(file)}`;
  getDb().transaction(()=>{
    getDb().prepare('UPDATE songs SET cover_url=? WHERE id=? AND user_id=?').run(url,songId,userId);
    getDb().prepare('INSERT INTO song_image_refs VALUES(?,?,?,?) ON CONFLICT(song_id) DO UPDATE SET image_id=excluded.image_id,crop=excluded.crop,cover_url=excluded.cover_url').run(songId,id,JSON.stringify(crop),url);
  })();return {coverUrl:url,imageId:id,crop};
}
export function deleteImage(id:string,userId:string) {
  const row=imageRow(id,userId),usages=imageUsages(id,userId);
  if(usages.songs.length||usages.playlists.length||usages.background)throw Object.assign(fail('사용 중인 이미지입니다. 곡 커버 또는 배경을 먼저 교체하거나 해제하세요.',409),{usages});
  const files=getDb().prepare('SELECT a.id,a.path FROM image_variants v JOIN user_assets a ON a.id=v.asset_id WHERE image_id=?').all(id) as {id:string;path:string}[];
  getDb().transaction(()=>{
    getDb().prepare('DELETE FROM song_image_refs WHERE image_id=?').run(id);
    getDb().prepare('DELETE FROM image_library WHERE asset_id=?').run(id);
    for(const f of [...files,row])getDb().prepare('DELETE FROM user_assets WHERE id=? AND user_id=?').run(f.id,userId);
  })();
  for(const f of [...files,row])try{fs.unlinkSync(f.path);}catch{/* Orphan cleanup can be retried; no live reference remains. */}
}
export function isLibraryImage(file:string) {
  const canonical=assets().resolve(file);
  return !!getDb().prepare(`SELECT 1 FROM user_assets a WHERE path=? AND (id IN (SELECT asset_id FROM image_library) OR id IN (SELECT asset_id FROM image_variants))`).get(canonical);
}
const imports=new Map<string,Promise<void>>();
export async function importOwnedCovers(userId:string) {
  if(imports.has(userId))return imports.get(userId)!;
  const work=(async()=>{
    const songs=getDb().prepare("SELECT id FROM songs WHERE user_id=? AND cover_url LIKE '/audio/%' AND NOT EXISTS (SELECT 1 FROM song_image_refs r WHERE r.song_id=songs.id AND r.cover_url=songs.cover_url)").all(userId) as {id:string}[];
    for(const song of songs)try{await registerSongCover(song.id,userId);}catch{/* Unknown, missing and shared legacy files remain untouched. */}
  })().finally(()=>imports.delete(userId));imports.set(userId,work);return work;
}
export async function listImages(userId:string) {
  await importOwnedCovers(userId);
  return (getDb().prepare(`${select} WHERE a.user_id=? ORDER BY registered_at DESC`).all(userId) as Row[]).map(row=>publicImage(row,userId));
}
