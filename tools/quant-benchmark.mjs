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

/** Poll job until done/failed, tracking peak VRAM */
async function pollJob(jobId, maxWaitMs = 600000) {
  const start = Date.now();
  let peakVramMB = 0;
  while (Date.now() - start < maxWaitMs) {
    // Sample VRAM while waiting
    try {
      const vram = await getVram();
      if (vram?.used_mb && vram.used_mb > peakVramMB) {
        peakVramMB = vram.used_mb;
      }
    } catch { /* ignore */ }

    try {
      const res = await aceGet(`/job?id=${jobId}`, 120000);
      const status = await res.json();
      if (status.status === 'done') return { status: 'done', peakVramMB };
      if (status.status === 'failed') return { status: 'failed', peakVramMB };
      if (status.status === 'cancelled') return { status: 'cancelled', peakVramMB };
    } catch (e) {
      // ace-server might be busy computing — retry after delay
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return { status: 'timeout', peakVramMB };
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

// ─── Log file helper ─────────────────────────────────────────────────────────
const LOG_FILE = path.join(OUT_DIR, 'benchmark.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function main() {
  // Clear log file
  fs.writeFileSync(LOG_FILE, '');

  log('╔══════════════════════════════════════════════════════════╗');
  log('║  ACE-Step Quantization Benchmark                       ║');
  log('║  Fixed: seed=42, 30s, 60 steps, euler, apg, linear     ║');
  log(`║  Server: ${ACE_URL.padEnd(46)}║`);
  log('╚══════════════════════════════════════════════════════════╝');
  log('');

  // Verify server is alive
  try {
    await aceGet('/health');
    log('[✓] ace-server is reachable');
  } catch (e) {
    log('[✗] Cannot reach ace-server at ' + ACE_URL);
    log('    Start ace-server first, then re-run this script.');
    process.exit(1);
  }

  // Check which models are available
  const propsRes = await aceGet('/props');
  const props = await propsRes.json();
  const availableDit = new Set(props.models?.dit || []);
  log(`[i] Server has ${availableDit.size} DiT models loaded/available`);
  log('');

  const results = [];

  for (let i = 0; i < MODELS.length; i++) {
    const modelName = MODELS[i];
    const shortName = modelName.replace('acestep-v15-merge-base-turbo-xl-ta-0.5-', '').replace('.gguf', '');
    const audioPath = path.join(OUT_DIR, `benchmark_${shortName}.wav`);

    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    log(`[${i + 1}/${MODELS.length}] Testing: ${shortName}`);

    // Check if model is available
    if (!availableDit.has(modelName)) {
      log(`  ⚠ Model not found on server — SKIPPED`);
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
      log(`  ⏭ Already tested — skipping (delete ${path.basename(audioPath)} to re-run)`);
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

    let jobId, submitTime, genTime, pollResult, audioSize, peakVramMB = 0;

    try {
      submitTime = Date.now();
      log(`  ▶ Submitting synth job...`);
      const res = await acePost('/synth?format=wav16', request);
      const data = await res.json();
      jobId = data.id;
      log(`  ▶ Job ID: ${jobId} — polling (tracking VRAM)...`);

      // Poll until done — also tracks peak VRAM during generation
      pollResult = await pollJob(jobId, 600000); // 10 min max per model
      genTime = ((Date.now() - submitTime) / 1000).toFixed(1);
      peakVramMB = pollResult.peakVramMB || 0;

      if (pollResult.status === 'done') {
        // Fetch result
        log(`  ▶ Downloading audio...`);
        const audioRes = await fetch(`${ACE_URL}/job?id=${jobId}&result=1`, {
          signal: AbortSignal.timeout(60000),
        });

        if (audioRes.ok) {
          const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
          fs.writeFileSync(audioPath, audioBuffer);
          audioSize = audioBuffer.length;
          log(`  ✅ SUCCESS — ${genTime}s — peak VRAM: ${peakVramMB} MB — ${(audioSize / 1024).toFixed(0)} KB`);
        } else {
          log(`  ❌ Result fetch failed (${audioRes.status})`);
          pollResult.status = 'result_fetch_failed';
        }
      } else {
        log(`  ❌ ${pollResult.status.toUpperCase()} after ${genTime}s`);
      }
    } catch (e) {
      genTime = ((Date.now() - (submitTime || Date.now())) / 1000).toFixed(1);
      pollResult = { status: 'error', peakVramMB: 0 };
      log(`  ❌ ERROR: ${e.message}`);
    }

    results.push({
      model: shortName,
      file: modelName,
      status: pollResult.status,
      genTimeSec: parseFloat(genTime || '0'),
      peakVramMB,
      audioSizeBytes: audioSize || 0,
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
  log('');
  log('╔══════════════════════════════════════════════════════════════════════════╗');
  log('║  BENCHMARK RESULTS                                                    ║');
  log('╚══════════════════════════════════════════════════════════════════════════╝');
  log('');

  const successful = results.filter(r => r.status === 'done');
  const failed = results.filter(r => r.status !== 'done' && r.status !== 'skipped');

  log('Successful:');
  log('─'.repeat(75));
  log('Model'.padEnd(15) + 'Time(s)'.padStart(10) + 'Peak VRAM(MB)'.padStart(16) + 'Audio(KB)'.padStart(12));
  log('─'.repeat(75));
  for (const r of successful) {
    log(
      r.model.padEnd(15) +
      `${r.genTimeSec}`.padStart(10) +
      `${r.peakVramMB || 'N/A'}`.padStart(16) +
      `${(r.audioSizeBytes / 1024).toFixed(0)}`.padStart(12)
    );
  }

  if (failed.length > 0) {
    log('');
    log('Failed/Errored:');
    log('─'.repeat(75));
    for (const r of failed) {
      log(`  ${r.model}: ${r.status} (${r.genTimeSec}s)`);
    }
  }

  log('');
  log(`Results JSON: ${path.join(OUT_DIR, 'results.json')}`);
  log(`Audio files:  ${OUT_DIR}`);
  log(`Full log:     ${LOG_FILE}`);
}

main().catch(console.error);
