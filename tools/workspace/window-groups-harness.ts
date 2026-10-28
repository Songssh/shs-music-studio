// Browser-only integration fixture. Never imported by the application bundle.
import { DockviewComponent, themeLight } from '../../ui/node_modules/dockview/dist/package/main.esm.mjs';
import '../../ui/node_modules/dockview/dist/styles/dockview.css';
import { dockviewWindowActions } from '../../ui/src/workspace/dockviewWindows';
import { constrainFloatingBox, recoverLayout, windowBox } from '../../ui/src/workspace/floatingBounds';

const element = document.getElementById('dock')!;
let actions: ReturnType<typeof dockviewWindowActions>;
let loading = true;
const component = new DockviewComponent(element, {
  theme: themeLight, floatingGroupDragHandle: 'tabbar',
  floatingGroupBounds: { minimumWidthWithinViewport: 160, minimumHeightWithinViewport: 40 },
  transformFloatingGroupDrag: ({ proposed, container }) => constrainFloatingBox(proposed, container),
  createComponent: ({ id }) => ({ element: Object.assign(document.createElement('div'), { textContent: id }), init() {}, dispose() {} }),
  createRightHeaderActionComponent: group => {
    const node = document.createElement('div'); node.className = 'actions';
    for (const [name, run] of [
      ['minimize', () => actions.close(group.activePanel!.id, true)],
      ['maximize', () => actions.maximize(group.activePanel!.id)],
      ['close', () => actions.close(group.activePanel!.id)],
    ] as const) {
      const button = document.createElement('button'); button.textContent = name; button.dataset.action = name;
      button.onpointerdown = e => e.stopPropagation(); button.onclick = e => { e.stopPropagation(); run(); }; node.append(button);
    }
    return { element: node, init() {}, dispose() { node.replaceChildren(); } };
  },
});
const api = component.api;
function save() {
  if (loading) return;
  actions.sync();
  localStorage.setItem('fixture-layout', JSON.stringify({ layout: actions.normalLayout(), minimized: actions.minimized() }));
}
actions = dockviewWindowActions(component, element, save);
api.layout(element.clientWidth, element.clientHeight);
api.onDidLayoutChange(save);
const previous = localStorage.getItem('fixture-layout');
if (previous) {
  const data = JSON.parse(previous);
  actions.restoreLayout(recoverLayout(data.layout, { width: element.clientWidth, height: element.clientHeight }));
  actions.setMinimized(data.minimized);
}
loading = false;
Object.assign(window, { qa: {
  api, actions, component,
  reset() { loading = true; actions.clear(); api.clear(); loading = false; save(); },
  state() { return { layout: api.toJSON(), normal: actions.normalLayout(), minimized: actions.minimized(), active: api.activePanel?.id }; },
  add(id: string, x = 100, y = 80, width = 600, height = 420) {
    api.addPanel({ id, component: 'tool', title: id, minimumWidth: 300, minimumHeight: 220, floating: { x, y, width, height } });
    actions.sync(); save();
  },
  tab(id: string, target: string) { api.getPanel(id)!.api.moveTo({ group: api.getPanel(target)!.group, position: 'center' }); save(); },
  split(id: string, target: string) { api.getPanel(id)!.api.moveTo({ group: api.getPanel(target)!.group, position: 'right' }); save(); },
  box(id: string) { return windowBox(component.getFloatingWindowForGroup(api.getPanel(id)!.group)!.overlay.toJSON(), { width: element.clientWidth, height: element.clientHeight }); },
  position(id: string, box: object) { component.getFloatingWindowForGroup(api.getPanel(id)!.group)!.position(box); save(); },
  group(id: string) { return api.getPanel(id)!.group.id; },
  save,
} });
