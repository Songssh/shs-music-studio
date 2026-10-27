import { Router } from 'express';
import { getUserId } from './auth.js';
import { getDb } from '../db/database.js';
import { preferences, savePreferences, importOwnedCovers } from '../services/images/library.js';
import { imageErrors } from './images.js';
const router=Router();
router.get('/preferences',(req,res)=>res.json(preferences(getUserId(req)!)));
router.patch('/preferences',(req,res)=>res.json(savePreferences(getUserId(req)!,req.body)));
router.get('/overview',async(req,res)=>{
  const user=getUserId(req)!;await importOwnedCovers(user);const db=getDb();
  const rows=db.prepare("SELECT id,title,created_at,generation_params,backend,dit_model FROM songs WHERE user_id=? AND audio_url<>'' AND audio_url NOT LIKE 'extracting:%' ORDER BY created_at DESC").all(user) as {id:string;title:string;created_at:string;generation_params:string;backend:string;dit_model:string}[];
  // Legacy songs with no provenance are reported separately, never guessed as AI.
  const generated=rows.filter(row=>{try{const p=JSON.parse(row.generation_params||'{}');return row.backend!=='import'&&p.source!=='import'&&(!!row.dit_model||!!p.ditModel||!!p.model||['create','insta-gen','lyric-studio','cover-studio','repaint','storm'].includes(p.source));}catch{return false;}});
  const count=(sql:string)=>Number((db.prepare(sql).get(user) as {n:number}).n);
  const cutoff=Date.now()-7*24*60*60*1000;
  const utc=(value:string)=>Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value)?value:value.replace(' ','T')+'Z');
  res.json({generated:generated.length,recentGenerated:generated.filter(r=>utc(r.created_at)>=cutoff).length,ownedSongs:rows.length,
    playlists:count('SELECT COUNT(*) n FROM playlists WHERE user_id=?'),images:count('SELECT COUNT(*) n FROM image_library i JOIN user_assets a ON a.id=i.asset_id WHERE a.user_id=?'),
    recent:rows.slice(0,5).map(({id,title,created_at})=>({id,title,createdAt:created_at})),
    basis:'보유 생성곡: 저장된 음원이 있고 생성 출처 또는 모델 정보가 확인되는 곡. 가져온 음원·삭제곡·미완료 작업 제외. 최근 7일은 현재 시각부터 168시간(UTC 저장 시각). 출처 불명 곡은 보유곡에만 포함.'});
});
router.use(imageErrors);
export default router;
