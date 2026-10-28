import type { DockviewComponent, DockviewGroupPanel, FloatingGroupDragContext } from 'dockview';
import { dockviewWindowActions, windowGroups, floatingGroups } from './dockviewWindows';
import { constrainFloatingBox, recoverFloatingBox, windowBox, type Viewport, type WindowBox } from './floatingBounds';
import { SNAP_LAYOUTS, SNAP_MINIMUM, SNAP_GAP, layoutCells, cellBox, fitsCell, fitSnapCells, windowKey, edgeSnap, withinSnapBar, sharedBoundaries, resizeCells, type SnapLayoutId, type SnapBoundary } from './snapLayouts';

type Windows = ReturnType<typeof dockviewWindowActions>;
type DockOrigin = { neighbor?: string; direction?: 'left' | 'right' | 'above' | 'below' };
export type SnapChoice = { key: string; members: string[]; active: string; minimized: boolean; minimum: Viewport; box: WindowBox; floating: boolean; dock?: DockOrigin };
type LiveWindow = SnapChoice & { group?: DockviewGroupPanel };
type SnapRecord = { key: string; before: WindowBox; session: string; slot: number; minimum: Viewport; dock?: DockOrigin };
type SnapSession = { id: string; layout: SnapLayoutId; cells: WindowBox[]; viewport?: Viewport };
type Previous = { windows: SnapChoice[]; records: SnapRecord[]; sessions: SnapSession[] };
export type SnapState = { records: SnapRecord[]; sessions: SnapSession[]; previous?: Previous };
type Menu = { kind: 'picker' | 'drag-picker' | 'assist' | 'arrange'; key?: string; anchor: WindowBox; layout: SnapLayoutId; session?: string; slot: number; selected: string[]; pinned: boolean };
export type SnapView = {
  menu?: Menu; choices: SnapChoice[]; preview?: WindowBox; size: Viewport; origin: { left: number; top: number };
  dividers: (SnapBoundary & { session: string })[]; canUndo: boolean; snapped: string[];
  bar?: { key: string; expanded: boolean; target?: { layout: SnapLayoutId; slot: number } };
};
const equalBox = (a: WindowBox, b: WindowBox) => ['left', 'top', 'width', 'height'].every(k => Math.abs(a[k as keyof WindowBox] - b[k as keyof WindowBox]) < 2);

/** Only geometry and Snap metadata. Dockview remains the owner of all windows,
 * tabs and drags; no tool lifecycle, network requests or global application store. */
