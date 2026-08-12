import { useCallback, useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import * as api from '@/lib/api';
import { ZOOM_STEPS, ZOOM_STORAGE_KEY, nearestStep, readStoredZoom } from '@/lib/zoom';

/**
 * Whole-window zoom, the same thing Ctrl +/- does in a browser.
 *
 * It goes through Electron's own `webContents.setZoomFactor` (via the zoom: channel) rather than a
 * CSS transform or the CSS `zoom` property. The app shell is `h-screen` + `overflow-hidden`, and
 * CSS zoom scales the content while `100vh` carries on measuring the UNZOOMED viewport — so the
 * shell would grow past the window and clip its own bottom edge. Native zoom leaves every layout
 * calculation alone.
 *
 * The chosen level is remembered per machine (lib/zoom.ts) and re-applied by main.tsx before the
 * first render, so a relaunch opens at the right size instead of visibly resizing on the way in.
 */

export default function ZoomControl() {
  const [factor, setFactor] = useState<number>(readStoredZoom);

  // Persist and apply in one place, so the stored value is always what the window was actually set
  // to — the main process returns the factor it applied after its own clamp, and that is what gets
  // written, never the value we asked for.
  const apply = useCallback(async (next: number) => {
    const target = nearestStep(next);
    setFactor(target);
    const res = await api.zoom.set(target);
    const applied = res.ok ? res.data.factor : target;
    setFactor(applied);
    localStorage.setItem(ZOOM_STORAGE_KEY, String(applied));
  }, []);

  const index = ZOOM_STEPS.indexOf(nearestStep(factor) as typeof ZOOM_STEPS[number]);
  const canZoomOut = index > 0;
  const canZoomIn = index < ZOOM_STEPS.length - 1;

  // Ctrl/Cmd +, −, 0. These accelerators used to belong to Electron's default menu, whose zoom
  // roles are deliberately gone (see main.js#buildMenu) — otherwise one keypress would fire both
  // paths and move the window two steps while this label moved one.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      // '=' is the unshifted key that carries '+' on most layouts; both are accepted so Ctrl+= and
      // Ctrl+Shift+= behave the same, as they do in a browser.
      if (e.key === '+' || e.key === '=') { e.preventDefault(); apply(ZOOM_STEPS[Math.min(index + 1, ZOOM_STEPS.length - 1)]); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); apply(ZOOM_STEPS[Math.max(index - 1, 0)]); }
      else if (e.key === '0') { e.preventDefault(); apply(1.0); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [apply, index]);

  const btn = 'p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-default cursor-pointer text-slate-500 hover:bg-slate-100 hover:text-slate-800';

  return (
    <div
      data-no-print
      className="flex items-center gap-0.5 rounded-lg border bg-white px-1 py-0.5"
      style={{ borderColor: 'var(--border-color)' }}
      title="Zoom (Ctrl + / Ctrl − / Ctrl 0)"
    >
      <button type="button" className={btn} onClick={() => apply(ZOOM_STEPS[index - 1])} disabled={!canZoomOut} title="Zoom out (Ctrl −)">
        <Minus size={14} />
      </button>
      <button
        type="button"
        onClick={() => apply(1.0)}
        title="Reset to 100% (Ctrl 0)"
        className="min-w-[44px] text-center text-[11px] font-bold tabular-nums text-slate-600 hover:text-[#B08D57] cursor-pointer"
      >
        {Math.round(factor * 100)}%
      </button>
      <button type="button" className={btn} onClick={() => apply(ZOOM_STEPS[index + 1])} disabled={!canZoomIn} title="Zoom in (Ctrl +)">
        <Plus size={14} />
      </button>
    </div>
  );
}
