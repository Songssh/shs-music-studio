import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { bindUserStorage } from '../../auth/userStorage';
import { MemoryStorage } from '../../services/preferencesTestFake';
import type { BackendCapabilities } from '../../stores/backendStore';
import { capabilitiesOptions } from '../../queries/global-models/options';

register('../../stores/cssStubLoader.mjs', import.meta.url);

test('Quick Settings follow Parameters, profile restores and changing engine limits without writing back', async t => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document, localStorage: new MemoryStorage(), IS_REACT_ACT_ENVIRONMENT: true });
  document.oninput = null;
  const { createRoot } = await import('react-dom/client');
  bindUserStorage('quick-settings-test');
  t.mock.method(globalThis, 'fetch', async (_url, options) =>
    new Promise<Response>((_, reject) => options?.signal?.addEventListener('abort', () => reject(Error('aborted')))));
  const { useBackendStore } = await import('../../stores/backendStore.js');
  const { useGlobalParamsStore } = await import('../../stores/globalParamsStore.js');
  const { applyProfileData, collectProfileData } = await import('../../utils/paramProfiles.js');
  const { QuickGenerationSettings } = await import('./QuickGenerationSettings.js');
  const { default: i18n } = await import('../../i18n/index.js');
  await i18n.changeLanguage('en');
  const gp = useGlobalParamsStore.getState;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const root = createRoot(document.querySelector('#root')!);
  const slider = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  const batch = () => slider('Songs per generation')!;
  const move = (element: HTMLInputElement, value: number) => act(async () => {
    // Dispatch the browser's input event after moving the native range thumb.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(element, String(value));
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  const request = () => JSON.parse(JSON.stringify(gp().getGlobalParams()));
  const select = (activeBackendId: string) => act(async () => useBackendStore.setState({ activeBackendId }));
  const publish = (backend: string, max: number, maxVars = 1) => act(async () => {
    const keys = backend === 'yue2' ? [
      { key: 'yue2BatchSize', max }, { key: 'yue2Variations', max: maxVars },
      { key: 'yue2SemTemperature', min: 0.1, max: 2, step: 0.05, default: 0.9 },
    ] : backend === 'minimax-m3' ? [{ key: 'mm3LmTemperature', min: 0.5, max: 1.6, step: 0.05, default: 1 }] : [];
    const caps = { backend, up: true, core: { batch: { max }, seed: true }, features: { lm: backend === 'ace' },
      extensions: keys.map(p => ({ type: 'slider', ...p })) } as BackendCapabilities;
    useBackendStore.setState(s => ({ capabilities: { ...s.capabilities, [backend]: caps } }));
    client.setQueryData(capabilitiesOptions(backend).queryKey, caps);
  });
  try {
    await publish('ace', 8);
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(QuickGenerationSettings))));
    await move(batch(), 4);
    await move(slider('LM Temperature')!, 0.85);
    assert.equal(request().lmTemperature, 0.85);
    await act(async () => { gp().setSkipLm(true); });
    assert.equal(batch().value, '4');
    assert.equal(request().batchSize, 4);
    assert.ok(slider('LM Temperature')!.disabled);
    await select('yue2');
    assert.equal(slider('LM Temperature'), null);
    assert.equal(batch(), null);
    await publish('yue2', 4, 4);
    const composer = () => slider('Composer Temperature')!;
    assert.equal(batch().value, '1');
    assert.equal(composer().getAttribute('aria-valuetext'), 'Auto');
    assert.ok(!Object.hasOwn(request(), 'yue2SemTemperature'));
    await move(batch(), 2);
    await move(composer(), 1.15);
    await act(async () => { gp().setBackendParam('yue2Variations', 2); });
    assert.equal(batch().value, '2');
    assert.match(document.body.textContent!, /2 × 2 = 4 expected tracks/);
    const saved = await collectProfileData(false, 'yue2');
    await act(async () => document.querySelector<HTMLButtonElement>('button[title="Use the checkpoint temperature"]')!.click());
    assert.ok(!Object.hasOwn(request(), 'yue2SemTemperature'));
    assert.ok(!Object.hasOwn(gp().backendParams, 'yue2SemTemperature'));
    await act(async () => applyProfileData(saved, 'yue2'));
    assert.equal(composer().getAttribute('aria-valuetext'), '1.15');
    assert.equal(request().yue2SemTemperature, 1.15);
    await publish('yue2', 1, 1);
    assert.ok(batch().disabled);
    assert.equal(batch().value, '1');
    assert.deepEqual([request().yue2BatchSize, request().yue2Variations], [1, 1]);
    assert.deepEqual([gp().backendParams.yue2BatchSize, gp().backendParams.yue2Variations], [2, 2]);
    await publish('yue2', 4, 4);
    assert.equal(batch().value, '2');
    await act(async () => { gp().setSeed(-1); document.querySelector<HTMLButtonElement>('[role=switch]')!.click(); });
    assert.deepEqual([request().randomSeed, request().seed], [false, 42]);

    await publish('minimax-m3', 1);
    await select('minimax-m3');
    assert.ok(batch().disabled);
    assert.equal(slider('LM Temperature')!.getAttribute('max'), '1.6');
    assert.equal(request().batchSize, 1);
    await publish('sa3', 1);
    await select('sa3');
    assert.equal(slider('LM Temperature'), null);
    assert.equal(slider('Composer Temperature'), null);
    await select('ace');
    assert.equal(batch().value, '4');
    await publish('ace', 2);
    assert.deepEqual([batch().value, request().batchSize, gp().batchSize], ['2', 2, 4]);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
