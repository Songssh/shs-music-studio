// ModelSelector.tsx — Model selection dropdowns + adapter group scale controls
//
// Shows available DiT and LM models from ace-server /props.
// When an adapter is selected, reveals per-group scale sliders for
// fine-grained control over which parts of the adapter affect generation.

import React, { useEffect, useState } from 'react';
import { modelApi } from '../../services/api';
import type { AceModels } from '../../types';

interface AdapterGroupScales {
  self_attn: number;
  cross_attn: number;
  mlp: number;
  cond_embed: number;
}

interface ModelSelectorProps {
  ditModel: string;
  onDitModelChange: (v: string) => void;
  lmModel: string;
  onLmModelChange: (v: string) => void;
  adapter: string;
  onAdapterChange: (v: string) => void;
  adapterScale: number;
  onAdapterScaleChange: (v: number) => void;
  adapterGroupScales: AdapterGroupScales;
  onAdapterGroupScalesChange: (v: AdapterGroupScales) => void;
}

const GROUP_INFO = [
  { key: 'self_attn' as const,  label: 'Self-Attn',     help: 'How audio frames relate to each other over time' },
  { key: 'cross_attn' as const, label: 'Cross-Attn',    help: 'How strongly your text prompt shapes the output' },
  { key: 'mlp' as const,        label: 'MLP',           help: 'Timbre, tonal texture, and sonic character' },
  { key: 'cond_embed' as const, label: 'Conditioning',  help: 'How the adapter reshapes text/style interpretation' },
];

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  ditModel, onDitModelChange, lmModel, onLmModelChange,
  adapter, onAdapterChange, adapterScale, onAdapterScaleChange,
  adapterGroupScales, onAdapterGroupScalesChange,
}) => {
  const [models, setModels] = useState<AceModels | null>(null);
  const [showGroupScales, setShowGroupScales] = useState(false);

  useEffect(() => {
    modelApi.list()
      .then(setModels)
      .catch(() => {}); // Will show fallback
  }, []);

  const ditModels = models?.models?.dit || [];
  const lmModels = models?.models?.lm || [];
  const adapters = models?.adapters || [];

  const handleGroupScaleChange = (key: keyof AdapterGroupScales, value: number) => {
    onAdapterGroupScalesChange({ ...adapterGroupScales, [key]: value });
  };

  const allDefault = GROUP_INFO.every(g => adapterGroupScales[g.key] === 1.0);

  return (
    <div className="create-section model-selector">
      {/* DiT Model */}
      <div>
        <label className="label">DiT Model</label>
        <select className="input select" value={ditModel}
          onChange={e => onDitModelChange(e.target.value)}>
          {ditModels.length === 0 && <option value="">Loading...</option>}
          {ditModels.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {/* LM Model */}
      <div>
        <label className="label">LM Model</label>
        <select className="input select" value={lmModel}
          onChange={e => onLmModelChange(e.target.value)}>
          {lmModels.length === 0 && <option value="">Loading...</option>}
          {lmModels.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {/* Adapter */}
      {adapters.length > 0 && (
        <>
          <div>
            <label className="label">Adapter (LoRA)</label>
            <select className="input select" value={adapter}
              onChange={e => onAdapterChange(e.target.value)}>
              <option value="">None</option>
              {adapters.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          {adapter && (
            <>
              <div>
                <label className="label">Adapter Scale</label>
                <input type="range" value={adapterScale}
                  onChange={e => onAdapterScaleChange(parseFloat(e.target.value))}
                  min={0} max={2} step={0.05} />
                <span className="slider-value" style={{ float: 'right' }}>{adapterScale.toFixed(2)}</span>
              </div>

              {/* Group Scales Toggle */}
              <div className="adapter-group-toggle" style={{ marginTop: '4px' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setShowGroupScales(!showGroupScales)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    fontSize: '0.8rem', opacity: 0.8, padding: '4px 8px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-secondary, #aaa)',
                  }}
                >
                  <span style={{
                    transition: 'transform 0.2s',
                    transform: showGroupScales ? 'rotate(90deg)' : 'rotate(0deg)',
                    display: 'inline-block',
                  }}>▶</span>
                  Group Scales
                  {!allDefault && (
                    <span style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      background: 'var(--accent, #7c5cff)', display: 'inline-block',
                    }} title="Group scales modified" />
                  )}
                </button>
              </div>

              {/* Group Scale Sliders */}
              {showGroupScales && (
                <div className="adapter-group-scales" style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: 'var(--surface-2, rgba(255,255,255,0.03))',
                  border: '1px solid var(--border, rgba(255,255,255,0.08))',
                  marginTop: '4px',
                }}>
                  {GROUP_INFO.map(({ key, label, help }) => (
                    <div key={key} style={{ marginBottom: key === 'cond_embed' ? 0 : '8px' }}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', marginBottom: '2px',
                      }}>
                        <label className="label" style={{
                          fontSize: '0.75rem', margin: 0,
                          color: 'var(--text-secondary, #aaa)',
                        }} title={help}>{label}</label>
                        <span className="slider-value" style={{
                          fontSize: '0.75rem', minWidth: '36px', textAlign: 'right',
                          color: adapterGroupScales[key] === 1.0
                            ? 'var(--text-muted, #666)'
                            : 'var(--accent, #7c5cff)',
                        }}>{adapterGroupScales[key].toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        value={adapterGroupScales[key]}
                        onChange={e => handleGroupScaleChange(key, parseFloat(e.target.value))}
                        min={0} max={4} step={0.05}
                        style={{ width: '100%' }}
                      />
                    </div>
                  ))}
                  <div style={{
                    textAlign: 'center', marginTop: '6px',
                    fontSize: '0.65rem', opacity: 0.5,
                    color: 'var(--text-muted, #666)',
                  }}>
                    Scale changes apply on next generation (DiT reload)
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
