import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { bindUserStorage, userStorage } from '../auth/userStorage';
import { MemoryStorage } from '../services/preferencesTestFake';

register('../stores/cssStubLoader.mjs', import.meta.url);
Object.assign(globalThis, { localStorage: new MemoryStorage(), window: { addEventListener() {}, removeEventListener() {} } });
bindUserStorage('profile-roundtrip-test');
const { useBackendStore } = await import('../stores/backendStore.js');
const { useGlobalParamsStore } = await import('../stores/globalParamsStore.js');
const { collectProfileData, applyProfileData } = await import('./paramProfiles.js');
const state = useGlobalParamsStore.getState;
const select = (activeBackendId: string) => useBackendStore.setState({ activeBackendId });
const request = () => state().getGlobalParams();
const save = async (backend: string) => JSON.parse(JSON.stringify(await collectProfileData(false, backend)));

// Capabilities fixture mirrors the per-engine declarations used by Parameters.
for (const [backend, keys] of Object.entries({
  yue2: ['yue2BatchSize', 'yue2Variations', 'yue2SemTemperature', 'yue2PlanTemperature', 'yue2PlanTopK'],
  'minimax-m3': ['mm3LmTemperature', 'samplerPluginsEnabled'],
  sa3: ['sa3Steps', 'samplerPluginsEnabled'],
})) {
  useBackendStore.setState(s => ({ capabilities: { ...s.capabilities, [backend]: {
    backend, up: true, core: {}, features: {}, extensions: keys.map(key => ({ key })),
  } as typeof s.capabilities[string] } }));
}

test('named profiles round-trip into Generate without changing the other engine', async () => {
  select('ace');
  state().setBatchSize(4);
  state().setLmTemperature(0.8);
  const ace = await save('ace');
  select('yue2');
  userStorage.setItem('hs-lora-trigger', JSON.stringify('ace trigger'));
  assert.equal((await collectProfileData(true, 'yue2')).loraTrigger, undefined);
  const before = userStorage.getItem('hs-backendParams@yue2');
  const defaults = await save('yue2');
  assert.equal(defaults.batchSize, undefined);
  assert.equal(defaults.lmTemperature, undefined);
  assert.equal(defaults.ppVaeReencode, undefined);
  assert.equal(defaults.backendParams.yue2BatchSize, 1);
  assert.equal(defaults.backendParams.yue2SemTemperature, undefined);
  assert.equal(userStorage.getItem('hs-backendParams@yue2'), before);
  state().setBackendParam('yue2BatchSize', 2);
  state().setBackendParam('yue2SemTemperature', 1.15);
  state().setBackendParam('yue2PlanTemperature', 0.9);
  state().setBackendParam('yue2PlanTopK', 42);
  state().setBackendParam('yue2Variations', 2);
  state().setYue2AlignLyrics(true);
  const yue = await save('yue2');
  await applyProfileData(defaults, 'yue2');
  assert.equal(request().yue2BatchSize, 1);
  assert.equal(request().yue2SemTemperature, undefined);
  assert.equal(request().yue2PlanTemperature, undefined);
  assert.equal(request().yue2PlanTopK, undefined);
  assert.equal(request().yue2Variations ?? 1, 1);
  assert.equal(state().yue2AlignLyrics, false);
  await applyProfileData(yue, 'yue2');
  select('ace');
  assert.equal(request().batchSize, 4);
  assert.equal(request().lmTemperature, 0.8);
  state().setBatchSize(1);
  state().setLmTemperature(1.3);
  await applyProfileData(ace, 'ace');
  assert.equal(request().batchSize, 4);
  assert.equal(request().lmTemperature, 0.8);
  select('yue2');
  const fresh = await import(new URL('../stores/globalParamsStore.ts?profile-reload', import.meta.url).href);
  const restored = fresh.useGlobalParamsStore.getState().getGlobalParams();
  assert.deepEqual([restored.yue2BatchSize, restored.yue2Variations, restored.yue2SemTemperature,
    restored.yue2PlanTemperature, restored.batchSize], [2, 2, 1.15, 0.9, 4]);
  assert.equal(restored.yue2PlanTopK, 42);
  assert.equal(restored.yue2AlignLyrics, true);
  await assert.rejects(applyProfileData(ace, 'yue2'));
});

