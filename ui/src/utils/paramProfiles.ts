import { userStorage } from '../auth/userStorage';
// paramProfiles.ts — collect/apply the full generation-parameter state
//
// One shared implementation behind three features:
//   • Preset export/import (JSON file, GlobalParamBar)
//   • Parameter profiles (server-stored, ProfilesModal)
//   • Any future "restore these exact settings" flow
//
// Format v2 is a RAW snapshot of the globalParamsStore fields (exactly as
// set in the UI) plus the CreatePanel content fields. This differs from
// getGlobalParams(), which is a *request assembler*: it renames fields
// (adapter → loraPath), rescales values (dcwScaler) and omits knobs whose
// feature is currently disabled — fine for a request, lossy for a snapshot.
// v1 files (the old export, shaped like getGlobalParams() output) are still
// accepted via a small reverse-mapping in applyProfileData().

import { useGlobalParamsStore, scopedKey, normalizeModelSelection } from '../stores/globalParamsStore';
import { useBackendStore } from '../stores/backendStore';
import { queryClient } from '../queries/client';
import { capabilitiesOptions } from '../queries/global-models/options';
import { writePersistedState } from '../hooks/usePersistedState';
import { mergeProfileField } from './profileMerge';

// ── Content fields (CreatePanel state, persisted via usePersistedState) ──
// profile key → userStorage key
const CONTENT_KEYS: Record<string, string> = {
  caption: 'hs-caption',
  lyrics: 'hs-lyrics',
  negativePrompt: 'hs-negative-prompt',
  instrumental: 'hs-instrumental',
  bpm: 'hs-bpm',
  duration: 'hs-duration',
  keyScale: 'hs-keyScale',
  timeSignature: 'hs-timeSignature',
  vocalLanguage: 'hs-vocalLanguage',
  loraTrigger: 'hs-lora-trigger',
  beatIntro: 'hs-beat-intro',
  introBars: 'hs-intro-bars',
};

function contentFields(backend: string) {
  // Custom-Gen hides trigger and beat-intro controls for YuE2.
  return Object.entries(CONTENT_KEYS).filter(([key]) =>
    backend !== 'yue2' || !['loraTrigger', 'beatIntro', 'introBars'].includes(key));
}

