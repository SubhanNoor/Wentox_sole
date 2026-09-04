import { useState, useEffect, useCallback } from 'react';
import { getTodayDate, getThreeMonthsAgoDate, formatDate, formatDateTime } from '@/lib/utils';
import SearchableSelect from '@/components/SearchableSelect';
import { Eye } from 'lucide-react';
import * as api from '@/lib/api';
import { exportRowsToExcel } from '@/lib/export';
import type { ProductLedgerResult, CategoryRow, VendorRow, StockMovementType } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { getWindowParam, isChildWindow } from '@/lib/windowParams';

const MOVEMENT_TYPE_LABEL: Record<StockMovementType, string> = {
  PRODUCTION: 'Production',
  SALE: 'Sale',
  SALE_RETURN: 'Sale Return',
  OPENING: 'Opening',
  ADJUSTMENT: 'Adjustment',
};

// Standalone Product Ledger — full pairs IN/OUT history per article, filterable by date range,
// vendor, and article/category. This is the same report embedded as a tab inside the Stock page,
// exposed here as its own report for the unified Reports hub.
export default function ProductLedgerContent() {
  const [searchQuery, setSearchQuery] = useState(() => getWindowParam('searchQuery') || '');
  const [selectedCategory, setSelectedCategory] = useState(() => getWindowParam('selectedCategory') || 'all');
  const [fromDate, setFromDate] = useState(() => getWindowParam('fromDate') || getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(() => getWindowParam('toDate') || getTodayDate());
  const [vendorFilter, setVendorFilter] = useState(() => getWindowParam('vendorFilter') || 'all');

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [result, setResult] = useState<ProductLedgerResult>({ rows: [], total_in: 0, total_out: 0, net: 0 });
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  useEffect(() => {
    api.listCategories().then(r => { if (r.ok) setCategories(r.data); });
    api.listVendors({ includeSystem: true })  /* read-only filter: every article belongs to the system vendor */.then(r => { if (r.ok) setVendors(r.data); });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.productLedger({
      category_id: selectedCategory !== 'all' ? Number(selectedCategory) : undefined,
      vendor_id: vendorFilter !== 'all' ? Number(vendorFilter) : undefined,
      search: searchQuery.trim() || undefined,
      date_from: fromDate || undefined,
      date_to: toDate || undefined,
    });
    if (res.ok) setResult(res.data);
    setLoading(false);
    setHasLoadedOnce(true);
  }, [selectedCategory, vendorFilter, searchQuery, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  // "Show Print Preview" opens a new window on this same filtered ledger (per the user,
  // 2026-09-03), instead of an in-page overlay.
  const handleShowPrintPreview = () => {
    api.openWindow('reports', 'product-ledger', {
      searchQuery, selectedCategory, vendorFilter, fromDate, toDate, autoPreview: '1',
    });
  };

  // Opened via another window's "Show Print Preview" — go straight into the preview once loaded.
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && hasLoadedOnce) setIsPreviewOpen(true);
  }, [hasLoadedOnce]);

  const handleExportExcel = () => {
    const headers = ['Date', 'Product Code', 'Article', 'Color', 'Vendor', 'Type', 'Ref #', 'Debit (IN)', 'Credit (OUT)'];
    const rows = result.rows.map(r => [formatDate(r.movement_date), r.article_code, r.article_name, r.color, r.vendor_name || '', MOVEMENT_TYPE_LABEL[r.movement_type], `#${r.movement_id}`, r.debit, r.credit]);
    exportRowsToExcel('product-ledger', headers, rows);
  };

  const renderPrintableDocument = () => {
    return (
      <div className="excel-print-container">
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>PRODUCT LEDGER REPORT</h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
              Period: {fromDate ? formatDate(fromDate) : 'Start'} to {toDate ? formatDate(toDate) : 'End'}
            </p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Date of Print: {formatDate(new Date())}
            </p>
          </div>
        </div>

        <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Date</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Code</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Article</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Color</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Vendor</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Type</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Ref #</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Debit (IN)</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Credit (OUT)</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map(entry => (
              <tr key={entry.movement_id}>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{formatDate(entry.movement_date)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace', fontWeight: 'bold' }}>{entry.article_code}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontWeight: 'bold' }}>{entry.article_name}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{entry.color}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{entry.vendor_name || '—'}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{MOVEMENT_TYPE_LABEL[entry.movement_type]}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>#{entry.movement_id}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: '#047857' }}>{entry.debit > 0 ? entry.debit : '-'}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: '#e11d48' }}>{entry.credit > 0 ? `(${entry.credit})` : '-'}</td>
              </tr>
            ))}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
              <td colSpan={7} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>REPORT TOTAL</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: '#047857' }}>{result.total_in.toLocaleString()}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline', color: '#e11d48' }}>({result.total_out.toLocaleString()})</td>
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
      {/* Filter Bar - data-no-print */}
      <div className="flex flex-col gap-4 p-4 rounded-xl border mb-6 bg-white shadow-sm" style={{ borderColor: 'var(--border-color)' }} data-no-print>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search by article code or name..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="soleria-input py-2 text-sm flex-1 min-w-[200px]"
          />
          <div className="w-48">
            <SearchableSelect
              options={[
                { value: 'all', label: 'All Categories' },
                ...categories.map(cat => ({ value: String(cat.category_id), label: cat.name }))
              ]}
              value={selectedCategory}
              onChange={setSelectedCategory}
              placeholder="All Categories"
              searchPlaceholder="Filter category..."
            />
          </div>
          <div className="w-48">
            <SearchableSelect
              options={[
                { value: 'all', label: 'All Vendors' },
                ...vendors.map(v => ({ value: String(v.vendor_id), label: v.name }))
              ]}
              value={vendorFilter}
              onChange={setVendorFilter}
              placeholder="All Vendors"
              searchPlaceholder="Filter vendor..."
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">From:</label>
              <input type="date"
            value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1.5 px-3 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
              <input type="date"
            value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1.5 px-3 text-sm" />
            </div>
          </div>
          <button
            onClick={handleShowPrintPreview}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
          >
            <Eye size={14} /> Show Print Preview
          </button>
        </div>
      </div>

      <div className="card-white p-6 md:p-8 bg-white border">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                <th className="p-3 pl-4">Date</th>
                <th className="p-3">Product Code</th>
                <th className="p-3">Article</th>
                <th className="p-3">Color</th>
                <th className="p-3">Vendor</th>
                <th className="p-3">Type</th>
                <th className="p-3">Ref</th>
                <th className="p-3 text-right">Debit (IN)</th>
                <th className="p-3 text-right">Credit (OUT)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center p-8 text-slate-400">Loading…</td></tr>
              ) : result.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center p-8 text-slate-400">
                    No product ledger movements found matching your filters.
                  </td>
                </tr>
              ) : (
                result.rows.map((entry) => (
                  <tr key={entry.movement_id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4 font-mono text-slate-600">{formatDate(entry.movement_date)}</td>
                    <td className="p-3 font-semibold text-slate-700">{entry.article_code}</td>
                    <td className="p-3 text-slate-700">{entry.article_name}</td>
                    <td className="p-3 text-slate-500">{entry.color}</td>
                    <td className="p-3 text-slate-500">{entry.vendor_name || '—'}</td>
                    <td className="p-3">
                      <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                        entry.movement_type === 'PRODUCTION' ? 'bg-emerald-50 text-emerald-700' :
                        entry.movement_type === 'SALE' ? 'bg-rose-50 text-rose-700' :
                        entry.movement_type === 'SALE_RETURN' ? 'bg-blue-50 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {MOVEMENT_TYPE_LABEL[entry.movement_type]}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500">#{entry.movement_id}</td>
                    <td className="p-3 text-right font-semibold text-emerald-700">{entry.debit > 0 ? entry.debit : '-'}</td>
                    <td className="p-3 text-right font-semibold text-rose-700">{entry.credit > 0 ? `(${entry.credit})` : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                <td colSpan={7} className="p-4 text-left font-lora">REPORT TOTAL</td>
                <td className="p-4 text-right text-emerald-800">{result.total_in.toLocaleString()}</td>
                <td className="p-4 text-right text-rose-800">({result.total_out.toLocaleString()})</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Product Ledger Report - Print Preview"
        orientation="portrait"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>
    </div>
  );
}
