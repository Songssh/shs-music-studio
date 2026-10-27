import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { accountRequest } from '../auth/accountApi';
import { AccountMenu } from '../auth/AccountMenu';
import { PersonalizationPanel } from './PersonalizationPanel';
import { useWorkspace } from './WorkspaceContext';
type Overview={generated:number;recentGenerated:number;ownedSongs:number;playlists:number;images:number;basis:string;recent:{id:string;title:string;createdAt:string}[]};
export function AccountHub({theme,onTheme}:{theme:'light'|'dark';onTheme:(theme:'light'|'dark')=>void}) {
  const {user}=useAuth();const ws=useWorkspace();const [tab,setTab]=useState('overview'),[data,setData]=useState<Overview|null>(null),[error,setError]=useState('');
  useEffect(()=>{if(tab!=='overview')return;let alive=true;void accountRequest<Overview>('desktop/overview').then(result=>{if(alive)setData(result);}).catch(()=>{if(alive)setError('통계를 불러오지 못했습니다.');});return()=>{alive=false;};},[tab]);
  const tabs=[['overview','개요'],['profile','프로필'],['personalization','개인화'],['security','보안'],['connections','연결'],...(user?.role==='admin'?[['admin','관리자']]:[])];
  return <div className="ws-account-hub"><div className="ws-page-heading"><span>PERSONAL HUB</span><h1>내 계정</h1><p>음악과 이미지, 나만의 작업 공간.</p></div><nav className="ws-account-tabs" aria-label="계정 섹션">{tabs.map(([id,label])=><button key={id} aria-current={id===tab?'page':undefined} onClick={()=>setTab(id)}>{label}</button>)}</nav><div className="ws-account-body">
    {tab==='overview'?<><div className="ws-profile-card"><div className="ws-avatar">{user?.username?.slice(0,1).toUpperCase()}</div><div><h2>{user?.username}</h2><p>{user?.email}</p><small>{user?.role==='admin'?'관리자':'일반 사용자'} · 가입 {user?.created_at?.slice(0,10)??'정보 없음'}</small></div></div>
      {data?<><div className="ws-stats">{[['보유 생성곡',data.generated],['최근 7일 생성곡',data.recentGenerated],['내 플레이리스트',data.playlists],['내 원본 이미지',data.images]].map(([name,value])=><div key={name}><strong>{value}</strong><span>{name}</span></div>)}</div><p className="ws-hint">전체 보유곡 {data.ownedSongs}곡. {data.basis}</p><h3>최근 보유곡</h3><div className="ws-recent">{data.recent.map(song=><button key={song.id} onClick={()=>{window.dispatchEvent(new CustomEvent('hotstep:open-song',{detail:{songId:song.id}}));ws.commands.current?.open('library');ws.commands.current?.open('details');}}><span>♫ {song.title}</span><small>{song.createdAt.slice(0,10)} ↗</small></button>)}{!data.recent.length&&<p className="ws-hint">음악을 생성하면 이곳에서 바로 찾을 수 있습니다.</p>}</div></>:<p role="status">{error||'내 통계를 불러오는 중…'}</p>}
    </>:tab==='personalization'?<PersonalizationPanel theme={theme} onTheme={onTheme}/>:<AccountMenu key={tab} expanded embedded section={tab}/>}
  </div></div>;
}
