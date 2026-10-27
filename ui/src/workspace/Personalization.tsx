import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { useAuth } from '../context/AuthContext';
import { accountRequest } from '../auth/accountApi';
import { useWorkspace } from './WorkspaceContext';

export type Background = {mode:'default'|'solid'|'image';imageId:string|null;color:string;fit:'cover'|'contain'|'center';x:number;y:number;dim:number;blur:number};
export type Preferences = {background:Background;pinned:string[];theme:'light'|'dark'|null};
export const defaultBackground:Background={mode:'default',imageId:null,color:'#151925',fit:'cover',x:50,y:50,dim:.25,blur:0};
const initial:Preferences={background:defaultBackground,pinned:['create','library','queue'],theme:null};
const Context=createContext<{prefs:Preferences;ready:boolean;error:string;save:(patch:Partial<Preferences>)=>Promise<void>}>(null!);
export const usePersonalization=()=>useContext(Context);
export function PersonalizationProvider({children}:{children:ReactNode}) {
  const {user}=useAuth();const {eligible}=useWorkspace();
  const [prefs,setPrefs]=useState(initial),[ready,setReady]=useState(false),[error,setError]=useState('');
  const writes=useRef(Promise.resolve()),revision=useRef(0);
  useEffect(()=>{
    if(!user||!eligible)return;let alive=true;
    const read=async()=>{const version=revision.current;try{const result=await accountRequest<Preferences>('desktop/preferences');if(alive&&version===revision.current){setPrefs(result);setReady(true);setError('');}}catch{if(alive)setError('개인화 설정을 불러오지 못했습니다.');}};
    void read();window.addEventListener('focus',read);
    return()=>{alive=false;window.removeEventListener('focus',read);};
  },[user?.id,eligible]);
  const save=useCallback((patch:Partial<Preferences>)=>{
    revision.current++;
    const next=writes.current.catch(()=>{}).then(async()=>{
      try{const value=await accountRequest<Preferences>('desktop/preferences',patch,'PATCH');setPrefs(value);setReady(true);setError('');}
      catch(err){setError(err instanceof Error?err.message:'저장하지 못했습니다.');throw err;}
    });writes.current=next;return next;
  },[]);
  return <Context.Provider value={{prefs,ready,error,save}}>{children}</Context.Provider>;
}
export function BackgroundLayer({value,preview=false}:{value:Background;preview?:boolean}) {
  const style:CSSProperties={backgroundColor:value.color};
  if(value.mode==='image'&&value.imageId)Object.assign(style,{backgroundImage:`url("/api/images/${encodeURIComponent(value.imageId)}/file/screen")`,backgroundSize:value.fit==='center'?'auto':value.fit,backgroundPosition:`${value.x}% ${value.y}%`,filter:`blur(${value.blur}px)`});
  return <div className={`ws-wallpaper ${value.mode==='default'?'ws-wallpaper-default':''} ${preview?'preview':''}`} aria-hidden="true">
    {value.mode!=='default'&&<div className="ws-wallpaper-image" style={style}/>}
    {value.mode==='image'&&<div className="ws-wallpaper-dim" style={{background:`rgba(0,0,0,${value.dim})`}}/>}
  </div>;
}
export const openPersonalization=()=>window.dispatchEvent(new CustomEvent('workspace-personalize'));
export const openImagePickerForSong=(songId:string)=>window.dispatchEvent(new CustomEvent('workspace-image-cover',{detail:{songId}}));
export const useSongAsBackground=(songId:string)=>window.dispatchEvent(new CustomEvent('workspace-song-background',{detail:{songId}}));
