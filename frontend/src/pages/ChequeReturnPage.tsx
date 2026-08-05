import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { todayISO } from '@/lib/cheques';
import { maskedBusinessAccountName } from '@/lib/access';
import { AlertTriangle, CheckCircle2, RotateCcw, Search } from 'lucide-react';
import type { ChequeAllocation, Expense } from '@/types';

// MOSTLY NOT CONNECTED — scaffolding only, per explicit instruction. "Confirm Return" below does
// not dispatch anything against AppContext's demo reducer (no REVERSE_CHEQUE_ALLOCATION/
// BOUNCE_ISSUED_CHEQUE action exists there yet) and does not call the real backend
// (cheques:reverse-allocation / expenses:bounceIssuedCheque, expenses:returnIssuedCheque — see
// backend/PROGRESS.md). Wiring THAT up for real means both: adding reducer cases here, AND
// switching this page off demo data onto real window.api calls, neither of which has been done for
// ANY page in this frontend yet. Marking a DEPOSITED cheque cleared is the one exception —
// MARK_CHEQUE_CLEARED already exists and is real (ChequesTab.tsx uses the exact same dispatch), so
// it's wired for real here too rather than faked.
//
// WHY THIS PAGE IS SEPARATE FROM ChequesTab.tsx's/ExpensesPage's existing "Dispose"/"Bounce"/
// "Return to Sender" actions: those operate on a whole document (every active allocation on a
// received cheque, or the underlying receipt). This page operates on ONE payment at a time —
// either one endorsement handed back, one cheque WE wrote bouncing/being handed back unpaid, or one
// deposited cheque's actual bank outcome — without touching anything else on the source document.
//
// Deliberately no "Disposition" column — per explicit instruction, what a cheque was originally
// used for (endorsed to a vendor, paid an expense, issued by us, or deposited) doesn't matter here.
// Every row just gets the same two actions: Return (something's wrong, reverse it) or Mark Cleared
// (it's fine, done with it). What each one actually DOES underneath still depends on the row's
// real kind — that's still tracked internally (`kind`), just never shown:
//   ALLOCATION — Return reverses this one endorsement (Dr/Cr swapped from the original entry).
//   ISSUED     — Return reverses this expense's own ledger entry (a cheque we wrote bouncing).
//   DEPOSITED  — Return means the bank bounced/rejected it (reverses the ORIGINAL receipt, not
//                just an allocation); Mark Cleared is a real status flip (cheques.service.js#
//                markCleared() on the real backend, no ledger effect — it was already counted).
// Mark Cleared on an ALLOCATION/ISSUED row has no equivalent backend concept (once endorsed/issued,
// the money already moved — there's nothing left to "clear"), so it's just a local dismissal: the
// row drops off this list, nothing is written anywhere.

type ReturnableRow =
  | { kind: 'ALLOCATION'; key: string; allocation: ChequeAllocation; chequeNo: string; fromLabel: string; toLabel: string; amount: number; date: string }
  | { kind: 'ISSUED'; key: string; expense: Expense; chequeNo: string; fromLabel: string; toLabel: string; amount: number; date: string }
  | { kind: 'DEPOSITED'; key: string; receiptId: string; chequeNo: string; fromLabel: string; toLabel: string; amount: number; date: string };

