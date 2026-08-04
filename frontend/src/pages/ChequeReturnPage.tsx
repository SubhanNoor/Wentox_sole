import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { todayISO } from '@/lib/cheques';
import { maskedBusinessAccountName } from '@/lib/access';
import { AlertTriangle, RotateCcw, Search } from 'lucide-react';
import type { ChequeAllocation, ChequeDisposition } from '@/types';

// NOT CONNECTED — scaffolding only, per explicit instruction. "Confirm Return" below does not
// dispatch anything against AppContext's demo reducer (no REVERSE_CHEQUE_ALLOCATION action exists
// there yet) and does not call the real backend (cheques:reverse-allocation, built this session in
// cheques.service.js#reverseAllocation — see System_architecture/soft_delete_and_duplicate_check.md-
// style docs / backend/PROGRESS.md for the write-up). Wiring this up for real means both: adding a
// reducer case here, AND switching this page off demo data onto real window.api calls, neither of
// which has been done for ANY page in this frontend yet.
//
// WHY THIS PAGE IS SEPARATE FROM ChequesTab.tsx's existing "Dispose"/"Bounce"/"Return to Sender"
// actions: those operate on a whole CHEQUE (every active allocation on it, or the underlying
// receipt). This page operates on ONE ENDORSEMENT at a time — e.g. a vendor hands a cheque back
// after being paid with it — without touching the cheque's other allocations or the original
// receipt at all. The cheque itself is fine; only this one payment is being undone.

const DISPOSITION_LABELS: Record<Exclude<ChequeDisposition, 'DEPOSIT'>, string> = {
  VENDOR_PAYMENT: 'Paid to Vendor',
  EXPENSE_PAYMENT: 'Paid to Expense Account',
};

export default function ChequeReturnPage() {
  const { state } = useApp();

  const [search, setSearch] = useState('');
  const [returningAlloc, setReturningAlloc] = useState<ChequeAllocation | null>(null);
  const [returnDate, setReturnDate] = useState(todayISO());
  const [returnRemarks, setReturnRemarks] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Only ACTIVE VENDOR_PAYMENT/EXPENSE_PAYMENT allocations — DEPOSIT is excluded on purpose
  // (moving a deposit to a different bank is a different action, not this one), same as the
  // backend's listEndorsedAllocations().
  const endorsedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.chequeAllocations
      .filter(a => a.status === 'ACTIVE' && a.dispositionType !== 'DEPOSIT')
      .map(a => {
        const receipt = state.receipts.find(r => r.id === a.receiptId);
        const customer = receipt ? state.customers.find(c => c.id === receipt.customerId) : undefined;
        const targetName = a.targetType === 'VENDOR'
          ? state.vendors.find(v => v.id === a.targetId)?.name || 'Vendor'
          : maskedBusinessAccountName(a.targetId, state.businessAccounts, state.chartAccounts, state.currentUserRole) || 'Account';
        return { allocation: a, receipt, customerName: customer?.name || 'Unknown customer', targetName };
      })
      .filter(row => {
        if (!q) return true;
        return (
          (row.receipt?.chequeNo || '').toLowerCase().includes(q) ||
          row.customerName.toLowerCase().includes(q) ||
          row.targetName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.allocation.allocationDate.localeCompare(a.allocation.allocationDate));
  }, [state.chequeAllocations, state.receipts, state.customers, state.vendors, state.businessAccounts, state.chartAccounts, state.currentUserRole, search]);

  const openReturn = (allocation: ChequeAllocation) => {
    setReturningAlloc(allocation);
    setReturnDate(todayISO());
    setReturnRemarks('');
  };

  // Scaffolding only — see the file-level note above. Real behavior once wired: reverse this one
  // allocation (Dr/Cr swapped from the original entry, dated returnDate), free up the cheque's
  // balance, leave the original entries and the cheque's other allocations untouched.
  const confirmReturn = () => {
    if (!returningAlloc) return;
    setSuccessMsg(
      `(Preview only — not connected) Would reverse ${formatCurrency(returningAlloc.amount)} back into ` +
      `Cheques in Hand, dated ${returnDate}, and free up that much of the cheque's balance again.`
    );
    setTimeout(() => setSuccessMsg(''), 6000);
    setReturningAlloc(null);
  };

  return (
    <AppLayout pageTitle="Cheque Return">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
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
                  <th className="p-3">From (Customer)</th>
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
                    <td colSpan={7} className="text-center p-8 text-slate-400">
                      No endorsed cheques match this filter.
                    </td>
                  </tr>
                ) : (
                  endorsedRows.map(row => (
                    <tr key={row.allocation.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-mono font-semibold text-slate-800">{row.receipt?.chequeNo || '-'}</td>
                      <td className="p-3 font-semibold text-slate-800">{row.customerName}</td>
                      <td className="p-3 font-semibold text-slate-700">{row.targetName}</td>
                      <td className="p-3 text-center">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-violet-50 text-violet-800 border-violet-200">
                          {DISPOSITION_LABELS[row.allocation.dispositionType as Exclude<ChequeDisposition, 'DEPOSIT'>]}
                        </span>
                      </td>
                      <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(row.allocation.amount)}</td>
                      <td className="p-3 text-center text-xs text-slate-600">{row.allocation.allocationDate}</td>
                      <td className="p-3 text-center" data-no-print>
                        <button
                          onClick={() => openReturn(row.allocation)}
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
