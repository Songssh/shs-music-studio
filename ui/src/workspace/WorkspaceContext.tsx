import React, { Activity, createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { userStorage } from '../auth/userStorage';
import { isWindowsClient, type WindowId } from './registry';
import { ErrorBoundary } from '../components/shared/ErrorBoundary';

type Host = { id: WindowId; element: HTMLDivElement; visible: boolean; retained: Set<unknown>; owner?: HTMLElement };
// Stable portal destinations survive Dockview serialization, close and classic UI switching.
export class ToolHosts {
  private hosts = new Map<WindowId, Host>();
  private listeners = new Set<() => void>();
  private snapshot: Host[] = [];
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;
  private emit() { this.snapshot = [...this.hosts.values()]; this.listeners.forEach(fn => fn()); }
  attach(id: WindowId, owner: HTMLElement, visible = true) {
    let host = this.hosts.get(id);
    if (!host) {
      const element = document.createElement('div');
      element.className = 'ws-tool-host'; element.dataset.workspaceTool = id;
      host = { id, element, visible: false, retained: new Set() }; this.hosts.set(id, host);
      // Native media keeps its controller alive only while it is actually playing.
      for (const event of ['play', 'pause', 'ended', 'emptied']) element.addEventListener(event, e => {
        const media = e.target as HTMLMediaElement;
        this.retain(id, media, !media.paused && !media.ended);
      }, true);
    }
    owner.appendChild(host.element); host.owner = owner; host.visible = visible; this.emit();
  }
  visibility(id: WindowId, owner: HTMLElement, visible: boolean) {
    const host = this.hosts.get(id);
    if (host?.owner === owner && host.visible !== visible) { host.visible = visible; this.emit(); }
  }
  detach(id: WindowId, owner: HTMLElement) {
    const host = this.hosts.get(id);
    if (host?.owner === owner) { host.visible = false; host.owner = undefined; host.element.remove(); this.emit(); }
  }
  retain(id: WindowId, token: unknown, enabled: boolean) {
    const host = this.hosts.get(id); if (!host || host.retained.has(token) === enabled) return;
    if (enabled) host.retained.add(token); else host.retained.delete(token);
    this.emit();
  }
}
interface WorkspaceState {
  eligible: boolean; enabled: boolean; setEnabled: (enabled: boolean) => void;
  hosts: ToolHosts; commands: React.RefObject<{ open: (id: WindowId) => void; close: (id: WindowId) => void; save: () => void; restore: () => void; reset: () => void } | null>;
  active: string; setActive: (id: string) => void;
}
const WorkspaceContext = createContext<WorkspaceState>(null!);
export const useWorkspace = () => useContext(WorkspaceContext);
export const WorkspaceToolContext = createContext<{ id: string; visible: boolean; workspace: boolean } | null>(null);
export const useWorkspaceTool = () => useContext(WorkspaceToolContext);
// A playing WebAudio preview is an active controller, not an idle hidden Studio.
// Its drawing loop must use the returned visibility to suspend visual work.
export function useWorkspacePlaybackLease(playing: boolean) {
  const ws = useWorkspace(); const tool = useWorkspaceTool(); const token = useRef({});
  const id = tool?.id as WindowId | undefined;
  useLayoutEffect(() => {
    if (!ws?.eligible || !id || !playing) return;
    ws.hosts.retain(id, token.current, true);
    return () => ws.hosts.retain(id, token.current, false);
  }, [ws?.hosts, ws?.eligible, id, playing]);
  return tool?.visible ?? true;
}
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [eligible] = useState(() => isWindowsClient(navigator.userAgent, navigator.platform));
  const [enabled, enable] = useState(() => eligible && userStorage.getItem('hs-windows-ui-mode') !== 'classic');
  const [hosts] = useState(() => new ToolHosts());
  const commands = useRef<WorkspaceState['commands']['current']>(null);
  const [active, setActive] = useState('create');
  const setEnabled = (value: boolean) => {
    if (!eligible) return;
    userStorage.setItem('hs-windows-ui-mode', value ? 'workspace' : 'classic'); enable(value);
  };
  return <WorkspaceContext.Provider value={{ eligible, enabled, setEnabled, hosts, commands, active, setActive }}>{children}</WorkspaceContext.Provider>;
}
export function WorkspaceSlot({ id }: { id: WindowId }) {
  const { hosts } = useWorkspace(); const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const node = ref.current!; hosts.attach(id, node); return () => hosts.detach(id, node); }, [id, hosts]);
  return <div className="ws-slot" ref={ref} />;
}
export function WorkspacePortals({ render }: { render: (id: WindowId) => React.ReactNode }) {
  const { hosts, enabled } = useWorkspace();
  const entries = useSyncExternalStore(hosts.subscribe, hosts.getSnapshot);
  return entries.map(host => createPortal(
    <WorkspaceToolContext.Provider value={{ id: host.id, visible: host.visible, workspace: enabled }}>
      <Activity mode={host.visible || host.retained.size > 0 ? 'visible' : 'hidden'}>
        <ErrorBoundary resetKey={host.id}>{render(host.id)}</ErrorBoundary>
      </Activity>
    </WorkspaceToolContext.Provider>, host.element, host.id));
}
