// LyricsBrowser.tsx — Browse songs in a lyrics set
// Port of Lireek LyricsBrowser, converted to Tailwind

import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Trash2, X, ArrowLeft, RefreshCw, Eye } from 'lucide-react';
import { getLyricsSet, deleteLyricsSet, removeSong, getLyricsSetProfiles } from '../../services/lireekApi';
import type { SavedLyricsSet, SavedProfile } from '../../services/lireekApi';

interface LyricsBrowserProps {
  lyricsSetId: number;
  onBack: () => void;
  onBuildProfile: () => void;
  onViewProfile: (profileId: number) => void;
  onDeleted: () => void;
}

export const LyricsBrowser: React.FC<LyricsBrowserProps> = ({
  lyricsSetId, onBack, onBuildProfile, onViewProfile, onDeleted,
}) => {
  const [data, setData] = useState<SavedLyricsSet | null>(null);
  const [expanded, setExpanded] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getLyricsSet(lyricsSetId),
      getLyricsSetProfiles(lyricsSetId).catch(() => []),
    ]).then(([lyricsData, profilesData]) => {
      setData(lyricsData);
      setProfiles(profilesData);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, [lyricsSetId]);

  const handleDelete = async () => {
    if (!confirm('Delete this lyrics set and all its profiles/generations?')) return;
    await deleteLyricsSet(lyricsSetId);
    onDeleted();
  };

  const handleRemoveSong = async (index: number) => {
    if (!data) return;
    const title = data.songs[index]?.title || 'this song';
    if (!confirm(`Remove "${title}" from this lyrics set?`)) return;
    try {
      const updated = await removeSong(lyricsSetId, index);
      setData(updated);
      if (expanded === index) setExpanded(null);
      else if (expanded !== null && expanded > index) setExpanded(expanded - 1);
    } catch {}
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-sm text-zinc-500">
        Loading lyrics…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-sm text-red-400">
        Lyrics set not found.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs mb-2 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ArrowLeft size={12} /> Back
          </button>
          <h2 className="text-xl font-bold text-white">
            {data.artist_name}
            {data.album && (
              <span className="ml-2 text-sm font-normal text-zinc-500">
                — {data.album}
              </span>
            )}
          </h2>
          <p className="text-xs mt-1 text-zinc-500">
            {data.total_songs} songs fetched
          </p>
        </div>
        <button
          onClick={handleDelete}
          className="p-2 rounded-lg text-zinc-500 hover:text-red-400 transition-colors"
          title="Delete lyrics set"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Existing profiles */}
      {profiles.length > 0 && (
        <div className="rounded-xl p-4 space-y-2 bg-zinc-900/60 border border-zinc-700/50">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Saved Profiles
          </p>
          {profiles.map(profile => (
            <div
              key={profile.id}
              className="flex items-center justify-between rounded-lg px-3 py-2 bg-zinc-800/60 border border-zinc-700/40"
            >
              <div>
                <p className="text-sm font-medium text-zinc-200">
                  Profile #{profile.id}
                </p>
                <p className="text-xs text-zinc-500">
                  {profile.provider} / {profile.model}
                </p>
              </div>
              <button
                onClick={() => onViewProfile(profile.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 text-white hover:bg-violet-500 transition-colors"
              >
                <Eye size={12} />
                View Profile
              </button>
            </div>
          ))}
          <button
            onClick={onBuildProfile}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium text-zinc-500 border border-zinc-700/50 hover:border-violet-500/50 hover:text-violet-400 transition-colors mt-2"
          >
            <RefreshCw size={12} />
            Regenerate Profile
          </button>
        </div>
      )}

      {/* Songs accordion */}
      <div className="space-y-1">
        {data.songs.map((song, i) => (
          <div
            key={i}
            className="rounded-xl overflow-hidden border border-zinc-700/50"
          >
            <div className="flex bg-zinc-900/60">
              <button
                onClick={() => setExpanded(expanded === i ? null : i)}
                className="flex-1 flex items-center justify-between px-4 py-3 text-sm font-medium text-zinc-200 hover:text-white transition-colors text-left"
              >
                <span>{song.title}</span>
                {expanded === i ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <button
                onClick={() => handleRemoveSong(i)}
                className="px-3 py-3 text-zinc-500 hover:text-red-400 transition-colors shrink-0"
                title={`Remove "${song.title}"`}
              >
                <X size={14} />
              </button>
            </div>
            {expanded === i && (
              <div className="lyrics-output px-5 py-4 text-sm bg-zinc-800/40 text-zinc-400">
                {song.lyrics || 'No lyrics available.'}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Build profile button (only if no profiles yet) */}
      {profiles.length === 0 && (
        <button
          onClick={onBuildProfile}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold text-sm bg-violet-600 hover:bg-violet-500 text-white transition-all"
        >
          Build Stylistic Profile →
        </button>
      )}
    </div>
  );
};
