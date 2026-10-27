import { useWindowRegistry } from './useWindowRegistry';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createDockview, themeDark, themeLight, type DockviewApi, type IDockviewPanel, type SerializedDockview, type DockviewGroupPanel } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import './workspace.css';
import { useWorkspace } from './WorkspaceContext';
import { windowTitle, isWindowId, LAYOUT_KEY, SAVED_LAYOUT_KEY, type WindowId } from './registry';
import { userStorage } from '../auth/userStorage';
import { useAuth } from '../context/AuthContext';
import { BackgroundLayer, usePersonalization, openPersonalization } from './Personalization';
import { AppLauncher, ContextMenu, type MenuItem } from './DesktopMenus';
import { useAudioGenQueueSelector } from '../stores/audioGenQueueStore';
import { StreamActivityContext } from './StreamControllers';

type Placement = { x: number; y: number; width: number; height: number; floating: boolean; sibling?: string; neighbor?: string; direction?: 'left' | 'right' | 'above' | 'below' };
type Layout = { version: 1; layout: SerializedDockview; minimized: string[]; placements: Record<string, Placement> };
type Actions = { open: (id: WindowId) => void; close: (id: WindowId) => void; minimize: (id: WindowId) => void; reset: () => void; save: () => void; restore: () => void; float: () => void; dock: () => void; tab: (id: string) => void };

