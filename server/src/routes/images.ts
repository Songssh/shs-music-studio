import { Router, type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { getUserId } from './auth.js';
import { getDb } from '../db/database.js';
import { imageRow, publicImage, listImages, registerImage, registerSongCover, variant, applyCover, deleteImage } from '../services/images/library.js';
const router=Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1,fields:0}});
router.get('/',async(req,res)=>res.json({images:await listImages(getUserId(req)!)}));
router.post('/',upload.single('image'),async(req,res)=>{
  if(!req.file){res.status(400).json({error:'이미지를 선택하세요.'});return;}
  const id=getUserId(req)!;
  res.status(201).json({image:publicImage(await registerImage(id,req.file.buffer,req.file.originalname,'upload'),id)});
});
router.post('/from-song/:songId',async(req,res)=>{
  const id=getUserId(req)!;
  res.json({image:publicImage(await registerSongCover(String(req.params.songId),id),id)});
});
router.get('/:id/file/:kind',async(req,res)=>{
  const id=String(req.params.id),user=getUserId(req)!,kind=z.enum(['original','thumbnail','screen']).parse(req.params.kind);
  const row=imageRow(id,user);
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.sendFile(kind==='original'?row.path:await variant(id,user,kind));
});
router.patch('/:id',(req,res)=>{
  const id=String(req.params.id),user=getUserId(req)!;imageRow(id,user);
  const body=z.object({name:z.string().trim().min(1).max(160)}).strict().parse(req.body);
  getDb().prepare('UPDATE image_library SET name=? WHERE asset_id=?').run(body.name,id);
  res.json({image:publicImage(imageRow(id,user),user)});
});
router.put('/:id/cover',async(req,res)=>{
  const body=z.object({songId:z.string().min(1),crop:z.unknown()}).strict().parse(req.body);
  res.json(await applyCover(String(req.params.id),getUserId(req)!,body.songId,body.crop));
});
router.delete('/:id',(req,res)=>{deleteImage(String(req.params.id),getUserId(req)!);res.json({ok:true});});
export const imageErrors:ErrorRequestHandler=(error,_req,res,_next)=>{
  const status=error instanceof z.ZodError?400:error instanceof multer.MulterError?413:error.status??500;
  res.status(status).json({error:status===500?'이미지를 처리하지 못했습니다.':error instanceof z.ZodError?'올바른 이미지 설정을 입력하세요.':error.message,usages:error.usages});
};
router.use(imageErrors);
export default router;
