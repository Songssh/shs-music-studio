import { useCallback, useEffect, useRef, useState } from 'react';
import { accountRequest } from '../auth/accountApi';
import { WorkspaceDialog } from './WorkspaceDialog';
import { usePersonalization } from './Personalization';

export type LibraryImage={id:string;name:string;format:string;width:number;height:number;bytes:number;source:string;createdAt:number;thumbnailUrl:string;originalUrl:string;screenUrl:string;usages:{songs:{id:string;title:string}[];playlists:{id:string;name:string}[];background:boolean}};
export type Crop={x:number;y:number;zoom:number};
const sourceName:Record<string,string>={upload:'업로드',generated:'AI 커버',legacy:'기존 커버'};
const errorText=(err:unknown)=>err instanceof Error?err.message:'요청을 처리하지 못했습니다.';
export async function uploadImage(file:File) {
  const data=new FormData();data.append('image',file);
  const response=await fetch('/api/images',{method:'POST',body:data,credentials:'same-origin'});
  const value=await response.json();if(!response.ok)throw new Error(value.error);return value.image as LibraryImage;
}
export function ImageBrowser({onSelect,selected}:{onSelect:(image:LibraryImage)=>void;selected?:string}) {
  const [images,setImages]=useState<LibraryImage[]>([]),[query,setQuery]=useState(''),[sort,setSort]=useState('newest'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null);
  const reload=useCallback(async()=>{try{const data=await accountRequest<{images:LibraryImage[]}>('images');setImages(data.images);setError('');}catch(e){setError(errorText(e));}},[]);
  useEffect(()=>{void reload();window.addEventListener('workspace-images-changed',reload);window.addEventListener('cover-art-updated',reload);return()=>{window.removeEventListener('workspace-images-changed',reload);window.removeEventListener('cover-art-updated',reload);};},[reload]);
  async function upload(files:FileList|null){if(!files?.length)return;setBusy(true);setError('');try{let image:LibraryImage|undefined;for(const file of Array.from(files))image=await uploadImage(file);await reload();if(image)onSelect(image);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  const visible=images.filter(i=>i.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='oldest'?a.createdAt-b.createdAt:b.createdAt-a.createdAt);
  return <section className="ws-image-browser" aria-label="내 이미지 선택" onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}}} onDrop={e=>{e.preventDefault();if(!busy)void upload(e.dataTransfer.files);}}>
    <div className="ws-image-toolbar"><input aria-label="이미지 이름 검색" placeholder="이미지 이름 검색" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="이미지 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">최신순</option><option value="oldest">오래된순</option><option value="name">이름순</option></select><button className="ws-primary" disabled={busy} onClick={()=>input.current?.click()}>{busy?'업로드 중…':'＋ 업로드'}</button><input hidden ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{void upload(e.currentTarget.files);e.currentTarget.value='';}}/></div>
    <p className="ws-hint">JPEG · PNG · WebP / 최대 20 MB · 파일을 이곳에 놓아 업로드</p>
    {error&&<p className="ws-error" role="alert">{error}</p>}
    <div className="ws-image-grid">{visible.map(image=><button className={`ws-image-card ${selected===image.id?'selected':''}`} key={image.id} aria-pressed={selected===image.id} onClick={()=>onSelect(image)}><img src={image.thumbnailUrl} alt={image.name} loading="lazy"/><strong>{image.name}</strong><small>{image.width} × {image.height} · {sourceName[image.source]}</small>{(image.usages.background||image.usages.songs.length>0)&&<span className="ws-image-usage">{image.usages.background?'바탕화면 ':''}{image.usages.songs.length?`커버 ${image.usages.songs.length}`:''}</span>}</button>)}</div>
    {!visible.length&&!busy&&!error&&<div className="ws-image-empty"><span>▧</span><h3>{images.length?'검색 결과가 없습니다':'이미지로 작업 공간을 꾸며 보세요'}</h3><p>한 장의 원본을 여러 곡의 커버와 바탕화면에 사용할 수 있습니다.</p></div>}
  </section>;
}
export function ImagePicker({onSelect,onClose}:{onSelect:(image:LibraryImage)=>void;onClose:()=>void}) {
  return <WorkspaceDialog title="내 이미지에서 선택" wide onClose={onClose}><ImageBrowser onSelect={onSelect}/></WorkspaceDialog>;
}
export function CoverCrop({image,songId,onClose,onApplied}:{image:LibraryImage;songId?:string;onClose:()=>void;onApplied?:(url:string)=>void}) {
  const [crop,setCrop]=useState<Crop>({x:.5,y:.5,zoom:1}),[songs,setSongs]=useState<{id:string;title:string}[]>([]),[target,setTarget]=useState(songId??''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(!songId)void accountRequest<{songs:{id:string;title:string}[]}>('songs').then(data=>setSongs(data.songs)).catch(e=>setError(errorText(e)));},[songId]);
  const size=Math.min(image.width,image.height)/crop.zoom;
  async function apply(){setBusy(true);try{const result=await accountRequest<{coverUrl:string}>(`images/${image.id}/cover`,{songId:target,crop},'PUT');window.dispatchEvent(new CustomEvent('cover-art-updated',{detail:{songId:target,coverUrl:result.coverUrl}}));window.dispatchEvent(new Event('workspace-images-changed'));onApplied?.(result.coverUrl);onClose();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  return <WorkspaceDialog title="곡 커버 크롭" onClose={onClose}><div className="ws-form"><p className="ws-hint">정사각형 미리보기 · 원본과 바탕화면은 유지됩니다.</p><div className="ws-crop-preview"><img src={image.screenUrl} alt="선택한 커버 크롭 미리보기" style={{width:`${image.width/size*100}%`,height:`${image.height/size*100}%`,maxWidth:'none',left:`${-(image.width/size-1)*crop.x*100}%`,top:`${-(image.height/size-1)*crop.y*100}%`}}/></div>
    {(['x','y','zoom'] as const).map(key=><label key={key}>{key==='x'?'가로 위치':key==='y'?'세로 위치':'확대'}<input aria-label={`커버 ${key}`} type="range" min={key==='zoom'?1:0} max={key==='zoom'?4:1} step="0.01" value={crop[key]} onChange={e=>setCrop({...crop,[key]:Number(e.target.value)})}/></label>)}
    {!songId&&<label>적용할 곡<select value={target} onChange={e=>setTarget(e.target.value)}><option value="">곡 선택</option>{songs.map(song=><option key={song.id} value={song.id}>{song.title}</option>)}</select></label>}
    {error&&<p className="ws-error" role="alert">{error}</p>}<button className="ws-primary" disabled={!target||busy} onClick={()=>void apply()}>{busy?'저장 중…':'커버 적용'}</button></div></WorkspaceDialog>;
}
export function ImageLibrary() {
  const [selected,setSelected]=useState<LibraryImage|null>(null),[name,setName]=useState(''),[preview,setPreview]=useState(false),[crop,setCrop]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
  const {prefs,save}=usePersonalization();
  async function run(fn:()=>Promise<unknown>){setError('');try{await fn();window.dispatchEvent(new Event('workspace-images-changed'));}catch(e){setError(errorText(e));}}
  const choose=(image:LibraryImage)=>{setSelected(image);setName(image.name);setConfirm(false);setError('');};
  const refresh=async()=>{const data=await accountRequest<{images:LibraryImage[]}>('images');if(selected){const item=data.images.find(i=>i.id===selected.id);if(item)setSelected(item);}};
  return <div className="ws-images"><div className="ws-page-heading"><span>YOUR COLLECTION</span><h1>내 이미지</h1><p>커버부터 바탕화면까지, 하나의 라이브러리.</p></div><div className="ws-images-body"><ImageBrowser onSelect={choose} selected={selected?.id}/>{selected&&<aside className="ws-image-detail"><button className="ws-preview-open" onClick={()=>setPreview(true)}><img src={selected.screenUrl} alt={selected.name}/><span>원본 미리보기 ↗</span></button><label>이미지 이름<input value={name} maxLength={160} onChange={e=>setName(e.target.value)}/></label><button disabled={!name.trim()} onClick={()=>void run(async()=>{await accountRequest(`images/${selected.id}`,{name},'PATCH');await refresh();})}>이름 저장</button><dl><dt>크기 · 비율</dt><dd>{selected.width} × {selected.height} · {(selected.width/selected.height).toFixed(2)}:1</dd><dt>파일 · 출처</dt><dd>{selected.format.toUpperCase()} · {(selected.bytes/1024/1024).toFixed(2)} MB · {sourceName[selected.source]}</dd><dt>사용처</dt><dd>{selected.usages.background?'바탕화면 · ':''}{selected.usages.songs.map(s=>s.title).join(', ')||'곡 연결 없음'}</dd></dl><button className="ws-primary" onClick={()=>setCrop(true)}>곡 커버로 사용</button><button onClick={()=>void run(async()=>{await save({background:{...prefs.background,mode:'image',imageId:selected.id}});await refresh();})}>바탕화면으로 설정</button>
      <button className="ws-danger" onClick={()=>{setConfirm(true);void run(refresh);}}>이미지 삭제…</button>{confirm&&<div className="ws-delete-confirm"><p>사용 중인 이미지는 삭제할 수 없습니다. 곡 커버 또는 배경을 먼저 교체해 주세요.</p><button onClick={()=>void run(async()=>{await accountRequest(`images/${selected.id}`,undefined,'DELETE');setSelected(null);setConfirm(false);})}>원본 삭제 확인</button><button onClick={()=>setConfirm(false)}>취소</button></div>}{error&&<p role="alert" className="ws-error">{error}</p>}</aside>}</div>
    {preview&&selected&&<WorkspaceDialog title="원본 미리보기" wide onClose={()=>setPreview(false)}><img className="ws-original" src={selected.originalUrl} alt={selected.name}/></WorkspaceDialog>}
    {crop&&selected&&<CoverCrop image={selected} onClose={()=>{setCrop(false);void run(refresh);}}/>}
  </div>;
}