// ── Store fields captured in a profile, grouped by domain ──
// Everything that affects generation. Deliberately excluded: adaptersOpen
// (accordion UI state) and adapterFolder (browse location preference).
// userStorage key is `hs-<field>` unless overridden in FIELD_KEY_OVERRIDES.
// This grouping is the single source of truth for collect/apply AND the
// profile inspector, so a field added here shows up in every path at once.
// Groups without a backend list keep the existing shared settings policy.
export const PARAM_GROUPS: { title: string; fields: string[]; backends?: string[] }[] = [
  {
    title: 'Models',
    backends: ['ace'],
    fields: ['ditModel', 'lmModel', 'vaeModel', 'embeddingModel'],
  },
  {
    title: 'Seed',
    fields: ['seed', 'randomSeed'],
  },
  {
    title: 'Adapters',
    backends: ['ace'],
    fields: [
      'adapter', 'adapterScale', 'adapterStack', 'adapterStackMode', 'adapterStackBudget',
      'adapterSectionAlignAt', 'adapterSectionIsolation', 'adapterMode', 'adapterRuntimeQuant',
      'adapterMergeLowVram', 'adapterGroupScales', 'rebaseSource', 'rebaseBeta', 'advancedAdapters',
      'adapterRuntimeDora', 'noAdapterRender', 'lmAdapter', 'lmAdapterScale',
    ],
  },
  {
    title: 'DiT Sampling',
    backends: ['ace'],
    fields: [
      'inferenceSteps', 'guidanceScale', 'cfgCutoffRatio', 'lmCfgCutoffRatio', 'cacheRatio',
      'batchSize', 'shift', 'storkSubsteps', 'beatStability', 'frequencyDamping', 'temporalSmoothing',
      'apgMomentum', 'apgNormThreshold', 'dcwEnabled', 'dcwMode', 'dcwLowScaler', 'dcwHighScaler',
      'latentShift', 'latentRescale', 'customTimesteps',
      'denoiseStrength', 'denoiseSmoothing', 'denoiseMix',
      'lssStrength', 'lssVarThresh', 'lssDcRemove',
      'timbreReference', 'timbreAudioPath', 'autoTrimEnabled', 'durationBuffer', 'autoTrimFadeMs',
    ],
  },
  {
    title: 'Sampler',
    backends: ['ace', 'minimax-m3', 'sa3'],
    fields: ['inferMethod', 'scheduler', 'guidanceMode'],
  },
  {
    title: 'Plugin Parameters',
    backends: ['ace', 'yue2', 'minimax-m3', 'sa3'],
    fields: ['pluginParams'],
  },
  {
    // Backend-declared knobs (capabilities().extensions), e.g. the YuE2 NAR
    // solver/scheduler, CADS and plan-strength sliders. Per backend, like
    // pluginParams. Merged on apply (see applyProfileData), so a profile
    // saved before this group existed leaves the live knobs untouched.
    title: 'Backend Knobs',
    fields: ['backendParams'],
  },
  {
    title: 'LM / Thinking',
    backends: ['ace'],
    fields: [
      'lmSeed', 'lmSeedFollowsDit', 'skipLm', 'useCotCaption',
      'lmTemperature', 'lmCfgScale', 'lmTopK', 'lmTopP', 'lmNegativePrompt', 'lmCodesStrength',
      'lmCodesMode', 'lmCodesSteps', 'lmRepPenalty', 'lmRepWindow', 'lmRepMode', 'lmDryBase', 'lmDryMinLen',
    ],
  },
  { title: 'Lyric Timestamps', backends: ['ace', 'minimax-m3'], fields: ['skipLrc'] },
  {
    title: 'Post-Processing',
    fields: [
      'postProcessingEnabled', 'masteringEnabled', 'masteringReference',
      'vocalNaturalizerEnabled', 'gainOffsetDb', 'naturalizeAmount', 'natVibratoRate',
      'natVibratoDepth', 'natFormantStrength', 'natMetallicReduction', 'natQuantizationMask',
      'natTransitionSmooth', 'lufsEnabled', 'lufsPreset', 'lufsTarget', 'lufsCeilingDb',
    ],
  },
  {
    title: 'ACE VAE',
    backends: ['ace'],
    fields: [
      'spectralLifterEnabled', 'slDenoiseStrength', 'slNoiseFloor', 'slHfMix', 'slTransientBoost',
      'slShimmerReduction', 'ppVaeReencode', 'ppVaeBlend', 'postprocessEnabled', 'postprocessPlugin',
    ],
  },
  {
    title: 'StableStep',
    backends: ['ace', 'minimax-m3', 'yue2'],
    fields: [
      'stableStepOn', 'stableStepStrength', 'stableStepBackend',
      'stableStepAdapters', 'stableStepPreserveDynamics', 'stableStepVocalPpVae',
      'stableStepVocalTrimDb',
      'stableStepBlendMode', 'stableStepCrossoverHz', 'stableStepCrossoverWidthHz', 'stableStepMix',
      'stableStepSeed', 'stableStepSeedFollowsDit',
      'stableStepSteps', 'stableStepSolver', 'stableStepScheduler',
      'stableStepGuidanceMode', 'stableStepGuidanceScale',
    ],
  },
  {
    title: 'Extras',
    fields: [
      'coverArtEnabled', 'coverArtSubject', 'qualityEvalEnabled', 'qualityEvalTarget',
      'whisperLyricsEnabled', 'whisperModel', 'whisperLanguage', 'whisperBeamSize', 'whisperIsolateVocals',
    ],
  },
  { title: 'YuE2', backends: ['yue2'], fields: ['yue2AlignLyrics'] },
];

function profileFields(backend: string): string[] {
  return PARAM_GROUPS.filter(g => !g.backends || g.backends.includes(backend)).flatMap(g => g.fields);
}

// Store fields whose userStorage key is not simply `hs-<field>`
const FIELD_KEY_OVERRIDES: Record<string, string> = {
  whisperLanguage: 'hs-whisperLang',
  whisperBeamSize: 'hs-whisperBeam',
  whisperIsolateVocals: 'hs-whisperIsolate',
};

function fieldStorageKey(field: string): string {
  // scopedKey() is a no-op for everything except the per-backend fields
  // (solver / scheduler / guidance, plugin + backend params). Applying a
  // preset while MiniMax-Music3 is active has to write into MM3's slot —
  // writing the bare key would put the values somewhere the live store never
  // reads back, so the next backend switch would silently undo the preset.
  return scopedKey(FIELD_KEY_OVERRIDES[field] ?? `hs-${field}`);
}

export type ProfileData = Record<string, unknown>;

// MiniMax also keeps these Models/Adapters controls in the extension map.
const MM3_PICKER_KEYS = ['mm3DitBackend', 'mm3LmAdapter', 'mm3LmAdapterMode', 'mm3LmMergeGpu',
  'mm3LmAdapterScale', 'mm3LmAdapterScaleAttn', 'mm3LmAdapterScaleMlp', 'mm3LmAdapterScaleEarly',
  'mm3LmAdapterScaleMid', 'mm3LmAdapterScaleLate', 'mm3LmAdapterTrigger'];

