import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import { formatDate } from '@/lib/utils';
import { Search, Wallet } from 'lucide-react';
import * as api from '@/lib/api';
import type { ChequeRow } from '@/lib/api';

interface InHandRow extends ChequeRow {
  unallocated: number;
}

// "Cheque in Hand" — every RECEIVED cheque still physically sitting with us (PENDING = untouched,
// nothing allocated yet; PARTIALLY_ENDORSED = part of it already disposed, the rest still in
// hand). Still read-only by design — this is "what's currently uncashed, at a glance", and the
// dispose/bounce/return machinery belongs on one screen, not two. What it now does carry is a way
// OUT to that screen: landing here with a cheque in front of you and no route to acting on it was
// the complaint that started this, and the answer is a signpost rather than duplicated actions.
export function ChequeInHandContent({ onGoToDisposal }: { onGoToDisposal?: () => void }) {
  const [rows, setRows] = useState<InHandRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadInHand = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await api.cheques.list();
      if (!res.ok) { setErrorMsg('Failed to load cheques: ' + res.error.message); return; }

      const openCheques = res.data.filter(c => c.cheque_status === 'PENDING' || c.cheque_status === 'PARTIALLY_ENDORSED');

      // PENDING has nothing allocated yet, so its full receipt amount is still in hand. Only
      // PARTIALLY_ENDORSED needs the actual allocation sum to know what's left.
      const withBalances = await Promise.all(openCheques.map(async (c): Promise<InHandRow> => {
        if (c.cheque_status === 'PENDING') {
          return { ...c, unallocated: c.receipt_amount || 0 };
        }
        const allocRes = await api.cheques.allocationsForReceipt(c.receipt_id);
        const allocated = allocRes.ok
          ? allocRes.data.filter(a => a.status === 'ACTIVE').reduce((sum, a) => sum + a.amount, 0)
          : 0;
        return { ...c, unallocated: (c.receipt_amount || 0) - allocated };
      }));

      setRows(withBalances.sort((a, b) => a.cheque_date.localeCompare(b.cheque_date)));
    } catch (err) {
      // Without this, a rejected IPC call would leave loading stuck true forever with no feedback.
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load cheques in hand.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadInHand(); }, [loadInHand]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.cheque_no.toLowerCase().includes(q) ||
      (r.customer_name || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const total = filteredRows.reduce((sum, r) => sum + r.unallocated, 0);

  return (
    <div className="mx-auto" style={{ maxWidth: 1100 }}>
      {errorMsg && (
        <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
      )}
      <div
        className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white"
        style={{ borderColor: 'var(--border-color)' }}
        data-no-print
      >
        <div>
          <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
            <Wallet size={18} className="text-[#B08D57]" /> Cheques in Hand
          </h3>
          <p className="text-xs text-slate-500 font-medium">
            Every received cheque still uncashed — not yet deposited, endorsed, bounced, or
            returned. Read-only; use the Disposal tab to act on one.
          </p>
        </div>
        <div className="relative min-w-[240px]">
          <input
            type="text"
            placeholder="Cheque no. or customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold bg-white"
          />
          <Search className="absolute right-3 top-2.5 text-slate-400" size={14} />
        </div>
      </div>

      <div className="card-white p-6 md:p-8 bg-white border">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr
                className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <th className="p-3 pl-4 text-center">Received Date</th>
                <th className="p-3">Party Name</th>
                <th className="p-3">Cheque No.</th>
                <th className="p-3 text-center">Due Date</th>
                <th className="p-3 text-right">In Hand</th>
                <th className="p-3 text-center">Status</th>
                {onGoToDisposal && <th className="p-3 text-center" data-no-print>Action</th>}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={onGoToDisposal ? 7 : 6} className="text-center p-8 text-slate-400">
                    {loading ? 'Loading…' : 'No cheques currently in hand.'}
                  </td>
                </tr>
              ) : (
                filteredRows.map(row => (
                  <tr key={row.cheque_id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4 text-center text-xs text-slate-600">{row.cheque_received_date ? formatDate(row.cheque_received_date) : '-'}</td>
                    <td className="p-3 font-semibold text-slate-700">{row.account_name || row.customer_name || '-'}</td>
                    <td className="p-3 font-mono font-semibold text-slate-800">{row.cheque_no}</td>
                    <td className="p-3 text-center text-xs text-slate-600">{formatDate(row.cheque_date)}</td>
                    <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(row.unallocated)}</td>
                    <td className="p-3 text-center">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-slate-100 text-slate-700 border-slate-300">
                        {row.cheque_status === 'PENDING' ? 'Fully in Hand' : 'Partially Issued'}
                      </span>
                    </td>
                    {onGoToDisposal && (
                      <td className="p-3 text-center" data-no-print>
                        <button
                          type="button"
                          onClick={onGoToDisposal}
                          title="Deposit, endorse, bounce or return this cheque on the Disposal tab"
                          className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer"
                        >
                          Issue →
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                  <td colSpan={4} className="p-4 text-left font-lora">TOTAL IN HAND</td>
                  <td className="p-4 text-right" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(total)}</td>
                  <td className="p-4" />
                  {onGoToDisposal && <td className="p-4" data-no-print />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
