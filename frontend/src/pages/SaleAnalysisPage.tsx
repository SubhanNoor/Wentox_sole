import { Fragment, useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { SaleAnalysisRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function SaleAnalysisContent() {
  const [groupMode, setGroupMode] = useState<'customer' | 'region'>('customer');
  const [viewMode, setViewMode] = useState<'overall' | 'month' | 'range'>('overall');
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth());
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());
  const [expandedRegionId, setExpandedRegionId] = useState<number | null>(null);

  const [rows, setRows] = useState<SaleAnalysisRow[]>([]);
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
    const res = await api.reports.saleAnalysis({ date_from: periodStart, date_to: periodEnd });
    if (res.ok) setRows(res.data as SaleAnalysisRow[]);
    setLoading(false);
  }, [periodStart, periodEnd]);

  useEffect(() => { loadRows(); }, [loadRows]);

  // "Payment Received" combines the receipt amount and commission, same as the receipt-level
  // Dr customer BA / Cr COMMISSION_ALLOWED pair both reduce what the customer owes.
  const customerRows = useMemo(() => {
    return rows
      .map(r => ({
        customerId: r.customer_id,
        customerName: r.customer_name,
        regionId: r.region_id,
        regionName: r.region_name,
        totalSales: r.total_sales,
        saleReturns: r.total_returns,
        paymentReceived: r.total_payment + r.total_commission,
        balance: r.total_sales - r.total_returns - (r.total_payment + r.total_commission),
      }))
      .filter(row => row.totalSales > 0 || row.saleReturns > 0 || row.paymentReceived > 0);
  }, [rows]);

  const regionGroups = useMemo(() => {
    const groups: Record<string, { regionId: number | null; regionName: string; customers: typeof customerRows }> = {};
    customerRows.forEach(row => {
      const key = String(row.regionId ?? 'none');
      if (!groups[key]) groups[key] = { regionId: row.regionId, regionName: row.regionName || 'No Region', customers: [] };
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
  }, [customerRows]);

  const grandTotals = useMemo(() => {
    return customerRows.reduce((acc, r) => ({
      totalSales: acc.totalSales + r.totalSales,
      saleReturns: acc.saleReturns + r.saleReturns,
      paymentReceived: acc.paymentReceived + r.paymentReceived,
      balance: acc.balance + r.balance
    }), { totalSales: 0, saleReturns: 0, paymentReceived: 0, balance: 0 });
  }, [customerRows]);

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

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

  const renderPrintableDocument = () => {
    return (
      <div className="excel-print-container">
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '180px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              SALE ANALYSIS REPORT — {groupMode === 'customer' ? 'CUSTOMER WISE' : 'REGION WISE'}
            </h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
              Period: {periodLabel}
            </p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Date of Print: {new Date().toLocaleDateString()}
            </p>
          </div>
        </div>

        <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>
                {groupMode === 'customer' ? 'Customer' : 'Region'}
              </th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Total Sales (Dr)</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Sale Returns (Cr)</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Payment Received</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Net Balance</th>
            </tr>
          </thead>
          <tbody>
            {groupMode === 'customer' ? (
              customerRows.map(c => (
                <tr key={c.customerId}>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', fontWeight: 'bold' }}>{c.customerName}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.totalSales)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.saleReturns)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.paymentReceived)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(c.balance)}</td>
                </tr>
              ))
            ) : (
              regionGroups.map(g => (
                <Fragment key={g.regionId}>
                  <tr style={{ backgroundColor: '#f9f9f9', fontWeight: 'bold' }}>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{g.regionName}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(g.totalSales)}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(g.saleReturns)}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(g.paymentReceived)}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(g.balance)}</td>
                  </tr>
                  {g.customers.map(c => (
                    <tr key={c.customerId}>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px 4px 20px', fontSize: '10.5px' }}>{c.customerName}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.totalSales)}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.saleReturns)}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.paymentReceived)}</td>
                      <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(c.balance)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))
            )}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>GRAND TOTAL</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(grandTotals.totalSales)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(grandTotals.saleReturns)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(grandTotals.paymentReceived)}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{formatCurrency(grandTotals.balance)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', padding: '0 10px' }}>
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
          <div>WENTOX FOOTWEAR DISTRIBUTION</div>
          <div>Printed: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
        </div>
      </div>
    );
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
                ) : (
                  regionGroups.length === 0 ? (
                    <tr><td colSpan={5} className="text-center p-8 text-slate-400">No sales activity found for this period.</td></tr>
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
