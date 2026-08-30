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
 * Persisting the latter would resurrect stale UI chrome across restarts, which is worse than
 * losing it.
 *
 * pageKey: unique per page/document-type (e.g. 'stock-voucher', 'product-setup-register').
 * fieldKey: unique per field on that page (e.g. 'remarks', 'lines', 'formValues').
 *
 * A page MUST call the paired clearPageDraft(pageKey) (or useClearPageDraft below) once a
 * document is actually saved/posted/deleted — otherwise the next "New" reopens to a stale draft
 * instead of a blank form.
 */
export function usePersistentField<T>(pageKey: string, fieldKey: string, initial: T) {
  const { state, dispatch } = useApp();
  const draftPage = state.pageDrafts[pageKey] as Record<string, unknown> | undefined;
  const stored = draftPage ? draftPage[fieldKey] : undefined;
  const [value, setValue] = useState<T>(stored !== undefined ? (stored as T) : initial);

  // Skip the write-through on the very first render — nothing changed yet, and it would just
  // re-save the value we *just* read back, or clobber a still-loading initial value with the
  // hook's own default before a caller's own hydration effect (e.g. loading an existing record)
  // has run.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    dispatch({ type: 'SET_PAGE_DRAFT_FIELD', page: pageKey, field: fieldKey, value });
    // pageKey/fieldKey are treated as constant for a given call site — only `value` should
    // re-trigger the write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return [value, setValue] as const;
}

/** Clears every persisted field for one page — call after a real save/post/delete succeeds. */
export function useClearPageDraft(pageKey: string) {
  const { dispatch } = useApp();
  return () => dispatch({ type: 'CLEAR_PAGE_DRAFT', page: pageKey });
}
