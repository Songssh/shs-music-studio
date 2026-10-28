// Test-only browser fixture using the production adapters and React controls.
import { createRoot } from '../../ui/node_modules/react-dom/client';
import { DockviewComponent, themeLight } from '../../ui/node_modules/dockview/dist/package/main.esm.mjs';
import '../../ui/node_modules/dockview/dist/styles/dockview.css';
import '../../ui/src/workspace/workspace.css';
import '../../ui/src/i18n';
import { dockviewWindowActions } from '../../ui/src/workspace/dockviewWindows';
import { dockviewSnap } from '../../ui/src/workspace/dockviewSnap';
import { SnapLayoutControls } from '../../ui/src/workspace/SnapLayoutControls';
import { recoverLayout, windowBox } from '../../ui/src/workspace/floatingBounds';

const root = document.getElementById('dock')!;
let loading = true;
const component = new DockviewComponent(root, {
  theme: themeLight, floatingGroupDragHandle: 'tabbar',
  floatingGroupBounds: { minimumWidthWithinViewport: 160, minimumHeightWithinViewport: 40 },
  transformFloatingGroupDrag: context => snap.transform(context),
  createComponent: ({ id }) => ({ element: Object.assign(document.createElement('div'), { textContent: id }), init() {}, dispose() {} }),
  createRightHeaderActionComponent: group => {
    const node = document.createElement('div'); node.className = 'ws-window-actions';
    const disposers: (() => void)[] = [];
    for (const [name, symbol, run] of [
      ['layout', '▦', (button: HTMLButtonElement) => snap.openPicker(group, button.getBoundingClientRect(), true)],
      ['minimize', '—', () => windows.close(group.activePanel!.id, true)],
      ['maximize', '□', () => { snap.closeMenu(); windows.maximize(group.activePanel!.id); }],
      ['close', '×', () => windows.close(group.activePanel!.id)],
    ] as const) {
      const button = document.createElement('button'); button.textContent = symbol; button.dataset.action = name; button.ariaLabel = name;
      button.onpointerdown = e => e.stopPropagation(); button.onclick = e => { e.stopPropagation(); run(button); }; node.append(button);
      if (name === 'layout' || name === 'maximize') button.classList.add('ws-snap-trigger');
      if (name === 'maximize') disposers.push(snap.bindMaximize(button, group));
    }
    return { element: node, init() {}, dispose() { disposers.forEach(d => d()); node.replaceChildren(); } };
  },
});
const api = component.api;
const windows = dockviewWindowActions(component, root, save);
const snap = dockviewSnap(component, root, windows, run => { const prev = loading; loading = true; try { run(); } finally { loading = prev; } save(); });
function save() {
  if (loading) return;
  windows.sync(); snap.sync();
  localStorage.setItem('snap-fixture', JSON.stringify({ layout: windows.normalLayout(), minimized: windows.minimized(), snap: snap.state() }));
}
api.layout(root.clientWidth, root.clientHeight);
api.onDidLayoutChange(save); api.onDidActivePanelChange(() => snap.sync());
const previous = localStorage.getItem('snap-fixture');
if (previous) {
  const saved = JSON.parse(previous);
  api.fromJSON(recoverLayout(saved.layout, { width: root.clientWidth, height: root.clientHeight }));
  windows.setMinimized(saved.minimized); snap.load(saved.snap);
}
loading = false;
const events: unknown[] = [];
root.addEventListener('pointerdown', e => events.push(['down', (e.target as HTMLElement).className]), true);
root.addEventListener('dragstart', () => events.push(['html-drag']), true);
component.onDidStartFloatingGroupDrag(() => events.push(['start']));
component.onDidEndFloatingGroupDrag(() => events.push(['end']));
createRoot(document.getElementById('controls')!).render(<SnapLayoutControls controller={snap}/>);
document.getElementById('arrange')!.onclick = () => snap.openArrange();
Object.assign(window, { qa: {
  api, component, windows, snap, events,
  reset() { events.length=0; loading = true; snap.load(); windows.clear(); api.clear(); loading = false; save(); },
  add(id: string, x = 80, y = 80, width = 600, height = 430) { api.addPanel({ id, component: 'tool', title: id, minimumWidth: 300, minimumHeight: 220, floating: { x, y, width, height } }); save(); },
  tab(id: string, into: string, position = 'center') { api.getPanel(id)!.api.moveTo({ group: api.getPanel(into)!.group, position }); save(); },
  key(id: string) { return snap.getSnapshot().choices.find(w => w.members.includes(id))!.key; },
  box(id: string) { return windowBox(component.getFloatingWindowForGroup(api.getPanel(id)!.group)!.overlay.toJSON(), { width: root.clientWidth, height: root.clientHeight }); },
  state() { return { layout: api.toJSON(), minimized: windows.minimized(), snap: snap.state(), active: api.activePanel?.id }; },
  save,
} });
