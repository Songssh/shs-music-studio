import { useQuery } from '@tanstack/react-query';
import { useGlobalParams, useGlobalParamsStore } from '../context/GlobalParamsContext';
import { backendModelsOptions } from '../queries/global-models/options';
import { useBackendStore, type BackendModelCatalogue } from '../stores/backendStore';
import { useWorkspace } from './WorkspaceContext';

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

function catalogueSelection(catalogue: BackendModelCatalogue): string[] {
  const defaults = catalogue.defaults ?? {};
  const parts: string[] = [];
  for (const role of Object.keys(catalogue.buckets)) {
    const value = defaults[role];
    if (typeof value === 'string' && value) parts.push(`${role.toUpperCase()} ${fileName(value)}`);
  }
  if (!parts.length) parts.push('선택된 모델 정보 없음');

  if (catalogue.backend === 'yue2') {
    for (const slot of ['Ar', 'Nar']) {
      const path = defaults[`lmAdapter${slot}`];
      if (typeof path !== 'string' || !path) continue;
      const status = defaults[`lmAdapter${slot}InForce`] === true ? '적용 보고됨' : '선택';
      parts.push(`${slot.toUpperCase()} ${fileName(path)} (${status})`);
    }
    if (defaults.lmAdapterAr === '' && defaults.lmAdapterNar === '') parts.push('어댑터 없음');
  }
  return parts;
}

export function WorkspaceGenerationSummary() {
  const ws = useWorkspace();
  const gp = useGlobalParams();
  const mm3Adapter: unknown = useGlobalParamsStore(s => s.backendParams?.mm3LmAdapter);
  const id = useBackendStore(s => s.activeBackendId);
  const name = useBackendStore(s => s.backends.find(b => b.id === id)?.displayName ?? id);
  const capabilities = useBackendStore(s => s.capabilities[id]);
  const hasModelPicker = capabilities?.features.models !== false;
  const models = useQuery({ ...backendModelsOptions(id), enabled: ws.enabled && id !== 'ace' && hasModelPicker });
  if (!ws.enabled) return null;

  const parts = [name];
  if (id === 'ace') {
    parts.push(gp.ditModel ? `DiT ${fileName(gp.ditModel)}` : '모델 선택');
    const adapters = gp.advancedAdapters && gp.adapterStack.length
      ? gp.adapterStack.map(entry => entry.path) : [gp.adapter];
    const ditAdapters = adapters.filter(Boolean).map(fileName);
    if (ditAdapters.length) parts.push(`어댑터 ${ditAdapters.join(' + ')}`);
    if (gp.lmAdapter) parts.push(`LM 어댑터 ${fileName(gp.lmAdapter)}`);
    if (!ditAdapters.length && !gp.lmAdapter) parts.push('어댑터 없음');
  } else if (!hasModelPicker) {
    parts.push('개별 모델 선택 미지원');
  } else if (models.isError) {
    parts.push('모델 정보 확인 불가');
  } else if (models.data?.backend === id) {
    parts.push(...catalogueSelection(models.data));
    if (id === 'minimax-m3' && typeof mm3Adapter === 'string' && mm3Adapter) {
      parts.push(`LM 어댑터 ${fileName(mm3Adapter)}`);
    }
    if (models.isFetching) parts.push('모델 정보 갱신 중');
  } else {
    parts.push(models.isPending ? '모델 정보 불러오는 중' : '모델 정보 확인 불가');
  }
  if (capabilities?.core.modelsMissing) parts.push('모델 파일 없음');
  const summary = parts.join(' · ');
  return (
    <div className="ws-subtoolbar">
      <span title={summary}>{summary}</span>
      <button onClick={() => ws.commands.current?.open('parameters')}>설정 열기</button>
    </div>
  );
}
