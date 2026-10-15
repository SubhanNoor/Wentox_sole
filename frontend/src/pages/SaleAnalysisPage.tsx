import { Fragment, useState, useMemo, useEffect, useCallback } from 'react';
import SkipZeroToggle, { isZeroBalance } from '@/components/SkipZeroToggle';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate, formatDateTime } from '@/lib/utils';
import { groupByRegion, groupByCity, groupByRegionThenCity } from '@/lib/geoGrouping';
import * as api from '@/lib/api';
import type { SaleAnalysisRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { closePreviewWindow } from '@/components/reports/previewWindow';
import LiveReportDocument from '@/components/reports/LiveReportDocument';
import { REPORT_COLORS, signedColor } from '@/components/reports/reportColors';
import { getWindowParam, isChildWindow } from '@/lib/windowParams';
import { useDataVersion } from '@/hooks/useDataVersion';

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
  // Re-runs the loads below when another window saves something (live update, 2026-10-15).
  const dataVersion = useDataVersion();
  const [groupMode, setGroupMode] = useState<GroupMode>(() => (getWindowParam('groupMode') as GroupMode) || 'customer');
  const [viewMode, setViewMode] = useState<'overall' | 'month' | 'range'>(() => (getWindowParam('viewMode') as 'overall' | 'month' | 'range') || 'overall');
  const [filterMonth, setFilterMonth] = useState(() => { const p = getWindowParam('filterMonth'); return p != null ? Number(p) : new Date().getMonth(); });
  const [filterYear, setFilterYear] = useState(() => { const p = getWindowParam('filterYear'); return p != null ? Number(p) : new Date().getFullYear(); });
  const [fromDate, setFromDate] = useState(() => getWindowParam('fromDate') || getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(() => getWindowParam('toDate') || getTodayDate());

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

  useEffect(() => { loadRows(); }, [loadRows, dataVersion]);

  // "Show Print Preview" opens a new window on this same filtered/grouped report (per the user,
  // 2026-09-03), instead of an in-page overlay.
  const handleShowPrintPreview = () => {
    api.openWindow('reports', 'sale-analysis', {
      groupMode, viewMode, filterMonth: String(filterMonth), filterYear: String(filterYear),
      fromDate, toDate, skipZero: skipZero ? '1' : '0', autoPreview: '1',
    });
  };

  // Opened via another window's "Show Print Preview" — go straight into the preview once loaded.
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && hasLoadedOnce) setIsPreviewOpen(true);
  }, [hasLoadedOnce]);

  // "Payment Received" combines the receipt amount and commission, same as the receipt-level
  // Dr customer BA / Cr COMMISSION_ALLOWED pair both reduce what the customer owes.
  const [skipZero, setSkipZero] = useState(() => getWindowParam('skipZero') === '1');

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
        // The customer's real account balance on the To date, from the backend — the same figure its
        // ledger closes on, opening balance and earlier bills included (per the user, 2026-10-13; it
        // used to be this period's sales - returns - payments only).
        balance: r.balance,
      }))
      // Idle customers still carrying a balance stay listed (per the user, 2026-10-14).
      .filter(row => row.totalSales > 0 || row.saleReturns > 0 || row.paymentReceived > 0 || !isZeroBalance(row.balance))
      .filter(row => !(skipZero && isZeroBalance(row.balance)));
  }, [rows, skipZero]);

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
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.sales }}>{formatCurrency(c.totalSales)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.returns }}>{formatCurrency(c.saleReturns)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.payment }}>{formatCurrency(c.paymentReceived)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: signedColor(c.balance) }}>{formatCurrency(c.balance)}</td>
              </tr>
            ))}
            {(groupMode === 'region' ? regionGroups : groupMode === 'city' ? cityGroups : []).map(g => (
              <Fragment key={String(g.id)}>
                <tr style={{ backgroundColor: '#f9f9f9', fontWeight: 'bold' }}>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{g.name}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.sales }}>{formatCurrency(g.totalSales)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.returns }}>{formatCurrency(g.saleReturns)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.payment }}>{formatCurrency(g.paymentReceived)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: signedColor(g.balance) }}>{formatCurrency(g.balance)}</td>
                </tr>
                {g.rows.map(c => (
                  <tr key={c.customerId}>
                    <td style={{ border: '1px solid #000000', padding: '4px 6px 4px 20px', fontSize: '10.5px' }}>{c.customerName}</td>
                    <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.sales }}>{formatCurrency(c.totalSales)}</td>
                    <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.returns }}>{formatCurrency(c.saleReturns)}</td>
                    <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.payment }}>{formatCurrency(c.paymentReceived)}</td>
                    <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', color: signedColor(c.balance) }}>{formatCurrency(c.balance)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {groupMode === 'region-city' && regionCityGroups.map(g => (
              <Fragment key={String(g.id)}>
                <tr style={{ backgroundColor: '#f2f2f2', fontWeight: 'bold' }}>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{g.name}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.sales }}>{formatCurrency(g.totalSales)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.returns }}>{formatCurrency(g.saleReturns)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.payment }}>{formatCurrency(g.paymentReceived)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: signedColor(g.balance) }}>{formatCurrency(g.balance)}</td>
                </tr>
                {g.cities.map(c => (
                  <Fragment key={`${g.id}-${c.id}`}>
                    <tr style={{ backgroundColor: '#f9f9f9', fontWeight: 'bold' }}>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px 4px 14px', fontSize: '10.5px' }}>{c.name}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.sales }}>{formatCurrency(c.totalSales)}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.returns }}>{formatCurrency(c.saleReturns)}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.payment }}>{formatCurrency(c.paymentReceived)}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', color: signedColor(c.balance) }}>{formatCurrency(c.balance)}</td>
                    </tr>
                    {c.rows.map(cust => (
                      <tr key={cust.customerId}>
                        <td style={{ border: '1px solid #000000', padding: '4px 6px 4px 28px', fontSize: '10px' }}>{cust.customerName}</td>
                        <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.sales }}>{formatCurrency(cust.totalSales)}</td>
                        <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.returns }}>{formatCurrency(cust.saleReturns)}</td>
                        <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.payment }}>{formatCurrency(cust.paymentReceived)}</td>
                        <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace', color: signedColor(cust.balance) }}>{formatCurrency(cust.balance)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </Fragment>
            ))}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>GRAND TOTAL</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.sales }}>{formatCurrency(grandTotals.totalSales)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.returns }}>{formatCurrency(grandTotals.saleReturns)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.payment }}>{formatCurrency(grandTotals.paymentReceived)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline', color: REPORT_COLORS.gold }}>{formatCurrency(grandTotals.balance)}</td>
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
              onClick={() => setGroupMode(mode)}
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
            <SkipZeroToggle value={skipZero} onChange={setSkipZero} />
            <button
              onClick={handleShowPrintPreview}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
            >
              <Eye size={14} /> Show Print Preview
            </button>
          </div>
        </div>

        {/* The report itself: the same document the print preview prints (Product Ledger layout,
            per the user 2026-10-14). Region/City groups are listed fully expanded, as on paper. */}
        <LiveReportDocument loading={loading && !hasLoadedOnce} empty={customerRows.length === 0} emptyMessage="No sales activity found for this period.">
          {renderPrintableDocument()}
        </LiveReportDocument>

      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => { setIsPreviewOpen(false); closePreviewWindow(); }}
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
