/**
 * Window-zoom constants and persistence, shared by the header control (components/ZoomControl.tsx)
 * and the app bootstrap (main.tsx), which has to re-apply the saved level before the first render.
 *
 * They live here rather than in the component so there is exactly one definition of "what level is
 * this machine at" — and so main.tsx isn't importing helpers out of a component file, which also
 * costs the component its react-refresh fast-reload guarantee.
 */

// Chrome's own ladder, trimmed to a sensible working range. It matters that both 90% (the shipped
// default) and 100% are exact stops, so the two most common levels are always reachable in whole
// steps rather than landing between them.
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5] as const;

export const ZOOM_STORAGE_KEY = 'wento_zoom_factor';

// A fresh install starts smaller than 100%: Windows commonly runs at 125% display scaling, and this
// UI is built in fixed pixels, so out of the box it renders larger than intended and less fits on
// screen than should. Shipping at 80% means the client never has to discover the control to get a
// usable view — a starting point, not a ceiling.
export const DEFAULT_ZOOM = 0.8;

/** Snaps any factor onto the ladder, so the label and the window can never disagree. */
export function nearestStep(factor: number): number {
  return ZOOM_STEPS.reduce((best, step) => (
    Math.abs(step - factor) < Math.abs(best - factor) ? step : best
  ));
}

/** This machine's saved level, or the shipped default on a first-ever launch. */
export function readStoredZoom(): number {
  const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_ZOOM;
  // Anything off the ladder (hand-edited, or written by an older build) is pulled back onto it
  // rather than trusted — the main process clamps too, but a clamp alone would leave the stored
  // value and the actual window out of step.
  return nearestStep(parsed);
}
