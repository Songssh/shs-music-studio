// Legacy wire compatibility. Only the verified cookie principal grants access.
import { Router, type Request } from 'express';
import { getDb } from '../db/database.js';
import { principalOf } from '../auth/principal.js';
const router=Router();
router.get('/auto',(_req,res)=>res.status(410).json({error:'Automatic login is disabled'}));
router.post('/setup',(_req,res)=>res.status(410).json({error:'Use initial account setup'}));
router.get('/me',(req,res)=>{
  const id=getUserId(req);if(!id){res.status(401).json({error:'Authentication required'});return;}
  res.json({user:getDb().prepare('SELECT id,username,email,role,bio,avatar_url,banner_url,created_at FROM users WHERE id=?').get(id)});
});
router.patch('/username',(req,res)=>{
  const id=getUserId(req);const name=req.body?.username;
  if(!id){res.status(401).json({error:'Authentication required'});return;}
  if(typeof name!=='string'||!name.trim()||name.length>80){res.status(400).json({error:'Invalid name'});return;}
  try{getDb().prepare('UPDATE users SET username=? WHERE id=?').run(name.trim(),id);
    res.json({user:getDb().prepare('SELECT id,username,email,role,bio,avatar_url,banner_url,created_at FROM users WHERE id=?').get(id),token:id});}
  catch{res.status(400).json({error:'Name could not be updated'});}
});
router.post('/logout',(_req,res)=>res.status(410).json({error:'Use /api/auth/sign-out to revoke the session'}));
export function getUserId(req: Request): string|null {return principalOf(req)?.id??null;}
export default router;
