import { Fragment, useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import { isReceiptLive } from '@/lib/cheques';
import AppLayout from '@/components/AppLayout';
import { Printer, ChevronDown, ChevronRight, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';

interface CustomerAnalysisRow {
  customerId: string;
  customerName: string;
  totalSales: number;   // Debit
  saleReturns: number;  // Credit
  paymentReceived: number; // Credit
  balance: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function SaleAnalysisContent() {
  const { state } = useApp();

  const [groupMode, setGroupMode] = useState<'customer' | 'region'>('customer');
  const [viewMode, setViewMode] = useState<'overall' | 'month' | 'range'>('overall');
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth());
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());
  const [expandedRegionId, setExpandedRegionId] = useState<string | null>(null);

  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    if (viewMode === 'month') {
      const start = `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(filterYear, filterMonth + 1, 0).getDate();
      const end = `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { periodStart: start, periodEnd: end, periodLabel: `${MONTHS[filterMonth]} ${filterYear}` };
    }
    if (viewMode === 'range') {
      return {
        periodStart: fromDate || '0000-01-01',
        periodEnd: toDate || '9999-12-31',
        periodLabel: `${fromDate || 'Start'} to ${toDate || 'End'}`
      };
    }
    return { periodStart: '0000-01-01', periodEnd: '9999-12-31', periodLabel: 'Overall (All Time)' };
  }, [viewMode, filterMonth, filterYear, fromDate, toDate]);

  const customerRows = useMemo((): CustomerAnalysisRow[] => {
    return state.customers.map(c => {
      const totalSales = state.saleBills
        .filter(b => b.customerId === c.id && b.status === 'Posted' && b.date >= periodStart && b.date <= periodEnd)
        .reduce((sum, b) => sum + b.totalValue, 0);

      const saleReturns = state.saleReturns
        .filter(r => r.customerId === c.id && r.status === 'Posted' && r.date >= periodStart && r.date <= periodEnd)
        .reduce((sum, r) => sum + r.items.reduce((s, it) => s + it.value, 0), 0);

      // A bounced cheque was never really received, so it must not show as
      // payment here (§13) — same rule the Account Ledger and Receipts use.
      const paymentReceived = state.receipts
        .filter(rec => rec.customerId === c.id && rec.date >= periodStart && rec.date <= periodEnd)
        .filter(isReceiptLive)
        .reduce((sum, rec) => sum + rec.amount + (rec.commission || 0), 0);

      return {
        customerId: c.id,
        customerName: c.name,
        totalSales,
        saleReturns,
        paymentReceived,
        balance: totalSales - saleReturns - paymentReceived
      };
    }).filter(row => row.totalSales > 0 || row.saleReturns > 0 || row.paymentReceived > 0);
  }, [state.customers, state.saleBills, state.saleReturns, state.receipts, periodStart, periodEnd]);

  const regionGroups = useMemo(() => {
    const groups: Record<string, { regionId: string; regionName: string; customers: CustomerAnalysisRow[] }> = {};

    state.customers.forEach(c => {
      const row = customerRows.find(r => r.customerId === c.id);
      if (!row) return;
      const regionName = state.regions.find(r => r.id === c.regionId)?.name || 'No Region';
      const key = c.regionId || 'none';
      if (!groups[key]) groups[key] = { regionId: key, regionName, customers: [] };
      groups[key].customers.push(row);
    });

    return Object.values(groups)
      .map(g => ({
        ...g,
        totalSales: g.customers.reduce((s, c) => s + c.totalSales, 0),
        saleReturns: g.customers.reduce((s, c) => s + c.saleReturns, 0),
        paymentReceived: g.customers.reduce((s, c) => s + c.paymentReceived, 0),
        balance: g.customers.reduce((s, c) => s + c.balance, 0)
      }))
      .sort((a, b) => a.regionName.localeCompare(b.regionName));
  }, [state.customers, state.regions, customerRows]);

  const grandTotals = useMemo(() => {
    return customerRows.reduce((acc, r) => ({
      totalSales: acc.totalSales + r.totalSales,
      saleReturns: acc.saleReturns + r.saleReturns,
      paymentReceived: acc.paymentReceived + r.paymentReceived,
      balance: acc.balance + r.balance
    }), { totalSales: 0, saleReturns: 0, paymentReceived: 0, balance: 0 });
  }, [customerRows]);

  const handleExportExcel = () => {
    const headers = [groupMode === 'customer' ? 'Customer' : 'Region', 'Total Sales', 'Sale Returns', 'Payment Received', 'Balance'];
    const rows = groupMode === 'customer'
      ? customerRows.map(r => [r.customerName, r.totalSales, r.saleReturns, r.paymentReceived, r.balance])
      : regionGroups.flatMap(g => [
          [g.regionName, g.totalSales, g.saleReturns, g.paymentReceived, g.balance],
          ...g.customers.map(c => [`  ${c.customerName}`, c.totalSales, c.saleReturns, c.paymentReceived, c.balance])
        ]);
    exportRowsToExcel(`sale-analysis-${groupMode}`, headers, rows);
  };

  return (
      <div className="mx-auto" style={{ maxWidth: 1100 }}>

        {/* Grouping Selector - data-no-print */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl max-w-xs mb-6 border border-slate-200" data-no-print>
          <button
            onClick={() => setGroupMode('customer')}
            className={`flex-1 text-center py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${groupMode === 'customer' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Customer Wise
          </button>
          <button
            onClick={() => setGroupMode('region')}
            className={`flex-1 text-center py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${groupMode === 'region' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Region Wise
          </button>
        </div>

        {/* Filter Bar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
              <button
                onClick={() => setViewMode('overall')}
                className={`px-3 py-2 rounded-md transition-all ${viewMode === 'overall' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Overall
              </button>
              <button
                onClick={() => setViewMode('month')}
                className={`px-3 py-2 rounded-md transition-all ${viewMode === 'month' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
              >
                By Month
              </button>
              <button
                onClick={() => setViewMode('range')}
                className={`px-3 py-2 rounded-md transition-all ${viewMode === 'range' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Between Two Dates
              </button>
            </div>

            {viewMode === 'month' && (
              <div className="flex items-center gap-2">
                <select
                  value={filterMonth}
                  onChange={e => setFilterMonth(parseInt(e.target.value))}
                  className="soleria-input py-1.5 cursor-pointer text-xs min-w-[110px]"
                >
                  {MONTHS.map((m, idx) => (
                    <option key={idx} value={idx}>{m}</option>
                  ))}
                </select>
                <select
                  value={filterYear}
                  onChange={e => setFilterYear(parseInt(e.target.value))}
                  className="soleria-input py-1.5 cursor-pointer text-xs min-w-[80px]"
                >
                  <option value={2026}>2026</option>
                  <option value={2025}>2025</option>
                </select>
              </div>
            )}

            {viewMode === 'range' && (
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
            )}
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
              <h2 className="font-lora font-semibold text-lg uppercase">Sale Analysis — {groupMode === 'customer' ? 'Customer Wise' : 'Region Wise'}</h2>
              <p className="text-sm text-slate-700 mt-1 font-semibold uppercase">{periodLabel}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">{groupMode === 'customer' ? 'Customer' : 'Region'}</th>
                  <th className="p-3 text-right">Total Sales (Dr)</th>
                  <th className="p-3 text-right">Sale Returns (Cr)</th>
                  <th className="p-3 text-right">Payment Received (Cr)</th>
                  <th className="p-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {groupMode === 'customer' ? (
                  customerRows.length === 0 ? (
                    <tr><td colSpan={5} className="text-center p-8 text-slate-400">No sales activity found for this period.</td></tr>
                  ) : (
                    customerRows.map(row => (
                      <tr key={row.customerId} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-semibold text-slate-800">{row.customerName}</td>
                        <td className="p-3 text-right font-bold text-rose-700">{row.totalSales > 0 ? formatCurrency(row.totalSales) : '-'}</td>
                        <td className="p-3 text-right font-bold text-blue-700">{row.saleReturns > 0 ? formatCurrency(row.saleReturns) : '-'}</td>
                        <td className="p-3 text-right font-bold text-emerald-700">{row.paymentReceived > 0 ? formatCurrency(row.paymentReceived) : '-'}</td>
                        <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(row.balance)}</td>
                      </tr>
                    ))
                  )
                ) : (
                  regionGroups.length === 0 ? (
                    <tr><td colSpan={5} className="text-center p-8 text-slate-400">No sales activity found for this period.</td></tr>
                  ) : (
                    regionGroups.map(region => {
                      const isExpanded = expandedRegionId === region.regionId;
                      return (
                        <Fragment key={region.regionId}>
                          <tr
                            className="border-b bg-slate-50/60 hover:bg-slate-100/60 cursor-pointer font-semibold"
                            style={{ borderColor: 'var(--border-table)' }}
                            onClick={() => setExpandedRegionId(isExpanded ? null : region.regionId)}
                          >
                            <td className="p-3 pl-4 text-slate-800 flex items-center gap-1.5">
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              {region.regionName}
                              <span className="text-xs font-normal text-slate-400">({region.customers.length} customers)</span>
                            </td>
                            <td className="p-3 text-right text-rose-700">{region.totalSales > 0 ? formatCurrency(region.totalSales) : '-'}</td>
                            <td className="p-3 text-right text-blue-700">{region.saleReturns > 0 ? formatCurrency(region.saleReturns) : '-'}</td>
                            <td className="p-3 text-right text-emerald-700">{region.paymentReceived > 0 ? formatCurrency(region.paymentReceived) : '-'}</td>
                            <td className="p-3 text-right text-slate-800">{formatCurrency(region.balance)}</td>
                          </tr>
                          {isExpanded && region.customers.map(c => (
                            <tr key={c.customerId} className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                              <td className="p-3 pl-10 text-slate-600">{c.customerName}</td>
                              <td className="p-3 text-right font-medium text-rose-600">{c.totalSales > 0 ? formatCurrency(c.totalSales) : '-'}</td>
                              <td className="p-3 text-right font-medium text-blue-600">{c.saleReturns > 0 ? formatCurrency(c.saleReturns) : '-'}</td>
                              <td className="p-3 text-right font-medium text-emerald-600">{c.paymentReceived > 0 ? formatCurrency(c.paymentReceived) : '-'}</td>
                              <td className="p-3 text-right font-medium text-slate-700">{formatCurrency(c.balance)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })
                  )
                )}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                  <td className="p-4 pl-4 text-left font-lora">GRAND TOTAL</td>
                  <td className="p-4 text-right text-rose-800">{formatCurrency(grandTotals.totalSales)}</td>
                  <td className="p-4 text-right text-blue-800">{formatCurrency(grandTotals.saleReturns)}</td>
                  <td className="p-4 text-right text-emerald-800">{formatCurrency(grandTotals.paymentReceived)}</td>
                  <td className="p-4 text-right" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(grandTotals.balance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

      </div>
  );
}

export default function SaleAnalysisPage() {
  return (
    <AppLayout pageTitle="Sale Analysis">
      <SaleAnalysisContent />
    </AppLayout>
  );
}
