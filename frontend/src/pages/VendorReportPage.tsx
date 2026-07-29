import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Printer, Search, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';

interface VendorLedgerRow {
  date: string;
  type: 'Opening Balance' | 'Purchase' | 'Purchase Return' | 'Payment' | 'Cheque Endorsed' | 'Endorsement Reversed';
  ref: string;
  debit: number;  // increases what we owe the vendor
  credit: number; // decreases what we owe the vendor
  balance: number;
}

export function VendorReportContent() {
  const { state } = useApp();

  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const inRange = (date: string) => (!fromDate || date >= fromDate) && (!toDate || date <= toDate);

  // Grouped Report (TASK-10 UPDATE): all vendors, Total Purchase / Purchase Return / Net Purchase / Payment Paid
  const vendorGroupRows = useMemo(() => {
    return state.vendors
      .filter(v => !vendorSearch.trim() || v.name.toLowerCase().includes(vendorSearch.toLowerCase()))
      .map(v => {
        const totalPurchase = state.purchases
          .filter(p => p.vendorId === v.id && inRange(p.date))
          .reduce((s, p) => s + p.totalValue, 0);
        const purchaseReturn = state.purchaseReturns
          .filter(r => r.vendorId === v.id && inRange(r.date))
          .reduce((s, r) => s + r.totalValue, 0);
        // Payment Paid = cash/bank expenses against the vendor's linked account,
        // plus cheques endorsed straight to the vendor (§13), less any of those
        // endorsements reversed by a bounce (dated the bounce, not the original).
        const expensePaid = state.expenses
          .filter(e => e.businessAccountId === v.baId && inRange(e.date))
          .reduce((s, e) => s + e.amount, 0);
        const endorsedPaid = state.chequeAllocations
          .filter(a => a.dispositionType === 'VENDOR_PAYMENT' && a.targetId === v.id && inRange(a.allocationDate))
          .reduce((s, a) => s + a.amount, 0);
        const endorsementsReversed = state.chequeAllocations
          .filter(a => {
            if (a.dispositionType !== 'VENDOR_PAYMENT' || a.targetId !== v.id) return false;
            if (a.status !== 'REVERSED') return false;
            const src = state.receipts.find(r => r.id === a.receiptId);
            return !!src?.bouncedDate && inRange(src.bouncedDate);
          })
          .reduce((s, a) => s + a.amount, 0);
        const paymentPaid = expensePaid + endorsedPaid - endorsementsReversed;
        return {
          vendorId: v.id,
          vendorName: v.name,
          totalPurchase,
          purchaseReturn,
          netPurchase: totalPurchase - purchaseReturn,
          paymentPaid
        };
      });
  }, [state.vendors, state.purchases, state.purchaseReturns, state.expenses,
      state.chequeAllocations, state.receipts, vendorSearch, fromDate, toDate]);

  const grandTotals = useMemo(() => {
    return vendorGroupRows.reduce((acc, r) => ({
      totalPurchase: acc.totalPurchase + r.totalPurchase,
      purchaseReturn: acc.purchaseReturn + r.purchaseReturn,
      netPurchase: acc.netPurchase + r.netPurchase,
      paymentPaid: acc.paymentPaid + r.paymentPaid
    }), { totalPurchase: 0, purchaseReturn: 0, netPurchase: 0, paymentPaid: 0 });
  }, [vendorGroupRows]);

  const selectedVendor = useMemo(() => state.vendors.find(v => v.id === selectedVendorId), [selectedVendorId, state.vendors]);

  // Per-vendor detailed ledger (TASK-10 base): Opening Balance, Debit, Credit, running Balance
  const vendorLedgerEntries = useMemo(() => {
    if (!selectedVendor) return [];
    const entries: Omit<VendorLedgerRow, 'balance'>[] = [];

    state.purchases
      .filter(p => p.vendorId === selectedVendor.id)
      .forEach(p => entries.push({ date: p.date, type: 'Purchase', ref: p.id, debit: p.totalValue, credit: 0 }));

    state.purchaseReturns
      .filter(r => r.vendorId === selectedVendor.id)
      .forEach(r => entries.push({ date: r.date, type: 'Purchase Return', ref: r.id, debit: 0, credit: r.totalValue }));

    state.expenses
      .filter(e => e.businessAccountId === selectedVendor.baId)
      .forEach(e => entries.push({ date: e.date, type: 'Payment', ref: e.id, debit: 0, credit: e.amount }));

    // Cheques endorsed directly to this vendor (§13) settle their payable too.
    state.chequeAllocations
      .filter(a => a.dispositionType === 'VENDOR_PAYMENT' && a.targetId === selectedVendor.id)
      .forEach(a => {
        const src = state.receipts.find(r => r.id === a.receiptId);
        entries.push({
          date: a.allocationDate,
          type: 'Cheque Endorsed',
          ref: src?.chequeNo || a.id,
          debit: 0,
          credit: a.amount
        });
        // A bounce puts the payable back up, dated the bounce — the original
        // credit above is left untouched so prior statements still reconcile.
        if (a.status === 'REVERSED' && src?.bouncedDate) {
          entries.push({
            date: src.bouncedDate,
            type: 'Endorsement Reversed',
            ref: src.chequeNo || a.id,
            debit: a.amount,
            credit: 0
          });
        }
      });

    return entries.sort((a, b) => a.date.localeCompare(b.date));
  }, [selectedVendor, state.purchases, state.purchaseReturns, state.expenses,
      state.chequeAllocations, state.receipts]);

  const runningVendorLedger = useMemo(() => {
    let beforeEntries = vendorLedgerEntries;
    let filtered = vendorLedgerEntries;

    if (fromDate) {
      beforeEntries = vendorLedgerEntries.filter(e => e.date < fromDate);
      filtered = vendorLedgerEntries.filter(e => e.date >= fromDate);
    }
    if (toDate) {
      filtered = filtered.filter(e => e.date <= toDate);
    }

    const openingBalance = beforeEntries.reduce((sum, e) => sum + e.debit - e.credit, 0);
    let balance = openingBalance;

    const rows: VendorLedgerRow[] = [
      { date: fromDate ? `Before ${fromDate}` : '---', type: 'Opening Balance', ref: '-', debit: 0, credit: 0, balance: openingBalance },
      ...filtered.map(e => {
        balance = balance + e.debit - e.credit;
        return { ...e, balance };
      })
    ];

    return rows;
  }, [vendorLedgerEntries, fromDate, toDate]);

  const handleExportGroupedExcel = () => {
    const headers = ['Vendor / Supplier', 'Total Purchase', 'Purchase Return', 'Net Purchase', 'Payment Paid'];
    const rows = vendorGroupRows.map(r => [r.vendorName, r.totalPurchase, r.purchaseReturn, r.netPurchase, r.paymentPaid]);
    exportRowsToExcel('vendor-report-grouped', headers, rows);
  };

  const handleExportLedgerExcel = () => {
    const headers = ['Date', 'Type', 'Ref', 'Debit', 'Credit', 'Balance'];
    const rows = runningVendorLedger.map(row => [row.date, row.type, row.ref, row.debit, row.credit, row.balance]);
    exportRowsToExcel(`vendor-ledger-${selectedVendor?.name || 'export'}`, headers, rows);
  };

  return (
      <div className="mx-auto" style={{ maxWidth: 1150 }}>

        {!selectedVendorId ? (
          <>
            {/* Filter Bar - data-no-print */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
              <div className="flex flex-wrap items-center gap-4 flex-1 min-w-[280px]">
                <div className="relative flex-1 min-w-[220px]">
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search Vendor:</span>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search by vendor name..."
                      value={vendorSearch}
                      onChange={e => setVendorSearch(e.target.value)}
                      className="soleria-input w-full py-2 text-sm pr-10 font-semibold"
                    />
                    <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
                  </div>
                </div>
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
                <button onClick={handleExportGroupedExcel} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
                  <FileSpreadsheet size={16} /> Export Excel
                </button>
              </div>
            </div>

            {/* Grouped Report Sheet */}
            <div className="card-white p-6 md:p-8 bg-white border">
              <div className="flex items-center justify-between border-b pb-4 mb-6">
                <div>
                  <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX</h1>
                  <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Footwear Distribution</p>
                </div>
                <div className="text-right">
                  <h2 className="font-lora font-semibold text-lg uppercase">Vendor Report — Grouped Summary</h2>
                  {(fromDate || toDate) && (
                    <p className="text-xs text-amber-700 font-semibold mt-0.5">Period: {fromDate || 'Start'} to {toDate || 'End'}</p>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4">Vendor / Supplier</th>
                      <th className="p-3 text-right">Total Purchase</th>
                      <th className="p-3 text-right">Purchase Return</th>
                      <th className="p-3 text-right">Net Purchase</th>
                      <th className="p-3 text-right">Payment Paid</th>
                      <th className="p-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorGroupRows.length === 0 ? (
                      <tr><td colSpan={6} className="text-center p-8 text-slate-400">No vendors found matching your search.</td></tr>
                    ) : (
                      vendorGroupRows.map(row => (
                        <tr key={row.vendorId} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-3 pl-4 font-semibold text-slate-800">{row.vendorName}</td>
                          <td className="p-3 text-right font-bold text-slate-800">{row.totalPurchase > 0 ? formatCurrency(row.totalPurchase) : '-'}</td>
                          <td className="p-3 text-right font-bold text-blue-700">{row.purchaseReturn > 0 ? formatCurrency(row.purchaseReturn) : '-'}</td>
                          <td className="p-3 text-right font-bold" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(row.netPurchase)}</td>
                          <td className="p-3 text-right font-bold text-emerald-700">{row.paymentPaid > 0 ? formatCurrency(row.paymentPaid) : '-'}</td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => setSelectedVendorId(row.vendorId)}
                              className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline"
                            >
                              View Ledger
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                      <td className="p-4 pl-4 text-left font-lora">GRAND TOTAL</td>
                      <td className="p-4 text-right text-slate-800">{formatCurrency(grandTotals.totalPurchase)}</td>
                      <td className="p-4 text-right text-blue-800">{formatCurrency(grandTotals.purchaseReturn)}</td>
                      <td className="p-4 text-right" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(grandTotals.netPurchase)}</td>
                      <td className="p-4 text-right text-emerald-800">{formatCurrency(grandTotals.paymentPaid)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Per-Vendor Ledger (TASK-10 base) */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedVendorId('')}
                  className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm font-semibold"
                >
                  &larr; Back to Vendor Report
                </button>
                <div className="text-sm font-semibold text-slate-600">
                  Viewing Ledger: <span className="text-amber-800 font-bold">{selectedVendor?.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <div>
                    <span className="block text-xs font-semibold text-slate-500 uppercase mb-0.5">From:</span>
                    <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1 text-xs" />
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-slate-500 uppercase mb-0.5">To:</span>
                    <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1 text-xs" />
                  </div>
                </div>
                <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9 mt-4">
                  <Printer size={16} /> Print Statement
                </button>
                <button onClick={exportToPDF} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9 mt-4">
                  <FileDown size={16} /> Export PDF
                </button>
                <button onClick={handleExportLedgerExcel} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9 mt-4">
                  <FileSpreadsheet size={16} /> Export Excel
                </button>
              </div>
            </div>

            <div className="card-white p-6 md:p-8 bg-white border">
              <div className="flex items-center justify-between border-b pb-4 mb-6">
                <div>
                  <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX</h1>
                  <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Vendor Ledger</p>
                </div>
                <div className="text-right">
                  <h2 className="font-lora font-semibold text-lg uppercase">Vendor Statement</h2>
                  <div className="text-sm font-semibold text-slate-700 mt-1">{selectedVendor?.name}</div>
                  <div className="text-[10px] font-semibold uppercase text-slate-500">Opening Balance</div>
                  <div className="font-bold font-mono text-sm" style={{ color: 'var(--brand-gold)' }}>
                    {formatCurrency(Math.abs(runningVendorLedger[0]?.balance || 0))}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4">Date</th>
                      <th className="p-3">Type</th>
                      <th className="p-3 text-center">Ref</th>
                      <th className="p-3 text-right">Debit</th>
                      <th className="p-3 text-right">Credit</th>
                      <th className="p-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runningVendorLedger.length === 1 ? (
                      <tr><td colSpan={6} className="text-center p-8 text-slate-400">No ledger entries found for this vendor / date range.</td></tr>
                    ) : (
                      runningVendorLedger.map((row, idx) => (
                        <tr
                          key={idx}
                          className={`border-b ${row.type === 'Opening Balance' ? 'bg-slate-50 font-medium text-slate-700' : row.credit > 0 ? 'text-rose-700 hover:bg-rose-50/30' : 'text-slate-700 hover:bg-slate-50/30'}`}
                          style={{ borderColor: 'var(--border-table)' }}
                        >
                          <td className="p-3 pl-4 font-semibold">{row.date}</td>
                          <td className="p-3">
                            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-bold ${row.type === 'Purchase' ? 'bg-rose-50 text-rose-700' : row.type === 'Payment' ? 'bg-emerald-50 text-emerald-700' : row.type === 'Purchase Return' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                              {row.type}
                            </span>
                          </td>
                          <td className="p-3 text-center font-mono text-xs">{row.ref}</td>
                          <td className="p-3 text-right font-bold text-rose-700">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                          <td className="p-3 text-right font-bold text-emerald-700">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                          <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(Math.abs(row.balance))}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

      </div>
  );
}

export default function VendorReportPage() {
  return (
    <AppLayout pageTitle="Vendor Report">
      <VendorReportContent />
    </AppLayout>
  );
}
