// ProfileView.tsx — Build and view stylistic profiles
// Port of Lireek ProfileView, converted to Tailwind

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Loader2, Trash2, Code, X } from 'lucide-react';
import { getLyricsSetProfiles, deleteProfile, streamBuildProfile, skipThinking, loadSettings } from '../../services/lireekApi';
import type { SavedProfile } from '../../services/lireekApi';
import { StreamingPanel } from './StreamingPanel';

interface ProfileViewProps {
  lyricsSetId: number;
  artistName: string;
  albumName: string | null;
  onBack: () => void;
  onGenerate: (profileId: number) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  lyricsSetId, artistName, albumName, onBack, onGenerate,
}) => {
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState('');
  const [rawOutputId, setRawOutputId] = useState<number | null>(null);
  const [streamText, setStreamText] = useState('');
  const [streamPhase, setStreamPhase] = useState('');
  const [streamDone, setStreamDone] = useState(false);

  useEffect(() => {
    getLyricsSetProfiles(lyricsSetId).then(setProfiles).catch(() => {});
  }, [lyricsSetId]);

  const handleBuild = async () => {
    setBuilding(true);
    setError('');
    setStreamText('');
    setStreamPhase('');
    setStreamDone(false);
    try {
      const settings = loadSettings();
      await streamBuildProfile(lyricsSetId, {
        provider_name: settings.profilingProvider,
        model: settings.profilingModel || undefined,
      }, {
        onChunk: (text) => setStreamText(prev => prev + text),
        onPhase: (phase) => {
          setStreamPhase(phase);
          setStreamText(prev => prev + `\n--- ${phase} ---\n`);
        },
        onResult: (data) => setProfiles(prev => [data, ...prev]),
        onError: (msg) => setError(msg),
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to build profile');
    } finally {
      setBuilding(false);
      setStreamDone(true);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs mb-2 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={12} /> Back to lyrics
        </button>
        <h2 className="text-xl font-bold text-white">
          Stylistic Profile
        </h2>
        <p className="text-xs mt-1 text-zinc-500">
          {artistName}{albumName ? ` — ${albumName}` : ''}
        </p>
      </div>

      {/* Build a new profile */}
      <div className="rounded-xl p-4 bg-zinc-800/50 border border-zinc-700/50">
        <h3 className="text-sm font-semibold mb-3 text-zinc-200">
          Build a new profile
        </h3>
        <p className="text-xs mb-3 text-zinc-500">
          Uses the provider/model from Lyric Studio Settings.
        </p>

        {error && (
          <div className="px-4 py-3 rounded-lg text-sm mb-3 bg-red-950/50 border border-red-900/50 text-red-300">
            {error}
          </div>
        )}

        <button
          onClick={handleBuild}
          disabled={building}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-50 bg-violet-600 hover:bg-violet-500 text-white"
        >
          {building
            ? <><Loader2 size={16} className="animate-spin" /> Analysing lyrics…</>
            : 'Build Profile'
          }
        </button>
      </div>

      {/* LLM Streaming Output */}
      <StreamingPanel
        visible={building || (streamDone && streamText.length > 0)}
        streamText={streamText}
        phase={streamPhase}
        done={streamDone}
        onSkipThinking={building ? () => skipThinking() : undefined}
      />

      {/* Existing profiles */}
      {profiles.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-200">
            Saved Profiles
          </h3>
          {profiles.map(p => (
            <div
              key={p.id}
              className="rounded-xl p-4 bg-zinc-800/50 border border-zinc-700/50"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-sm font-medium text-zinc-200">
                    {p.provider} / {p.model}
                  </span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {new Date(p.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setRawOutputId(rawOutputId === p.id ? null : p.id)}
                    className={`p-1.5 rounded-lg text-xs transition-all ${
                      rawOutputId === p.id ? 'text-violet-400 bg-violet-500/10' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                    title="Toggle raw LLM output"
                  >
                    {rawOutputId === p.id ? <X size={14} /> : <Code size={14} />}
                  </button>
                  <button
                    onClick={() => onGenerate(p.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-all"
                  >
                    Generate →
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm('Delete this profile and all its generations?')) return;
                      await deleteProfile(p.id);
                      setProfiles(prev => prev.filter(x => x.id !== p.id));
                    }}
                    className="p-1.5 rounded-lg text-xs text-red-500 hover:bg-red-900/30 transition-all"
                    title="Delete profile"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Raw output panel */}
              {rawOutputId === p.id && (
                <div className="mb-3 rounded-lg p-3 overflow-auto bg-zinc-900/60 border border-zinc-700/40 max-h-[400px]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-violet-400">
                      Raw LLM Output
                    </span>
                  </div>
                  <pre className="text-xs whitespace-pre-wrap break-words text-zinc-500">
                    {(p.profile_data as any).raw_llm_response || p.profile_data.raw_summary || '(no raw output stored)'}
                  </pre>
                </div>
              )}

              {/* Profile data summary */}
              <div className="space-y-2 text-sm">
                <ProfileRow label="Themes" value={p.profile_data.themes?.join(', ')} />
                <ProfileRow label="Tone & mood" value={p.profile_data.tone_and_mood} />
                <ProfileRow label="Subjects" value={p.profile_data.common_subjects?.join(', ')} />
                <ProfileRow label="Vocabulary" value={p.profile_data.vocabulary_notes} />
                <ProfileRow label="Structure" value={p.profile_data.structural_patterns} />
                <ProfileRow label="Narrative" value={(p.profile_data as any).narrative_techniques} />
                <ProfileRow label="Imagery" value={(p.profile_data as any).imagery_patterns} />
                <ProfileRow label="Signature" value={(p.profile_data as any).signature_devices} />
                <ProfileRow label="Emot. arc" value={(p.profile_data as any).emotional_arc} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ProfileRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <span className="shrink-0 w-28 font-medium text-xs uppercase tracking-wide text-violet-400">
        {label}
      </span>
      <span className="text-xs text-zinc-400">{value}</span>
    </div>
  );
};
