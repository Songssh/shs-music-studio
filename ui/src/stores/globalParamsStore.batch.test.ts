import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { bindUserStorage, userStorage } from '../auth/userStorage';
import { MemoryStorage } from '../services/preferencesTestFake';

register('./cssStubLoader.mjs', import.meta.url);
Object.assign(globalThis, {
  localStorage: new MemoryStorage(),
  window: { addEventListener() {}, removeEventListener() {} },
});
bindUserStorage('batch-test');

test('Custom-Gen serializes the YuE2 batch independently of ACE across switches and reload', async () => {
  const { useBackendStore } = await import('./backendStore.js');
  const { useGlobalParamsStore } = await import('./globalParamsStore.js');
  const params = useGlobalParamsStore.getState;
  const select = (activeBackendId: string) => useBackendStore.setState({ activeBackendId });
  params().setBatchSize(4);
  select('yue2');

  const storageKey = 'hs-backendParams@yue2';
  const before = userStorage.getItem(storageKey);
  const first = params().getGlobalParams();
  assert.equal(first.batchSize, 4);
  assert.equal(first.yue2BatchSize, 1);
  assert.equal(first.yue2SemTemperature, undefined);
  assert.equal(params().backendParams.yue2BatchSize, undefined);
  assert.equal(userStorage.getItem(storageKey), before);

  for (const size of [1, 4, 1, 2]) { // Returning to 1 also exercises the Parameters reset setter.
    params().setBackendParam('yue2BatchSize', size);
    select('ace');
    assert.equal(params().getGlobalParams().batchSize, 4);
    assert.equal(params().getGlobalParams().yue2BatchSize, undefined);
    select('yue2');
    assert.equal(params().backendParams.yue2BatchSize, size);
    assert.equal(params().getGlobalParams().yue2BatchSize, size);
  }

  // Re-evaluate the store's initial hydration against the same user storage.
  const reloaded = await import(new URL('./globalParamsStore.ts?reload', import.meta.url).href);
  assert.notEqual(reloaded.useGlobalParamsStore, useGlobalParamsStore);
  const restored = reloaded.useGlobalParamsStore.getState();
  assert.equal(restored.backendParams.yue2BatchSize, 2);
  assert.equal(restored.getGlobalParams().yue2BatchSize, 2);
  assert.equal(restored.getGlobalParams().batchSize, 4);
});
