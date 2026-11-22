import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { backendModelsOptions } from '../queries/global-models/options';
import { useBackendStore, type BackendModelCatalogue } from '../stores/backendStore';

register('../stores/cssStubLoader.mjs', import.meta.url);

test('Custom-Gen follows the confirmed backend and only its model catalogue', async t => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
  t.mock.getter(globalThis, 'navigator', () => ({ platform: 'Win32', userAgent: 'Windows' }));
  const { WorkspaceProvider } = await import('./WorkspaceContext.js');
  const { WorkspaceGenerationSummary } = await import('./WorkspaceGenerationSummary.js');
  const { useGlobalParamsStore } = await import('../stores/globalParamsStore.js');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const root = createRoot(document.querySelector('#root')!);
  const summary = () => document.querySelector('.ws-subtoolbar span')!.textContent;
  const select = (activeBackendId: string) => act(async () => useBackendStore.setState({ activeBackendId }));
  const publish = (catalogue: BackendModelCatalogue) => act(async () => {
    const key = backendModelsOptions(catalogue.backend).queryKey;
    await client.cancelQueries({ queryKey: key });
    client.setQueryData(key, catalogue);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  const ids = ['ace', 'yue2', 'minimax-m3', 'sa3'];
  useBackendStore.setState({ activeBackendId: 'ace', backends: ids.map(id => ({
    id, displayName: id, active: id === 'ace', resourcePool: 'gpu',
  })) });
  useGlobalParamsStore.setState({ ditModel: 'ace-test.gguf', adapter: 'ace-lora', advancedAdapters: false });
  const yue2 = { backend: 'yue2', selectable: true, buckets: { lm: ['q8'], vae: ['standard'] },
    defaults: { lm: 'q8', vae: 'standard', lmAdapterAr: '', lmAdapterNar: '' } };
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('/backends/active')) return Response.json({ error: 'switch failed' }, { status: 409 });
    // Keep the initial catalogue pending until the fixture publishes a response.
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(Error('aborted'))));
  });
  try {
    await act(async () => root.render(createElement(QueryClientProvider, { client },
      createElement(WorkspaceProvider, { children: createElement(WorkspaceGenerationSummary) }))));
    const ace = summary();
    assert.match(ace, /ace · DiT ace-test.gguf · 어댑터 ace-lora/);
    await select('yue2');
    assert.equal(summary(), 'yue2 · 모델 정보 불러오는 중');
    await publish(yue2);
    assert.equal(summary(), 'yue2 · LM q8 · VAE standard · 어댑터 없음');
    await publish({ ...yue2, defaults: { ...yue2.defaults, lmAdapterAr: 'ar-A', lmAdapterArInForce: true,
      lmAdapterNar: 'nar-B', lmAdapterNarInForce: false } });
    assert.match(summary(), /AR ar-A \(적용 보고됨\) · NAR nar-B \(선택\)/);
    await act(async () => useBackendStore.getState().switchBackend('ace'));
    assert.equal(useBackendStore.getState().activeBackendId, 'yue2');
    assert.match(summary(), /^yue2 · LM q8/);

    await select('ace');
    assert.equal(summary(), ace);
    await select('minimax-m3');
    await publish({ backend: 'minimax-m3', selectable: true, buckets: { lm: [], dit: [] },
      defaults: { lm: 'mm-lm', dit: 'mm-flow' } });
    // A late response for the outgoing backend must not change this line.
    await publish({ ...yue2, defaults: { ...yue2.defaults, lm: 'late-yue2' } });
    assert.equal(summary(), 'minimax-m3 · LM mm-lm · DIT mm-flow');
    await select('sa3');
    await publish({ backend: 'sa3', selectable: false, buckets: {}, defaults: {} });
    assert.equal(summary(), 'sa3 · 선택된 모델 정보 없음');
    await select('ace');
    assert.equal(summary(), ace);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
