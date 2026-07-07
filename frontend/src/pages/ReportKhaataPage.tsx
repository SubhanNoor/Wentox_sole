import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Printer, BookOpen } from 'lucide-react';

interface KhaataRow {
  date: string;
  type: 'Opening Balance' | 'Sale Bill' | 'Sale Return' | 'Receipt (Jamma)';
  refId: string;
  description: string;
  debit: number;  // increases customer receivable
  credit: number; // decreases customer receivable
}

export default function ReportKhaataPage() {
  const { state } = useApp();

  const [customerId, setCustomerId] = useState('');

  // Find selected customer info
  const selectedCustomer = useMemo(() => {
    return state.customers.find(c => c.id === customerId);
  }, [customerId, state.customers]);

  const khaataEntries = useMemo(() => {
    if (!customerId) return [];

    const entries: KhaataRow[] = [];

    // 1. Sale Bills (Debit the Customer)
    state.saleBills.forEach(bill => {
      if (bill.customerId !== customerId || bill.status !== 'Posted') return;
      entries.push({
        date: bill.date,
        type: 'Sale Bill',
        refId: bill.billNo,
        description: `Sale of sole articles. Total Cartons: ${bill.items.reduce((s, it) => s + it.cartons, 0)}`,
        debit: bill.totalValue,
        credit: 0
      });
    });

    // 2. Sale Returns (Credit the Customer)
    state.saleReturns.forEach(ret => {
      if (ret.customerId !== customerId || ret.status !== 'Posted') return;
      const totalCreditVal = ret.items.reduce((s, it) => s + it.value, 0);
      entries.push({
        date: ret.date,
        type: 'Sale Return',
        refId: ret.billNo,
        description: `Returned defective articles. Total Cartons: ${ret.items.reduce((s, it) => s + it.cartons, 0)}`,
        debit: 0,
        credit: totalCreditVal
      });
    });

    // 3. Receipts / Payments Jamma (Credit the Customer)
    state.receipts.forEach(rec => {
      if (rec.customerId !== customerId) return;
      entries.push({
        date: rec.date,
        type: 'Receipt (Jamma)',
        refId: rec.id.substring(3, 9),
        description: `Payment received: Mode ${rec.paymentMode}. Details: ${rec.details || 'N/A'}`,
        debit: 0,
        credit: rec.amount
      });
    });

    // Sort by Date
    entries.sort((a, b) => a.date.localeCompare(b.date));

    return entries;
  }, [customerId, state.saleBills, state.saleReturns, state.receipts]);

  // Compute running balance
  const runningKhaata = useMemo(() => {
    const openingBalance = 0; // Assume 0 starting balance for demo
    let balance = openingBalance;

    const finalRows = [
      {
        date: '---',
        type: 'Opening Balance' as const,
        refId: '-',
        description: 'Opening Balance brought forward',
        debit: 0,
        credit: 0,
        balance: openingBalance
      },
      ...khaataEntries.map(e => {
        balance = balance + e.debit - e.credit;
        return {
          ...e,
          balance
        };
      })
    ];

    return finalRows;
  }, [khaataEntries]);

  return (
    <AppLayout pageTitle="Accounts Ledger / Khaata">
      <div className="mx-auto" style={{ maxWidth: 1000 }}>
        
        {/* Selection Bar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex items-center gap-3 flex-1">
            <span className="text-sm font-semibold text-slate-600">Select Customer Account:</span>
            <select
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
              className="soleria-input py-2 cursor-pointer text-sm max-w-[320px]"
            >
              <option value="">Select account...</option>
              {state.customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => window.print()}
            disabled={!customerId}
            className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
          >
            <Printer size={16} /> Print Khaata Sheet
          </button>
        </div>

        {/* Khaata Sheet */}
        {customerId ? (
          <div className="card-white p-6 md:p-8 bg-white border">
            
            {/* Header details */}
            <div className="flex items-center justify-between border-b pb-4 mb-6">
              <div>
                <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTO ERP</h1>
                <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Business Accounts Ledger</p>
              </div>
              <div className="text-right">
                <h2 className="font-lora font-semibold text-lg uppercase">Account Statement (Khaata)</h2>
                <div className="text-sm font-semibold text-slate-700 mt-1">{selectedCustomer?.name}</div>
                <div className="text-xs text-slate-500 font-mono">Account ID: {selectedCustomer?.id} | City Code: {selectedCustomer?.cityId}</div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Date</th>
                    <th className="p-3">Type</th>
                    <th className="p-3 text-center">Ref ID</th>
                    <th className="p-3" style={{ minWidth: '200px' }}>Description</th>
                    <th className="p-3 text-right">Debit (Dr)</th>
                    <th className="p-3 text-right">Credit (Cr)</th>
                    <th className="p-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {runningKhaata.map((row, idx) => {
                    const displayBal = Math.abs(row.balance);
                    const suffix = row.balance >= 0 ? 'Dr' : 'Cr';

                    return (
                      <tr
                        key={idx}
                        className={`border-b text-slate-700 ${row.type === 'Opening Balance' ? 'bg-slate-50 font-medium' : 'hover:bg-slate-50/30'}`}
                        style={{ borderColor: 'var(--border-table)' }}
                      >
                        <td className="p-3 pl-4 font-mono">{row.date}</td>
                        <td className="p-3">
                          <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-bold ${row.type === 'Sale Bill' ? 'bg-rose-50 text-rose-700' : row.type === 'Receipt (Jamma)' ? 'bg-emerald-50 text-emerald-700' : row.type === 'Sale Return' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                            {row.type}
                          </span>
                        </td>
                        <td className="p-3 text-center font-mono">{row.refId}</td>
                        <td className="p-3 text-xs text-slate-500 font-medium">{row.description}</td>
                        <td className="p-3 text-right font-mono text-rose-700 font-semibold">
                          {row.debit > 0 ? formatCurrency(row.debit) : '-'}
                        </td>
                        <td className="p-3 text-right font-mono text-emerald-700 font-semibold">
                          {row.credit > 0 ? formatCurrency(row.credit) : '-'}
                        </td>
                        <td className="p-3 text-right font-mono font-bold" style={{ color: 'var(--brand-gold)' }}>
                          {formatCurrency(displayBal)} {suffix}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </div>
        ) : (
          <div className="card-white p-12 bg-slate-50/50 border text-center flex flex-col items-center justify-center text-slate-400">
            <BookOpen size={48} className="text-slate-300 mb-3" />
            <p className="font-lora text-lg font-semibold text-slate-500 mb-1">No Account Selected</p>
            <p className="text-sm max-w-sm">Please select a customer business account from the dropdown above to generate their ledger statement.</p>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
