import { useWindowRegistry } from './useWindowRegistry';
import { useLayoutEffect, useRef, useState } from 'react';
import { WorkspaceDialog } from './WorkspaceDialog';
import { type WindowId } from './registry';
import { usePersonalization, openPersonalization } from './Personalization';
import { useWorkspace } from './WorkspaceContext';
import { BackendToggle } from '../components/global-bar/BackendToggle';

export function AppLauncher({open,onClose}:{open:(id:WindowId)=>void;onClose:()=>void}) {
  const registry=useWindowRegistry(),{prefs,ready,save,error}=usePersonalization(),ws=useWorkspace();const [query,setQuery]=useState('');
  const matches=registry.filter(w=>`${w[0]} ${w[1]} ${w[3]} ${w[4]}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const categories=[...new Set(matches.map(w=>w[3]))];
  const act=(fn:()=>void)=>{onClose();fn();};
  return <WorkspaceDialog title="앱 실행기" wide onClose={onClose}><div className="ws-launcher"><div className="ws-launcher-top"><input autoFocus aria-label="앱 검색" placeholder="도구 검색 · 이름 또는 English name" value={query} onChange={e=>setQuery(e.target.value)}/><div className="ws-launcher-engine"><BackendToggle/></div></div>{categories.map(category=><section key={category}><h3>{category}</h3><div className="ws-app-grid">{matches.filter(w=>w[3]===category).map(([id,title,icon,,description])=><div className="ws-app" key={id}><button className="ws-app-open" onClick={()=>act(()=>open(id))}><i>{icon}</i><span><strong>{title}</strong><small>{description}</small></span></button><button className="ws-pin" disabled={!ready} aria-label={`${title} ${prefs.pinned.includes(id)?'고정 해제':'고정'}`} aria-pressed={prefs.pinned.includes(id)} title={prefs.pinned.includes(id)?'고정 해제':'작업표시줄에 고정'} onClick={()=>void save({pinned:prefs.pinned.includes(id)?prefs.pinned.filter(x=>x!==id):[...prefs.pinned,id]}).catch(()=>{})}>{prefs.pinned.includes(id)?'◆':'◇'}</button></div>)}</div></section>)}{!matches.length&&<p className="ws-hint">검색된 도구가 없습니다.</p>}
    <footer><button onClick={()=>act(()=>ws.commands.current?.save())}>배치 저장</button><button onClick={()=>act(()=>ws.commands.current?.restore())}>저장 배치 불러오기</button><button onClick={()=>act(()=>ws.commands.current?.reset())}>기본 배치 복원</button><button onClick={()=>act(openPersonalization)}>개인화</button><button onClick={()=>act(()=>ws.setEnabled(false))}>기존 UI로 전환</button></footer>{error&&<p role="alert" className="ws-error">{error}</p>}</div></WorkspaceDialog>;
}
export type MenuItem={label:string;run?:()=>void;children?:MenuItem[];disabled?:boolean};
export function ContextMenu({x,y,items,onClose}:{x:number;y:number;items:MenuItem[];onClose:()=>void}) {
  const ref=useRef<HTMLDivElement>(null),parentFocus=useRef<HTMLElement|null>(null);const [sub,setSub]=useState<MenuItem|null>(null);
  useLayoutEffect(()=>{parentFocus.current=document.activeElement as HTMLElement;ref.current?.querySelector<HTMLButtonElement>('button')?.focus();const outside=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))onClose();};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}};document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);parentFocus.current?.focus();};},[onClose]);
  useLayoutEffect(()=>{const node=ref.current;if(!node)return;const rect=node.getBoundingClientRect();node.style.left=`${Math.max(8,Math.min(x,window.innerWidth-rect.width-8))}px`;node.style.top=`${Math.max(8,Math.min(y,window.innerHeight-rect.height-8))}px`;},[x,y,sub]);
  const render=(list:MenuItem[],secondary=false)=><div className="ws-context-column" role="menu" aria-label={secondary?sub?.label:'바탕화면 메뉴'}>{secondary&&<button role="menuitem" onClick={()=>setSub(null)}>‹ 뒤로</button>}{list.map(item=><button key={item.label} role="menuitem" aria-label={item.label} disabled={item.disabled} aria-haspopup={item.children?'menu':undefined} aria-expanded={item.children?sub===item:undefined} onKeyDown={e=>{if(e.key==='ArrowRight'&&item.children){e.preventDefault();setSub(item);requestAnimationFrame(()=>ref.current?.querySelector<HTMLButtonElement>('.ws-context-column:last-child button:nth-child(2)')?.focus());}}} onClick={()=>{if(item.children)setSub(item);else{onClose();item.run?.();}}}>{item.label}{item.children&&<span>›</span>}</button>)}</div>;
  return <div ref={ref} className="ws-context-menu" style={{left:x,top:y}} onContextMenu={e=>e.preventDefault()} onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{
    e.stopPropagation();const buttons=Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}
    if(e.key==='Home'||e.key==='End'){e.preventDefault();buttons[e.key==='Home'?0:buttons.length-1]?.focus();}
    if(e.key==='ArrowLeft'){e.preventDefault();setSub(null);buttons[0]?.focus();}if(e.key==='Tab')onClose();
  }}>{render(items)}{sub?.children&&render(sub.children,true)}</div>;
}
