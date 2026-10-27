import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { aceModelsOptions } from '../queries/global-models/options';
import { useGlobalParamsStore } from '../context/GlobalParamsContext';
import { useStreamAudioController } from '../hooks/useStreamAudio';
import { StreamActivityContext, StreamControllersContext } from './StreamControllers';
import { useWorkspace } from './WorkspaceContext';

// No audio resource is allocated until an explicit Start. These controllers
// outlive Activity's visual effects; closing a STORM window never aborts them.
function WindowsServices({ children }: { children: React.ReactNode }) {
  const { hosts } = useWorkspace();
  const entries = useSyncExternalStore(hosts.subscribe, hosts.getSnapshot);
  const visible = entries.some(host => host.id === 'storm' && host.visible);
  const main = useStreamAudioController('storm-main', visible);
  const deckA = useStreamAudioController('deck-a', visible);
  const deckB = useStreamAudioController('deck-b', visible);
  const models = useQuery(aceModelsOptions()).data;
  useEffect(() => {
    const values = models?.models; if (!values) return;
    const params = useGlobalParamsStore.getState();
    if (values.dit?.length && !params.ditModel) params.setDitModel(values.dit[0]);
    if (values.lm?.length && !params.lmModel) params.setLmModel(values.lm[0]);
    if (values.vae?.length && !params.vaeModel) params.setVaeModel(values.vae[0]);
    if (values.embedding?.length && !params.embeddingModel) params.setEmbeddingModel(values.embedding[0]);
  }, [models]);
  const activeStreams = [main, deckA, deckB].filter(stream => stream.isPlaying).length;
  return <StreamControllersContext.Provider value={{ 'storm-main': main, 'deck-a': deckA, 'deck-b': deckB }}><StreamActivityContext.Provider value={activeStreams}>{children}</StreamActivityContext.Provider></StreamControllersContext.Provider>;
}
export function WorkspaceServices({ children }: { children: React.ReactNode }) {
  const { eligible } = useWorkspace();
  return eligible ? <WindowsServices>{children}</WindowsServices> : children;
}
