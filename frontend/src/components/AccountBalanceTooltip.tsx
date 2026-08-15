import { useEffect, useState } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';

/**
 * RJ-02: small live balance readout next to the account field on Receipts/Payments — replaces
 * the old below-the-field panel. `baId` is expected to be the currently HIGHLIGHTED account
 * while the dropdown is open (falling back to the committed selection once closed), so this
 * updates in real time as the user arrow-keys through the list, before they commit to one.
 */

function balanceTone(value: number): { label: string; color: string } {
  if (value > 0) return { label: 'Receivable', color: '#047857' };
  if (value < 0) return { label: 'Payable', color: '#e11d48' };
  return { label: 'Settled', color: '#64748b' };
}

interface AccountBalanceTooltipProps {
  baId: number | null;
  className?: string;
  /** Bump to force a re-fetch after a save — the balance is stale the moment an entry posts. */
  refreshKey?: number;
}

export default function AccountBalanceTooltip({ baId, className = '', refreshKey = 0 }: AccountBalanceTooltipProps) {
  const [loaded, setLoaded] = useState<{ baId: number; balance: number } | null>(null);

  useEffect(() => {
    if (baId == null) return;
    let cancelled = false;
    api.reports.accountBalance({ ba_id: baId }).then(res => {
      if (cancelled) return;
      if (res.ok) setLoaded({ baId, balance: res.data.balance });
    });
    return () => { cancelled = true; };
  }, [baId, refreshKey]);

  if (baId == null) return null;

  const current = loaded?.baId === baId ? loaded.balance : null;
  if (current == null) {
    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-lg border bg-slate-50 text-[11px] font-semibold text-slate-400 ${className}`} style={{ borderColor: 'var(--border-color)' }}>
        loading…
      </span>
    );
  }

  const tone = balanceTone(current);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border bg-white text-xs font-bold font-mono shadow-2xs ${className}`}
      style={{ color: tone.color, borderColor: 'var(--border-color)' }}
    >
      {formatCurrency(Math.abs(current))}
      <span className="text-[9px] font-semibold uppercase tracking-wider">{tone.label}</span>
    </span>
  );
}
