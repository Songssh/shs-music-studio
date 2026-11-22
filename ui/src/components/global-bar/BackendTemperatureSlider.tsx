import { useTranslation } from 'react-i18next';
import type { BackendExtensionParam } from '../../stores/backendStore';
import { useGlobalParamsStore } from '../../stores/globalParamsStore';
import { Slider } from '../shared/Slider';

/** Both panels edit the same extension. An absent composer override follows the checkpoint. */
export function BackendTemperatureSlider({ param }: { param: BackendExtensionParam }) {
  const { t } = useTranslation();
  const stored: unknown = useGlobalParamsStore(s => s.backendParams?.[param.key]);
  const setParam = useGlobalParamsStore(s => s.setBackendParam);
  const composer = param.key === 'yue2SemTemperature';
  const number = typeof stored === 'number' || (typeof stored === 'string' && stored.trim() !== '')
    ? Number(stored) : undefined;
  const manual = Number.isFinite(number) ? number : undefined;
  const baseline = typeof param.default === 'number' ? param.default : undefined;
  const auto = manual === undefined && (composer || baseline === undefined);
  const value = manual ?? baseline ?? param.min;
  if (param.min === undefined || param.max === undefined || param.step === undefined || value === undefined) return null;
  const autoLabel = t('quickGen.auto', 'Auto');
  return <Slider
    label={composer ? t('quickGen.composerTemperature', 'Composer Temperature') : t('quickGen.lmTemperature', 'LM Temperature')}
    info={param.hint} value={value} min={param.min} max={param.max} step={param.step}
    valueText={auto ? autoLabel : value.toFixed(2)}
    onChange={v => setParam(param.key, v)}
    defaultValue={composer ? undefined : baseline}
    headerRight={composer && !auto && (
      <button type="button" className="rounded px-1 text-xs text-pink-600 dark:text-pink-400 hover:underline"
        title={t('quickGen.useCheckpoint', 'Use the checkpoint temperature')}
        onClick={() => setParam(param.key, undefined)}>{autoLabel}</button>
    )}
  />;
}
