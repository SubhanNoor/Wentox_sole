import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Printer, Calendar } from 'lucide-react';

export default function ReportCashBookPage() {
  const { state } = useApp();

  const [filterMonth, setFilterMonth] = useState<number>(new Date().getMonth());
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const cashBookTransactions = useMemo(() => {
    // Filter receipts that match month/year
    const filteredReceipts = state.receipts.filter(r => {
      const d = new Date(r.date);
      return d.getMonth() === filterMonth && d.getFullYear() === filterYear;
    });

    return filteredReceipts.sort((a, b) => a.date.localeCompare(b.date));
  }, [state.receipts, filterMonth, filterYear]);

  const totals = useMemo(() => {
    let cash = 0;
    let cheque = 0;
    let online = 0;

    cashBookTransactions.forEach(t => {
      if (t.paymentMode === 'Cash') cash += t.amount;
      else if (t.paymentMode === 'Cheque') cheque += t.amount;
      else if (t.paymentMode === 'Online') online += t.amount;
    });

    return { cash, cheque, online, grandTotal: cash + cheque + online };
  }, [cashBookTransactions]);

  return (
    <AppLayout pageTitle="Cash Book Summary">
      <div className="mx-auto" style={{ maxWidth: 1000 }}>
        
        {/* Selection Bar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex items-center gap-3 flex-1">
            <span className="text-sm font-semibold text-slate-600 flex items-center gap-1">
              <Calendar size={16} /> Select Period:
            </span>
            <select
              value={filterMonth}
              onChange={e => setFilterMonth(parseInt(e.target.value))}
              className="soleria-input py-2 cursor-pointer text-sm max-w-[150px]"
            >
              {months.map((m, idx) => (
                <option key={idx} value={idx}>{m}</option>
              ))}
            </select>
            <select
              value={filterYear}
              onChange={e => setFilterYear(parseInt(e.target.value))}
              className="soleria-input py-2 cursor-pointer text-sm max-w-[120px]"
            >
              <option value={2026}>2026</option>
              <option value={2025}>2025</option>
            </select>
          </div>

          <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
            <Printer size={16} /> Print Cash Book
          </button>
        </div>

        {/* Cash Book Grid */}
        <div className="card-white p-6 md:p-8 bg-white border">
          
          <div className="hidden print:flex items-center justify-between border-b pb-4 mb-6">
            <div>
              <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTO ERP</h1>
              <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Footwear Distribution ERP</p>
            </div>
            <div className="text-right">
              <h2 className="font-lora font-semibold text-lg uppercase">Cash Book Statement</h2>
              <p className="text-sm text-slate-700 mt-1 font-medium">{months[filterMonth]} {filterYear}</p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6" data-no-print>
            <div className="p-4 rounded-xl border bg-slate-50">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Cash Receipts</span>
              <span className="text-lg font-bold font-mono text-emerald-800">{formatCurrency(totals.cash)}</span>
            </div>
            <div className="p-4 rounded-xl border bg-slate-50">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Cheques Logged</span>
              <span className="text-lg font-bold font-mono text-blue-800">{formatCurrency(totals.cheque)}</span>
            </div>
            <div className="p-4 rounded-xl border bg-slate-50">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Online Deposits</span>
              <span className="text-lg font-bold font-mono text-indigo-800">{formatCurrency(totals.online)}</span>
            </div>
            <div className="p-4 rounded-xl border bg-slate-50" style={{ borderColor: 'var(--brand-gold)' }}>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Total Inflow</span>
              <span className="text-xl font-bold font-mono" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(totals.grandTotal)}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">Date</th>
                  <th className="p-3 text-center">Ref Voucher</th>
                  <th className="p-3">Particulars / Customer</th>
                  <th className="p-3">Mode</th>
                  <th className="p-3">Reference/Details</th>
                  <th className="p-3 text-right">Debit (Inflow)</th>
                  <th className="p-3 text-right">Credit (Outflow)</th>
                </tr>
              </thead>
              <tbody>
                {cashBookTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center p-8 text-slate-400">
                      No cash transactions registered for this month.
                    </td>
                  </tr>
                ) : (
                  cashBookTransactions.map(trans => {
                    const cust = state.customers.find(c => c.id === trans.customerId);
                    return (
                      <tr key={trans.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-mono">{trans.date}</td>
                        <td className="p-3 text-center font-mono">{trans.id.substring(3, 9)}</td>
                        <td className="p-3 font-semibold text-slate-700">{cust?.name || 'Walk-in Client'}</td>
                        <td className="p-3">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border">
                            {trans.paymentMode}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-slate-500">{trans.details || trans.remarks || '-'}</td>
                        <td className="p-3 text-right font-mono font-semibold text-emerald-800">
                          {formatCurrency(trans.amount)}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-400">
                          -
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                  <td colSpan={5} className="p-4 text-left font-lora">GRAND TOTAL CASH BOOK</td>
                  <td className="p-4 text-right font-mono text-emerald-800 text-lg">
                    {formatCurrency(totals.grandTotal)}
                  </td>
                  <td className="p-4 text-right font-mono text-slate-500">
                    Rs 0
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

        </div>

      </div>
    </AppLayout>
  );
}
