import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import { todayISO } from '@/lib/cheques';
import { formatDate } from '@/lib/utils';
import { AlertTriangle, RotateCcw, Search } from 'lucide-react';
import * as api from '@/lib/api';
import type { ChequeAllocationRow, ChequeDispositionType, IssuedChequeRow } from '@/lib/api';

const DISPOSITION_LABELS: Record<Exclude<ChequeDispositionType, 'DEPOSIT'>, string> = {
  VENDOR_PAYMENT: 'Paid to Vendor',
  EXPENSE_PAYMENT: 'Paid to Expense Account',
};

// Unifies the two structurally separate cheque-payment sources this tab covers: a cheque we
// RECEIVED from a customer and endorsed onward (dbo.cheque_allocations), and a cheque WE WROTE
// directly from our own bank account (dbo.expenses, payment_mode = CHEQUE_ISSUED) — the latter
// never creates a cheques/cheque_allocations row at all, so it can't be represented as one of
// those. Both render as one row in the same table; only the action differs.
interface UnifiedRow {
  key: string;
  source: 'endorsed' | 'issued';
  chequeNo: string;
  paidTo: string;
  dispositionLabel: string;
  amount: number;
  date: string;
  endorsed?: ChequeAllocationRow;
  issued?: IssuedChequeRow;
}

