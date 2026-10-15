import { useCallback, useEffect, useRef, useState } from 'react';
import { AppWindow, Minimize2 } from 'lucide-react';
import * as api from '@/lib/api';
import type { OpenWindowRow } from '@/lib/api';

// Cheap to poll: windows:list is an in-process lookup in the main process, no database involved.
const POLL_INTERVAL_MS = 3_000;

/**
 * The main window's list of every open child window (per the user, 2026-10-11), so a document
 * window that ended up behind something, or minimized, can be brought straight back without going
 * through the OS window switcher. Picking one restores it if minimized and focuses it.
 */
export default function OpenWindowsMenu() {
  const [open, setOpen] = useState(false);
  const [windows, setWindows] = useState<OpenWindowRow[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await api.listOpenWindows();
    if (res.ok) setWindows(res.data);
  }, []);

  useEffect(() => {
    api.listOpenWindows().then(res => { if (res.ok) setWindows(res.data); });
    const id = setInterval(load, POLL_INTERVAL_MS);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function toggle() {
    if (!open) load();
    setOpen(!open);
  }

  async function bringForward(win: OpenWindowRow) {
    setOpen(false);
    await api.focusOpenWindow(win.id);
    load();
  }

  return (
    <div className="relative" ref={panelRef} data-no-print>
      <button
        onClick={toggle}
        className="relative flex items-center justify-center rounded-lg transition-colors hover:bg-slate-100"
        style={{ width: 36, height: 36 }}
        title="Open Windows"
        aria-label={`Open windows${windows.length ? ` (${windows.length})` : ''}`}
      >
        <AppWindow size={19} color="var(--dark-heading)" />
        {windows.length > 0 && (
          <span
            className="absolute flex items-center justify-center rounded-full font-bold text-white"
            style={{
              top: 2, right: 2, minWidth: 16, height: 16, fontSize: 10, padding: '0 4px',
              background: 'var(--brand-navy)'
            }}
          >
            {windows.length > 99 ? '99+' : windows.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 rounded-xl border bg-white overflow-hidden z-50"
          style={{
            width: 300, maxHeight: 440, borderColor: 'var(--border-color)',
            boxShadow: '0 14px 34px rgba(0,0,0,0.16)'
          }}
        >
          <div
            className="px-4 py-3 border-b"
            style={{ borderColor: 'var(--border-color)', background: 'var(--brand-navy)' }}
          >
            <span className="font-lora font-semibold text-sm text-white">Open Windows</span>
          </div>

          <div role="menu" aria-label="Open windows" style={{ maxHeight: 380, overflowY: 'auto' }}>
            {windows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">
                No other windows are open.
              </div>
            ) : (
              windows.map(win => (
                <button
                  key={win.id}
                  role="menuitem"
                  onClick={() => bringForward(win)}
                  className="w-full text-left px-4 py-3 flex items-center gap-2 border-b hover:bg-slate-50 transition-colors"
                  style={{ borderColor: 'var(--border-table)' }}
                >
                  <AppWindow size={14} className="text-slate-400 flex-shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-sm font-semibold" style={{ color: 'var(--dark-heading)' }}>
                    {win.title || 'Wentox'}
                  </span>
                  {win.minimized && (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400" title="Minimized">
                      <Minimize2 size={11} /> Min
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
