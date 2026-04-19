// LyricStudioSettings.tsx — LLM provider/model configuration
// Self-contained settings panel for Lyric Studio

import React, { useState, useEffect } from 'react';
import { Settings, Loader2, Check } from 'lucide-react';
import { getProviders, loadSettings, saveSettings } from '../../services/lireekApi';
import type { ProviderInfo, LireekSettings } from '../../services/lireekApi';

interface LyricStudioSettingsProps {
  onBack: () => void;
}

export const LyricStudioSettings: React.FC<LyricStudioSettingsProps> = ({ onBack }) => {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<LireekSettings>(loadSettings());
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getProviders()
      .then(setProviders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = () => {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const getModelsForProvider = (providerId: string): string[] => {
    return providers.find(p => p.id === providerId)?.models || [];
  };

  const renderProviderSelect = (
    label: string,
    providerKey: keyof LireekSettings,
    modelKey: keyof LireekSettings,
  ) => (
    <div className="rounded-xl p-4 bg-zinc-800/50 border border-zinc-700/50 space-y-3">
      <h4 className="text-sm font-semibold text-zinc-200">{label}</h4>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">Provider</label>
          <select
            value={settings[providerKey]}
            onChange={e => {
              const newProvider = e.target.value;
              setSettings(prev => ({
                ...prev,
                [providerKey]: newProvider,
                [modelKey]: '', // Reset model when provider changes
              }));
            }}
            className="w-full px-3 py-2 rounded-lg text-sm bg-zinc-900 border border-zinc-700 text-zinc-200 outline-none focus:border-violet-500 transition-colors"
          >
            {providers.map(p => (
              <option key={p.id} value={p.id} disabled={!p.available}>
                {p.name} {!p.available ? '(unavailable)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">Model</label>
          <select
            value={settings[modelKey]}
            onChange={e => setSettings(prev => ({ ...prev, [modelKey]: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg text-sm bg-zinc-900 border border-zinc-700 text-zinc-200 outline-none focus:border-violet-500 transition-colors"
          >
            <option value="">Default</option>
            {getModelsForProvider(settings[providerKey]).map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500">
        <Loader2 size={20} className="animate-spin mr-2" />
        Loading providers…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings size={20} className="text-violet-400" />
          Lyric Studio Settings
        </h2>
        <p className="text-xs mt-1 text-zinc-500">
          Configure which LLM providers and models to use for each task.
        </p>
      </div>

      {renderProviderSelect('Generation', 'generationProvider', 'generationModel')}
      {renderProviderSelect('Refinement', 'refinementProvider', 'refinementModel')}
      {renderProviderSelect('Profiling', 'profilingProvider', 'profilingModel')}

      <button
        onClick={handleSave}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-all bg-violet-600 hover:bg-violet-500 text-white"
      >
        {saved
          ? <><Check size={16} /> Saved!</>
          : 'Save Settings'
        }
      </button>
    </div>
  );
};
