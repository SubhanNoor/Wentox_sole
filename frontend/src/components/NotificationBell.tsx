import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { AlertRow } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Bell, X, RotateCw } from 'lucide-react';

const POLL_INTERVAL_MS = 60_000;

export default function NotificationBell() {
  const { dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await api.alerts.list();
    if (res.ok) setAlerts(res.data);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    const res = await api.alerts.refresh();
    if (res.ok) setAlerts(res.data);
    setRefreshing(false);
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const overdue = alerts.filter(a => a.severity === 'overdue');
  const dueSoon = alerts.filter(a => a.severity === 'due-soon');

  function openAlert(alert: AlertRow) {
    dispatch({ type: 'NAVIGATE', page: alert.target_page, tab: alert.target_tab ?? undefined });
    setOpen(false);
  }

  async function dismiss(alert: AlertRow) {
    const res = await api.alerts.dismiss(alert.key);
    if (res.ok) setAlerts(prev => prev.filter(a => a.key !== alert.key));
  }

  function renderGroup(label: string, group: AlertRow[], accent: string, bg: string) {
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
                  {alert.detail} &middot; {formatDate(alert.date)}
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
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-1 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
              title="Refresh"
              aria-label="Refresh alerts"
            >
              <RotateCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
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
