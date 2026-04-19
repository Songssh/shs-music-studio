// GeneratePanel.tsx — Generate and refine lyrics
// Port of Lireek GeneratePanel, converted to Tailwind

import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Loader2, Copy, Check, Trash2,
  ChevronDown, ChevronRight, Code, Download, Sparkles,
} from 'lucide-react';
import {
  getProfile, streamGenerateFromProfile, streamRefineGeneration,
  getProfileGenerations, getLyricsSetGenerations, getLyricsSetProfiles,
  deleteGeneration, exportGeneration, exportAllGenerations, skipThinking,
  loadSettings,
} from '../../services/lireekApi';
import type { SavedProfile, SavedGeneration } from '../../services/lireekApi';
import { StreamingPanel } from './StreamingPanel';

interface GeneratePanelProps {
  profileId?: number;
  lyricsSetId?: number;
  artistName: string;
  onBack: () => void;
}

export const GeneratePanel: React.FC<GeneratePanelProps> = ({
  profileId, lyricsSetId, artistName, onBack,
}) => {
  const [profile, setProfile] = useState<SavedProfile | null>(null);
  const [generations, setGenerations] = useState<SavedGeneration[]>([]);
  const [extraInstructions, setExtraInstructions] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingProgress, setGeneratingProgress] = useState('');
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [promptIds, setPromptIds] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState('');
  const [streamText, setStreamText] = useState('');
  const [streamPhase, setStreamPhase] = useState('');
  const [streamDone, setStreamDone] = useState(false);
  const [refiningId, setRefiningId] = useState<number | null>(null);
  const [refineStreamText, setRefineStreamText] = useState('');
  const [refineError, setRefineError] = useState('');

  // For "Based on" mode
  const [availableProfiles, setAvailableProfiles] = useState<SavedProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [batchCount, setBatchCount] = useState(1);

  useEffect(() => {
    if (profileId) {
      getProfile(profileId).then(setProfile).catch(() => {});
      getProfileGenerations(profileId).then(gens => {
        setGenerations(gens);
        if (gens.length > 0) setExpandedIds(new Set([gens[0].id]));
      }).catch(() => {});
    } else if (lyricsSetId) {
      getLyricsSetGenerations(lyricsSetId).then(gens => {
        setGenerations(gens);
        if (gens.length > 0) setExpandedIds(new Set([gens[0].id]));
      }).catch(() => {});
      getLyricsSetProfiles(lyricsSetId).then(profiles => {
        setAvailableProfiles(profiles);
        if (profiles.length > 0) setSelectedProfileId(profiles[0].id);
      }).catch(() => {});
    }
  }, [profileId, lyricsSetId]);

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePrompt = (id: number) => {
    setPromptIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleGenerate = async () => {
    const targetProfileId = profileId || selectedProfileId;
    if (!targetProfileId) return;
    setGenerating(true);
    setError('');
    setGeneratingProgress('');
    setStreamText('');
    setStreamPhase('');
    setStreamDone(false);
    try {
      const settings = loadSettings();
      const count = profileId ? 1 : Math.max(1, Math.min(batchCount, 20));

      for (let i = 0; i < count; i++) {
        if (count > 1) {
          setGeneratingProgress(`Generating ${i + 1} of ${count}…`);
          setStreamText('');
          setStreamPhase('');
        }
        await streamGenerateFromProfile(targetProfileId, {
          provider_name: settings.generationProvider,
          model: settings.generationModel || undefined,
          extra_instructions: extraInstructions.trim() || undefined,
        }, {
          onChunk: (text) => setStreamText(prev => prev + text),
          onPhase: (phase) => {
            setStreamPhase(phase);
            setStreamText(prev => prev + `\n--- ${phase} ---\n`);
          },
          onResult: (data) => {
            setGenerations(prev => [data, ...prev]);
            setExpandedIds(prev => new Set([data.id, ...prev]));
          },
          onError: (msg) => setError(msg),
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to generate');
    } finally {
      setGenerating(false);
      setGeneratingProgress('');
      setStreamDone(true);
    }
  };

  const handleCopy = (id: number, lyrics: string) => {
    navigator.clipboard.writeText(lyrics);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const canGenerate = !!(profileId || selectedProfileId);

  const handleRefine = async (generationId: number) => {
    setRefiningId(generationId);
    setRefineStreamText('');
    setRefineError('');
    try {
      const settings = loadSettings();
      await streamRefineGeneration(generationId, {
        provider_name: settings.refinementProvider,
        model: settings.refinementModel || undefined,
      }, {
        onChunk: (text) => setRefineStreamText(prev => prev + text),
        onResult: (data) => {
          setGenerations(prev => [data, ...prev]);
          setExpandedIds(prev => new Set([data.id, ...prev]));
        },
        onError: (msg) => setRefineError(msg),
      });
    } catch (err: any) {
      setRefineError(err?.message || 'Refinement failed');
    } finally {
      setRefiningId(null);
    }
  };

  // Group generations: originals first, refinements below parent
  const originals = generations.filter(g => !g.parent_generation_id);
  const refinementsByParent = new Map<number, SavedGeneration[]>();
  for (const g of generations) {
    if (g.parent_generation_id) {
      const list = refinementsByParent.get(g.parent_generation_id) || [];
      list.push(g);
      refinementsByParent.set(g.parent_generation_id, list);
    }
  }

  const renderGenerationCard = (g: SavedGeneration, isExpanded: boolean, showPrompt: boolean, isRefinement: boolean) => (
    <div
      key={g.id}
      className={`rounded-xl overflow-hidden border border-zinc-700/50 ${
        isRefinement ? 'ml-6 mt-1 border-l-2 border-l-violet-500' : ''
      }`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none bg-zinc-900/60 hover:bg-zinc-800/60 transition-colors"
        onClick={() => toggleExpand(g.id)}
      >
        {isExpanded
          ? <ChevronDown size={14} className="text-zinc-500 shrink-0" />
          : <ChevronRight size={14} className="text-zinc-500 shrink-0" />
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isRefinement && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-600 text-white shrink-0">
                <Sparkles size={10} /> Refined
              </span>
            )}
            <span className="text-sm font-semibold text-zinc-200 truncate">
              {g.title || 'Untitled'}
            </span>
            <span className="text-xs text-zinc-500 shrink-0">
              {g.provider}/{g.model}
            </span>
          </div>
          {g.subject && (
            <div className="text-xs mt-0.5 truncate text-violet-400/80">
              {g.subject}
            </div>
          )}
          {(g.bpm > 0 || g.key || g.caption) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {g.bpm > 0 && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-600/80 text-white">
                  {g.bpm} BPM
                </span>
              )}
              {g.key && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-600/80 text-white">
                  {g.key}
                </span>
              )}
              {g.caption && (
                <span className="text-[10px] italic truncate text-zinc-500" title={g.caption}>
                  {g.caption}
                </span>
              )}
            </div>
          )}
        </div>
        <span className="text-xs text-zinc-500 shrink-0">
          {new Date(g.created_at).toLocaleDateString()}
        </span>
      </div>

      {/* Expanded */}
      {isExpanded && (
        <>
          {/* Action bar */}
          <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900/60 border-t border-zinc-700/40">
            <button
              onClick={(e) => { e.stopPropagation(); handleCopy(g.id, g.lyrics); }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all ${
                copiedId === g.id ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {copiedId === g.id ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
            </button>
            <button
              onClick={async (e) => { e.stopPropagation(); try { await exportGeneration(g.id); } catch {} }}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-500 hover:text-zinc-300 transition-all"
              title="Export as JSON + TXT"
            >
              <Download size={12} /> Export
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleRefine(g.id); }}
              disabled={refiningId !== null}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all ${
                refiningId === g.id ? 'text-violet-400' : 'text-zinc-500 hover:text-zinc-300'
              } ${refiningId !== null && refiningId !== g.id ? 'opacity-40' : ''}`}
              title="Refine lyrics with the refinement LLM"
            >
              {refiningId === g.id
                ? <><Loader2 size={12} className="animate-spin" /> Refining…</>
                : <><Sparkles size={12} /> Refine</>
              }
            </button>
            {(g.system_prompt || g.user_prompt) && (
              <button
                onClick={(e) => { e.stopPropagation(); togglePrompt(g.id); }}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all ${
                  showPrompt ? 'text-violet-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Code size={12} /> {showPrompt ? 'Hide Prompt' : 'See Prompt'}
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (!confirm('Delete this generation?')) return;
                await deleteGeneration(g.id);
                setGenerations(prev => prev.filter(x => x.id !== g.id));
              }}
              className="p-1 rounded text-xs text-red-500 hover:bg-red-900/30 transition-all"
              title="Delete generation"
            >
              <Trash2 size={12} />
            </button>
          </div>

          {/* Prompt viewer */}
          {showPrompt && (
            <div className="px-4 py-3 space-y-3 text-xs bg-zinc-950 border-t border-zinc-700/40"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            >
              {g.system_prompt && (
                <div>
                  <div className="font-bold mb-1 text-violet-400">System Prompt</div>
                  <pre className="whitespace-pre-wrap break-words text-zinc-500">{g.system_prompt}</pre>
                </div>
              )}
              {g.user_prompt && (
                <div>
                  <div className="font-bold mb-1 text-violet-400">User Prompt</div>
                  <pre className="whitespace-pre-wrap break-words text-zinc-500">{g.user_prompt}</pre>
                </div>
              )}
            </div>
          )}

          {/* Lyrics */}
          <div className="lyrics-output px-5 py-4 text-sm bg-zinc-800/40 text-zinc-200">
            {formatLyrics(g.lyrics)}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs mb-2 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={12} /> Back
        </button>
        <h2 className="text-xl font-bold text-white">
          Generate Lyrics
        </h2>
        <p className="text-xs mt-1 text-zinc-500">
          In the style of {artistName}
          {profile && ` · ${profile.provider}/${profile.model} profile`}
        </p>
      </div>

      {/* Generation controls */}
      {canGenerate && (
        <div className="rounded-xl p-4 bg-zinc-800/50 border border-zinc-700/50">
          {/* Profile picker (only in "Based on" mode) */}
          {!profileId && availableProfiles.length > 0 && (
            <div className="mb-3">
              <label className="text-xs font-medium mb-1.5 block text-zinc-500">
                Profile
              </label>
              <select
                value={selectedProfileId || ''}
                onChange={e => setSelectedProfileId(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg text-sm bg-zinc-900 border border-zinc-700 text-zinc-200 outline-none focus:border-violet-500 transition-colors"
              >
                {availableProfiles.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.provider}/{p.model} — {new Date(p.created_at).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!profileId && availableProfiles.length === 0 && (
            <div className="px-4 py-3 rounded-lg text-sm mb-3 bg-blue-950/40 border border-blue-800/40 text-blue-300">
              No profiles built yet. Go to the album view and build a profile first.
            </div>
          )}

          <p className="text-xs mb-3 text-zinc-500">
            Uses the provider/model from Lyric Studio Settings. Each generation gets a unique subject, key, and tempo.
          </p>

          <textarea
            value={extraInstructions}
            onChange={e => setExtraInstructions(e.target.value)}
            placeholder="Optional: e.g. Make it upbeat and about a road trip"
            rows={2}
            className="w-full px-4 py-2.5 rounded-lg text-sm resize-none mb-3 bg-zinc-900 border border-zinc-700 text-zinc-200 placeholder-zinc-600 outline-none focus:border-violet-500 transition-colors"
          />

          {/* Batch count */}
          {!profileId && (
            <div className="flex items-center gap-3 mb-3">
              <label className="text-xs font-medium text-zinc-500">How many</label>
              <input
                type="number"
                value={batchCount}
                onChange={e => setBatchCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                min={1}
                max={20}
                className="w-16 px-2 py-1.5 rounded-lg text-sm text-center bg-zinc-900 border border-zinc-700 text-zinc-200 outline-none focus:border-violet-500 transition-colors"
              />
              <span className="text-xs text-zinc-500">(max 20)</span>
            </div>
          )}

          {error && (
            <div className="px-4 py-3 rounded-lg text-sm mb-3 bg-red-950/50 border border-red-900/50 text-red-300">
              {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating || (!profileId && !selectedProfileId)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-50 bg-violet-600 hover:bg-violet-500 text-white"
          >
            {generating
              ? <><Loader2 size={16} className="animate-spin" /> {generatingProgress || 'Generating…'}</>
              : (!profileId && batchCount > 1)
                ? `Generate ${batchCount} New Lyrics`
                : 'Generate New Lyrics'
            }
          </button>
        </div>
      )}

      {/* LLM Streaming Output */}
      <StreamingPanel
        visible={generating || (streamDone && streamText.length > 0)}
        streamText={streamText}
        phase={streamPhase}
        done={streamDone}
        onSkipThinking={generating ? () => skipThinking() : undefined}
      />

      {/* Generated lyrics */}
      {originals.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200">
              Generated Lyrics ({originals.length})
            </h3>
            <button
              onClick={async () => {
                setExporting(true);
                setExportResult('');
                try {
                  const result = await exportAllGenerations();
                  setExportResult(
                    `Exported ${result.exported} tracks${result.backfilled ? `, backfilled ${result.backfilled}` : ''}${result.errors ? `, ${result.errors} errors` : ''}`
                  );
                  setTimeout(() => setExportResult(''), 5000);
                } catch { setExportResult('Export failed'); }
                finally { setExporting(false); }
              }}
              disabled={exporting}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all"
            >
              <Download size={12} /> {exporting ? 'Exporting…' : 'Export All'}
            </button>
          </div>
          {exportResult && (
            <div className="text-xs px-3 py-2 rounded-lg bg-zinc-800 text-violet-400">
              {exportResult}
            </div>
          )}
          {originals.map(g => {
            const isExpanded = expandedIds.has(g.id);
            const showPrompt = promptIds.has(g.id);
            const refinements = refinementsByParent.get(g.id) || [];
            return (
              <div key={g.id}>
                {renderGenerationCard(g, isExpanded, showPrompt, false)}
                {refinements.map(r => {
                  const rExpanded = expandedIds.has(r.id);
                  const rShowPrompt = promptIds.has(r.id);
                  return renderGenerationCard(r, rExpanded, rShowPrompt, true);
                })}
                {refiningId === g.id && (
                  <div className="ml-6 border-l-2 border-violet-500 pl-3">
                    <StreamingPanel
                      visible={true}
                      streamText={refineStreamText}
                      phase="Refining…"
                      done={false}
                    />
                  </div>
                )}
                {refineError && !refiningId && (
                  <div className="ml-6 px-4 py-2 rounded-lg text-xs mt-1 bg-red-950/50 border border-red-900/50 text-red-300">
                    Refinement failed: {refineError}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

function formatLyrics(raw: string): React.ReactNode[] {
  return raw.split('\n').map((line, i) => {
    const isHeader = /^\[.+\]$/.test(line.trim());
    if (isHeader) {
      return (
        <div key={i} className="mt-6 mb-1 text-xs font-semibold uppercase tracking-widest text-violet-400">
          {line.trim().replace(/^\[|\]$/g, '')}
        </div>
      );
    }
    if (line.trim() === '') return <div key={i} className="h-3" />;
    return <div key={i}>{line}</div>;
  });
}
