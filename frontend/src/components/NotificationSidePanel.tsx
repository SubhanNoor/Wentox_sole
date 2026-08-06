import { useState, useEffect, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import { computeAlerts, todayISO } from '@/lib/cheques';
import { Bell, X, RotateCcw, ChevronRight } from 'lucide-react';
import type { AppAlert } from '@/types';

const POLL_INTERVAL_MS = 60_000;

interface NotificationSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationSidePanel({ isOpen, onClose }: NotificationSidePanelProps) {
  const { state, dispatch } = useApp();
  const [today, setToday] = useState(todayISO());

  useEffect(() => {
    const id = setInterval(() => setToday(todayISO()), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const alerts = useMemo(() => computeAlerts(state, today), [state, today]);

  const overdue = alerts.filter(a => a.severity === 'overdue');
  const dueSoon = alerts.filter(a => a.severity === 'due-soon');

  function openAlert(alert: AppAlert) {
    dispatch({ type: 'NAVIGATE', page: alert.targetPage, tab: alert.targetTab });
  }

  function dismiss(alert: AppAlert) {
    dispatch({ type: 'DISMISS_ALERT', alertKey: alert.key, dismissedAt: new Date().toISOString() });
  }

  return (
    <>
      {/* Dimmed Backdrop Overlay with Fade Animation */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ease-in-out ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        data-no-print
      />

      {/* Slide-out Notification Drawer with Smooth Slide & Spring Curve Animation */}
      <aside
        className={`fixed top-0 right-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col border-l transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ borderColor: 'var(--border-color)' }}
        data-no-print
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b text-white"
          style={{ background: 'var(--brand-navy)', borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 animate-pulse">
              <Bell size={18} />
            </div>
            <div>
              <h2 className="font-lora font-bold text-base text-white leading-tight">Notifications</h2>
              <p className="text-[11px] text-slate-300">
                {alerts.length === 0 ? 'No pending alerts' : `${alerts.length} item(s) require attention`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors flex items-center gap-1 text-xs font-semibold"
            title="Close Side Panel"
            aria-label="Close Side Panel"
          >
            <span className="text-xs">Close</span>
            <X size={18} />
          </button>
        </div>

        {/* Action Bar / Restore */}
        <div className="px-4 py-2.5 bg-slate-50 border-b flex items-center justify-between text-xs" style={{ borderColor: 'var(--border-table)' }}>
          <span className="font-semibold text-slate-600 uppercase tracking-wider text-[10px]">
            Cheque &amp; Business Alerts
          </span>
          {state.alertDismissals.length > 0 && (
            <button
              onClick={() => dispatch({ type: 'RESTORE_ALERTS' })}
              className="flex items-center gap-1 font-bold hover:underline"
              style={{ color: 'var(--brand-gold)' }}
              title="Bring back dismissed alerts"
            >
              <RotateCcw size={12} /> Restore ({state.alertDismissals.length})
            </button>
          )}
        </div>

        {/* Alert List Container */}
        <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: 'var(--border-table)' }}>
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-6">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
                <Bell size={24} />
              </div>
              <h3 className="font-lora font-semibold text-slate-700 text-sm">All caught up!</h3>
              <p className="text-xs text-slate-400 mt-1">No overdue or pending cheque alerts requiring your attention today.</p>
            </div>
          ) : (
            <>
              {/* Overdue Section */}
              {overdue.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border-b flex items-center justify-between">
                    <span>Overdue Cheques</span>
                    <span className="px-2 py-0.5 rounded-full bg-rose-200 text-rose-800 text-[10px] font-extrabold">{overdue.length}</span>
                  </div>
                  {overdue.map(alert => (
                    <div key={alert.key} className="relative border-b hover:bg-slate-50 transition-colors group">
                      <button
                        onClick={() => openAlert(alert)}
                        className="w-full text-left p-4 pr-10 flex items-start gap-3"
                      >
                        <span className="mt-1.5 w-2 h-2 rounded-full bg-rose-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-sm font-semibold text-slate-900 truncate">{alert.title}</span>
                            <ChevronRight size={14} className="text-slate-400 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 leading-snug">{alert.detail}</p>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-[11px] font-mono text-slate-400">{alert.date}</span>
                            <span className="text-xs font-bold font-mono text-rose-700">{formatCurrency(alert.amount)}</span>
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => dismiss(alert)}
                        title="Dismiss Alert"
                        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-slate-200"
                      >
                        <X size={14} className="text-slate-500" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Due Soon Section */}
              {dueSoon.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider bg-amber-50 text-amber-800 border-b flex items-center justify-between">
                    <span>Due Soon Cheques</span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-extrabold">{dueSoon.length}</span>
                  </div>
                  {dueSoon.map(alert => (
                    <div key={alert.key} className="relative border-b hover:bg-slate-50 transition-colors group">
                      <button
                        onClick={() => openAlert(alert)}
                        className="w-full text-left p-4 pr-10 flex items-start gap-3"
                      >
                        <span className="mt-1.5 w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-sm font-semibold text-slate-900 truncate">{alert.title}</span>
                            <ChevronRight size={14} className="text-slate-400 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 leading-snug">{alert.detail}</p>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-[11px] font-mono text-slate-400">{alert.date}</span>
                            <span className="text-xs font-bold font-mono text-amber-700">{formatCurrency(alert.amount)}</span>
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => dismiss(alert)}
                        title="Dismiss Alert"
                        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-slate-200"
                      >
                        <X size={14} className="text-slate-500" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-table)' }}>
          <button
            onClick={() => dispatch({ type: 'NAVIGATE', page: 'cheque-return' })}
            className="text-xs font-semibold text-slate-700 hover:text-slate-900 underline"
          >
            View Cheque Return Page
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-bold bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-lg transition-colors"
          >
            Close Panel
          </button>
        </div>
      </aside>
    </>
  );
}
