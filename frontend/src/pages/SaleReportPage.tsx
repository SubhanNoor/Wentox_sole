import { useState, useMemo, useEffect, useCallback } from 'react';
import SkipZeroToggle, { isZeroBalance } from '@/components/SkipZeroToggle';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate, formatDateTime, formatCartons } from '@/lib/utils';
import { groupByRegion, groupByCity, groupByRegionThenCity } from '@/lib/geoGrouping';
import * as api from '@/lib/api';
import type { SaleReportRow as ApiSaleReportRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { closePreviewWindow } from '@/components/reports/previewWindow';
import LiveReportDocument from '@/components/reports/LiveReportDocument';
import { REPORT_COLORS, signedColor } from '@/components/reports/reportColors';
import { getWindowParam, isChildWindow } from '@/lib/windowParams';
import { useDataVersion } from '@/hooks/useDataVersion';

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
  /** Account balance on the To date (customer's ledger closing figure); a group's is its customers' sum. */
  balance: number;
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
  /** Account balance on the To date (customer's ledger closing figure); a group's is its customers' sum. */
  balance: number;
}

function sumMetrics(rows: Metrics[]): Metrics {
  return rows.reduce((acc, r) => ({
    totalSales: acc.totalSales + r.totalSales,
    totalCartons: acc.totalCartons + r.totalCartons,
    commission: acc.commission + r.commission,
    saleReturn: acc.saleReturn + r.saleReturn,
    netSales: acc.netSales + r.netSales,
    payment: acc.payment + r.payment,
    balance: acc.balance + r.balance,
  }), { totalSales: 0, totalCartons: 0, commission: 0, saleReturn: 0, netSales: 0, payment: 0, balance: 0 });
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
    balance: r.balance,
    totalJv: r.total_jv,
  };
}

