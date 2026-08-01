import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Printer, Search, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { expenseModeLabel, getAccountBalance, getCashAccount } from '@/lib/cashbank';
import { maskedBusinessAccountName } from '@/lib/access';
import type { ReceiptMode, ExpenseMode } from '@/types';

interface CashBookRow {
  date: string;
  accountName: string;
  remarks: string;
  // Widened for the two outgoing cheque modes. Rendered through
  // expenseModeLabel so the column still reads "Cheque (Issued)" rather than
  // exposing the internal spelling.
  mode: ReceiptMode | ExpenseMode;
  chequeNo: string;
  direction: 'Receipt' | 'Payment';
  amount: number;
}

export function ReportCashBookContent() {
  const { state } = useApp();

  const [filterBy, setFilterBy] = useState<'date' | 'month'>('date');
  const [searchQuery, setSearchQuery] = useState('');
  const [specificDate, setSpecificDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterMonth, setFilterMonth] = useState<number>(new Date().getMonth());
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Period boundaries (as ISO date strings) for the selected filter
  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    if (filterBy === 'date') {
      return { periodStart: specificDate, periodEnd: specificDate, periodLabel: specificDate };
    }
    const start = `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(filterYear, filterMonth + 1, 0).getDate();
    const end = `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { periodStart: start, periodEnd: end, periodLabel: `${months[filterMonth]} ${filterYear}` };
  }, [filterBy, specificDate, filterMonth, filterYear]);

  // All cash book rows (Receipts = inflow, Expenses = outflow) within the period
  const cashBookRows = useMemo(() => {
    const rows: CashBookRow[] = [];

    state.receipts
      .filter(r => r.date >= periodStart && r.date <= periodEnd)
      .forEach(r => {
        const cust = state.customers.find(c => c.id === r.customerId);
        rows.push({
          date: r.date,
          accountName: cust?.name || 'Walk-in Client',
          remarks: r.remarks || r.details || '-',
          mode: r.paymentMode,
          chequeNo: r.chequeNo || '-',
          direction: 'Receipt',
          amount: r.amount
        });
      });

    state.expenses
      .filter(e => e.date >= periodStart && e.date <= periodEnd)
      .forEach(e => {
        const accountName = maskedBusinessAccountName(
          e.businessAccountId, state.businessAccounts, state.chartAccounts, state.currentUserRole,
        );
        rows.push({
          date: e.date,
          accountName: accountName || 'General Expense Account',
          remarks: e.remarks || e.details || '-',
          mode: e.paymentMode,
          chequeNo: '-',
          direction: 'Payment',
          amount: e.amount
        });
      });

    // §13 — an endorsed cheque is real cash flow, not an off-books transfer.
    // The receipt already counted as Jamma on the day it arrived; the
    // endorsement counts as Naam on its own allocation date. A plain DEPOSIT
    // is only moving the cheque to the bank, so it is NOT an outflow.
    // Reversed allocations stay on their original date — the bounce posts its
    // counter-entry separately below, so past days never change.
    state.chequeAllocations
      .filter(a =>
        a.dispositionType !== 'DEPOSIT' &&
        a.allocationDate >= periodStart && a.allocationDate <= periodEnd
      )
      .forEach(a => {
        const sourceReceipt = state.receipts.find(r => r.id === a.receiptId);
        const name = a.targetType === 'VENDOR'
          ? state.vendors.find(v => v.id === a.targetId)?.name
          : maskedBusinessAccountName(a.targetId, state.businessAccounts, state.chartAccounts, state.currentUserRole);
        rows.push({
          date: a.allocationDate,
          accountName: name || 'Cheque endorsement',
          remarks: a.remarks || `Cheque endorsed — ${a.dispositionType.replace('_', ' ').toLowerCase()}`,
          mode: 'Cheque',
          chequeNo: sourceReceipt?.chequeNo || '-',
          direction: 'Payment',
          amount: a.amount
        });
      });

    // Bounce reversals, dated the day the bounce was recorded.
    state.receipts
      .filter(r => r.chequeStatus === 'BOUNCED' && r.bouncedDate &&
                   r.bouncedDate >= periodStart && r.bouncedDate <= periodEnd)
      .forEach(r => {
        const cust = state.customers.find(c => c.id === r.customerId);
        // Cancels the original Jamma.
        rows.push({
          date: r.bouncedDate!,
          accountName: cust?.name || 'Walk-in Client',
          remarks: `Cheque ${r.chequeNo || ''} BOUNCED — reverses receipt of ${r.date}`,
          mode: 'Cheque',
          chequeNo: r.chequeNo || '-',
          direction: 'Payment',
          amount: r.amount
        });
        // Cancels each endorsement made from it.
        state.chequeAllocations
          .filter(a => a.receiptId === r.id && a.status === 'REVERSED' && a.dispositionType !== 'DEPOSIT')
          .forEach(a => {
            const name = a.targetType === 'VENDOR'
              ? state.vendors.find(v => v.id === a.targetId)?.name
              : maskedBusinessAccountName(a.targetId, state.businessAccounts, state.chartAccounts, state.currentUserRole);
            rows.push({
              date: r.bouncedDate!,
              accountName: name || 'Cheque endorsement',
              remarks: `Endorsement reversed — cheque ${r.chequeNo || ''} bounced`,
              mode: 'Cheque',
              chequeNo: r.chequeNo || '-',
              direction: 'Receipt',
              amount: a.amount
            });
          });
      });

    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [state.receipts, state.expenses, state.customers, state.businessAccounts,
      state.chequeAllocations, state.vendors, state.chartAccounts, state.currentUserRole,
      periodStart, periodEnd]);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return cashBookRows;
    const q = searchQuery.toLowerCase();
    return cashBookRows.filter(r =>
      r.accountName.toLowerCase().includes(q) ||
      r.remarks.toLowerCase().includes(q) ||
      expenseModeLabel(r.mode as never).toLowerCase().includes(q)
    );
  }, [cashBookRows, searchQuery]);

  const totals = useMemo(() => {
    return filteredRows.reduce((acc, r) => {
      const isCash = r.mode === 'Cash';
      if (r.direction === 'Receipt') {
        if (isCash) acc.receiptsCash += r.amount;
        else acc.receiptsChequeOnline += r.amount;
      } else {
        if (isCash) acc.paymentsCash += r.amount;
        else acc.paymentsChequeOnline += r.amount;
      }
      return acc;
    }, { receiptsChequeOnline: 0, paymentsChequeOnline: 0, receiptsCash: 0, paymentsCash: 0 });
  }, [filteredRows]);

  // Opening Cash: what the cash account held at the close of the previous day.
  //
  // Was a local sum of prior CASH receipts minus expenses, which is now wrong
  // twice over: it ignores the account's opening balance, and it ignores
  // transfers — and banking the day's takings is a cash movement that no
  // receipt or expense records. Deferring to the shared helper keeps this page,
  // the Bank Accounts page and the account ledgers on one definition.
  const openingCash = useMemo(() => {
    const cash = getCashAccount(state);
    if (!cash) return 0;
    const dayBefore = (() => {
      const d = new Date(periodStart);
      d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    })();
    return getAccountBalance(state, cash.id, dayBefore);
  }, [state, periodStart]);

  const totalCash = openingCash + totals.receiptsCash;
  const cashInHand = totalCash - totals.paymentsCash;

  const handleExportExcel = () => {
    const headers = ['No.', 'Account Name', 'Remarks', 'Type', 'Cheque No.', 'Receipts Cheq./Online', 'Payments Cheq./Online', 'Receipts Cash', 'Payments Cash'];
    const rows = filteredRows.map((row, idx) => {
      const isCash = row.mode === 'Cash';
      const isReceipt = row.direction === 'Receipt';
      return [
        idx + 1, row.accountName, row.remarks, expenseModeLabel(row.mode as never), row.chequeNo,
        isReceipt && !isCash ? row.amount : '',
        !isReceipt && !isCash ? row.amount : '',
        isReceipt && isCash ? row.amount : '',
        !isReceipt && isCash ? row.amount : ''
      ];
    });
    exportRowsToExcel(`cash-book-${periodLabel}`, headers, rows);
  };

  return (
      <div className="mx-auto" style={{ maxWidth: 1100 }}>

        {/* Filter Mode Selector - data-no-print */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl max-w-xs mb-6 border border-slate-200" data-no-print>
          <button
            onClick={() => setFilterBy('date')}
            className={`flex-1 text-center py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${filterBy === 'date' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            By Date
          </button>
          <button
            onClick={() => setFilterBy('month')}
            className={`flex-1 text-center py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${filterBy === 'month' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            By Month
          </button>
        </div>

        {/* Selection Bar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-4 flex-1 min-w-[290px]">
            <div className="relative flex-1 min-w-[240px]">
              <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search Particulars:</span>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by account, remarks, mode..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input w-full py-2 text-sm pr-10 font-semibold"
                />
                <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
              </div>
            </div>

            {filterBy === 'date' ? (
              <div>
                <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Date:</span>
                <input
                  type="date"
                  value={specificDate}
                  onChange={e => setSpecificDate(e.target.value)}
                  className="soleria-input py-1 text-xs"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Month:</span>
                  <select
                    value={filterMonth}
                    onChange={e => setFilterMonth(parseInt(e.target.value))}
                    className="soleria-input py-1.5 cursor-pointer text-xs min-w-[110px]"
                  >
                    {months.map((m, idx) => (
                      <option key={idx} value={idx}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Year:</span>
                  <select
                    value={filterYear}
                    onChange={e => setFilterYear(parseInt(e.target.value))}
                    className="soleria-input py-1.5 cursor-pointer text-xs min-w-[80px]"
                  >
                    <option value={2026}>2026</option>
                    <option value={2025}>2025</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9">
              <Printer size={16} /> Print Cash Book
            </button>
            <button onClick={exportToPDF} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9">
              <FileDown size={16} /> Export PDF
            </button>
            <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9">
              <FileSpreadsheet size={16} /> Export Excel
            </button>
          </div>
        </div>

        {/* Cash Book Grid */}
        <div className="card-white p-6 md:p-8 bg-white border">

          <div className="flex items-center justify-between border-b pb-4 mb-6">
            <div>
              <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX</h1>
              <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Footwear Distribution </p>
            </div>
            <div className="text-right">
              <h2 className="font-lora font-semibold text-lg uppercase">Cash Book of the Day</h2>
              <p className="text-sm text-slate-700 mt-1 font-semibold uppercase">{periodLabel}</p>
            </div>
          </div>

          {/* Summary Box (bottom-left per spec, shown up top here for visibility) */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6" data-no-print>
            <div className="p-3 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Opening Cash</span>
              <span className="text-base font-bold text-slate-800">{formatCurrency(openingCash)}</span>
            </div>
            <div className="p-3 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Cash Received (Jamma)</span>
              <span className="text-base font-bold text-emerald-700">{formatCurrency(totals.receiptsCash)}</span>
            </div>
            <div className="p-3 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Total Cash</span>
              <span className="text-base font-bold text-slate-800">{formatCurrency(totalCash)}</span>
            </div>
            <div className="p-3 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Cash Paid (Naam)</span>
              <span className="text-base font-bold text-rose-700">{formatCurrency(totals.paymentsCash)}</span>
            </div>
            <div className="p-3 rounded-xl border bg-[#111c2a]" style={{ borderColor: '#B08D57' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-300 mb-1">Cash In Hand</span>
              <span className="text-lg font-bold text-[#B08D57]">{formatCurrency(cashInHand)}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">No.</th>
                  <th className="p-3">Account Name</th>
                  <th className="p-3">Remarks</th>
                  <th className="p-3 text-center">Type</th>
                  <th className="p-3 text-center">Cheque No.</th>
                  <th className="p-3 text-right">Receipts Cheq./Online</th>
                  <th className="p-3 text-right">Payments Cheq./Online</th>
                  <th className="p-3 text-right">Receipts Cash</th>
                  <th className="p-3 text-right">Payments Cash</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center p-8 text-slate-400">
                      No cash book entries found for this selection.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, idx) => {
                    const isCash = row.mode === 'Cash';
                    const isReceipt = row.direction === 'Receipt';
                    return (
                      <tr key={idx} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-mono text-slate-500">{idx + 1}</td>
                        <td className="p-3 font-semibold text-slate-800">{row.accountName}</td>
                        <td className="p-3 text-xs text-slate-500">{row.remarks}</td>
                        <td className="p-3 text-center">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border uppercase">
                            {expenseModeLabel(row.mode as never)}
                          </span>
                        </td>
                        <td className="p-3 text-center font-mono text-xs text-slate-500">{row.chequeNo}</td>
                        <td className="p-3 text-right font-bold text-emerald-700">
                          {isReceipt && !isCash ? formatCurrency(row.amount) : '-'}
                        </td>
                        <td className="p-3 text-right font-bold text-rose-700">
                          {!isReceipt && !isCash ? formatCurrency(row.amount) : '-'}
                        </td>
                        <td className="p-3 text-right font-bold text-emerald-700">
                          {isReceipt && isCash ? formatCurrency(row.amount) : '-'}
                        </td>
                        <td className="p-3 text-right font-bold text-rose-700">
                          {!isReceipt && isCash ? formatCurrency(row.amount) : '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                  <td colSpan={5} className="p-4 text-left font-lora">TOTAL</td>
                  <td className="p-4 text-right text-emerald-800">{formatCurrency(totals.receiptsChequeOnline)}</td>
                  <td className="p-4 text-right text-rose-800">{formatCurrency(totals.paymentsChequeOnline)}</td>
                  <td className="p-4 text-right text-emerald-800">{formatCurrency(totals.receiptsCash)}</td>
                  <td className="p-4 text-right text-rose-800">{formatCurrency(totals.paymentsCash)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

        </div>

      </div>
  );
}

export default function ReportCashBookPage() {
  return (
    <AppLayout pageTitle="Cash Book of the Day">
      <ReportCashBookContent />
    </AppLayout>
  );
}
