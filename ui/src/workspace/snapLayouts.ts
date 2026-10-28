import type { Viewport, WindowBox } from './floatingBounds';

export const SNAP_GAP = 0;
export const SNAP_MINIMUM = { width: 320, height: 240 };
export type SnapLayoutId = 'halves' | 'wide-left' | 'wide-right' | 'thirds' | 'quarters' | 'main-side' | 'rows';
type Fraction = [number, number, number, number];
export const SNAP_LAYOUTS: { id: SnapLayoutId; label: string; cells: Fraction[] }[] = [
  { id: 'halves', label: 'Side by side · 50:50', cells: [[0, 0, .5, 1], [.5, 0, .5, 1]] },
  { id: 'wide-left', label: 'Wide left · 70:30', cells: [[0, 0, .7, 1], [.7, 0, .3, 1]] },
  { id: 'wide-right', label: 'Wide right · 30:70', cells: [[0, 0, .3, 1], [.3, 0, .7, 1]] },
  { id: 'thirds', label: 'Three columns', cells: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  { id: 'quarters', label: 'Four quarters', cells: [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]] },
  { id: 'main-side', label: 'Large left + two right', cells: [[0, 0, .6, 1], [.6, 0, .4, .5], [.6, .5, .4, .5]] },
  { id: 'rows', label: 'Top and bottom', cells: [[0, 0, 1, .5], [0, .5, 1, .5]] },
];
export function layoutCells(id: SnapLayoutId, size: Viewport): WindowBox[] {
  const edge = (fraction: number, extent: number) => fraction >= 1 - 1e-9 ? extent : Math.round(fraction * extent);
  return SNAP_LAYOUTS.find(l => l.id === id)!.cells.map(([x, y, w, h]) => ({
    left: edge(x, size.width), top: edge(y, size.height),
    width: edge(x + w, size.width) - edge(x, size.width),
    height: edge(y + h, size.height) - edge(y, size.height),
  }));
}
export const cellBox = (cell: WindowBox): WindowBox => ({ left: cell.left + SNAP_GAP / 2, top: cell.top + SNAP_GAP / 2, width: cell.width - SNAP_GAP, height: cell.height - SNAP_GAP });
export const fitsCell = (cell: WindowBox, minimum = SNAP_MINIMUM) => cell.width >= minimum.width + SNAP_GAP && cell.height >= minimum.height + SNAP_GAP;
export const windowKey = (members: readonly string[]) => JSON.stringify([...members].sort());

/** Resize shared edges once, preserving proportions subject to cell minimums. */
export function fitSnapCells(cells: WindowBox[], size: Viewport, minimums: Viewport[]): WindowBox[] | undefined {
  const result = cells.map(c => ({ ...c }));
  for (const [origin, length] of [['left', 'width'], ['top', 'height']] as const) {
    const edges = [...new Set(cells.flatMap(c => [c[origin], c[origin] + c[length]]))].sort((a, b) => a - b);
    const end = edges.length - 1, extent = edges[end];
    if (edges[0] !== 0 || !extent || size[length] <= 0) return undefined;
    const constraints = cells.map((c, i) => ({ a: edges.indexOf(c[origin]), b: edges.indexOf(c[origin] + c[length]), min: (minimums[i] ?? SNAP_MINIMUM)[length] }));
    const low = edges.map(() => 0), high = edges.map(() => size[length]);
    for (let i = 1; i <= end; i++) low[i] = Math.max(low[i - 1], ...constraints.filter(c => c.b === i).map(c => low[c.a] + c.min));
    if (low[end] > size[length]) return undefined;
    for (let i = end - 1; i >= 0; i--) high[i] = Math.min(high[i + 1], ...constraints.filter(c => c.a === i).map(c => high[c.b] - c.min));
    const next = [0];
    for (let i = 1; i < end; i++) {
      const minimum = Math.max(next[i - 1], ...constraints.filter(c => c.b === i).map(c => next[c.a] + c.min));
      next[i] = Math.max(minimum, Math.min(Math.round(edges[i] / extent * size[length]), high[i]));
    }
    next[end] = size[length];
    cells.forEach((c, i) => { const a = edges.indexOf(c[origin]), b = edges.indexOf(c[origin] + c[length]); result[i][origin] = next[a]; result[i][length] = next[b] - next[a]; });
  }
  return result;
}

