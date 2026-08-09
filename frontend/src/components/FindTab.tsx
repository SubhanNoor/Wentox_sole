import { useState, useEffect, useMemo } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { SaleBillRow, SaleBillItemRow, CustomerRow, SubCustomerRow, AddaRow, ProductRow } from '@/lib/api';
import { Search, Printer, Calendar, FileText, User, Edit2, Package, Truck, Layers, RotateCcw, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate } from '@/lib/utils';
import SearchableSelect from '@/components/SearchableSelect';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

interface FindTabProps {
  onEditBill: (bill: SaleBillRow) => void;
  onPrintBill: (bill: SaleBillRow) => void;
}

export default function FindTab({ onEditBill, onPrintBill }: FindTabProps) {
  const [bills, setBills] = useState<SaleBillRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [subCustomers, setSubCustomers] = useState<SubCustomerRow[]>([]);
  const [addas, setAddas] = useState<AddaRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, sc, ad, p] = await Promise.all([
        api.listCustomers(), api.listSubCustomers(), api.listAddas(), api.listProducts()
      ]);
      if (c.ok) setCustomers(c.data);
      if (sc.ok) setSubCustomers(sc.data);
      if (ad.ok) setAddas(ad.data);
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
  const [addaFilter, setAddaFilter]         = useState('');
  const [articleFilter, setArticleFilter]   = useState('');
  const [missingFilter, setMissingFilter]   = useState<'all' | 'missingBilty' | 'missingAdda'>('all');

  const [itemsCache, setItemsCache] = useState<Record<number, SaleBillItemRow[]>>({});
  useEffect(() => {
    if (!articleFilter) return;
    const missing = bills.filter(b => !(b.bill_id in itemsCache));
    if (!missing.length) return;
    (async () => {
      const results = await Promise.all(missing.map(b => api.saleBills.get(b.bill_id)));
      setItemsCache(prev => {
        const next = { ...prev };
        results.forEach((res, i) => { if (res.ok) next[missing[i].bill_id] = res.data.items; });
        return next;
      });
    })();
  }, [articleFilter, bills, itemsCache]);

  useEffect(() => {
    (async () => {
      const res = await api.saleBills.list({
        date_from: fromDate || undefined,
        date_to: toDate || undefined,
        bill_no: billNoQuery.trim() || undefined
      });
      if (res.ok) setBills(res.data);
    })();
  }, [fromDate, toDate, billNoQuery]);

  const filteredInvoices = useMemo(() => {
    let result = [...bills];

    if (biltyNoQuery.trim()) {
      const q = biltyNoQuery.trim().toLowerCase();
      result = result.filter(b => (b.bilty_no || '').toLowerCase().includes(q));
    }

    if (customerQuery.trim()) {
      const q = customerQuery.toLowerCase();
      result = result.filter(b => {
        const name = customers.find(c => c.customer_id === b.customer_id)?.name.toLowerCase() || '';
        return name.includes(q);
      });
    }

    if (subCustomerQuery.trim()) {
      const q = subCustomerQuery.toLowerCase();
      result = result.filter(b => {
        if (!b.sub_customer_id) return false;
        const name = subCustomers.find(sc => sc.sub_customer_id === b.sub_customer_id)?.name.toLowerCase() || '';
        return name.includes(q);
      });
    }

    if (addaFilter) {
      result = result.filter(b => b.adda_id === Number(addaFilter));
    }

    if (articleFilter) {
      const product = products.find(p => p.article_id === Number(articleFilter));
      if (product) {
        result = result.filter(b => (itemsCache[b.bill_id] || []).some(item => item.article_code === product.code));
      }
    }

    if (missingFilter === 'missingBilty') {
      result = result.filter(b => !b.bilty_no || !b.bilty_no.trim());
    } else if (missingFilter === 'missingAdda') {
      result = result.filter(b => !b.adda_id);
    }

    result.sort((a, b) => b.bill_date.localeCompare(a.bill_date));
    return result;
  }, [bills, customers, subCustomers, biltyNoQuery, customerQuery, subCustomerQuery, addaFilter, articleFilter, missingFilter, itemsCache, products]);

  const { totalCartons, totalPairs, totalValue } = useMemo(() => {
    let cartons = 0;
    let pairs = 0;
    let value = 0;
    filteredInvoices.forEach(b => {
      cartons += b.total_cartons;
      pairs += b.total_pairs;
      value += b.net_value;
    });
    return { totalCartons: cartons, totalPairs: pairs, totalValue: value };
  }, [filteredInvoices]);

  const handleExportExcel = () => {
    const headers = ['Date', 'Sys ID', 'Bill No.', 'Customer', 'Cartons', 'Pairs', 'Invoice Value', 'Status'];
    const rows = filteredInvoices.map(bill => {
      const cust = customers.find(c => c.customer_id === bill.customer_id);
      return [formatDate(bill.bill_date), bill.bill_id, bill.bill_no, cust?.name || '-', bill.total_cartons, bill.total_pairs, bill.net_value, bill.is_posted ? 'Posted' : 'Unposted'];
    });
    exportRowsToExcel('sale-bills-search', headers, rows);
  };

  const hasFilters = fromDate || toDate || billNoQuery || biltyNoQuery || customerQuery || subCustomerQuery || addaFilter || articleFilter || missingFilter !== 'all';

  const clearAllFilters = () => {
    setFromDate(getThreeMonthsAgoDate()); setToDate(getTodayDate()); setBillNoQuery(''); setBiltyNoQuery('');
    setCustomerQuery(''); setSubCustomerQuery(''); setAddaFilter(''); setArticleFilter('');
    setMissingFilter('all');
  };

  const renderPrintableDocument = () => (
    <div className="excel-print-container">
      {/* Header Section with Huge Prominent Logo */}
      <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
        <div>
          <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '180px', width: 'auto', objectFit: 'contain' }} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>SALES INVOICES DIRECTORY</h2>
          <p style={{ margin: '6px 0 0 0', fontSize: '13px', fontWeight: 'bold', color: '#111111' }}>
            Period: {fromDate ? formatDate(fromDate) : 'Start'} to {toDate ? formatDate(toDate) : 'End'}
          </p>
          <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
            Date of Print: {formatDate(new Date())}
          </p>
          {(customerQuery || addaFilter || articleFilter || subCustomerQuery || biltyNoQuery || missingFilter !== 'all') && (
            <div style={{ marginTop: '6px', fontSize: '10.5px', color: '#444444' }}>
              {customerQuery && <span style={{ marginRight: '10px' }}><strong>Customer:</strong> {customerQuery}</span>}
              {subCustomerQuery && <span style={{ marginRight: '10px' }}><strong>Sub-Customer:</strong> {subCustomerQuery}</span>}
              {addaFilter && <span style={{ marginRight: '10px' }}><strong>Adda:</strong> {addas.find(a => a.adda_id === Number(addaFilter))?.name}</span>}
              {articleFilter && <span style={{ marginRight: '10px' }}><strong>Article:</strong> {products.find(p => p.article_id === Number(articleFilter))?.name}</span>}
              {biltyNoQuery && <span style={{ marginRight: '10px' }}><strong>Bilty #:</strong> {biltyNoQuery}</span>}
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
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>Bill No.</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Customer</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Sub-Customer</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Bilty No.</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Adda Transport</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Cartons</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Pairs</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Invoice Value</th>
          </tr>
        </thead>
        <tbody>
          {filteredInvoices.length === 0 ? (
            <tr>
              <td colSpan={10} style={{ border: '1px solid #000000', padding: '10px', fontSize: '11px', textAlign: 'center', color: '#666666' }}>
                No invoices found matching criteria.
              </td>
            </tr>
          ) : (
            filteredInvoices.map(bill => {
              const cust = customers.find(c => c.customer_id === bill.customer_id);
              const subCust = bill.sub_customer_id ? subCustomers.find(sc => sc.sub_customer_id === bill.sub_customer_id) : null;
              const adda = addas.find(ad => ad.adda_id === bill.adda_id);

              return (
                <tr key={bill.bill_id}>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', fontFamily: 'monospace' }}>{formatDate(bill.bill_date)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'center', fontFamily: 'monospace' }}>{bill.bill_id}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'center', fontWeight: 'bold', fontFamily: 'monospace' }}>{bill.bill_no}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontWeight: 'bold' }}>{cust?.name || 'Walk-in'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px' }}>{subCust ? subCust.name : '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', fontFamily: 'monospace' }}>{bill.bilty_no || '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px' }}>{adda ? adda.name : '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{bill.total_cartons}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace' }}>{bill.total_pairs}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(bill.net_value)}</td>
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

      {/* Manager/Auditor/Prepared Signatures & Print Info footer */}
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
        <div>WENTOX FOOTWEAR DISTRIBUTION</div>
        <div>Printed: {formatDate(new Date())} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
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

          {/* Row 1 — Date range, Bill No., Bilty No. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                <Calendar size={12} /> From Date
              </label>
              <input type="date"
            value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input text-xs" />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                <Calendar size={12} /> To Date
              </label>
              <input type="date"
            value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input text-xs" />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                <FileText size={12} /> By Bill No.
              </label>
              <input
                type="text" placeholder="e.g. 10046"
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

          {/* Row 2 — Customer, Sub-Customer, Adda, Article */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
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
                <Truck size={12} /> By Adda Transport
              </label>
              <select value={addaFilter} onChange={e => setAddaFilter(e.target.value)} className="soleria-input text-xs">
                <option value="">All Transport Addas</option>
                {addas.map(a => <option key={a.adda_id} value={a.adda_id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
                <Package size={12} /> By Article Product
              </label>
              <SearchableSelect
                options={products.map(p => ({ value: String(p.article_id), label: `${p.code} — ${p.name}` }))}
                value={articleFilter}
                onChange={val => setArticleFilter(val ? String(val) : '')}
                placeholder="All Articles"
              />
            </div>
          </div>

          {/* Quick Missing Flags Pills */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-500 font-medium">Quick Exception Filters:</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMissingFilter('all')}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  missingFilter === 'all'
                    ? 'bg-[#111c2a] text-[#B08D57] shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                All Records
              </button>
              <button
                type="button"
                onClick={() => setMissingFilter('missingBilty')}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  missingFilter === 'missingBilty'
                    ? 'bg-[#111c2a] text-[#B08D57] shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                Missing Bilty No.
              </button>
              <button
                type="button"
                onClick={() => setMissingFilter('missingAdda')}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  missingFilter === 'missingAdda'
                    ? 'bg-[#111c2a] text-[#B08D57] shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                Missing Transport Adda
              </button>
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
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider group-hover:text-[var(--brand-navy)] transition-colors">Cumulative Net Value</span>
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
              Sale Invoices&nbsp;
              <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-xs font-bold ml-1">{filteredInvoices.length}</span>
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
                  <th className="p-3.5 text-center">Bill No.</th>
                  <th className="p-3.5">Customer</th>
                  <th className="p-3.5">Sub-Customer</th>
                  <th className="p-3.5">Bilty No.</th>
                  <th className="p-3.5">Adda Transport</th>
                  <th className="p-3.5 text-right">Cartons</th>
                  <th className="p-3.5 text-right">Pairs</th>
                  <th className="p-3.5 text-right pr-4">Invoice Value</th>
                  <th className="p-3.5 text-center pr-4" style={{ width: '110px' }}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center p-10 text-slate-400 text-sm">
                      No sale bills match the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map(bill => {
                    const cust     = customers.find(c => c.customer_id === bill.customer_id);
                    const subCust  = bill.sub_customer_id ? subCustomers.find(sc => sc.sub_customer_id === bill.sub_customer_id) : null;
                    const adda     = addas.find(ad => ad.adda_id === bill.adda_id);

                    return (
                      <tr
                        key={bill.bill_id}
                        className="hover:bg-slate-50/50 transition-colors"
                      >
                        <td className="p-3.5 pl-4 font-mono text-slate-600 whitespace-nowrap">{formatDate(bill.bill_date)}</td>
                        <td className="p-3.5 text-center">
                          <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono">
                            {bill.bill_id}
                          </span>
                        </td>
                        <td className="p-3.5 text-center font-mono font-bold text-slate-800">{bill.bill_no}</td>
                        <td className="p-3.5 font-semibold text-slate-800">{cust?.name || 'Walk-in'}</td>
                        <td className="p-3.5 text-slate-600">
                          {subCust
                            ? <span className="text-slate-700 font-medium">{subCust.name}</span>
                            : <span className="text-slate-400 italic text-xs">SAME (Direct)</span>}
                        </td>
                        <td className="p-3.5 font-mono font-semibold">
                          {bill.bilty_no
                            ? <span className="text-slate-800">{bill.bilty_no}</span>
                            : <span className="bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider">Missing</span>}
                        </td>
                        <td className="p-3.5 text-slate-600 font-medium">
                          {adda
                            ? <span className="text-slate-800 font-medium">{adda.name}</span>
                            : <span className="bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider">Unassigned</span>}
                        </td>
                        <td className="p-3.5 text-right font-mono font-semibold text-slate-700">{bill.total_cartons}</td>
                        <td className="p-3.5 text-right font-mono text-slate-700">{bill.total_pairs.toLocaleString()}</td>
                        <td className="p-3.5 text-right font-mono font-bold text-slate-900 pr-4">{formatCurrency(bill.net_value)}</td>
                        <td className="p-3.5 text-center pr-4" onClick={e => e.stopPropagation()}>
                          <div className="flex justify-center items-center gap-1.5">
                            <button
                              onClick={() => onEditBill(bill)}
                              title="Edit Bill"
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              onClick={() => onPrintBill(bill)}
                              title="Print Bill"
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
        title="Sales Invoices Directory - Print Preview"
        orientation="portrait"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>
    </>
  );
}
