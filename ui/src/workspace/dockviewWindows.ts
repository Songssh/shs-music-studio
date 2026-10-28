import type { DockviewComponent, DockviewGroupPanel, SerializedDockview, SerializedDockviewGroup } from 'dockview';
import { recoverFloatingBox, resizeFloatingBox, windowBox, type WindowBox } from './floatingBounds';

type Floating = NonNullable<ReturnType<DockviewComponent['getFloatingWindowForGroup']>>;
type FloatState = NonNullable<SerializedDockview['floatingGroups']>[number];
type GroupState = SerializedDockviewGroup['group'];
export type Placement = { x: number; y: number; width: number; height: number; floating: boolean; sibling?: string; neighbor?: string; direction?: 'left' | 'right' | 'above' | 'below' };
export type MinimizedWindow = {
  activePanel: string;
  panels: SerializedDockview['panels'];
  maximized?: boolean;
  minimum?: { width: number; height: number };
  floating?: FloatState;
  docked?: { data: SerializedDockviewGroup; placement: Placement };
};

export function floatingGroups(state: FloatState): GroupState[] {
  if (state.data) return [state.data];
  const visit = (node: NonNullable<FloatState['grid']>['root']): GroupState[] =>
    node.type === 'leaf' ? [node.data as GroupState] : (node.data as typeof node[]).flatMap(visit);
  return state.grid ? visit(state.grid.root) : [];
}

/** The anchor is not necessarily the only group in a floating window. Query
 * Dockview's live ownership on every action, including after moves/redocking. */
export function windowGroups(component: DockviewComponent, group: DockviewGroupPanel) {
  const floating = component.getFloatingWindowForGroup(group);
  return floating ? component.api.groups.filter(g => component.getFloatingWindowForGroup(g) === floating) : [group];
}

