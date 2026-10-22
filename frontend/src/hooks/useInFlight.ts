import { useCallback, useRef, useState } from 'react';

/**
 * One action at a time for a dialog's Confirm button (2026-10-22): a quick double-click sent the
 * same cheque bounce twice before the first had answered. `run` ignores a call while the previous
 * one is still in flight — checked on a ref, because a second click can land before React has
 * re-rendered the button as disabled — and `busy` is for that `disabled`.
 */
export function useInFlight(): [boolean, (action: () => Promise<unknown>) => Promise<void>] {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  return [busy, run];
}
