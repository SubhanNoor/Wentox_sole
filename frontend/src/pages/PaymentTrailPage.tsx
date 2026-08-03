import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Printer, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
<<<<<<< HEAD
import { getBankBusinessAccounts, getAccountBalance } from '@/lib/cashbank';
=======
import { isChartAccountRestrictedForRole } from '@/lib/access';
>>>>>>> subhan

// Maps each Payment Trail category to the Chart of Account it's sourced from.
// "Cash at Banks" is a running balance (holdings), not a spend total — see below.
const CATEGORY_CHART_MAP: { label: string; chartId: string }[] = [
  { label: 'Business Running Expenses', chartId: '420001' },
  { label: 'Directors Expenses - Drawings', chartId: '440001' },
  { label: 'Employees', chartId: '220001' },
  { label: 'Vendors - Suppliers', chartId: '210001' }
];
const BANK_ACCOUNTS_CHART_ID = '120002';

export function PaymentTrailContent() {
  const { state } = useApp();

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const inRange = (date: string) => (!fromDate || date >= fromDate) && (!toDate || date <= toDate);

  // "Total amount spent" categories — sum of Expenses against business accounts
  // under that chart account, within the selected date range.
  // UC-03: hide any category whose chart account is flagged isRestricted for this role.
  const visibleCategories = useMemo(() => {
    return CATEGORY_CHART_MAP.filter(({ chartId }) => {
      const chartAccount = state.chartAccounts.find(c => c.id === chartId);
      return !chartAccount || !isChartAccountRestrictedForRole(chartAccount, state.currentUserRole);
    });
  }, [state.chartAccounts, state.currentUserRole]);

  const spendRows = useMemo(() => {
    return visibleCategories.map(({ label, chartId }) => {
      const bizIds = new Set(state.businessAccounts.filter(b => b.controlId === chartId).map(b => b.id));
      const amount = state.expenses
        .filter(e => bizIds.has(e.businessAccountId) && inRange(e.date))
        .reduce((sum, e) => sum + e.amount, 0);
      return { label, amount };
    });
  }, [visibleCategories, state.businessAccounts, state.expenses, fromDate, toDate]);

  // "Cash at Banks" — sum of every bank account's real ledger balance
  // (opening balance + receipts + deposits + transfers + cheque deposits -
  // expenses), as at the end of the period. Uses the same `getAccountBalance`
  // helper as the Bank Accounts page and Cash Book, so all three agree.
  const cashAtBanks = useMemo(() => {
    const asOf = toDate || undefined;
    return getBankBusinessAccounts(state)
      .reduce((sum, b) => sum + getAccountBalance(state, b.id, asOf), 0);
  }, [state, toDate]);

  const grandTotal = useMemo(() => spendRows.reduce((s, r) => s + r.amount, 0), [spendRows]);

  const showCashAtBanks = useMemo(() => {
    const bankChartAccount = state.chartAccounts.find(c => c.id === BANK_ACCOUNTS_CHART_ID);
    return !bankChartAccount || !isChartAccountRestrictedForRole(bankChartAccount, state.currentUserRole);
  }, [state.chartAccounts, state.currentUserRole]);

  const handleExportExcel = () => {
    const headers = ['Account Title', 'Amount'];
    const rows: (string | number)[][] = spendRows.map(r => [r.label, r.amount]);
    if (showCashAtBanks) rows.push(['Cash at Banks', cashAtBanks]);
    exportRowsToExcel('payment-trail', headers, rows);
  };

  return (
      <div className="mx-auto" style={{ maxWidth: 900 }}>

        {/* Filter Bar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">From:</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
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

        {/* Report Sheet */}
        <div className="card-white p-6 md:p-8 bg-white border">
          <div className="flex items-center justify-between border-b pb-4 mb-6">
            <div>
              <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX</h1>
              <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Footwear Distribution</p>
            </div>
            <div className="text-right">
              <h2 className="font-lora font-semibold text-lg uppercase">Payment Trail</h2>
              {(fromDate || toDate) && (
                <p className="text-xs text-amber-700 font-semibold mt-0.5">Period: {fromDate || 'Start'} to {toDate || 'End'}</p>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">Account Title</th>
                  <th className="p-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {spendRows.map(row => (
                  <tr key={row.label} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4 font-semibold text-slate-800">{row.label}</td>
                    <td className="p-3 text-right font-bold text-rose-700">{row.amount > 0 ? formatCurrency(row.amount) : '-'}</td>
                  </tr>
                ))}
                {showCashAtBanks && (
                  <tr className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4 font-semibold text-slate-800">
                      Cash at Banks
                      <span className="block text-[10px] font-normal text-slate-400">Balance held, not a payment — excluded from Grand Total</span>
                    </td>
                    <td className="p-3 text-right font-bold text-emerald-700">{formatCurrency(cashAtBanks)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                  <td className="p-4 pl-4 text-left font-lora">GRAND TOTAL (Amounts Paid)</td>
                  <td className="p-4 text-right text-lg" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

      </div>
  );
}

export default function PaymentTrailPage() {
  return (
    <AppLayout pageTitle="Payment Trail">
      <PaymentTrailContent />
    </AppLayout>
  );
}