export default function ChequeReturnPage() {
  const { state, dispatch } = useApp();

  const [search, setSearch] = useState('');
  const [returningRow, setReturningRow] = useState<ReturnableRow | null>(null);
  const [returnDate, setReturnDate] = useState(todayISO());
  const [returnRemarks, setReturnRemarks] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  // ALLOCATION/ISSUED "Mark Cleared" has no backend state to flip — it's a pure local dismissal,
  // so it's tracked here rather than in AppContext (nothing to persist; a page refresh brings the
  // row back, same as any other unconnected preview action on this page).
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());

  // Only ACTIVE VENDOR_PAYMENT/EXPENSE_PAYMENT allocations — DEPOSIT is excluded on purpose
  // (moving a deposit to a different bank is a different action, not this one), same as the
  // backend's listEndorsedAllocations().
  const allocationRows = useMemo((): ReturnableRow[] => {
    return state.chequeAllocations
      .filter(a => a.status === 'ACTIVE' && a.dispositionType !== 'DEPOSIT')
      .map((a): ReturnableRow => {
        const receipt = state.receipts.find(r => r.id === a.receiptId);
        const customer = receipt ? state.customers.find(c => c.id === receipt.customerId) : undefined;
        const targetName = a.targetType === 'VENDOR'
          ? state.vendors.find(v => v.id === a.targetId)?.name || 'Vendor'
          : maskedBusinessAccountName(a.targetId, state.businessAccounts, state.chartAccounts, state.currentUserRole) || 'Account';
        return {
          kind: 'ALLOCATION',
          key: `alloc-${a.id}`,
          allocation: a,
          chequeNo: receipt?.chequeNo || '-',
          fromLabel: customer?.name || 'Unknown customer',
          toLabel: targetName,
          amount: a.amount,
          date: a.allocationDate,
        };
      });
  }, [state.chequeAllocations, state.receipts, state.customers, state.vendors, state.businessAccounts, state.chartAccounts, state.currentUserRole]);

  // Posted CHEQUE_ISSUED expenses still outstanding (no status recorded, or explicitly 'Pending')
  // — a cheque WE wrote that could still bounce or be handed back unpaid, mirrors the backend's
  // listReturnableIssuedCheques().
  const issuedChequeRows = useMemo((): ReturnableRow[] => {
    return state.expenses
      .filter(e =>
        e.paymentMode === 'ChequeIssued' &&
        (e.status === undefined || e.status === 'Posted') &&
        (e.issuedChequeStatus === undefined || e.issuedChequeStatus === 'Pending')
      )
      .map((e): ReturnableRow => {
        const bank = state.bankAccounts.find(b => b.id === e.bankId);
        const targetName = maskedBusinessAccountName(e.businessAccountId, state.businessAccounts, state.chartAccounts, state.currentUserRole) || 'Account';
        return {
          kind: 'ISSUED',
          key: `issued-${e.id}`,
          expense: e,
          chequeNo: e.issuedChequeNo || '-',
          fromLabel: bank?.name || 'Our bank',
          toLabel: targetName,
          amount: e.amount,
          date: e.date,
        };
      });
  }, [state.expenses, state.bankAccounts, state.businessAccounts, state.chartAccounts, state.currentUserRole]);

  // Deposited, not yet cleared — MARK_CHEQUE_CLEARED is a real, already-wired reducer action
  // (ChequesTab.tsx uses the same one): pressing Mark Cleared here flips chequeStatus to
  // 'CLEARED', which this filter then naturally excludes on the next render.
  const depositedRows = useMemo((): ReturnableRow[] => {
    return state.receipts
      .filter(r => r.chequeStatus === 'DEPOSITED')
      .map((r): ReturnableRow => {
        const customer = state.customers.find(c => c.id === r.customerId);
        const bank = state.bankAccounts.find(b => b.id === r.depositBankId);
        return {
          kind: 'DEPOSITED',
          key: `deposited-${r.id}`,
          receiptId: r.id,
          chequeNo: r.chequeNo || '-',
          fromLabel: customer?.name || 'Unknown customer',
          toLabel: bank?.name || 'Our bank',
          amount: r.amount,
          date: r.chequeReceivedDate || r.date,
        };
      });
  }, [state.receipts, state.customers, state.bankAccounts]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...allocationRows, ...issuedChequeRows, ...depositedRows]
      .filter(row => !dismissedKeys.has(row.key))
      .filter(row => {
        if (!q) return true;
        return (
          row.chequeNo.toLowerCase().includes(q) ||
          row.fromLabel.toLowerCase().includes(q) ||
          row.toLabel.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [allocationRows, issuedChequeRows, depositedRows, dismissedKeys, search]);

  const openReturn = (row: ReturnableRow) => {
    setReturningRow(row);
    setReturnDate(todayISO());
    setReturnRemarks('');
  };

  const markCleared = (row: ReturnableRow) => {
    if (row.kind === 'DEPOSITED') {
      dispatch({ type: 'MARK_CHEQUE_CLEARED', receiptId: row.receiptId });
      setSuccessMsg(`Cheque ${row.chequeNo} marked cleared — removed from this list, ledger untouched.`);
    } else {
      // No backend concept to flip for these two kinds — just drop it from view.
      setDismissedKeys(prev => new Set(prev).add(row.key));
      setSuccessMsg(`Cheque ${row.chequeNo} marked cleared — removed from this list.`);
    }
    setTimeout(() => setSuccessMsg(''), 6000);
  };

  // Scaffolding only — see the file-level note above. Real behavior once wired:
  //   ALLOCATION — reverse this one allocation (Dr/Cr swapped from the original entry, dated
  //                returnDate), free up the cheque's balance, leave the original entries and the
  //                cheque's other allocations untouched.
  //   ISSUED     — reverse this expense's own ledger entry (Dr our bank / Cr the paid account,
  //                dated returnDate) and mark the cheque RETURNED, since our bank never actually
  //                lost the money and the vendor/account was never actually paid.
  //   DEPOSITED  — the bank bounced/rejected it instead of clearing it: reverse the ORIGINAL
  //                receipt itself (the customer's due is restored), not just an allocation — the
  //                same whole-cheque reversal cheques.service.js#bounce()/#returnToSender() already
  //                do on the real backend.
  const confirmReturn = () => {
    if (!returningRow) return;
    let message: string;
    if (returningRow.kind === 'ALLOCATION') {
      message = `(Preview only — not connected) Would reverse ${formatCurrency(returningRow.amount)} back into ` +
        `Cheques in Hand, dated ${returnDate}, and free up that much of the cheque's balance again.`;
    } else if (returningRow.kind === 'DEPOSITED') {
      message = `(Preview only — not connected) Would reverse the original receipt from ${returningRow.fromLabel} ` +
        `(${formatCurrency(returningRow.amount)}), dated ${returnDate}, restoring their due — the cheque never actually cleared.`;
    } else {
      message = `(Preview only — not connected) Would reverse ${formatCurrency(returningRow.amount)} back into ` +
        `${returningRow.fromLabel}, dated ${returnDate}, and mark this issued cheque returned.`;
    }
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(''), 6000);
    setReturningRow(null);
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
            <h3 className="font-lora font-semibold text-lg text-slate-800">Cheque Return</h3>
            <p className="text-xs text-slate-500 font-medium">
              Every cheque payment still standing — return it if something's wrong, or mark it
              cleared if it's not.
            </p>
          </div>
          <div className="relative min-w-[240px]">
            <input
              type="text"
              placeholder="Cheque no., from, or paid to..."
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
                  <th className="p-3">From</th>
                  <th className="p-3">Paid To</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3 text-center">Date</th>
                  <th className="p-3 text-center" data-no-print>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center p-8 text-slate-400">
                      No returnable cheques match this filter.
                    </td>
                  </tr>
                ) : (
                  rows.map(row => (
                    <tr key={row.key} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-mono font-semibold text-slate-800">{row.chequeNo}</td>
                      <td className="p-3 font-semibold text-slate-800">{row.fromLabel}</td>
                      <td className="p-3 font-semibold text-slate-700">{row.toLabel}</td>
                      <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(row.amount)}</td>
                      <td className="p-3 text-center text-xs text-slate-600">{row.date}</td>
                      <td className="p-3 text-center" data-no-print>
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => openReturn(row)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 transition-colors"
                          >
                            <RotateCcw size={11} /> Return
                          </button>
                          <button
                            onClick={() => markCleared(row)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 transition-colors"
                          >
                            <CheckCircle2 size={11} /> Mark Cleared
                          </button>
                        </div>
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
      {returningRow && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-2 flex items-center gap-2">
              <AlertTriangle size={18} className="text-slate-600" />
              {returningRow.kind === 'ALLOCATION'
                ? 'Return This Endorsement'
                : returningRow.kind === 'DEPOSITED'
                ? 'Cheque Bounced / Rejected'
                : 'Return This Issued Cheque'}
            </h3>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              {returningRow.kind === 'ALLOCATION' ? (
                <>
                  Reverses <strong>only this payment</strong> ({formatCurrency(returningRow.amount)}) —
                  the cheque's other allocations, the original receipt, and the cheque itself are
                  untouched. The cheque's available balance goes back up by this amount, so it can be
                  disposed of again another way. Nothing is deleted — the correction is posted on the
                  date below, dated separately from the original entry.
                </>
              ) : returningRow.kind === 'DEPOSITED' ? (
                <>
                  Reverses <strong>the original receipt</strong> ({formatCurrency(returningRow.amount)})
                  from {returningRow.fromLabel} — the cheque never actually cleared, so their due is
                  restored. Nothing is deleted — the correction is posted on the date below, dated
                  separately from the original entry.
                </>
              ) : (
                <>
                  Reverses <strong>this cheque</strong> ({formatCurrency(returningRow.amount)}) —
                  our bank never actually lost the money and {returningRow.toLabel} was never
                  actually paid, so both balances are restored. Nothing is deleted — the correction
                  is posted on the date below, dated separately from the original entry.
                </>
              )}
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
                onClick={() => setReturningRow(null)}
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
