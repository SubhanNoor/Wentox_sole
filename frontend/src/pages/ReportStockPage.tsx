import { Fragment, useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Search, Printer, ChevronDown, ChevronRight, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';

interface ProductLedgerEntry {
  date: string;
  type: 'Production' | 'Sale' | 'Sale Return';
  ref: string;
  debit: number;  // IN
  credit: number; // OUT
}

const getColorFromName = (name: string): string => {
  const words = name.trim().split(/\s+/);
  const lastWord = words[words.length - 1];
  const colors = ['black', 'white', 'brown', 'tan', 'blue', 'red', 'green', 'yellow', 'grey', 'gray', 'pink', 'orange', 'navy', 'gold', 'silver', 'maroon'];
  if (colors.includes(lastWord.toLowerCase())) {
    return lastWord.charAt(0).toUpperCase() + lastWord.slice(1).toLowerCase();
  }
  for (const c of colors) {
    if (name.toLowerCase().includes(' ' + c) || name.toLowerCase().endsWith(c)) {
      return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
    }
  }
  return 'N/A';
};

const getCleanedArticleName = (name: string, color: string): string => {
  if (color !== 'N/A') {
    const idx = name.toLowerCase().lastIndexOf(color.toLowerCase());
    if (idx !== -1) {
      return name.substring(0, idx).trim();
    }
  }
  return name;
};

// Articles are grouped by their leading style code (e.g. "P-101" in
// "P-101 Jogger Sole Black") — different colors of the same article share
// this code and must appear together as one row with an expandable panel,
// not as separate rows.
const getArticleCode = (name: string): string => {
  const match = name.trim().match(/^([A-Za-z]+-\d+)/);
  return match ? match[1] : name.trim().split(/\s+/)[0];
};

const getCommonName = (name: string, code: string, color: string): string => {
  let rest = name.startsWith(code) ? name.slice(code.length).trim() : name;
  if (color !== 'N/A') {
    const idx = rest.toLowerCase().lastIndexOf(color.toLowerCase());
    if (idx !== -1) rest = rest.substring(0, idx).trim();
  }
  return rest;
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

const isDateInWeekOf = (targetDateStr: string, baseDateStr: string) => {
  const target = new Date(targetDateStr);
  const { start, end } = getWeekRange(baseDateStr);
  return target >= start && target <= end;
};

const isDateInMonthYear = (targetDateStr: string, month: number, year: number) => {
  const target = new Date(targetDateStr);
  return target.getMonth() === month && target.getFullYear() === year;
};

const getMonthName = (m: number): string => {
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return names[m];
};

export default function ReportStockPage() {
  const { state, dispatch } = useApp();

  const [activeStockTab, setActiveStockTab] = useState<'current' | 'ledger' | 'daily' | 'weekly' | 'monthly' | 'overall'>('current');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Add stock state variables
  const [selectedGroup, setSelectedGroup] = useState<{ code: string; commonName: string; categoryId: string; vendorId: string; packing: number; products: any[] } | null>(null);
  const [addQuantity, setAddQuantity] = useState<number>(0);
  const [qtyType, setQtyType] = useState<'cartons' | 'pairs'>('cartons');
  const [productionDate, setProductionDate] = useState(new Date().toISOString().split('T')[0]);
  const [addColor, setAddColor] = useState('');
  const [isNewColor, setIsNewColor] = useState(false);

  // Expandable row state (TASK-03) — keyed by article group code, not product id,
  // since all color variants of an article now live under one row.
  const [expandedArticleCode, setExpandedArticleCode] = useState<string | null>(null);

  const getProductLedgerEntries = (productIds: string[]): ProductLedgerEntry[] => {
    const idSet = new Set(productIds);
    const entries: ProductLedgerEntry[] = [];
    state.productionLogs
      .filter(l => idSet.has(l.productId))
      .forEach(l => entries.push({ date: l.date, type: 'Production', ref: l.id.replace('pl_', ''), debit: l.quantity, credit: 0 }));
    state.saleBills
      .filter(b => b.status === 'Posted')
      .forEach(b => b.items.filter(it => idSet.has(it.productId))
        .forEach(it => entries.push({ date: b.date, type: 'Sale', ref: b.billNo, debit: 0, credit: it.pairs })));
    state.saleReturns
      .filter(r => r.status === 'Posted')
      .forEach(r => r.items.filter(it => idSet.has(it.productId))
        .forEach(it => entries.push({ date: r.date, type: 'Sale Return', ref: r.billNo, debit: it.pairs, credit: 0 })));
    return entries.sort((a, b) => a.date.localeCompare(b.date));
  };

  // Production log filtering states
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().split('T')[0]);
  const [weeklyDate, setWeeklyDate] = useState(new Date().toISOString().split('T')[0]);
  const [monthlyMonth, setMonthlyMonth] = useState(new Date().getMonth());
  const [monthlyYear, setMonthlyYear] = useState(new Date().getFullYear());
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Product Ledger tab filtering state (TASK-02 / TASK-02 UPDATE)
  const [ledgerFromDate, setLedgerFromDate] = useState('');
  const [ledgerToDate, setLedgerToDate] = useState('');
  const [ledgerVendorFilter, setLedgerVendorFilter] = useState('all');

  // 1. Current stock filter memo
  const filteredProducts = useMemo(() => {
    let result = [...state.products];

    if (selectedCategory !== 'all') {
      result = result.filter(p => p.categoryId === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(q) || p.id.includes(q));
    }

    return result;
  }, [state.products, selectedCategory, searchQuery]);

  // Group products into articles: different colors of the same style code
  // (e.g. "P-101") are variants under one row, not separate rows.
  const groupedArticles = useMemo(() => {
    const groups: Record<string, { code: string; commonName: string; categoryId: string; vendorId: string; packing: number; products: typeof filteredProducts }> = {};
    filteredProducts.forEach(p => {
      const code = getArticleCode(p.name);
      const color = p.color || getColorFromName(p.name);
      const commonName = getCommonName(p.name, code, color);
      if (!groups[code]) {
        groups[code] = { code, commonName, categoryId: p.categoryId, vendorId: p.vendorId, packing: p.packing, products: [] };
      }
      groups[code].products.push(p);
    });
    return Object.values(groups).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [filteredProducts]);

  const totalPairs = useMemo(() => {
    return filteredProducts.reduce((sum, p) => sum + (p.stock || 0), 0);
  }, [filteredProducts]);

  const totalCartons = useMemo(() => {
    return filteredProducts.reduce((sum, p) => sum + Math.floor((p.stock || 0) / (p.packing || 12)), 0);
  }, [filteredProducts]);

  const totalExtraPairs = useMemo(() => {
    return filteredProducts.reduce((sum, p) => sum + ((p.stock || 0) % (p.packing || 12)), 0);
  }, [filteredProducts]);

  // 2. Production logs filter memo
  const filteredLogs = useMemo(() => {
    let logs = [...state.productionLogs];

    // Filter by tab timeframe
    if (activeStockTab === 'daily') {
      logs = logs.filter(log => log.date === dailyDate);
    } else if (activeStockTab === 'weekly') {
      logs = logs.filter(log => isDateInWeekOf(log.date, weeklyDate));
    } else if (activeStockTab === 'monthly') {
      logs = logs.filter(log => isDateInMonthYear(log.date, monthlyMonth, monthlyYear));
    } else if (activeStockTab === 'overall') {
      if (fromDate) {
        logs = logs.filter(log => log.date >= fromDate);
      }
      if (toDate) {
        logs = logs.filter(log => log.date <= toDate);
      }
    }

    // Filter by product query or category
    return logs.filter(log => {
      const prod = state.products.find(p => p.id === log.productId);
      if (!prod) return false;
      
      const matchesCategory = selectedCategory === 'all' || prod.categoryId === selectedCategory;
      const matchesQuery = !searchQuery.trim() || 
        prod.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        prod.id.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesCategory && matchesQuery;
    });
  }, [
    state.productionLogs, 
    activeStockTab, 
    dailyDate, 
    weeklyDate, 
    monthlyMonth, 
    monthlyYear, 
    fromDate, 
    toDate, 
    selectedCategory, 
    searchQuery,
    state.products
  ]);

  const totalProductionCartons = useMemo(() => {
    return filteredLogs.reduce((sum, log) => {
      return sum + (log.unitType === 'cartons' ? log.qtyValue : 0);
    }, 0);
  }, [filteredLogs]);

  const totalProductionPairsDirect = useMemo(() => {
    return filteredLogs.reduce((sum, log) => {
      return sum + (log.unitType === 'pairs' ? log.qtyValue : 0);
    }, 0);
  }, [filteredLogs]);

  const totalProductionPairs = useMemo(() => {
    return filteredLogs.reduce((sum, log) => sum + log.quantity, 0);
  }, [filteredLogs]);

  // 3. Product Ledger tab: full Debit(IN)/Credit(OUT) list across all articles,
  // filtered by date range, vendor, and article/category (TASK-02 / TASK-02 UPDATE)
  const ledgerTableEntries = useMemo(() => {
    const rows: (ProductLedgerEntry & { productId: string; productCode: string; articleName: string; color: string; vendorName: string })[] = [];

    filteredProducts.forEach(p => {
      if (ledgerVendorFilter !== 'all' && p.vendorId !== ledgerVendorFilter) return;
      const color = p.color || getColorFromName(p.name);
      const articleName = getCleanedArticleName(p.name, color);
      const vendorName = state.vendors.find(v => v.id === p.vendorId)?.name || 'General';

      getProductLedgerEntries([p.id]).forEach(entry => {
        if (ledgerFromDate && entry.date < ledgerFromDate) return;
        if (ledgerToDate && entry.date > ledgerToDate) return;
        rows.push({ ...entry, productId: p.id, productCode: p.id, articleName, color, vendorName });
      });
    });

    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredProducts, ledgerVendorFilter, ledgerFromDate, ledgerToDate, state.vendors, state.productionLogs, state.saleBills, state.saleReturns]);

  const ledgerTotals = useMemo(() => {
    return ledgerTableEntries.reduce((acc, e) => ({
      debit: acc.debit + e.debit,
      credit: acc.credit + e.credit
    }), { debit: 0, credit: 0 });
  }, [ledgerTableEntries]);

  const handleExportExcel = () => {
    if (activeStockTab === 'current') {
      const headers = ['Product Code', 'Category', 'Total Pairs'];
      const rows = groupedArticles.map(g => [g.code, state.categories.find(c => c.id === g.categoryId)?.name || 'General', g.products.reduce((s, p) => s + (p.stock || 0), 0)]);
      exportRowsToExcel('current-stock', headers, rows);
    } else if (activeStockTab === 'ledger') {
      const headers = ['Date', 'Product Code', 'Article', 'Color', 'Vendor', 'Type', 'Ref', 'Debit (IN)', 'Credit (OUT)'];
      const rows = ledgerTableEntries.map(e => [e.date, e.productCode, e.articleName, e.color, e.vendorName, e.type, e.ref, e.debit, e.credit]);
      exportRowsToExcel('product-ledger', headers, rows);
    } else {
      const headers = ['Date', 'Product Code', 'Article Name', 'Color', 'Category', 'Packing', 'Qty Added', 'Unit', 'Total Pairs'];
      const rows = filteredLogs.map(log => {
        const prod = state.products.find(p => p.id === log.productId);
        const color = prod?.color || getColorFromName(prod?.name || '');
        return [log.date, log.productId, prod ? getCleanedArticleName(prod.name, color) : '', color, prod ? (state.categories.find(c => c.id === prod.categoryId)?.name || 'General') : '', log.packing, log.qtyValue, log.unitType, log.quantity];
      });
      exportRowsToExcel(`production-${activeStockTab}`, headers, rows);
    }
  };

  return (
    <AppLayout pageTitle="Stock & Production Center">
      <div className="mx-auto" style={{ maxWidth: 1000 }}>
        
        {/* On-screen Tabs Selector - hidden on print */}
        <div className="flex border-b mb-6 text-sm font-semibold overflow-x-auto whitespace-nowrap" data-no-print style={{ borderColor: 'var(--border-color)' }}>
          <button
            onClick={() => setActiveStockTab('current')}
            className={`px-4 py-2 border-b-2 transition-colors ${
              activeStockTab === 'current'
                ? 'border-[#B08D57] text-[#111c2a]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Current Stock
          </button>
          <button
            onClick={() => setActiveStockTab('ledger')}
            className={`px-4 py-2 border-b-2 transition-colors ${
              activeStockTab === 'ledger'
                ? 'border-[#B08D57] text-[#111c2a]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Product Ledger
          </button>
          <button
            onClick={() => setActiveStockTab('daily')}
            className={`px-4 py-2 border-b-2 transition-colors ${
              activeStockTab === 'daily'
                ? 'border-[#B08D57] text-[#111c2a]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Daily Production
          </button>
          <button
            onClick={() => setActiveStockTab('weekly')}
            className={`px-4 py-2 border-b-2 transition-colors ${
              activeStockTab === 'weekly'
                ? 'border-[#B08D57] text-[#111c2a]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Weekly Production
          </button>
          <button
            onClick={() => setActiveStockTab('monthly')}
            className={`px-4 py-2 border-b-2 transition-colors ${
              activeStockTab === 'monthly'
                ? 'border-[#B08D57] text-[#111c2a]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Monthly Production
          </button>
          <button
            onClick={() => setActiveStockTab('overall')}
            className={`px-4 py-2 border-b-2 transition-colors ${
              activeStockTab === 'overall'
                ? 'border-[#B08D57] text-[#111c2a]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Overall Production
          </button>
        </div>

        {/* On-screen View - hidden on print */}
        <div data-no-print>
          {/* Search and Filters */}
          <div className="flex flex-col gap-4 p-4 rounded-xl border mb-6 bg-white shadow-sm" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 flex-1">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
                  <input
                    type="text"
                    placeholder="Search by article code or name..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="soleria-input pl-10 py-2 w-full text-sm"
                  />
                </div>
                
                <select
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                  className="soleria-input py-2 cursor-pointer text-sm max-w-[200px]"
                >
                  <option value="all">All Categories</option>
                  {state.categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
                  <Printer size={16} /> Print Report
                </button>
                <button onClick={exportToPDF} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
                  <FileDown size={16} /> Export PDF
                </button>
                <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
                  <FileSpreadsheet size={16} /> Export Excel
                </button>
              </div>
            </div>

            {/* Timeframe Filters based on Active Tab */}
            {activeStockTab !== 'current' && (
              <div className="flex flex-wrap items-center gap-4 pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
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
                      <select
                        value={ledgerVendorFilter}
                        onChange={e => setLedgerVendorFilter(e.target.value)}
                        className="soleria-input py-1.5 px-3 text-sm font-semibold cursor-pointer"
                      >
                        <option value="all">All Vendors</option>
                        {state.vendors.map(v => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
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
                      <select
                        value={monthlyMonth}
                        onChange={e => setMonthlyMonth(parseInt(e.target.value))}
                        className="soleria-input py-1.5 px-3 text-sm font-semibold cursor-pointer"
                      >
                        {Array.from({ length: 12 }, (_, i) => (
                          <option key={i} value={i}>{getMonthName(i)}</option>
                        ))}
                      </select>
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
            {activeStockTab === 'current' ? (
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
                        const catName = state.categories.find(c => c.id === group.categoryId)?.name || 'General';
                        const vendName = state.vendors.find(v => v.id === group.vendorId)?.name || 'General';
                        const groupTotalPairs = group.products.reduce((sum, p) => sum + (p.stock || 0), 0);
                        const isExpanded = expandedArticleCode === group.code;

                        return (
                          <Fragment key={group.code}>
                            <tr
                              className="border-b hover:bg-slate-50/50 cursor-pointer"
                              style={{ borderColor: 'var(--border-table)' }}
                              onClick={() => setExpandedArticleCode(isExpanded ? null : group.code)}
                            >
                              <td className="p-3 pl-4 text-slate-400">
                                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </td>
                              <td className="p-3 font-semibold text-slate-700">
                                {group.code}
                                <span className="block text-xs font-normal text-slate-500">
                                  {group.commonName} <span className="text-slate-400">({group.products.length} color{group.products.length !== 1 ? 's' : ''})</span>
                                </span>
                              </td>
                              <td className="p-3 text-slate-500">{catName}</td>
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
                                    setIsNewColor(group.products.length === 0);
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
                                  <div className="text-[11px] text-slate-400 mb-2">Vendor: {vendName}</div>

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
                                        {group.products.map(p => {
                                          const pPairs = p.stock || 0;
                                          const pPacking = p.packing || 12;
                                          const pCartons = Math.floor(pPairs / pPacking);
                                          const pRemPairs = pPairs % pPacking;
                                          const pColor = p.color || getColorFromName(p.name);
                                          return (
                                            <tr key={p.id} className="border-t" style={{ borderColor: 'var(--border-table)' }}>
                                              <td className="p-2 pl-3">
                                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                                                  pColor.toLowerCase() === 'black' ? 'bg-slate-900 text-white' :
                                                  pColor.toLowerCase() === 'white' ? 'bg-slate-100 text-slate-800 border border-slate-200' :
                                                  pColor.toLowerCase() === 'brown' ? 'bg-amber-900 text-amber-50' :
                                                  pColor.toLowerCase() === 'tan' ? 'bg-orange-100 text-orange-800' :
                                                  'bg-slate-100 text-slate-600'
                                                }`}>
                                                  {pColor}
                                                </span>
                                                <span className="ml-2 text-slate-400 font-mono">{p.id}</span>
                                              </td>
                                              <td className="p-2 text-center font-medium text-slate-700">{pPacking}</td>
                                              <td className="p-2 text-right font-bold text-slate-800">{pCartons}</td>
                                              <td className="p-2 text-right text-slate-700">{pRemPairs || '-'}</td>
                                              <td className="p-2 text-right pr-3 font-bold" style={{ color: 'var(--brand-gold)' }}>{pPairs.toLocaleString()}</td>
                                            </tr>
                                          );
                                        })}
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
            ) : activeStockTab === 'ledger' ? (
              // Product Ledger View (TASK-02 / TASK-02 UPDATE)
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
                    {ledgerTableEntries.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="text-center p-8 text-slate-400">
                          No product ledger movements found matching your filters.
                        </td>
                      </tr>
                    ) : (
                      ledgerTableEntries.map((entry, idx) => (
                        <tr key={idx} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-3 pl-4 font-mono text-slate-600">{entry.date}</td>
                          <td className="p-3 font-semibold text-slate-700">{entry.productCode}</td>
                          <td className="p-3 text-slate-700">{entry.articleName}</td>
                          <td className="p-3 text-slate-500">{entry.color}</td>
                          <td className="p-3 text-slate-500">{entry.vendorName}</td>
                          <td className="p-3">
                            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                              entry.type === 'Production' ? 'bg-emerald-50 text-emerald-700' :
                              entry.type === 'Sale' ? 'bg-rose-50 text-rose-700' :
                              'bg-blue-50 text-blue-700'
                            }`}>
                              {entry.type}
                            </span>
                          </td>
                          <td className="p-3 text-slate-500">{entry.ref}</td>
                          <td className="p-3 text-right font-semibold text-emerald-700">{entry.debit > 0 ? entry.debit : '-'}</td>
                          <td className="p-3 text-right font-semibold text-rose-700">{entry.credit > 0 ? entry.credit : '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                      <td colSpan={7} className="p-4 text-left font-lora">REPORT TOTAL</td>
                      <td className="p-4 text-right text-emerald-800">{ledgerTotals.debit.toLocaleString()}</td>
                      <td className="p-4 text-right text-rose-800">{ledgerTotals.credit.toLocaleString()}</td>
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
                      filteredLogs.map((log, idx) => {
                        const prod = state.products.find(p => p.id === log.productId);
                        if (!prod) return null;
                        const catName = state.categories.find(c => c.id === prod.categoryId)?.name || 'General';
                        const color = prod.color || getColorFromName(prod.name);
                        const cleanedName = getCleanedArticleName(prod.name, color);

                        return (
                          <tr key={log.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                            <td className="p-3 pl-4 font-mono text-slate-500">{idx + 1}</td>
                            <td className="p-3 text-slate-600 font-semibold">{log.date}</td>
                            <td className="p-3 font-semibold text-slate-700">{log.productId}</td>
                            <td className="p-3 font-semibold text-slate-800">{cleanedName}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                color.toLowerCase() === 'black' ? 'bg-slate-900 text-white' :
                                color.toLowerCase() === 'white' ? 'bg-slate-100 text-slate-800 border border-slate-200' :
                                color.toLowerCase() === 'brown' ? 'bg-amber-900 text-amber-50' :
                                color.toLowerCase() === 'tan' ? 'bg-orange-100 text-orange-800' :
                                'bg-slate-100 text-slate-600'
                              }`}>
                                {color}
                              </span>
                            </td>
                            <td className="p-3 text-slate-500">{catName}</td>
                            <td className="p-3 text-center text-slate-600 font-medium">{log.packing}</td>
                            <td className="p-3 text-right text-slate-700 font-bold">{log.qtyValue}</td>
                            <td className="p-3 text-right text-slate-500 capitalize">{log.unitType}</td>
                            <td className="p-3 text-right text-slate-900 font-bold">{log.quantity.toLocaleString()}</td>
                          </tr>
                        );
                      })
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

        {/* Printable Excel-style layout for physical printers */}
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
                {activeStockTab === 'daily' && 'DAILY PRODUCTION REPORT'}
                {activeStockTab === 'weekly' && 'WEEKLY PRODUCTION REPORT'}
                {activeStockTab === 'monthly' && 'MONTHLY PRODUCTION REPORT'}
                {activeStockTab === 'overall' && 'OVERALL PRODUCTION REPORT'}
              </h2>
              <p style={{ margin: 0, fontSize: '11px', color: '#555555' }}>
                {activeStockTab === 'current' && `Date: ${new Date().toLocaleDateString()}`}
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
              <span>{selectedCategory === 'all' ? 'ALL CATEGORIES' : (state.categories.find(c => c.id === selectedCategory)?.name || 'General')}</span>
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
                {filteredProducts.map((prod, idx) => {
                  const catName = state.categories.find(c => c.id === prod.categoryId)?.name || 'General';
                  const pairs = prod.stock || 0;
                  const packing = prod.packing || 12;
                  const cartons = Math.floor(pairs / packing);
                  const remPairs = pairs % packing;
                  const color = prod.color || getColorFromName(prod.name);
                  const cleanedName = getCleanedArticleName(prod.name, color);

                  return (
                    <tr key={prod.id}>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{idx + 1}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold' }}>{prod.id}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{cleanedName}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{color}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{catName}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{packing}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{cartons}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{remPairs > 0 ? remPairs : '-'}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold' }}>{pairs.toLocaleString()}</td>
                    </tr>
                  );
                })}
                <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2', fontSize: '12px' }}>
                  <td colSpan={6} style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', textTransform: 'uppercase' }}>Report Total:</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right' }}>{totalCartons}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right' }}>{totalExtraPairs > 0 ? totalExtraPairs : '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', borderBottom: '3px double #000000' }}>{totalPairs.toLocaleString()}</td>
                </tr>
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
                {filteredLogs.map((log, idx) => {
                  const prod = state.products.find(p => p.id === log.productId);
                  if (!prod) return null;
                  const catName = state.categories.find(c => c.id === prod.categoryId)?.name || 'General';
                  const color = prod.color || getColorFromName(prod.name);
                  const cleanedName = getCleanedArticleName(prod.name, color);

                  return (
                    <tr key={log.id}>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{idx + 1}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{log.date}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold' }}>{log.productId}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{cleanedName}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{color}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{catName}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{log.packing}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{log.qtyValue}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textTransform: 'capitalize' }}>{log.unitType}</td>
                      <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold' }}>{log.quantity.toLocaleString()}</td>
                    </tr>
                  );
                })}
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

      </div>

      {/* Add Stock Modal */}
      {selectedGroup && (() => {
        const matchedProduct = addColor.trim()
          ? selectedGroup.products.find(p => (p.color || getColorFromName(p.name)).toLowerCase() === addColor.trim().toLowerCase())
          : undefined;
        const basePacking = matchedProduct?.packing || selectedGroup.packing || 12;
        const baseStock = matchedProduct?.stock || 0;
        const existingColors = selectedGroup.products.map(p => p.color || getColorFromName(p.name));

        return (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
            <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
              <h3 className="font-lora font-bold text-lg text-slate-800 mb-2">
                Add Stock / Log Production
              </h3>
              <p className="text-xs text-slate-500 mb-4 font-semibold uppercase tracking-wider">
                {selectedGroup.code} — {selectedGroup.commonName}
              </p>

              {matchedProduct && (
                <div className="bg-slate-50 p-3 rounded-lg border mb-4 text-xs font-semibold text-slate-600 flex justify-between">
                  <div>
                    <span className="block text-[10px] uppercase text-slate-400">Current Stock ({matchedProduct.color || getColorFromName(matchedProduct.name)})</span>
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
                {!matchedProduct && addColor.trim() && (
                  <p className="text-[10px] text-amber-600 mt-1">
                    "{addColor.trim()}" is a new color — a new article record will be created for it.
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
                    onChange={e => setAddQuantity(Math.max(1, parseInt(e.target.value) || 0))}
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
                  disabled={!addColor.trim()}
                  onClick={() => {
                    const increment = qtyType === 'cartons' ? addQuantity * basePacking : addQuantity;

                    if (matchedProduct) {
                      // Existing color variant — increment its stock
                      dispatch({
                        type: 'UPDATE_PRODUCT',
                        product: { ...matchedProduct, stock: (matchedProduct.stock || 0) + increment }
                      });
                      dispatch({
                        type: 'ADD_PRODUCTION_LOG',
                        log: {
                          id: 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                          date: productionDate,
                          productId: matchedProduct.id,
                          quantity: increment,
                          qtyValue: addQuantity,
                          unitType: qtyType,
                          packing: matchedProduct.packing || 12
                        }
                      });
                    } else {
                      // New color variant — create a new product record under this article
                      const sibling = selectedGroup.products[0];
                      const nextId = String(Math.max(0, ...state.products.map(p => parseInt(p.id, 10) || 0)) + 1);
                      const newProduct = sibling
                        ? { ...sibling, id: nextId, name: `${selectedGroup.code} ${selectedGroup.commonName} ${addColor.trim()}`.trim(), color: addColor.trim(), stock: increment }
                        : { id: nextId, name: `${selectedGroup.code} ${selectedGroup.commonName} ${addColor.trim()}`.trim(), categoryId: selectedGroup.categoryId, vendorId: selectedGroup.vendorId, batchNo: 0, packing: selectedGroup.packing || 12, costPrice: 0, labour: 0, proiCost: 0, soleStich: 0, pasting: 0, trim: 0, finishing: 0, socksPasting: 0, dc: 0, sockStich: 0, sheet: 0, stubble: 0, bottom: 0, p1: 0, p2: 0, na: 0, color: addColor.trim(), stock: increment };

                      dispatch({ type: 'ADD_PRODUCT', product: newProduct });
                      dispatch({
                        type: 'ADD_PRODUCTION_LOG',
                        log: {
                          id: 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                          date: productionDate,
                          productId: nextId,
                          quantity: increment,
                          qtyValue: addQuantity,
                          unitType: qtyType,
                          packing: selectedGroup.packing || 12
                        }
                      });
                    }

                    setSelectedGroup(null);
                    setAddQuantity(0);
                    setAddColor('');
                    setIsNewColor(false);
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
    </AppLayout>
  );
}
