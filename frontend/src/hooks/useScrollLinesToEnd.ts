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
    if (!el) return;
    const toEnd = () => { el.scrollTop = el.scrollHeight; };
    toEnd();

    // The grid can still change size just after this (card height measured, balances and banners
    // arriving), which left it a few pixels short of the end. Hold the end while it settles; the
    // user's first scroll, click or key press lets go at once.
    const observer = new ResizeObserver(toEnd);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    const userEvents = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;
    const release = () => {
      observer.disconnect();
      clearTimeout(timer);
      userEvents.forEach(name => window.removeEventListener(name, release, true));
    };
    const timer = setTimeout(release, 1500);
    userEvents.forEach(name => window.addEventListener(name, release, true));
    return release;
  }, [docKey, lineCount]);

  return containerRef;
}
