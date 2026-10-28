import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { BackendToggle } from './BackendToggle';
import { useBackendStore, type BackendCapabilities, type BackendInfo } from '../../stores/backendStore';
import { backendsOptions, capabilitiesOptions } from '../../queries/global-models/options';

await i18n.use(initReactI18next).init({ lng: 'en', resources: {} });

for (const mode of ['launcher dialog', 'sidebar', 'collapsed sidebar'] as const) {
  test(`engine options stay reachable in the ${mode}`, async () => {
    const saved = { window: globalThis.window, document: globalThis.document };
    const originalState = useBackendStore.getState();
    const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
    Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity } } });
    const backends: BackendInfo[] = [
      { id: 'ace', displayName: 'ACE-Step 1.5', resourcePool: 'gpu', active: true },
      { id: 'minimax-m3', displayName: 'MiniMax-Music3', resourcePool: 'gpu', active: false },
      { id: 'yue2', displayName: 'YuE2', resourcePool: 'gpu', active: false },
    ];
    client.setQueryData(backendsOptions().queryKey, { backends, activeId: 'ace' });
    for (const backend of backends) {
      client.setQueryData(capabilitiesOptions(backend.id).queryKey, {
        backend: backend.id, up: true, core: {}, features: {}, extensions: [],
      } as BackendCapabilities);
    }
    const switches: string[] = [];
    useBackendStore.setState({ backends, activeBackendId: 'ace', capabilities: {}, switchBackend: async id => {
      switches.push(id);
      useBackendStore.setState({ activeBackendId: id });
    } });
    const root = createRoot(document.getElementById('root')!);
    try {
      const picker = createElement(BackendToggle, { collapsed: mode === 'collapsed sidebar' });
      await act(async () => root.render(createElement(QueryClientProvider, { client },
        mode === 'launcher dialog' ? createElement('dialog', { open: true }, picker) : picker)));
      const trigger = document.querySelector('button')!;
      trigger.getBoundingClientRect = () => ({ top: 80, bottom: 130, left: 20, right: 180, width: 160, height: 50, x: 20, y: 80, toJSON() {} });
      const click = (element: Element) => act(async () => { element.dispatchEvent(new window.Event('click', { bubbles: true })); });
      const panel = () => document.querySelector('[data-portal-layer]');

      await click(trigger);
      assert.ok(panel(), 'clicking the engine opens the options');
      // A body portal sits behind showModal() and is inert. Its options must
      // belong to the dialog, while ordinary sidebar portals stay on body.
      const host = mode === 'launcher dialog' ? document.querySelector('dialog') : document.body;
      assert.ok(panel()!.parentElement === host, 'options must share the trigger\'s modal layer');
      assert.deepEqual(Array.from(panel()!.querySelectorAll('button'), b => b.textContent), backends.map(b => b.displayName));
      await click(panel()!.querySelector('button')!);
      assert.equal(panel(), null);
      assert.deepEqual(switches, [], 'selecting the current engine does not reload it');

      await click(trigger);
      const option = panel()!.querySelectorAll('button')[1];
      await act(async () => { option.dispatchEvent(new window.Event('mousedown', { bubbles: true })); });
      assert.ok(panel(), 'pressing an option must not trigger outside dismissal');
      await click(option);
      assert.deepEqual(switches, ['minimax-m3']);
      assert.match(trigger.textContent ?? '', /MiniMax-Music3/);
      assert.equal(panel(), null);

      await click(trigger);
      await act(async () => { trigger.parentElement!.dispatchEvent(new window.Event('mousedown', { bubbles: true })); });
      assert.equal(panel(), null, 'clicking outside the picker closes its options');
    } finally {
      await act(async () => root.unmount());
      client.clear();
      useBackendStore.setState(originalState, true);
      Object.assign(globalThis, saved);
    }
  });
}