async function profileKnobKeys(backend: string): Promise<Set<string>> {
  const cached = useBackendStore.getState().capabilities[backend];
  const manifest = cached ?? (backend === 'ace' ? undefined : await queryClient.query(capabilitiesOptions(backend)));
  // A failed capabilities probe returns HTTP 200 with an empty schema. Saving
  // against it would silently discard every explicit knob in an overwrite.
  if (backend !== 'ace' && manifest && !manifest.up && !manifest.extensions.length) {
    throw new Error(`Parameter definitions for ${backend} are unavailable. Retry after the backend reconnects.`);
  }
  return new Set([...(manifest?.extensions.map(p => p.key) ?? []),
    ...(backend === 'minimax-m3' ? MM3_PICKER_KEYS : [])]);
}

export function checkProfileBackend(backend: string, source: unknown): void {
  if (typeof source === 'string' && source !== backend) {
    throw new Error(`Profile belongs to ${source}. Switch to that backend to use it.`);
  }
}

function readLS<T>(key: string, fallback: T): T {
  try {
    const v = userStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

// ── Collect ──────────────────────────────────────────────────────────────

/** Snapshot the selected engine's Parameters and, optionally, its Create content. */
export async function collectProfileData(includeContent: boolean, backend: string): Promise<ProfileData> {
  const keys = await profileKnobKeys(backend);
  checkProfileBackend(useBackendStore.getState().activeBackendId, backend);
  const s = useGlobalParamsStore.getState();
  const out: ProfileData = { _format: 'hot-step-preset', _version: 2, _backend: backend };
  if (includeContent) {
    for (const [field, lsKey] of contentFields(backend)) {
      out[field] = readLS(lsKey, undefined);
    }
  }
  for (const field of profileFields(backend)) out[field] = s[field];
  const knobs = Object.fromEntries(Object.entries(s.backendParams ?? {}).filter(([key]) => keys.has(key)));
  if (backend === 'yue2') knobs.yue2BatchSize ??= 1;
  out.backendParams = knobs;
  // Record intentional automatic/default settings without freezing the current
  // checkpoint's numbers. Older partial presets have no such instructions.
  out._unsetBackendParams = [...keys].filter(key => knobs[key] === undefined);
  return out;
}

// ── Apply ────────────────────────────────────────────────────────────────

// Reverse-map v1 preset files (shaped like getGlobalParams() output) onto
// store field names. Derived-only fields (triggerWord, loraStack) are ignored.
function mapV1(p: ProfileData): ProfileData {
  const out = { ...p };
  if (out.adapter === undefined && typeof out.loraPath === 'string') out.adapter = out.loraPath;
  if (out.adapterScale === undefined && typeof out.loraScale === 'number') out.adapterScale = out.loraScale;
  if (out.lmCodesStrength === undefined && typeof out.audioCoverStrength === 'number') out.lmCodesStrength = out.audioCoverStrength;
  // v1 stored timbreReference as either boolean or the audio path string
  if (typeof out.timbreReference === 'string') {
    out.timbreAudioPath = out.timbreReference;
    out.timbreReference = true;
  }
  // v1 pre-scaled the DCW scalers (dcwScaler = low ×0.05, or high ×0.02 in
  // high mode; double mode additionally exported dcwHighScaler ×0.02) — invert
  if (out.dcwLowScaler === undefined && typeof out.dcwScaler === 'number') {
    if (out.dcwMode === 'high') out.dcwHighScaler = out.dcwScaler / 0.02;
    else {
      out.dcwLowScaler = out.dcwScaler / 0.05;
      if (out.dcwMode === 'double' && typeof out.dcwHighScaler === 'number') {
        out.dcwHighScaler = out.dcwHighScaler / 0.02;
      }
    }
  }
  return out;
}

/**
 * Apply a preset/profile to the live UI — no page reload needed.
 * Content fields go through writePersistedState() so CreatePanel's
 * usePersistedState hooks pick them up in place; store fields are written
 * in one setState plus their hs-* userStorage keys.
 * Unknown keys are ignored, so both v1 and v2 files are safe.
 */
export async function applyProfileData(raw: ProfileData, backend: string): Promise<void> {
  checkProfileBackend(backend, raw._backend ?? raw.backend);
  const keys = await profileKnobKeys(backend);
  checkProfileBackend(useBackendStore.getState().activeBackendId, backend);
  const p = raw._version === 2 ? raw : mapV1(raw);
  const nested = p.backendParams;
  const entries = nested && typeof nested === 'object' && !Array.isArray(nested) ? Object.entries(nested) : [];
  // v1 was request-shaped (flat). Explicit entries in the scoped map win.
  const knobs = Object.fromEntries([...Object.entries(p), ...entries].filter(([key]) => keys.has(key)));
  const unset = raw._backend === backend && Array.isArray(raw._unsetBackendParams)
    ? raw._unsetBackendParams.filter((key): key is string => typeof key === 'string' && keys.has(key)) : [];

  for (const [field, lsKey] of contentFields(backend)) {
    if (p[field] !== undefined) writePersistedState(lsKey, p[field]);
  }

  const partial: Record<string, unknown> = {};
  const live = useGlobalParamsStore.getState() as unknown as Record<string, unknown>;
  for (const field of profileFields(backend)) {
    let value = p[field];
    if (field === 'backendParams') {
      if (!Object.keys(knobs).length && !unset.length) continue;
      const merged = { ...useGlobalParamsStore.getState().backendParams, ...knobs };
      for (const key of unset) if (!Object.hasOwn(knobs, key)) delete merged[key];
      value = merged;
    } else {
      if (value === undefined) continue;
      if (field === 'vaeModel') value = normalizeModelSelection('vaeModel', value);
      if (field === 'stableStepBackend') value = normalizeModelSelection('stableStepBackend', value);
      value = mergeProfileField(field, value, live[field], p._mergeMaps === true);
    }
    partial[field] = value;
    try { userStorage.setItem(fieldStorageKey(field), JSON.stringify(value)); } catch { /* full */ }
  }
  // Profiles saved before the LM-codes step-count mode existed carry only
  // lmCodesStrength; restore them in ratio mode so they behave as saved.
  if (backend === 'ace' && p.lmCodesStrength !== undefined && p.lmCodesMode === undefined) {
    partial.lmCodesMode = 'ratio';
    try { userStorage.setItem('hs-lmCodesMode', JSON.stringify('ratio')); } catch { /* full */ }
  }
  useGlobalParamsStore.setState(partial);
}

/** Short human summary of a profile for list rows, e.g. "32s · euler · linear · apg 9". */
export function summarizeProfile(p: ProfileData): string {
  const parts: string[] = [];
  if (typeof p.inferenceSteps === 'number') parts.push(`${p.inferenceSteps}s`);
  if (typeof p.inferMethod === 'string' && p.inferMethod) parts.push(p.inferMethod);
  if (typeof p.scheduler === 'string' && p.scheduler) parts.push(p.scheduler);
  if (typeof p.guidanceMode === 'string' && p.guidanceMode) {
    const g = typeof p.guidanceScale === 'number' ? ` ${p.guidanceScale}` : '';
    parts.push(`${p.guidanceMode}${g}`);
  }
  const dit = typeof p.ditModel === 'string' ? p.ditModel.split(/[\\/]/).pop() : '';
  if (dit) parts.push(dit.replace(/\.(gguf|safetensors)$/i, ''));
  return parts.join(' · ');
}

// ── Inspector ──────────────────────────────────────────────────────────────

/** camelCase field name → "Camel Case" label for display. */
function prettifyKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase())
    .replace(/\bLm\b/g, 'LM')
    .replace(/\bDit\b/g, 'DiT')
    .replace(/\bDcw\b/g, 'DCW')
    .replace(/\bApg\b/g, 'APG')
    .replace(/\bLss\b/g, 'LSS')
    .replace(/\bVae\b/g, 'VAE')
    .replace(/\bLufs\b/g, 'LUFS')
    .replace(/\bCfg\b/g, 'CFG')
    .replace(/\bBpm\b/g, 'BPM')
    .replace(/\bCot\b/g, 'CoT');
}

