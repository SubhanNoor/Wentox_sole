import { Fragment, useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import { isReceiptLive } from '@/lib/cheques';
import AppLayout from '@/components/AppLayout';
import { Printer, ChevronDown, ChevronRight, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';

interface SaleReportRow {
  key: string;
  label: string;
  totalSales: number;
  totalCartons: number;
  commission: number;
  saleReturn: number;
  netSales: number;
  payment: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function SaleReportContent() {
  const { state } = useApp();

  const [groupMode, setGroupMode] = useState<'overall' | 'customer' | 'region'>('overall');
  const [viewMode, setViewMode] = useState<'overall' | 'month' | 'range'>('overall');
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth());
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
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

  const computeRowFor = (customerId: string | null): Omit<SaleReportRow, 'key' | 'label'> => {
    const bills = state.saleBills.filter(b =>
      (customerId === null || b.customerId === customerId) &&
      b.status === 'Posted' && b.date >= periodStart && b.date <= periodEnd
    );
    const returns = state.saleReturns.filter(r =>
      (customerId === null || r.customerId === customerId) &&
      r.status === 'Posted' && r.date >= periodStart && r.date <= periodEnd
    );
    // Bounced cheques are excluded — they were never really received (§13).
    const receipts = state.receipts.filter(rec =>
      (customerId === null || rec.customerId === customerId) &&
      rec.date >= periodStart && rec.date <= periodEnd &&
      isReceiptLive(rec)
    );

    const totalSales = bills.reduce((s, b) => s + b.totalValue, 0);
    const totalCartons = bills.reduce((s, b) => s + b.items.reduce((si, it) => si + it.cartons, 0), 0);
    const saleReturn = returns.reduce((s, r) => s + r.items.reduce((si, it) => si + it.value, 0), 0);
    const commission = receipts.reduce((s, rec) => s + (rec.commission || 0), 0);
    const payment = receipts.reduce((s, rec) => s + rec.amount, 0);
    const netSales = totalSales - commission - saleReturn;

    return { totalSales, totalCartons, commission, saleReturn, netSales, payment };
  };

  const overallRow: SaleReportRow = useMemo(() => ({
    key: 'overall',
    label: 'Overall',
    ...computeRowFor(null)
  }), [state.saleBills, state.saleReturns, state.receipts, periodStart, periodEnd]);

  const customerRows = useMemo((): SaleReportRow[] => {
    return state.customers
      .map(c => ({ key: c.id, label: c.name, ...computeRowFor(c.id) }))
      .filter(r => r.totalSales > 0 || r.saleReturn > 0 || r.payment > 0);
  }, [state.customers, state.saleBills, state.saleReturns, state.receipts, periodStart, periodEnd]);

  const regionGroups = useMemo(() => {
    const groups: Record<string, { regionId: string; regionName: string; customers: SaleReportRow[] }> = {};
    state.customers.forEach(c => {
      const row = customerRows.find(r => r.key === c.id);
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
        totalCartons: g.customers.reduce((s, c) => s + c.totalCartons, 0),
        commission: g.customers.reduce((s, c) => s + c.commission, 0),
        saleReturn: g.customers.reduce((s, c) => s + c.saleReturn, 0),
        netSales: g.customers.reduce((s, c) => s + c.netSales, 0),
        payment: g.customers.reduce((s, c) => s + c.payment, 0)
      }))
      .sort((a, b) => a.regionName.localeCompare(b.regionName));
  }, [state.customers, state.regions, customerRows]);

  const handleExportExcel = () => {
    const headers = [groupMode === 'region' ? 'Region' : groupMode === 'customer' ? 'Customer' : 'Summary', 'Total Sales', 'Total Cartons', 'Commission', 'Sale Return', 'Net Sales', 'Payment'];
    let rows: (string | number)[][];
    if (groupMode === 'overall') {
      rows = [[overallRow.label, overallRow.totalSales, overallRow.totalCartons, overallRow.commission, overallRow.saleReturn, overallRow.netSales, overallRow.payment]];
    } else if (groupMode === 'customer') {
      rows = customerRows.map(r => [r.label, r.totalSales, r.totalCartons, r.commission, r.saleReturn, r.netSales, r.payment]);
    } else {
      rows = regionGroups.flatMap(g => [
        [g.regionName, g.totalSales, g.totalCartons, g.commission, g.saleReturn, g.netSales, g.payment],
        ...g.customers.map(c => [`  ${c.label}`, c.totalSales, c.totalCartons, c.commission, c.saleReturn, c.netSales, c.payment])
      ]);
    }
    exportRowsToExcel(`sale-report-${groupMode}`, headers, rows);
  };

  return (
      <div className="mx-auto" style={{ maxWidth: 1150 }}>

        {/* Grouping Selector - data-no-print */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl max-w-md mb-6 border border-slate-200" data-no-print>
          <button
            onClick={() => setGroupMode('overall')}
            className={`flex-1 text-center py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${groupMode === 'overall' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Overall
          </button>
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
              <h2 className="font-lora font-semibold text-lg uppercase">Sale Report</h2>
              <p className="text-sm text-slate-700 mt-1 font-semibold uppercase">{periodLabel}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">{groupMode === 'overall' ? 'Summary' : groupMode === 'customer' ? 'Customer' : 'Region'}</th>
                  <th className="p-3 text-right">Total Sales</th>
                  <th className="p-3 text-right">Total Cartons</th>
                  <th className="p-3 text-right">Commission</th>
                  <th className="p-3 text-right">Sale Return</th>
                  <th className="p-3 text-right">Net Sales</th>
                  <th className="p-3 text-right">Payment</th>
                </tr>
              </thead>
              <tbody>
                {groupMode === 'overall' && (
                  <tr className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4 font-semibold text-slate-800">{overallRow.label}</td>
                    <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(overallRow.totalSales)}</td>
                    <td className="p-3 text-right font-bold text-slate-700">{overallRow.totalCartons}</td>
                    <td className="p-3 text-right font-bold text-amber-700">{overallRow.commission > 0 ? formatCurrency(overallRow.commission) : '-'}</td>
                    <td className="p-3 text-right font-bold text-blue-700">{overallRow.saleReturn > 0 ? formatCurrency(overallRow.saleReturn) : '-'}</td>
                    <td className="p-3 text-right font-bold" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(overallRow.netSales)}</td>
                    <td className="p-3 text-right font-bold text-emerald-700">{formatCurrency(overallRow.payment)}</td>
                  </tr>
                )}

                {groupMode === 'customer' && (
                  customerRows.length === 0 ? (
                    <tr><td colSpan={7} className="text-center p-8 text-slate-400">No sales activity found for this period.</td></tr>
                  ) : (
                    customerRows.map(row => (
                      <tr key={row.key} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-semibold text-slate-800">{row.label}</td>
                        <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(row.totalSales)}</td>
                        <td className="p-3 text-right font-bold text-slate-700">{row.totalCartons}</td>
                        <td className="p-3 text-right font-bold text-amber-700">{row.commission > 0 ? formatCurrency(row.commission) : '-'}</td>
                        <td className="p-3 text-right font-bold text-blue-700">{row.saleReturn > 0 ? formatCurrency(row.saleReturn) : '-'}</td>
                        <td className="p-3 text-right font-bold" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(row.netSales)}</td>
                        <td className="p-3 text-right font-bold text-emerald-700">{formatCurrency(row.payment)}</td>
                      </tr>
                    ))
                  )
                )}

                {groupMode === 'region' && (
                  regionGroups.length === 0 ? (
                    <tr><td colSpan={7} className="text-center p-8 text-slate-400">No sales activity found for this period.</td></tr>
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
                            <td className="p-3 text-right text-slate-800">{formatCurrency(region.totalSales)}</td>
                            <td className="p-3 text-right text-slate-700">{region.totalCartons}</td>
                            <td className="p-3 text-right text-amber-700">{region.commission > 0 ? formatCurrency(region.commission) : '-'}</td>
                            <td className="p-3 text-right text-blue-700">{region.saleReturn > 0 ? formatCurrency(region.saleReturn) : '-'}</td>
                            <td className="p-3 text-right" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(region.netSales)}</td>
                            <td className="p-3 text-right text-emerald-700">{formatCurrency(region.payment)}</td>
                          </tr>
                          {isExpanded && region.customers.map(c => (
                            <tr key={c.key} className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                              <td className="p-3 pl-10 text-slate-600">{c.label}</td>
                              <td className="p-3 text-right font-medium text-slate-700">{formatCurrency(c.totalSales)}</td>
                              <td className="p-3 text-right font-medium text-slate-600">{c.totalCartons}</td>
                              <td className="p-3 text-right font-medium text-amber-600">{c.commission > 0 ? formatCurrency(c.commission) : '-'}</td>
                              <td className="p-3 text-right font-medium text-blue-600">{c.saleReturn > 0 ? formatCurrency(c.saleReturn) : '-'}</td>
                              <td className="p-3 text-right font-medium text-slate-700">{formatCurrency(c.netSales)}</td>
                              <td className="p-3 text-right font-medium text-emerald-600">{formatCurrency(c.payment)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
  );
}

export default function SaleReportPage() {
  return (
    <AppLayout pageTitle="Sale Report">
      <SaleReportContent />
    </AppLayout>
  );
}