export function ChequeReturnsContent() {
  const [allocations, setAllocations] = useState<ChequeAllocationRow[]>([]);
  const [issuedCheques, setIssuedCheques] = useState<IssuedChequeRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [returningAlloc, setReturningAlloc] = useState<ChequeAllocationRow | null>(null);
  const [returnDate, setReturnDate] = useState(todayISO());
  const [returnRemarks, setReturnRemarks] = useState('');

  // Issued-cheque action modal — covers both Mark Bounced and Mark Returned, same shape as
  // ChequesTab.tsx's own bounce/return distinction for a RECEIVED cheque.
  const [issuedAction, setIssuedAction] = useState<{ row: IssuedChequeRow; mode: 'BOUNCED' | 'RETURNED' } | null>(null);
  const [issuedActionDate, setIssuedActionDate] = useState(todayISO());
  const [issuedActionReason, setIssuedActionReason] = useState('');

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 5000); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [allocRes, issuedRes] = await Promise.all([
      api.cheques.endorsedAllocations(),
      api.expenses.returnableIssuedCheques(),
    ]);
    if (allocRes.ok) setAllocations(allocRes.data);
    else fail('Failed to load endorsed cheques: ' + allocRes.error.message);
    if (issuedRes.ok) setIssuedCheques(issuedRes.data);
    else fail('Failed to load issued cheques: ' + issuedRes.error.message);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // api.cheques.endorsedAllocations() already returns exactly ACTIVE VENDOR_PAYMENT/EXPENSE_PAYMENT
  // allocations (DEPOSIT excluded server-side), and api.expenses.returnableIssuedCheques() already
  // returns exactly PENDING CHEQUE_ISSUED expenses — only search filtering happens here.
  const unifiedRows = useMemo(() => {
    const fromEndorsed: UnifiedRow[] = allocations.map(a => ({
      key: `endorsed-${a.allocation_id}`,
      source: 'endorsed',
      chequeNo: a.cheque_no || '-',
      paidTo: a.vendor_name || a.target_name || 'Vendor',
      dispositionLabel: DISPOSITION_LABELS[a.disposition_type as Exclude<ChequeDispositionType, 'DEPOSIT'>],
      amount: a.amount,
      date: a.allocation_date,
      endorsed: a,
    }));
    const fromIssued: UnifiedRow[] = issuedCheques.map(e => ({
      key: `issued-${e.expense_id}`,
      source: 'issued',
      chequeNo: e.issued_cheque_no || '-',
      paidTo: e.ba_name || 'Vendor / Account',
      dispositionLabel: `Issued from ${e.bank_name || 'Our Bank'}`,
      amount: e.amount,
      date: e.issued_cheque_date || e.expense_date,
      issued: e,
    }));

    const q = search.trim().toLowerCase();
    return [...fromEndorsed, ...fromIssued]
      .filter(row => {
        if (!q) return true;
        return row.chequeNo.toLowerCase().includes(q) || row.paidTo.toLowerCase().includes(q);
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [allocations, issuedCheques, search]);

  const openReturn = (allocation: ChequeAllocationRow) => {
    setReturningAlloc(allocation);
    setReturnDate(todayISO());
    setReturnRemarks('');
  };

  const confirmReturn = async () => {
    if (!returningAlloc) return;
    const res = await api.cheques.reverseAllocation(returningAlloc.allocation_id, {
      date: returnDate,
      remarks: returnRemarks || undefined,
    });
    if (!res.ok) { fail(res.error.message); return; }
    flash(
      `Reversed ${formatCurrency(returningAlloc.amount)} back into Cheques in Hand, dated ${formatDate(returnDate)}, ` +
      `and freed up that much of the cheque's balance again.`
    );
    setReturningAlloc(null);
    await loadAll();
  };

  const openIssuedAction = (row: IssuedChequeRow, mode: 'BOUNCED' | 'RETURNED') => {
    setIssuedAction({ row, mode });
    setIssuedActionDate(todayISO());
    setIssuedActionReason('');
  };

  const confirmIssuedAction = async () => {
    if (!issuedAction) return;
    const { row, mode } = issuedAction;
    const res = mode === 'BOUNCED'
      ? await api.expenses.bounceIssuedCheque(row.expense_id, { bounced_date: issuedActionDate })
      : await api.expenses.returnIssuedCheque(row.expense_id, { returned_date: issuedActionDate, reason: issuedActionReason || undefined });
    if (!res.ok) { fail(res.error.message); return; }
    flash(
      `Cheque ${row.issued_cheque_no || ''} marked ${mode.toLowerCase()}. ${formatCurrency(row.amount)} moved back ` +
      `from ${row.ba_name || 'the payee'} onto ${row.bank_name || 'our bank'}, dated ${formatDate(issuedActionDate)}.`
    );
    setIssuedAction(null);
    await loadAll();
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1200 }}>
      {successMsg && (
        <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
      )}
      {errorMsg && (
        <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
      )}

      <div
        className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white"
        style={{ borderColor: 'var(--border-color)' }}
        data-no-print
      >
        <div>
          <h3 className="font-lora font-semibold text-lg text-slate-800">Endorsed & Issued Cheques</h3>
          <p className="text-xs text-slate-500 font-medium">
            Every cheque payment still standing — whether endorsed onward from a customer receipt
            or issued directly from our own bank — hand one back to reverse just that payment.
          </p>
        </div>
        <div className="relative min-w-[240px]">
          <input
            type="text"
            placeholder="Cheque no. or payee..."
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
                <th className="p-3 pl-4">Cheque No.</th>
                <th className="p-3">Paid To</th>
                <th className="p-3 text-center">Disposition</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-center">Date</th>
                <th className="p-3 text-center" data-no-print>Action</th>
              </tr>
            </thead>
            <tbody>
              {unifiedRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center p-8 text-slate-400">
                    {loading ? 'Loading…' : 'No cheques match this filter.'}
                  </td>
                </tr>
              ) : (
                unifiedRows.map(row => (
                  <tr key={row.key} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4 font-mono font-semibold text-slate-800">{row.chequeNo}</td>
                    <td className="p-3 font-semibold text-slate-700">{row.paidTo}</td>
                    <td className="p-3 text-center">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-violet-50 text-violet-800 border-violet-200">
                        {row.dispositionLabel}
                      </span>
                    </td>
                    <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(row.amount)}</td>
                    <td className="p-3 text-center text-xs text-slate-600">{formatDate(row.date)}</td>
                    <td className="p-3 text-center" data-no-print>
                      {row.source === 'endorsed' ? (
                        <button
                          onClick={() => openReturn(row.endorsed!)}
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200 transition-colors"
                        >
                          <RotateCcw size={11} /> Return
                        </button>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => openIssuedAction(row.issued!, 'BOUNCED')}
                            className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 transition-colors"
                          >
                            Mark Bounced
                          </button>
                          <button
                            onClick={() => openIssuedAction(row.issued!, 'RETURNED')}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200 transition-colors"
                          >
                            <RotateCcw size={11} /> Return
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Return confirmation (endorsed) ── */}
      {returningAlloc && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-2 flex items-center gap-2">
              <AlertTriangle size={18} className="text-slate-600" /> Return This Endorsement
            </h3>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Reverses <strong>only this payment</strong> ({formatCurrency(returningAlloc.amount)}) —
              the cheque's other allocations, the original receipt, and the cheque itself are
              untouched. The cheque's available balance goes back up by this amount, so it can be
              disposed of again another way. Nothing is deleted — the correction is posted on the
              date below, dated separately from the original entry.
            </p>

            <div className="mb-3">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Return date</label>
              <input
                type="date"
                value={returnDate}
                onChange={e => setReturnDate(e.target.value)}
                className="soleria-input"
              />
            </div>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks</label>
              <input
                type="text"
                value={returnRemarks}
                onChange={e => setReturnRemarks(e.target.value)}
                placeholder="Why is this cheque coming back?"
                className="soleria-input"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setReturningAlloc(null)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmReturn}
                className="px-4 py-2 text-sm rounded-lg bg-slate-700 text-white hover:bg-slate-800"
              >
                Confirm Return
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bounce/Return confirmation (issued) ── */}
      {issuedAction && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-2 flex items-center gap-2">
              <AlertTriangle size={18} className={issuedAction.mode === 'BOUNCED' ? 'text-rose-600' : 'text-slate-600'} />
              {issuedAction.mode === 'BOUNCED' ? 'Mark This Issued Cheque Bounced' : 'Mark This Issued Cheque Returned'}
            </h3>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Reverses the {formatCurrency(issuedAction.row.amount)} originally paid out of{' '}
              <strong>{issuedAction.row.bank_name || 'our bank'}</strong> to{' '}
              <strong>{issuedAction.row.ba_name || 'the payee'}</strong> — the money moves back onto
              our bank's balance. Nothing is deleted — the correction is posted on the date below,
              dated separately from the original payment.
            </p>

            <div className="mb-3">
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                {issuedAction.mode === 'BOUNCED' ? 'Bounce date' : 'Return date'}
              </label>
              <input
                type="date"
                value={issuedActionDate}
                onChange={e => setIssuedActionDate(e.target.value)}
                className="soleria-input"
              />
            </div>
            {issuedAction.mode === 'RETURNED' && (
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-600 mb-1">Reason</label>
                <input
                  type="text"
                  value={issuedActionReason}
                  onChange={e => setIssuedActionReason(e.target.value)}
                  placeholder="Why is this cheque coming back?"
                  className="soleria-input"
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIssuedAction(null)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmIssuedAction}
                className={`px-4 py-2 text-sm rounded-lg text-white ${issuedAction.mode === 'BOUNCED' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-slate-700 hover:bg-slate-800'}`}
              >
                {issuedAction.mode === 'BOUNCED' ? 'Confirm Bounce' : 'Confirm Return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
