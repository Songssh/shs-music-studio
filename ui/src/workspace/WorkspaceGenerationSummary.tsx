import { useGlobalParams } from '../context/GlobalParamsContext';
import { useBackendStore } from '../stores/backendStore';
import { useWorkspace } from './WorkspaceContext';
export function WorkspaceGenerationSummary() {
  const gp = useGlobalParams(); const ws = useWorkspace();
  const backend = useBackendStore(s => s.backends.find(b => b.id === s.activeBackendId)?.displayName ?? s.activeBackendId);
  if (!ws.enabled) return null;
  return <div className="ws-subtoolbar"><span title={`${backend} · ${gp.ditModel || '모델 선택'} · ${gp.adapter || '어댑터 없음'}`}>{backend} · {gp.ditModel || '모델 선택'} · {gp.adapter || '어댑터 없음'}</span><button onClick={() => ws.commands.current?.open('parameters')}>설정 열기</button></div>;
}
