import { useState, useMemo, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { Search, X, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate, formatDateTime, formatCartons } from '@/lib/utils';
import * as api from '@/lib/api';
import type { StockRow, VendorStockRow, ProductLedgerResult, StockMovementRow, StockMovementType, CategoryRow, VendorRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { closePreviewWindow } from '@/components/reports/previewWindow';
import LiveReportDocument from '@/components/reports/LiveReportDocument';
import { REPORT_COLORS } from '@/components/reports/reportColors';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';
import { getWindowParam, shouldAutoPreview, isChildWindow } from '@/lib/windowParams';
import { useDataVersion } from '@/hooks/useDataVersion';

const MOVEMENT_TYPE_LABEL: Record<StockMovementType, string> = {
  PRODUCTION: 'Production',
  SALE: 'Sale',
  SALE_RETURN: 'Sale Return',
  OPENING: 'Opening',
  ADJUSTMENT: 'Adjustment',
};

// Date range calculation helpers
const getWeekRange = (dateStr: string) => {
  const date = new Date(dateStr);
  const day = date.getDay();
  // Adjust Monday as start of week
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
};

const getMonthName = (m: number): string => {
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return names[m];
};

const iso = (d: Date) => d.toISOString().split('T')[0];

export default function ReportStockPage() {
  // Re-runs the loads below when another window saves something (live update, 2026-10-15).
  const dataVersion = useDataVersion();
  type StockTab = 'current' | 'material' | 'ledger' | 'daily' | 'weekly' | 'monthly' | 'overall';
  // Seeded from the URL when this window was opened by another window's "Show Print Preview"
  // (openWindow's `params`, per the user, 2026-09-03) so it lands on the exact same filtered
  // report instead of the defaults below.
  const [activeStockTab, setActiveStockTab] = useState<StockTab>(() => (getWindowParam('activeStockTab') as StockTab) || 'current');
  const [tabAnimating, setTabAnimating] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const switchStockTab = (next: StockTab) => {
    if (next === activeStockTab) return;
    setTabAnimating(true);
    setTimeout(() => {
      setActiveStockTab(next);
      setTabAnimating(false);
    }, 180);
  };

  const [materialVendorFilter, setMaterialVendorFilter] = useState(() => getWindowParam('materialVendorFilter') || 'all');
  const [searchQuery, setSearchQuery] = useState(() => getWindowParam('searchQuery') || '');
  const [selectedCategory, setSelectedCategory] = useState(() => getWindowParam('selectedCategory') || 'all');

  // Real lookups
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);

  // Real report data, fetched per-tab
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [vendorStockRows, setVendorStockRows] = useState<VendorStockRow[]>([]);
  const [ledgerResult, setLedgerResult] = useState<ProductLedgerResult>({ rows: [], total_in: 0, total_out: 0, net: 0, products: [], product_totals: { opening: 0, in: 0, out: 0, balance: 0 } });
  const [productionRows, setProductionRows] = useState<StockMovementRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Tabs whose data has arrived at least once: only their FIRST load shows "Loading…". A refresh
  // (filters, or another window saving) keeps the report up, so it doesn't flash or lose its scroll.
  const [loadedTabs, setLoadedTabs] = useState<StockTab[]>([]);
  const markLoaded = (...tabs: StockTab[]) => setLoadedTabs(t => (tabs.every(x => t.includes(x)) ? t : [...new Set([...t, ...tabs])]));
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  useEffect(() => {
    api.listCategories().then(r => { if (r.ok) setCategories(r.data); });
    api.listVendors().then(r => { if (r.ok) setVendors(r.data); });
  }, []);

  // Material stock adjustment modal state — DEDUCT only (stock:reduce-vendor-stock is the only
  // real backend operation; the demo's ADD direction had no backend equivalent and was dropped).
  const [materialAdjModal, setMaterialAdjModal] = useState<{
    vendorId: number;
    vendorName: string;
    materialId: number;
    materialName: string;
    unit: string;
    currentQty: number;
  } | null>(null);
  const [materialAdjQty, setMaterialAdjQty] = useState('');
  const [materialAdjError, setMaterialAdjError] = useState('');

  // G-07 (changes-14-09-26.md): Escape closes the topmost dialog — these build their own inline
  // modals rather than going through a shared component, so each needs its own hook call.
  useEscapeToClose(materialAdjModal != null, () => setMaterialAdjModal(null));

  async function handleSaveMaterialAdjustment() {
    if (!materialAdjModal) return;
    const qty = Number(materialAdjQty);
    if (isNaN(qty) || qty <= 0) {
      setMaterialAdjError('Quantity must be greater than 0.');
      return;
    }
    if (materialAdjModal.currentQty - qty < 0) {
      setMaterialAdjError(`Total stock after reduction cannot be less than 0. Maximum allowed reduction is ${materialAdjModal.currentQty.toLocaleString()} ${materialAdjModal.unit}.`);
      return;
    }

    const res = await api.stock.reduceVendorStock({
      vendor_id: materialAdjModal.vendorId,
      material_id: materialAdjModal.materialId,
      unit: materialAdjModal.unit,
      qty,
      movement_date: getTodayDate(),
    });
    if (!res.ok) {
      setMaterialAdjError(res.error.message);
      return;
    }

    setMaterialAdjModal(null);
    setMaterialAdjQty('');
    setMaterialAdjError('');
    flash('Material stock reduced.');
    loadVendorStock();
  }

  // Production log filtering states
  const [dailyDate, setDailyDate] = useState(() => getWindowParam('dailyDate') || new Date().toISOString().split('T')[0]);
  const [weeklyDate, setWeeklyDate] = useState(() => getWindowParam('weeklyDate') || new Date().toISOString().split('T')[0]);
  const [monthlyMonth, setMonthlyMonth] = useState(() => { const p = getWindowParam('monthlyMonth'); return p != null ? Number(p) : new Date().getMonth(); });
  const [monthlyYear, setMonthlyYear] = useState(() => { const p = getWindowParam('monthlyYear'); return p != null ? Number(p) : new Date().getFullYear(); });
  const [fromDate, setFromDate] = useState(() => getWindowParam('fromDate') || getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(() => getWindowParam('toDate') || getTodayDate());
  // Current Stock and Material Stock show stock "as on" this date (per the user, 2026-10-15).
  const [asOfDate, setAsOfDate] = useState(() => getWindowParam('asOfDate') || getTodayDate());

  // Product Ledger tab filtering state
  const [ledgerFromDate, setLedgerFromDate] = useState(() => getWindowParam('ledgerFromDate') || getThreeMonthsAgoDate());
  const [ledgerToDate, setLedgerToDate] = useState(() => getWindowParam('ledgerToDate') || getTodayDate());
  const [ledgerVendorFilter, setLedgerVendorFilter] = useState(() => getWindowParam('ledgerVendorFilter') || 'all');

  const categoryIdParam = selectedCategory !== 'all' ? Number(selectedCategory) : undefined;

  // ── Current Stock ──
  const loadStock = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.stock({ category_id: categoryIdParam, as_of_date: asOfDate || undefined });
    if (res.ok) setStockRows(res.data); else fail(res.error.message);
    setLoading(false);
    markLoaded('current');
  }, [categoryIdParam, asOfDate]);

  useEffect(() => { if (activeStockTab === 'current') loadStock(); }, [activeStockTab, loadStock, dataVersion]);

  // Current Stock is the "Full Report" colour matrix (per the user, 2026-10-14): one row per article,
  // every colour's cartons/loose pairs on the same line, then the article's totals. It replaced the
  // old click-to-expand article list and the separate Full Report popup.
  const groupedArticles = useMemo(() => {
    const groups: Record<number, { articleId: number; commonName: string; categoryName: string; packing: number; rows: StockRow[] }> = {};
    stockRows.forEach(r => {
      if (!groups[r.article_id]) {
        groups[r.article_id] = { articleId: r.article_id, commonName: r.article_name, categoryName: r.category_name, packing: r.effective_packing, rows: [] };
      }
      groups[r.article_id].rows.push(r);
    });
    return Object.values(groups).sort((a, b) => a.commonName.localeCompare(b.commonName, undefined, { numeric: true }));
  }, [stockRows]);

  const allColorReportRows = useMemo(() => {
    return groupedArticles.map(group => {
      const byColor: Record<string, { cartons: number; extraPairs: number }> = {};
      group.rows.forEach(r => { byColor[r.color] = { cartons: r.cartons, extraPairs: r.extra_pairs }; });
      const totalPairs = group.rows.reduce((sum, r) => sum + r.total_pairs, 0);
      // Article-level cartons/pairs total (per the user, 2026-09-26): the same cartons/loose-pairs
      // shape every colour cell uses, but summed across all of the article's colours. A colour's
      // loose extra_pairs summed across colours can add up to whole cartons, so we RE-NORMALISE
      // against the article's packing rather than just summing cartons and extra_pairs — that's
      // what "not full carton like it is for each colour" means. Safe because packing
      // (effective_packing = COALESCE(article_colors.packing, articles.packing)) is uniform across
      // a single article's colours in the data (verified: 0 of 104 articles mix packing); the
      // `packing > 0` guard falls back to a plain sum if that ever stops being true.
      const packing = group.rows[0]?.effective_packing ?? 0;
      const totalCartons = packing > 0 ? Math.floor(totalPairs / packing) : group.rows.reduce((sum, r) => sum + r.cartons, 0);
      const totalLoosePairs = packing > 0 ? totalPairs % packing : group.rows.reduce((sum, r) => sum + r.extra_pairs, 0);
      return { articleId: group.articleId, commonName: group.commonName, categoryName: group.categoryName, byColor, totalPairs, totalCartons, totalLoosePairs, packing };
    });
  }, [groupedArticles]);

  // Search (the Full Report's, per the user 2026-09-18): article name, category, or a color the
  // article actually HAS stock in ("black" -> articles carrying black), case-insensitive.
  const colorReportRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allColorReportRows;
    return allColorReportRows.filter(r =>
      String(r.commonName ?? '').toLowerCase().includes(q)
      || String(r.categoryName ?? '').toLowerCase().includes(q)
      || Object.entries(r.byColor).some(([color, c]) =>
        color.toLowerCase().includes(q) && !!c && (c.cartons > 0 || c.extraPairs > 0)),
    );
  }, [allColorReportRows, searchQuery]);

  // One column per distinct colour across the articles listed.
  const allColorsAcrossArticles = useMemo(() => {
    return Array.from(new Set(colorReportRows.flatMap(r => Object.keys(r.byColor)))).sort((a, b) => a.localeCompare(b));
  }, [colorReportRows]);

  const colorReportTotalPairs = useMemo(() => colorReportRows.reduce((sum, r) => sum + r.totalPairs, 0), [colorReportRows]);
  // Report total in cartons (per the user, 2026-10-08): each article's loose pairs are folded in
  // as a fraction of that article's own carton (totalPairs / packing), so the total can be a
  // decimal like 3,806.5. Rows keep their Ctn/Prs shape; only this total changes. Total Pairs
  // stays the exact figure.
  const colorReportTotalCartons = useMemo(() => {
    const ctn = colorReportRows.reduce((sum, r) => sum + (r.packing > 0 ? r.totalPairs / r.packing : r.totalCartons), 0);
    return `${ctn.toLocaleString(undefined, { maximumFractionDigits: 2 })} Ctn`;
  }, [colorReportRows]);

  // ── Material Stock ──
  const loadVendorStock = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.vendorStock({ as_of_date: asOfDate || undefined });
    if (res.ok) setVendorStockRows(res.data); else fail(res.error.message);
    setLoading(false);
    markLoaded('material');
  }, [asOfDate]);

  useEffect(() => { if (activeStockTab === 'material') loadVendorStock(); }, [activeStockTab, loadVendorStock, dataVersion]);

  const materialStockRows = useMemo(() => {
    let rows = vendorStockRows;
    if (materialVendorFilter !== 'all') {
      rows = rows.filter(r => String(r.vendor_id) === materialVendorFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter(r => r.material_name.toLowerCase().includes(q));
    }
    return rows;
  }, [vendorStockRows, materialVendorFilter, searchQuery]);

  // ── Product Ledger ──
  const loadLedger = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.productLedger({
      category_id: categoryIdParam,
      vendor_id: ledgerVendorFilter !== 'all' ? Number(ledgerVendorFilter) : undefined,
      search: searchQuery.trim() || undefined,
      date_from: ledgerFromDate || undefined,
      date_to: ledgerToDate || undefined,
    });
    if (res.ok) setLedgerResult(res.data); else fail(res.error.message);
    setLoading(false);
    markLoaded('ledger');
  }, [categoryIdParam, ledgerVendorFilter, searchQuery, ledgerFromDate, ledgerToDate]);

  useEffect(() => { if (activeStockTab === 'ledger') loadLedger(); }, [activeStockTab, loadLedger, dataVersion]);

  // ── Production (daily/weekly/monthly/overall) ──
  // The page's own week/month picker computes an explicit date_from/date_to — backend's `range`
  // param only covers "from today"/"from the 1st", not an arbitrary picked period.
  const productionDateRange = useMemo((): { date_from?: string; date_to?: string } => {
    if (activeStockTab === 'daily') return { date_from: dailyDate, date_to: dailyDate };
    if (activeStockTab === 'weekly') {
      const { start, end } = getWeekRange(weeklyDate);
      return { date_from: iso(start), date_to: iso(end) };
    }
    if (activeStockTab === 'monthly') {
      const from = new Date(monthlyYear, monthlyMonth, 1);
      const to = new Date(monthlyYear, monthlyMonth + 1, 0);
      return { date_from: iso(from), date_to: iso(to) };
    }
    if (activeStockTab === 'overall') return { date_from: fromDate || undefined, date_to: toDate || undefined };
    return {};
  }, [activeStockTab, dailyDate, weeklyDate, monthlyMonth, monthlyYear, fromDate, toDate]);

  const loadProduction = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.production({
      category_id: categoryIdParam,
      search: searchQuery.trim() || undefined,
      ...productionDateRange,
    });
    if (res.ok) setProductionRows(res.data); else fail(res.error.message);
    setLoading(false);
    markLoaded('daily', 'weekly', 'monthly', 'overall');
  }, [categoryIdParam, searchQuery, productionDateRange]);

  useEffect(() => {
    if (activeStockTab === 'daily' || activeStockTab === 'weekly' || activeStockTab === 'monthly' || activeStockTab === 'overall') {
      loadProduction();
    }
  }, [activeStockTab, loadProduction, dataVersion]);

  const filteredLogs = productionRows;

  const totalProductionCartons = useMemo(() => filteredLogs.reduce((sum, log) => sum + (log.input_unit === 'CARTONS' ? (log.input_qty || 0) : 0), 0), [filteredLogs]);
  const totalProductionPairsDirect = useMemo(() => filteredLogs.reduce((sum, log) => sum + (log.input_unit === 'PAIRS' ? (log.input_qty || 0) : 0), 0), [filteredLogs]);
  const totalProductionPairs = useMemo(() => filteredLogs.reduce((sum, log) => sum + log.qty_pairs, 0), [filteredLogs]);

  const handleExportExcel = () => {
    if (activeStockTab === 'current') {
      const headers = ['Article', 'Category', ...allColorsAcrossArticles.map(c => `${c} (Ctn/Prs)`), 'Total (Ctn/Prs)', 'Total Pairs'];
      const rows = colorReportRows.map(r => [
        r.commonName, r.categoryName,
        ...allColorsAcrossArticles.map(c => `${r.byColor[c]?.cartons ?? 0}/${r.byColor[c]?.extraPairs ?? 0}`),
        `${r.totalCartons}/${r.totalLoosePairs}`,
        r.totalPairs
      ]);
      exportRowsToExcel('current-stock-full-report', headers, rows);
    } else if (activeStockTab === 'material') {
      const headers = ['Vendor', 'Material', 'Unit', 'Purchased', 'Returned', 'Current Stock'];
      const rows = materialStockRows.map(r => [r.vendor_name, r.material_name, r.unit, r.purchased_qty, r.returned_qty, r.on_hand]);
      exportRowsToExcel('material-stock', headers, rows);
    } else if (activeStockTab === 'ledger') {
      const headers = ['Date', 'Article', 'Color', 'Vendor', 'Type', 'Ref', 'Debit (IN)', 'Credit (OUT)', 'Balance'];
      const rows = ledgerResult.rows.map(e => [e.movement_date, e.article_name, e.color, e.vendor_name || '', MOVEMENT_TYPE_LABEL[e.movement_type], e.movement_id, e.debit, e.credit, e.running_balance]);
      exportRowsToExcel('product-ledger', headers, rows);
    } else {
      const headers = ['Date', 'Article Name', 'Color', 'Category', 'Packing', 'Qty Added', 'Unit', 'Total Pairs'];
      const rows = filteredLogs.map(log => [log.movement_date, log.article_name, log.color, log.category_name, log.packing ?? '', log.input_qty == null ? '' : formatCartons(log.input_qty), log.input_unit ?? '', log.qty_pairs]);
      exportRowsToExcel(`production-${activeStockTab}`, headers, rows);
    }
  };

  // "Show Print Preview" opens a new window landing on this same report, pre-filtered exactly as
  // shown here (per the user, 2026-09-03) — behaving like the app's other "open in new window"
  // child windows, rather than an in-page overlay. Only the filters relevant to the active tab are
  // carried, matching what that tab's own renderPrintableDocument() branch actually reads.
  const handleShowPrintPreview = () => {
    const params: Record<string, string> = { activeStockTab, selectedCategory, searchQuery, autoPreview: '1' };
    if (activeStockTab === 'current' || activeStockTab === 'material') params.asOfDate = asOfDate;
    if (activeStockTab === 'material') {
      params.materialVendorFilter = materialVendorFilter;
    } else if (activeStockTab === 'ledger') {
      params.ledgerFromDate = ledgerFromDate;
      params.ledgerToDate = ledgerToDate;
      params.ledgerVendorFilter = ledgerVendorFilter;
    } else if (activeStockTab === 'daily') {
      params.dailyDate = dailyDate;
    } else if (activeStockTab === 'weekly') {
      params.weeklyDate = weeklyDate;
    } else if (activeStockTab === 'monthly') {
      params.monthlyMonth = String(monthlyMonth);
      params.monthlyYear = String(monthlyYear);
    } else if (activeStockTab === 'overall') {
      params.fromDate = fromDate;
      params.toDate = toDate;
    }
    api.openWindow('report-stock', undefined, params);
  };

  // Opened via another window's "Show Print Preview" — go straight into the preview instead of
  // landing on the plain report first.
  useEffect(() => {
    if (isChildWindow() && shouldAutoPreview()) setIsPreviewOpen(true);
  }, []);

  const reportOrientation: 'portrait' | 'landscape' = useMemo(() => {
    if (activeStockTab === 'current' && allColorsAcrossArticles.length > 3) {
      return 'landscape';
    }
    return 'portrait';
  }, [activeStockTab, allColorsAcrossArticles.length]);

  const renderPrintableDocument = () => {
    let reportTitle = 'CURRENT FINISHED STOCK - FULL COLOR MATRIX REPORT';
    if (activeStockTab === 'material') reportTitle = 'RAW MATERIAL INVENTORY REPORT';
    else if (activeStockTab === 'ledger') reportTitle = 'PRODUCT MOVEMENT LEDGER';
    else if (activeStockTab === 'daily') reportTitle = `DAILY PRODUCTION LOG (${formatDate(dailyDate)})`;
    else if (activeStockTab === 'weekly') reportTitle = 'WEEKLY PRODUCTION REPORT';
    else if (activeStockTab === 'monthly') reportTitle = `MONTHLY PRODUCTION REPORT (${getMonthName(monthlyMonth)} ${monthlyYear})`;
    else if (activeStockTab === 'overall') reportTitle = 'CUMULATIVE OVERALL PRODUCTION REPORT';

    return (
      <div className="excel-print-container">
        {/* Header Section with Prominent 180px Logo */}
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>{reportTitle}</h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
              Category: {selectedCategory === 'all' ? 'All Categories' : categories.find(c => String(c.category_id) === selectedCategory)?.name}
            </p>
            {(activeStockTab === 'current' || activeStockTab === 'material') && (
              <p style={{ margin: '3px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
                Stock as on: {asOfDate ? formatDate(asOfDate) : formatDate(new Date())}
              </p>
            )}
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Date of Print: {formatDate(new Date())}
            </p>
          </div>
        </div>

        {/* Current Stock Full Color Matrix Report Table */}
        {activeStockTab === 'current' && (
          <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '10.5px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Article</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '10.5px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Category</th>
                {allColorsAcrossArticles.map(c => (
                  <th key={c} style={{ border: '1px solid #000000', padding: '6px', fontSize: '10.5px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>{c}</th>
                ))}
                {/* Total (Ctn/Prs): the article's whole stock in the same cartons/loose-pairs shape
                    the colour cells use, summed across every colour (per the user, 2026-09-26). */}
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '10.5px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Total (Ctn/Prs)</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '10.5px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Total Pairs</th>
              </tr>
            </thead>
            <tbody>
              {colorReportRows.map(row => (
                <tr key={row.articleId}>
                  <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', fontWeight: 'bold' }}>{row.commonName}</td>
                  <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px', color: REPORT_COLORS.muted }}>{row.categoryName}</td>
                  {allColorsAcrossArticles.map(c => {
                    const st = row.byColor[c];
                    // Colours the article has stock in stand out; 0/0 cells are greyed, as on the old Full Report.
                    const has = !!st && (st.cartons > 0 || st.extraPairs > 0);
                    return (
                      <td key={c} style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px', textAlign: 'center', fontFamily: 'monospace', color: has ? REPORT_COLORS.text : REPORT_COLORS.faint, fontWeight: has ? 'bold' : 'normal' }}>
                        {st ? st.cartons : 0}/{st ? st.extraPairs : 0}
                      </td>
                    );
                  })}
                  <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{`${row.totalCartons}/${row.totalLoosePairs}`}</td>
                  <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: row.totalPairs <= 0 ? REPORT_COLORS.negative : REPORT_COLORS.text }}>{row.totalPairs.toLocaleString()}</td>
                </tr>
              ))}
              <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f9f9f9' }}>
                <td colSpan={2 + allColorsAcrossArticles.length} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>TOTAL PAIRS ACROSS ALL ARTICLES & COLORS</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{colorReportTotalCartons}</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline', color: REPORT_COLORS.gold }}>{colorReportTotalPairs.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        )}

        {/* Material Stock Table */}
        {activeStockTab === 'material' && (
          <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Vendor</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Material Name</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Unit</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Available Stock</th>
              </tr>
            </thead>
            <tbody>
              {materialStockRows.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ border: '1px solid #000000', padding: '10px', fontSize: '11px', textAlign: 'center', color: '#666666' }}>
                    No raw materials match the selected filter.
                  </td>
                </tr>
              ) : (
                materialStockRows.map(row => (
                  <tr key={`${row.vendor_id}-${row.material_name}`}>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', fontWeight: 'bold' }}>{row.vendor_name}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', fontWeight: 'bold' }}>{row.material_name}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{row.unit}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{row.on_hand.toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {/* Product Ledger Table */}
        {activeStockTab === 'ledger' && (
          <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center', width: '5%' }}>S#</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '10%' }}>Date</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '18%' }}>Article</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '10%' }}>Color</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '14%' }}>Vendor</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '10%' }}>Type</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '9%' }}>Ref</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right', width: '9%' }}>Debit (IN)</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right', width: '9%' }}>Credit (OUT)</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right', width: '9%' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledgerResult.rows.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ border: '1px solid #000000', padding: '10px', fontSize: '11px', textAlign: 'center', color: '#666666' }}>
                    No product ledger movements found matching your filters.
                  </td>
                </tr>
              ) : (
                ledgerResult.rows.map((e, idx) => (
                  <tr key={e.movement_id}>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'center', fontFamily: 'monospace' }}>{idx + 1}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace' }}>{formatDate(e.movement_date)}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', fontWeight: 'bold' }}>{e.article_name}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', color: REPORT_COLORS.muted }}>{e.color}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', color: REPORT_COLORS.muted }}>{e.vendor_name || '—'}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', fontWeight: 'bold' }}>{MOVEMENT_TYPE_LABEL[e.movement_type]}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace' }}>#{e.movement_id}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: '#047857' }}>{e.debit > 0 ? e.debit : '-'}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: '#e11d48' }}>{e.credit > 0 ? `(${e.credit})` : '-'}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: e.running_balance < 0 ? '#e11d48' : '#111111' }}>{e.running_balance < 0 ? `(${Math.abs(e.running_balance).toLocaleString()})` : e.running_balance.toLocaleString()}</td>
                  </tr>
                ))
              )}
              <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f9f9f9' }}>
                <td colSpan={8} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>REPORT TOTAL</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: '#047857' }}>{ledgerResult.total_in.toLocaleString()}</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: '#e11d48' }}>({ledgerResult.total_out.toLocaleString()})</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }} title="Total stock of the listed products on the To date">{ledgerResult.product_totals.balance < 0 ? `(${Math.abs(ledgerResult.product_totals.balance).toLocaleString()})` : ledgerResult.product_totals.balance.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        )}

        {/* Production Logs Table */}
        {(activeStockTab === 'daily' || activeStockTab === 'weekly' || activeStockTab === 'monthly' || activeStockTab === 'overall') && (
          <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center', width: '5%' }}>S#</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '12%' }}>Date</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '23%' }}>Article Description</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '10%' }}>Color</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '12%' }}>Category</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center', width: '8%' }}>Packing</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right', width: '8%' }}>Qty</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', width: '8%' }}>Unit</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right', width: '10%' }}>Total Pairs</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ border: '1px solid #000000', padding: '10px', fontSize: '11px', textAlign: 'center', color: '#666666' }}>
                    No production records found for the selected criteria.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log, idx) => (
                  <tr key={log.movement_id}>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'center', fontFamily: 'monospace' }}>{idx + 1}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace' }}>{formatDate(log.movement_date)}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', fontWeight: 'bold' }}>{log.article_name}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', color: REPORT_COLORS.muted }}>{log.color}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', color: REPORT_COLORS.muted }}>{log.category_name}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'center', fontFamily: 'monospace' }}>{log.packing}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCartons(log.input_qty)}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textTransform: 'capitalize', color: REPORT_COLORS.muted }}>{log.input_unit?.toLowerCase()}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{log.qty_pairs.toLocaleString()}</td>
                  </tr>
                ))
              )}
              <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f9f9f9' }}>
                <td colSpan={7} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>PRODUCTION TOTAL</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {totalProductionCartons > 0 && `${formatCartons(totalProductionCartons)} ctn`}
                  {totalProductionCartons > 0 && totalProductionPairsDirect > 0 && ' + '}
                  {totalProductionPairsDirect > 0 && `${totalProductionPairsDirect} prs`}
                  {totalProductionCartons === 0 && totalProductionPairsDirect === 0 && '-'}
                </td>
                <td style={{ border: '1px solid #000000', padding: '6px' }}></td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline', color: REPORT_COLORS.gold }}>{totalProductionPairs.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        )}

        {/* Signatures */}
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

  // Sub-tab switcher — lives in the top header bar next to the page title (AppLayout's
  // headerAction slot), same treatment as Sale Bill/Receipts/Expenses/Cheque/Reports/etc.
  const tabBar = (
    <div className="flex flex-wrap gap-1.5" data-no-print>
      <button
        onClick={() => switchStockTab('current')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all whitespace-nowrap ${
          activeStockTab === 'current'
            ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        Current Stock
      </button>
      <button
        onClick={() => switchStockTab('material')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all whitespace-nowrap ${
          activeStockTab === 'material'
            ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        Material Stock
      </button>
      <button
        onClick={() => switchStockTab('ledger')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all whitespace-nowrap ${
          activeStockTab === 'ledger'
            ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        Product Ledger
      </button>
      <button
        onClick={() => switchStockTab('daily')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all whitespace-nowrap ${
          activeStockTab === 'daily'
            ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        Daily Production
      </button>
      <button
        onClick={() => switchStockTab('weekly')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all whitespace-nowrap ${
          activeStockTab === 'weekly'
            ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        Weekly Production
      </button>
      <button
        onClick={() => switchStockTab('monthly')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all whitespace-nowrap ${
          activeStockTab === 'monthly'
            ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        Monthly Production
      </button>
      <button
        onClick={() => switchStockTab('overall')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all whitespace-nowrap ${
          activeStockTab === 'overall'
            ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        Overall Production
      </button>
    </div>
  );

  return (
    <AppLayout pageTitle="Stock & Production Center" headerAction={tabBar}>
      <div className="mx-auto" style={{ maxWidth: 1000 }}>

        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>}

        {/* On-screen View - hidden on print */}
        <div data-no-print className={`transition-all duration-200 ${tabAnimating ? 'opacity-0 translate-y-2' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`}>
          {/* Search and Filters */}
          <div className="p-3 rounded-lg border mb-4 bg-white shadow-sm" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              {/* Left Side: Search */}
              <div className="relative w-56 md:w-64 shrink-0">
                <Search className="absolute left-3 top-2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder={activeStockTab === 'current' ? 'Search article, category or color...' : 'Search by article code or name...'}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input pl-9 py-1.5 w-full text-xs font-semibold"
                />
              </div>

              {/* Right Side: As On (stock tabs), Category Filter, Show Print Preview */}
              <div className="flex flex-wrap items-center gap-2.5 ml-auto">
                {(activeStockTab === 'current' || activeStockTab === 'material') && (
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">As on:</label>
                    <input
                      type="date"
                      value={asOfDate}
                      onChange={e => setAsOfDate(e.target.value)}
                      className="soleria-input py-1.5 px-3 text-xs font-semibold"
                    />
                  </div>
                )}
                <div className="w-44 shrink-0">
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


                <button
                  onClick={handleShowPrintPreview}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs shrink-0"
                >
                  <Eye size={14} /> Show Print Preview
                </button>
              </div>
            </div>

            {/* Timeframe Filters based on Active Tab */}
            {activeStockTab !== 'current' && (
              <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-slate-200/80">
                {activeStockTab === 'material' && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Vendor:</label>
                    <div className="w-48">
                      <SearchableSelect
                        options={[
                          { value: 'all', label: 'All Vendors' },
                          ...vendors.map(v => ({ value: String(v.vendor_id), label: v.name }))
                        ]}
                        value={materialVendorFilter}
                        onChange={setMaterialVendorFilter}
                        placeholder="All Vendors"
                        searchPlaceholder="Filter vendor..."
                      />
                    </div>
                  </div>
                )}
                {activeStockTab === 'ledger' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">From Date:</label>
                      <input
                        type="date"
                        value={ledgerFromDate}
                        onChange={e => setLedgerFromDate(e.target.value)}
                        className="soleria-input py-1.5 px-3 text-sm font-semibold"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">To Date:</label>
                      <input
                        type="date"
                        value={ledgerToDate}
                        onChange={e => setLedgerToDate(e.target.value)}
                        className="soleria-input py-1.5 px-3 text-sm font-semibold"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Vendor:</label>
                      <div className="w-48">
                        <SearchableSelect
                          options={[
                            { value: 'all', label: 'All Vendors' },
                            ...vendors.map(v => ({ value: String(v.vendor_id), label: v.name }))
                          ]}
                          value={ledgerVendorFilter}
                          onChange={setLedgerVendorFilter}
                          placeholder="All Vendors"
                          searchPlaceholder="Filter vendor..."
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeStockTab === 'daily' && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Production Date:</label>
                    <input
                      type="date"
                      value={dailyDate}
                      onChange={e => setDailyDate(e.target.value)}
                      className="soleria-input py-1.5 px-3 text-sm font-semibold"
                    />
                  </div>
                )}

                {activeStockTab === 'weekly' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Select Week Date:</label>
                      <input
                        type="date"
                        value={weeklyDate}
                        onChange={e => setWeeklyDate(e.target.value)}
                        className="soleria-input py-1.5 px-3 text-sm font-semibold"
                      />
                    </div>
                    <span className="text-xs bg-[#111c2a] text-[#B08D57] px-3 py-1.5 rounded-lg font-bold">
                      {(() => {
                        const { start, end } = getWeekRange(weeklyDate);
                        return `${formatDate(start)} to ${formatDate(end)}`;
                      })()}
                    </span>
                  </div>
                )}

                {activeStockTab === 'monthly' && (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Month:</label>
                      <div className="w-40">
                        <SearchableSelect
                          options={Array.from({ length: 12 }, (_, i) => ({
                            value: String(i),
                            label: getMonthName(i)
                          }))}
                          value={String(monthlyMonth)}
                          onChange={(val: string) => setMonthlyMonth(parseInt(val, 10))}
                          placeholder="Select month..."
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Year:</label>
                      <input
                        type="number"
                        value={monthlyYear}
                        onChange={e => setMonthlyYear(parseInt(e.target.value) || new Date().getFullYear())}
                        className="soleria-input py-1.5 px-3 text-sm font-semibold w-[90px]"
                      />
                    </div>
                  </div>
                )}

                {activeStockTab === 'overall' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">From Date:</label>
                      <input
                        type="date"
                        value={fromDate}
                        onChange={e => setFromDate(e.target.value)}
                        className="soleria-input py-1.5 px-3 text-sm font-semibold"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">To Date:</label>
                      <input
                        type="date"
                        value={toDate}
                        onChange={e => setToDate(e.target.value)}
                        className="soleria-input py-1.5 px-3 text-sm font-semibold"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* The report: the same document the print preview prints (Product Ledger layout, per the
              user 2026-10-14). Material Stock keeps its own table for now: its "−" (reduce stock)
              button lives there, parked until the client says whether they record usage. */}
          {activeStockTab === 'material' ? (
            <div className="card-white p-6 md:p-8 bg-white border">
              {loading && !loadedTabs.includes('material') ? (
                <div className="text-center p-8 text-slate-400">Loading…</div>
              ) : (
                // Material Stock View — raw materials purchased from vendors,
                // separate from finished-goods Current Stock above.
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                        <th className="p-3 pl-4">Vendor</th>
                        <th className="p-3">Material</th>
                        <th className="p-3">Unit</th>
                        <th className="p-3 text-right">Purchased</th>
                        <th className="p-3 text-right">Returned</th>
                        <th className="p-3 text-right">Current Stock</th>
                        <th className="p-3 text-right pr-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {materialStockRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center p-8 text-slate-400">
                            No raw material purchases recorded yet.
                          </td>
                        </tr>
                      ) : (
                        materialStockRows.map((r, idx) => (
                          <tr key={idx} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                            <td className="p-3 pl-4 font-semibold text-slate-700">{r.vendor_name}</td>
                            <td className="p-3 text-slate-800">{r.material_name}</td>
                            <td className="p-3 text-slate-500">{r.unit}</td>
                            <td className="p-3 text-right font-semibold text-emerald-700">{r.purchased_qty.toLocaleString()}</td>
                            <td className="p-3 text-right font-semibold text-rose-700">{r.returned_qty > 0 ? r.returned_qty.toLocaleString() : '-'}</td>
                            <td className={`p-3 text-right font-bold ${r.on_hand <= 0 ? 'text-red-600' : 'text-slate-900'}`}>{r.on_hand.toLocaleString()}</td>
                            <td className="p-3 text-right pr-4">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => {
                                    setMaterialAdjModal({
                                      vendorId: r.vendor_id,
                                      vendorName: r.vendor_name,
                                      materialId: r.material_id,
                                      materialName: r.material_name,
                                      unit: r.unit,
                                      currentQty: r.on_hand,
                                    });
                                    setMaterialAdjQty('');
                                    setMaterialAdjError('');
                                  }}
                                  // The reduction is dated today and checked against the quantity shown, so
                                  // it only makes sense while the tab shows today's stock.
                                  disabled={asOfDate !== getTodayDate()}
                                  title={asOfDate !== getTodayDate() ? 'Set As on to today to reduce stock' : 'Deduct / Reduce Material Stock'}
                                  className="border border-slate-900 rounded bg-transparent text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center font-bold text-xs cursor-pointer"
                                  style={{ width: '24px', height: '24px' }}
                                >
                                  -
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <LiveReportDocument
              loading={loading && !loadedTabs.includes(activeStockTab)}
              empty={activeStockTab === 'current' && colorReportRows.length === 0}
              emptyMessage="No products found matching stock criteria."
            >
              {renderPrintableDocument()}
            </LiveReportDocument>
          )}
        </div>

      </div>

      {/* Material Stock Adjustment Modal (deduct/reduce only — stock:reduce-vendor-stock is the
          only real backend operation, the demo's Add direction had no backend equivalent). */}
      {materialAdjModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200 max-h-[90vh] overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center justify-between pb-4 border-b">
              <h3 className="text-lg font-bold text-slate-800 font-lora">Deduct Material Stock</h3>
              <button
                onClick={() => setMaterialAdjModal(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded"
              >
                <X size={18} />
              </button>
            </div>

            <div className="py-4 space-y-4">
              <div className="bg-slate-50 p-3 rounded-lg border text-xs space-y-1.5 text-slate-700">
                <div><span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Vendor:</span> <span className="font-bold text-slate-800">{materialAdjModal.vendorName}</span></div>
                <div><span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Material:</span> <span className="font-bold text-slate-800">{materialAdjModal.materialName}</span></div>
                <div><span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Unit:</span> <span className="font-semibold text-slate-800">{materialAdjModal.unit}</span></div>
                <div><span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Current Available Stock:</span> <strong className="text-slate-900 text-sm">{materialAdjModal.currentQty.toLocaleString()} {materialAdjModal.unit}</strong></div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Quantity to Deduct / Reduce *
                </label>
                <input
                  type="number"
                  min="1"
                  value={materialAdjQty}
                  onChange={e => {
                    setMaterialAdjQty(e.target.value);
                    setMaterialAdjError('');
                  }}
                  placeholder={`Enter quantity in ${materialAdjModal.unit}`}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  autoFocus
                />
              </div>

              {materialAdjError && (
                <div className="p-3 text-xs bg-rose-50 text-rose-700 rounded-lg border border-rose-200 font-semibold">
                  {materialAdjError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t">
              <button
                type="button"
                onClick={() => setMaterialAdjModal(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveMaterialAdjustment}
                className="px-4 py-2 text-sm font-semibold text-white rounded-lg transition-colors bg-rose-600 hover:bg-rose-700"
              >
                Confirm Reduction
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Native @media print container */}
      <div className="hidden print:block">
        {renderPrintableDocument()}
      </div>

      {/* Full-Screen Interactive Print Preview Modal */}
      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => { setIsPreviewOpen(false); closePreviewWindow(); }}
        title="Stock Inventory Report - Print Preview"
        orientation={reportOrientation}
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>
    </AppLayout>
  );
}
