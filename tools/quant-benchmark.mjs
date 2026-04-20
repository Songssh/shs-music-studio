// quant-benchmark.mjs — Automated quantization quality benchmark for ACE-Step
//
// Runs the same generation through all quantized DiT models via ace-server API.
// Fixed seed, prompt, and params ensure identical conditions for comparison.
//
// Usage: node quant-benchmark.mjs [--ace-url http://127.0.0.1:8085]
//
// Output: saves WAV files and a results.json to ./benchmark-results/

import fs from 'fs';
import path from 'path';

const ACE_URL = process.argv.includes('--ace-url')
  ? process.argv[process.argv.indexOf('--ace-url') + 1]
  : 'http://127.0.0.1:8085';

const OUT_DIR = path.resolve('benchmark-results');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Fixed generation parameters ─────────────────────────────────────────────
const FIXED_PARAMS = {
  caption: 'upbeat synth pop, catchy melody, 120bpm, electronic drums, warm synthesizer, energetic',
  lyrics: '[verse]\nDancing through the neon lights\nEvery moment feels so right\nHeart is beating like a drum\nFeel the rhythm, here we come\n\n[chorus]\nWe are the fire, burning bright\nWe are the stars that own the night\nNothing can stop us, feel the flow\nLet the music steal the show',
  bpm: 120,
  duration: 30,
  keyscale: 'C Major',
  timesignature: '4/4',
  vocal_language: 'en',
  seed: 42,
  inference_steps: 60,
  guidance_scale: 15.0,
  guidance_mode: 'apg',
  infer_method: 'euler',
  scheduler: 'linear',
  shift: 3.0,
  task_type: 'text2music',
  peak_clip: 0.15,
};

// ─── Models to test ──────────────────────────────────────────────────────────
// Ordered from largest to smallest for comparison
const MODELS = [
  // Baseline K-quants (pre-existing)
  'acestep-v15-merge-base-turbo-xl-ta-0.5-BF16.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-Q8_0.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-Q6_K.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-Q5_K_M.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-Q4_K_M.gguf',

  // Experimental: FP4
  'acestep-v15-merge-base-turbo-xl-ta-0.5-NVFP4.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-MXFP4.gguf',

  // Experimental: IQ4
  'acestep-v15-merge-base-turbo-xl-ta-0.5-IQ4_NL.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-IQ4_XS.gguf',

  // Experimental: K-quant 3/2
  'acestep-v15-merge-base-turbo-xl-ta-0.5-Q3_K_M.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-Q3_K_S.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-Q2_K.gguf',

  // Experimental: IQ3
  'acestep-v15-merge-base-turbo-xl-ta-0.5-IQ3_S.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-IQ3_XXS.gguf',

  // Experimental: IQ2
  'acestep-v15-merge-base-turbo-xl-ta-0.5-IQ2_S.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-IQ2_XS.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-IQ2_XXS.gguf',

  // Experimental: IQ1 / ternary / 1-bit
  'acestep-v15-merge-base-turbo-xl-ta-0.5-IQ1_M.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-IQ1_S.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-TQ2_0.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-TQ1_0.gguf',
  'acestep-v15-merge-base-turbo-xl-ta-0.5-Q1_0.gguf',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function aceGet(path, timeoutMs = 30000) {
  const res = await fetch(`${ACE_URL}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`);
  return res;
}

async function acePost(path, body, timeoutMs = 30000) {
  const res = await fetch(`${ACE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed (${res.status}): ${err}`);
  }
  return res;
}

/** Poll job until done/failed, with timeout */
async function pollJob(jobId, maxWaitMs = 600000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await aceGet(`/job?id=${jobId}`, 120000);
      const status = await res.json();
      if (status.status === 'done') return 'done';
      if (status.status === 'failed') return 'failed';
      if (status.status === 'cancelled') return 'cancelled';
    } catch (e) {
      // ace-server might be busy computing — retry after delay
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  return 'timeout';
}

