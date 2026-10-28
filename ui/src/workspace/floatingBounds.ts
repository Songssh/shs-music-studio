import type { SerializedDockview } from 'dockview';

export type Viewport = { width: number; height: number };
export type WindowBox = Viewport & { left: number; top: number };
type AnchoredBox = NonNullable<SerializedDockview['floatingGroups']>[number]['position'];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export function windowBox(box: AnchoredBox, viewport: Viewport): WindowBox {
  return { width: box.width, height: box.height,
    left: 'left' in box ? box.left : viewport.width - box.right - box.width,
    top: 'top' in box ? box.top : viewport.height - box.bottom - box.height };
}

/** Interactive moves/resizes allow partial overflow, but keep a usable title bar. */
export function constrainFloatingBox(box: WindowBox, viewport: Viewport): WindowBox {
  const visible = Math.min(160, viewport.width, box.width);
  const side = Math.max(0, Math.min(box.width * .3, viewport.width * .3, 320, box.width - visible));
  const bottom = Math.max(0, Math.min(box.height * .25, viewport.height * .25, 240));
  return { ...box,
    left: clamp(box.left, -side, Math.max(-side, viewport.width - box.width + side)),
    top: clamp(box.top, 0, Math.max(0, Math.min(viewport.height - 40, viewport.height - box.height + bottom))) };
}

/** Loading/resizing the desktop must not undo an intentional edge placement.
 * Move only when fewer than 160 title-bar pixels (or its height) are reachable. */
export function recoverFloatingBox(box: WindowBox, viewport: Viewport): WindowBox {
  const visible = Math.min(160, viewport.width, box.width);
  return { ...box,
    left: clamp(box.left, visible - box.width, Math.max(0, viewport.width - visible)),
    top: clamp(box.top, 0, Math.max(0, viewport.height - 40)) };
}

export function resizeFloatingBox(box: WindowBox, direction: string, dx: number, dy: number, viewport: Viewport): WindowBox {
  const next = { ...box };
  const maxWidth = Math.max(320, viewport.width + Math.min(320, viewport.width * .3) * 2);
  const maxHeight = Math.max(240, viewport.height + Math.min(240, viewport.height * .25));
  if (direction.includes('left')) { next.width = clamp(box.width - dx, 320, maxWidth); next.left = box.left + box.width - next.width; }
  if (direction.includes('right')) next.width = clamp(box.width + dx, 320, maxWidth);
  if (direction.includes('top')) { next.height = clamp(box.height - dy, 240, maxHeight); next.top = box.top + box.height - next.height; }
  if (direction.includes('bottom')) next.height = clamp(box.height + dy, 240, maxHeight);
  return constrainFloatingBox(next, viewport);
}

export function recoverLayout(layout: SerializedDockview, viewport: Viewport) {
  for (const floating of layout.floatingGroups ?? []) {
    floating.position = recoverFloatingBox(windowBox(floating.position, viewport), viewport);
  }
  return layout;
}
