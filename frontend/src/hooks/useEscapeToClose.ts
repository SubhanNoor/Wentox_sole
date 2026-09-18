import { useEffect, useRef } from 'react';

/**
 * changes-14-09-26.md G-07, per the client 2026-09-14: "Pressing Escape closes the topmost popup,
 * modal, dialog, search overlay, confirmation box, or secondary window." Implemented ONCE here, in
 * the shared layer, per the item's own instruction — every dialog calls this instead of rolling its
 * own `onKeyDown={e => e.key === 'Escape' && ...}` handler.
 *
 * Why a global stack rather than an `onKeyDown` on each modal's own wrapper div (the pattern
 * ConfirmModal/PasswordPromptModal used before this): an `onKeyDown` only fires when the currently
 * FOCUSED element is inside that div, which silently breaks the moment a modal is opened without
 * moving focus into it, or when focus is later tabbed/clicked outside it while it's still open.
 * A single document-level listener has none of that fragility, and — the actual point of this
 * hook — makes the "nested case: Escape closes only the TOPMOST layer, one layer per press" rule
 * automatic: every open dialog pushes its own close callback onto one shared stack in mount order,
 * so the most-recently-opened one is always last, and a single Escape press pops and calls only
 * that one. The layer underneath is never touched by the same keypress, regardless of whether the
 * two dialogs happen to be siblings, portaled, or nested in the DOM — ordering comes from the stack,
 * not from DOM structure or focus.
 *
 * The unsaved-work case (per the item: "Escape routes into that same guard ... rather than
 * discarding silently") needs no special handling here — pass whatever `onClose` the dialog's own
 * Cancel/X button already calls. If that button already asks "discard changes?" before closing,
 * Escape asks the same question, because it calls the exact same function.
 */
const escapeStack: Array<() => void> = [];

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || escapeStack.length === 0) return;
    e.stopPropagation();
    escapeStack[escapeStack.length - 1]();
  });
}

export function useEscapeToClose(isOpen: boolean, onClose: () => void) {
  // Always calls the LATEST onClose, even though the pushed callback identity is stable for the
  // whole time this dialog is open — avoids a stale closure (e.g. capturing state from the instant
  // the dialog opened) without pushing/popping the stack on every render a caller's onClose happens
  // to be a fresh inline function.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const handler = () => onCloseRef.current();
    escapeStack.push(handler);
    return () => {
      const idx = escapeStack.lastIndexOf(handler);
      if (idx !== -1) escapeStack.splice(idx, 1);
    };
  }, [isOpen]);
}
