import { useEffect, useState } from 'react';
import { formatCurrency, balanceColor } from '@/context/AppContext';
import * as api from '@/lib/api';

/**
 * "Balance before → after" panel for the Receipts (Jamma) and Expenses (Naam) entry forms.
 *
 * UC-25 step 4 asks for BOTH figures explicitly — what the account stands at now, and what it
 * becomes once this entry is saved — rather than just a net number, so the effect of the entry is
 * visible before committing to it.
 *
 * Sign convention is the ledger's own: positive = debit = the account owes us; negative = credit =
 * we owe the account. Callers pass their document's effect as signed `lines`, because the two
 * screens push the balance in opposite directions — a receipt CREDITS the selected account
 * (negative delta), an expense DEBITS it (positive).
 */

export interface BalanceLine {
  label: string;
  /** Signed effect on the account's balance. Zero-value lines are not rendered. */
  delta: number;
}

interface AccountBalancePanelProps {
  baId: number | null;
  lines: BalanceLine[];
  /** Bump to force a re-fetch after a save — the balance is stale the moment an entry posts. */
  refreshKey?: number;
  /**
   * Which vocabulary to label the figure with. 'party' (default) is who-owes-whom, for the
   * Receipts/Expenses forms. 'money' is for an account that HOLDS money rather than owes it —
   * cash and bank on the Transfer screen, where "Receivable 349,000" would read as nonsense.
   */
  variant?: 'party' | 'money';
  className?: string;
}

// 'Receivable' / 'Payable' rather than Dr / Cr: the people using this screen think in who-owes-whom,
// and the Naam/Jamma columns elsewhere already carry the accounting vocabulary. Same sign
// convention either way — positive is a debit balance — only the words change.
// G-05: red for negative, green for zero or positive — color comes from the shared balanceColor()
// rule, only the label text varies by variant/sign.
function balanceTone(value: number, variant: 'party' | 'money'): { label: string; color: string } {
  const color = balanceColor(value);
  if (variant === 'money') {
    if (value > 0) return { label: 'In Hand', color };
    if (value < 0) return { label: 'Overdrawn', color };
    return { label: 'Empty', color };
  }
  if (value > 0) return { label: 'Receivable', color };
  if (value < 0) return { label: 'Payable', color };
  return { label: 'Settled', color };
}

export default function AccountBalancePanel({ baId, lines, refreshKey = 0, variant = 'party', className = '' }: AccountBalancePanelProps) {
  // The fetched value is stored WITH the account it belongs to, so switching accounts derives its
  // way back to "loading" instead of needing a synchronous reset inside the effect (which would
  // both trip react-hooks/set-state-in-effect and briefly show the previous account's balance).
  const [loaded, setLoaded] = useState<{ baId: number; balance: number } | null>(null);
  const [failure, setFailure] = useState<{ baId: number; message: string } | null>(null);

  useEffect(() => {
    if (baId == null) return;
    let cancelled = false;
    api.reports.accountBalance({ ba_id: baId }).then(res => {
      // The account can change while a request is in flight; a late response for the previous
      // account would otherwise overwrite the correct one.
      if (cancelled) return;
      if (res.ok) setLoaded({ baId, balance: res.data.balance });
      else setFailure({ baId, message: res.error.message });
    });
    return () => { cancelled = true; };
  }, [baId, refreshKey]);

  if (baId == null) return null;

  const current = loaded?.baId === baId ? loaded.balance : null;
  const error = failure?.baId === baId ? failure.message : '';

  if (error) {
    return (
      <div className={`rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 ${className}`}>
        Could not load account balance: {error}
      </div>
    );
  }

  if (current == null) {
    return (
      <div className={`rounded-xl border bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-400 ${className}`} style={{ borderColor: 'var(--border-color)' }}>
        Loading account balance…
      </div>
    );
  }

  const effective = lines.filter(l => l.delta !== 0);
  const after = current + effective.reduce((sum, l) => sum + l.delta, 0);
  const currentTone = balanceTone(current, variant);
  const afterTone = balanceTone(after, variant);

  return (
    <div className={`rounded-xl border overflow-hidden bg-white ${className}`} style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Current Balance</span>
        <span className="text-sm font-bold font-mono" style={{ color: currentTone.color }}>
          {formatCurrency(Math.abs(current))}
          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider">{currentTone.label}</span>
        </span>
      </div>

      {effective.map(line => (
        <div key={line.label} className="flex items-center justify-between px-4 py-1.5 border-t" style={{ borderColor: 'var(--border-table)' }}>
          <span className="text-[11px] font-semibold text-slate-500">{line.label}</span>
          <span className="text-xs font-semibold font-mono text-slate-600">
            {line.delta < 0 ? '−' : '+'}{formatCurrency(Math.abs(line.delta))}
          </span>
        </div>
      ))}

      {effective.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t-2" style={{ borderColor: 'var(--border-color)' }}>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700">Balance After</span>
          <span className="text-sm font-bold font-mono" style={{ color: afterTone.color }}>
            {formatCurrency(Math.abs(after))}
            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider">{afterTone.label}</span>
          </span>
        </div>
      )}
    </div>
  );
}
