import type React from 'react';

/**
 * Keeps the Master/Detail edit-scope radios pointing at whichever half of the form the user is
 * actually working in, so the scope never has to be set by hand before pressing Edit (per the
 * user, 2026-09-04: "when we go to the detail section the radio button auto moves to the
 * respective section").
 *
 * Delegated rather than wired field by field: every entry page has a different header grid and a
 * different entry strip, so this reads the section off the DOM instead. Mark the two regions with
 * `data-edit-scope="master"` / `data-edit-scope="detail"` and spread the returned props on the
 * page wrapper — anything inside a marked region moves the radios to it.
 *
 * Listens on BOTH mousedown and focus, in the capture phase:
 *   - focus alone is not enough. Whichever half the scope is NOT on is `disabled` while editing,
 *     and a disabled control cannot take focus — so there would be no way back to the other half.
 *   - mousedown still reaches the surrounding container (a click on a disabled input itself fires
 *     nothing, but the label/padding around it does), which is what makes the return trip work.
 * Capture phase so it runs before a field's own handler moves focus somewhere else.
 */
export function useAutoEditScope(
  setEditScope: (scope: 'master' | 'detail') => void,
): { onMouseDownCapture: React.MouseEventHandler; onFocusCapture: React.FocusEventHandler } {
  const apply = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const region = target.closest('[data-edit-scope]');
    const scope = region?.getAttribute('data-edit-scope');
    if (scope === 'master' || scope === 'detail') setEditScope(scope);
  };
  return {
    onMouseDownCapture: e => apply(e.target),
    onFocusCapture: e => apply(e.target),
  };
}
