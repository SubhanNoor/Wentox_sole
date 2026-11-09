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

// A movement's Type, by the document that made it — a sale bill's unpost is an ADJUSTMENT row but
// still the sale bill's doing. Anything without a document falls back to its movement type.
const SOURCE_LABEL: Record<string, string> = {
  STOCK_VOUCHER: 'Stock Voucher',
  SALE_BILL: 'Sale Bill',
  DRAFT_SALE_BILL: 'Sale Bill (draft)',
  SALE_RETURN: 'Sale Return',
  DRAFT_SALE_RETURN: 'Sale Return (draft)',
};
const movementLabel = (r: ProductLedgerRow) => (r.source_type && SOURCE_LABEL[r.source_type]) || MOVEMENT_TYPE_LABEL[r.movement_type];

type ViewMode = 'summary' | 'detailed';
type Unit = 'pairs' | 'cartons';

const EMPTY_TOTALS = { opening: 0, in: 0, returned: 0, total_stock: 0, out: 0, balance: 0 };
type QtyField = keyof typeof EMPTY_TOTALS;
const QTY_FIELDS = Object.keys(EMPTY_TOTALS) as QtyField[];

const EMPTY_RESULT: ProductLedgerResult = {
  rows: [], total_in: 0, total_out: 0, net: 0, products: [], product_totals: EMPTY_TOTALS,
};

// Pairs as the report prints them: negatives in brackets, zero as a dash.
const qty = (n: number) => (n === 0 ? '-' : n < 0 ? `(${Math.abs(n).toLocaleString()})` : n.toLocaleString());

// Cartons as a decimal (per the user 2026-11-09): pairs / packing, to two places because a single
// pair is under a tenth of a carton at the usual packing of 12. Whole cartons print without decimals.
const toCartons = (n: number, packing: number) => n / (packing > 0 ? packing : 1);
const roundCartons = (n: number) => Math.round(n * 100) / 100;
const cartonQty = (n: number) => {
  const r = roundCartons(n);
  if (r === 0) return n === 0 ? '-' : '0';
  const text = Math.abs(r).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return r < 0 ? `(${text})` : text;
};

