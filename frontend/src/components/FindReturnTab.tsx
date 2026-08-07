import { useState, useEffect, useMemo } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { SaleReturnRow, SaleReturnItemRow, CustomerRow, SubCustomerRow, ProductRow } from '@/lib/api';
import { Search, Printer, Calendar, FileText, User, Edit2, Package, Layers, RotateCcw, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

interface FindReturnTabProps {
  onEditReturn: (ret: SaleReturnRow) => void;
  onPrintReturn: (ret: SaleReturnRow) => void;
}

export default function FindReturnTab({ onEditReturn, onPrintReturn }: FindReturnTabProps) {
  const [returns, setReturns] = useState<SaleReturnRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [subCustomers, setSubCustomers] = useState<SubCustomerRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

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
  const [returnNoQuery, setReturnNoQuery]   = useState('');
  const [biltyNoQuery, setBiltyNoQuery]     = useState('');
  const [gpNoQuery, setGpNoQuery]           = useState('');
  const [articleFilter, setArticleFilter]   = useState('');

  const [itemsCache, setItemsCache] = useState<Record<number, SaleReturnItemRow[]>>({});
  useEffect(() => {
    if (!articleFilter) return;
    const missing = returns.filter(r => !(r.return_id in itemsCache));
    if (!missing.length) return;
    (async () => {
      const results = await Promise.all(missing.map(r => api.saleReturns.get(r.return_id)));
      setItemsCache(prev => {
        const next = { ...prev };
        results.forEach((res, i) => { if (res.ok) next[missing[i].return_id] = res.data.items; });
        return next;
      });
    })();
  }, [articleFilter, returns, itemsCache]);

  useEffect(() => {
    (async () => {
      const res = await api.saleReturns.list({
        date_from: fromDate || undefined,
        date_to: toDate || undefined,
        bill_no: returnNoQuery.trim() || undefined
      });
      if (res.ok) setReturns(res.data);
    })();
  }, [fromDate, toDate, returnNoQuery]);

  const filteredReturns = useMemo(() => {
    let result = [...returns];

    if (biltyNoQuery.trim()) {
      const q = biltyNoQuery.trim().toLowerCase();
      result = result.filter(r => (r.bilty_no || '').toLowerCase().includes(q));
    }

    if (gpNoQuery.trim()) {
      const q = gpNoQuery.trim().toLowerCase();
      result = result.filter(r => (r.gp_no || '').toLowerCase().includes(q));
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

    result.sort((a, b) => b.return_date.localeCompare(a.return_date));
    return result;
  }, [returns, customers, subCustomers, biltyNoQuery, gpNoQuery, customerQuery, subCustomerQuery, articleFilter, itemsCache, products]);

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

  const handleExportExcel = () => {
    const headers = ['Date', 'Sys ID', 'Return No.', 'Customer', 'Cartons', 'Pairs', 'Total Value', 'Status'];
    const rows = filteredReturns.map(ret => {
      const cust = customers.find(c => c.customer_id === ret.customer_id);
      return [ret.return_date.slice(0, 10), ret.return_id, ret.bill_no, cust?.name || '-', ret.total_cartons, ret.total_pairs, ret.net_value, ret.is_posted ? 'Posted' : 'Unposted'];
    });
    exportRowsToExcel('sale-returns-search', headers, rows);
  };

  const hasFilters = fromDate || toDate || returnNoQuery || biltyNoQuery || gpNoQuery || customerQuery || subCustomerQuery || articleFilter;

  const clearAllFilters = () => {
    setFromDate(getThreeMonthsAgoDate()); setToDate(getTodayDate()); setReturnNoQuery(''); setBiltyNoQuery('');
    setGpNoQuery(''); setCustomerQuery(''); setSubCustomerQuery(''); setArticleFilter('');
  };

  const renderPrintableDocument = () => (
    <div className="excel-print-container">
      {/* Header Section with Huge Prominent Logo */}
      <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
        <div>
          <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '180px', width: 'auto', objectFit: 'contain' }} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>SALE RETURNS DIRECTORY</h2>
          <p style={{ margin: '6px 0 0 0', fontSize: '13px', fontWeight: 'bold', color: '#111111' }}>
            Period: {fromDate || 'Start'} to {toDate || 'End'}
          </p>
          <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
            Date of Print: {new Date().toLocaleDateString()}
          </p>
          {(customerQuery || returnNoQuery || biltyNoQuery || gpNoQuery || subCustomerQuery) && (
            <div style={{ marginTop: '6px', fontSize: '10.5px', color: '#444444' }}>
              {customerQuery && <span style={{ marginRight: '10px' }}><strong>Customer:</strong> {customerQuery}</span>}
              {subCustomerQuery && <span style={{ marginRight: '10px' }}><strong>Sub-Customer:</strong> {subCustomerQuery}</span>}
              {returnNoQuery && <span style={{ marginRight: '10px' }}><strong>Return #:</strong> {returnNoQuery}</span>}
              {biltyNoQuery && <span style={{ marginRight: '10px' }}><strong>Bilty #:</strong> {biltyNoQuery}</span>}
              {gpNoQuery && <span style={{ marginRight: '10px' }}><strong>GP #:</strong> {gpNoQuery}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Results Table */}
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

              return (
                <tr key={ret.return_id}>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', fontFamily: 'monospace' }}>{ret.return_date.slice(0, 10)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'center', fontFamily: 'monospace' }}>{ret.return_id}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'center', fontWeight: 'bold', fontFamily: 'monospace' }}>{ret.bill_no}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontWeight: 'bold' }}>{cust?.name || 'Walk-in'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px' }}>{subCust ? subCust.name : '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', fontFamily: 'monospace' }}>{ret.bilty_no || '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', fontFamily: 'monospace' }}>{ret.gp_no || '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{ret.total_cartons}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace' }}>{ret.total_pairs}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(ret.net_value)}</td>
                </tr>
              );
            })
          )}

          <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f9f9f9' }}>
            <td colSpan={7} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>REPORT TOTAL</td>
            <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{totalCartons}</td>
            <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{totalPairs.toLocaleString()}</td>
            <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{formatCurrency(totalValue)}</td>
          </tr>
        </tbody>
      </table>

      {/* Signatures */}
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
  );

  return (
    <>
      {/* Screen-only UI Container */}
      <div className="mx-auto print:hidden px-2" style={{ maxWidth: 1400 }}>

        {/* Search Filters Card */}
        <div className="card-white p-5 bg-white border border-slate-200/80 rounded-2xl mb-5 shadow-2xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
              <Search size={18} className="text-[var(--brand-navy)]" /> Search Filters
            </h3>
            {hasFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-rose-600 bg-rose-50/80 hover:bg-rose-100/80 border border-rose-200/80 rounded-lg transition-all cursor-pointer shadow-2xs hover:shadow-xs"
              >
                <RotateCcw size={13} className="text-rose-500" />
                <span>Clear All</span>
              </button>
            )}
          </div>

          {/* Row 1 — Date range, Return No., Bilty No., GP No. */}
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
                type="text" placeholder="e.g. 10046"
                value={returnNoQuery} onChange={e => setReturnNoQuery(e.target.value)}
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

          {/* Row 2 — Customer, Sub-Customer, GP No. */}
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
                <User size={12} /> By Sub-Customer
              </label>
              <input
                type="text" placeholder="Sub-customer / agent..."
                value={subCustomerQuery} onChange={e => setSubCustomerQuery(e.target.value)}
                className="soleria-input text-xs"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                <FileText size={12} /> By Gate Pass (GP) No.
              </label>
              <input
                type="text" placeholder="e.g. GP-54"
                value={gpNoQuery} onChange={e => setGpNoQuery(e.target.value)}
                className="soleria-input text-xs font-mono"
              />
            </div>
          </div>
        </div>

        {/* Summary Dashboard Panels */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="group relative bg-white p-5 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider group-hover:text-[var(--brand-navy)] transition-colors">Total Filtered Cartons</span>
              <h4 className="text-2xl font-bold font-mono text-slate-900 mt-1">{totalCartons} ctn</h4>
            </div>
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center transition-transform group-hover:scale-110">
              <Package size={22} />
            </div>
          </div>
          <div className="group relative bg-white p-5 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider group-hover:text-[var(--brand-navy)] transition-colors">Total Filtered Pairs</span>
              <h4 className="text-2xl font-bold font-mono text-slate-900 mt-1">{totalPairs.toLocaleString()} prs</h4>
            </div>
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center transition-transform group-hover:scale-110">
              <Layers size={20} className="rotate-12" />
            </div>
          </div>
          <div className="group relative bg-white p-5 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider group-hover:text-[var(--brand-navy)] transition-colors">Cumulative Credit Total</span>
              <h4 className="text-2xl font-bold font-mono text-[var(--brand-gold)] mt-1">{formatCurrency(totalValue)}</h4>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center transition-transform group-hover:scale-110">
              <FileText size={22} />
            </div>
          </div>
        </div>

        {/* Results Table Card */}
        <div className="card-white bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="p-4 border-b bg-slate-50/60 flex items-center justify-between rounded-t-xl">
            <span className="text-sm font-semibold text-slate-700">
              Sale Returns&nbsp;
              <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-xs font-bold ml-1">{filteredReturns.length}</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPreviewOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
              >
                <Eye size={14} /> Show Print Preview
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
                          {ret.bilty_no
                            ? <span className="text-slate-800">{ret.bilty_no}</span>
                            : <span className="bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider">Missing</span>}
                        </td>
                        <td className="p-3.5 font-mono text-slate-700">{ret.gp_no || '-'}</td>
                        <td className="p-3.5 text-right font-mono font-semibold text-slate-700">{ret.total_cartons}</td>
                        <td className="p-3.5 text-right font-mono text-slate-700">{ret.total_pairs.toLocaleString()}</td>
                        <td className="p-3.5 text-right font-mono font-bold text-slate-900 pr-4">{formatCurrency(ret.net_value)}</td>
                        <td className="p-3.5 text-center pr-4" onClick={e => e.stopPropagation()}>
                          <div className="flex justify-center items-center gap-1.5">
                            <button
                              onClick={() => onEditReturn(ret)}
                              title="Edit Return"
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={() => onPrintReturn(ret)}
                              title="Print Return"
                              className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-500 hover:text-[var(--brand-gold)] transition-colors cursor-pointer"
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

      {/* Native @media print container */}
      <div className="hidden print:block">
        {renderPrintableDocument()}
      </div>

      {/* Full-Screen Interactive Print Preview Modal */}
      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Sale Returns Directory - Print Preview"
        orientation="portrait"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>
    </>
  );
}
