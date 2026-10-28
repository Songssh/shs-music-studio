import type { SerializedDockview } from 'dockview';
import type { MinimizedWindow, Placement } from './dockviewWindows';
import type { SnapState } from './dockviewSnap';

export type WorkspaceLayout = { version: 1 | 2; layout: SerializedDockview; minimized: string[]; placements: Record<string, Placement>; minimizedWindows?: MinimizedWindow[]; snap?: SnapState; canvasInset?: number };

/** The old canvas had a 10px CSS margin. Translate saved floating coordinates
 * once so removing that margin does not move existing windows on screen.
 * Snap cell fractions are re-fitted separately by the Snap adapter. */
export function migrateWorkspaceOrigin(data: WorkspaceLayout) {
  const inset = data.canvasInset ?? 10;
  if (!inset) return data;
  const position = (box: NonNullable<SerializedDockview['floatingGroups']>[number]['position']) => {
    if ('left' in box) box.left += inset; else box.right += inset;
    if ('top' in box) box.top += inset; else box.bottom += inset;
  };
  const placement = (p: Placement) => { p.x += inset; p.y += inset; };
  data.layout.floatingGroups?.forEach(f => position(f.position));
  Object.values(data.placements ?? {}).forEach(placement);
  data.minimizedWindows?.forEach(w => { if (w.floating) position(w.floating.position); if (w.docked) placement(w.docked.placement); });
  data.snap?.records.forEach(r => position(r.before));
  data.snap?.previous?.records.forEach(r => position(r.before));
  data.snap?.previous?.windows.forEach(w => position(w.box));
  data.canvasInset = 0;
  return data;
}
