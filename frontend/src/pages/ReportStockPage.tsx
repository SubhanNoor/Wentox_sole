import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Search, Printer } from 'lucide-react';

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

  const [activeStockTab, setActiveStockTab] = useState<'current' | 'daily' | 'weekly' | 'monthly' | 'overall'>('current');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Add stock state variables
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [addQuantity, setAddQuantity] = useState<number>(0);
  const [qtyType, setQtyType] = useState<'cartons' | 'pairs'>('cartons');
  const [productionDate, setProductionDate] = useState(new Date().toISOString().split('T')[0]);

  // Production log filtering states
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().split('T')[0]);
  const [weeklyDate, setWeeklyDate] = useState(new Date().toISOString().split('T')[0]);
  const [monthlyMonth, setMonthlyMonth] = useState(new Date().getMonth());
  const [monthlyYear, setMonthlyYear] = useState(new Date().getFullYear());
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

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

              <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm shrink-0">
                <Printer size={16} /> Print Report
              </button>
            </div>

            {/* Timeframe Filters based on Active Tab */}
            {activeStockTab !== 'current' && (
              <div className="flex flex-wrap items-center gap-4 pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
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
                      <th className="p-3 pl-4">Product Code</th>
                      <th className="p-3">Article Name</th>
                      <th className="p-3">Color</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">Vendor</th>
                      <th className="p-3 text-center">Pairs / Carton</th>
                      <th className="p-3 text-right">Cartons</th>
                      <th className="p-3 text-right">Extra Pairs</th>
                      <th className="p-3 text-right">Total Pairs</th>
                      <th className="p-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="text-center p-8 text-slate-400">
                          No products found matching stock criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredProducts.map(prod => {
                        const catName = state.categories.find(c => c.id === prod.categoryId)?.name || 'General';
                        const vendName = state.vendors.find(v => v.id === prod.vendorId)?.name || 'General';
                        const pairs = prod.stock || 0;
                        const packing = prod.packing || 12;
                        const cartons = Math.floor(pairs / packing);
                        const remPairs = pairs % packing;
                        const color = prod.color || getColorFromName(prod.name);
                        const cleanedName = getCleanedArticleName(prod.name, color);

                        return (
                          <tr key={prod.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                            <td className="p-3 pl-4 font-semibold text-slate-700">{prod.id}</td>
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
                            <td className="p-3 text-slate-500">{vendName}</td>
                            <td className="p-3 text-center text-slate-600 font-medium">{packing}</td>
                            <td className="p-3 text-right text-slate-700 font-bold">
                              {cartons}
                            </td>
                            <td className="p-3 text-right text-slate-700 font-medium">
                              {remPairs > 0 ? `${remPairs}` : '-'}
                            </td>
                            <td className={`p-3 text-right font-bold ${pairs <= 0 ? 'text-red-600' : 'text-slate-900'}`}>
                              {pairs.toLocaleString()}
                            </td>
                            <td className="p-3 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedProduct(prod);
                                  setAddQuantity(1);
                                  setQtyType('cartons');
                                  setProductionDate(new Date().toISOString().split('T')[0]);
                                }}
                                className="border border-black rounded bg-transparent text-black hover:bg-slate-50 transition-colors flex items-center justify-center mx-auto font-black text-xs"
                                style={{ width: '22px', height: '22px' }}
                                title="Add Stock"
                              >
                                +
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  
                  <tfoot>
                    <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                      <td colSpan={6} className="p-4 text-left font-lora">REPORT TOTAL</td>
                      <td className="p-4 text-right text-slate-800 font-bold">{totalCartons} ctn</td>
                      <td className="p-4 text-right text-slate-700 font-medium">{totalExtraPairs > 0 ? `${totalExtraPairs} prs` : '-'}</td>
                      <td className="p-4 text-right text-emerald-800 text-lg" style={{ color: 'var(--brand-gold)' }}>
                        {totalPairs.toLocaleString()} Pairs
                      </td>
                      <td className="p-4"></td>
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
      {selectedProduct && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-2">
              Add Stock / Log Production
            </h3>
            <p className="text-xs text-slate-500 mb-4 font-semibold uppercase tracking-wider">
              {selectedProduct.id} — {getCleanedArticleName(selectedProduct.name, selectedProduct.color || getColorFromName(selectedProduct.name))}
            </p>

            <div className="bg-slate-50 p-3 rounded-lg border mb-4 text-xs font-semibold text-slate-600 flex justify-between">
              <div>
                <span className="block text-[10px] uppercase text-slate-400">Current Stock</span>
                <span className="text-slate-800 font-bold">
                  {Math.floor((selectedProduct.stock || 0) / (selectedProduct.packing || 12))} ctn
                  { (selectedProduct.stock || 0) % (selectedProduct.packing || 12) > 0 && ` & ${(selectedProduct.stock || 0) % (selectedProduct.packing || 12)} prs` }
                  {` (Total: ${selectedProduct.stock || 0} Pairs)`}
                </span>
              </div>
              <div className="text-right">
                <span className="block text-[10px] uppercase text-slate-400">Packing</span>
                <span className="text-slate-800">{selectedProduct.packing || 12} Pairs/Ctn</span>
              </div>
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
                  autoFocus
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

            {/* Will become preview */}
            {(() => {
              const increment = qtyType === 'cartons' ? addQuantity * (selectedProduct.packing || 12) : addQuantity;
              const newTotal = (selectedProduct.stock || 0) + increment;
              const newCartons = Math.floor(newTotal / (selectedProduct.packing || 12));
              const newRemPairs = newTotal % (selectedProduct.packing || 12);
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
                  setSelectedProduct(null);
                  setAddQuantity(0);
                }}
                className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const increment = qtyType === 'cartons' ? addQuantity * (selectedProduct.packing || 12) : addQuantity;
                  const updatedProd = {
                    ...selectedProduct,
                    stock: (selectedProduct.stock || 0) + increment
                  };
                  
                  // 1. Update product stock level in state
                  dispatch({
                    type: 'UPDATE_PRODUCT',
                    product: updatedProd
                  });

                  // 2. Add production log record
                  dispatch({
                    type: 'ADD_PRODUCTION_LOG',
                    log: {
                      id: 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                      date: productionDate,
                      productId: selectedProduct.id,
                      quantity: increment,
                      qtyValue: addQuantity,
                      unitType: qtyType,
                      packing: selectedProduct.packing || 12
                    }
                  });

                  setSelectedProduct(null);
                  setAddQuantity(0);
                }}
                className="px-4 py-2 bg-[#111c2a] text-[#B08D57] rounded-lg hover:opacity-90 transition-opacity"
              >
                Confirm Add &amp; Log
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
