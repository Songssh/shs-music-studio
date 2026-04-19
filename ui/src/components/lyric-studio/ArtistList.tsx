// ArtistList.tsx — Expandable artist/lyrics-set sidebar list
// Port of Lireek ArtistList, converted to Tailwind

import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Music, Sparkles } from 'lucide-react';
import { getArtists, getArtistLyricsSets, getLyricsSetGenerations } from '../../services/lireekApi';
import type { SavedArtist, SavedLyricsSetSummary } from '../../services/lireekApi';

interface ArtistListProps {
  onSelectSet: (set: SavedLyricsSetSummary) => void;
  onSelectGenerations: (setId: number, artistName: string, album: string | null) => void;
  refreshKey: number;
}

export const ArtistList: React.FC<ArtistListProps> = ({
  onSelectSet, onSelectGenerations, refreshKey,
}) => {
  const [artists, setArtists] = useState<SavedArtist[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sets, setSets] = useState<Record<number, SavedLyricsSetSummary[]>>({});
  const [genCounts, setGenCounts] = useState<Record<number, number>>({});

  useEffect(() => {
    getArtists().then(setArtists).catch(() => {});
  }, [refreshKey]);

  const toggleArtist = async (artistId: number) => {
    if (expanded === artistId) {
      setExpanded(null);
      return;
    }
    setExpanded(artistId);
    if (!sets[artistId]) {
      const data = await getArtistLyricsSets(artistId);
      setSets(prev => ({ ...prev, [artistId]: data }));
      for (const s of data) {
        getLyricsSetGenerations(s.id).then(gens => {
          setGenCounts(prev => ({ ...prev, [s.id]: gens.length }));
        }).catch(() => {});
      }
    }
  };

  if (artists.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-zinc-500">
        No saved artists yet. Fetch some lyrics to get started!
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {artists.map(a => (
        <div key={a.id}>
          <button
            onClick={() => toggleArtist(a.id)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
              expanded === a.id
                ? 'bg-zinc-800/60 text-white'
                : 'text-zinc-300 hover:bg-zinc-800/40 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2">
              <Music size={14} className="text-violet-400" />
              <span className="truncate">{a.name}</span>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-500">
                {a.lyrics_set_count}
              </span>
            </div>
            {expanded === a.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {expanded === a.id && sets[a.id] && (
            <div className="ml-6 mt-1 space-y-1">
              {sets[a.id].map(s => (
                <div key={s.id}>
                  <button
                    onClick={() => onSelectSet(s)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm transition-all text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200"
                  >
                    <span className="text-zinc-200">
                      {s.album || 'Top Songs'}
                    </span>
                    <span className="ml-2 text-xs text-zinc-500">
                      {s.total_songs} songs · {new Date(s.fetched_at).toLocaleDateString()}
                    </span>
                  </button>
                  {(genCounts[s.id] || 0) > 0 && (
                    <button
                      onClick={() => onSelectGenerations(s.id, s.artist_name, s.album)}
                      className="w-full text-left px-3 py-1.5 rounded-lg text-xs transition-all hover:bg-zinc-800/40 flex items-center gap-1.5 text-zinc-500"
                    >
                      <Sparkles size={10} className="text-violet-400" />
                      <span className="text-violet-400">
                        Based on {s.album || 'Top Songs'}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-800">
                        {genCounts[s.id]}
                      </span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
