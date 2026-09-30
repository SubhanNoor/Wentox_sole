import { useCallback, useRef } from 'react';

/**
 * Runs async tasks one at a time, in order, skipping any that a newer call has already replaced —
 * so whatever the user chose LAST is always what ends up applied.
 *
 * WHY: every document page auto-opens its newest unposted record once its lookups load, by running
 * the same handler as picking "Unposted" in the dropdown. Picking "Posted" while that was still
 * loading started a second load in parallel, and whichever finished last won — often the draft,
 * leaving it on screen after the user had asked for Posted (found by the real-screen tests,
 * 2026-09-30). Queuing the loads makes the newest choice always finish last.
 *
 * hasRun() covers the other half: the auto-open waits for lookups (stores etc.), so it can START
 * after the user has already picked something — the page asks hasRun() first and skips it then.
 */
export function useLatestOnly() {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(0);
  const run = useCallback(<T>(task: () => Promise<T>): Promise<T | undefined> => {
    const mine = ++latest.current;
    const result = queue.current.then(() => (mine === latest.current ? task() : undefined));
    queue.current = result.catch(() => {});
    return result;
  }, []);
  const hasRun = useCallback(() => latest.current > 0, []);
  return { run, hasRun };
}