export function dockviewSnap(component: DockviewComponent, root: HTMLElement, windows: Windows, commit: (run: () => void) => void) {
  const api = component.api, listeners = new Set<() => void>();
  let records: SnapRecord[] = [], sessions: SnapSession[] = [], previous: Previous | undefined;
  let menu: Menu | undefined, preview: WindowBox | undefined, busy = false, disposed = false;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined, leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let view: SnapView;
  type Drag = { key: string; pointer: number; before: WindowBox; down: { x: number; y: number }; current: { x: number; y: number }; started: boolean; cancelled: boolean; record?: SnapRecord; target?: { layout: SnapLayoutId; slot: number }; free?: WindowBox };
  let drag: Drag | undefined;
  let endDivider: (() => void) | undefined;
  const size = () => { const rect = root.getBoundingClientRect(); return { width: rect.width, height: rect.height }; };
  const list = (): LiveWindow[] => {
    const seen = new Set<string>(), result: LiveWindow[] = [];
    for (const group of api.groups) {
      const groups = windowGroups(component, group), members = groups.flatMap(g => g.panels.map(p => p.id)), key = windowKey(members);
      if (!members.length || seen.has(key)) continue;
      seen.add(key);
      const floating = component.getFloatingWindowForGroup(group), placement = windows.remember(group);
      const neighbor = placement.neighbor && api.getPanel(placement.neighbor)?.group;
      const active = (groups.includes(api.activeGroup!) ? api.activePanel?.id : group.activePanel?.id) ?? members[0];
      result.push({ key, members, active, group, minimized: false, floating: !!floating,
        dock: floating ? undefined : { neighbor: neighbor ? windowKey(windowGroups(component, neighbor).flatMap(g => g.panels.map(p => p.id))) : undefined, direction: placement.direction },
        minimum: { width: Math.max(320, floating?.gridview.minimumWidth ?? group.minimumWidth), height: Math.max(240, floating?.gridview.minimumHeight ?? group.minimumHeight) },
        box: floating ? windowBox(floating.overlay.toJSON(), size()) : { left: placement.x, top: placement.y, width: placement.width, height: placement.height } });
    }
    for (const hidden of windows.minimized()) {
      const members = Object.keys(hidden.panels), key = windowKey(members), count = hidden.floating ? floatingGroups(hidden.floating).length : 1;
      const p = hidden.docked?.placement;
      result.push({ key, members, active: hidden.activePanel, minimized: true, floating: !!hidden.floating,
        minimum: hidden.minimum ?? records.find(r => r.key === key)?.minimum ?? { width: 320 * count, height: 240 },
        box: hidden.floating ? windowBox(hidden.floating.position, size()) : { left: p?.x ?? 0, top: p?.y ?? 0, width: p?.width ?? 520, height: p?.height ?? 650 } });
    }
    return result;
  };
  // A saved member is never used as a proxy for its former window. Match the
  // complete CURRENT membership before every operation (including undo/assist).
  const resolve = (key: string) => list().find(w => w.key === key);
  const choice = (entry: LiveWindow): SnapChoice => ({ key: entry.key, members: entry.members, active: entry.active, minimized: entry.minimized, minimum: entry.minimum, box: entry.box, floating: entry.floating, dock: entry.dock });
  const emit = () => {
    if (disposed) return;
    const choices = list().map(choice), active = choices.find(c => !c.minimized && c.members.includes(api.activePanel?.id ?? ''));
    for (const floating of component.floatingGroups) {
      const members = api.groups.filter(g => component.getFloatingWindowForGroup(g) === floating).flatMap(g => g.panels.map(p => p.id));
      floating.overlay.element.classList.toggle('ws-snapped', records.some(r => r.key === windowKey(members)));
    }
    const record = records.find(r => r.key === active?.key), session = sessions.find(s => s.id === record?.session);
    let dividers: SnapView['dividers'] = [];
    if (session && session.cells.every(c => c.left >= 0 && c.top >= 0 && c.left + c.width <= size().width + 1 && c.top + c.height <= size().height + 1)) {
      const occupied = records.filter(r => r.session === session.id).filter(r => {
        const current = choices.find(c => c.key === r.key);
        return current && !current.minimized && equalBox(current.box, cellBox(session.cells[r.slot]));
      });
      const cells = occupied.map(r => session.cells[r.slot]);
      dividers = sharedBoundaries(cells).sort((a, b) => a.axis.localeCompare(b.axis) || a.value - b.value).map(b => ({ ...b, session: session.id }));
    }
    const rect = root.getBoundingClientRect();
    view = { menu: menu && { ...menu, selected: [...menu.selected] }, choices, preview, dividers, size: size(), origin: { left: rect.left, top: rect.top }, canUndo: !!previous, snapped: records.map(r => r.key),
      bar: drag?.started && !drag.cancelled ? { key: drag.key, expanded: menu?.kind === 'drag-picker', target: menu?.kind === 'drag-picker' ? drag.target : undefined } : undefined };
    listeners.forEach(fn => fn());
  };
  const sync = () => {
    if (busy || disposed) return;
    const current = list();
    if (drag && !current.some(w => w.key === drag!.key && w.floating)) { drag = undefined; menu = undefined; preview = undefined; }
    records = records.filter(r => current.some(w => w.key === r.key && (w.minimized || w.floating)));
    sessions = sessions.filter(s => records.some(r => r.session === s.id) || menu?.session === s.id);
    if (sessions.some(s => !s.viewport || s.viewport.width !== size().width || s.viewport.height !== size().height)) {
      run(() => { for (const session of sessions) refitSession(session); });
      return;
    }
    if (menu?.key && !current.some(w => w.key === menu!.key)) { menu = undefined; preview = undefined; }
    emit();
  };
  const run = (fn: () => void) => commit(() => { busy = true; try { fn(); } finally { busy = false; sync(); } });
  const capture = () => { previous = structuredClone({ windows: list().map(choice), records, sessions }); };
  const move = (key: string, box: WindowBox, raise = true) => {
    let current = resolve(key); if (!current) return false;
    if (current.minimized) { windows.restore(current.active); current = resolve(key); }
    if (!current?.group) return false;
    windows.restoreSize(current.group);
    if (!component.getFloatingWindowForGroup(current.group)) api.addFloatingGroup(current.group, { x: box.left, y: box.top, width: box.width, height: box.height });
    // addFloatingGroup may reassign an anchor. Resolve again, never reuse it.
    const group = resolve(key)?.group, floating = group && component.getFloatingWindowForGroup(group);
    if (!floating) return false;
    floating.position(recoverFloatingBox(box, size())); if (raise) floating.overlay.bringToFront();
    return true;
  };
  const place = (key: string, session: SnapSession, slot: number, original?: SnapChoice) => {
    const current = resolve(key), cell = session.cells[slot];
    if (!current || !cell || !fitsCell(cell, current.minimum)) return false;
    if (current.group) windows.restoreSize(current.group);
    const oldRecord = records.find(r => r.key === key);
    const before = oldRecord?.before ?? original?.box ?? resolve(key)!.box;
    if (!move(key, cellBox(cell))) return false;
    records = records.filter(r => r.key !== key && !(r.session === session.id && r.slot === slot));
    records.push({ key, before, session: session.id, slot, minimum: current.minimum, dock: oldRecord?.dock ?? original?.dock ?? current.dock });
    return true;
  };
  const closeMenu = () => { clearTimeout(hoverTimer); clearTimeout(leaveTimer); menu = undefined; preview = undefined; emit(); };
  const assist = (session: SnapSession) => {
    const occupied = records.filter(r => r.session === session.id), slot = session.cells.findIndex((_, i) => !occupied.some(r => r.slot === i));
    if (slot < 0 || !list().some(w => !occupied.some(r => r.key === w.key))) { menu = undefined; preview = undefined; return; }
    menu = { kind: 'assist', anchor: cellBox(session.cells[slot]), session: session.id, layout: session.layout, slot, selected: [], pinned: true };
    preview = cellBox(session.cells[slot]);
  };
  const choose = (layout: SnapLayoutId, slot: number) => {
    const key = menu?.key; if (!key) return;
    run(() => {
      const current = resolve(key), cells = layoutCells(layout, size());
      if (!current || !cells.every(c => fitsCell(c)) || !fitsCell(cells[slot], current.minimum)) return;
      capture();
      // Independently snapping two windows into matching empty regions should
      // produce the same linked boundary as choosing them through Snap Assist.
      let session = [...sessions].reverse().find(s => s.layout === layout && s.cells.length === cells.length
        && s.cells.every((c, i) => equalBox(c, cells[i]))
        && !records.some(r => r.session === s.id && r.slot === slot && r.key !== key));
      if (!session) { session = { id: crypto.randomUUID(), layout, cells, viewport: size() }; sessions.push(session); }
      if (place(key, session, slot)) assist(session);
    });
  };
  const openPicker = (group: DockviewGroupPanel, anchor: DOMRect, pinned = false) => {
    clearTimeout(leaveTimer);
    const key = windowKey(windowGroups(component, group).flatMap(g => g.panels.map(p => p.id)));
    const rect = root.getBoundingClientRect();
    menu = { kind: 'picker', key, anchor: { left: anchor.left - rect.left, top: anchor.bottom - rect.top + 6, width: 350, height: 0 }, layout: 'halves', slot: 0, selected: [], pinned };
    preview = undefined; emit();
  };
  const openArrange = (layout: SnapLayoutId = 'halves') => {
    const candidates = list().filter(w => !w.minimized).sort((a, b) => Number(b.members.includes(api.activePanel?.id ?? '')) - Number(a.members.includes(api.activePanel?.id ?? '')) || a.box.top - b.box.top || a.box.left - b.box.left);
    menu = { kind: 'arrange', anchor: { left: Math.max(8, (size().width - 480) / 2), top: 42, width: 480, height: 0 }, layout, slot: 0, selected: candidates.slice(0, SNAP_LAYOUTS.find(l => l.id === layout)!.cells.length).map(w => w.key), pinned: true };
    preview = undefined; emit();
  };
  const restoreGeometry = (key: string, box: WindowBox, dock?: DockOrigin) => {
    if (!move(key, box) || !dock) return;
    const group = resolve(key)?.group, neighbor = dock.neighbor ? resolve(dock.neighbor) : undefined;
    if (!group) return;
    const position = dock.direction === 'above' ? 'top' : dock.direction === 'below' ? 'bottom' : dock.direction ?? 'left';
    group.api.moveTo({ ...(neighbor?.group && !neighbor.floating ? { group: neighbor.group } : {}), position, skipSetActive: true });
    group.api.setSize({ width: box.width, height: box.height });
  };
  const unsnap = (key: string) => run(() => {
    const record = records.find(r => r.key === key);
    if (!record || !resolve(key)) return;
    capture(); restoreGeometry(key, record.before, record.dock); records = records.filter(r => r !== record); menu = undefined; preview = undefined;
  });
  const undo = () => run(() => {
    if (!previous) return;
    const saved = previous; previous = undefined;
    for (const entry of saved.windows) {
      const current = resolve(entry.key); if (!current) continue;
      if (entry.minimized) { if (!current.minimized) windows.close(current.active, true); continue; }
      // Preserve the current tab tree; only windows whose membership is still
      // identical can take part in a geometry undo.
      if (current.floating || entry.floating || current.minimized) restoreGeometry(entry.key, entry.box, entry.dock);
    }
    records = saved.records; sessions = saved.sessions; menu = undefined; preview = undefined;
    for (const session of sessions) refitSession(session);
  });
  const applySession = (session: SnapSession) => {
    for (const record of records.filter(r => r.session === session.id)) {
      const current = resolve(record.key);
      if (current?.group) {
        if (windows.isMaximized(current.group)) windows.updateRestoreSize(current.group, cellBox(session.cells[record.slot]));
        else move(record.key, cellBox(session.cells[record.slot]), false);
      }
      else if (current?.minimized) {
        const hidden = windows.minimized().find(w => windowKey(Object.keys(w.panels)) === record.key);
        if (hidden?.floating) hidden.floating.position = cellBox(session.cells[record.slot]);
      }
    }
  };
  const sessionMinimums = (session: SnapSession) => session.cells.map((_, slot) => { const r = records.find(r => r.session === session.id && r.slot === slot); return r ? resolve(r.key)?.minimum ?? r.minimum : SNAP_MINIMUM; });
  const refitSession = (session: SnapSession) => {
    const next = fitSnapCells(session.cells, size(), sessionMinimums(session));
    session.viewport = size();
    if (!next) {
      // A viewport smaller than the combined minimums cannot contain this
      // tiling. Keep those windows accessible as ordinary floats instead.
      records = records.filter(r => r.session !== session.id);
      if (menu?.session === session.id) { menu = undefined; preview = undefined; }
      return;
    }
    session.cells = next; applySession(session);
    if (menu?.session === session.id) { menu.anchor = cellBox(next[menu.slot]); preview = menu.anchor; }
  };
  const resizeSession = (session: SnapSession, boundary: SnapBoundary, value: number) => {
    session.cells = resizeCells(session.cells, boundary, value, sessionMinimums(session));
    applySession(session);
  };
  windows.setResizeHandler((floating, direction, start, dx, dy) => {
    const current = list().find(w => w.group && component.getFloatingWindowForGroup(w.group) === floating);
    const record = records.find(r => r.key === current?.key), session = sessions.find(s => s.id === record?.session);
    if (!record || !session) return false;
    const original = { left: start.left - SNAP_GAP / 2, top: start.top - SNAP_GAP / 2, width: start.width + SNAP_GAP, height: start.height + SNAP_GAP };
    let handled = false;
    run(() => {
      for (const axis of ['x', 'y'] as const) {
        const low = axis === 'x' ? 'left' : 'top', high = axis === 'x' ? 'right' : 'bottom', length = axis === 'x' ? 'width' : 'height';
        if (!direction.includes(low) && !direction.includes(high)) continue;
        const cell = session.cells[record.slot], value = cell[low] + (direction.includes(high) ? cell[length] : 0);
        const boundary = sharedBoundaries(session.cells).find(b => b.axis === axis && Math.abs(b.value - value) < 1);
        if (boundary) { resizeSession(session, boundary, original[low] + (direction.includes(high) ? original[length] : 0) + (axis === 'x' ? dx : dy)); handled = true; }
      }
      if (!handled) records = records.filter(r => r !== record);
    });
    return handled;
  });
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest('.dv-void-container,.dv-floating-titlebar')) return;
    const floating = component.floatingGroups.find(f => f.overlay.element === (event.target as Element).closest('.dv-resize-container'));
    const current = floating && list().find(w => w.group && component.getFloatingWindowForGroup(w.group) === floating);
    if (!current || !current.group || windows.isMaximized(current.group)) return;
    const rect = root.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    drag = { key: current.key, pointer: event.pointerId, before: current.box, down: point, current: point, started: false, cancelled: false, record: records.find(r => r.key === current.key) };
    closeMenu();
  };
  const detect = () => {
    if (!drag?.started || drag.cancelled) return;
    const hit = edgeSnap(drag.current.x, drag.current.y, size());
    const rect = root.getBoundingClientRect();
    const tray = document.querySelector<HTMLElement>('.ws-snap-bar');
    const bounds = tray?.getBoundingClientRect();
    // Use the full content height during expansion so fast moves across the
    // opening animation cannot collapse the tray under the pointer.
    const expandedTray = menu?.kind === 'drag-picker' && bounds ? { left: bounds.left - rect.left, top: 0, width: bounds.width,
      height: Math.min(root.clientHeight, 24 + (tray?.querySelector<HTMLElement>('.ws-snap-bar-content')?.scrollHeight ?? bounds.height)) } : undefined;
    let target = hit && hit !== 'picker' ? hit : undefined;
    if (withinSnapBar(drag.current.x, drag.current.y, size(), expandedTray)) {
      menu = { kind: 'drag-picker', key: drag.key, anchor: { left: (size().width - 364) / 2, top: 0, width: 364, height: 0 }, layout: 'halves', slot: 0, selected: [], pinned: true };
      // The entire bar is pointer-transparent. Hit-test its region geometry
      // using Dockview's existing pointer stream, including captured pointers.
      const x = drag.current.x + rect.left, y = drag.current.y + rect.top;
      const hovered = bounds && y <= bounds.bottom && Array.from(tray!.querySelectorAll<HTMLElement>('[data-snap-layout][data-snap-slot]:not(:disabled)')).find(node => {
        const box = node.getBoundingClientRect(); return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      });
      target = hovered ? { layout: hovered.dataset.snapLayout as SnapLayoutId, slot: Number(hovered.dataset.snapSlot) } : undefined;
    } else if (menu?.kind === 'drag-picker') menu = undefined;
    const current = resolve(drag.key);
    if (target && current) {
      const cells = layoutCells(target.layout, size());
      if (!cells.every(c => fitsCell(c)) || !fitsCell(cells[target.slot], current.minimum)) target = undefined;
    }
    drag.target = target; preview = target ? cellBox(layoutCells(target.layout, size())[target.slot]) : undefined; emit();
  };
  const transform = (context: FloatingGroupDragContext) => {
    if (!drag?.started) return constrainFloatingBox(context.proposed, context.container);
    if (drag.cancelled) return drag.before;
    let proposed = context.proposed;
    if (drag.free) proposed = { ...drag.free, left: drag.free.left + drag.current.x - drag.down.x, top: drag.free.top + drag.current.y - drag.down.y };
    detect(); return constrainFloatingBox(proposed, context.container);
  };
  const finish = () => {
    const ended = drag; if (!ended) return;
    drag = undefined; menu = undefined; preview = undefined;
    if (ended.cancelled) run(() => { move(ended.key, ended.before); if (ended.record) records = records.filter(r => r.key !== ended.key).concat(ended.record); });
    else if (ended.started && ended.target) {
      menu = { kind: 'picker', key: ended.key, anchor: ended.before, layout: ended.target.layout, slot: ended.target.slot, selected: [], pinned: true };
      // The pre-drag position, not the last pointer position, is the restore box.
      run(() => {
        move(ended.key, ended.before);
        if (ended.record) records.push(ended.record);
      });
      choose(ended.target.layout, ended.target.slot);
    } else run(() => {});
  };
  const onMove = (event: PointerEvent) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const rect = root.getBoundingClientRect(); drag.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (drag.started) detect();
  };
  const onUp = (event: PointerEvent) => { if (drag?.pointer === event.pointerId) { if (event.type === 'pointercancel') drag.cancelled = true; else detect(); queueMicrotask(finish); } };
  const onBlur = () => { if (drag) { drag.cancelled = true; finish(); } };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (drag?.started) { drag.cancelled = true; preview = undefined; menu = undefined; move(drag.key, drag.before); emit(); event.preventDefault(); event.stopPropagation(); }
    else if (menu) closeMenu();
  };
  // A floating move handle also emits a browser dragstart which Dockview
  // cancels. Observe after that cancellation; only accepted tab/dock drags win.
  const onNativeTabDrag = (event: DragEvent) => { if (event.defaultPrevented) return; drag = undefined; menu = undefined; preview = undefined; emit(); };
  const startSubscription = component.onDidStartFloatingGroupDrag(() => {
    if (!drag) return;
    drag.started = true;
    if (drag.record) {
      const width = drag.record.before.width, height = drag.record.before.height;
      drag.free = { width, height, left: drag.down.x - width * Math.max(0, Math.min(1, (drag.down.x - drag.before.left) / drag.before.width)), top: drag.down.y - Math.min(32, drag.down.y - drag.before.top) };
      records = records.filter(r => r.key !== drag!.key);
      // Dockview's drag transform applies position only, never dimensions.
      const group = resolve(drag.key)?.group;
      if (group) component.getFloatingWindowForGroup(group)?.position(constrainFloatingBox(drag.free, size()));
    }
    emit();
  });
  const endSubscription = component.onDidEndFloatingGroupDrag(() => { if (drag?.started) queueMicrotask(finish); });
  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('dragstart', onNativeTabDrag);
  window.addEventListener('pointermove', onMove, true); window.addEventListener('pointerup', onUp, true); window.addEventListener('pointercancel', onUp, true); window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  const observer = new ResizeObserver(sync); observer.observe(root);
  emit();
  return {
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, getSnapshot: () => view,
    sync, transform, openPicker, openArrange, choose, closeMenu, undo, unsnap,
    state: (): SnapState => structuredClone({ records, sessions, previous }),
    load: (state?: SnapState) => { records = state?.records ?? []; sessions = state?.sessions ?? []; previous = state?.previous; drag = undefined; menu = undefined; preview = undefined; sync(); },
    bindMaximize: (button: HTMLButtonElement, group: DockviewGroupPanel) => {
      button.setAttribute('aria-haspopup', 'dialog');
      const enter = () => { clearTimeout(leaveTimer); clearTimeout(hoverTimer); hoverTimer = setTimeout(() => { if (button.isConnected && !drag) openPicker(group, button.getBoundingClientRect()); }, 350); };
      const leave = () => { clearTimeout(hoverTimer); leaveTimer = setTimeout(() => { if (menu?.kind === 'picker' && !menu.pinned) closeMenu(); }, 350); };
      const key = (event: KeyboardEvent) => { if (event.key === 'ArrowDown') { event.preventDefault(); openPicker(group, button.getBoundingClientRect(), true); } };
      button.addEventListener('pointerenter', enter); button.addEventListener('pointerleave', leave); button.addEventListener('keydown', key);
      return () => { button.removeEventListener('pointerenter', enter); button.removeEventListener('pointerleave', leave); button.removeEventListener('keydown', key); clearTimeout(hoverTimer); };
    },
    keepMenu: () => clearTimeout(leaveTimer),
    leaveMenu: () => { leaveTimer = setTimeout(() => { if (menu?.kind === 'picker' && !menu.pinned) closeMenu(); }, 350); },
    previewSlot: (layout: SnapLayoutId, slot: number) => { if (menu?.kind === 'picker') { preview = cellBox(layoutCells(layout, size())[slot]); emit(); } },
    arrangeLayout: (layout: SnapLayoutId) => { if (menu?.kind !== 'arrange') return; menu.layout = layout; menu.selected = menu.selected.slice(0, SNAP_LAYOUTS.find(l => l.id === layout)!.cells.length); emit(); },
    selectWindow: (key: string) => { if (menu?.kind !== 'arrange') return; if (menu.selected.includes(key)) menu.selected = menu.selected.filter(k => k !== key); else if (menu.selected.length < SNAP_LAYOUTS.find(l => l.id === menu!.layout)!.cells.length) menu.selected.push(key); emit(); },
    reorder: (key: string, delta: number) => { if (!menu) return; const i = menu.selected.indexOf(key), j = i + delta; if (i < 0 || j < 0 || j >= menu.selected.length) return; [menu.selected[i], menu.selected[j]] = [menu.selected[j], menu.selected[i]]; emit(); },
    arrange: () => { if (menu?.kind !== 'arrange') return; const { layout, selected } = menu; run(() => { capture(); const activeWindow = list().find(w => w.members.includes(api.activePanel?.id ?? '')); const active = activeWindow && selected.includes(activeWindow.key) ? activeWindow.active : resolve(selected[0])?.active; const session = { id: crypto.randomUUID(), layout, cells: layoutCells(layout, size()), viewport: size() }; sessions.push(session); selected.forEach((key, slot) => place(key, session, slot, previous?.windows.find(w => w.key === key))); if (active) api.getPanel(active)?.api.setActive(); menu = undefined; preview = undefined; }); },
    assistSlot: (slot: number) => { if (menu?.kind !== 'assist') return; const session = sessions.find(s => s.id === menu!.session); if (!session || records.some(r => r.session === session.id && r.slot === slot)) return; menu.slot = slot; preview = cellBox(session.cells[slot]); emit(); },
    assistWindow: (key: string) => { if (menu?.kind !== 'assist') return; const { session: id, slot } = menu; run(() => { const session = sessions.find(s => s.id === id); if (session && place(key, session, slot)) assist(session); }); },
    occupied: (session: string, slot: number) => records.some(r => r.session === session && r.slot === slot),
    candidates: () => menu?.kind === 'assist' ? list().filter(w => !records.some(r => r.session === menu!.session && r.key === w.key)).map(choice) : list().map(choice),
    resizeDivider: (id: string, boundary: SnapBoundary, value: number) => run(() => { const session = sessions.find(s => s.id === id); if (session) resizeSession(session, boundary, value); }),
    dragDivider: (id: string, boundary: SnapBoundary, event: PointerEvent) => {
      endDivider?.(); const session = sessions.find(s => s.id === id); if (!session) return;
      const before = structuredClone(session.cells), start = boundary.axis === 'x' ? event.clientX : event.clientY;
      const moveDivider = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; run(() => { session.cells = structuredClone(before); resizeSession(session, boundary, boundary.value + (boundary.axis === 'x' ? e.clientX : e.clientY) - start); }); };
      const end = () => { window.removeEventListener('pointermove', moveDivider); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); endDivider = undefined; };
      const cancel = () => { run(() => { session.cells = before; applySession(session); }); end(); };
      const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
      window.addEventListener('pointermove', moveDivider); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key); endDivider = end;
    },
    dispose: () => { disposed = true; clearTimeout(hoverTimer); clearTimeout(leaveTimer); endDivider?.(); observer.disconnect(); startSubscription.dispose(); endSubscription.dispose(); windows.setResizeHandler(undefined); root.removeEventListener('pointerdown', onDown, true); root.removeEventListener('dragstart', onNativeTabDrag); window.removeEventListener('pointermove', onMove, true); window.removeEventListener('pointerup', onUp, true); window.removeEventListener('pointercancel', onUp, true); window.removeEventListener('keydown', onKey, true); window.removeEventListener('blur', onBlur); listeners.clear(); },
  };
}
export type SnapController = ReturnType<typeof dockviewSnap>;
