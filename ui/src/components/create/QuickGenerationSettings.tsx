import { useTranslation } from 'react-i18next';
import { useCapabilities } from '../../hooks/useCapabilities';
import { useBackendStore } from '../../stores/backendStore';
import { useGlobalParamsStore } from '../../stores/globalParamsStore';
import { ACE_LM_TEMPERATURE_RANGE, batchMaximum, effectiveCount, variationMaximum } from '../../utils/generationLimits';
import { BackendTemperatureSlider } from '../global-bar/BackendTemperatureSlider';
import { Slider } from '../shared/Slider';
import { Toggle } from '../shared/Toggle';

export function QuickGenerationSettings() {
  const { t } = useTranslation();
  const backend = useBackendStore(s => s.activeBackendId);
  const { capabilities, loading } = useCapabilities();
  const yue2 = backend === 'yue2';
  const ace = backend === 'ace';
  const batch = useGlobalParamsStore(s => yue2 ? s.backendParams?.yue2BatchSize : s.batchSize);
  const variations = useGlobalParamsStore(s => s.backendParams?.yue2Variations);
  const randomSeed = useGlobalParamsStore(s => s.randomSeed);
  const skipLm = useGlobalParamsStore(s => s.skipLm);
  const lmTemperature = useGlobalParamsStore(s => s.lmTemperature);
  const setBatchSize = useGlobalParamsStore(s => s.setBatchSize);
  const setBackendParam = useGlobalParamsStore(s => s.setBackendParam);
  const setLmTemperature = useGlobalParamsStore(s => s.setLmTemperature);
  const setRandomSeed = useGlobalParamsStore(s => s.setRandomSeed);

  if (!capabilities || capabilities.backend !== backend) {
    return <div role="status" className="flex items-center gap-2 py-2 text-xs text-zinc-500">
      {loading ? t('quickGen.loading', 'Loading generation settings…') : <>
        {t('quickGen.unavailable', 'Generation settings are unavailable.')}
        <button type="button" className="underline" onClick={() => void useBackendStore.getState().fetchCapabilities(backend)}>
          {t('errorBoundary.retry', 'Try again')}
        </button>
      </>}
    </div>;
  }

  const max = batchMaximum(capabilities);
  const songs = effectiveCount(batch, max);
  const maxVariations = variationMaximum(capabilities);
  const takes = effectiveCount(variations, maxVariations);
  const tempKey = yue2 ? 'yue2SemTemperature' : backend === 'minimax-m3' ? 'mm3LmTemperature' : undefined;
  const temperature = capabilities.extensions.find(p => p.key === tempKey && p.type === 'slider');
  const seedLabel = t('quickGen.randomSeed', 'Random Seed');
  const batchLabel = t('quickGen.songs', 'Songs per generation');

  return (
    <section aria-label={t('quickGen.title', 'Quick generation settings')}
      className="mt-2 space-y-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-zinc-900/50">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{t('quickGen.title', 'Quick generation settings')}</h3>
        {capabilities.core.seed && <Toggle size="sm" label={seedLabel} aria-label={seedLabel}
          info={t('quickGen.seedHint', 'Use a new seed each time. Turn off to use the seed in Parameters.')}
          checked={randomSeed} onChange={setRandomSeed} />}
      </div>
      <div className="grid gap-x-4 gap-y-1 [grid-template-columns:repeat(auto-fit,minmax(min(100%,9rem),1fr))]">
        {max !== undefined && (ace || yue2 || max === 1) && (
          <Slider label={batchLabel} value={songs} min={1} max={max} step={1} disabled={max <= 1}
            info={t('quickGen.batchHint', 'Number of songs in one generation job.')}
            onChange={value => yue2 ? setBackendParam('yue2BatchSize', value) : setBatchSize(value)} />
        )}
        {ace && capabilities.features.lm && (
          <Slider label={t('quickGen.lmTemperature', 'LM Temperature')}
            info={skipLm ? t('lm.disabled') : t('quickGen.lmHint', 'Higher values increase variation in the LM plan.')}
            value={lmTemperature} valueText={Number(lmTemperature).toFixed(2)} {...ACE_LM_TEMPERATURE_RANGE}
            disabled={skipLm} onChange={setLmTemperature} />
        )}
        {temperature && <BackendTemperatureSlider param={temperature} />}
      </div>
      {yue2 && max !== undefined && maxVariations !== undefined && (
        <p className="text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {t('quickGen.expectedTracks', { songs, variations: takes, count: songs * takes })}
        </p>
      )}
    </section>
  );
}
