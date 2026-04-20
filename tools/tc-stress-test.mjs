// tc-stress-test.mjs — Prove MXFP4 Blackwell Tensor Core acceleration
// Compares similar-sized quant types under heavy compute load.
// MXFP4 has native FP4 TC path; others use generic dp4a/INT8 dequant.

import { writeFileSync } from 'fs';

const SERVER = 'http://127.0.0.1:8085';
const BASE   = 'acestep-v15-merge-base-turbo-xl-ta-0.5';

// Test matrix: similar file sizes, different kernel paths
const MODELS = [
  { tag: 'Q4_K_M',  file: `${BASE}-Q4_K_M.gguf`,  note: 'dp4a INT8 matmul' },
  { tag: 'NVFP4',   file: `${BASE}-NVFP4.gguf`,    note: 'dp4a INT8 matmul (no native FP4 TC)' },
  { tag: 'IQ4_XS',  file: `${BASE}-IQ4_XS.gguf`,   note: 'dp4a INT8 matmul' },
  { tag: 'MXFP4',   file: `${BASE}-MXFP4.gguf`,    note: 'BLACKWELL FP4 Tensor Core (if sm_120)' },
];

// Heavy workload: long audio + many steps to make compute dominate
const CONFIGS = [
  { label: 'Light  (30s/60 steps)',   duration: 30,  steps: 60  },
  { label: 'Medium (60s/100 steps)',  duration: 60,  steps: 100 },
  { label: 'Heavy  (120s/200 steps)', duration: 120, steps: 200 },
];

const RUNS_PER_CONFIG = 2; // average over 2 runs to reduce variance

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  return r.json();
}

async function waitForJob(jobId, timeoutMs = 600_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(`${SERVER}/job?id=${jobId}`);
    const s = await r.json();
    if (s.status === 'done')   return { ok: true, elapsed: (Date.now() - t0) / 1000 };
    if (s.status === 'failed' || s.status === 'error') return { ok: false, error: s.error || s.status };
    await new Promise(r => setTimeout(r, 2000));
  }
  return { ok: false, error: 'timeout' };
}

async function runSynth(modelFile, duration, steps) {
  const body = {
    caption: 'upbeat synth pop, catchy melody, 120bpm, electronic drums, warm synthesizer, energetic',
    lyrics: '[verse]\nDancing through the neon lights\nEvery moment feels so right\nHeart is beating like a drum\nFeel the rhythm, here we come\n\n[chorus]\nWe are the fire, burning bright\nWe are the stars that own the night\nNothing can stop us, feel the flow\nLet the music steal the show',
    bpm: 120,
    duration,
    keyscale: 'C Major',
    timesignature: '4/4',
    vocal_language: 'en',
    seed: 42,
    inference_steps: steps,
    guidance_scale: 15.0,
    guidance_mode: 'apg',
    infer_method: 'euler',
    scheduler: 'linear',
    shift: 3.0,
    task_type: 'text2music',
    peak_clip: 0.15,
    synth_model: modelFile,
  };
  
  const res = await fetch(`${SERVER}/synth?format=wav16`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!data.id) throw new Error(`Synth failed: ${JSON.stringify(data)}`);
  return data.id;
}

