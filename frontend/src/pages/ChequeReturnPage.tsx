import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { todayISO } from '@/lib/cheques';
import { AlertTriangle, RotateCcw, Search } from 'lucide-react';
import * as api from '@/lib/api';
import type { ChequeAllocationRow, ChequeDispositionType } from '@/lib/api';

const DISPOSITION_LABELS: Record<Exclude<ChequeDispositionType, 'DEPOSIT'>, string> = {
  VENDOR_PAYMENT: 'Paid to Vendor',
  EXPENSE_PAYMENT: 'Paid to Expense Account',
};

export default function ChequeReturnPage() {
  const [allocations, setAllocations] = useState<ChequeAllocationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [returningAlloc, setReturningAlloc] = useState<ChequeAllocationRow | null>(null);
  const [returnDate, setReturnDate] = useState(todayISO());
  const [returnRemarks, setReturnRemarks] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 5000); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const loadAllocations = useCallback(async () => {
    setLoading(true);
    const res = await api.cheques.endorsedAllocations();
    if (res.ok) setAllocations(res.data);
    else fail('Failed to load endorsed cheques: ' + res.error.message);
    setLoading(false);
  }, []);

  useEffect(() => { loadAllocations(); }, [loadAllocations]);

  // api.cheques.endorsedAllocations() already returns exactly ACTIVE VENDOR_PAYMENT/EXPENSE_PAYMENT
  // allocations (DEPOSIT excluded server-side), so only search filtering happens here.
  const endorsedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allocations
      .filter(a => {
        if (!q) return true;
        return (
          (a.cheque_no || '').toLowerCase().includes(q) ||
          (a.target_name || '').toLowerCase().includes(q) ||
          (a.vendor_name || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.allocation_date.localeCompare(a.allocation_date));
  }, [allocations, search]);

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
      `Reversed ${formatCurrency(returningAlloc.amount)} back into Cheques in Hand, dated ${returnDate}, ` +
      `and freed up that much of the cheque's balance again.`
    );
    setReturningAlloc(null);
    await loadAllocations();
  };

  return (
    <AppLayout pageTitle="Cheque Return">
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
            <h3 className="font-lora font-semibold text-lg text-slate-800">Endorsed Cheques</h3>
            <p className="text-xs text-slate-500 font-medium">
              Every cheque payment still standing — hand one back to reverse just that payment,
              without touching the cheque's other allocations or the original receipt.
            </p>
          </div>
          <div className="relative min-w-[240px]">
            <input
              type="text"
              placeholder="Cheque no., customer, or vendor..."
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
                {endorsedRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center p-8 text-slate-400">
                      {loading ? 'Loading…' : 'No endorsed cheques match this filter.'}
                    </td>
                  </tr>
                ) : (
                  endorsedRows.map(row => (
                    <tr key={row.allocation_id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-mono font-semibold text-slate-800">{row.cheque_no || '-'}</td>
                      <td className="p-3 font-semibold text-slate-700">{row.vendor_name || row.target_name || 'Vendor'}</td>
                      <td className="p-3 text-center">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-violet-50 text-violet-800 border-violet-200">
                          {DISPOSITION_LABELS[row.disposition_type as Exclude<ChequeDispositionType, 'DEPOSIT'>]}
                        </span>
                      </td>
                      <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(row.amount)}</td>
                      <td className="p-3 text-center text-xs text-slate-600">{row.allocation_date}</td>
                      <td className="p-3 text-center" data-no-print>
                        <button
                          onClick={() => openReturn(row)}
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200 transition-colors"
                        >
                          <RotateCcw size={11} /> Return
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Return confirmation ── */}
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
    </AppLayout>
  );
}
