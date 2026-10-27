import i18n from '../i18n';
import { userStorage } from '../auth/userStorage';
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { queryClient } from '../queries/client';
import { getSessionEpoch, startAuthSession } from '../queries/keys';
import { setAuthToken, setOnUnauthorized } from '../services/axiosClient';
import { accountRequest, type AccountUser } from '../auth/accountApi';
import { bindUserStorage } from '../auth/userStorage';
import type { User } from '../types';

interface AuthContextValue {
  user: User | null; token: string | null; sessionEpoch:number; isAuthenticated:boolean; isLoading:boolean;
  updateUsername:(name:string)=>Promise<void>; refresh:()=>Promise<void>; logout:()=>Promise<void>;
}
const AuthContext=createContext<AuthContextValue>({user:null,token:null,sessionEpoch:0,isAuthenticated:false,isLoading:true,updateUsername:async()=>{},refresh:async()=>{},logout:async()=>{}});
export const useAuth=()=>useContext(AuthContext);
let channel:BroadcastChannel|null=null;
let transportInstalled=false;
let expectedOwner:string|null=null;
// A tab still showing A must never process B's data after a cookie change in another tab.
function installTransport(){
 if(transportInstalled)return;
 transportInstalled=true;
 channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('hotstep-account-session'):null;
 const originalFetch=window.fetch.bind(window);
 window.fetch=(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href);
  if(expectedOwner && url.origin===location.origin && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {
    const headers=new Headers(init?.headers ?? (input instanceof Request?input.headers:undefined));
    headers.set('X-Hotstep-User',expectedOwner);
    return originalFetch(input,{...init,headers});
  }
  return originalFetch(input,init);
 };
}
export const AuthProvider:React.FC<{children:React.ReactNode}>=({children})=>{
  const [user,setUser]=useState<User|null>(null),[isLoading,setLoading]=useState(true);
  const [sessionEpoch,setEpoch]=useState(getSessionEpoch);const loadedOwner=useRef<string|null>(null);
  const refresh=useCallback(async()=>{
    try{
      const result=await accountRequest<{user:AccountUser;legacyOwner:boolean}>('account/me');
      if(loadedOwner.current && loadedOwner.current!==result.user.id){location.reload();return;}
      bindUserStorage(result.user.id,result.legacyOwner);expectedOwner=result.user.id;
      const language=userStorage.getItem('i18nextLng');if(language)await i18n.changeLanguage(language);
      loadedOwner.current=result.user.id;setAuthToken(result.user.id);
      setEpoch(startAuthSession(queryClient,result.user.id));setUser(result.user as User);
    }catch(err){
      if(loadedOwner.current){location.reload();return;}
      if((err as {status?:number}).status!==401)throw err;
      setUser(null);setAuthToken(null);
    }finally{setLoading(false);}
  },[]);
  useEffect(()=>{
    installTransport();
    void refresh().catch(()=>{});
    const reset=()=>{queryClient.clear();document.querySelectorAll('audio,video').forEach(el=>{const m=el as HTMLMediaElement;m.pause();m.removeAttribute('src');m.load();});location.reload();};
    setOnUnauthorized(reset);
    const changed=()=>{if(loadedOwner.current)reset();else void refresh().catch(()=>{});};
    channel?.addEventListener('message',changed);
    const focused=()=>{if(loadedOwner.current)void refresh().catch(()=>{});};window.addEventListener('focus',focused);
    return()=>{setOnUnauthorized(null);channel?.removeEventListener('message',changed);window.removeEventListener('focus',focused);};
  },[refresh]);
  const logout=async()=>{await accountRequest('auth/sign-out',{});channel?.postMessage('changed');queryClient.clear();location.reload();};
  const updateUsername=async(name:string)=>{await accountRequest('account/profile',{name},'PATCH');await refresh();};
  return <AuthContext.Provider value={{user,token:user?.id??null,sessionEpoch,isAuthenticated:!!user,isLoading,updateUsername,refresh,logout}}>{children}</AuthContext.Provider>;
};
export function announceAccountChange(){channel?.postMessage('changed');}
