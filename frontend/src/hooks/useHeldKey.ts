import { useEffect, useRef } from 'react';

/**
 * Whether `key` is CURRENTLY physically held down, tracked via window-level keydown/keyup.
 *
 * Returns a ref rather than state on purpose: reading "is '.' held right now, at the instant Enter
 * is being pressed" needs the value at that exact instant, not a value that only updates a render
 * later — a ref is readable synchronously inside another key's own event handler; state wouldn't be.
 *
 * Only meant for a plain character key like '.', not an actual modifier (Shift/Ctrl/Alt/Meta —
 * those are already exposed per-event as e.shiftKey/e.ctrlKey/etc., with no tracking needed).
 *
 * Reset on window blur / visibilitychange as a safety net: if focus leaves the window (alt-tab,
 * clicking another app) while the key is physically down, the OS can swallow its keyup entirely, and
 * without this the tracked state would stay stuck "held" forever afterward.
 */
export function useHeldKey(key: string) {
  const held = useRef(false);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.key === key) held.current = true; };
    const onUp = (e: KeyboardEvent) => { if (e.key === key) held.current = false; };
    const reset = () => { held.current = false; };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, [key]);

  return held;
}