/** Human-readable value for the inspector. */
function formatValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    const base = v.split(/[\\/]/).pop() || v;   // shorten model/adapter paths
    return base.length > 60 ? base.slice(0, 57) + '…' : base;
  }
  try {
    const json = JSON.stringify(v);
    return json.length > 80 ? json.slice(0, 77) + '…' : json;
  } catch { return String(v); }
}

export interface InspectRow { key: string; label: string; value: string }
export interface InspectGroup { title: string; rows: InspectRow[] }

/**
 * Break a profile's data into display groups for the inspector. Only fields
 * actually present in the profile are shown; a leading "Content" group carries
 * the CreatePanel fields (caption/lyrics/etc.).
 */
export function describeProfileGroups(data: ProfileData): InspectGroup[] {
  const groups: InspectGroup[] = [];

  const contentRows: InspectRow[] = [];
  for (const field of Object.keys(CONTENT_KEYS)) {
    if (data[field] !== undefined) {
      contentRows.push({ key: field, label: prettifyKey(field), value: formatValue(data[field]) });
    }
  }
  if (contentRows.length) groups.push({ title: 'Content', rows: contentRows });

  for (const g of PARAM_GROUPS) {
    const rows: InspectRow[] = [];
    for (const field of g.fields) {
      if (data[field] !== undefined) {
        rows.push({ key: field, label: prettifyKey(field), value: formatValue(data[field]) });
      }
    }
    if (rows.length) groups.push({ title: g.title, rows });
  }
  return groups;
}