const TH: React.CSSProperties = { border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' };
const TH_R: React.CSSProperties = { ...TH, textAlign: 'right' };
const TD: React.CSSProperties = { border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' };
const TD_NUM: React.CSSProperties = { ...TD, textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' };
const IN_COLOR = '#047857';
const OUT_COLOR = '#e11d48';
const RETURN_COLOR = '#b45309';
const balanceColor = (n: number) => (n < 0 ? OUT_COLOR : '#111111');

// Standalone Product Ledger, for the unified Reports hub (the Stock page has its own movement-list
// tab over the same data). Per the client (2026-10-12), Summary shows ONE line per product+colour:
// Opening Stock (before From), In (stock vouchers), Return (sale returns), Total Stock, Out (sale
// bills) and Balance = Total Stock - Out = stock on the To date (columns 2026-11-08, after the
// client's old software); Pairs or Cartons (decimal). Detailed groups every
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
  const [unit, setUnit] = useState<Unit>(() => (getWindowParam('unit') as Unit) || 'pairs');
  // One quantity as the chosen unit shows it; `packing` is that product+colour's own.
  const show = (n: number, packing: number) => (unit === 'pairs' ? qty(n) : cartonQty(toCartons(n, packing)));

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
      searchQuery, selectedCategory, vendorFilter, fromDate, toDate, viewMode, unit, skipZero: skipZero ? '1' : '0', autoPreview: '1',
    });
  };

  // Opened via another window's "Show Print Preview" — go straight into the preview once loaded.
  // Not inside a Stock & Production Center window (it carries activeStockTab): that window's
  // autoPreview was for its own tab, and would otherwise pop this one open on switching to it.
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && !getWindowParam('activeStockTab') && hasLoadedOnce) setIsPreviewOpen(true);
  }, [hasLoadedOnce]);

  // "Skip Zero Balances" (per the user, 2026-10-14): leaves out product+colour lines whose stock on
  // the To date is zero. Totals are recomputed from the lines still shown.
  const [skipZero, setSkipZero] = useState(() => getWindowParam('skipZero') === '1');
  const products = useMemo(
    () => (skipZero ? result.products.filter(p => !isZeroBalance(p.balance)) : result.products),
    [result.products, skipZero],
  );
  // Report totals from the lines shown, in both units. Each line converts at its own packing, so
  // cartons are added up from the lines rather than converted from the pair total.
  const { pairTotals, cartonTotals } = useMemo(() => {
    const pairTotals = { ...EMPTY_TOTALS };
    const cartonTotals = { ...EMPTY_TOTALS };
    for (const p of products) {
      for (const f of QTY_FIELDS) {
        pairTotals[f] += p[f];
        cartonTotals[f] += toCartons(p[f], p.packing);
      }
    }
    return { pairTotals, cartonTotals };
  }, [products]);
  const showTotal = (f: QtyField) => (unit === 'pairs' ? qty(pairTotals[f]) : cartonQty(cartonTotals[f]));
  // A movement's quantity in its own column, signed as that column counts it: Out counts pairs that
  // left, so a sale bill's unpost (pairs put back) shows there in brackets.
  const bucketQty = (r: ProductLedgerRow) => (r.bucket === 'OUT' ? -r.qty_pairs : r.qty_pairs);

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
    const cell = (n: number, packing: number) => (unit === 'pairs' ? n : roundCartons(toCartons(n, packing)));
    const totalCell = (f: QtyField) => (unit === 'pairs' ? pairTotals[f] : roundCartons(cartonTotals[f]));
    const unitLabel = unit === 'pairs' ? 'Pairs' : 'Cartons';
    if (viewMode === 'summary') {
      const headers = ['Product Code', 'Article', 'Color', 'Vendor', `Opening Stock (${unitLabel})`, 'In', 'Return', 'Total Stock', 'Out', 'Balance'];
      const rows: (string | number)[][] = products.map(p => [
        p.article_code, p.article_name, p.color, p.vendor_name || '',
        ...QTY_FIELDS.map(f => cell(p[f], p.packing)),
      ]);
      rows.push(['TOTAL', '', '', '', ...QTY_FIELDS.map(totalCell)]);
      exportRowsToExcel('product-ledger-summary', headers, rows);
      return;
    }
    const headers = ['Product Code', 'Article', 'Color', 'Date', 'Type', 'Ref #', `In (${unitLabel})`, 'Return', 'Out', 'Balance'];
    const rows: (string | number)[][] = [];
    for (const p of products) {
      rows.push([p.article_code, p.article_name, p.color, '', 'Opening Stock', '', '', '', '', cell(p.opening, p.packing)]);
      for (const r of rowsByVariant.get(p.variant_id) ?? []) {
        const at = (b: ProductLedgerRow['bucket']) => (r.bucket === b ? cell(bucketQty(r), p.packing) : '');
        rows.push([p.article_code, p.article_name, p.color, formatDate(r.movement_date), movementLabel(r), `#${r.movement_id}`,
          at('IN'), at('RETURN'), at('OUT'), cell(r.running_balance, p.packing)]);
      }
      rows.push([p.article_code, p.article_name, p.color, '', 'Total', '',
        cell(p.in, p.packing), cell(p.returned, p.packing), cell(p.out, p.packing), cell(p.balance, p.packing)]);
    }
    exportRowsToExcel('product-ledger-detailed', headers, rows);
  };

  const renderSummaryTable = () => (
    <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
      <thead>
        <tr>
          <th style={TH}>Code</th>
          <th style={TH}>Article</th>
          <th style={TH}>Color</th>
          <th style={TH}>Vendor</th>
          <th style={TH_R}>Opening Stock</th>
          <th style={TH_R}>In</th>
          <th style={TH_R}>Return</th>
          <th style={TH_R}>Total Stock</th>
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
            <td style={{ ...TD_NUM, color: balanceColor(p.opening) }}>{show(p.opening, p.packing)}</td>
            <td style={{ ...TD_NUM, color: IN_COLOR }}>{show(p.in, p.packing)}</td>
            <td style={{ ...TD_NUM, color: RETURN_COLOR }}>{show(p.returned, p.packing)}</td>
            <td style={{ ...TD_NUM, color: balanceColor(p.total_stock) }}>{show(p.total_stock, p.packing)}</td>
            <td style={{ ...TD_NUM, color: OUT_COLOR }}>{show(p.out, p.packing)}</td>
            <td style={{ ...TD_NUM, color: balanceColor(p.balance) }}>{show(p.balance, p.packing)}</td>
          </tr>
        ))}
        <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
          <td colSpan={4} style={{ ...TH, textAlign: 'left' }}>REPORT TOTAL</td>
          <td style={{ ...TH_R, fontFamily: 'monospace', color: balanceColor(pairTotals.opening) }}>{showTotal('opening')}</td>
          <td style={{ ...TH_R, fontFamily: 'monospace', color: IN_COLOR }}>{showTotal('in')}</td>
          <td style={{ ...TH_R, fontFamily: 'monospace', color: RETURN_COLOR }}>{showTotal('returned')}</td>
          <td style={{ ...TH_R, fontFamily: 'monospace', color: balanceColor(pairTotals.total_stock) }}>{showTotal('total_stock')}</td>
          <td style={{ ...TH_R, fontFamily: 'monospace', color: OUT_COLOR }}>{showTotal('out')}</td>
          <td style={{ ...TH_R, fontFamily: 'monospace', color: balanceColor(pairTotals.balance), textDecoration: 'underline' }}>{showTotal('balance')}</td>
        </tr>
      </tbody>
    </table>
  );

  const renderDetailedTable = () => (
    <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
      <thead>
        <tr>
          <th style={TH}>Date</th>
          <th style={TH}>Type</th>
          <th style={TH}>Ref #</th>
          <th style={TH_R}>In</th>
          <th style={TH_R}>Return</th>
          <th style={TH_R}>Out</th>
          <th style={TH_R}>Balance</th>
        </tr>
      </thead>
      <tbody>
        {products.map(p => (
          <Fragment key={p.variant_id}>
            <tr>
              <td colSpan={7} style={{ ...TD, backgroundColor: '#f8f8f8', fontWeight: 'bold', fontSize: '11px' }}>
                <span style={{ fontFamily: 'monospace' }}>{p.article_code}</span> — {p.article_name} · {p.color}
                {p.vendor_name ? <span style={{ fontWeight: 'normal', color: '#555555' }}> · {p.vendor_name}</span> : null}
              </td>
            </tr>
            <tr>
              <td style={TD}>{fromDate ? formatDate(fromDate) : ''}</td>
              <td colSpan={5} style={{ ...TD, fontStyle: 'italic' }}>Opening Stock</td>
              <td style={{ ...TD_NUM, color: balanceColor(p.opening) }}>{show(p.opening, p.packing)}</td>
            </tr>
            {(rowsByVariant.get(p.variant_id) ?? []).map(r => (
              <tr key={r.movement_id}>
                <td style={TD}>{formatDate(r.movement_date)}</td>
                <td style={TD}>{movementLabel(r)}</td>
                <td style={TD}>#{r.movement_id}</td>
                <td style={{ ...TD_NUM, color: IN_COLOR }}>{r.bucket === 'IN' ? show(bucketQty(r), p.packing) : '-'}</td>
                <td style={{ ...TD_NUM, color: RETURN_COLOR }}>{r.bucket === 'RETURN' ? show(bucketQty(r), p.packing) : '-'}</td>
                <td style={{ ...TD_NUM, color: OUT_COLOR }}>{r.bucket === 'OUT' ? show(bucketQty(r), p.packing) : '-'}</td>
                <td style={{ ...TD_NUM, color: balanceColor(r.running_balance) }}>{show(r.running_balance, p.packing)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold' }}>
              <td colSpan={3} style={{ ...TD, fontWeight: 'bold' }}>Total {p.article_code} · {p.color}</td>
              <td style={{ ...TD_NUM, color: IN_COLOR }}>{show(p.in, p.packing)}</td>
              <td style={{ ...TD_NUM, color: RETURN_COLOR }}>{show(p.returned, p.packing)}</td>
              <td style={{ ...TD_NUM, color: OUT_COLOR }}>{show(p.out, p.packing)}</td>
              <td style={{ ...TD_NUM, color: balanceColor(p.balance) }}>{show(p.balance, p.packing)}</td>
            </tr>
          </Fragment>
        ))}
        <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
          <td colSpan={3} style={{ ...TH, textAlign: 'left' }}>REPORT TOTAL</td>
          <td style={{ ...TH_R, fontFamily: 'monospace', color: IN_COLOR }}>{showTotal('in')}</td>
          <td style={{ ...TH_R, fontFamily: 'monospace', color: RETURN_COLOR }}>{showTotal('returned')}</td>
          <td style={{ ...TH_R, fontFamily: 'monospace', color: OUT_COLOR }}>{showTotal('out')}</td>
          <td style={{ ...TH_R, fontFamily: 'monospace', color: balanceColor(pairTotals.balance), textDecoration: 'underline' }}>{showTotal('balance')}</td>
        </tr>
      </tbody>
    </table>
  );

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
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', fontWeight: 'bold', color: '#111111' }}>
              Quantities in {unit === 'pairs' ? 'pairs' : 'cartons'}
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

  const toggleBtn = <T extends string>(current: T, set: (v: T) => void, value: T, label: string) => (
    <button
      type="button"
      onClick={() => set(value)}
      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${current === value ? 'bg-[var(--brand-navy)] text-white' : 'text-slate-600 hover:bg-slate-100'}`}
      aria-pressed={current === value}
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
              {toggleBtn(viewMode, setViewMode, 'summary', 'Summary')}
              {toggleBtn(viewMode, setViewMode, 'detailed', 'Detailed')}
            </div>
            <div className="flex items-center gap-1 rounded-xl border p-0.5" style={{ borderColor: 'var(--border-color)' }} role="group" aria-label="Unit">
              {toggleBtn(unit, setUnit, 'pairs', 'Pairs')}
              {toggleBtn(unit, setUnit, 'cartons', 'Cartons')}
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
