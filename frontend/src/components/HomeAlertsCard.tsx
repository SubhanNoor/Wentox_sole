import { useState, useEffect, useCallback } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { AlertRow } from '@/lib/api';
import { Bell, X, ChevronRight, RotateCw } from 'lucide-react';

const POLL_INTERVAL_MS = 60_000;

export default function HomeAlertsCard() {
  const { state, dispatch } = useApp();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

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

  if (state.homeAlertsCardClosed || alerts.length === 0) return null;

  const overdue = alerts.filter(a => a.severity === 'overdue');
  const dueSoon = alerts.filter(a => a.severity === 'due-soon');

  function openAlert(alert: AlertRow) {
    dispatch({ type: 'NAVIGATE', page: alert.target_page, tab: alert.target_tab ?? undefined });
  }

  async function dismiss(alert: AlertRow) {
    const res = await api.alerts.dismiss(alert.key);
    if (res.ok) setAlerts(prev => prev.filter(a => a.key !== alert.key));
  }

  function renderGroup(label: string, group: AlertRow[], badgeBg: string, badgeText: string, headerBg: string, headerText: string, dotColor: string, amountColor: string) {
    if (group.length === 0) return null;
    return (
      <div>
        <div className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider ${headerBg} ${headerText} border-b flex items-center justify-between`}>
          <span>{label}</span>
          <span className={`px-2 py-0.5 rounded-full ${badgeBg} ${badgeText} text-[10px] font-extrabold`}>{group.length}</span>
        </div>
        {group.map(alert => (
          <div key={alert.key} className="relative border-b hover:bg-slate-50 transition-colors group">
            <button
              onClick={() => openAlert(alert)}
              className="w-full text-left p-4 pr-10 flex items-start gap-3"
            >
              <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-semibold text-slate-900 truncate">{alert.title}</span>
                  <ChevronRight size={14} className="text-slate-400 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
                </div>
                {alert.detail && <p className="text-xs text-slate-500 mt-0.5 leading-snug">{alert.detail}</p>}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] font-mono text-slate-400">{alert.date}</span>
                  <span className={`text-xs font-bold font-mono ${amountColor}`}>{formatCurrency(alert.amount)}</span>
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
    );
  }

  return (
    <div
      className="w-full bg-white rounded-2xl border shadow-lg overflow-hidden flex flex-col"
      style={{ maxWidth: 520, borderColor: 'var(--border-color)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 text-white"
        style={{ background: 'var(--brand-navy)' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 animate-pulse">
            <Bell size={18} />
          </div>
          <div>
            <h2 className="font-lora font-bold text-base text-white leading-tight">Cheque &amp; Business Alerts</h2>
            <p className="text-[11px] text-slate-300">{alerts.length} item(s) require attention</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
          title="Refresh"
          aria-label="Refresh alerts"
        >
          <RotateCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => dispatch({ type: 'CLOSE_HOME_ALERTS_CARD' })}
          className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors flex items-center gap-1 text-xs font-semibold"
          title="Close"
          aria-label="Close alerts card"
        >
          <span className="text-xs">Close</span>
          <X size={18} />
        </button>
        </div>
      </div>

      {/* Alert List */}
      <div className="overflow-y-auto divide-y" style={{ maxHeight: 320, borderColor: 'var(--border-table)' }}>
        {renderGroup('Overdue', overdue, 'bg-rose-200', 'text-rose-800', 'bg-rose-50', 'text-rose-700', 'bg-rose-600', 'text-rose-700')}
        {renderGroup('Due Soon', dueSoon, 'bg-amber-200', 'text-amber-900', 'bg-amber-50', 'text-amber-800', 'bg-amber-500', 'text-amber-700')}
      </div>
    </div>
  );
}
