// App.tsx — Root application component
//
// Composes: Sidebar, CreatePanel, SongList, JobQueue, Player.
// Each is a focused module — App just handles layout + top-level state.

import React, { useState, useCallback, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { useGenerationStore } from './stores/useGenerationStore';
import { songApi } from './services/api';
import { Sidebar } from './components/sidebar/Sidebar';
import { CreatePanel } from './components/create/CreatePanel';
import { SongList } from './components/library/SongList';
import { JobQueue } from './components/queue/JobQueue';
import { Player } from './components/player/Player';
import type { Song, GenerationParams } from './types';

const App: React.FC = () => {
  const { token, isLoading } = useAuth();
  const [activeView, setActiveView] = useState('create');
  const [songs, setSongs] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);

  // Song created callback — add to library
  const handleSongCreated = useCallback((song: Song) => {
    setSongs(prev => [song, ...prev.filter(s => s.id !== song.id)]);
  }, []);

  // Generation store
  const genStore = useGenerationStore(handleSongCreated);

  // Load songs on mount
  useEffect(() => {
    if (!token) return;
    songApi.list(token)
      .then(({ songs }) => setSongs(songs))
      .catch(err => console.error('[App] Failed to load songs:', err));
  }, [token]);

  // Handle generation
  const handleGenerate = useCallback((params: GenerationParams) => {
    if (!token) return;
    genStore.submit(params, token).catch(err => {
      console.error('[App] Generation failed:', err);
    });
  }, [token, genStore]);

  // Handle delete
  const handleDelete = useCallback(async (songId: string) => {
    if (!token) return;
    await songApi.delete(songId, token);
    setSongs(prev => prev.filter(s => s.id !== songId));
    if (currentSong?.id === songId) setCurrentSong(null);
  }, [token, currentSong]);

  if (isLoading) {
    return (
      <div className="app-layout" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-primary)', color: 'var(--text-muted)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '16px' }}>⚡</div>
          <div>Loading HOT-Step...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <Sidebar activeView={activeView} onViewChange={setActiveView} />

      {/* Main content */}
      <div className="app-main">
        <div className="app-content" style={{ display: 'flex', gap: 'var(--space-6)', overflow: 'hidden' }}>
          {/* Left: Create Panel */}
          {activeView === 'create' && (
            <div style={{ width: '380px', flexShrink: 0, minHeight: 0, height: '100%' }}>
              <CreatePanel
                onGenerate={handleGenerate}
                isGenerating={genStore.isGenerating}
              />
            </div>
          )}

          {/* Right: Queue + Library */}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <JobQueue
              jobs={genStore.jobs}
              onCancel={genStore.cancel}
              onClearCompleted={genStore.clearCompleted}
            />
            <SongList
              songs={songs}
              currentSongId={currentSong?.id}
              onPlay={setCurrentSong}
              onDelete={handleDelete}
            />
          </div>
        </div>

        {/* Player */}
        <div className="app-player">
          <Player song={currentSong} />
        </div>
      </div>
    </div>
  );
};

export default App;