export function WorkspaceDesktop({ theme, onToggleTheme, onActive, initialView }: {
  theme: 'dark' | 'light'; onToggleTheme: () => void; onActive: (id: string) => void; initialView: string;
}) {
  const ws = useWorkspace(); const { user } = useAuth(); const menu = useWindowRegistry();
  const {prefs,ready,save,error}=usePersonalization();
  const [launcher,setLauncher]=useState(false),[context,setContext]=useState<{x:number;y:number;id?:WindowId}|null>(null);
  const closeMenu=useCallback(()=>setContext(null),[]);
  const dragging=useRef<string|null>(null);
  const root = useRef<HTMLDivElement>(null); const actions = useRef<Actions | null>(null);
  const allowedRef=useRef((id:string)=>menu.some(w=>w[0]===id));
  allowedRef.current=id=>menu.some(w=>w[0]===id);
  const onActiveRef = useRef(onActive); onActiveRef.current = onActive;
  const [openIds, setOpenIds] = useState<string[]>([]); const [minimized, setMinimized] = useState<string[]>([]);
  const [active, setActive] = useState('create');
  const [notice, setNotice] = useState('');
  const running = useAudioGenQueueSelector(s => s.items.filter(i => i.status === 'generating' || i.status === 'loading-adapter').length);
  const pending = useAudioGenQueueSelector(s => s.items.filter(i => i.status === 'pending').length);
  const jobSources=useAudioGenQueueSelector(s=>JSON.stringify(s.items.filter(i=>['pending','loading-adapter','generating'].includes(i.status)).map(i=>({source:i.globalParams.source,status:i.status}))));
  const jobs:Record<string,{running:number;pending:number}>={queue:{running,pending}};
  const activeStreams=useContext(StreamActivityContext);
  if(activeStreams)jobs.storm={running:activeStreams,pending:0};
  for(const item of JSON.parse(jobSources) as {source?:string;status:string}[]){
    if(!item.source||!isWindowId(item.source)||item.source==='queue')continue;
    const count=jobs[item.source]??{running:0,pending:0};
    if(item.status==='pending')count.pending++;else count.running++;jobs[item.source]=count;
  }
  const apiRef = useRef<DockviewApi | null>(null);

  useEffect(() => {
    const element = root.current!;
    let api: DockviewApi; let restoring = false; let disposed = false;
    let minimizedIds = new Set<string>(); let placements: Record<string, Placement> = {};
    let beforeMax: SerializedDockview | null = null;
    const raiseGrid = () => {
      if(disposed)return;
      element.querySelectorAll('.ws-front-grid,.ws-front-grid-content').forEach(node=>node.classList.remove('ws-front-grid','ws-front-grid-content'));
      const panel=api.activePanel;
      if(panel?.api.location.type!=='grid')return;
      // Dockview normally layers every float above the grid. A taskbar activation
      // must also expose a docked tool without changing its saved docking geometry.
      panel.group.element.classList.add('ws-front-grid');
      element.querySelector(`[data-workspace-tool="${panel.id}"]`)?.closest('.dv-render-overlay')?.classList.add('ws-front-grid-content');
    };
    const snapshot = (): Layout => ({ version: 1, layout: beforeMax ?? api.toJSON(), minimized: [...minimizedIds], placements });
    const write = (key = LAYOUT_KEY) => { try { userStorage.setItem(key, JSON.stringify(snapshot())); } catch { setNotice('배치를 저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.'); } };
    const refresh = () => {
      if (restoring || disposed) return;
      setOpenIds(api.panels.map(p => p.id)); setMinimized([...minimizedIds]);
      const id = api.activePanel?.id ?? ''; setActive(id); ws.setActive(id);
      requestAnimationFrame(raiseGrid);
      write();
    };
    const remember = (panel: IDockviewPanel): Placement => {
      const parent = element.getBoundingClientRect(); const box = panel.group.element.getBoundingClientRect();
      const neighbor = api.panels.find(p => p.group.id !== panel.group.id && p.api.location.type === 'grid');
      const other = neighbor?.group.element.getBoundingClientRect();
      const direction = other && Math.abs(box.x-other.x) < 40 ? (box.y < other.y ? 'above' : 'below') : (other && box.x < other.x ? 'left' : 'right');
      return { neighbor: neighbor?.id, direction, x: box.left - parent.left, y: box.top - parent.top, width: Math.max(320, box.width), height: Math.max(240, box.height),
        floating: panel.api.location.type === 'floating', sibling: panel.group.panels.find(p => p.id !== panel.id)?.id };
    };
    const unmaximize = () => {
      if (!beforeMax) return;
      const saved = beforeMax; beforeMax = null;
      restoring = true; api.fromJSON(saved, { reuseExistingPanels: true }); restoring = false;
      api.updateOptions({ disableDnd: false }); refresh();
    };
    const add = (id: WindowId, float = true) => {
      const previous = placements[id];
      const width = ({ create: 520, assistant: 460, details: 410, parameters: 590, playlist: 440, queue: 550 } as Record<string,number>)[id] ?? 1000;
      const floatWidth = Math.min(previous?.width ?? width, element.clientWidth - 24);
      const floatHeight = Math.min(previous?.height ?? 650, element.clientHeight - 24);
      const sibling = previous?.sibling && api.getPanel(previous.sibling);
      const panel = api.addPanel({ id, component: 'tool', title: windowTitle(id), minimumWidth: 300, minimumHeight: 220,
        ...(sibling ? { position: { referencePanel: sibling.id, direction: 'within' as const } }
          : float ? { floating: { x: Math.max(0, Math.min(previous?.x ?? 45 + api.panels.length * 18, element.clientWidth - floatWidth)), y: Math.max(0, Math.min(previous?.y ?? 30 + api.panels.length * 14, element.clientHeight - floatHeight)),
            width: floatWidth, height: floatHeight } } : { position: previous?.neighbor && api.getPanel(previous.neighbor) ? { referencePanel: previous.neighbor, direction: previous.direction ?? 'left' } : { direction: 'left' }, initialWidth: previous?.width }) });
      return panel;
    };
    const open = (id: WindowId) => {
      if (!allowedRef.current(id)) return;
      unmaximize(); minimizedIds.delete(id);
      const panel = api.getPanel(id) ?? add(id, placements[id]?.floating ?? true);
      panel.api.setActive(); refresh(); onActiveRef.current(id);
      requestAnimationFrame(()=>{const host=element.querySelector<HTMLElement>(`[data-workspace-tool="${id}"]`);if(host){host.tabIndex=-1;host.focus({preventScroll:true});}});
    };
    const close = (id: WindowId, minimize = false) => {
      unmaximize(); const panel = api.getPanel(id); if (!panel) { if (!minimize) { minimizedIds.delete(id); refresh(); } return; }
      placements[id] = remember(panel);
      if (minimize) minimizedIds.add(id); else minimizedIds.delete(id);
      api.removePanel(panel); refresh();
    };
    const maximize = (id: string) => {
      if (beforeMax) { unmaximize(); return; }
      const panel = api.getPanel(id); if (!panel) return;
      beforeMax = api.toJSON();
      if (panel.api.location.type === 'floating') panel.group.api.moveTo({ position: 'right' });
      panel.api.maximize(); api.updateOptions({ disableDnd: true }); refresh();
    };
    const float = (id = api.activePanel?.id) => {
      unmaximize(); const panel = id && api.getPanel(id); if (!panel) return;
      const box = remember(panel);
      api.addFloatingGroup(panel, { x: 36, y: 30, width: Math.min(Math.max(box.width, 360), element.clientWidth - 30), height: Math.min(650, element.clientHeight - 30) }); refresh();
    };
    const dock = (id = api.activePanel?.id) => {
      unmaximize(); const panel = id && api.getPanel(id); if (!panel) return;
      panel.api.moveTo({ position: 'right' }); refresh();
    };
    const defaults = () => {
      beforeMax = null; restoring = true; minimizedIds.clear(); placements = {}; api.clear();
      const left = add('create', false);
      api.addPanel({ id: 'library', component: 'tool', title: windowTitle('library'), minimumWidth: 300, minimumHeight: 220,
        position: { referencePanel: left.id, direction: 'right' } });
      left.api.setSize({ width: Math.round(element.clientWidth * .35) });
      api.updateOptions({ disableDnd: false }); restoring = false; refresh();
    };
    const load = (key: string) => {
      const text = userStorage.getItem(key); if (!text) return false;
      try {
        const data = JSON.parse(text) as Layout;
        if (data.version !== 1 || !data.layout?.grid || !data.layout.panels || data.layout.popoutGroups?.length) throw new Error('Invalid layout');
        if (Object.keys(data.layout.panels).some(id => !isWindowId(id))) throw new Error('Unknown window');
        // Preserve the layout while making old coordinates reachable in the new shell.
        for (const floating of data.layout.floatingGroups ?? []) {
          const box=floating.position;
          box.width=Math.max(300,Math.min(box.width,element.clientWidth));
          box.height=Math.max(220,Math.min(box.height,element.clientHeight));
          if('left' in box)box.left=Math.max(0,Math.min(box.left,element.clientWidth-box.width));
          if('top' in box)box.top=Math.max(0,Math.min(box.top,element.clientHeight-box.height));
          if('right' in box)box.right=Math.max(0,Math.min(box.right,element.clientWidth-box.width));
          if('bottom' in box)box.bottom=Math.max(0,Math.min(box.bottom,element.clientHeight-box.height));
        }
        beforeMax = null; restoring = true;
        api.fromJSON(data.layout, { reuseExistingPanels: true });
        for (const panel of [...api.panels]) if (!allowedRef.current(panel.id)) api.removePanel(panel);
        minimizedIds = new Set((data.minimized ?? []).filter(id => allowedRef.current(id) && !api.getPanel(id)));
        placements = data.placements ?? {}; api.updateOptions({ disableDnd: false });
        restoring = false; refresh(); return true;
      } catch { restoring = false; setNotice('저장 배치를 읽지 못해 기본 배치로 복구했습니다. 초안과 작업은 유지됩니다.'); return false; }
    };
    const header = (group: DockviewGroupPanel) => {
      const node = document.createElement('div'); node.className = 'ws-window-actions';
      const button = (label: string, symbol: string, run: () => void) => {
        const b = document.createElement('button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.textContent = symbol;
        b.onpointerdown = e => e.stopPropagation(); b.onclick = e => { e.stopPropagation(); run(); }; node.append(b);
      };
      const tabs=document.createElement('select'); tabs.className='ws-tab-combine'; tabs.title='다른 창과 탭 결합'; tabs.setAttribute('aria-label','다른 창과 탭 결합');
      const options=()=>{tabs.replaceChildren();const hint=document.createElement('option');hint.value='';hint.textContent='⋯';tabs.append(hint);for(const p of api.panels){if(p.id===group.activePanel?.id)continue;const option=document.createElement('option');option.value=p.id;option.textContent='탭 결합 · '+windowTitle(p.id);tabs.append(option);}};
      tabs.onpointerdown=e=>{e.stopPropagation();options();};tabs.onfocus=options;tabs.onchange=()=>{const p=group.activePanel,target=api.getPanel(tabs.value);if(p&&target){p.api.moveTo({group:target.group,position:'center'});refresh();}tabs.value='';};options();node.append(tabs);
      button('도킹 / 창으로 분리' , '↗', () => { const p = group.activePanel; if (p) group.api.location.type === 'floating' ? dock(p.id) : float(p.id); });
      button('최소화', '—', () => { const id = group.activePanel?.id; if (id && isWindowId(id)) close(id, true); });
      button('최대화 / 원래 크기', '□', () => { const id = group.activePanel?.id; if (id) maximize(id); });
      button('창 닫기', '×', () => { const id = group.activePanel?.id; if (id && isWindowId(id)) close(id); });
      return { element: node, init() {}, dispose() { node.replaceChildren(); } };
    };
    api = createDockview(element, {
      theme: theme === 'dark' ? themeDark : themeLight,
      floatingGroupBounds: 'boundedWithinViewport', floatingGroupDragHandle: 'tabbar',
      defaultRenderer: 'always', defaultTabComponent: 'workspace-tab', createRightHeaderActionComponent: header,
      createTabComponent: ({ id }) => {
        const node = document.createElement('div'); node.className = 'ws-tab-title'; node.textContent = windowTitle(id);
        return { element: node, init() {} };
      },
      createComponent: ({ id }) => {
        const node = document.createElement('div'); node.className = 'ws-slot'; let off: { dispose(): void } | undefined;
        return { element: node, init(params) {
          if (!isWindowId(id)) return;
          ws.hosts.attach(id, node, params.api.isVisible);
          off = params.api.onDidVisibilityChange(e => ws.hosts.visibility(id, node, e.isVisible));
          node.onpointerdown = () => { params.api.setActive(); onActiveRef.current(id); };
          node.addEventListener('focusin', () => { params.api.setActive(); onActiveRef.current(id); });
        }, dispose() { off?.dispose(); if (isWindowId(id)) ws.hosts.detach(id, node); } };
      },
    });
    apiRef.current = api;
    // ResizeObserver runs later; restore against the actual desktop now so
    // floating coordinates are not scaled against Dockview's initial 100px grid.
    api.layout(element.clientWidth, element.clientHeight);
    const layoutSubscription = api.onDidLayoutChange(refresh);
    const activeSubscription = api.onDidActivePanelChange(e => {
      requestAnimationFrame(raiseGrid);
      if (e.panel && !restoring) { setActive(e.panel.id); ws.setActive(e.panel.id); onActiveRef.current(e.panel.id); }
    });
    actions.current = { open, close, minimize:id=>close(id,true), reset: defaults, save: () => { write(SAVED_LAYOUT_KEY); setNotice('현재 배치를 저장했습니다.'); },
      restore: () => { if (!load(SAVED_LAYOUT_KEY)) setNotice('저장된 배치가 없습니다. 먼저 배치 저장을 눌러 주세요.'); },
      float: () => float(), dock: () => dock(), tab: id => {
        const current = api.activePanel?.id; unmaximize();
        const panel = current && api.getPanel(current); const target = api.getPanel(id);
        if (panel && target && panel.id !== id) { panel.api.moveTo({ group: target.group, position: 'center' }); refresh(); }
      } };
    ws.commands.current = { open, close, save:actions.current.save, restore:actions.current.restore, reset:defaults };
    if (!load(LAYOUT_KEY)) defaults();
    if (isWindowId(initialView) && !['create', 'library'].includes(initialView)) open(initialView);
    return () => {
      write(); disposed = true; layoutSubscription.dispose(); activeSubscription.dispose(); api.dispose();
      apiRef.current = null; ws.commands.current = null; actions.current = null;
    };
    // The imperative layout owns its lifetime. React prop changes must not rebuild its panels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.hosts]);
  useEffect(() => { apiRef.current?.updateOptions({ theme: theme === 'dark' ? themeDark : themeLight }); }, [theme]);

  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(timer);},[notice]);
  const open = (id: WindowId) => actions.current?.open(id);
  const pinned=prefs.pinned.filter(id=>menu.some(w=>w[0]===id));
  const taskIds=[...new Set([...pinned,...openIds,...minimized,...Object.keys(jobs).filter(id=>jobs[id].running+jobs[id].pending>0)])].filter(id=>id!=='account'&&menu.some(w=>w[0]===id));
  const pin=(id:string)=>void save({pinned:prefs.pinned.includes(id)?prefs.pinned.filter(x=>x!==id):[...prefs.pinned,id]}).catch(()=>{});
  const desktopItems:MenuItem[]=[
    {label:'창 열기',children:[...new Set(menu.map(w=>w[3]))].map(category=>({label:category,children:menu.filter(w=>w[3]===category).map(w=>({label:`${w[2]} ${w[1]}`,run:()=>open(w[0])}))}))},
    {label:'작업 공간',children:[{label:'현재 배치 저장',run:()=>actions.current?.save()},{label:'저장 배치 불러오기',run:()=>actions.current?.restore()},{label:'기본 배치 복원',run:()=>actions.current?.reset()}]},
    {label:'배경 변경',run:openPersonalization},{label:'테마',children:[{label:'☀ 밝은 테마',run:()=>{if(theme!=='light')onToggleTheme();}},{label:'☾ 어두운 테마',run:()=>{if(theme!=='dark')onToggleTheme();}}]},
    {label:'내 계정',run:()=>open('account')}
  ];
  const contextItems=():MenuItem[]=>{
    const id=context?.id;if(!id)return desktopItems;
    return [{label:minimized.includes(id)?'복원':openIds.includes(id)?'앞으로 가져오기':'열기',run:()=>open(id)},
      ...(openIds.includes(id)?[{label:'최소화',run:()=>actions.current?.minimize(id)}]:[]),
      ...(openIds.includes(id)||minimized.includes(id)?[{label:'닫기',run:()=>actions.current?.close(id)}]:[]),
      {label:pinned.includes(id)?'고정 해제':'작업표시줄에 고정',disabled:!ready,run:()=>pin(id)}];
  };
  return <section className="workspace" data-theme={theme} data-workspace-active={active}>
    <div className="ws-body">
      <aside className="ws-rail" aria-label="작업표시줄">
        <button className="ws-launch-button" title="앱 실행기" aria-label="앱 실행기" onClick={()=>setLauncher(true)}>▦</button>
        <nav aria-label="고정 및 열린 도구">{taskIds.map(id=>{const item=menu.find(w=>w[0]===id)!;const opened=openIds.includes(id),hidden=minimized.includes(id),isActive=opened&&id===active;
          const label=`${item[1]} · ${isActive?'활성 창':hidden?'최소화됨':opened?'열림':'닫힘'}${pinned.includes(id)?' · 고정됨':''}${jobs[id]&&jobs[id].running+jobs[id].pending?` · 실행 ${jobs[id].running}, 대기 ${jobs[id].pending}`:''}`;
          return <button key={id} data-tool={id} title={label} aria-label={label} aria-pressed={isActive} className={`${isActive?'active':''} ${hidden?'minimized':''}`} draggable={ready&&pinned.includes(id)}
            onDragStart={e=>{dragging.current=id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-hotstep-pin',id);e.stopPropagation();}}
            onDragOver={e=>{if(dragging.current&&pinned.includes(id)){e.preventDefault();e.stopPropagation();}}}
            onDrop={e=>{e.preventDefault();e.stopPropagation();const from=dragging.current;if(from&&from!==id&&pinned.includes(id)){const next=prefs.pinned.filter(x=>x!==from);next.splice(next.indexOf(id),0,from);void save({pinned:next}).catch(()=>{});}dragging.current=null;}}
            onDragEnd={()=>{dragging.current=null;}}
            onContextMenu={e=>{e.preventDefault();setContext({x:e.clientX,y:e.clientY,id:item[0]});}}
            onClick={()=>isActive?actions.current?.minimize(item[0]):open(item[0])}>
            <i aria-hidden="true">{item[2]}</i>{(opened||hidden)&&<b className="ws-dot"/>}{jobs[id]&&jobs[id].running+jobs[id].pending>0&&<em className="ws-badge">{jobs[id].running+jobs[id].pending}</em>}
          </button>;})}</nav>
        <button className="ws-theme-button" title="밝은 / 어두운 테마" aria-label="밝은 / 어두운 테마" onClick={onToggleTheme}>{theme==='dark'?'☀':'☾'}</button>
        <button className={`ws-profile-button ${active==='account'?'active':''}`} title={`${user?.username} · 내 계정`} aria-label="내 계정" onClick={()=>open('account')}>{user?.username?.slice(0,1).toUpperCase()||'◎'}</button>
      </aside>
      <div className="ws-center" onContextMenu={e=>{
        const target=e.target as HTMLElement;
        if(target.closest('.dv-groupview,.dv-render-overlay,.ws-slot,.ws-tool-host,.dv-resize-handle,.dv-sash,.ws-context-menu,button,input,textarea,select'))return;
        e.preventDefault();setContext({x:e.clientX,y:e.clientY});
      }} onKeyDown={e=>{if(e.target!==root.current)return;if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const box=root.current!.getBoundingClientRect();setContext({x:box.left+24,y:box.top+24});}}}>
        <BackgroundLayer value={ready?prefs.background:{...prefs.background,mode:'default',imageId:null}}/>
        {!openIds.length&&<div className="ws-desktop-welcome" aria-hidden="true"><span>HOT-STEP</span><h1>음악이 시작되는 곳.</h1><p>왼쪽 앱 메뉴에서 다음 작업을 열어 보세요.</p></div>}
        <div ref={root} className="ws-desktop" tabIndex={0} aria-label="음악 작업 공간"/>
        {(notice||error)&&<div className="ws-notice" role="status">{error||notice}</div>}
      </div>
    </div>
    {launcher&&<AppLauncher open={open} onClose={()=>setLauncher(false)}/>}
    {context&&<ContextMenu x={context.x} y={context.y} items={contextItems()} onClose={closeMenu}/>}
  </section>;
}
