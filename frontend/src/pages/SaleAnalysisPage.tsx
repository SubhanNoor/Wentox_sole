import { Fragment, useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate, formatDateTime } from '@/lib/utils';
import { groupByRegion, groupByCity, groupByRegionThenCity } from '@/lib/geoGrouping';
import * as api from '@/lib/api';
import type { SaleAnalysisRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { getWindowParam, isChildWindow } from '@/lib/windowParams';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

type GroupMode = 'customer' | 'region' | 'city' | 'region-city';

const GROUP_LABELS: Record<GroupMode, string> = {
  customer: 'Customer Wise',
  region: 'Region Wise',
  city: 'City Wise',
  'region-city': 'Region + City Wise',
};

const COLUMN_LABELS: Record<GroupMode, string> = {
  customer: 'Customer',
  region: 'Region',
  city: 'City',
  'region-city': 'Region / City',
};

interface Metrics {
  totalSales: number;
  saleReturns: number;
  paymentReceived: number;
  balance: number;
}

function sumMetrics(rows: Metrics[]): Metrics {
  return rows.reduce((acc, r) => ({
    totalSales: acc.totalSales + r.totalSales,
    saleReturns: acc.saleReturns + r.saleReturns,
    paymentReceived: acc.paymentReceived + r.paymentReceived,
    balance: acc.balance + r.balance,
  }), { totalSales: 0, saleReturns: 0, paymentReceived: 0, balance: 0 });
}

export function SaleAnalysisContent() {
  const [groupMode, setGroupMode] = useState<GroupMode>(() => (getWindowParam('groupMode') as GroupMode) || 'customer');
  const [viewMode, setViewMode] = useState<'overall' | 'month' | 'range'>(() => (getWindowParam('viewMode') as 'overall' | 'month' | 'range') || 'overall');
  const [filterMonth, setFilterMonth] = useState(() => { const p = getWindowParam('filterMonth'); return p != null ? Number(p) : new Date().getMonth(); });
  const [filterYear, setFilterYear] = useState(() => { const p = getWindowParam('filterYear'); return p != null ? Number(p) : new Date().getFullYear(); });
  const [fromDate, setFromDate] = useState(() => getWindowParam('fromDate') || getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(() => getWindowParam('toDate') || getTodayDate());
  const [expandedRegionId, setExpandedRegionId] = useState<number | null>(null);
  const [expandedCityId, setExpandedCityId] = useState<number | null>(null);

  const changeGroupMode = (mode: GroupMode) => {
    setGroupMode(mode);
    setExpandedRegionId(null);
    setExpandedCityId(null);
  };

  const [rows, setRows] = useState<SaleAnalysisRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

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
    const res = await api.reports.saleAnalysis({ date_from: periodStart, date_to: periodEnd });
    if (res.ok) setRows(res.data as SaleAnalysisRow[]);
    setLoading(false);
    setHasLoadedOnce(true);
  }, [periodStart, periodEnd]);

  useEffect(() => { loadRows(); }, [loadRows]);

  // "Show Print Preview" opens a new window on this same filtered/grouped report (per the user,
  // 2026-09-03), instead of an in-page overlay.
  const handleShowPrintPreview = () => {
    api.openWindow('reports', 'sale-analysis', {
      groupMode, viewMode, filterMonth: String(filterMonth), filterYear: String(filterYear),
      fromDate, toDate, autoPreview: '1',
    });
  };

  // Opened via another window's "Show Print Preview" — go straight into the preview once loaded.
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && hasLoadedOnce) setIsPreviewOpen(true);
  }, [hasLoadedOnce]);

  // "Payment Received" combines the receipt amount and commission, same as the receipt-level
  // Dr customer BA / Cr COMMISSION_ALLOWED pair both reduce what the customer owes.
  const customerRows = useMemo(() => {
    return rows
      .map(r => ({
        customerId: r.customer_id,
        customerName: r.customer_name,
        regionId: r.region_id,
        regionName: r.region_name,
        cityId: r.city_id,
        cityName: r.city_name,
        totalSales: r.total_sales,
        saleReturns: r.total_returns,
        paymentReceived: r.total_payment + r.total_commission,
        balance: r.total_sales - r.total_returns - (r.total_payment + r.total_commission),
      }))
      .filter(row => row.totalSales > 0 || row.saleReturns > 0 || row.paymentReceived > 0);
  }, [rows]);

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

  const grandTotals = useMemo(() => sumMetrics(customerRows), [customerRows]);

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const handleExportExcel = () => {
    const headers = [COLUMN_LABELS[groupMode], 'Total Sales', 'Sale Returns', 'Payment Received', 'Balance'];
    let rows: (string | number)[][];
    if (groupMode === 'customer') {
      rows = customerRows.map(r => [r.customerName, r.totalSales, r.saleReturns, r.paymentReceived, r.balance]);
    } else if (groupMode === 'region') {
      rows = regionGroups.flatMap(g => [
        [g.name, g.totalSales, g.saleReturns, g.paymentReceived, g.balance],
        ...g.rows.map(c => [`  ${c.customerName}`, c.totalSales, c.saleReturns, c.paymentReceived, c.balance])
      ]);
    } else if (groupMode === 'city') {
      rows = cityGroups.flatMap(g => [
        [g.name, g.totalSales, g.saleReturns, g.paymentReceived, g.balance],
        ...g.rows.map(c => [`  ${c.customerName}`, c.totalSales, c.saleReturns, c.paymentReceived, c.balance])
      ]);
    } else {
      rows = regionCityGroups.flatMap(g => [
        [g.name, g.totalSales, g.saleReturns, g.paymentReceived, g.balance],
        ...g.cities.flatMap(c => [
          [`  ${c.name}`, c.totalSales, c.saleReturns, c.paymentReceived, c.balance],
          ...c.rows.map(cust => [`    ${cust.customerName}`, cust.totalSales, cust.saleReturns, cust.paymentReceived, cust.balance])
        ])
      ]);
    }
    exportRowsToExcel(`sale-analysis-${groupMode}`, headers, rows);
  };

  const renderPrintableDocument = () => {
    return (
      <div className="excel-print-container">
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              SALE ANALYSIS REPORT — {GROUP_LABELS[groupMode].toUpperCase()}
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
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Total Sales (Dr)</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Sale Returns (Cr)</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Payment Received</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Net Balance</th>
            </tr>
          </thead>
          <tbody>
            {groupMode === 'customer' && customerRows.map(c => (
              <tr key={c.customerId}>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', fontWeight: 'bold' }}>{c.customerName}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.totalSales)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.saleReturns)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.paymentReceived)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(c.balance)}</td>
              </tr>
            ))}
            {(groupMode === 'region' ? regionGroups : groupMode === 'city' ? cityGroups : []).map(g => (
              <Fragment key={String(g.id)}>
                <tr style={{ backgroundColor: '#f9f9f9', fontWeight: 'bold' }}>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{g.name}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(g.totalSales)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(g.saleReturns)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(g.paymentReceived)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(g.balance)}</td>
                </tr>
                {g.rows.map(c => (
                  <tr key={c.customerId}>
                    <td style={{ border: '1px solid #000000', padding: '4px 6px 4px 20px', fontSize: '10.5px' }}>{c.customerName}</td>
                    <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.totalSales)}</td>
                    <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.saleReturns)}</td>
                    <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.paymentReceived)}</td>
                    <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.balance)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {groupMode === 'region-city' && regionCityGroups.map(g => (
              <Fragment key={String(g.id)}>
                <tr style={{ backgroundColor: '#f2f2f2', fontWeight: 'bold' }}>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{g.name}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(g.totalSales)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(g.saleReturns)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(g.paymentReceived)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(g.balance)}</td>
                </tr>
                {g.cities.map(c => (
                  <Fragment key={`${g.id}-${c.id}`}>
                    <tr style={{ backgroundColor: '#f9f9f9', fontWeight: 'bold' }}>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px 4px 14px', fontSize: '10.5px' }}>{c.name}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.totalSales)}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.saleReturns)}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.paymentReceived)}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.balance)}</td>
                    </tr>
                    {c.rows.map(cust => (
                      <tr key={cust.customerId}>
                        <td style={{ border: '1px solid #000000', padding: '4px 6px 4px 28px', fontSize: '10px' }}>{cust.customerName}</td>
                        <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(cust.totalSales)}</td>
                        <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(cust.saleReturns)}</td>
                        <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(cust.paymentReceived)}</td>
                        <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(cust.balance)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </Fragment>
            ))}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>GRAND TOTAL</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(grandTotals.totalSales)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(grandTotals.saleReturns)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(grandTotals.paymentReceived)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{formatCurrency(grandTotals.balance)}</td>
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
      <div className="mx-auto" style={{ maxWidth: 1100 }}>

        {/* Grouping Selector - data-no-print */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl max-w-xl mb-6 border border-slate-200" data-no-print>
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
              onClick={handleShowPrintPreview}
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
              <h2 className="font-lora font-semibold text-lg uppercase">Sale Analysis — {GROUP_LABELS[groupMode]}</h2>
              <p className="text-sm text-slate-700 mt-1 font-semibold uppercase">{periodLabel}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">{COLUMN_LABELS[groupMode]}</th>
                  <th className="p-3 text-right">Total Sales (Dr)</th>
                  <th className="p-3 text-right">Sale Returns (Cr)</th>
                  <th className="p-3 text-right">Payment Received (Cr)</th>
                  <th className="p-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center p-8 text-slate-400">Loading…</td></tr>
                ) : groupMode === 'customer' ? (
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
                ) : groupMode === 'region' || groupMode === 'city' ? (
                  (groupMode === 'region' ? regionGroups : cityGroups).length === 0 ? (
                    <tr><td colSpan={5} className="text-center p-8 text-slate-400">No sales activity found for this period.</td></tr>
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
                            <td className="p-3 text-right text-rose-700">{g.totalSales > 0 ? formatCurrency(g.totalSales) : '-'}</td>
                            <td className="p-3 text-right text-blue-700">{g.saleReturns > 0 ? formatCurrency(g.saleReturns) : '-'}</td>
                            <td className="p-3 text-right text-emerald-700">{g.paymentReceived > 0 ? formatCurrency(g.paymentReceived) : '-'}</td>
                            <td className="p-3 text-right text-slate-800">{formatCurrency(g.balance)}</td>
                          </tr>
                          {isExpanded && g.rows.map(c => (
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
                ) : (
                  regionCityGroups.length === 0 ? (
                    <tr><td colSpan={5} className="text-center p-8 text-slate-400">No sales activity found for this period.</td></tr>
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
                            <td className="p-3 text-right text-rose-700">{region.totalSales > 0 ? formatCurrency(region.totalSales) : '-'}</td>
                            <td className="p-3 text-right text-blue-700">{region.saleReturns > 0 ? formatCurrency(region.saleReturns) : '-'}</td>
                            <td className="p-3 text-right text-emerald-700">{region.paymentReceived > 0 ? formatCurrency(region.paymentReceived) : '-'}</td>
                            <td className="p-3 text-right text-slate-800">{formatCurrency(region.balance)}</td>
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
                                  <td className="p-3 text-right text-rose-700">{city.totalSales > 0 ? formatCurrency(city.totalSales) : '-'}</td>
                                  <td className="p-3 text-right text-blue-700">{city.saleReturns > 0 ? formatCurrency(city.saleReturns) : '-'}</td>
                                  <td className="p-3 text-right text-emerald-700">{city.paymentReceived > 0 ? formatCurrency(city.paymentReceived) : '-'}</td>
                                  <td className="p-3 text-right text-slate-800">{formatCurrency(city.balance)}</td>
                                </tr>
                                {isCityExpanded && city.rows.map(c => (
                                  <tr key={c.customerId} className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                                    <td className="p-3 pl-16 text-slate-600">{c.customerName}</td>
                                    <td className="p-3 text-right font-medium text-rose-600">{c.totalSales > 0 ? formatCurrency(c.totalSales) : '-'}</td>
                                    <td className="p-3 text-right font-medium text-blue-600">{c.saleReturns > 0 ? formatCurrency(c.saleReturns) : '-'}</td>
                                    <td className="p-3 text-right font-medium text-emerald-600">{c.paymentReceived > 0 ? formatCurrency(c.paymentReceived) : '-'}</td>
                                    <td className="p-3 text-right font-medium text-slate-700">{formatCurrency(c.balance)}</td>
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

      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Sale Analysis Report - Print Preview"
        orientation="portrait"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>
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
