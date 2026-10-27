import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
export function WorkspaceDialog({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null),previous=useRef<HTMLElement|null>(null);
  useEffect(()=>{previous.current=document.activeElement as HTMLElement;ref.current?.showModal();return()=>{previous.current?.focus();};},[]);
  return createPortal(<dialog ref={ref} className={`ws-dialog ${wide?'wide':''}`} aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}} onKeyDown={e=>e.stopPropagation()}>
    <div className="ws-dialog-inner"><header><h2>{title}</h2><button aria-label={`${title} 닫기`} onClick={onClose}>×</button></header>{children}</div>
  </dialog>,document.body);
}