/** Dockview adapter only: no tool controllers, media or server APIs live here. */
export function dockviewWindowActions(component: DockviewComponent, element: HTMLElement, changed: () => void) {
  const api = component.api;
  let minimized: MinimizedWindow[] = [];
  const maximized = new Map<Floating, WindowBox>();
  const subscriptions = new Map<Floating, { dispose(): void }[]>();
  let correcting = false;
  let endResize: (() => void) | undefined;
  let resizeHandler: ((floating: Floating, direction: string, start: WindowBox, dx: number, dy: number) => boolean) | undefined;
  const viewport = () => { const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height }; };
  const boxOf = (floating: Floating) => windowBox(floating.overlay.toJSON(), viewport());
  const floatingState = (group: DockviewGroupPanel) => api.toJSON().floatingGroups?.find(f => floatingGroups(f).some(g => g.id === group.id));
  const target = (id: string) => api.getPanel(id)?.group;
  const hidden = (id: string) => minimized.find(w => id in w.panels);

  const remember = (group: DockviewGroupPanel): Placement => {
    const parent = element.getBoundingClientRect(), box = group.element.getBoundingClientRect();
    const neighbor = api.groups.filter(g => g !== group && g.api.location.type === 'grid')
      .sort((a, b) => {
        const aa = a.element.getBoundingClientRect(), bb = b.element.getBoundingClientRect();
        return Math.hypot(aa.x - box.x, aa.y - box.y) - Math.hypot(bb.x - box.x, bb.y - box.y);
      })[0];
    const other = neighbor?.element.getBoundingClientRect();
    const direction = other && Math.abs(box.x - other.x) < 40 ? (box.y < other.y ? 'above' : 'below') : (other && box.x < other.x ? 'left' : 'right');
    return { x: box.left - parent.left, y: box.top - parent.top, width: box.width, height: box.height,
      floating: group.api.location.type === 'floating', neighbor: neighbor?.activePanel?.id, direction };
  };
  const restoreSize = (group: DockviewGroupPanel) => {
    const floating = component.getFloatingWindowForGroup(group);
    if (floating) {
      const box = maximized.get(floating);
      if (box) { maximized.delete(floating); floating.overlay.element.classList.remove('ws-maximized'); floating.position(recoverFloatingBox(box, viewport())); }
    } else if (group.api.isMaximized()) group.api.exitMaximized();
  };
  const sync = () => {
    const live = new Set(component.floatingGroups);
    // Dockview 8.7 FloatingGroupService's dispose callback closes over the
    // ORIGINAL anchor. Closing its former window can tag a moved anchor as
    // grid even though it now belongs to another float. Repair from live
    // ownership before any later remove/dock operation trusts that tag.
    for (const group of api.groups) {
      if (component.getFloatingWindowForGroup(group) && group.api.location.type !== 'floating') group.model.location = { type: 'floating' };
    }
    for (const [floating, list] of subscriptions) if (!live.has(floating)) {
      list.forEach(s => s.dispose()); subscriptions.delete(floating); maximized.delete(floating);
    }
    for (const floating of live) if (!subscriptions.has(floating)) {
      const recover = () => {
        if (correcting) return;
        const box = boxOf(floating);
        const next = maximized.has(floating) ? { left: 0, top: 0, ...viewport() } : recoverFloatingBox(box, viewport());
        if (Math.abs(next.left - box.left) > .5 || Math.abs(next.top - box.top) > .5 || next.width !== box.width || next.height !== box.height) {
          correcting = true;
          try { floating.position(next); } finally { correcting = false; }
        }
      };
      subscriptions.set(floating, [floating.overlay.onDidChange(recover)]);
      recover();
    }
  };
  const normalLayout = () => {
    const layout = api.toJSON();
    for (const [floating, box] of maximized) {
      const state = layout.floatingGroups?.find(f => floatingGroups(f).some(g => g.id === floating.group.id));
      if (state) state.position = box;
    }
    return layout;
  };
  const restoreLayout = (layout: SerializedDockview) => {
    const positions = (layout.floatingGroups ?? []).map(f => ({ members: floatingGroups(f).flatMap(g => g.views), box: windowBox(f.position, viewport()) }));
    api.fromJSON(layout, { reuseExistingPanels: true });
    // Dockview's deserializer clamps negative left/top to zero regardless of
    // floatingGroupBounds. Reapply accessible saved positions after it builds
    // the real containers, including unrelated floats during minimize restore.
    for (const saved of positions) {
      const group = api.getPanel(saved.members[0])?.group;
      const floating = group && component.getFloatingWindowForGroup(group);
      if (!group || !floating) continue;
      const current = windowGroups(component, group).flatMap(g => g.panels.map(p => p.id));
      if (current.length === saved.members.length && current.every(id => saved.members.includes(id))) floating.position(recoverFloatingBox(saved.box, viewport()));
    }
    sync();
  };
  const restore = (id: string) => {
    const saved = hidden(id);
    if (!saved) return undefined;
    // Merge into the CURRENT layout. Never restore a whole pre-minimize snapshot:
    // unrelated windows may have moved, opened or closed while this one was hidden.
    const data = structuredClone(saved);
    const active = data.activePanel;
    const maximizedGridPanel = data.floating && api.groups.find(g => g.api.location.type === 'grid' && g.api.isMaximized())?.activePanel?.id;
    if (data.floating) {
      const current = api.toJSON();
      const otherMaximized = [...maximized].map(([floating, box]) => ({ id: floating.group.activePanel?.id, box }));
      const used = new Set(api.groups.map(g => g.id));
      for (const group of floatingGroups(data.floating)) {
        while (used.has(group.id)) group.id += '-restored';
        used.add(group.id);
      }
      data.floating.position = recoverFloatingBox(windowBox(data.floating.position, viewport()), viewport());
      current.floatingGroups = [...(current.floatingGroups ?? []), data.floating];
      Object.assign(current.panels, data.panels);
      current.activeGroup = floatingGroups(data.floating).find(g => g.views.includes(active))?.id;
      // Stable ToolHosts and Dockview's reuse flag keep existing tools alive.
      restoreLayout(current);
      for (const savedMax of otherMaximized) {
        const group = savedMax.id && target(savedMax.id);
        const floating = group && component.getFloatingWindowForGroup(group);
        if (floating) { maximized.set(floating, savedMax.box); floating.overlay.element.classList.add('ws-maximized'); }
      }
    } else if (data.docked) {
      const { placement, data: group } = data.docked;
      while (api.getGroup(group.group.id)) group.group.id += '-restored';
      const neighbor = placement.neighbor && api.getPanel(placement.neighbor);
      const restored = api.addGroupFromJSON(group, {
        ...(neighbor && neighbor.api.location.type === 'grid' ? { referencePanel: neighbor.id, direction: placement.direction ?? 'left' } : { direction: 'left' }),
        initialWidth: placement.width, initialHeight: placement.height,
      });
      restored.api.setSize({ width: placement.width, height: placement.height });
    }
    minimized = minimized.filter(w => w !== saved);
    sync();
    const panel = api.getPanel(active) ?? api.getPanel(id);
    panel?.api.setActive();
    // setActive exits Dockview's grid maximization. Reapply it after restoring
    // the float, then return focus without changing that unrelated grid's size.
    if (maximizedGridPanel && panel) {
      api.getPanel(maximizedGridPanel)?.api.maximize();
      component.doSetGroupActive(panel.group);
    }
    if (data.maximized && panel) maximize(panel.id);
    changed();
    return panel;
  };
  const close = (id: string, minimize = false) => {
    const hiddenWindow = hidden(id);
    if (hiddenWindow) { if (!minimize) minimized = minimized.filter(w => w !== hiddenWindow); changed(); return; }
    const group = target(id); if (!group) return;
    const floatingWindow = component.getFloatingWindowForGroup(group);
    const wasMaximized = floatingWindow ? maximized.has(floatingWindow) : group.api.isMaximized();
    restoreSize(group);
    const groups = windowGroups(component, group);
    if (minimize) {
      const panels = Object.fromEntries(groups.flatMap(g => Object.entries(api.serializeGroup(g).panels)));
      const activePanel = groups.includes(api.activeGroup!) ? api.activePanel?.id : group.activePanel?.id;
      const floating = floatingState(group);
      minimized.push({ activePanel: activePanel ?? id, panels, maximized: wasMaximized,
        minimum: { width: Math.max(320, floatingWindow?.gridview.minimumWidth ?? group.minimumWidth), height: Math.max(240, floatingWindow?.gridview.minimumHeight ?? group.minimumHeight) },
        ...(floating ? { floating } : { docked: { data: api.serializeGroup(group), placement: remember(group) } }) });
    }
    // Snapshot the current members before removal changes the floating anchor.
    for (const member of groups) api.removeGroup(member);
    sync(); changed();
  };
  const maximize = (id: string) => {
    const group = target(id); if (!group) return;
    const floating = component.getFloatingWindowForGroup(group);
    if (floating) {
      if (maximized.has(floating)) restoreSize(group);
      else {
        maximized.set(floating, boxOf(floating));
        floating.overlay.element.classList.add('ws-maximized');
        floating.position({ left: 0, top: 0, ...viewport() }); floating.overlay.bringToFront();
      }
    } else if (group.api.isMaximized()) group.api.exitMaximized();
    else group.api.maximize();
    changed();
  };
  // Dockview 8.7's native resize handler hard-clamps every edge to the viewport
  // even with floatingGroupBounds. Adapt its existing handles and position API;
  // Dockview still owns the overlay, nested grid, constraints and drag/drop.
  const onPointerDown = (event: PointerEvent) => {
    const handle = event.target as HTMLElement;
    const direction = Array.from(handle.classList).find(c => /^dv-resize-handle-(top|bottom|left|right|topleft|topright|bottomleft|bottomright)$/.test(c))?.replace('dv-resize-handle-', '');
    const floating = component.floatingGroups.find(f => f.overlay.element === handle.closest('.dv-resize-container'));
    if (!floating) return;
    if (maximized.has(floating) && (direction || event.shiftKey || handle.closest('.dv-void-container,.dv-floating-titlebar'))) { event.preventDefault(); event.stopPropagation(); return; }
    if (!direction || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); endResize?.();
    const start = boxOf(floating), x = event.clientX, y = event.clientY, pointer = event.pointerId;
    handle.setPointerCapture(pointer); floating.overlay.bringToFront();
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      const dx = e.clientX - x, dy = e.clientY - y;
      if (!resizeHandler?.(floating, direction, start, dx, dy)) floating.position(resizeFloatingBox(start, direction, dx, dy, viewport()));
    };
    const end = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish);
      handle.removeEventListener('lostpointercapture', end);
      if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
      endResize = undefined; changed();
    };
    const finish = (e: PointerEvent) => { if (e.pointerId === pointer) end(); };
    endResize = end;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', end);
  };
  element.addEventListener('pointerdown', onPointerDown, true);
  const observer = new ResizeObserver(() => {
    sync();
    for (const floating of component.floatingGroups) floating.position(maximized.has(floating) ? { left: 0, top: 0, ...viewport() } : recoverFloatingBox(boxOf(floating), viewport()));
    changed();
  });
  observer.observe(element);
  return {
    sync, normalLayout, restoreLayout, remember, restoreSize, restore, close, maximize,
    isMaximized: (group: DockviewGroupPanel) => { const floating = component.getFloatingWindowForGroup(group); return floating ? maximized.has(floating) : group.api.isMaximized(); },
    updateRestoreSize: (group: DockviewGroupPanel, box: WindowBox) => { const floating = component.getFloatingWindowForGroup(group); if (floating && maximized.has(floating)) maximized.set(floating, box); },
    setResizeHandler: (handler: typeof resizeHandler) => { resizeHandler = handler; },
    minimized: () => minimized,
    minimizedIds: () => minimized.flatMap(w => Object.keys(w.panels)),
    setMinimized: (windows: MinimizedWindow[]) => { minimized = windows; },
    clear: () => { minimized = []; maximized.clear(); },
    dispose: () => { observer.disconnect(); endResize?.(); element.removeEventListener('pointerdown', onPointerDown, true); subscriptions.forEach(list => list.forEach(s => s.dispose())); },
  };
}