// ─── Main ────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  MXFP4 Tensor Core Stress Test                                     ║');
console.log('║  Comparing FP4 TC (MXFP4) vs dp4a INT8 (Q4_K_M, NVFP4, IQ4_XS)    ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

// Verify server
try {
  const props = await fetchJSON(`${SERVER}/props`);
  console.log(`[✓] ace-server reachable — ${props.dit_models?.length ?? '?'} DiT models\n`);
} catch(e) {
  console.error('[✗] Cannot reach ace-server:', e.message);
  process.exit(1);
}

const results = [];

for (const config of CONFIGS) {
  console.log(`\n${'━'.repeat(74)}`);
  console.log(`  ${config.label}`);
  console.log(`${'━'.repeat(74)}`);

  for (const model of MODELS) {
    const times = [];
    
    for (let run = 0; run < RUNS_PER_CONFIG; run++) {
      process.stdout.write(`  ${model.tag.padEnd(10)} run ${run+1}/${RUNS_PER_CONFIG} ...`);
      
      try {
        const t0 = performance.now();
        const jobId = await runSynth(model.file, config.duration, config.steps);
        const result = await waitForJob(jobId, 600_000);
        const elapsed = (performance.now() - t0) / 1000;
        
        if (result.ok) {
          times.push(elapsed);
          process.stdout.write(` ${elapsed.toFixed(1)}s\n`);
        } else {
          process.stdout.write(` FAILED: ${result.error}\n`);
        }
      } catch(e) {
        process.stdout.write(` ERROR: ${e.message}\n`);
      }
    }

    const avg = times.length > 0 ? times.reduce((a,b) => a+b, 0) / times.length : null;
    const min = times.length > 0 ? Math.min(...times) : null;
    
    results.push({
      config: config.label,
      model: model.tag,
      note: model.note,
      runs: times,
      avg: avg?.toFixed(1),
      min: min?.toFixed(1),
      duration: config.duration,
      steps: config.steps,
    });

    if (avg) {
      console.log(`  ${model.tag.padEnd(10)} avg: ${avg.toFixed(1)}s  min: ${min.toFixed(1)}s  (${model.note})`);
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────
console.log('\n');
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  RESULTS SUMMARY                                                            ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

for (const config of CONFIGS) {
  const configResults = results.filter(r => r.config === config.label);
  const mxfp4 = configResults.find(r => r.model === 'MXFP4');
  
  console.log(`  ${config.label}:`);
  console.log(`  ${'─'.repeat(70)}`);
  
  for (const r of configResults) {
    const speedup = (mxfp4?.avg && r.avg) 
      ? `${(parseFloat(r.avg) / parseFloat(mxfp4.avg)).toFixed(2)}x vs MXFP4`
      : '';
    const marker = r.model === 'MXFP4' ? ' ◀ FP4 Tensor Core' : '';
    console.log(`  ${r.model.padEnd(10)} ${(r.avg ?? 'N/A').toString().padStart(7)}s avg  ${speedup.padStart(20)}${marker}`);
  }
  console.log();
}

// Verdict
const heavyResults = results.filter(r => r.steps === 200);
const mxfp4Heavy = heavyResults.find(r => r.model === 'MXFP4');
const nvfp4Heavy = heavyResults.find(r => r.model === 'NVFP4');
const q4kmHeavy  = heavyResults.find(r => r.model === 'Q4_K_M');

if (mxfp4Heavy?.avg && nvfp4Heavy?.avg) {
  const speedup = parseFloat(nvfp4Heavy.avg) / parseFloat(mxfp4Heavy.avg);
  if (speedup > 1.15) {
    console.log(`🏆 VERDICT: MXFP4 is ${((speedup - 1) * 100).toFixed(0)}% faster than NVFP4 on heavy workload.`);
    console.log(`           This strongly indicates native FP4 Tensor Core acceleration is active.`);
  } else if (speedup > 1.05) {
    console.log(`⚡ VERDICT: MXFP4 is ${((speedup - 1) * 100).toFixed(0)}% faster — marginal TC benefit.`);
    console.log(`           Workload may still be partially memory-bandwidth-bound.`);
  } else {
    console.log(`⚠️ VERDICT: MXFP4 shows no significant speedup over NVFP4 (${speedup.toFixed(2)}x).`);
    console.log(`           Either TC path is not active, or inference is memory-bandwidth-bound.`);
    console.log(`           Check: was the engine compiled with -DCMAKE_CUDA_ARCHITECTURES=120a ?`);
  }
}

// Save
writeFileSync('benchmark-results/tc-stress-results.json', JSON.stringify(results, null, 2));
console.log('\nSaved: benchmark-results/tc-stress-results.json');
