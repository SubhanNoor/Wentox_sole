import { Fragment, useState, useMemo, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { Search, Printer, ChevronDown, ChevronRight, FileDown, FileSpreadsheet, LayoutList, X, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import * as api from '@/lib/api';
import type { StockRow, VendorStockRow, ProductLedgerResult, StockMovementRow, StockMovementType, CategoryRow, VendorRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

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
  type StockTab = 'current' | 'material' | 'ledger' | 'daily' | 'weekly' | 'monthly' | 'overall';
  const [activeStockTab, setActiveStockTab] = useState<StockTab>('current');
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

  const [materialVendorFilter, setMaterialVendorFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Real lookups
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);

  // Real report data, fetched per-tab
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [vendorStockRows, setVendorStockRows] = useState<VendorStockRow[]>([]);
  const [ledgerResult, setLedgerResult] = useState<ProductLedgerResult>({ rows: [], total_in: 0, total_out: 0, net: 0 });
  const [productionRows, setProductionRows] = useState<StockMovementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  useEffect(() => {
    api.listCategories().then(r => { if (r.ok) setCategories(r.data); });
    api.listVendors().then(r => { if (r.ok) setVendors(r.data); });
  }, []);

  // Add stock state variables
  const [selectedGroup, setSelectedGroup] = useState<{ articleId: number; code: string; commonName: string; categoryName: string; packing: number; rows: StockRow[] } | null>(null);
  const [addQuantity, setAddQuantity] = useState<number>(0);
  const [qtyType, setQtyType] = useState<'cartons' | 'pairs'>('cartons');
  const [productionDate, setProductionDate] = useState(new Date().toISOString().split('T')[0]);
  const [addColor, setAddColor] = useState('');
  const [isNewColor, setIsNewColor] = useState(false);

  // Expandable row state — keyed by article_id, since all color variants of an article live
  // under one row.
  const [expandedArticleId, setExpandedArticleId] = useState<number | null>(null);

  // Full Report modal — one row per article, every color's cartons/pairs inline on the same
  // line (no click-to-expand), ending with a combined Total Pairs across all colors.
  const [showColorReport, setShowColorReport] = useState(false);

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
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().split('T')[0]);
  const [weeklyDate, setWeeklyDate] = useState(new Date().toISOString().split('T')[0]);
  const [monthlyMonth, setMonthlyMonth] = useState(new Date().getMonth());
  const [monthlyYear, setMonthlyYear] = useState(new Date().getFullYear());
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());

  // Product Ledger tab filtering state
  const [ledgerFromDate, setLedgerFromDate] = useState(getThreeMonthsAgoDate());
  const [ledgerToDate, setLedgerToDate] = useState(getTodayDate());
  const [ledgerVendorFilter, setLedgerVendorFilter] = useState('all');

  const categoryIdParam = selectedCategory !== 'all' ? Number(selectedCategory) : undefined;

  // ── Current Stock ──
  const loadStock = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.stock({ category_id: categoryIdParam });
    if (res.ok) setStockRows(res.data); else fail(res.error.message);
    setLoading(false);
  }, [categoryIdParam]);

  useEffect(() => { if (activeStockTab === 'current') loadStock(); }, [activeStockTab, loadStock]);

  // reports:stock has no free-text search — filtered client-side against the fetched rows.
  const filteredStockRows = useMemo(() => {
    if (!searchQuery.trim()) return stockRows;
    const q = searchQuery.toLowerCase();
    return stockRows.filter(r => r.article_name.toLowerCase().includes(q) || r.article_code.toLowerCase().includes(q));
  }, [stockRows, searchQuery]);

  // Group color variants of the same article under one row.
  const groupedArticles = useMemo(() => {
    const groups: Record<number, { articleId: number; code: string; commonName: string; categoryName: string; packing: number; rows: StockRow[] }> = {};
    filteredStockRows.forEach(r => {
      if (!groups[r.article_id]) {
        groups[r.article_id] = { articleId: r.article_id, code: r.article_code, commonName: r.article_name, categoryName: r.category_name, packing: r.effective_packing, rows: [] };
      }
      groups[r.article_id].rows.push(r);
    });
    return Object.values(groups).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [filteredStockRows]);

  // Full Report: a pivot table — one column per distinct color found across ALL filtered
  // articles (one-hot style), each cell showing that article's cartons/extra-pairs in that
  // color, or 0/0 if the article has no stock in it.
  const allColorsAcrossArticles = useMemo(() => {
    return Array.from(new Set(filteredStockRows.map(r => r.color))).sort((a, b) => a.localeCompare(b));
  }, [filteredStockRows]);

  const colorReportRows = useMemo(() => {
    return groupedArticles.map(group => {
      const byColor: Record<string, { cartons: number; extraPairs: number }> = {};
      group.rows.forEach(r => { byColor[r.color] = { cartons: r.cartons, extraPairs: r.extra_pairs }; });
      const totalPairs = group.rows.reduce((sum, r) => sum + r.total_pairs, 0);
      return { code: group.code, commonName: group.commonName, categoryName: group.categoryName, byColor, totalPairs };
    });
  }, [groupedArticles]);

  const colorReportTotalPairs = useMemo(() => colorReportRows.reduce((sum, r) => sum + r.totalPairs, 0), [colorReportRows]);
  const totalPairs = useMemo(() => filteredStockRows.reduce((sum, r) => sum + r.total_pairs, 0), [filteredStockRows]);
  const totalCartons = useMemo(() => filteredStockRows.reduce((sum, r) => sum + r.cartons, 0), [filteredStockRows]);
  const totalExtraPairs = useMemo(() => filteredStockRows.reduce((sum, r) => sum + r.extra_pairs, 0), [filteredStockRows]);

  // ── Material Stock ──
  const loadVendorStock = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.vendorStock();
    if (res.ok) setVendorStockRows(res.data); else fail(res.error.message);
    setLoading(false);
  }, []);

  useEffect(() => { if (activeStockTab === 'material') loadVendorStock(); }, [activeStockTab, loadVendorStock]);

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
  }, [categoryIdParam, ledgerVendorFilter, searchQuery, ledgerFromDate, ledgerToDate]);

  useEffect(() => { if (activeStockTab === 'ledger') loadLedger(); }, [activeStockTab, loadLedger]);

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
  }, [categoryIdParam, searchQuery, productionDateRange]);

  useEffect(() => {
    if (activeStockTab === 'daily' || activeStockTab === 'weekly' || activeStockTab === 'monthly' || activeStockTab === 'overall') {
      loadProduction();
    }
  }, [activeStockTab, loadProduction]);

  const filteredLogs = productionRows;

  const totalProductionCartons = useMemo(() => filteredLogs.reduce((sum, log) => sum + (log.input_unit === 'CARTONS' ? (log.input_qty || 0) : 0), 0), [filteredLogs]);
  const totalProductionPairsDirect = useMemo(() => filteredLogs.reduce((sum, log) => sum + (log.input_unit === 'PAIRS' ? (log.input_qty || 0) : 0), 0), [filteredLogs]);
  const totalProductionPairs = useMemo(() => filteredLogs.reduce((sum, log) => sum + log.qty_pairs, 0), [filteredLogs]);

  const handleExportColorReportExcel = () => {
    const headers = ['Product Code', 'Article', 'Category', ...allColorsAcrossArticles.map(c => `${c} (Ctn/Prs)`), 'Total Pairs'];
    const rows = colorReportRows.map(r => [
      r.code, r.commonName, r.categoryName,
      ...allColorsAcrossArticles.map(c => `${r.byColor[c]?.cartons ?? 0}/${r.byColor[c]?.extraPairs ?? 0}`),
      r.totalPairs
    ]);
    exportRowsToExcel('current-stock-full-report', headers, rows);
  };

  const handleExportExcel = () => {
    if (activeStockTab === 'current') {
      const headers = ['Product Code', 'Category', 'Total Pairs'];
      const rows = groupedArticles.map(g => [g.code, g.categoryName, g.rows.reduce((s, r) => s + r.total_pairs, 0)]);
      exportRowsToExcel('current-stock', headers, rows);
    } else if (activeStockTab === 'material') {
      const headers = ['Vendor', 'Material', 'Unit', 'Purchased', 'Returned', 'Current Stock'];
      const rows = materialStockRows.map(r => [r.vendor_name, r.material_name, r.unit, r.purchased_qty, r.returned_qty, r.on_hand]);
      exportRowsToExcel('material-stock', headers, rows);
    } else if (activeStockTab === 'ledger') {
      const headers = ['Date', 'Product Code', 'Article', 'Color', 'Vendor', 'Type', 'Ref', 'Debit (IN)', 'Credit (OUT)'];
      const rows = ledgerResult.rows.map(e => [e.movement_date, e.article_code, e.article_name, e.color, e.vendor_name || '', MOVEMENT_TYPE_LABEL[e.movement_type], e.movement_id, e.debit, e.credit]);
      exportRowsToExcel('product-ledger', headers, rows);
    } else {
      const headers = ['Date', 'Product Code', 'Article Name', 'Color', 'Category', 'Packing', 'Qty Added', 'Unit', 'Total Pairs'];
      const rows = filteredLogs.map(log => [log.movement_date, log.article_code, log.article_name, log.color, log.category_name, log.packing ?? '', log.input_qty ?? '', log.input_unit ?? '', log.qty_pairs]);
      exportRowsToExcel(`production-${activeStockTab}`, headers, rows);
    }
  };

  const renderPrintableDocument = () => {
    let reportTitle = 'FINISHED GOODS STOCK INVENTORY';
    if (showColorReport) reportTitle = 'CURRENT FINISHED STOCK - FULL COLOR MATRIX REPORT';
    else if (activeStockTab === 'material') reportTitle = 'RAW MATERIAL INVENTORY REPORT';
    else if (activeStockTab === 'ledger') reportTitle = 'PRODUCT MOVEMENT LEDGER';
    else if (activeStockTab === 'daily') reportTitle = `DAILY PRODUCTION LOG (${dailyDate})`;
    else if (activeStockTab === 'weekly') reportTitle = 'WEEKLY PRODUCTION REPORT';
    else if (activeStockTab === 'monthly') reportTitle = `MONTHLY PRODUCTION REPORT (${getMonthName(monthlyMonth)} ${monthlyYear})`;
    else if (activeStockTab === 'overall') reportTitle = 'CUMULATIVE OVERALL PRODUCTION REPORT';

    return (
      <div className="excel-print-container">
        {/* Header Section with Prominent 180px Logo */}
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '180px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>{reportTitle}</h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
              Category: {selectedCategory === 'all' ? 'All Categories' : categories.find(c => String(c.category_id) === selectedCategory)?.name}
            </p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Date of Print: {new Date().toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* Current Stock Table */}
        {(activeStockTab === 'current' && !showColorReport) && (
          <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Article Code</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Article Name</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Category</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Packing</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Cartons</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Extra Pairs</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Total Pairs</th>
              </tr>
            </thead>
            <tbody>
              {groupedArticles.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ border: '1px solid #000000', padding: '10px', fontSize: '11px', textAlign: 'center', color: '#666666' }}>
                    No stock inventory found.
                  </td>
                </tr>
              ) : (
                groupedArticles.map(group => {
                  const catName = group.categoryName || 'General';
                  const sumPairs = group.rows.reduce((s, r) => s + r.total_pairs, 0);
                  const packing = group.packing || 12;
                  const cartons = Math.floor(sumPairs / packing);
                  const extra = sumPairs % packing;

                  return (
                    <tr key={group.code}>
                      <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace', fontWeight: 'bold' }}>{group.code}</td>
                      <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', fontWeight: 'bold' }}>{group.commonName}</td>
                      <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{catName}</td>
                      <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{packing}</td>
                      <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{cartons}</td>
                      <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{extra}</td>
                      <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{sumPairs.toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
              <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f9f9f9' }}>
                <td colSpan={4} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>TOTAL INVENTORY SUM</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{totalCartons}</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{totalExtraPairs}</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{totalPairs.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        )}

        {/* Full Color Report Matrix */}
        {showColorReport && (
          <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '10.5px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Code</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '10.5px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Article</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '10.5px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Category</th>
                {allColorsAcrossArticles.map(c => (
                  <th key={c} style={{ border: '1px solid #000000', padding: '6px', fontSize: '10.5px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>{c}</th>
                ))}
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '10.5px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Total Pairs</th>
              </tr>
            </thead>
            <tbody>
              {colorReportRows.map(row => (
                <tr key={row.code}>
                  <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px', fontFamily: 'monospace', fontWeight: 'bold' }}>{row.code}</td>
                  <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', fontWeight: 'bold' }}>{row.commonName}</td>
                  <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px' }}>{row.categoryName}</td>
                  {allColorsAcrossArticles.map(c => {
                    const st = row.byColor[c];
                    return (
                      <td key={c} style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10px', textAlign: 'center', fontFamily: 'monospace' }}>
                        {st ? `${st.cartons}/${st.extraPairs}` : '-'}
                      </td>
                    );
                  })}
                  <td style={{ border: '1px solid #000000', padding: '4px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{row.totalPairs.toLocaleString()}</td>
                </tr>
              ))}
              <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f9f9f9' }}>
                <td colSpan={3 + allColorsAcrossArticles.length} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>TOTAL PAIRS ACROSS ALL ARTICLES & COLORS</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{colorReportTotalPairs.toLocaleString()}</td>
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

        {/* Signatures */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '40px', padding: '0 10px' }}>
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
      </div>
    );
  };

  return (
    <AppLayout pageTitle="Stock & Production Center">
      <div className="mx-auto" style={{ maxWidth: 1000 }}>

        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>}

        {/* Top Tab Navigation - hidden on print */}
        <div className="flex flex-wrap gap-2 mb-6 border-b pb-3" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <button
            onClick={() => switchStockTab('current')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeStockTab === 'current'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Current Stock
          </button>
          <button
            onClick={() => switchStockTab('material')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeStockTab === 'material'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Material Stock
          </button>
          <button
            onClick={() => switchStockTab('ledger')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeStockTab === 'ledger'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Product Ledger
          </button>
          <button
            onClick={() => switchStockTab('daily')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeStockTab === 'daily'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Daily Production
          </button>
          <button
            onClick={() => switchStockTab('weekly')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeStockTab === 'weekly'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Weekly Production
          </button>
          <button
            onClick={() => switchStockTab('monthly')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeStockTab === 'monthly'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Monthly Production
          </button>
          <button
            onClick={() => switchStockTab('overall')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeStockTab === 'overall'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Overall Production
          </button>
        </div>

        {/* On-screen View - hidden on print */}
        <div data-no-print className={`transition-all duration-200 ${tabAnimating ? 'opacity-0 translate-y-2' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`}>
          {/* Search and Filters */}
          <div className="p-3 rounded-lg border mb-4 bg-white shadow-sm" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-56 md:w-64 shrink-0">
                <Search className="absolute left-3 top-2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Search by article code or name..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input pl-9 py-1.5 w-full text-xs font-semibold"
                />
              </div>

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

              {activeStockTab === 'current' && (
                <button
                  onClick={() => setShowColorReport(true)}
                  className="btn-outline flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold shrink-0"
                >
                  <LayoutList size={14} /> View Full Report
                </button>
              )}

              <button
                onClick={() => setIsPreviewOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs shrink-0"
              >
                <Eye size={14} /> Show Print Preview
              </button>
              <button onClick={() => setIsPreviewOpen(true)} className="btn-outline flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold shrink-0">
                <Printer size={14} /> Print Report
              </button>
              <button onClick={() => setIsPreviewOpen(true)} className="btn-outline flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold shrink-0">
                <FileDown size={14} /> Export PDF
              </button>
              <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold shrink-0">
                <FileSpreadsheet size={14} /> Export Excel
              </button>
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
                        return `${start.toLocaleDateString()} to ${end.toLocaleDateString()}`;
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

          {/* On-screen Layout Table */}
          <div className="card-white p-6 md:p-8 bg-white border">
            {loading ? (
              <div className="text-center p-8 text-slate-400">Loading…</div>
            ) : activeStockTab === 'current' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4" style={{ width: '30px' }}></th>
                      <th className="p-3">Product Code</th>
                      <th className="p-3">Category</th>
                      <th className="p-3 text-right">Total Pairs</th>
                      <th className="p-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedArticles.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center p-8 text-slate-400">
                          No products found matching stock criteria.
                        </td>
                      </tr>
                    ) : (
                      groupedArticles.map(group => {
                        const groupTotalPairs = group.rows.reduce((sum, r) => sum + r.total_pairs, 0);
                        const isExpanded = expandedArticleId === group.articleId;

                        return (
                          <Fragment key={group.articleId}>
                            <tr
                              className="border-b hover:bg-slate-50/50 cursor-pointer"
                              style={{ borderColor: 'var(--border-table)' }}
                              onClick={() => setExpandedArticleId(isExpanded ? null : group.articleId)}
                            >
                              <td className="p-3 pl-4 text-slate-400">
                                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </td>
                              <td className="p-3 font-semibold text-slate-700">
                                {group.code}
                                <span className="block text-xs font-normal text-slate-500">
                                  {group.commonName} <span className="text-slate-400">({group.rows.length} color{group.rows.length !== 1 ? 's' : ''})</span>
                                </span>
                              </td>
                              <td className="p-3 text-slate-500">{group.categoryName}</td>
                              <td className={`p-3 text-right font-bold ${groupTotalPairs <= 0 ? 'text-red-600' : 'text-slate-900'}`}>
                                {groupTotalPairs.toLocaleString()}
                              </td>
                              <td className="p-3 text-center">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedGroup(group);
                                    setAddQuantity(1);
                                    setQtyType('cartons');
                                    setProductionDate(new Date().toISOString().split('T')[0]);
                                    setAddColor('');
                                    setIsNewColor(group.rows.length === 0);
                                  }}
                                  className="border border-black rounded bg-transparent text-black hover:bg-slate-50 transition-colors flex items-center justify-center mx-auto font-black text-xs"
                                  style={{ width: '22px', height: '22px' }}
                                  title="Add Stock"
                                >
                                  +
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-slate-50/70 border-b" style={{ borderColor: 'var(--border-table)' }}>
                                <td></td>
                                <td colSpan={4} className="p-4">
                                  {/* Color variant sub-rows */}
                                  <div className="bg-white border rounded-lg overflow-hidden mb-4" style={{ borderColor: 'var(--border-color)' }}>
                                    <table className="w-full text-left border-collapse text-xs">
                                      <thead>
                                        <tr className="bg-slate-50 text-slate-400 uppercase tracking-wider" style={{ borderColor: 'var(--border-color)' }}>
                                          <th className="p-2 pl-3">Content Color</th>
                                          <th className="p-2 text-center">Pairs / Carton</th>
                                          <th className="p-2 text-right">Total Cartons</th>
                                          <th className="p-2 text-right">Extra Pairs</th>
                                          <th className="p-2 text-right pr-3">Total Pairs</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.rows.map(r => (
                                          <tr key={r.variant_id} className="border-t" style={{ borderColor: 'var(--border-table)' }}>
                                            <td className="p-2 pl-3">
                                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                                                r.color.toLowerCase() === 'black' ? 'bg-slate-900 text-white' :
                                                r.color.toLowerCase() === 'white' ? 'bg-slate-100 text-slate-800 border border-slate-200' :
                                                r.color.toLowerCase() === 'brown' ? 'bg-amber-900 text-amber-50' :
                                                r.color.toLowerCase() === 'tan' ? 'bg-orange-100 text-orange-800' :
                                                'bg-slate-100 text-slate-600'
                                              }`}>
                                                {r.color}
                                              </span>
                                            </td>
                                            <td className="p-2 text-center font-medium text-slate-700">{r.effective_packing}</td>
                                            <td className="p-2 text-right font-bold text-slate-800">{r.cartons}</td>
                                            <td className="p-2 text-right text-slate-700">{r.extra_pairs || '-'}</td>
                                            <td className="p-2 text-right pr-3 font-bold" style={{ color: 'var(--brand-gold)' }}>{r.total_pairs.toLocaleString()}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>

                  <tfoot>
                    <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                      <td colSpan={3} className="p-4 text-left font-lora">REPORT TOTAL</td>
                      <td className="p-4 text-right text-lg" style={{ color: 'var(--brand-gold)' }}>
                        {totalPairs.toLocaleString()} Pairs
                      </td>
                      <td className="p-4"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : activeStockTab === 'material' ? (
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
                                title="Deduct / Reduce Material Stock"
                                className="border border-slate-900 rounded bg-transparent text-slate-900 hover:bg-slate-100 transition-colors flex items-center justify-center font-bold text-xs cursor-pointer"
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
            ) : activeStockTab === 'ledger' ? (
              // Product Ledger View
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
                    {ledgerResult.rows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="text-center p-8 text-slate-400">
                          No product ledger movements found matching your filters.
                        </td>
                      </tr>
                    ) : (
                      ledgerResult.rows.map((entry) => (
                        <tr key={entry.movement_id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-3 pl-4 font-mono text-slate-600">{entry.movement_date}</td>
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
                          <td className="p-3 text-right font-semibold text-rose-700">{entry.credit > 0 ? entry.credit : '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                      <td colSpan={7} className="p-4 text-left font-lora">REPORT TOTAL</td>
                      <td className="p-4 text-right text-emerald-800">{ledgerResult.total_in.toLocaleString()}</td>
                      <td className="p-4 text-right text-rose-800">{ledgerResult.total_out.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              // Production Logs View
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4">S#</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Product Code</th>
                      <th className="p-3">Article Name</th>
                      <th className="p-3">Color</th>
                      <th className="p-3">Category</th>
                      <th className="p-3 text-center">Packing</th>
                      <th className="p-3 text-right">Qty Added</th>
                      <th className="p-3 text-right">Unit</th>
                      <th className="p-3 text-right">Total Pairs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="text-center p-8 text-slate-400">
                          No production records found for the selected criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log, idx) => (
                        <tr key={log.movement_id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-3 pl-4 font-mono text-slate-500">{idx + 1}</td>
                          <td className="p-3 text-slate-600 font-semibold">{log.movement_date}</td>
                          <td className="p-3 font-semibold text-slate-700">{log.article_code}</td>
                          <td className="p-3 font-semibold text-slate-800">{log.article_name}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              log.color.toLowerCase() === 'black' ? 'bg-slate-900 text-white' :
                              log.color.toLowerCase() === 'white' ? 'bg-slate-100 text-slate-800 border border-slate-200' :
                              log.color.toLowerCase() === 'brown' ? 'bg-amber-900 text-amber-50' :
                              log.color.toLowerCase() === 'tan' ? 'bg-orange-100 text-orange-800' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {log.color}
                            </span>
                          </td>
                          <td className="p-3 text-slate-500">{log.category_name}</td>
                          <td className="p-3 text-center text-slate-600 font-medium">{log.packing}</td>
                          <td className="p-3 text-right text-slate-700 font-bold">{log.input_qty}</td>
                          <td className="p-3 text-right text-slate-500 capitalize">{log.input_unit?.toLowerCase()}</td>
                          <td className="p-3 text-right text-slate-900 font-bold">{log.qty_pairs.toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                      <td colSpan={7} className="p-4 text-left font-lora">PRODUCTION TOTAL</td>
                      <td className="p-4 text-right text-slate-800 font-bold">
                        {totalProductionCartons > 0 && `${totalProductionCartons} ctn`}
                        {totalProductionCartons > 0 && totalProductionPairsDirect > 0 && ' + '}
                        {totalProductionPairsDirect > 0 && `${totalProductionPairsDirect} prs`}
                        {totalProductionCartons === 0 && totalProductionPairsDirect === 0 && '-'}
                      </td>
                      <td className="p-4"></td>
                      <td className="p-4 text-right text-emerald-800 text-lg" style={{ color: 'var(--brand-gold)' }}>
                        {totalProductionPairs.toLocaleString()} Pairs
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Printable Excel-style layout for physical printers — hidden while the Full Report
            modal is open, so printing there prints only the modal's own block below. */}
        {!showColorReport && (
        <div className="hidden print:block excel-print-container">
          <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '10px' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>WENTOX WAREHOUSE</h1>
              <p style={{ margin: 0, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#555555' }}>
                Footwear Wholesale Distribution
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>
                {activeStockTab === 'current' && 'CURRENT STOCK REPORT'}
                {activeStockTab === 'material' && 'MATERIAL STOCK REPORT'}
                {activeStockTab === 'ledger' && 'PRODUCT LEDGER REPORT'}
                {activeStockTab === 'daily' && 'DAILY PRODUCTION REPORT'}
                {activeStockTab === 'weekly' && 'WEEKLY PRODUCTION REPORT'}
                {activeStockTab === 'monthly' && 'MONTHLY PRODUCTION REPORT'}
                {activeStockTab === 'overall' && 'OVERALL PRODUCTION REPORT'}
              </h2>
              <p style={{ margin: 0, fontSize: '11px', color: '#555555' }}>
                {activeStockTab === 'current' && `Date: ${new Date().toLocaleDateString()}`}
                {activeStockTab === 'material' && `Date: ${new Date().toLocaleDateString()}`}
                {activeStockTab === 'ledger' && `Range: ${ledgerFromDate || 'Beginning'} to ${ledgerToDate || 'Present'}`}
                {activeStockTab === 'daily' && `Production Date: ${dailyDate}`}
                {activeStockTab === 'weekly' && `${getWeekRange(weeklyDate).start.toLocaleDateString()} - ${getWeekRange(weeklyDate).end.toLocaleDateString()}`}
                {activeStockTab === 'monthly' && `Period: ${getMonthName(monthlyMonth)} ${monthlyYear}`}
                {activeStockTab === 'overall' && `Range: ${fromDate || 'Beginning'} to ${toDate || 'Present'}`}
              </p>
            </div>
          </div>

          <div className="excel-grid-info" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', border: '1px solid #000000', marginBottom: '15px' }}>
            <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
              <span style={{ fontWeight: 'bold', textTransform: 'uppercase', fontSize: '9px', color: '#333333', display: 'block', marginBottom: '2px' }}>Category Filter</span>
              <span>{selectedCategory === 'all' ? 'ALL CATEGORIES' : (categories.find(c => String(c.category_id) === selectedCategory)?.name || 'General')}</span>
            </div>
            <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
              <span style={{ fontWeight: 'bold', textTransform: 'uppercase', fontSize: '9px', color: '#333333', display: 'block', marginBottom: '2px' }}>Search Filter</span>
              <span>{searchQuery.trim() ? searchQuery : 'NONE'}</span>
            </div>
          </div>

          {activeStockTab === 'current' ? (
            <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f2f2f2' }}>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '5%' }}>S#</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '15%' }}>Code</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '30%' }}>Article Description</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '12%' }}>Color</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '13%' }}>Category</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '8%' }}>Packing</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '8%' }}>Cartons</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '8%' }}>Extra</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '12%' }}>Total Pairs</th>
                </tr>
              </thead>
              <tbody>
                {filteredStockRows.map((r, idx) => (
                  <tr key={r.variant_id}>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{idx + 1}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold' }}>{r.article_code}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{r.article_name}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{r.color}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{r.category_name}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{r.effective_packing}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{r.cartons}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{r.extra_pairs > 0 ? r.extra_pairs : '-'}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold' }}>{r.total_pairs.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2', fontSize: '12px' }}>
                  <td colSpan={6} style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', textTransform: 'uppercase' }}>Report Total:</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right' }}>{totalCartons}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right' }}>{totalExtraPairs > 0 ? totalExtraPairs : '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', borderBottom: '3px double #000000' }}>{totalPairs.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          ) : activeStockTab === 'material' ? (
            <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f2f2f2' }}>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '5%' }}>S#</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '22%' }}>Vendor</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '28%' }}>Material</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '12%' }}>Unit</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '11%' }}>Purchased</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '11%' }}>Returned</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '11%' }}>Current Stock</th>
                </tr>
              </thead>
              <tbody>
                {materialStockRows.map((r, idx) => (
                  <tr key={idx}>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{idx + 1}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold' }}>{r.vendor_name}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{r.material_name}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{r.unit}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{r.purchased_qty.toLocaleString()}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{r.returned_qty > 0 ? r.returned_qty.toLocaleString() : '-'}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold' }}>{r.on_hand.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : activeStockTab === 'ledger' ? (
            <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f2f2f2' }}>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '5%' }}>S#</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '10%' }}>Date</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '10%' }}>Code</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '18%' }}>Article</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '10%' }}>Color</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '14%' }}>Vendor</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '10%' }}>Type</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '9%' }}>Ref</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '9%' }}>Debit</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '9%' }}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {ledgerResult.rows.map((e, idx) => (
                  <tr key={e.movement_id}>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{idx + 1}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{e.movement_date}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold' }}>{e.article_code}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{e.article_name}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{e.color}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{e.vendor_name || ''}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{MOVEMENT_TYPE_LABEL[e.movement_type]}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>#{e.movement_id}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{e.debit > 0 ? e.debit : '-'}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{e.credit > 0 ? e.credit : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f2f2f2' }}>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '5%' }}>S#</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '12%' }}>Date</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '12%' }}>Code</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '25%' }}>Article Description</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '12%' }}>Color</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '12%' }}>Category</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '8%' }}>Packing</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '8%' }}>Qty</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '8%' }}>Unit</th>
                  <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '12%' }}>Total Pairs</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log, idx) => (
                  <tr key={log.movement_id}>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{idx + 1}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{log.movement_date}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold' }}>{log.article_code}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{log.article_name}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{log.color}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{log.category_name}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{log.packing}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{log.input_qty}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textTransform: 'capitalize' }}>{log.input_unit?.toLowerCase()}</td>
                    <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold' }}>{log.qty_pairs.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2', fontSize: '12px' }}>
                  <td colSpan={7} style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', textTransform: 'uppercase' }}>Report Total:</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right' }}>
                    {totalProductionCartons > 0 && `${totalProductionCartons} ctn`}
                    {totalProductionCartons > 0 && totalProductionPairsDirect > 0 && ' + '}
                    {totalProductionPairsDirect > 0 && `${totalProductionPairsDirect} prs`}
                    {totalProductionCartons === 0 && totalProductionPairsDirect === 0 && '-'}
                  </td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px' }}></td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', borderBottom: '3px double #000000' }}>{totalProductionPairs.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          )}

          {/* Signatures */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '60px', fontSize: '11px' }}>
            <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
              Prepared By
            </div>
            <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
              Checked By
            </div>
            <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
              Manager Production
            </div>
          </div>
        </div>
        )}

        {/* Full Report print block — only rendered while the modal is open, so it's the sole
            thing that ends up on paper when printing from inside it. */}
        {showColorReport && (
        <div className="hidden print:block excel-print-container">
          <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '10px' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>WENTOX WAREHOUSE</h1>
              <p style={{ margin: 0, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#555555' }}>
                Footwear Wholesale Distribution
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>CURRENT STOCK — FULL REPORT</h2>
              <p style={{ margin: 0, fontSize: '11px', color: '#555555' }}>Date: {new Date().toLocaleDateString()}</p>
            </div>
          </div>

          <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f2f2f2' }}>
                <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center' }}>S#</th>
                <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left' }}>Code</th>
                <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left' }}>Article</th>
                <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left' }}>Category</th>
                {allColorsAcrossArticles.map(color => (
                  <th key={color} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center' }}>{color}</th>
                ))}
                <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right' }}>Total Pairs</th>
              </tr>
            </thead>
            <tbody>
              {colorReportRows.map((r, idx) => (
                <tr key={r.code}>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{idx + 1}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold' }}>{r.code}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{r.commonName}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{r.categoryName}</td>
                  {allColorsAcrossArticles.map(color => {
                    const cell = r.byColor[color];
                    return (
                      <td key={color} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>
                        {cell ? cell.cartons : 0}/{cell ? cell.extraPairs : 0}
                      </td>
                    );
                  })}
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold' }}>{r.totalPairs.toLocaleString()}</td>
                </tr>
              ))}
              <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2', fontSize: '12px' }}>
                <td colSpan={4 + allColorsAcrossArticles.length} style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', textTransform: 'uppercase' }}>Report Total:</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', borderBottom: '3px double #000000' }}>{colorReportTotalPairs.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '60px', fontSize: '11px' }}>
            <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
              Prepared By
            </div>
            <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
              Checked By
            </div>
            <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
              Manager Production
            </div>
          </div>
        </div>
        )}

      </div>

      {/* Full Report modal — a pivot table: one column per distinct color across every
          filtered article, each cell showing that article's cartons/extra-pairs in that
          color (0/0 if absent), ending with a combined Total Pairs. */}
      {showColorReport && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border w-full max-w-[95vw] mx-4 max-h-[85vh] flex flex-col animate-scaleUp">
            <div className="flex items-center justify-between p-6 pb-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <div>
                <h3 className="font-lora font-bold text-lg text-slate-800">Current Stock — Full Report</h3>
                <p className="text-xs text-slate-500 mt-0.5">Every article × every color, cartons/extra-pairs (0/0 if the article has none of that color)</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs">
                  <Printer size={14} /> Print
                </button>
                <button onClick={handleExportColorReportExcel} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs">
                  <FileSpreadsheet size={14} /> Export Excel
                </button>
                <button
                  onClick={() => setShowColorReport(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto overflow-x-auto p-6 pt-4">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4 whitespace-nowrap">Code</th>
                    <th className="p-3 whitespace-nowrap">Article</th>
                    <th className="p-3 whitespace-nowrap">Category</th>
                    {allColorsAcrossArticles.map(color => (
                      <th key={color} className="p-3 text-center whitespace-nowrap">{color}</th>
                    ))}
                    <th className="p-3 text-right whitespace-nowrap">Total Pairs</th>
                  </tr>
                </thead>
                <tbody>
                  {colorReportRows.length === 0 ? (
                    <tr>
                      <td colSpan={4 + allColorsAcrossArticles.length} className="text-center p-8 text-slate-400">
                        No products found matching stock criteria.
                      </td>
                    </tr>
                  ) : (
                    colorReportRows.map(r => (
                      <tr key={r.code} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-semibold text-slate-700 whitespace-nowrap">{r.code}</td>
                        <td className="p-3 text-slate-700 whitespace-nowrap">{r.commonName}</td>
                        <td className="p-3 text-slate-500 whitespace-nowrap">{r.categoryName}</td>
                        {allColorsAcrossArticles.map(color => {
                          const cell = r.byColor[color];
                          const has = !!cell && (cell.cartons > 0 || cell.extraPairs > 0);
                          return (
                            <td
                              key={color}
                              className={`p-3 text-center font-mono ${has ? 'font-semibold text-slate-800' : 'text-slate-300'}`}
                            >
                              {cell ? cell.cartons : 0}/{cell ? cell.extraPairs : 0}
                            </td>
                          );
                        })}
                        <td className={`p-3 text-right font-bold whitespace-nowrap ${r.totalPairs <= 0 ? 'text-red-600' : 'text-slate-900'}`}>
                          {r.totalPairs.toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                    <td colSpan={3 + allColorsAcrossArticles.length} className="p-4 text-left font-lora">REPORT TOTAL</td>
                    <td className="p-4 text-right text-lg whitespace-nowrap" style={{ color: 'var(--brand-gold)' }}>
                      {colorReportTotalPairs.toLocaleString()} Pairs
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add Stock Modal */}
      {selectedGroup && (() => {
        const matchedRow = addColor.trim()
          ? selectedGroup.rows.find(r => r.color.toLowerCase() === addColor.trim().toLowerCase())
          : undefined;
        const basePacking = matchedRow?.effective_packing || selectedGroup.packing || 12;
        const baseStock = matchedRow?.total_pairs || 0;
        const existingColors = selectedGroup.rows.map(r => r.color);

        return (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
            <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
              <h3 className="font-lora font-bold text-lg text-slate-800 mb-2">
                Add Stock / Log Production
              </h3>
              <p className="text-xs text-slate-500 mb-4 font-semibold uppercase tracking-wider">
                {selectedGroup.code} — {selectedGroup.commonName}
              </p>

              {matchedRow && (
                <div className="bg-slate-50 p-3 rounded-lg border mb-4 text-xs font-semibold text-slate-600 flex justify-between">
                  <div>
                    <span className="block text-[10px] uppercase text-slate-400">Current Stock ({matchedRow.color})</span>
                    <span className="text-slate-800 font-bold">
                      {Math.floor(baseStock / basePacking)} ctn
                      { baseStock % basePacking > 0 && ` & ${baseStock % basePacking} prs` }
                      {` (Total: ${baseStock} Pairs)`}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] uppercase text-slate-400">Packing</span>
                    <span className="text-slate-800">{basePacking} Pairs/Ctn</span>
                  </div>
                </div>
              )}

              {/* Content Color */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Content Color <span className="text-red-500 font-bold">*</span>
                </label>
                {isNewColor ? (
                  <input
                    type="text"
                    value={addColor}
                    onChange={e => setAddColor(e.target.value)}
                    placeholder="Type new color..."
                    autoFocus
                    onBlur={() => {
                      if (!addColor.trim() && existingColors.length > 0) setIsNewColor(false);
                    }}
                    className="soleria-input font-bold"
                  />
                ) : (
                  <select
                    value={existingColors.includes(addColor) ? addColor : ''}
                    onChange={e => {
                      if (e.target.value === '__new__') {
                        setIsNewColor(true);
                        setAddColor('');
                      } else {
                        setAddColor(e.target.value);
                      }
                    }}
                    className="soleria-input cursor-pointer font-bold"
                  >
                    <option value="">Select existing color...</option>
                    {existingColors.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                    <option value="__new__">+ Add New Color (type manually)...</option>
                  </select>
                )}
                {!matchedRow && addColor.trim() && (
                  <p className="text-[10px] text-amber-600 mt-1">
                    "{addColor.trim()}" is a new color — a new article color record will be created for it.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Add Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={addQuantity || ''}
                    onChange={e => setAddQuantity(e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                    onFocus={e => e.target.select()}
                    onBlur={() => setAddQuantity(q => Math.max(1, q))}
                    className="soleria-input text-center font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Unit Type</label>
                  <select
                    value={qtyType}
                    onChange={e => setQtyType(e.target.value as 'cartons' | 'pairs')}
                    className="soleria-input cursor-pointer font-bold"
                  >
                    <option value="cartons">Carton(s)</option>
                    <option value="pairs">Pair(s)</option>
                  </select>
                </div>
              </div>

              {/* Production Date Selector */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-600 mb-1">Production Date</label>
                <input
                  type="date"
                  value={productionDate}
                  onChange={e => setProductionDate(e.target.value)}
                  className="soleria-input font-bold"
                />
              </div>

              {/* Preview */}
              {(() => {
                const increment = qtyType === 'cartons' ? addQuantity * basePacking : addQuantity;
                const newTotal = baseStock + increment;
                const newCartons = Math.floor(newTotal / basePacking);
                const newRemPairs = newTotal % basePacking;
                return (
                  <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg text-xs font-semibold text-slate-700 mb-6">
                    <span className="block text-[10px] uppercase text-amber-600 mb-0.5">Updated Stock Preview</span>
                    <span className="font-bold text-amber-800">
                      {newCartons} ctn
                      { newRemPairs > 0 && ` & ${newRemPairs} prs` }
                      {` (Total: ${newTotal} Pairs)`}
                    </span>
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex justify-end gap-2 text-sm font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedGroup(null);
                    setAddQuantity(0);
                    setAddColor('');
                    setIsNewColor(false);
                  }}
                  className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!addColor.trim() || addQuantity <= 0}
                  onClick={async () => {
                    const res = await api.stock.logProduction({
                      movement_date: productionDate,
                      input_qty: addQuantity,
                      input_unit: qtyType === 'cartons' ? 'CARTONS' : 'PAIRS',
                      article_id: selectedGroup.articleId,
                      color: addColor.trim(),
                    });
                    if (!res.ok) {
                      fail(res.error.message);
                      return;
                    }
                    setSelectedGroup(null);
                    setAddQuantity(0);
                    setAddColor('');
                    setIsNewColor(false);
                    flash('Stock added and production logged.');
                    loadStock();
                  }}
                  className="px-4 py-2 bg-[#111c2a] text-[#B08D57] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Confirm Add &amp; Log
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Material Stock Adjustment Modal (deduct/reduce only — stock:reduce-vendor-stock is the
          only real backend operation, the demo's Add direction had no backend equivalent). */}
      {materialAdjModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200" style={{ borderColor: 'var(--border-color)' }}>
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
        onClose={() => setIsPreviewOpen(false)}
        title="Stock Inventory Report - Print Preview"
        orientation="portrait"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>
    </AppLayout>
  );
}
