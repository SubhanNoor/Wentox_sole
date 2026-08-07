import { Fragment, useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { Printer, ChevronDown, ChevronRight, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { SaleReportRow as ApiSaleReportRow } from '@/lib/api';

interface SaleReportRow {
  key: string;
  label: string;
  regionId: number | null;
  regionName: string | null;
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

function mapRow(r: ApiSaleReportRow): SaleReportRow {
  return {
    key: String(r.customer_id),
    label: r.customer_name,
    regionId: r.region_id,
    regionName: r.region_name,
    totalSales: r.total_sales,
    totalCartons: r.total_cartons,
    commission: r.commission,
    saleReturn: r.sale_return,
    netSales: r.net_sales,
    payment: r.payment,
  };
}

export function SaleReportContent() {
  const [groupMode, setGroupMode] = useState<'overall' | 'customer' | 'region'>('overall');
  const [viewMode, setViewMode] = useState<'overall' | 'month' | 'range'>('overall');
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth());
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());
  const [expandedRegionId, setExpandedRegionId] = useState<number | null>(null);

  const [customerRows, setCustomerRows] = useState<SaleReportRow[]>([]);
  const [loading, setLoading] = useState(false);

  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    if (viewMode === 'month') {
      const start = `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(filterYear, filterMonth + 1, 0).getDate();
      const end = `${filterYear}-${String(filterMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { periodStart: start, periodEnd: end, periodLabel: `${MONTHS[filterMonth]} ${filterYear}` };
    }
    if (viewMode === 'range') {
      return {
        periodStart: fromDate || undefined,
        periodEnd: toDate || undefined,
        periodLabel: `${fromDate || 'Start'} to ${toDate || 'End'}`
      };
    }
    return { periodStart: undefined, periodEnd: undefined, periodLabel: 'Overall (All Time)' };
  }, [viewMode, filterMonth, filterYear, fromDate, toDate]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.saleReport({ date_from: periodStart, date_to: periodEnd });
    if (res.ok) setCustomerRows((res.data as ApiSaleReportRow[]).map(mapRow).filter(r => r.totalSales > 0 || r.saleReturn > 0 || r.payment > 0));
    setLoading(false);
  }, [periodStart, periodEnd]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const overallRow: SaleReportRow = useMemo(() => customerRows.reduce((acc, r) => ({
    key: 'overall', label: 'Overall', regionId: null, regionName: null,
    totalSales: acc.totalSales + r.totalSales,
    totalCartons: acc.totalCartons + r.totalCartons,
    commission: acc.commission + r.commission,
    saleReturn: acc.saleReturn + r.saleReturn,
    netSales: acc.netSales + r.netSales,
    payment: acc.payment + r.payment,
  }), { key: 'overall', label: 'Overall', regionId: null, regionName: null, totalSales: 0, totalCartons: 0, commission: 0, saleReturn: 0, netSales: 0, payment: 0 }), [customerRows]);

  const regionGroups = useMemo(() => {
    const groups: Record<string, { regionId: number | null; regionName: string; customers: SaleReportRow[] }> = {};
    customerRows.forEach(row => {
      const key = String(row.regionId ?? 'none');
      if (!groups[key]) groups[key] = { regionId: row.regionId, regionName: row.regionName || 'No Region', customers: [] };
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
  }, [customerRows]);

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
                <div className="w-36">
                  <SearchableSelect
                    options={MONTHS.map((m, idx) => ({ value: String(idx), label: m }))}
                    value={String(filterMonth)}
                    onChange={(val: string) => setFilterMonth(parseInt(val, 10))}
                    placeholder="Select month..."
                  />
                </div>
                <div className="w-28">
                  <SearchableSelect
                    options={[
                      { value: '2026', label: '2026' },
                      { value: '2025', label: '2025' }
                    ]}
                    value={String(filterYear)}
                    onChange={(val: string) => setFilterYear(parseInt(val, 10))}
                    placeholder="Year"
                  />
                </div>
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
                {loading ? (
                  <tr><td colSpan={7} className="text-center p-8 text-slate-400">Loading…</td></tr>
                ) : groupMode === 'overall' ? (
                  <tr className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4 font-semibold text-slate-800">{overallRow.label}</td>
                    <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(overallRow.totalSales)}</td>
                    <td className="p-3 text-right font-bold text-slate-700">{overallRow.totalCartons}</td>
                    <td className="p-3 text-right font-bold text-amber-700">{overallRow.commission > 0 ? formatCurrency(overallRow.commission) : '-'}</td>
                    <td className="p-3 text-right font-bold text-blue-700">{overallRow.saleReturn > 0 ? formatCurrency(overallRow.saleReturn) : '-'}</td>
                    <td className="p-3 text-right font-bold" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(overallRow.netSales)}</td>
                    <td className="p-3 text-right font-bold text-emerald-700">{formatCurrency(overallRow.payment)}</td>
                  </tr>
                ) : groupMode === 'customer' ? (
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
                ) : (
                  regionGroups.length === 0 ? (
                    <tr><td colSpan={7} className="text-center p-8 text-slate-400">No sales activity found for this period.</td></tr>
                  ) : (
                    regionGroups.map(region => {
                      const isExpanded = expandedRegionId === region.regionId;
                      return (
                        <Fragment key={String(region.regionId)}>
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