test('old snapshots and partial presets only apply fields belonging to the active engine', async () => {
  select('yue2');
  state().setBatchSize(4);
  state().setLmTemperature(0.8);
  state().setBackendParam('yue2BatchSize', 2);
  state().setBackendParam('yue2SemTemperature', 1.1);
  state().setPpVaeReencode(false);
  await applyProfileData({ _version: 2, batchSize: 9, lmTemperature: 1.9, seed: 78, randomSeed: false,
    ppVaeReencode: true, loraTrigger: 'unrelated',
    backendParams: { mm3Steps: 20, yue2Unknown: 7 } }, 'yue2');
  assert.deepEqual([request().batchSize, request().lmTemperature, request().yue2BatchSize,
    request().yue2SemTemperature, request().mm3Steps, request().seed, request().randomSeed],
  [4, 0.8, 2, 1.1, undefined, 78, false]);
  assert.equal(request().yue2Unknown, undefined);
  assert.equal(state().backendParams.yue2Unknown, undefined);
  assert.equal(state().ppVaeReencode, false);
  assert.notEqual(userStorage.getItem('hs-lora-trigger'), JSON.stringify('unrelated'));
  await applyProfileData({ batchSize: 8, yue2BatchSize: 1, yue2Variations: 3,
    backendParams: { yue2BatchSize: 4 } }, 'yue2');
  assert.deepEqual([request().batchSize, request().yue2BatchSize, request().yue2Variations], [4, 4, 3]);
  state().setPluginParam('existing:gain', '1');
  await applyProfileData({ _version: 2, _mergeMaps: true,
    backendParams: { yue2PlanTemperature: 0.7 }, pluginParams: { 'plan:lock': 0.5 } }, 'yue2');
  assert.deepEqual([request().yue2BatchSize, request().yue2SemTemperature, request().yue2PlanTemperature,
    state().pluginParams['existing:gain'], state().pluginParams['plan:lock']], [4, 1.1, 0.7, '1', 0.5]);
  select('ace');
  await applyProfileData({ batchSize: 3, loraPath: 'legacy.safetensors', lmTemperature: 1.2 }, 'ace');
  assert.deepEqual([request().batchSize, request().loraPath, request().lmTemperature], [3, 'legacy.safetensors', 1.2]);
});

test('MiniMax and SA3 restore their own knobs and sampler selections', async () => {
  for (const [backend, knob, value] of [
    ['minimax-m3', 'mm3LmTemperature', 0.75], ['sa3', 'sa3Steps', 12],
  ] as const) {
    select(backend);
    state().setScheduler('custom-schedule');
    state().setBackendParam(knob, value);
    state().setBackendParam('samplerPluginsEnabled', true);
    if (backend === 'minimax-m3') state().setBackendParam('mm3LmAdapter', 'planner.gguf');
    const saved = await save(backend);
    state().setBackendParam(knob, 1);
    state().setScheduler('other');
    await applyProfileData(saved, backend);
    assert.equal(saved.batchSize, undefined);
    if (backend === 'sa3') assert.equal(saved.stableStepOn, undefined);
    if (backend === 'minimax-m3') assert.equal(saved.backendParams.mm3LmAdapter, 'planner.gguf');
    assert.deepEqual([request()[knob], request().scheduler, request().samplerPluginsEnabled],
      [value, 'custom-schedule', true]);
  }
});

test('switching while applying or lacking a usable schema cannot partly apply a profile', async () => {
  select('yue2');
  state().setSeed(123);
  const pending = applyProfileData({ seed: 456 }, 'yue2');
  select('ace');
  await assert.rejects(pending);
  assert.equal(state().seed, 123);

  select('yue2');
  const capabilities = useBackendStore.getState().capabilities;
  useBackendStore.setState({ capabilities: { ...capabilities,
    yue2: { ...capabilities.yue2, up: false, extensions: [] } } });
  try {
    await assert.rejects(save('yue2'), /unavailable/);
    await assert.rejects(applyProfileData({ seed: 789 }, 'yue2'), /unavailable/);
    assert.equal(state().seed, 123);
  } finally {
    useBackendStore.setState({ capabilities });
  }
});
