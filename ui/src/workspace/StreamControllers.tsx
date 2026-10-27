import { createContext } from 'react';
import type { useStreamAudioController } from '../hooks/useStreamAudio';

export type StreamController = ReturnType<typeof useStreamAudioController>;
export const StreamControllersContext = createContext<Record<string, StreamController> | null>(null);
// The shell observes running sessions without subscribing to per-frame audio time.
export const StreamActivityContext = createContext(0);
