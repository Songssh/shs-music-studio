import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Check, LayoutGrid, X } from 'lucide-react';
import { SNAP_LAYOUTS, SNAP_MINIMUM, fitsCell, layoutCells, type SnapLayoutId } from './snapLayouts';
import type { SnapController } from './dockviewSnap';
import { WINDOWS, windowTitle } from './registry';

export function SnapLayoutControls({ controller }: { controller: SnapController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const menu = state.menu;
  const bar = state.bar;
  const kind = bar ? 'drag-picker' : menu?.kind;
  const visible = !!menu || !!bar;
  useLayoutEffect(() => {
    if (!visible || !panel.current) return;
    const node = panel.current, prior = document.activeElement as HTMLElement | null;
    node.showPopover();
    const outside = (event: PointerEvent) => { if (!controller.getSnapshot().bar && event.target instanceof Node && !node.contains(event.target) && !(event.target instanceof Element && event.target.closest('.ws-snap-trigger'))) controller.closeMenu(); };
    document.addEventListener('pointerdown', outside, true);
    return () => { document.removeEventListener('pointerdown', outside, true); if (node.matches(':popover-open')) node.hidePopover(); if (prior?.isConnected && node.contains(document.activeElement)) prior.focus({ preventScroll: true }); };
  }, [visible, controller]);
  useLayoutEffect(() => {
    if (kind === 'arrange' || kind === 'assist' || (kind === 'picker' && menu?.pinned)) panel.current?.querySelector<HTMLButtonElement>('[data-snap-slot]:not(:disabled)')?.focus();
  }, [kind, menu?.pinned]);
  const current = state.choices.find(c => c.key === (bar?.key ?? menu?.key));
  const label = (id: SnapLayoutId) => t(`workspace.snap.layout.${id}`, SNAP_LAYOUTS.find(l => l.id === id)!.label);
  const grid = (compact = false) => <div className={`ws-snap-layouts ${compact ? 'compact' : ''}`}>
    {SNAP_LAYOUTS.filter(l => kind !== 'assist' || l.id === menu?.layout).map(layout => {
      const cells = layoutCells(layout.id, state.size), usable = cells.every(c => fitsCell(c));
      return <div className={`ws-snap-layout ${menu?.layout === layout.id ? 'selected' : ''}`} key={layout.id}>
        <div className="ws-snap-diagram" aria-label={label(layout.id)}>{layout.cells.map(([x, y, width, height], slot) => {
          const occupied = kind === 'assist' && controller.occupied(menu!.session!, slot);
          const disabled = !usable || !!occupied || ((kind === 'picker' || kind === 'drag-picker') && !fitsCell(cells[slot], current?.minimum ?? SNAP_MINIMUM));
          return <button key={slot} type="button" data-snap-layout={layout.id} data-snap-slot={slot} disabled={disabled}
            data-drag-target={bar?.target?.layout === layout.id && bar.target.slot === slot ? 'true' : undefined} tabIndex={bar ? -1 : undefined}
            aria-label={`${label(layout.id)} · ${t('workspace.snap.region', 'Region')} ${slot + 1}`}
            title={disabled && !occupied ? t('workspace.snap.tooSmall', 'Not enough room for the minimum window size') : undefined}
            aria-pressed={kind === 'assist' ? menu?.slot === slot : kind === 'arrange' ? menu?.layout === layout.id : undefined}
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }}
            onPointerEnter={() => controller.previewSlot(layout.id, slot)} onFocus={() => controller.previewSlot(layout.id, slot)}
            onClick={() => kind === 'arrange' ? controller.arrangeLayout(layout.id) : kind === 'assist' ? controller.assistSlot(slot) : controller.choose(layout.id, slot)}>
            {occupied ? <Check size={12} /> : <span>{slot + 1}</span>}
          </button>;
        })}</div><span className="ws-snap-layout-label">{label(layout.id)}</span>
      </div>;
    })}
  </div>;
  const capacity = SNAP_LAYOUTS.find(l => l.id === menu?.layout)?.cells.length ?? 0;
  const candidates = kind === 'assist' ? controller.candidates() : state.choices;
  const selected = menu?.selected ?? [];
  const arranged = menu ? layoutCells(menu.layout, state.size) : [];
  const validSelection = selected.length > 0 && arranged.every(c => fitsCell(c)) && selected.every((key, i) => fitsCell(arranged[i], state.choices.find(c => c.key === key)?.minimum ?? SNAP_MINIMUM));
  const width = Math.min(kind === 'arrange' ? 520 : 364, window.innerWidth - 24);
  const left = bar ? state.origin.left + state.size.width / 2 : menu ? Math.max(12, Math.min(state.origin.left + menu.anchor.left, window.innerWidth - width - 12)) : 0;
  const top = bar ? state.origin.top : menu ? Math.max(12, Math.min(state.origin.top + menu.anchor.top, window.innerHeight - (kind === 'arrange' ? 650 : 460) - 12)) : 0;
  return createPortal(<>
    {state.preview && <div className="ws-snap-preview" data-testid="snap-preview" aria-hidden="true" style={{ left: state.origin.left + state.preview.left, top: state.origin.top + state.preview.top, width: state.preview.width, height: state.preview.height }} />}
    {state.dividers.map((boundary, index) => <div key={`${boundary.session}-${boundary.axis}-${index}`} data-snap-session={boundary.session} className={`ws-snap-divider ${boundary.axis}`} role="separator" tabIndex={0}
      aria-label={t('workspace.snap.resize', 'Resize adjacent snapped windows')} aria-orientation={boundary.axis === 'x' ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(boundary.value)}
      style={boundary.axis === 'x' ? { left: state.origin.left + boundary.value - 4, top: state.origin.top + boundary.start + 8, width: 8, height: boundary.end - boundary.start - 16 } : { left: state.origin.left + boundary.start + 8, top: state.origin.top + boundary.value - 4, width: boundary.end - boundary.start - 16, height: 8 }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); controller.dragDivider(boundary.session, boundary, event.nativeEvent); }}
      onKeyDown={event => { const delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -10 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? 10 : 0; if (delta) { event.preventDefault(); controller.resizeDivider(boundary.session, boundary, boundary.value + delta * (event.shiftKey ? 4 : 1)); } }} />)}
    {visible && <div ref={panel} popover="manual" className={`ws-snap-popover ${kind} ${bar ? 'ws-snap-bar' : ''}`} data-expanded={bar?.expanded} role={bar ? 'presentation' : 'dialog'} aria-hidden={bar ? true : undefined} aria-label={kind === 'arrange' ? t('workspace.snap.arrange', 'Arrange windows') : t('workspace.snap.title', 'Snap layouts')}
      style={{ left, top, width, maxHeight: window.innerHeight - top - 12 }} onPointerEnter={controller.keepMenu} onPointerLeave={controller.leaveMenu}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); controller.closeMenu(); }
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && event.target instanceof HTMLElement && event.target.hasAttribute('data-snap-slot')) {
          event.preventDefault(); const buttons = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>('[data-snap-slot]:not(:disabled)')); const i = buttons.indexOf(event.target as HTMLButtonElement); buttons[(i + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
      }}>
      {bar && <div className="ws-snap-bar-handle"><span /></div>}
      <div className={bar ? 'ws-snap-bar-reveal' : undefined}><div className={bar ? 'ws-snap-bar-clip' : undefined}><div className={bar ? 'ws-snap-bar-content' : undefined}>
      <header><LayoutGrid size={17} /><strong>{kind === 'assist' ? t('workspace.snap.assist', 'Fill the remaining space') : kind === 'arrange' ? t('workspace.snap.arrange', 'Arrange windows') : t('workspace.snap.title', 'Snap layouts')}</strong>{!bar && <button aria-label={t('workspace.snap.dismiss', 'Close layout menu')} onClick={controller.closeMenu}><X size={16} /></button>}</header>
      <p>{kind === 'arrange' ? t('workspace.snap.arrangeHint', 'Choose windows in placement order. Unselected windows stay where they are.') : kind === 'assist' ? t('workspace.snap.assistHint', 'Pick a region, then a window. Minimized windows restore only when selected.') : kind === 'drag-picker' ? t('workspace.snap.dropHint', 'Move over a region and release. Escape cancels.') : t('workspace.snap.pickHint', 'Choose a region for this entire window.')}</p>
      {grid()}
      {menu && (kind === 'arrange' || kind === 'assist') && <div className="ws-snap-choices">
        {kind === 'arrange' && <div className="ws-snap-order">{selected.map((key, i) => {
          const item = state.choices.find(c => c.key === key); if (!item) return null;
          return <div key={key}><b>{i + 1}</b><span>{windowTitle(item.active)}</span><button disabled={i === 0} aria-label={t('workspace.snap.earlier', 'Move earlier')} onClick={() => controller.reorder(key, -1)}><ArrowUp size={14} /></button><button disabled={i === selected.length - 1} aria-label={t('workspace.snap.later', 'Move later')} onClick={() => controller.reorder(key, 1)}><ArrowDown size={14} /></button></div>;
        })}</div>}
        {candidates.map(item => {
          const slot = kind === 'assist' ? menu.slot : Math.max(0, selected.indexOf(item.key) >= 0 ? selected.indexOf(item.key) : selected.length);
          const disabled = kind === 'assist' ? !fitsCell(arranged[slot], item.minimum) : !selected.includes(item.key) && selected.length >= capacity;
          return <button className="ws-snap-choice" key={item.key} data-snap-window={item.active} disabled={disabled} aria-pressed={kind === 'arrange' ? selected.includes(item.key) : undefined}
            onClick={() => kind === 'assist' ? controller.assistWindow(item.key) : controller.selectWindow(item.key)}>
            <i>{WINDOWS.find(w => w[0] === item.active)?.[2] ?? '▤'}</i><span><strong>{windowTitle(item.active)}</strong><small>{item.members.length > 1 ? `${item.members.length} ${t('workspace.snap.tabs', 'tabs')} · ` : ''}{item.minimized ? t('workspace.snap.minimized', 'Minimized') : item.members.map(windowTitle).join(' · ')}</small></span>{selected.includes(item.key) && <Check size={15} />}
          </button>;
        })}
        {!candidates.length && <p>{t('workspace.snap.noWindows', 'No other windows. Empty regions will stay empty.')}</p>}
      </div>}
      {menu && !bar && <footer>{kind === 'arrange' ? <><span>{selected.length} / {capacity}</span><button className="primary" disabled={!validSelection} onClick={controller.arrange}>{t('workspace.snap.apply', 'Apply arrangement')}</button></> : kind === 'assist' ? <button onClick={controller.closeMenu}>{t('workspace.snap.leaveEmpty', 'Leave remaining space empty')}</button> : <button disabled={!menu.key || !state.snapped.includes(menu.key)} onClick={() => menu.key && controller.unsnap(menu.key)}>{t('workspace.snap.unsnap', 'Restore pre-snap size')}</button>}
        {kind !== 'drag-picker' && <button disabled={!state.canUndo} onClick={controller.undo}>{t('workspace.snap.undo', 'Restore previous arrangement')}</button>}
      </footer>}
      </div></div></div>
    </div>}
  </>, document.body);
}