export function SaleReportContent() {
  // Re-runs the loads below when another window saves something (live update, 2026-10-15).
  const dataVersion = useDataVersion();
  const [groupMode, setGroupMode] = useState<GroupMode>(() => (getWindowParam('groupMode') as GroupMode) || 'overall');
  const [viewMode, setViewMode] = useState<'overall' | 'month' | 'range'>(() => (getWindowParam('viewMode') as 'overall' | 'month' | 'range') || 'overall');
  const [filterMonth, setFilterMonth] = useState(() => { const p = getWindowParam('filterMonth'); return p != null ? Number(p) : new Date().getMonth(); });
  const [filterYear, setFilterYear] = useState(() => { const p = getWindowParam('filterYear'); return p != null ? Number(p) : new Date().getFullYear(); });
  const [fromDate, setFromDate] = useState(() => getWindowParam('fromDate') || getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(() => getWindowParam('toDate') || getTodayDate());

  const [allCustomerRows, setCustomerRows] = useState<SaleReportRow[]>([]);
  const [skipZero, setSkipZero] = useState(() => getWindowParam('skipZero') === '1');
  const customerRows = useMemo(
    () => (skipZero ? allCustomerRows.filter(r => !isZeroBalance(r.balance)) : allCustomerRows),
    [allCustomerRows, skipZero],
  );
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
    const res = await api.reports.saleReport({ date_from: periodStart, date_to: periodEnd });
    if (res.ok) setCustomerRows((res.data as ApiSaleReportRow[]).map(mapRow)
      // Idle customers still carrying a balance stay listed (per the user, 2026-10-14).
      .filter(r => r.totalSales > 0 || r.saleReturn > 0 || r.payment > 0 || !isZeroBalance(r.balance)));
    setLoading(false);
    setHasLoadedOnce(true);
  }, [periodStart, periodEnd]);

  useEffect(() => { loadRows(); }, [loadRows, dataVersion]);

  // "Show Print Preview" opens a new window on this same filtered/grouped report (per the user,
  // 2026-09-03), instead of an in-page overlay.
  const handleShowPrintPreview = () => {
    api.openWindow('reports', 'sale-report', {
      groupMode, viewMode, filterMonth: String(filterMonth), filterYear: String(filterYear),
      fromDate, toDate, skipZero: skipZero ? '1' : '0', autoPreview: '1',
    });
  };

  // Opened via another window's "Show Print Preview" — go straight into the preview once loaded.
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && hasLoadedOnce) setIsPreviewOpen(true);
  }, [hasLoadedOnce]);

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
    const headers = [COLUMN_LABELS[groupMode], 'Total Sales', 'Total Cartons', 'Commission', 'Sale Return', 'Net Sales', 'Payment', 'Balance'];
    let rows: (string | number)[][];
    if (groupMode === 'overall') {
      rows = [[overallRow.label, overallRow.totalSales, formatCartons(overallRow.totalCartons), overallRow.commission, overallRow.saleReturn, overallRow.netSales, overallRow.payment, overallRow.balance]];
    } else if (groupMode === 'customer') {
      rows = customerRows.map(r => [r.label, r.totalSales, formatCartons(r.totalCartons), r.commission, r.saleReturn, r.netSales, r.payment, r.balance]);
    } else if (groupMode === 'region') {
      rows = regionGroups.flatMap(g => [
        [g.name, g.totalSales, formatCartons(g.totalCartons), g.commission, g.saleReturn, g.netSales, g.payment, g.balance],
        ...g.rows.map(c => [`  ${c.label}`, c.totalSales, formatCartons(c.totalCartons), c.commission, c.saleReturn, c.netSales, c.payment, c.balance])
      ]);
    } else if (groupMode === 'city') {
      rows = cityGroups.flatMap(g => [
        [g.name, g.totalSales, formatCartons(g.totalCartons), g.commission, g.saleReturn, g.netSales, g.payment, g.balance],
        ...g.rows.map(c => [`  ${c.label}`, c.totalSales, formatCartons(c.totalCartons), c.commission, c.saleReturn, c.netSales, c.payment, c.balance])
      ]);
    } else {
      rows = regionCityGroups.flatMap(g => [
        [g.name, g.totalSales, formatCartons(g.totalCartons), g.commission, g.saleReturn, g.netSales, g.payment, g.balance],
        ...g.cities.flatMap(c => [
          [`  ${c.name}`, c.totalSales, formatCartons(c.totalCartons), c.commission, c.saleReturn, c.netSales, c.payment, c.balance],
          ...c.rows.map(cust => [`    ${cust.label}`, cust.totalSales, formatCartons(cust.totalCartons), cust.commission, cust.saleReturn, cust.netSales, cust.payment, cust.balance])
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
        { key: `region-${g.id}`, label: g.name, regionId: g.id, regionName: g.name, cityId: null, cityName: null, totalSales: g.totalSales, totalCartons: g.totalCartons, commission: g.commission, saleReturn: g.saleReturn, netSales: g.netSales, payment: g.payment, balance: g.balance, bold: true },
        ...g.rows.map(c => ({ ...c, key: `customer-${c.key}`, indent: 1 })),
      ]);
    } else if (groupMode === 'city') {
      displayRows = cityGroups.flatMap(g => [
        { key: `city-${g.id}`, label: g.name, regionId: null, regionName: null, cityId: g.id, cityName: g.name, totalSales: g.totalSales, totalCartons: g.totalCartons, commission: g.commission, saleReturn: g.saleReturn, netSales: g.netSales, payment: g.payment, balance: g.balance, bold: true },
        ...g.rows.map(c => ({ ...c, key: `customer-${c.key}`, indent: 1 })),
      ]);
    } else {
      displayRows = regionCityGroups.flatMap(g => [
        { key: `region-${g.id}`, label: g.name, regionId: g.id, regionName: g.name, cityId: null, cityName: null, totalSales: g.totalSales, totalCartons: g.totalCartons, commission: g.commission, saleReturn: g.saleReturn, netSales: g.netSales, payment: g.payment, balance: g.balance, bold: true },
        ...g.cities.flatMap(c => [
          { key: `city-${g.id}-${c.id}`, label: c.name, regionId: null, regionName: null, cityId: c.id, cityName: c.name, totalSales: c.totalSales, totalCartons: c.totalCartons, commission: c.commission, saleReturn: c.saleReturn, netSales: c.netSales, payment: c.payment, balance: c.balance, bold: true, indent: 1 },
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
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map(r => (
              <tr key={r.key} style={{ fontWeight: r.bold ? 'bold' : 'normal', backgroundColor: r.bold ? '#f9f9f9' : '#ffffff' }}>
                <td style={{ border: '1px solid #000000', padding: r.indent ? `4px 6px 4px ${6 + r.indent * 14}px` : '5px 6px', fontSize: r.indent ? '10.5px' : '11px' }}>{r.label}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.text }}>{formatCurrency(r.totalSales)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.text }}>{formatCartons(r.totalCartons)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.commission }}>{formatCurrency(r.commission)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.returns }}>{formatCurrency(r.saleReturn)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: REPORT_COLORS.gold }}>{formatCurrency(r.netSales)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.payment }}>{formatCurrency(r.payment)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: signedColor(r.balance) }}>{formatCurrency(r.balance)}</td>
              </tr>
            ))}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>GRAND TOTAL</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.text }}>{formatCurrency(totals.totalSales)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.text }}>{formatCartons(totals.totalCartons)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.commission }}>{formatCurrency(totals.commission)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.returns }}>{formatCurrency(totals.saleReturn)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline', color: REPORT_COLORS.gold }}>{formatCurrency(totals.netSales)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.payment }}>{formatCurrency(totals.payment)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline', color: REPORT_COLORS.gold }}>{formatCurrency(totals.balance)}</td>
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
