import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import SkipZeroToggle, { isZeroBalance } from '@/components/SkipZeroToggle';
import { getTodayDate, getThreeMonthsAgoDate, getWeekStartDate, formatDate, formatDateTime } from '@/lib/utils';
import SearchableSelect from '@/components/SearchableSelect';
import { Eye } from 'lucide-react';
import * as api from '@/lib/api';
import { exportRowsToExcel } from '@/lib/export';
import type { ProductLedgerResult, ProductLedgerRow, CategoryRow, VendorRow, StockMovementType } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { closePreviewWindow } from '@/components/reports/previewWindow';
import { getWindowParam, isChildWindow } from '@/lib/windowParams';
import { useDataVersion } from '@/hooks/useDataVersion';

const MOVEMENT_TYPE_LABEL: Record<StockMovementType, string> = {
  PRODUCTION: 'Production',
  SALE: 'Sale',
  SALE_RETURN: 'Sale Return',
  OPENING: 'Opening',
  ADJUSTMENT: 'Adjustment',
};

type ViewMode = 'summary' | 'detailed';

const EMPTY_RESULT: ProductLedgerResult = {
  rows: [], total_in: 0, total_out: 0, net: 0, products: [], product_totals: { opening: 0, in: 0, out: 0, balance: 0 },
};

// Pairs as the report prints them: negatives in brackets, zero as a dash.
const qty = (n: number) => (n === 0 ? '-' : n < 0 ? `(${Math.abs(n).toLocaleString()})` : n.toLocaleString());

