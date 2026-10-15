/**
 * Keyboard shortcuts for the document action bar (DocumentToolbar) on the data entry pages, mapping
 * agreed with the user 2026-10-16. Alt+letter named after the button. Print joins the existing
 * app-wide print key Alt+V (G-09) rather than taking Ctrl+P, so one key prints everywhere.
 * Shift/Ctrl+Enter are left alone: the entry grids already use them to add a row.
 */

export type ToolbarActionId =
  | 'newAction' | 'remove' | 'editRow' | 'edit' | 'save' | 'done' | 'cancel'
  | 'first' | 'prev' | 'next' | 'last' | 'print' | 'find'
  | 'unpost' | 'post' | 'exit' | 'saveAndPost' | 'postAll';

interface Shortcut {
  /** KeyboardEvent.code, so the key works on any keyboard layout. */
  code: string;
  shift?: boolean;
  /** Shown in the button's tooltip. */
  hint: string;
}

export const TOOLBAR_SHORTCUTS: Record<ToolbarActionId, Shortcut> = {
  newAction: { code: 'KeyN', hint: 'Alt+N' },
  remove: { code: 'Delete', hint: 'Alt+Delete' },
  editRow: { code: 'KeyR', hint: 'Alt+R' },
  edit: { code: 'KeyE', hint: 'Alt+E' },
  save: { code: 'KeyS', hint: 'Alt+S' },
  done: { code: 'KeyD', hint: 'Alt+D' },
  cancel: { code: 'KeyC', hint: 'Alt+C' },
  first: { code: 'Home', hint: 'Alt+Home' },
  prev: { code: 'ArrowLeft', hint: 'Alt+←' },
  next: { code: 'ArrowRight', hint: 'Alt+→' },
  last: { code: 'End', hint: 'Alt+End' },
  print: { code: 'KeyV', hint: 'Alt+V' },
  find: { code: 'KeyF', hint: 'Alt+F' },
  unpost: { code: 'KeyU', hint: 'Alt+U' },
  post: { code: 'KeyP', hint: 'Alt+P' },
  exit: { code: 'KeyX', hint: 'Alt+X' },
  saveAndPost: { code: 'KeyA', hint: 'Alt+A' },
  postAll: { code: 'KeyP', shift: true, hint: 'Alt+Shift+P' },
};

export interface ShortcutKeyEvent {
  code: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** Which action bar button this keystroke presses, if any. Alt only: Ctrl+Alt is AltGr on some layouts. */
export function matchToolbarShortcut(e: ShortcutKeyEvent): ToolbarActionId | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  for (const [id, s] of Object.entries(TOOLBAR_SHORTCUTS) as [ToolbarActionId, Shortcut][]) {
    if (s.code === e.code && !!s.shift === e.shiftKey) return id;
  }
  return null;
}

/**
 * The visible, enabled "Show Print Preview" button on screen, if any (G-09's Alt+V target). A
 * hidden tab's button has offsetParent null, so it never fires a preview that isn't on screen.
 */
export function findVisiblePreviewButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => !b.disabled && b.offsetParent !== null && !!b.textContent?.trim().includes('Show Print Preview'),
  );
}
