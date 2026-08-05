import { useState, useEffect, useMemo } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { SaleReturnRow, SaleReturnItemRow, CustomerRow, SubCustomerRow, ProductRow } from '@/lib/api';
import { Search, Printer, Calendar, FileText, User, Edit2, Package, Layers, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';

interface FindReturnTabProps {
  onEditReturn: (ret: SaleReturnRow) => void;
  onPrintReturn: (ret: SaleReturnRow) => void;
}

export default function FindReturnTab({ onEditReturn, onPrintReturn }: FindReturnTabProps) {
  const [returns, setReturns] = useState<SaleReturnRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [subCustomers, setSubCustomers] = useState<SubCustomerRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);

  useEffect(() => {
    (async () => {
      const [c, sc, p] = await Promise.all([
        api.listCustomers(), api.listSubCustomers(), api.listProducts()
      ]);
      if (c.ok) setCustomers(c.data);
      if (sc.ok) setSubCustomers(sc.data);
      if (p.ok) setProducts(p.data);
    })();
  }, []);

  // ── Search Filter State ──────────────────────────────────────────────────────
  const [fromDate, setFromDate]             = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate]                 = useState(getTodayDate());
  const [customerQuery, setCustomerQuery]   = useState('');
  const [subCustomerQuery, setSubCustomerQuery] = useState('');
  const [billNoQuery, setBillNoQuery]       = useState('');
  const [biltyNoQuery, setBiltyNoQuery]     = useState('');
  const [articleFilter, setArticleFilter]   = useState('');
  const [missingFilter, setMissingFilter]   = useState<'all' | 'no_bilty'>('all');

  // list() doesn't include line items (only get() does) — fetched lazily per return only when the
  // Article filter is actually in use, and cached by return_id so re-filtering doesn't re-fetch.
  const [itemsCache, setItemsCache] = useState<Record<number, SaleReturnItemRow[]>>({});
  useEffect(() => {
    if (!articleFilter) return;
    const missing = returns.filter(r => !(r.return_id in itemsCache));
    if (!missing.length) return;
    (async () => {
      const results = await Promise.all(missing.map(r => api.saleReturns.get(r.return_id)));
      setItemsCache(prev => {
        const next = { ...prev };
        results.forEach((r, i) => { if (r.ok) next[missing[i].return_id] = r.data.items; });
        return next;
      });
    })();
  }, [articleFilter, returns, itemsCache]);

  // The backend filters by date range + exact bill number; everything else (name/agent/article/
  // audit pill) is applied client-side over the fetched result below.
  useEffect(() => {
    (async () => {
      const res = await api.saleReturns.list({
        date_from: fromDate || undefined,
        date_to: toDate || undefined,
        bill_no: billNoQuery.trim() || undefined
      });
      if (res.ok) setReturns(res.data);
    })();
  }, [fromDate, toDate, billNoQuery]);

  // ── Filtered Returns List ────────────────────────────────────────────────────
  const filteredReturns = useMemo(() => {
    let result = [...returns];

    if (biltyNoQuery.trim()) {
      const q = biltyNoQuery.trim().toLowerCase();
      result = result.filter(r => (r.bilty_no || '').toLowerCase().includes(q));
    }

    if (customerQuery.trim()) {
      const q = customerQuery.toLowerCase();
      result = result.filter(r => {
        const name = customers.find(c => c.customer_id === r.customer_id)?.name.toLowerCase() || '';
        return name.includes(q);
      });
    }

    if (subCustomerQuery.trim()) {
      const q = subCustomerQuery.toLowerCase();
      result = result.filter(r => {
        if (!r.sub_customer_id) return false;
        const name = subCustomers.find(sc => sc.sub_customer_id === r.sub_customer_id)?.name.toLowerCase() || '';
        return name.includes(q);
      });
    }

    if (articleFilter) {
      const product = products.find(p => p.article_id === Number(articleFilter));
      if (product) {
        result = result.filter(r => (itemsCache[r.return_id] || []).some(item => item.article_code === product.code));
      }
    }

    if (missingFilter === 'no_bilty') {
      result = result.filter(r => !r.bilty_no || !r.bilty_no.trim() || r.bilty_no === '0');
    }

    result.sort((a, b) => b.return_date.localeCompare(a.return_date));
    return result;
  }, [returns, customers, subCustomers, products, biltyNoQuery, customerQuery, subCustomerQuery, articleFilter, missingFilter, itemsCache]);

  const handleExportExcel = () => {
    const headers = ['Date', 'Sys ID', 'Bill No.', 'Customer', 'Cartons', 'Pairs', 'Total Value', 'Status'];
    const rows = filteredReturns.map(ret => {
      const cust = customers.find(c => c.customer_id === ret.customer_id);
      return [ret.return_date.slice(0, 10), ret.return_id, ret.bill_no, cust?.name || '-', ret.total_cartons, ret.total_pairs, ret.net_value, ret.is_posted ? 'Posted' : 'Unposted'];
    });
    exportRowsToExcel('sale-returns-search', headers, rows);
  };

  // Compute overall summary totals for return logs search
  const { totalCartons, totalPairs, totalValue } = useMemo(() => {
    let cartons = 0;
    let pairs = 0;
    let value = 0;
    filteredReturns.forEach(ret => {
      cartons += ret.total_cartons;
      pairs += ret.total_pairs;
      value += ret.net_value || 0;
    });
    return { totalCartons: cartons, totalPairs: pairs, totalValue: value };
  }, [filteredReturns]);

  const hasFilters = fromDate || toDate || billNoQuery || biltyNoQuery || customerQuery || subCustomerQuery || articleFilter || missingFilter !== 'all';

  const clearAllFilters = () => {
    setFromDate(getThreeMonthsAgoDate()); setToDate(getTodayDate()); setBillNoQuery(''); setBiltyNoQuery('');
    setCustomerQuery(''); setSubCustomerQuery(''); setArticleFilter('');
    setMissingFilter('all');
  };

  return (
    <>
      {/* ── Screen-only UI Container ── */}
      <div className="mx-auto print:hidden" style={{ maxWidth: 1200 }}>

        {/* ── Search Filters Card ── */}
        <div className="card-white p-5 bg-white border border-slate-200 rounded-xl mb-5 shadow-sm">
          <div className="flex items-center justify-between border-b pb-2 mb-4">
            <h3 className="font-lora font-semibold text-base text-slate-800 flex items-center gap-2">
              <Search size={16} className="text-blue-600" /> Search Filters
            </h3>
            {hasFilters && (
              <button onClick={clearAllFilters} className="text-xs text-red-500 hover:text-red-700 font-semibold transition-colors">
                Clear All
              </button>
            )}
          </div>

          {/* Row 1 — Date range, Return No., Bilty No. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                <Calendar size={12} /> From Date
              </label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input text-xs" />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                <Calendar size={12} /> To Date
              </label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input text-xs" />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                <FileText size={12} /> By Return No.
              </label>
              <input
                type="text" placeholder="e.g. RET-1004"
                value={billNoQuery} onChange={e => setBillNoQuery(e.target.value)}
                className="soleria-input text-xs font-mono"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                <FileText size={12} /> By Bilty No.
              </label>
              <input
                type="text" placeholder="e.g. 87412"
                value={biltyNoQuery} onChange={e => setBiltyNoQuery(e.target.value)}
                className="soleria-input text-xs font-mono"
              />
            </div>
          </div>

          {/* Row 2 — Customer, Sub-Customer, Article */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                <User size={12} /> By Customer
              </label>
              <input
                type="text" placeholder="Parent customer name..."
                value={customerQuery} onChange={e => setCustomerQuery(e.target.value)}
                className="soleria-input text-xs"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                <User size={12} /> By Delivery Agent / Sub-Cust
              </label>
              <input
                type="text" placeholder="Sub-customer or agent..."
                value={subCustomerQuery} onChange={e => setSubCustomerQuery(e.target.value)}
                className="soleria-input text-xs"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                <Package size={12} /> By Article
              </label>
              <select value={articleFilter} onChange={e => setArticleFilter(e.target.value)} className="soleria-input text-xs cursor-pointer">
                <option value="">All Articles</option>
                {products.map(p => (
                  <option key={p.article_id} value={p.article_id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick Audit Radio Pills */}
          <div className="flex flex-wrap items-center gap-2 border-t pt-4 mt-4 border-slate-100">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1">Quick Audit:</span>
            {([
              { value: 'all',      label: 'All Returns' },
              { value: 'no_bilty', label: 'Missing Bilty No.' },
            ] as const).map(opt => (
              <label
                key={opt.value}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold cursor-pointer transition-all select-none ${
                  missingFilter === opt.value
                    ? 'bg-[#111c2a] text-white border-[#111c2a] shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="missingFilter"
                  value={opt.value}
                  checked={missingFilter === opt.value}
                  onChange={() => setMissingFilter(opt.value)}
                  className="sr-only"
                />
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  missingFilter === opt.value ? 'bg-white/70' : 'bg-slate-300'
                }`} />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        {/* Summary Dashboard Panels (Visible on Screen only) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          <div className="card-white p-4 bg-white border border-slate-200 rounded-xl flex items-center justify-between shadow-sm">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Return Cartons</span>
              <h4 className="text-xl font-bold font-mono text-slate-800 mt-1">{totalCartons} ctn</h4>
            </div>
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Package size={20} />
            </div>
          </div>
          <div className="card-white p-4 bg-white border border-slate-200 rounded-xl flex items-center justify-between shadow-sm">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Return Pairs</span>
              <h4 className="text-xl font-bold font-mono text-slate-800 mt-1">{totalPairs.toLocaleString()} prs</h4>
            </div>
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Layers size={18} className="rotate-12" />
            </div>
          </div>
          <div className="card-white p-4 bg-white border border-slate-200 rounded-xl flex items-center justify-between shadow-sm">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cumulative Credit Value</span>
              <h4 className="text-xl font-bold font-mono text-rose-800 mt-1">{formatCurrency(totalValue)}</h4>
            </div>
            <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
              <FileText size={20} />
            </div>
          </div>
        </div>

        {/* ── Results Table ── */}
        <div className="card-white bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="p-4 border-b bg-slate-50/60 flex items-center justify-between rounded-t-xl">
            <span className="text-sm font-semibold text-slate-700">
              Sale Returns&nbsp;
              <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-xs font-bold ml-1">{filteredReturns.length}</span>
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs">
                <Printer size={12} /> Print Results
              </button>
              <button onClick={exportToPDF} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs">
                <FileDown size={12} /> Export PDF
              </button>
              <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs">
                <FileSpreadsheet size={12} /> Export Excel
              </button>
            </div>
          </div>

          <div className="overflow-hidden">
            <table className="w-full text-left border-collapse text-sm font-inter">
              <thead>
                <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500 border-slate-200">
                  <th className="p-3.5 pl-4">Date</th>
                  <th className="p-3.5 text-center">Sys ID</th>
                  <th className="p-3.5 text-center">Return No.</th>
                  <th className="p-3.5">Customer</th>
                  <th className="p-3.5">Delivery Agent</th>
                  <th className="p-3.5">Bilty No.</th>
                  <th className="p-3.5">GP No.</th>
                  <th className="p-3.5 text-right">Cartons</th>
                  <th className="p-3.5 text-right">Pairs</th>
                  <th className="p-3.5 text-right pr-4">Total Credit</th>
                  <th className="p-3.5 text-center pr-4" style={{ width: '110px' }}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredReturns.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center p-10 text-slate-400 text-sm">
                      No sale returns match the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredReturns.map(ret => {
                    const cust     = customers.find(c => c.customer_id === ret.customer_id);
                    const subCust  = ret.sub_customer_id ? subCustomers.find(sc => sc.sub_customer_id === ret.sub_customer_id) : null;
                    const retCartons = ret.total_cartons;
                    const retPairs = ret.total_pairs;

                    return (
                      <tr
                        key={ret.return_id}
                        className="hover:bg-slate-50/50 transition-colors"
                      >
                        <td className="p-3.5 pl-4 font-mono text-slate-600 whitespace-nowrap">{ret.return_date.slice(0, 10)}</td>
                        <td className="p-3.5 text-center">
                          <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono">
                            {ret.return_id}
                          </span>
                        </td>
                        <td className="p-3.5 text-center font-mono font-bold text-slate-800">{ret.bill_no}</td>
                        <td className="p-3.5 font-semibold text-slate-800">{cust?.name || 'Walk-in'}</td>
                        <td className="p-3.5 text-slate-600">
                          {subCust
                            ? <span className="text-slate-700 font-medium">{subCust.name}</span>
                            : <span className="text-slate-400 italic text-xs">SAME (Direct)</span>}
                        </td>
                        <td className="p-3.5 font-mono font-semibold">
                          {ret.bilty_no && ret.bilty_no !== '0'
                            ? <span className="text-slate-800">{ret.bilty_no}</span>
                            : <span className="bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider">Missing</span>}
                        </td>
                        <td className="p-3.5 font-mono font-semibold text-slate-600">{ret.gp_no || '-'}</td>
                        <td className="p-3.5 text-right font-mono font-semibold text-slate-700">{retCartons}</td>
                        <td className="p-3.5 text-right font-mono text-slate-700">{retPairs.toLocaleString()}</td>
                        <td className="p-3.5 text-right font-mono font-bold text-amber-800 pr-4">{formatCurrency(ret.net_value)}</td>
                        <td className="p-3.5 text-center pr-4" onClick={e => e.stopPropagation()}>
                          <div className="flex justify-center items-center gap-3">
                            <button
                              onClick={() => onEditReturn(ret)}
                              title="Edit Return"
                              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={() => onPrintReturn(ret)}
                              title="Print Return"
                              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                            >
                              <Printer size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Printable Excel-style layout for physical printers (A4) ── */}
      <div className="hidden print:block excel-print-container">
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '10px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>WENTOX WAREHOUSE</h1>
            <p style={{ margin: 0, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#555555' }}>
              Footwear Wholesale Distribution
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>SALE RETURNS DIRECTORY</h2>
            <p style={{ margin: 0, fontSize: '11px', color: '#555555' }}>Date of Print: {new Date().toLocaleDateString()}</p>
          </div>
        </div>

        {/* Filter context block to know what search parameters generated this print */}
        <div className="excel-grid-info" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', border: '1px solid #000000', marginBottom: '15px' }}>
          <div style={{ borderRight: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <strong>Date range:</strong> {fromDate || 'Start'} to {toDate || 'End'}
          </div>
          <div style={{ borderRight: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <strong>Customer Query:</strong> {customerQuery || 'All'}
          </div>
          <div style={{ borderRight: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
            <strong>Agent Query:</strong> {subCustomerQuery || 'All'}
          </div>
          <div style={{ padding: '5px 8px', fontSize: '11px' }}>
            <strong>Article Filter:</strong> {articleFilter ? (products.find(p => p.article_id === Number(articleFilter))?.name) : 'All'}
          </div>
        </div>

        {/* Excel Print Table */}
        <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Date</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>Sys ID</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>Return No.</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Customer</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Delivery Agent</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Bilty No.</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>GP No.</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Cartons</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Pairs</th>
              <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Total Credit</th>
            </tr>
          </thead>
          <tbody>
            {filteredReturns.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ border: '1px solid #000000', padding: '10px', fontSize: '11px', textAlign: 'center', color: '#666666' }}>
                  No returns found matching criteria.
                </td>
              </tr>
            ) : (
              filteredReturns.map(ret => {
                const cust = customers.find(c => c.customer_id === ret.customer_id);
                const subCust = ret.sub_customer_id ? subCustomers.find(sc => sc.sub_customer_id === ret.sub_customer_id) : null;
                const retCartons = ret.total_cartons;
                const retPairs = ret.total_pairs;

                return (
                  <tr key={ret.return_id}>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', fontFamily: 'monospace' }}>{ret.return_date.slice(0, 10)}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'center', fontFamily: 'monospace' }}>{ret.return_id}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'center', fontWeight: 'bold', fontFamily: 'monospace' }}>{ret.bill_no}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontWeight: 'bold' }}>{cust?.name || 'Walk-in'}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px' }}>{subCust ? subCust.name : '-'}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', fontFamily: 'monospace' }}>{ret.bilty_no && ret.bilty_no !== '0' ? ret.bilty_no : '-'}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px' }}>{ret.gp_no || '-'}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{retCartons}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace' }}>{retPairs}</td>
                    <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(ret.net_value)}</td>
                  </tr>
                );
              })
            )}

            {/* Summed totals footer row */}
            <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f9f9f9' }}>
              <td colSpan={7} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>REPORT TOTAL</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{totalCartons}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{totalPairs.toLocaleString()}</td>
              <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{formatCurrency(totalValue)}</td>
            </tr>
          </tbody>
        </table>

        {/* Manager/Auditor/Prepared Signatures block */}
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
      </div>
    </>
  );
}
