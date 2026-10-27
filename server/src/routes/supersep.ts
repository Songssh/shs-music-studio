import { claimResource, ownsResource, requireFile } from '../auth/ownership.js';
import { randomUUID } from 'node:crypto';
import { runOnGpuLane } from '../services/generation/gpuLane.js';
import { evictOtherFamilies } from '../services/generation/residency.js';
// supersep.ts — SuperSep stem separation route (proxy to ace-server)
//
// Routes:
//   POST /api/supersep/separate — start separation (reads file from disk)
//   GET  /api/supersep/:jobId/progress — poll job progress
//   GET  /api/supersep/:jobId/result — get stem list metadata
//   GET  /api/supersep/:jobId/stem/:index — download individual stem WAV
//   POST /api/supersep/recombine — remix stems with volume/mute controls

import { Router } from 'express';
import { config } from '../config.js';
import { ensureEngineFormat } from '../services/audioConvert.js';
import { supersepSeparateRequestSchema } from '../contracts/stemSeparation.js';

const router = Router();
router.param('jobId',(req,res,next,id)=>{if(!ownsResource('supersep',id)){res.status(404).json({error:'Job not found'});return;}next();});

const ACE_URL = config.aceServer.url;
interface QueuedSplit { engineId?:string;status:string;error?:string }
const queuedSplits=new Map<string,QueuedSplit>();
const remoteId=(id:string)=>queuedSplits.get(id)?.engineId??id;

// POST /api/supersep/separate
// Body (JSON): { audioUrl: "/references/uuid.flac" }
// Query: level=0..5 (BASIC/VOCAL_SPLIT/FULL/MAXIMUM/VOCALS_ONLY/STABLESTEP)
//        4 = 2-stem via the 6-stem BS-RoFormer (instrumental = mix − vocals)
//        5 = 2-stem via the dual BS-Roformer-Leap Xe models (both stems neural)
//        See SuperSepLevel in engine/src/supersep.h.
// Reads the file from disk, converts non-WAV/MP3 to WAV, forwards to ace-server.
router.post('/separate', async (req, res) => {
  try {
    const level = parseInt(String(req.query.level ?? '0'), 10);
    const parsed = supersepSeparateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'audioUrl required in request body' });
    }
    const { audioUrl } = parsed.data;
    const ownedPath=requireFile(audioUrl);

    // Return a stable job immediately, including while another account owns
    // the GPU. Keep the lease until separation finishes; closing the UI does
    // not release it or let a model switch interrupt the engine operation.
    const id=randomUUID(),job:QueuedSplit={status:'pending'};claimResource('supersep',id);queuedSplits.set(id,job);
    res.json({id});
    void runOnGpuLane(async()=>{
      if(job.status==='cancelled')return;
      await evictOtherFamilies('supersep');
      const audioBody=ensureEngineFormat(requireFile(ownedPath));
      const aceRes=await fetch(`${ACE_URL}/supersep/separate?level=${level}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:audioBody});
      if(!aceRes.ok)throw new Error(await aceRes.text());
      const data=await aceRes.json() as {id?:string;job_id?:string};job.engineId=data.id??data.job_id;
      if(!job.engineId)throw new Error('Engine did not return a job ID');job.status='running';
      while(job.status==='running'){
        const progress=await fetch(`${ACE_URL}/supersep/progress?id=${job.engineId}`);
        if(!progress.ok)throw new Error('Separation progress unavailable');
        const data=await progress.json() as {status:string;error?:string};
        if(['done','failed','cancelled'].includes(data.status)){job.status=data.status;job.error=data.error;break;}
        await new Promise(resolve=>setTimeout(resolve,500));
      }
    },{label:`supersep:${id}`,family:'supersep'}).catch(error=>{job.status='failed';job.error=String(error);});
  } catch (err: any) {
    console.error('[SuperSep] separate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/supersep/:jobId/progress
router.get('/:jobId/progress', async (req, res) => {
  try {
    const job=queuedSplits.get(String(req.params.jobId));
    if(job&&(!job.engineId||job.status==='failed'))return res.json({status:job.status,progress:0,message:job.status==='pending'?'Waiting for GPU':'',error:job.error});
    const aceRes = await fetch(
      `${ACE_URL}/supersep/progress?id=${remoteId(String(req.params.jobId))}`
    );
    const data = await aceRes.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/supersep/:jobId/release — let the engine drop a finished job.
// The engine keeps every job resident (its pool has no eviction); Cover
// Studio calls this when a split is cleared or replaced (#132).
router.post('/:jobId/release', async (req, res) => {
  try {
    const job=queuedSplits.get(String(req.params.jobId));
    if(job&&!job.engineId){job.status='cancelled';return res.json({ok:true});}
    const aceRes = await fetch(`${ACE_URL}/supersep/release?id=${remoteId(String(req.params.jobId))}`, { method: 'POST' });
    if(aceRes.ok&&job&&job.status!=='running')queuedSplits.delete(String(req.params.jobId));
    res.status(aceRes.ok ? 200 : aceRes.status).json({ ok: aceRes.ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/supersep/:jobId/result
router.get('/:jobId/result', async (req, res) => {
  try {
    const aceRes = await fetch(
      `${ACE_URL}/supersep/result?id=${remoteId(String(req.params.jobId))}`
    );
    if (!aceRes.ok) {
      return res.status(aceRes.status).json(await aceRes.json());
    }
    const data = await aceRes.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/supersep/:jobId/stem/:index — proxy WAV download
router.get('/:jobId/stem/:index', async (req, res) => {
  try {
    const aceRes = await fetch(
      `${ACE_URL}/supersep/serve?id=${remoteId(String(req.params.jobId))}&stem=${req.params.index}`
    );
    if (!aceRes.ok) {
      return res.status(aceRes.status).json({ error: 'Failed to fetch stem' });
    }
    const buf = Buffer.from(await aceRes.arrayBuffer());
    res.set('Content-Type', 'audio/wav');
    res.set('Content-Disposition', `attachment; filename="stem_${req.params.index}.wav"`);
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/supersep/recombine — remix stems and return WAV
router.post('/recombine', async (req, res) => {
  if(typeof req.body?.id!=='string'||!ownsResource('supersep',req.body.id)){res.status(404).json({error:'Job not found'});return;}
  try {
    const aceRes = await fetch(`${ACE_URL}/supersep/recombine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({...req.body,id:remoteId(req.body.id)}),
    });
    if (!aceRes.ok) {
      return res.status(aceRes.status).json(await aceRes.json());
    }
    const buf = Buffer.from(await aceRes.arrayBuffer());
    res.set('Content-Type', 'audio/wav');
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
