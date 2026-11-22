import { useLayoutEffect, useRef } from 'react';

// Document page standard §5 (per the user, 2026-11-18): when a saved voucher is put on screen —
// reopening the window, First/Pre./Next/Last, Find, Unposted/Posted — its lines grid opens
// scrolled to the END, so the last line entered is what shows.
//
// Fires once per document: when `docKey` (the voucher's id) changes and its lines have arrived.
// Committing, editing or deleting a line on the same voucher never re-fires it — the ▶ marker's
// own scrollIntoView handles those. Attach the returned ref to the grid's scrolling container.
export function useScrollLinesToEnd<T extends HTMLElement = HTMLDivElement>(docKey: unknown, lineCount: number) {
  const containerRef = useRef<T>(null);
  const scrolledFor = useRef<unknown>(undefined);

  useLayoutEffect(() => {
    if (docKey == null) {
      scrolledFor.current = undefined;
      return;
    }
    if (lineCount === 0 || scrolledFor.current === docKey) return;
    scrolledFor.current = docKey;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [docKey, lineCount]);

  return containerRef;
}
