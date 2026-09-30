import { useLayoutEffect } from 'react';

/**
 * Keeps a document page's Posted/Unposted dropdown in step with the document actually on screen.
 *
 * WHY: the loaded document (its id and posted flag) is a usePersistentField, so it comes back when
 * the page is reopened — but the dropdown is plain useState and always remounts on 'unposted'. So
 * reopening a page that was left on a posted bill showed that posted bill under "Unposted"
 * (reported by the user, 2026-09-30), and the nav buttons then paged a list the bill wasn't in.
 * The same mismatch could happen the other way round whenever a document was reached without going
 * through the dropdown (Find, Unpost, a sidebar click).
 *
 * Keyed on the document's id and posted flag only — never on the filter itself — so a deliberate
 * dropdown change isn't undone while its own list is still loading. Layout effect, so the wrong
 * label never paints for a frame on remount.
 *
 * A blank page (docKey null) leaves the filter alone — each page's own handleNew puts it back on
 * 'unposted' when it clears to a blank document, which is also why New is enabled on Posted now.
 *
 * docKey: the loaded document's id, or null/undefined when nothing is loaded (a blank New page).
 */
export function useBrowseFilterFollowsDocument(
  docKey: unknown,
  isPosted: boolean,
  setFilter: (filter: 'posted' | 'unposted') => void,
) {
  useLayoutEffect(() => {
    if (docKey == null) return;
    setFilter(isPosted ? 'posted' : 'unposted');
    // setFilter is a stable useState setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, isPosted]);
}
