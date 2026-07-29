import { useState, useRef, useEffect, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import { computeAlerts, todayISO } from '@/lib/cheques';
import { Bell, X, RotateCcw } from 'lucide-react';
import type { AppAlert } from '@/types';

// §12 — alerts are derived from state on every render and on a slow interval
// (so a cheque crossing its date lights up without a reload). Nothing is
// stored except the dismissal; this is the same derivation a future
// `GET /api/notifications` will run server-side.
const POLL_INTERVAL_MS = 60_000;

export default function NotificationBell() {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [today, setToday] = useState(todayISO());
  const panelRef = useRef<HTMLDivElement>(null);

  // Re-derive periodically so the badge stays honest across a long session.
  useEffect(() => {
    const id = setInterval(() => setToday(todayISO()), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const alerts = useMemo(() => computeAlerts(state, today), [state, today]);

  const overdue = alerts.filter(a => a.severity === 'overdue');
  const dueSoon = alerts.filter(a => a.severity === 'due-soon');

  function openAlert(alert: AppAlert) {
    dispatch({ type: 'NAVIGATE', page: alert.targetPage, tab: alert.targetTab });
    setOpen(false);
  }

  function dismiss(alert: AppAlert) {
    dispatch({ type: 'DISMISS_ALERT', alertKey: alert.key, dismissedAt: new Date().toISOString() });
  }

  function renderGroup(label: string, group: AppAlert[], accent: string, bg: string) {
    if (group.length === 0) return null;
    return (
      <div>
        <div
          className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b"
          style={{ color: accent, background: bg, borderColor: 'var(--border-table)' }}
        >
          {label} ({group.length})
        </div>
        {/* The dismiss control is a sibling button, not nested inside the
            navigate button — nesting interactives is invalid HTML and makes
            the small X almost impossible to hit. */}
        {group.map(alert => (
          <div
            key={alert.key}
            className="relative border-b hover:bg-slate-50 transition-colors group"
            style={{ borderColor: 'var(--border-table)' }}
          >
            <button
              onClick={() => openAlert(alert)}
              className="w-full text-left pl-4 pr-10 py-3 flex items-start gap-2"
            >
              <span
                className="mt-1.5 rounded-full flex-shrink-0"
                style={{ width: 7, height: 7, background: accent }}
              />
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold text-slate-800 truncate">
                  {alert.title}
                </span>
                <span className="block text-[11px] text-slate-500 mt-0.5">
                  {alert.detail} &middot; {alert.date}
                </span>
                <span className="block text-[11px] font-bold font-mono mt-0.5" style={{ color: accent }}>
                  {formatCurrency(alert.amount)}
                </span>
              </span>
            </button>
            <button
              onClick={() => dismiss(alert)}
              title="Dismiss"
              aria-label={`Dismiss alert: ${alert.title}`}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1.5 rounded hover:bg-slate-200"
            >
              <X size={13} className="text-slate-500" />
            </button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative" ref={panelRef} data-no-print>
      <button
        onClick={() => setOpen(!open)}
        className="relative flex items-center justify-center rounded-lg transition-colors hover:bg-slate-100"
        style={{ width: 36, height: 36 }}
        title="Alerts"
        aria-label={`Alerts${alerts.length ? ` (${alerts.length})` : ''}`}
      >
        <Bell size={19} color="var(--dark-heading)" />
        {alerts.length > 0 && (
          <span
            className="absolute flex items-center justify-center rounded-full font-bold text-white"
            style={{
              top: 2, right: 2, minWidth: 16, height: 16, fontSize: 10, padding: '0 4px',
              background: overdue.length > 0 ? '#be123c' : '#b45309'
            }}
          >
            {alerts.length > 99 ? '99+' : alerts.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 rounded-xl border bg-white overflow-hidden z-50"
          style={{
            width: 360, maxHeight: 440, borderColor: 'var(--border-color)',
            boxShadow: '0 14px 34px rgba(0,0,0,0.16)'
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: 'var(--border-color)', background: 'var(--brand-navy)' }}
          >
            <span className="font-lora font-semibold text-sm text-white">Alerts</span>
            {state.alertDismissals.length > 0 && (
              <button
                onClick={() => dispatch({ type: 'RESTORE_ALERTS' })}
                className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider hover:opacity-80"
                style={{ color: 'var(--brand-gold)' }}
                title="Bring back dismissed alerts"
              >
                <RotateCcw size={11} /> Restore ({state.alertDismissals.length})
              </button>
            )}
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {alerts.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">
                Nothing needs attention right now.
              </div>
            ) : (
              <>
                {renderGroup('Overdue', overdue, '#be123c', '#fff1f2')}
                {renderGroup('Due soon', dueSoon, '#b45309', '#fffbeb')}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
