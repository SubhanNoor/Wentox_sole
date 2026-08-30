import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';

/**
 * A useState replacement whose value also survives switching pages AND an app restart, by
 * mirroring it into AppContext's `pageDrafts` slice (itself synced to localStorage — see
 * AppContext.tsx's SET_PAGE_DRAFT_FIELD/loadPageDrafts/savePageDrafts).
 *
 * WHY: this app mounts exactly one page component at a time (App.tsx keys off state.currentPage)
 * — switching pages fully unmounts the previous one, so anything kept in a plain useState is
 * gone. Reading the initial value from (and writing every change back to) the Provider's own
 * state instead survives that unmount, because the Provider never unmounts.
 *
 * USE FOR real form DATA the user typed (text fields, picked ids, line items, quantities) —
 * NEVER for transient UI state (is a modal open, a search-dropdown open, a loading flag, a ref).
 *
 * pageKey: unique per page/document-type (e.g. 'stock-voucher', 'product-setup-register').
 * fieldKey: unique per field on that page (e.g. 'remarks', 'lines', 'formValues').
 *
 * ── The "no draft" vs "blank draft" distinction (do not remove) ──
 * A field only ever writes to the store once its value actually DIFFERS from the default it
 * mounted with. Without that rule every mount would immediately persist the page's own defaults,
 * so `useHasPageDraft` below could never tell "the user has unsaved work here" apart from "this
 * page has simply been visited" — and the pages' own auto-initialize effects (which gate on it)
 * would be suppressed forever, breaking defaults like auto-selecting the first store.
 */

// Pages whose draft was just cleared (see useClearPageDraft). A page's own reset-to-blank runs in
// the same event as the clear, so its setters would otherwise re-create the draft from the values
// it is resetting to — React flushes those effects before the timeout below releases the key.
const suppressedPages = new Set<string>();

// Values here are all JSON-serializable (they round-trip through localStorage), so a stringify
// comparison is a sound deep-equal and handles the object/array fields (line items, entry rows).
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function usePersistentField<T>(pageKey: string, fieldKey: string, initial: T) {
  const { state, dispatch } = useApp();
  const draftPage = state.pageDrafts[pageKey] as Record<string, unknown> | undefined;
  const stored = draftPage ? draftPage[fieldKey] : undefined;
  const [value, setValue] = useState<T>(stored !== undefined ? (stored as T) : initial);

  // The default this field mounted with. `stored` itself is read straight from the closure below
  // rather than mirrored into a ref: the effect re-runs on every `value` change, so it always
  // closes over the current render's `stored` — and after a clear that is `undefined` again, which
  // is what re-arms the "don't persist the default" rule instead of the page's own reset writing
  // a fresh draft.
  const initialRef = useRef(initial);

  // Skip the write-through on the very first render — nothing has changed yet, and it would just
  // re-save the value we only just read back.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (suppressedPages.has(pageKey)) return;
    // Nothing stored yet AND the value is still the mount-time default → this is the page
    // initializing itself, not the user typing. Don't create a draft out of it.
    if (stored === undefined && sameValue(value, initialRef.current)) return;
    dispatch({ type: 'SET_PAGE_DRAFT_FIELD', page: pageKey, field: fieldKey, value });
    // pageKey/fieldKey are constant for a given call site — only `value` should re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return [value, setValue] as const;
}

/**
 * True when this page had genuine unsaved work in the store at the moment it mounted.
 *
 * Captured once, at mount, on purpose: pages use it to gate their "auto-start a new document
 * once the lookups have loaded" effects, which fire asynchronously a beat AFTER mount. A live
 * value would flip as the user types and re-enable that effect mid-entry, wiping the very data
 * this is meant to protect.
 */
export function useHasPageDraft(pageKey: string): boolean {
  const { state } = useApp();
  // useState's lazy initializer is the idiomatic "evaluate once, at mount, and never again" —
  // a ref would have to be written during render, which React forbids.
  const [atMount] = useState(() => {
    const draft = state.pageDrafts[pageKey] as Record<string, unknown> | undefined;
    return !!draft && Object.keys(draft).length > 0;
  });
  return atMount;
}

/**
 * Clears every persisted field for one page — call after a real save/post/delete succeeds, and
 * from a user-initiated "New". Must NOT be reachable from a page's auto-initialize-on-mount path,
 * or returning to the page would wipe the draft it just restored.
 */
export function useClearPageDraft(pageKey: string) {
  const { dispatch } = useApp();
  return () => {
    suppressedPages.add(pageKey);
    dispatch({ type: 'CLEAR_PAGE_DRAFT', page: pageKey });
    // Released after React has flushed the effects belonging to this same update, so the reset
    // values the caller is writing alongside the clear don't immediately re-create the draft.
    setTimeout(() => suppressedPages.delete(pageKey), 0);
  };
}
