// ContentSection.tsx — Caption + Lyrics input area
// Ported to Tailwind styling matching hot-step-9000.

import React from 'react';
import { Music } from 'lucide-react';

interface ContentSectionProps {
  caption: string;
  onCaptionChange: (v: string) => void;
  lyrics: string;
  onLyricsChange: (v: string) => void;
  instrumental: boolean;
  onInstrumentalChange: (v: boolean) => void;
}

export const ContentSection: React.FC<ContentSectionProps> = ({
  caption, onCaptionChange, lyrics, onLyricsChange,
  instrumental, onInstrumentalChange,
}) => {
  return (
    <div className="space-y-3">
      {/* Style / Caption */}
      <div>
        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
          Style Description
        </label>
        <textarea
          className="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-white/10 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/20 outline-none resize-none transition-colors"
          placeholder="Dreamy indie folk, warm acoustic guitar, soft female vocals, intricate fingerpicking..."
          value={caption}
          onChange={e => onCaptionChange(e.target.value)}
          rows={3}
        />
      </div>

      {/* Instrumental toggle */}
      <label className="flex items-center gap-2.5 cursor-pointer group">
        <div className="relative">
          <input
            type="checkbox"
            checked={instrumental}
            onChange={e => onInstrumentalChange(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-8 h-4.5 bg-zinc-700 rounded-full peer-checked:bg-pink-500 transition-colors" />
          <div className="absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-transform peer-checked:translate-x-3.5" />
        </div>
        <div className="flex items-center gap-1.5">
          <Music size={14} className="text-zinc-500" />
          <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">
            Instrumental (no vocals)
          </span>
        </div>
      </label>

      {/* Lyrics */}
      {!instrumental && (
        <div>
          <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
            Lyrics
          </label>
          <textarea
            className="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-white/10 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/20 outline-none resize-vertical transition-colors font-mono leading-relaxed"
            placeholder={`[Verse 1]\nWalking through the morning light\nEvery shadow fading bright\n\n[Chorus]\nWe're alive, we're alive tonight...`}
            value={lyrics}
            onChange={e => onLyricsChange(e.target.value)}
            rows={8}
          />
        </div>
      )}
    </div>
  );
};
