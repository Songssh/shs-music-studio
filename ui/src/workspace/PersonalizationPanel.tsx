import { useWindowRegistry } from './useWindowRegistry';
import { useEffect, useState } from 'react';
import { BackgroundLayer, defaultBackground, usePersonalization } from './Personalization';
import { ImagePicker, CoverCrop, type LibraryImage } from './ImageLibrary';
import { WorkspaceDialog } from './WorkspaceDialog';
import { accountRequest } from '../auth/accountApi';
import { useWorkspace } from './WorkspaceContext';

export function PersonalizationPanel({theme,onTheme}:{theme:'light'|'dark';onTheme:(theme:'light'|'dark')=>void}) {
  const {prefs,save,ready,error}=usePersonalization();const ws=useWorkspace();const windows=useWindowRegistry();
  const [value,setValue]=useState(prefs.background),[picker,setPicker]=useState(false),[image,setImage]=useState<LibraryImage|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>setValue(prefs.background),[prefs.background]);
  async function commit(){setBusy(true);try{await save({background:value});setMessage('배경 설정을 저장했습니다.');}catch{/* provider shows error */}finally{setBusy(false);}}
  async function pins(next:string[]){try{await save({pinned:next});}catch{/* provider shows error */}}
  const toggle=(id:string)=>void pins(prefs.pinned.includes(id)?prefs.pinned.filter(x=>x!==id):[...prefs.pinned,id]);
  return <div className="ws-form ws-personalization"><h2>나의 작업 공간</h2><p className="ws-hint">배경과 고정 도구는 같은 계정의 Windows 기기에서 함께 사용합니다.</p><div className="ws-background-preview"><BackgroundLayer value={value} preview/><div className="ws-preview-window"><span>미리보기</span><p>창과 텍스트는 선명하게 유지됩니다.</p></div></div>
    <div className="ws-segment"><button aria-pressed={value.mode==='default'} onClick={()=>setValue({...defaultBackground})}>기본 배경</button><button aria-pressed={value.mode==='solid'} onClick={()=>setValue({...value,mode:'solid',imageId:null})}>단색</button><button aria-pressed={value.mode==='image'} onClick={()=>setPicker(true)}>내 이미지 선택 / 업로드</button></div>
    <label>배경색<input type="color" value={value.color} onChange={e=>setValue({...value,color:e.target.value})}/></label>
    {value.mode==='image'&&<><label>표시 방식<select value={value.fit} onChange={e=>setValue({...value,fit:e.target.value as typeof value.fit})}><option value="cover">채우기</option><option value="contain">맞춤</option><option value="center">가운데 배치</option></select></label>
      {(['x','y','dim','blur'] as const).map(key=><label key={key}>{({x:'가로 초점',y:'세로 초점',dim:'어둡기',blur:'흐림'})[key]}<input aria-label={`배경 ${key}`} type="range" min="0" max={key==='dim'?.9:key==='blur'?24:100} step={key==='dim'?.01:1} value={value[key]} onChange={e=>setValue({...value,[key]:Number(e.target.value)})}/></label>)}
      <p className="ws-hint">{image?`${image.width} × ${image.height} · `:''}작은 원본은 큰 화면에서 부드럽게 보일 수 있습니다. 적용 후 실제 작업 공간에서 확인하세요.</p></>}
    <button className="ws-primary" disabled={!ready||busy} onClick={()=>void commit()}>{busy?'저장 중…':'배경 적용'}</button>
    <h3>테마</h3><div className="ws-segment"><button aria-pressed={theme==='light'} onClick={()=>onTheme('light')}>☀ 밝게</button><button aria-pressed={theme==='dark'} onClick={()=>onTheme('dark')}>☾ 어둡게</button></div>
    <h3>작업표시줄 고정</h3><p className="ws-hint">아이콘을 드래그하거나 아래 화살표로 순서를 바꿀 수 있습니다.</p><div className="ws-pin-list">{prefs.pinned.map((id,index)=>{const item=windows.find(w=>w[0]===id);if(!item)return null;return <div key={id}><span>{item[2]} {item[1]}</span><button disabled={!ready||index===0} aria-label={`${item[1]} 위로`} onClick={()=>{const next=[...prefs.pinned];[next[index-1],next[index]]=[next[index],next[index-1]];void pins(next);}}>↑</button><button disabled={!ready||index===prefs.pinned.length-1} aria-label={`${item[1]} 아래로`} onClick={()=>{const next=[...prefs.pinned];[next[index+1],next[index]]=[next[index],next[index+1]];void pins(next);}}>↓</button><button disabled={!ready} onClick={()=>toggle(id)}>해제</button></div>;})}</div><select aria-label="고정할 도구" value="" disabled={!ready} onChange={e=>toggle(e.target.value)}><option value="">도구 고정…</option>{windows.filter(w=>!prefs.pinned.includes(w[0])).map(w=><option key={w[0]} value={w[0]}>{w[1]}</option>)}</select>
    <h3>이 기기의 창 배치</h3><div className="ws-segment"><button onClick={()=>ws.commands.current?.save()}>현재 배치 저장</button><button onClick={()=>ws.commands.current?.restore()}>저장 배치 불러오기</button><button onClick={()=>ws.commands.current?.reset()}>기본 배치 복원</button></div>{(error||message)&&<p role="status" className={error?'ws-error':'ws-hint'}>{error||message}</p>}
    {picker&&<ImagePicker onClose={()=>setPicker(false)} onSelect={item=>{setImage(item);setValue({...value,mode:'image',imageId:item.id});setPicker(false);}}/>}
  </div>;
}
export function ImageDialogs({theme,onTheme}:{theme:'light'|'dark';onTheme:(theme:'light'|'dark')=>void}) {
  const {eligible}=useWorkspace();const {prefs,save}=usePersonalization();
  const [personalize,setPersonalize]=useState(false),[song,setSong]=useState<string|null>(null),[image,setImage]=useState<LibraryImage|null>(null),[message,setMessage]=useState('');
  useEffect(()=>{
    if(!eligible)return;
    const background=()=>setPersonalize(true);
    const cover=(e:Event)=>{setSong((e as CustomEvent).detail.songId);setImage(null);};
    const fromSong=async(e:Event)=>{try{const data=await accountRequest<{image:LibraryImage}>(`images/from-song/${encodeURIComponent((e as CustomEvent).detail.songId)}`,{});await save({background:{...prefs.background,mode:'image',imageId:data.image.id}});setPersonalize(true);}catch(err){setMessage(err instanceof Error?err.message:'커버를 불러오지 못했습니다.');}};
    window.addEventListener('workspace-personalize',background);window.addEventListener('workspace-image-cover',cover);window.addEventListener('workspace-song-background',fromSong);
    return()=>{window.removeEventListener('workspace-personalize',background);window.removeEventListener('workspace-image-cover',cover);window.removeEventListener('workspace-song-background',fromSong);};
  },[eligible,prefs.background,save]);
  return <>{personalize&&<WorkspaceDialog title="배경 및 개인화" onClose={()=>setPersonalize(false)}><PersonalizationPanel theme={theme} onTheme={onTheme}/></WorkspaceDialog>}{song&&!image&&<ImagePicker onClose={()=>setSong(null)} onSelect={setImage}/>} {song&&image&&<CoverCrop image={image} songId={song} onClose={()=>{setSong(null);setImage(null);}}/>}{message&&<WorkspaceDialog title="이미지 안내" onClose={()=>setMessage('')}><p className="ws-form" role="alert">{message}</p></WorkspaceDialog>}</>;
}
