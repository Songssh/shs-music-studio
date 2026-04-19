// FetchForm.tsx — Fetch lyrics from Genius
// Port of Lireek FetchForm, converted to Tailwind

import React, { useState } from 'react';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import { fetchAndSave } from '../../services/lireekApi';
import type { SavedLyricsSetSummary } from '../../services/lireekApi';

interface FetchFormProps {
  onFetched: (result: SavedLyricsSetSummary) => void;
}

export const FetchForm: React.FC<FetchFormProps> = ({ onFetched }) => {
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [maxSongs, setMaxSongs] = useState(15);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artist.trim()) return;

    setLoading(true);
    setError('');
    try {
      const result = await fetchAndSave({
        artist: artist.trim(),
        album: album.trim() || undefined,
        max_songs: maxSongs,
      });
      onFetched(result);
      setArtist('');
      setAlbum('');
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch lyrics');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Artist Name */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
          Artist Name
        </label>
        <input
          type="text"
          value={artist}
          onChange={e => setArtist(e.target.value)}
          placeholder="e.g. Radiohead, Kendrick Lamar"
          className="w-full px-4 py-2.5 rounded-lg text-sm bg-zinc-800/80 border border-zinc-700 text-white placeholder-zinc-500 outline-none focus:border-violet-500 transition-colors"
          disabled={loading}
        />
      </div>

      {/* Album (optional) */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
          Album <span className="text-zinc-600">(optional — leave blank for top songs)</span>
        </label>
        <input
          type="text"
          value={album}
          onChange={e => setAlbum(e.target.value)}
          placeholder="e.g. OK Computer"
          className="w-full px-4 py-2.5 rounded-lg text-sm bg-zinc-800/80 border border-zinc-700 text-white placeholder-zinc-500 outline-none focus:border-violet-500 transition-colors"
          disabled={loading}
        />
      </div>

      {/* Max Songs */}
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
          Max Songs
        </label>
        <input
          type="number"
          value={maxSongs}
          onChange={e => setMaxSongs(Math.max(1, Math.min(50, parseInt(e.target.value) || 15)))}
          min={1}
          max={50}
          className="w-20 px-3 py-2 rounded-lg text-sm text-center bg-zinc-800/80 border border-zinc-700 text-white outline-none focus:border-violet-500 transition-colors"
          disabled={loading}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg text-sm bg-red-950/50 border border-red-900/50 text-red-300">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading || !artist.trim()}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-violet-600 hover:bg-violet-500 text-white"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Fetching from Genius…
          </>
        ) : (
          <>
            <Search size={16} />
            Fetch Lyrics
          </>
        )}
      </button>
    </form>
  );
};