/** Check VRAM usage */
async function getVram() {
  try {
    const res = await aceGet('/vram', 5000);
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ACE-Step Quantization Benchmark                       ║');
  console.log('║  Fixed: seed=42, 30s, 60 steps, euler, apg, linear     ║');
  console.log(`║  Server: ${ACE_URL.padEnd(46)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Verify server is alive
  try {
    await aceGet('/health');
    console.log('[✓] ace-server is reachable\n');
  } catch (e) {
    console.error('[✗] Cannot reach ace-server at', ACE_URL);
    console.error('    Start ace-server first, then re-run this script.');
    process.exit(1);
  }

  // Check which models are available
  const propsRes = await aceGet('/props');
  const props = await propsRes.json();
  const availableDit = new Set(props.models?.dit || []);
  console.log(`[i] Server has ${availableDit.size} DiT models loaded/available\n`);

  const results = [];

  for (let i = 0; i < MODELS.length; i++) {
    const modelName = MODELS[i];
    const shortName = modelName.replace('acestep-v15-merge-base-turbo-xl-ta-0.5-', '').replace('.gguf', '');
    const audioPath = path.join(OUT_DIR, `benchmark_${shortName}.wav`);

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[${i + 1}/${MODELS.length}] Testing: ${shortName}`);

    // Check if model is available
    if (!availableDit.has(modelName)) {
      console.log(`  ⚠ Model not found on server — SKIPPED`);
      results.push({
        model: shortName,
        file: modelName,
        status: 'skipped',
        reason: 'not found on server',
      });
      continue;
    }

    // Skip if already tested
    if (fs.existsSync(audioPath)) {
      console.log(`  ⏭ Already tested — skipping (delete ${path.basename(audioPath)} to re-run)`);
      results.push({
        model: shortName,
        file: modelName,
        status: 'skipped',
        reason: 'already tested',
      });
      continue;
    }

    // Submit synth job
    const request = {
      ...FIXED_PARAMS,
      synth_model: modelName,
    };

    let jobId, submitTime, genTime, status, vramBefore, vramAfter, audioSize;

    try {
      // Get VRAM before
      vramBefore = await getVram();

      submitTime = Date.now();
      console.log(`  ▶ Submitting synth job...`);
      const res = await acePost('/synth?format=wav16', request);
      const data = await res.json();
      jobId = data.id;
      console.log(`  ▶ Job ID: ${jobId} — polling...`);

      // Poll until done
      status = await pollJob(jobId, 600000); // 10 min max per model
      genTime = ((Date.now() - submitTime) / 1000).toFixed(1);

      // Get VRAM after
      vramAfter = await getVram();

      if (status === 'done') {
        // Fetch result
        console.log(`  ▶ Downloading audio...`);
        const audioRes = await fetch(`${ACE_URL}/job?id=${jobId}&result=1`, {
          signal: AbortSignal.timeout(60000),
        });

        if (audioRes.ok) {
          const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
          fs.writeFileSync(audioPath, audioBuffer);
          audioSize = audioBuffer.length;
          console.log(`  ✅ SUCCESS — ${genTime}s — ${(audioSize / 1024).toFixed(0)} KB — ${audioPath}`);
        } else {
          console.log(`  ❌ Result fetch failed (${audioRes.status})`);
          status = 'result_fetch_failed';
        }
      } else {
        console.log(`  ❌ ${status.toUpperCase()} after ${genTime}s`);
      }
    } catch (e) {
      genTime = ((Date.now() - (submitTime || Date.now())) / 1000).toFixed(1);
      status = 'error';
      console.log(`  ❌ ERROR: ${e.message}`);
    }

    results.push({
      model: shortName,
      file: modelName,
      status,
      genTimeSec: parseFloat(genTime || '0'),
      audioSizeBytes: audioSize || 0,
      vramBeforeMB: vramBefore?.used_mb || null,
      vramAfterMB: vramAfter?.used_mb || null,
      timestamp: new Date().toISOString(),
    });

    // Save intermediate results after each model
    fs.writeFileSync(
      path.join(OUT_DIR, 'results.json'),
      JSON.stringify(results, null, 2)
    );
    console.log();
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  BENCHMARK RESULTS                                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const successful = results.filter(r => r.status === 'done');
  const failed = results.filter(r => r.status !== 'done' && r.status !== 'skipped');

  console.log('Successful:');
  console.log('─'.repeat(70));
  console.log('Model'.padEnd(15) + 'Time(s)'.padStart(10) + 'Audio(KB)'.padStart(12) + 'VRAM(MB)'.padStart(12));
  console.log('─'.repeat(70));
  for (const r of successful) {
    const vram = r.vramAfterMB ? `${r.vramAfterMB}` : 'N/A';
    console.log(
      r.model.padEnd(15) +
      `${r.genTimeSec}`.padStart(10) +
      `${(r.audioSizeBytes / 1024).toFixed(0)}`.padStart(12) +
      vram.padStart(12)
    );
  }

  if (failed.length > 0) {
    console.log('\nFailed/Errored:');
    console.log('─'.repeat(70));
    for (const r of failed) {
      console.log(`  ${r.model}: ${r.status} (${r.genTimeSec}s)`);
    }
  }

  console.log(`\nResults saved to: ${path.join(OUT_DIR, 'results.json')}`);
  console.log(`Audio files saved to: ${OUT_DIR}`);
}

main().catch(console.error);
