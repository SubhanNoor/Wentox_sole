import { Fragment, useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate, formatDateTime } from '@/lib/utils';
import { groupByRegion, groupByCity, groupByRegionThenCity } from '@/lib/geoGrouping';
import * as api from '@/lib/api';
import type { SaleReportRow as ApiSaleReportRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

interface SaleReportRow {
  key: string;
  label: string;
  regionId: number | null;
  regionName: string | null;
  cityId: number | null;
  cityName: string | null;
  totalSales: number;
  totalCartons: number;
  commission: number;
  saleReturn: number;
  netSales: number;
  payment: number;
  /** Optional because the synthesized group/overall rows have no party of their own to attribute a
   *  JV to — only real customer rows carry it. */
  totalJv?: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

type GroupMode = 'overall' | 'customer' | 'region' | 'city' | 'region-city';

const GROUP_LABELS: Record<GroupMode, string> = {
  overall: 'Overall',
  customer: 'Customer Wise',
  region: 'Region Wise',
  city: 'City Wise',
  'region-city': 'Region + City Wise',
};

const COLUMN_LABELS: Record<GroupMode, string> = {
  overall: 'Summary',
  customer: 'Customer',
  region: 'Region',
  city: 'City',
  'region-city': 'Region / City',
};

interface Metrics {
  totalSales: number;
  totalCartons: number;
  commission: number;
  saleReturn: number;
  netSales: number;
  payment: number;
}

function sumMetrics(rows: Metrics[]): Metrics {
  return rows.reduce((acc, r) => ({
    totalSales: acc.totalSales + r.totalSales,
    totalCartons: acc.totalCartons + r.totalCartons,
    commission: acc.commission + r.commission,
    saleReturn: acc.saleReturn + r.saleReturn,
    netSales: acc.netSales + r.netSales,
    payment: acc.payment + r.payment,
  }), { totalSales: 0, totalCartons: 0, commission: 0, saleReturn: 0, netSales: 0, payment: 0 });
}

function mapRow(r: ApiSaleReportRow): SaleReportRow {
  return {
    key: String(r.customer_id),
    label: r.customer_name,
    regionId: r.region_id,
    regionName: r.region_name,
    cityId: r.city_id,
    cityName: r.city_name,
    totalSales: r.total_sales,
    totalCartons: r.total_cartons,
    commission: r.commission,
    saleReturn: r.sale_return,
    netSales: r.net_sales,
    payment: r.payment,
    totalJv: r.total_jv,
  };
}

export function SaleReportContent() {
  const [groupMode, setGroupMode] = useState<GroupMode>('overall');
  const [viewMode, setViewMode] = useState<'overall' | 'month' | 'range'>('overall');
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth());
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());
  const [expandedRegionId, setExpandedRegionId] = useState<number | null>(null);
  const [expandedCityId, setExpandedCityId] = useState<number | null>(null);

  const changeGroupMode = (mode: GroupMode) => {
    setGroupMode(mode);
    setExpandedRegionId(null);
    setExpandedCityId(null);
  };

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
        periodLabel: `${fromDate ? formatDate(fromDate) : 'Start'} to ${toDate ? formatDate(toDate) : 'End'}`
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

  const overallRow: SaleReportRow = useMemo(() => ({
    key: 'overall', label: 'Overall', regionId: null, regionName: null, cityId: null, cityName: null,
    ...sumMetrics(customerRows),
  }), [customerRows]);

  const regionGroups = useMemo(
    () => groupByRegion(customerRows).map(g => ({ ...g, ...sumMetrics(g.rows) })),
    [customerRows]
  );
  const cityGroups = useMemo(
    () => groupByCity(customerRows).map(g => ({ ...g, ...sumMetrics(g.rows) })),
    [customerRows]
  );
  const regionCityGroups = useMemo(
    () => groupByRegionThenCity(customerRows).map(g => ({
      ...g,
      ...sumMetrics(g.rows),
      cities: g.cities.map(c => ({ ...c, ...sumMetrics(c.rows) })),
    })),
    [customerRows]
  );

  const handleExportExcel = () => {
    const headers = [COLUMN_LABELS[groupMode], 'Total Sales', 'Total Cartons', 'Commission', 'Sale Return', 'Net Sales', 'Payment'];
    let rows: (string | number)[][];
    if (groupMode === 'overall') {
      rows = [[overallRow.label, overallRow.totalSales, overallRow.totalCartons, overallRow.commission, overallRow.saleReturn, overallRow.netSales, overallRow.payment]];
    } else if (groupMode === 'customer') {
      rows = customerRows.map(r => [r.label, r.totalSales, r.totalCartons, r.commission, r.saleReturn, r.netSales, r.payment]);
    } else if (groupMode === 'region') {
      rows = regionGroups.flatMap(g => [
        [g.name, g.totalSales, g.totalCartons, g.commission, g.saleReturn, g.netSales, g.payment],
        ...g.rows.map(c => [`  ${c.label}`, c.totalSales, c.totalCartons, c.commission, c.saleReturn, c.netSales, c.payment])
      ]);
    } else if (groupMode === 'city') {
      rows = cityGroups.flatMap(g => [
        [g.name, g.totalSales, g.totalCartons, g.commission, g.saleReturn, g.netSales, g.payment],
        ...g.rows.map(c => [`  ${c.label}`, c.totalSales, c.totalCartons, c.commission, c.saleReturn, c.netSales, c.payment])
      ]);
    } else {
      rows = regionCityGroups.flatMap(g => [
        [g.name, g.totalSales, g.totalCartons, g.commission, g.saleReturn, g.netSales, g.payment],
        ...g.cities.flatMap(c => [
          [`  ${c.name}`, c.totalSales, c.totalCartons, c.commission, c.saleReturn, c.netSales, c.payment],
          ...c.rows.map(cust => [`    ${cust.label}`, cust.totalSales, cust.totalCartons, cust.commission, cust.saleReturn, cust.netSales, cust.payment])
        ])
      ]);
    }
    exportRowsToExcel(`sale-report-${groupMode}`, headers, rows);
  };

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const renderPrintableDocument = () => {
    // build flat display rows for print
    let displayRows: Array<SaleReportRow & { key: string; indent?: number; bold?: boolean }>;
    if (groupMode === 'overall') {
      displayRows = [overallRow];
    } else if (groupMode === 'customer') {
      displayRows = customerRows;
    } else if (groupMode === 'region') {
      displayRows = regionGroups.flatMap(g => [
        { key: `region-${g.id}`, label: g.name, regionId: g.id, regionName: g.name, cityId: null, cityName: null, totalSales: g.totalSales, totalCartons: g.totalCartons, commission: g.commission, saleReturn: g.saleReturn, netSales: g.netSales, payment: g.payment, bold: true },
        ...g.rows.map(c => ({ ...c, key: `customer-${c.key}`, indent: 1 })),
      ]);
    } else if (groupMode === 'city') {
      displayRows = cityGroups.flatMap(g => [
        { key: `city-${g.id}`, label: g.name, regionId: null, regionName: null, cityId: g.id, cityName: g.name, totalSales: g.totalSales, totalCartons: g.totalCartons, commission: g.commission, saleReturn: g.saleReturn, netSales: g.netSales, payment: g.payment, bold: true },
        ...g.rows.map(c => ({ ...c, key: `customer-${c.key}`, indent: 1 })),
      ]);
    } else {
      displayRows = regionCityGroups.flatMap(g => [
        { key: `region-${g.id}`, label: g.name, regionId: g.id, regionName: g.name, cityId: null, cityName: null, totalSales: g.totalSales, totalCartons: g.totalCartons, commission: g.commission, saleReturn: g.saleReturn, netSales: g.netSales, payment: g.payment, bold: true },
        ...g.cities.flatMap(c => [
          { key: `city-${g.id}-${c.id}`, label: c.name, regionId: null, regionName: null, cityId: c.id, cityName: c.name, totalSales: c.totalSales, totalCartons: c.totalCartons, commission: c.commission, saleReturn: c.saleReturn, netSales: c.netSales, payment: c.payment, bold: true, indent: 1 },
          ...c.rows.map(cust => ({ ...cust, key: `customer-${cust.key}`, indent: 2 })),
        ]),
      ]);
    }
    const totals = overallRow;
    return (
      <div className="excel-print-container">
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              SALE REPORT — {(groupMode === 'overall' ? 'OVERALL SUMMARY' : GROUP_LABELS[groupMode]).toUpperCase()}
            </h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
              Period: {periodLabel}
            </p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Date of Print: {formatDate(new Date())}
            </p>
          </div>
        </div>

        <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>
                {COLUMN_LABELS[groupMode]}
              </th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Total Sales</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Total Cartons</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Commission</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Sale Return</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Net Sales</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Payment</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map(r => (
              <tr key={r.key} style={{ fontWeight: r.bold ? 'bold' : 'normal', backgroundColor: r.bold ? '#f9f9f9' : '#ffffff' }}>
                <td style={{ border: '1px solid #000000', padding: r.indent ? `4px 6px 4px ${6 + r.indent * 14}px` : '5px 6px', fontSize: r.indent ? '10.5px' : '11px' }}>{r.label}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(r.totalSales)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{r.totalCartons}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(r.commission)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(r.saleReturn)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(r.netSales)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(r.payment)}</td>
              </tr>
            ))}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>GRAND TOTAL</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(totals.totalSales)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{totals.totalCartons}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(totals.commission)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(totals.saleReturn)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{formatCurrency(totals.netSales)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(totals.payment)}</td>
            </tr>
          </tbody>
        </table>

        <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', padding: '0 10px' }}>
          <div style={{ textAlign: 'center', width: '150px' }}>
            <div style={{ borderBottom: '1px solid #000000', height: '30px' }}></div>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Prepared By</span>
          </div>
          <div style={{ textAlign: 'center', width: '150px' }}>
            <div style={{ borderBottom: '1px solid #000000', height: '30px' }}></div>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Audited By</span>
          </div>
          <div style={{ textAlign: 'center', width: '150px' }}>
            <div style={{ borderBottom: '1px solid #000000', height: '30px' }}></div>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Authorized Sign</span>
          </div>
        </div>

        <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
          <div>WENTOX FOOTWEAR DISTRIBUTION</div>
          <div>Printed: {formatDateTime(new Date())}</div>
        </div>
      </div>
    );
  };

  return (
      <div className="mx-auto" style={{ maxWidth: 1150 }}>

        {/* Grouping Selector - data-no-print */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl max-w-2xl mb-6 border border-slate-200" data-no-print>
          {(Object.keys(GROUP_LABELS) as GroupMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => changeGroupMode(mode)}
              className={`flex-1 text-center py-2 text-sm font-semibold rounded-lg transition-all duration-200 cursor-pointer ${groupMode === mode ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {GROUP_LABELS[mode]}
            </button>
          ))}
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
                  <input type="date"
            value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
                  <input type="date"
            value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPreviewOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
            >
              <Eye size={14} /> Show Print Preview
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
                  <th className="p-3 pl-4">{COLUMN_LABELS[groupMode]}</th>
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
                    customerRows.flatMap(row => [
                      <tr key={row.key} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-semibold text-slate-800">{row.label}</td>
                        <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(row.totalSales)}</td>
                        <td className="p-3 text-right font-bold text-slate-700">{row.totalCartons}</td>
                        <td className="p-3 text-right font-bold text-amber-700">{row.commission > 0 ? formatCurrency(row.commission) : '-'}</td>
                        <td className="p-3 text-right font-bold text-blue-700">{row.saleReturn > 0 ? formatCurrency(row.saleReturn) : '-'}</td>
                        <td className="p-3 text-right font-bold" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(row.netSales)}</td>
                        <td className="p-3 text-right font-bold text-emerald-700">{formatCurrency(row.payment)}</td>
                      </tr>,
                      // Own row, not a column: a JV reduces what is owed but is not money
                      // collected, and most customers have none — a column would be mostly dashes.
                      (row.totalJv ?? 0) !== 0 ? (
                        <tr key={`jv-${row.key}`} className="border-b bg-amber-50/40" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-2 pl-8 text-xs font-semibold text-amber-900" colSpan={6}>
                            Journal Voucher applied
                          </td>
                          <td className="p-2 text-right text-xs font-bold font-mono text-amber-900">
                            {formatCurrency(Math.abs(row.totalJv ?? 0))}
                          </td>
                        </tr>
                      ) : null,
                    ])
                  )
                ) : groupMode === 'region' || groupMode === 'city' ? (
                  (groupMode === 'region' ? regionGroups : cityGroups).length === 0 ? (
                    <tr><td colSpan={7} className="text-center p-8 text-slate-400">No sales activity found for this period.</td></tr>
                  ) : (
                    (groupMode === 'region' ? regionGroups : cityGroups).map(g => {
                      const expandedId = groupMode === 'region' ? expandedRegionId : expandedCityId;
                      const setExpandedId = groupMode === 'region' ? setExpandedRegionId : setExpandedCityId;
                      const isExpanded = expandedId === g.id;
                      return (
                        <Fragment key={String(g.id)}>
                          <tr
                            className="border-b bg-slate-50/60 hover:bg-slate-100/60 cursor-pointer font-semibold"
                            style={{ borderColor: 'var(--border-table)' }}
                            onClick={() => setExpandedId(isExpanded ? null : g.id)}
                          >
                            <td className="p-3 pl-4 text-slate-800 flex items-center gap-1.5">
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              {g.name}
                              <span className="text-xs font-normal text-slate-400">({g.rows.length} customers)</span>
                            </td>
                            <td className="p-3 text-right text-slate-800">{formatCurrency(g.totalSales)}</td>
                            <td className="p-3 text-right text-slate-700">{g.totalCartons}</td>
                            <td className="p-3 text-right text-amber-700">{g.commission > 0 ? formatCurrency(g.commission) : '-'}</td>
                            <td className="p-3 text-right text-blue-700">{g.saleReturn > 0 ? formatCurrency(g.saleReturn) : '-'}</td>
                            <td className="p-3 text-right" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(g.netSales)}</td>
                            <td className="p-3 text-right text-emerald-700">{formatCurrency(g.payment)}</td>
                          </tr>
                          {isExpanded && g.rows.map(c => (
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
                ) : (
                  regionCityGroups.length === 0 ? (
                    <tr><td colSpan={7} className="text-center p-8 text-slate-400">No sales activity found for this period.</td></tr>
                  ) : (
                    regionCityGroups.map(region => {
                      const isRegionExpanded = expandedRegionId === region.id;
                      return (
                        <Fragment key={String(region.id)}>
                          <tr
                            className="border-b bg-slate-100/70 hover:bg-slate-200/60 cursor-pointer font-bold"
                            style={{ borderColor: 'var(--border-table)' }}
                            onClick={() => setExpandedRegionId(isRegionExpanded ? null : region.id)}
                          >
                            <td className="p-3 pl-4 text-slate-800 flex items-center gap-1.5">
                              {isRegionExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              {region.name}
                              <span className="text-xs font-normal text-slate-400">({region.cities.length} cities, {region.rows.length} customers)</span>
                            </td>
                            <td className="p-3 text-right text-slate-800">{formatCurrency(region.totalSales)}</td>
                            <td className="p-3 text-right text-slate-700">{region.totalCartons}</td>
                            <td className="p-3 text-right text-amber-700">{region.commission > 0 ? formatCurrency(region.commission) : '-'}</td>
                            <td className="p-3 text-right text-blue-700">{region.saleReturn > 0 ? formatCurrency(region.saleReturn) : '-'}</td>
                            <td className="p-3 text-right" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(region.netSales)}</td>
                            <td className="p-3 text-right text-emerald-700">{formatCurrency(region.payment)}</td>
                          </tr>
                          {isRegionExpanded && region.cities.map(city => {
                            const isCityExpanded = expandedCityId === city.id;
                            return (
                              <Fragment key={`${region.id}-${city.id}`}>
                                <tr
                                  className="border-b bg-slate-50/60 hover:bg-slate-100/60 cursor-pointer font-semibold"
                                  style={{ borderColor: 'var(--border-table)' }}
                                  onClick={() => setExpandedCityId(isCityExpanded ? null : city.id)}
                                >
                                  <td className="p-3 pl-10 text-slate-700 flex items-center gap-1.5">
                                    {isCityExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                    {city.name}
                                    <span className="text-xs font-normal text-slate-400">({city.rows.length} customers)</span>
                                  </td>
                                  <td className="p-3 text-right text-slate-800">{formatCurrency(city.totalSales)}</td>
                                  <td className="p-3 text-right text-slate-700">{city.totalCartons}</td>
                                  <td className="p-3 text-right text-amber-700">{city.commission > 0 ? formatCurrency(city.commission) : '-'}</td>
                                  <td className="p-3 text-right text-blue-700">{city.saleReturn > 0 ? formatCurrency(city.saleReturn) : '-'}</td>
                                  <td className="p-3 text-right" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(city.netSales)}</td>
                                  <td className="p-3 text-right text-emerald-700">{formatCurrency(city.payment)}</td>
                                </tr>
                                {isCityExpanded && city.rows.map(c => (
                                  <tr key={c.key} className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                                    <td className="p-3 pl-16 text-slate-600">{c.label}</td>
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
                          })}
                        </Fragment>
                      );
                    })
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Sale Report - Print Preview"
        orientation="portrait"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>
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
