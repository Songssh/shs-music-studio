// GenerationSettings.tsx — DiT + LM inference parameters
// Ported to Tailwind accordion styling matching hot-step-9000.

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Slider } from '../shared/Slider';

const selectClasses = "w-full px-3 py-2 rounded-xl bg-zinc-900 border border-white/10 text-sm text-zinc-200 focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/20 outline-none transition-colors cursor-pointer";
const inputClasses = "w-full px-3 py-2 rounded-xl bg-zinc-900 border border-white/10 text-sm text-zinc-200 focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/20 outline-none transition-colors";

interface GenerationSettingsProps {
  // DiT
  inferenceSteps: number; onInferenceStepsChange: (v: number) => void;
  guidanceScale: number; onGuidanceScaleChange: (v: number) => void;
  shift: number; onShiftChange: (v: number) => void;
  inferMethod: string; onInferMethodChange: (v: string) => void;
  // Seed
  seed: number; onSeedChange: (v: number) => void;
  randomSeed: boolean; onRandomSeedChange: (v: boolean) => void;
  // Batch
  batchSize: number; onBatchSizeChange: (v: number) => void;
  // LM
  skipLm: boolean; onSkipLmChange: (v: boolean) => void;
  lmTemperature: number; onLmTemperatureChange: (v: number) => void;
  lmCfgScale: number; onLmCfgScaleChange: (v: number) => void;
  lmTopK: number; onLmTopKChange: (v: number) => void;
  lmTopP: number; onLmTopPChange: (v: number) => void;
  lmNegativePrompt: string; onLmNegativePromptChange: (v: string) => void;
  useCotCaption: boolean; onUseCotCaptionChange: (v: boolean) => void;
}

export const GenerationSettings: React.FC<GenerationSettingsProps> = (props) => {
  const [ditOpen, setDitOpen] = useState(false);
  const [lmOpen, setLmOpen] = useState(false);

  return (
    <div className="space-y-1 pt-3 border-t border-white/5">
      {/* DiT Settings Accordion */}
      <button
        onClick={() => setDitOpen(!ditOpen)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors"
      >
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Generation Settings</span>
        <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-200 ${ditOpen ? 'rotate-180' : ''}`} />
      </button>

      {ditOpen && (
        <div className="px-3 pb-3 space-y-3">
          <Slider label="Inference Steps" value={props.inferenceSteps}
            onChange={props.onInferenceStepsChange} min={1} max={100} step={1} showInput />

          <Slider label="Guidance Scale" value={props.guidanceScale}
            onChange={props.onGuidanceScaleChange} min={0} max={20} step={0.1} showInput />

          <Slider label="Shift" value={props.shift}
            onChange={props.onShiftChange} min={0} max={10} step={0.1} showInput />

          {/* Solver */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5">Solver</label>
            <select className={selectClasses} value={props.inferMethod}
              onChange={e => props.onInferMethodChange(e.target.value)}>
              <option value="ode">ODE (Euler)</option>
              <option value="rk4">RK4 (4th Order)</option>
              <option value="sde">SDE (Stochastic)</option>
            </select>
          </div>

          {/* Seed */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Seed</label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={props.randomSeed}
                  onChange={e => props.onRandomSeedChange(e.target.checked)}
                  className="rounded border-zinc-600 bg-zinc-800 text-pink-500 focus:ring-pink-500/20" />
                <span className="text-xs text-zinc-500">Random</span>
              </label>
            </div>
            {!props.randomSeed && (
              <input type="number" className={inputClasses} value={props.seed}
                onChange={e => props.onSeedChange(parseInt(e.target.value) || -1)} />
            )}
          </div>

          {/* Batch */}
          <Slider label="Batch Size" value={props.batchSize}
            onChange={props.onBatchSizeChange} min={1} max={9} step={1} />
        </div>
      )}

      {/* LM Settings Accordion */}
      <button
        onClick={() => setLmOpen(!lmOpen)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">LM / Thinking</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            props.skipLm ? 'bg-zinc-700 text-zinc-400' : 'bg-purple-500/20 text-purple-400'
          }`}>
            {props.skipLm ? 'OFF' : 'ON'}
          </span>
        </div>
        <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-200 ${lmOpen ? 'rotate-180' : ''}`} />
      </button>

      {lmOpen && (
        <div className="px-3 pb-3 space-y-3">
          {/* LM Toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={!props.skipLm}
              onChange={e => props.onSkipLmChange(!e.target.checked)}
              className="rounded border-zinc-600 bg-zinc-800 text-pink-500 focus:ring-pink-500/20" />
            <span className="text-sm text-zinc-400">Enable LM Conditioning</span>
          </label>

          {!props.skipLm && (
            <>
              {/* CoT Caption */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={props.useCotCaption}
                  onChange={e => props.onUseCotCaptionChange(e.target.checked)}
                  className="rounded border-zinc-600 bg-zinc-800 text-pink-500 focus:ring-pink-500/20" />
                <span className="text-sm text-zinc-400">Chain-of-Thought Caption</span>
              </label>

              <Slider label="Temperature" value={props.lmTemperature}
                onChange={props.onLmTemperatureChange} min={0} max={2} step={0.01} showInput />

              <Slider label="CFG Scale" value={props.lmCfgScale}
                onChange={props.onLmCfgScaleChange} min={0} max={10} step={0.1} showInput />

              <Slider label="Top-K" value={props.lmTopK}
                onChange={props.onLmTopKChange} min={0} max={200} step={1} showInput />

              <Slider label="Top-P" value={props.lmTopP}
                onChange={props.onLmTopPChange} min={0} max={1} step={0.01} showInput />

              <div>
                <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5">Negative Prompt</label>
                <input className={inputClasses} value={props.lmNegativePrompt}
                  onChange={e => props.onLmNegativePromptChange(e.target.value)}
                  placeholder="NO USER INPUT" />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