const TH: React.CSSProperties = { border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' };
const TH_R: React.CSSProperties = { ...TH, textAlign: 'right' };
const TD: React.CSSProperties = { border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' };
const TD_NUM: React.CSSProperties = { ...TD, textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' };
const IN_COLOR = '#047857';
const OUT_COLOR = '#e11d48';
const balanceColor = (n: number) => (n < 0 ? OUT_COLOR : '#111111');

// Standalone Product Ledger, for the unified Reports hub (the Stock page has its own movement-list
// tab over the same data). Per the client (2026-10-12), Summary shows ONE line per product+colour:
// Opening (stock before From), In, Out, and Balance = stock on the To date. Detailed groups every
// movement under its product+colour with a running balance. The screen shows the same document the
// print preview prints, so there's one layout to maintain.
export default function ProductLedgerContent() {
  // Re-runs the loads below when another window saves something (live update, 2026-10-15).
  const dataVersion = useDataVersion();
  const [searchQuery, setSearchQuery] = useState(() => getWindowParam('searchQuery') || '');
  const [selectedCategory, setSelectedCategory] = useState(() => getWindowParam('selectedCategory') || 'all');
  const [fromDate, setFromDate] = useState(() => getWindowParam('fromDate') || getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(() => getWindowParam('toDate') || getTodayDate());
  const [vendorFilter, setVendorFilter] = useState(() => getWindowParam('vendorFilter') || 'all');
  const [viewMode, setViewMode] = useState<ViewMode>(() => (getWindowParam('viewMode') as ViewMode) || 'summary');

  // G-03 (changes-14-09-26.md): mounts fresh whenever this Reports Hub tab becomes active, so a
  // mount-only effect covers both "page opens here" and "user switches to this tab".
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { requestAnimationFrame(() => searchRef.current?.focus()); }, []);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [result, setResult] = useState<ProductLedgerResult>(EMPTY_RESULT);
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

  useEffect(() => { load(); }, [load, dataVersion]);

  // Period radios (client request, 2026-10-12; radios rather than a button so it can be switched
  // back off, per the user 2026-10-13): This Week = Monday to today. Switching back to Date Range
  // restores the dates that were there before, and editing a date while on This Week also switches
  // back, since the range is then no longer "this week".
  const [periodMode, setPeriodMode] = useState<'range' | 'week'>(() =>
    getWindowParam('fromDate') === getWeekStartDate() && getWindowParam('toDate') === getTodayDate() ? 'week' : 'range');
  const savedRangeRef = useRef<{ from: string; to: string } | null>(null);
  const choosePeriod = (mode: 'range' | 'week') => {
    if (mode === periodMode) return;
    if (mode === 'week') {
      savedRangeRef.current = { from: fromDate, to: toDate };
      setFromDate(getWeekStartDate());
      setToDate(getTodayDate());
    } else if (savedRangeRef.current) {
      setFromDate(savedRangeRef.current.from);
      setToDate(savedRangeRef.current.to);
    }
    setPeriodMode(mode);
  };
  const editDate = (set: (v: string) => void, value: string) => {
    set(value);
    setPeriodMode('range');
  };

  // "Show Print Preview" opens a new window on this same filtered ledger (per the user,
  // 2026-09-03), instead of an in-page overlay.
  const handleShowPrintPreview = () => {
    api.openWindow('reports', 'product-ledger', {
      searchQuery, selectedCategory, vendorFilter, fromDate, toDate, viewMode, skipZero: skipZero ? '1' : '0', autoPreview: '1',
    });
  };

  // Opened via another window's "Show Print Preview" — go straight into the preview once loaded.
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && hasLoadedOnce) setIsPreviewOpen(true);
  }, [hasLoadedOnce]);

  // "Skip Zero Balances" (per the user, 2026-10-14): leaves out product+colour lines whose stock on
  // the To date is zero. Totals are recomputed from the lines still shown.
  const [skipZero, setSkipZero] = useState(() => getWindowParam('skipZero') === '1');
  const { products, productTotals } = useMemo(() => {
    if (!skipZero) return { products: result.products, productTotals: result.product_totals };
    const list = result.products.filter(p => !isZeroBalance(p.balance));
    const totals = list.reduce((t, p) => ({
      opening: t.opening + p.opening, in: t.in + p.in, out: t.out + p.out, balance: t.balance + p.balance,
    }), { opening: 0, in: 0, out: 0, balance: 0 });
    return { products: list, productTotals: totals };
  }, [result.products, result.product_totals, skipZero]);

  // Movements grouped under their product+colour, in the same order as the summary lines.
  const rowsByVariant = useMemo(() => {
    const map = new Map<number, ProductLedgerRow[]>();
    for (const r of result.rows) {
      const list = map.get(r.variant_id);
      if (list) list.push(r); else map.set(r.variant_id, [r]);
    }
    return map;
  }, [result.rows]);

  const handleExportExcel = () => {
    if (viewMode === 'summary') {
      const headers = ['Product Code', 'Article', 'Color', 'Vendor', 'Opening', 'In', 'Out', 'Balance'];
      const rows = products.map(p => [p.article_code, p.article_name, p.color, p.vendor_name || '', p.opening, p.in, p.out, p.balance]);
      const t = productTotals;
      rows.push(['TOTAL', '', '', '', t.opening, t.in, t.out, t.balance]);
      exportRowsToExcel('product-ledger-summary', headers, rows);
      return;
    }
    const headers = ['Product Code', 'Article', 'Color', 'Date', 'Type', 'Ref #', 'In', 'Out', 'Balance'];
    const rows: (string | number)[][] = [];
    for (const p of products) {
      rows.push([p.article_code, p.article_name, p.color, '', 'Opening Stock', '', '', '', p.opening]);
      for (const r of rowsByVariant.get(p.variant_id) ?? []) {
        rows.push([p.article_code, p.article_name, p.color, formatDate(r.movement_date), MOVEMENT_TYPE_LABEL[r.movement_type], `#${r.movement_id}`, r.debit, r.credit, r.running_balance]);
      }
      rows.push([p.article_code, p.article_name, p.color, '', 'Total', '', p.in, p.out, p.balance]);
    }
    exportRowsToExcel('product-ledger-detailed', headers, rows);
  };

  const renderSummaryTable = () => {
    const t = productTotals;
    return (
      <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
        <thead>
          <tr>
            <th style={TH}>Code</th>
            <th style={TH}>Article</th>
            <th style={TH}>Color</th>
            <th style={TH}>Vendor</th>
            <th style={TH_R}>Opening</th>
            <th style={TH_R}>In</th>
            <th style={TH_R}>Out</th>
            <th style={TH_R}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {products.map(p => (
            <tr key={p.variant_id}>
              <td style={{ ...TD, fontFamily: 'monospace', fontWeight: 'bold' }}>{p.article_code}</td>
              <td style={{ ...TD, fontWeight: 'bold' }}>{p.article_name}</td>
              <td style={TD}>{p.color}</td>
              <td style={TD}>{p.vendor_name || '—'}</td>
              <td style={{ ...TD_NUM, color: balanceColor(p.opening) }}>{qty(p.opening)}</td>
              <td style={{ ...TD_NUM, color: IN_COLOR }}>{qty(p.in)}</td>
              <td style={{ ...TD_NUM, color: OUT_COLOR }}>{p.out > 0 ? `(${p.out.toLocaleString()})` : '-'}</td>
              <td style={{ ...TD_NUM, color: balanceColor(p.balance) }}>{qty(p.balance)}</td>
            </tr>
          ))}
          <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
            <td colSpan={4} style={{ ...TH, textAlign: 'left' }}>REPORT TOTAL</td>
            <td style={{ ...TH_R, fontFamily: 'monospace', color: balanceColor(t.opening) }}>{qty(t.opening)}</td>
            <td style={{ ...TH_R, fontFamily: 'monospace', color: IN_COLOR }}>{qty(t.in)}</td>
            <td style={{ ...TH_R, fontFamily: 'monospace', color: OUT_COLOR }}>{t.out > 0 ? `(${t.out.toLocaleString()})` : '-'}</td>
            <td style={{ ...TH_R, fontFamily: 'monospace', color: balanceColor(t.balance), textDecoration: 'underline' }}>{qty(t.balance)}</td>
          </tr>
        </tbody>
      </table>
    );
  };

  const renderDetailedTable = () => {
    const t = productTotals;
    return (
      <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
        <thead>
          <tr>
            <th style={TH}>Date</th>
            <th style={TH}>Type</th>
            <th style={TH}>Ref #</th>
            <th style={TH_R}>In</th>
            <th style={TH_R}>Out</th>
            <th style={TH_R}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {products.map(p => (
            <Fragment key={p.variant_id}>
              <tr>
                <td colSpan={6} style={{ ...TD, backgroundColor: '#f8f8f8', fontWeight: 'bold', fontSize: '11px' }}>
                  <span style={{ fontFamily: 'monospace' }}>{p.article_code}</span> — {p.article_name} · {p.color}
                  {p.vendor_name ? <span style={{ fontWeight: 'normal', color: '#555555' }}> · {p.vendor_name}</span> : null}
                </td>
              </tr>
              <tr>
                <td style={TD}>{fromDate ? formatDate(fromDate) : ''}</td>
                <td colSpan={4} style={{ ...TD, fontStyle: 'italic' }}>Opening Stock</td>
                <td style={{ ...TD_NUM, color: balanceColor(p.opening) }}>{qty(p.opening)}</td>
              </tr>
              {(rowsByVariant.get(p.variant_id) ?? []).map(r => (
                <tr key={r.movement_id}>
                  <td style={TD}>{formatDate(r.movement_date)}</td>
                  <td style={TD}>{MOVEMENT_TYPE_LABEL[r.movement_type]}</td>
                  <td style={TD}>#{r.movement_id}</td>
                  <td style={{ ...TD_NUM, color: IN_COLOR }}>{r.debit > 0 ? r.debit.toLocaleString() : '-'}</td>
                  <td style={{ ...TD_NUM, color: OUT_COLOR }}>{r.credit > 0 ? `(${r.credit.toLocaleString()})` : '-'}</td>
                  <td style={{ ...TD_NUM, color: balanceColor(r.running_balance) }}>{qty(r.running_balance)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 'bold' }}>
                <td colSpan={3} style={{ ...TD, fontWeight: 'bold' }}>Total {p.article_code} · {p.color}</td>
                <td style={{ ...TD_NUM, color: IN_COLOR }}>{qty(p.in)}</td>
                <td style={{ ...TD_NUM, color: OUT_COLOR }}>{p.out > 0 ? `(${p.out.toLocaleString()})` : '-'}</td>
                <td style={{ ...TD_NUM, color: balanceColor(p.balance) }}>{qty(p.balance)}</td>
              </tr>
            </Fragment>
          ))}
          <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
            <td colSpan={3} style={{ ...TH, textAlign: 'left' }}>REPORT TOTAL</td>
            <td style={{ ...TH_R, fontFamily: 'monospace', color: IN_COLOR }}>{qty(t.in)}</td>
            <td style={{ ...TH_R, fontFamily: 'monospace', color: OUT_COLOR }}>{t.out > 0 ? `(${t.out.toLocaleString()})` : '-'}</td>
            <td style={{ ...TH_R, fontFamily: 'monospace', color: balanceColor(t.balance), textDecoration: 'underline' }}>{qty(t.balance)}</td>
          </tr>
        </tbody>
      </table>
    );
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
              PRODUCT LEDGER REPORT{viewMode === 'detailed' ? ' — DETAILED' : ''}
            </h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
              Period: {fromDate ? formatDate(fromDate) : 'Start'} to {toDate ? formatDate(toDate) : 'End'}
            </p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Date of Print: {formatDate(new Date())}
            </p>
          </div>
        </div>

        {viewMode === 'summary' ? renderSummaryTable() : renderDetailedTable()}

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

  const toggleBtn = (mode: ViewMode, label: string) => (
    <button
      type="button"
      onClick={() => setViewMode(mode)}
      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${viewMode === mode ? 'bg-[var(--brand-navy)] text-white' : 'text-slate-600 hover:bg-slate-100'}`}
      aria-pressed={viewMode === mode}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto" style={{ maxWidth: 1100 }}>
      {/* Filter Bar - data-no-print */}
      <div className="flex flex-col gap-4 p-4 rounded-xl border mb-6 bg-white shadow-sm" style={{ borderColor: 'var(--border-color)' }} data-no-print>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={searchRef}
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
            value={fromDate} onChange={e => editDate(setFromDate, e.target.value)} className="soleria-input py-1.5 px-3 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
              <input type="date"
            value={toDate} onChange={e => editDate(setToDate, e.target.value)} className="soleria-input py-1.5 px-3 text-sm" />
            </div>
            <div className="flex items-center gap-4 select-none" role="radiogroup" aria-label="Period">
              {([['range', 'Date Range'], ['week', 'This Week']] as const).map(([mode, label]) => (
                <label
                  key={mode}
                  title={mode === 'week' ? 'Monday of this week to today' : 'Use the From and To dates'}
                  className={`flex items-center gap-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                    periodMode === mode ? 'text-slate-800' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="product-ledger-period"
                    checked={periodMode === mode}
                    onChange={() => choosePeriod(mode)}
                    className="cursor-pointer"
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-xl border p-0.5" style={{ borderColor: 'var(--border-color)' }} role="group" aria-label="View">
              {toggleBtn('summary', 'Summary')}
              {toggleBtn('detailed', 'Detailed')}
            </div>
            <SkipZeroToggle value={skipZero} onChange={setSkipZero} />
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
        {loading && !hasLoadedOnce ? (
          <div className="text-center p-8 text-slate-400">Loading…</div>
        ) : products.length === 0 ? (
          <div className="text-center p-8 text-slate-400">No stock or movements found matching your filters.</div>
        ) : (
          <div className="overflow-x-auto">{renderPrintableDocument()}</div>
        )}
      </div>

      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => { setIsPreviewOpen(false); closePreviewWindow(); }}
        title="Product Ledger Report - Print Preview"
        orientation="portrait"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>
    </div>
  );
}
