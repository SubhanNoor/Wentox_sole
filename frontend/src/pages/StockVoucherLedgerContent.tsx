import { useState, useEffect, useCallback } from 'react';
import { getTodayDate, getThreeMonthsAgoDate, formatDate } from '@/lib/utils';
import SearchableSelect from '@/components/SearchableSelect';
import { Eye } from 'lucide-react';
import * as api from '@/lib/api';
import { exportRowsToExcel } from '@/lib/export';
import type { StockVoucherDetailResult, CategoryRow, StoreRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

// Stock Voucher Ledger — full per-line detail across every posted Stock Voucher (article, color,
// cartons, pairs, rate, D%, value), filterable by date range, store, and article/category. Mirrors
// ProductLedgerContent's own shape (per the user, 2026-08-30: "make one page stock voucher page
// that show the details of the voucher like that [Product Ledger] ... show the color and price
// and cartons each and every detail"), exposed as a Reports Hub sub-page rather than living only
// inside the Stock Voucher entry screen's own "Stock Voucher Ledger" tab (that tab lists vouchers
// by header/totals only — this one lists every LINE).
export default function StockVoucherLedgerContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [storeFilter, setStoreFilter] = useState('all');
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [result, setResult] = useState<StockVoucherDetailResult>({ rows: [], total_cartons: 0, total_pairs: 0, total_value: 0 });
  const [loading, setLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  useEffect(() => {
    api.listCategories().then(r => { if (r.ok) setCategories(r.data); });
    api.listStores().then(r => { if (r.ok) setStores(r.data); });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.stockVoucherDetail({
      category_id: selectedCategory !== 'all' ? Number(selectedCategory) : undefined,
      store_id: storeFilter !== 'all' ? Number(storeFilter) : undefined,
      search: searchQuery.trim() || undefined,
      date_from: fromDate || undefined,
      date_to: toDate || undefined,
    });
    if (res.ok) setResult(res.data);
    setLoading(false);
  }, [selectedCategory, storeFilter, searchQuery, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const handleExportExcel = () => {
    const headers = ['Date', 'Voucher #', 'Store', 'Product Code', 'Article', 'Color', 'Cartons', 'Pairs', 'Rate', 'D%', 'Value'];
    const rows = result.rows.map(r => [
      formatDate(r.voucher_date), `#${r.stock_voucher_id}`, r.store_name || '', r.article_code, r.article_name, r.color,
      r.cartons, r.pairs, r.rate, r.discount_pct, r.value,
    ]);
    exportRowsToExcel('stock-voucher-ledger', headers, rows);
  };

  const renderPrintableDocument = () => {
    return (
      <div className="excel-print-container">
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>STOCK VOUCHER LEDGER REPORT</h2>
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
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Voucher #</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Store</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Code</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Article</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Color</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Cartons</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Pairs</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Rate</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>D%</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map(entry => (
              <tr key={entry.line_id}>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{formatDate(entry.voucher_date)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace' }}>#{entry.stock_voucher_id}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{entry.store_name || '—'}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace', fontWeight: 'bold' }}>{entry.article_code}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontWeight: 'bold' }}>{entry.article_name}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{entry.color}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{entry.cartons}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{entry.pairs.toLocaleString()}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{entry.rate.toFixed(2)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{entry.discount_pct ? `${entry.discount_pct}%` : '-'}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{entry.value.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
              <td colSpan={6} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>REPORT TOTAL</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{result.total_cartons.toLocaleString()}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{result.total_pairs.toLocaleString()}</td>
              <td colSpan={2} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px' }}></td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{result.total_value.toLocaleString()}</td>
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
          <div>Printed: {formatDate(new Date())} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1150 }}>
      {/* Filter Bar - data-no-print */}
      <div className="flex flex-col gap-4 p-4 rounded-xl border mb-6 bg-white shadow-sm" style={{ borderColor: 'var(--border-color)' }} data-no-print>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search by article code, name, or color..."
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
                { value: 'all', label: 'All Stores' },
                ...stores.map(s => ({ value: String(s.store_id), label: s.name }))
              ]}
              value={storeFilter}
              onChange={setStoreFilter}
              placeholder="All Stores"
              searchPlaceholder="Filter store..."
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
            onClick={() => setIsPreviewOpen(true)}
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
                <th className="p-3">Voucher #</th>
                <th className="p-3">Store</th>
                <th className="p-3">Product Code</th>
                <th className="p-3">Article</th>
                <th className="p-3">Color</th>
                <th className="p-3 text-right">Cartons</th>
                <th className="p-3 text-right">Pairs</th>
                <th className="p-3 text-right">Rate</th>
                <th className="p-3 text-right">D%</th>
                <th className="p-3 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="text-center p-8 text-slate-400">Loading…</td></tr>
              ) : result.rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center p-8 text-slate-400">
                    No Stock Voucher lines found matching your filters.
                  </td>
                </tr>
              ) : (
                result.rows.map((entry) => (
                  <tr key={entry.line_id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4 font-mono text-slate-600">{formatDate(entry.voucher_date)}</td>
                    <td className="p-3 font-mono text-slate-500">#{entry.stock_voucher_id}</td>
                    <td className="p-3 text-slate-500">{entry.store_name || '—'}</td>
                    <td className="p-3 font-semibold text-slate-700">{entry.article_code}</td>
                    <td className="p-3 text-slate-700">{entry.article_name}</td>
                    <td className="p-3 text-slate-500">{entry.color}</td>
                    <td className="p-3 text-right font-mono text-slate-700">{entry.cartons}</td>
                    <td className="p-3 text-right font-mono text-slate-700">{entry.pairs.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono text-slate-700">{entry.rate.toFixed(2)}</td>
                    <td className="p-3 text-right font-mono text-slate-700">{entry.discount_pct ? `${entry.discount_pct}%` : '-'}</td>
                    <td className="p-3 text-right font-semibold font-mono text-slate-800">{entry.value.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                <td colSpan={6} className="p-4 text-left font-lora">REPORT TOTAL</td>
                <td className="p-4 text-right font-mono">{result.total_cartons.toLocaleString()}</td>
                <td className="p-4 text-right font-mono">{result.total_pairs.toLocaleString()}</td>
                <td colSpan={2} className="p-4"></td>
                <td className="p-4 text-right font-mono">{result.total_value.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Stock Voucher Ledger Report - Print Preview"
        orientation="portrait"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>
    </div>
  );
}