/** The handle has a small entry zone; an open tray has a wider exit margin. */
export function withinSnapBar(x: number, y: number, size: Viewport, expandedTray?: WindowBox): boolean {
  if (Math.abs(x - size.width / 2) <= 80 && y >= -24 && y <= 48) return true;
  return !!expandedTray && x >= expandedTray.left - 28 && x <= expandedTray.left + expandedTray.width + 28
    && y >= -32 && y <= expandedTray.top + expandedTray.height + 32;
}

/** Small, deliberate pointer zones. Passing beyond the zone remains a free drag. */
export function edgeSnap(x: number, y: number, size: Viewport): { layout: SnapLayoutId; slot: number } | 'picker' | undefined {
  const left = Math.abs(x) <= 20, right = Math.abs(x - size.width) <= 20;
  const top = Math.abs(y) <= 20, bottom = Math.abs(y - size.height) <= 20;
  if ((left && y >= -20 && y < 64) || (top && x >= -20 && x < 64)) return { layout: 'quarters', slot: 0 };
  if ((right && y >= -20 && y < 64) || (top && x > size.width - 64 && x <= size.width + 20)) return { layout: 'quarters', slot: 1 };
  if ((left && y > size.height - 64 && y <= size.height + 20) || (bottom && x >= -20 && x < 64)) return { layout: 'quarters', slot: 2 };
  if ((right && y > size.height - 64 && y <= size.height + 20) || (bottom && x > size.width - 64 && x <= size.width + 20)) return { layout: 'quarters', slot: 3 };
  if (left && y >= 64 && y <= size.height - 64) return { layout: 'halves', slot: 0 };
  if (right && y >= 64 && y <= size.height - 64) return { layout: 'halves', slot: 1 };
  if (top && x >= size.width * .25 && x <= size.width * .75) return 'picker';
}
export type SnapBoundary = { axis: 'x' | 'y'; value: number; start: number; end: number };
export function sharedBoundaries(cells: WindowBox[]): SnapBoundary[] {
  const result: SnapBoundary[] = [];
  for (const axis of ['x', 'y'] as const) {
    const origin = axis === 'x' ? 'left' : 'top', length = axis === 'x' ? 'width' : 'height';
    const cross = axis === 'x' ? 'top' : 'left', span = axis === 'x' ? 'height' : 'width';
    for (const a of cells) for (const b of cells) {
      const value = a[origin] + a[length], start = Math.max(a[cross], b[cross]), end = Math.min(a[cross] + a[span], b[cross] + b[span]);
      if (Math.abs(value - b[origin]) < 1 && end > start) {
        const existing = result.find(r => r.axis === axis && r.value === value);
        if (existing) { existing.start = Math.min(existing.start, start); existing.end = Math.max(existing.end, end); }
        else result.push({ axis, value, start, end });
      }
    }
  }
  return result;
}
/** Move a shared seam, including T junctions, without pushing a neighbour out. */
export function resizeCells(cells: WindowBox[], boundary: SnapBoundary, value: number, minimums: Viewport[]): WindowBox[] {
  const origin = boundary.axis === 'x' ? 'left' : 'top', length = boundary.axis === 'x' ? 'width' : 'height';
  const before = cells.map((c, i) => ({ c, i })).filter(({ c }) => Math.abs(c[origin] + c[length] - boundary.value) < 1);
  const after = cells.map((c, i) => ({ c, i })).filter(({ c }) => Math.abs(c[origin] - boundary.value) < 1);
  if (!before.length || !after.length) return cells;
  const low = Math.max(...before.map(({ c, i }) => c[origin] + (minimums[i] ?? SNAP_MINIMUM)[length] + SNAP_GAP));
  const high = Math.min(...after.map(({ c, i }) => c[origin] + c[length] - (minimums[i] ?? SNAP_MINIMUM)[length] - SNAP_GAP));
  if (low > high) return cells;
  const nextValue = Math.max(low, Math.min(value, high));
  return cells.map(c => {
    if (Math.abs(c[origin] + c[length] - boundary.value) < 1) return { ...c, [length]: nextValue - c[origin] };
    if (Math.abs(c[origin] - boundary.value) < 1) return { ...c, [origin]: nextValue, [length]: c[length] + c[origin] - nextValue };
    return { ...c };
  });
}
