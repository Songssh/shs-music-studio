/** A visible background tool must not consume the active tool's shortcuts. */
export function workspaceOwnsKeyboard(id: string): boolean {
  const active = document.querySelector<HTMLElement>('[data-workspace-active]')?.dataset.workspaceActive;
  return !active || active === id;
}
export function editorOwnsKeyboard(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return e.defaultPrevented || e.isComposing || e.keyCode === 229 ||
    !!el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]:not([aria-modal="false"]), dialog[open]') ||
    !!document.querySelector('[aria-modal="true"], dialog[open]');
}
