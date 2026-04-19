// LyricStudio.tsx — Container component for the Lyric Studio view
// Self-contained with its own sub-navigation (artist sidebar + step-based content)

import React, { useState, useCallback } from 'react';
import { Mic, Plus, Settings } from 'lucide-react';
import type { SavedLyricsSetSummary } from '../../services/lireekApi';
import { ArtistList } from './ArtistList';
import { FetchForm } from './FetchForm';
import { LyricsBrowser } from './LyricsBrowser';
import { ProfileView } from './ProfileView';
import { GeneratePanel } from './GeneratePanel';
import { LyricStudioSettings } from './LyricStudioSettings';

// Discriminated union for internal navigation
type View =
  | { step: 'fetch' }
  | { step: 'lyrics'; setId: number; artistName: string; album: string | null }
  | { step: 'profile'; setId: number; artistName: string; album: string | null }
  | { step: 'generate'; profileId: number; artistName: string; setId: number; album: string | null }
  | { step: 'generations'; setId: number; artistName: string; album: string | null }
  | { step: 'settings' };

const STEPS = [
  { key: 'fetch', label: 'Fetch' },
  { key: 'lyrics', label: 'Browse' },
  { key: 'profile', label: 'Profile' },
  { key: 'generate', label: 'Generate' },
];

export const LyricStudio: React.FC = () => {
  const [view, setView] = useState<View>({ step: 'fetch' });
  const [refreshKey, setRefreshKey] = useState(0);

  const handleFetched = useCallback((result: SavedLyricsSetSummary) => {
    setRefreshKey(k => k + 1);
    setView({
      step: 'lyrics',
      setId: result.id,
      artistName: result.artist_name,
      album: result.album,
    });
  }, []);

  const handleSelectSet = useCallback((set: SavedLyricsSetSummary) => {
    setView({
      step: 'lyrics',
      setId: set.id,
      artistName: set.artist_name,
      album: set.album,
    });
  }, []);

  const handleSelectGenerations = useCallback((setId: number, artistName: string, album: string | null) => {
    setView({ step: 'generations', setId, artistName, album });
  }, []);

  const currentIdx = view.step === 'settings' || view.step === 'generations'
    ? -1
    : STEPS.findIndex(s => s.key === view.step);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sub-sidebar — artists */}
      <aside className="w-64 shrink-0 flex flex-col h-full bg-zinc-900/80 border-r border-zinc-800">
        {/* Logo area */}
        <div className="px-5 py-5 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Mic size={20} className="text-violet-400" />
            <h1 className="text-lg font-bold tracking-tight text-white">
              Lyric Studio
            </h1>
          </div>
          <p className="text-xs mt-1 text-zinc-500">
            AI lyric generation
          </p>
        </div>

        {/* New fetch button */}
        <div className="px-4 pt-4">
          <button
            onClick={() => setView({ step: 'fetch' })}
            className={`w-full py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
              view.step === 'fetch'
                ? 'bg-violet-600 text-white'
                : 'text-zinc-300 border border-zinc-700 hover:border-violet-500/50 hover:text-white'
            }`}
          >
            <Plus size={14} />
            Fetch New Lyrics
          </button>
        </div>

        {/* Saved artists */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3 px-3 text-zinc-500">
            Saved Artists
          </p>
          <ArtistList
            onSelectSet={handleSelectSet}
            onSelectGenerations={handleSelectGenerations}
            refreshKey={refreshKey}
          />
        </div>

        {/* Settings */}
        <div className="px-4 py-3 border-t border-zinc-800">
          <button
            onClick={() => setView({ step: 'settings' })}
            className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors ${
              view.step === 'settings'
                ? 'bg-violet-600 text-white'
                : 'text-zinc-500 border border-zinc-700 hover:border-violet-500/50 hover:text-violet-400'
            }`}
          >
            <Settings size={12} />
            LLM Settings
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        {/* Step indicator */}
        {view.step !== 'settings' && (
          <div className="sticky top-0 z-10 flex items-center gap-3 px-8 py-4 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border transition-colors ${
                      i <= currentIdx
                        ? 'bg-violet-600 border-violet-600 text-white'
                        : 'bg-zinc-900 border-zinc-700 text-zinc-500'
                    }`}
                  >
                    {i + 1}
                  </div>
                  <span className={`text-sm font-medium ${
                    i === currentIdx ? 'text-white' : 'text-zinc-500'
                  }`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-8 h-px ${
                    i < currentIdx ? 'bg-violet-600' : 'bg-zinc-700'
                  }`} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Content area */}
        <div className="max-w-3xl mx-auto px-8 py-8">
          {view.step === 'fetch' && (
            <>
              <h2 className="text-2xl font-bold mb-1 text-white">
                Fetch Lyrics
              </h2>
              <p className="text-sm mb-6 text-zinc-500">
                Search for an artist and we'll grab their lyrics from Genius.
              </p>
              <FetchForm onFetched={handleFetched} />
            </>
          )}

          {view.step === 'lyrics' && (
            <LyricsBrowser
              lyricsSetId={view.setId}
              onBack={() => setView({ step: 'fetch' })}
              onBuildProfile={() =>
                setView({
                  step: 'profile',
                  setId: view.setId,
                  artistName: view.artistName,
                  album: view.album,
                })
              }
              onViewProfile={() =>
                setView({
                  step: 'profile',
                  setId: view.setId,
                  artistName: view.artistName,
                  album: view.album,
                })
              }
              onDeleted={() => {
                setRefreshKey(k => k + 1);
                setView({ step: 'fetch' });
              }}
            />
          )}

          {view.step === 'profile' && (
            <ProfileView
              lyricsSetId={view.setId}
              artistName={view.artistName}
              albumName={view.album}
              onBack={() =>
                setView({
                  step: 'lyrics',
                  setId: view.setId,
                  artistName: view.artistName,
                  album: view.album,
                })
              }
              onGenerate={(profileId) =>
                setView({
                  step: 'generate',
                  profileId,
                  artistName: view.artistName,
                  setId: view.setId,
                  album: view.album,
                })
              }
            />
          )}

          {view.step === 'generate' && (
            <GeneratePanel
              profileId={view.profileId}
              artistName={view.artistName}
              onBack={() =>
                setView({
                  step: 'profile',
                  setId: view.setId,
                  artistName: view.artistName,
                  album: view.album,
                })
              }
            />
          )}

          {view.step === 'generations' && (
            <GeneratePanel
              lyricsSetId={view.setId}
              artistName={view.artistName}
              onBack={() => setView({ step: 'fetch' })}
            />
          )}

          {view.step === 'settings' && (
            <LyricStudioSettings
              onBack={() => setView({ step: 'fetch' })}
            />
          )}
        </div>
      </main>
    </div>
  );
};
