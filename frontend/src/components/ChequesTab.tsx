import { Fragment, useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import { getUnallocatedBalance, todayISO } from '@/lib/cheques';
import { Printer, FileDown, FileSpreadsheet, Search, AlertTriangle } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import SearchableSelect from '@/components/SearchableSelect';
import { filterBusinessAccountsForRole, maskedBusinessAccountName } from '@/lib/access';
import type { Receipt, ChequeAllocation, ChequeDisposition, ChequeStatus } from '@/types';

const STATUS_STYLES: Record<ChequeStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  DEPOSITED: 'bg-blue-50 text-blue-800 border-blue-200',
  ENDORSED: 'bg-violet-50 text-violet-800 border-violet-200',
  PARTIALLY_ENDORSED: 'bg-orange-50 text-orange-800 border-orange-200',
  CLEARED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  BOUNCED: 'bg-rose-50 text-rose-800 border-rose-200',
};

const DISPOSITION_LABELS: Record<ChequeDisposition, string> = {
  DEPOSIT: 'Deposit to bank',
  VENDOR_PAYMENT: 'Pay a vendor',
  EXPENSE_PAYMENT: 'Pay an expense account',
};

export default function ChequesTab() {
  const { state, dispatch } = useApp();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | ChequeStatus>('open');

  // Dispose dialog state
  const [disposingId, setDisposingId] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<ChequeDisposition>('VENDOR_PAYMENT');
  const [targetId, setTargetId] = useState('');
  // DEPOSIT only: which of our banks the cheque lands in. Held on the CHEQUE
  // (receipt.depositBankId), not the allocation, because one cheque is never
  // split across two banks — cash_and_bank.md SS5.
  const [depositBankId, setDepositBankId] = useState('');
  const [allocAmount, setAllocAmount] = useState<number>(0);
  const [allocDate, setAllocDate] = useState(todayISO());
  const [allocRemarks, setAllocRemarks] = useState('');
  const [dialogError, setDialogError] = useState('');

  // Bounce confirmation state
  const [bouncingId, setBouncingId] = useState<string | null>(null);
  const [bounceDate, setBounceDate] = useState(todayISO());

  const [successMsg, setSuccessMsg] = useState('');

  const chequeRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.receipts
      .filter(r => r.paymentMode === 'Cheque')
      .map(r => {
        const customer = state.customers.find(c => c.id === r.customerId);
        const status = (r.chequeStatus || 'PENDING') as ChequeStatus;
        return {
          receipt: r,
          customerName: customer?.name || 'Unknown customer',
          status,
          unallocated: status === 'BOUNCED' ? 0 : getUnallocatedBalance(r, state.chequeAllocations, state.expenses),
          allocations: state.chequeAllocations.filter(a => a.receiptId === r.id),
        };
      })
      .filter(row => {
        if (statusFilter === 'open') {
          if (row.status !== 'PENDING' && row.status !== 'PARTIALLY_ENDORSED') return false;
        } else if (statusFilter !== 'all' && row.status !== statusFilter) {
          return false;
        }
        if (!q) return true;
        return (
          (row.receipt.chequeNo || '').toLowerCase().includes(q) ||
          row.customerName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (a.receipt.chequeDate || '').localeCompare(b.receipt.chequeDate || ''));
  }, [state.receipts, state.customers, state.chequeAllocations, state.expenses, search, statusFilter]);

  const disposingRow = chequeRows.find(r => r.receipt.id === disposingId)
    ?? (disposingId
      ? (() => {
          const r = state.receipts.find(x => x.id === disposingId);
          if (!r) return undefined;
          return {
            receipt: r,
            customerName: state.customers.find(c => c.id === r.customerId)?.name || 'Unknown customer',
            status: (r.chequeStatus || 'PENDING') as ChequeStatus,
            unallocated: getUnallocatedBalance(r, state.chequeAllocations, state.expenses),
            allocations: state.chequeAllocations.filter(a => a.receiptId === r.id),
          };
        })()
      : undefined);

  function openDispose(receipt: Receipt) {
    const remaining = getUnallocatedBalance(receipt, state.chequeAllocations, state.expenses);
    setDisposingId(receipt.id);
    setDisposition('VENDOR_PAYMENT');
    setTargetId('');
    setDepositBankId('');
    setAllocAmount(remaining);          // defaults to the remaining unallocated balance
    setAllocDate(todayISO());
    setAllocRemarks('');
    setDialogError('');
  }

  const saveAllocation = () => {
    if (!disposingRow) return;
    const remaining = disposingRow.unallocated;

    if (allocAmount <= 0) return setDialogError('Amount must be greater than 0.');
    if (allocAmount > remaining) {
      return setDialogError(
        `Amount cannot exceed the unallocated balance of ${formatCurrency(remaining)}.`
      );
    }
    if (disposition !== 'DEPOSIT' && !targetId) {
      return setDialogError('Please choose who this cheque is being paid to.');
    }
    // Without this the money leaves Cheques in Hand and lands nowhere.
    if (disposition === 'DEPOSIT' && !depositBankId) {
      return setDialogError('Please choose which bank account this cheque is deposited into.');
    }
    if (!allocDate) return setDialogError('Please pick an allocation date.');

    const allocation: Omit<ChequeAllocation, 'id'> = {
      receiptId: disposingRow.receipt.id,
      dispositionType: disposition,
      targetType: disposition === 'DEPOSIT'
        ? null
        : disposition === 'VENDOR_PAYMENT' ? 'VENDOR' : 'BUSINESS_ACCOUNT',
      targetId: disposition === 'DEPOSIT' ? null : targetId,
      amount: allocAmount,
      allocationDate: allocDate,
      remarks: allocRemarks,
      status: 'ACTIVE',
    };

    if (disposition === 'DEPOSIT') {
      dispatch({
        type: 'SET_DEPOSIT_BANK',
        receiptId: disposingRow.receipt.id,
        bankId: depositBankId
      });
    }

    dispatch({ type: 'ADD_CHEQUE_ALLOCATION', allocation });

    const leftover = remaining - allocAmount;
    setSuccessMsg(
      leftover > 0
        ? `Allocated ${formatCurrency(allocAmount)}. ${formatCurrency(leftover)} of this cheque is still unassigned — assign it before the cheque is fully disposed.`
        : `Allocated ${formatCurrency(allocAmount)}. This cheque is now fully disposed.`
    );
    setTimeout(() => setSuccessMsg(''), 5000);

    // Keep the dialog open while a remainder is outstanding, so it can never
    // be silently orphaned; close once the cheque is fully allocated.
    if (leftover > 0) {
      setAllocAmount(leftover);
      setTargetId('');
      setDepositBankId('');
      setAllocRemarks('');
      setDialogError('');
    } else {
      setDisposingId(null);
    }
  };

  const confirmBounce = () => {
    if (!bouncingId) return;
    const row = state.receipts.find(r => r.id === bouncingId);
    dispatch({ type: 'BOUNCE_CHEQUE', receiptId: bouncingId, bouncedDate: bounceDate });
    const reversedCount = state.chequeAllocations.filter(
      a => a.receiptId === bouncingId && a.status === 'ACTIVE'
    ).length;
    setSuccessMsg(
      reversedCount > 0
        ? `Cheque ${row?.chequeNo || ''} marked bounced. The customer's due is restored and ${reversedCount} allocation(s) were reversed.`
        : `Cheque ${row?.chequeNo || ''} marked bounced. The customer's due is restored.`
    );
    setTimeout(() => setSuccessMsg(''), 5000);
    setBouncingId(null);
  };

  const targetOptions = useMemo(() => {
    if (disposition === 'VENDOR_PAYMENT') {
      return state.vendors.map(v => ({ value: v.id, label: v.name }));
    }
    if (disposition === 'EXPENSE_PAYMENT') {
      return filterBusinessAccountsForRole(state.businessAccounts, state.chartAccounts, state.currentUserRole)
        .map(b => ({ value: b.id, label: `${b.name} (${b.id})` }));
    }
    return [];
  }, [disposition, state.vendors, state.businessAccounts, state.chartAccounts, state.currentUserRole]);

  function targetName(a: ChequeAllocation): string {
    if (a.dispositionType === 'DEPOSIT') return 'Bank deposit';
    if (a.targetType === 'VENDOR') {
      return state.vendors.find(v => v.id === a.targetId)?.name || 'Vendor';
    }
    return maskedBusinessAccountName(a.targetId, state.businessAccounts, state.chartAccounts, state.currentUserRole) || 'Account';
  }

  const handleExportExcel = () => {
    const headers = ['Cheque No', 'Date on Cheque', 'Received', 'Customer', 'Amount', 'Unallocated', 'Status'];
    const rows = chequeRows.map(r => [
      r.receipt.chequeNo || '-', r.receipt.chequeDate || '-', r.receipt.chequeReceivedDate || '-',
      r.customerName, r.receipt.amount, r.unallocated, r.status,
    ]);
    exportRowsToExcel('cheque-register', headers, rows);
  };

  return (
    <div>
      {successMsg && (
        <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
      )}

      {/* Filter bar */}
      <div
        className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white"
        style={{ borderColor: 'var(--border-color)' }}
        data-no-print
      >
        <div className="flex flex-wrap items-center gap-4 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[220px]">
            <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search:</span>
            <div className="relative">
              <input
                type="text"
                placeholder="Cheque no. or customer..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="soleria-input w-full py-2 text-sm pr-10 font-semibold"
              />
              <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
            </div>
          </div>
          <div>
            <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Status:</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
              className="soleria-input py-1.5 cursor-pointer text-xs min-w-[170px]"
            >
              <option value="open">Open (Pending / Partial)</option>
              <option value="all">All cheques</option>
              <option value="PENDING">Pending</option>
              <option value="PARTIALLY_ENDORSED">Partially Endorsed</option>
              <option value="ENDORSED">Endorsed</option>
              <option value="DEPOSITED">Deposited</option>
              <option value="CLEARED">Cleared</option>
              <option value="BOUNCED">Bounced</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
            <Printer size={16} /> Print
          </button>
          <button onClick={exportToPDF} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
            <FileDown size={16} /> Export PDF
          </button>
          <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
            <FileSpreadsheet size={16} /> Export Excel
          </button>
        </div>
      </div>

      <div className="card-white p-6 md:p-8 bg-white border">
        <div className="flex items-center justify-between border-b pb-4 mb-6">
          <div>
            <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX</h1>
            <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Footwear Distribution</p>
          </div>
          <h2 className="font-lora font-semibold text-lg uppercase">Cheques Received</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr
                className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <th className="p-3 pl-4">Cheque No.</th>
                <th className="p-3 text-center">Date on Cheque</th>
                <th className="p-3 text-center">Received</th>
                <th className="p-3">Customer</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-right">Unallocated</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-center" data-no-print>Actions</th>
              </tr>
            </thead>
            <tbody>
              {chequeRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center p-8 text-slate-400">
                    No cheques match this filter.
                  </td>
                </tr>
              ) : (
                chequeRows.map(row => {
                  const canDispose = row.status !== 'BOUNCED' && row.status !== 'CLEARED' && row.unallocated > 0;
                  return (
                    <Fragment key={row.receipt.id}>
                      <tr
                        className="border-b hover:bg-slate-50/50"
                        style={{ borderColor: 'var(--border-table)' }}
                      >
                        <td className="p-3 pl-4 font-mono font-semibold text-slate-800">
                          {row.receipt.chequeNo || '-'}
                        </td>
                        <td className="p-3 text-center text-xs text-slate-600">{row.receipt.chequeDate || '-'}</td>
                        <td className="p-3 text-center text-xs text-slate-500">{row.receipt.chequeReceivedDate || '-'}</td>
                        <td className="p-3 font-semibold text-slate-800">{row.customerName}</td>
                        <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(row.receipt.amount)}</td>
                        <td className="p-3 text-right font-bold" style={{ color: row.unallocated > 0 ? '#b45309' : '#64748b' }}>
                          {row.unallocated > 0 ? formatCurrency(row.unallocated) : '—'}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${STATUS_STYLES[row.status]}`}>
                            {row.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="p-3 text-center whitespace-nowrap" data-no-print>
                          {canDispose && (
                            <button
                              onClick={() => openDispose(row.receipt)}
                              className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline mr-3"
                            >
                              Dispose
                            </button>
                          )}
                          {row.status === 'DEPOSITED' && (
                            <button
                              onClick={() => dispatch({ type: 'MARK_CHEQUE_CLEARED', receiptId: row.receipt.id })}
                              className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 underline mr-3"
                            >
                              Mark Cleared
                            </button>
                          )}
                          {row.status !== 'BOUNCED' && (
                            <button
                              onClick={() => { setBouncingId(row.receipt.id); setBounceDate(todayISO()); }}
                              className="text-xs font-semibold text-rose-600 hover:text-rose-800 underline"
                            >
                              Mark Bounced
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* Allocation history for this cheque */}
                      {row.allocations.length > 0 && (
                        <tr className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                          <td colSpan={8} className="px-4 py-2 bg-slate-50/60">
                            <div className="flex flex-col gap-1">
                              {row.allocations.map(a => (
                                <div key={a.id} className="flex items-center gap-3 text-[11px]">
                                  <span className="font-semibold uppercase tracking-wider text-slate-400" style={{ minWidth: 90 }}>
                                    {a.dispositionType.replace('_', ' ')}
                                  </span>
                                  <span className="font-semibold text-slate-700">{targetName(a)}</span>
                                  <span className="font-mono font-bold text-slate-800">{formatCurrency(a.amount)}</span>
                                  <span className="text-slate-500">{a.allocationDate}</span>
                                  {a.status === 'REVERSED' && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 uppercase">
                                      Reversed
                                    </span>
                                  )}
                                  {a.remarks && <span className="text-slate-400 italic truncate">{a.remarks}</span>}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Dispose dialog ── */}
      {disposingRow && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-lg mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-1">Dispose of Cheque</h3>
            <p className="text-xs text-slate-500 mb-4">
              {disposingRow.receipt.chequeNo} &middot; {disposingRow.customerName} &middot; {formatCurrency(disposingRow.receipt.amount)}
            </p>

            <div className="flex items-center justify-between p-3 rounded-lg border mb-4"
                 style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">Unallocated balance</span>
              <span className="font-mono font-bold text-amber-900">{formatCurrency(disposingRow.unallocated)}</span>
            </div>

            {dialogError && (
              <div className="banner-error rounded-lg px-3 py-2 text-xs mb-3">{dialogError}</div>
            )}

            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Disposition</label>
                <select
                  value={disposition}
                  onChange={e => { setDisposition(e.target.value as ChequeDisposition); setTargetId(''); }}
                  className="soleria-input cursor-pointer font-semibold"
                >
                  {(Object.keys(DISPOSITION_LABELS) as ChequeDisposition[]).map(d => (
                    <option key={d} value={d}>{DISPOSITION_LABELS[d]}</option>
                  ))}
                </select>
              </div>

              {disposition !== 'DEPOSIT' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    {disposition === 'VENDOR_PAYMENT' ? 'Vendor' : 'Expense / business account'}
                  </label>
                  <SearchableSelect
                    options={targetOptions}
                    value={targetId}
                    onChange={setTargetId}
                    placeholder="Search & select..."
                    searchPlaceholder="Type to search..."
                  />
                </div>
              )}

              {disposition === 'DEPOSIT' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Deposit Into <span className="text-red-500 font-bold">*</span>
                  </label>
                  {state.bankAccounts.length === 0 ? (
                    <div className="soleria-input text-rose-600 text-sm flex items-center font-semibold">
                      Add a bank account first
                    </div>
                  ) : (
                    <SearchableSelect
                      options={state.bankAccounts.map(b => ({ value: b.id, label: b.name }))}
                      value={depositBankId}
                      onChange={setDepositBankId}
                      placeholder="Select bank account..."
                      searchPlaceholder="Type to search..."
                    />
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    Without this the cheque leaves Cheques in Hand and lands nowhere.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Amount</label>
                  <input
                    type="number"
                    min={0}
                    max={disposingRow.unallocated}
                    value={allocAmount || ''}
                    onChange={e => setAllocAmount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="soleria-input font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Allocation date</label>
                  <input
                    type="date"
                    value={allocDate}
                    onChange={e => setAllocDate(e.target.value)}
                    className="soleria-input"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Cash Book dates the outflow here</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks</label>
                <input
                  type="text"
                  value={allocRemarks}
                  onChange={e => setAllocRemarks(e.target.value)}
                  placeholder="Optional note..."
                  className="soleria-input"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setDisposingId(null)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                onClick={saveAllocation}
                className="px-4 py-2 text-sm rounded-lg bg-[#111c2a] text-[#B08D57] hover:opacity-90"
              >
                Save Allocation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bounce confirmation ── */}
      {bouncingId && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-2 flex items-center gap-2">
              <AlertTriangle size={18} className="text-rose-600" /> Mark Cheque Bounced
            </h3>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              This reverses <strong>both sides</strong>: the customer's payment is cancelled so their
              due goes back up, and every allocation made from this cheque is reversed so the
              vendor's or expense account's balance goes back up too. Original entries are kept —
              the correction is posted on the date below, so reports you have already printed still
              reconcile.
            </p>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Bounce date</label>
              <input
                type="date"
                value={bounceDate}
                onChange={e => setBounceDate(e.target.value)}
                className="soleria-input"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setBouncingId(null)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmBounce}
                className="px-4 py-2 text-sm rounded-lg bg-rose-600 text-white hover:bg-rose-700"
              >
                Confirm Bounce
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
