import type { BackendCapabilities } from '../stores/backendStore';

export const ACE_LM_TEMPERATURE_RANGE = { min: 0, max: 2, step: 0.01 };

/** Do not mutate the stored preference when the current engine has fewer slots. */
export function effectiveCount(value: unknown, maximum?: number): number {
  const count = Number(value);
  const positive = Number.isFinite(count) ? Math.max(1, Math.round(count)) : 1;
  return maximum === undefined ? positive : Math.min(positive, Math.max(1, Math.floor(maximum)));
}

export function batchMaximum(caps?: BackendCapabilities | null): number | undefined {
  const core = caps?.core.batch?.max;
  const extension = caps?.backend === 'yue2'
    ? caps.extensions.find(p => p.key === 'yue2BatchSize')?.max : undefined;
  if (extension === undefined) return core;
  return core === undefined ? extension : Math.min(extension, core);
}

export function variationMaximum(caps?: BackendCapabilities | null): number | undefined {
  return caps?.extensions.find(p => p.key === 'yue2Variations')?.max;
}
