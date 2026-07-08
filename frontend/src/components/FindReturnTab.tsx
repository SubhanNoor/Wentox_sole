import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import type { SaleReturn } from '@/types';
import { Search, Printer, Calendar, FileText, User, Edit2, Package } from 'lucide-react';

interface FindReturnTabProps {
  onEditReturn: (ret: SaleReturn) => void;
  onPrintReturn: (ret: SaleReturn) => void;
}

export default function FindReturnTab({ onEditReturn, onPrintReturn }: FindReturnTabProps) {
  const { state } = useApp();

  // ── Search Filter State ──────────────────────────────────────────────────────
  const [fromDate, setFromDate]             = useState('');
  const [toDate, setToDate]                 = useState('');
  const [customerQuery, setCustomerQuery]   = useState('');
  const [subCustomerQuery, setSubCustomerQuery] = useState('');
  const [billNoQuery, setBillNoQuery]       = useState('');
  const [biltyNoQuery, setBiltyNoQuery]     = useState('');
  const [articleFilter, setArticleFilter]   = useState('');
  const [missingFilter, setMissingFilter]   = useState<'all' | 'no_bilty'>('all');

  // ── Filtered Returns List ────────────────────────────────────────────────────
  const filteredReturns = useMemo(() => {
    let result = [...state.saleReturns];

    if (fromDate)  result = result.filter(r => r.date >= fromDate);
    if (toDate)    result = result.filter(r => r.date <= toDate);

    if (billNoQuery.trim()) {
      result = result.filter(r => r.billNo.includes(billNoQuery.trim()));
    }

    if (biltyNoQuery.trim()) {
      const q = biltyNoQuery.trim().toLowerCase();
      result = result.filter(r => (r.biltyNo || '').toLowerCase().includes(q));
    }

    if (customerQuery.trim()) {
      const q = customerQuery.toLowerCase();
      result = result.filter(r => {
        const name = state.customers.find(c => c.id === r.customerId)?.name.toLowerCase() || '';
        return name.includes(q);
      });
    }

    if (subCustomerQuery.trim()) {
      const q = subCustomerQuery.toLowerCase();
      result = result.filter(r => {
        if (!r.subCustomerId) return false;
        const name = state.subCustomers.find(sc => sc.id === r.subCustomerId)?.name.toLowerCase() || '';
        return name.includes(q);
      });
    }

    if (articleFilter) {
      result = result.filter(r =>
        r.items.some(item => item.productId === articleFilter)
      );
    }

    if (missingFilter === 'no_bilty') {
      result = result.filter(r => !r.biltyNo || !r.biltyNo.trim() || r.biltyNo === '0');
    }

    result.sort((a, b) => b.date.localeCompare(a.date));
    return result;
  }, [
    state.saleReturns, state.customers, state.subCustomers,
    fromDate, toDate, billNoQuery, biltyNoQuery,
    customerQuery, subCustomerQuery, articleFilter, missingFilter
  ]);

  const hasFilters = fromDate || toDate || billNoQuery || biltyNoQuery || customerQuery || subCustomerQuery || articleFilter || missingFilter !== 'all';

  const clearAllFilters = () => {
    setFromDate(''); setToDate(''); setBillNoQuery(''); setBiltyNoQuery('');
    setCustomerQuery(''); setSubCustomerQuery(''); setArticleFilter('');
    setMissingFilter('all');
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1200 }}>

      {/* ── Search Filters Card ─────────────────────────────────────────────── */}
      <div className="card-white p-5 bg-white border border-slate-200 rounded-xl mb-5 shadow-sm" data-no-print>
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

        {/* Row 1 — Date range, Bill No., Bilty No. */}
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
              {state.products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
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

      {/* ── Results Table ───────────────────────────────────────────────────── */}
      <div className="card-white bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="p-4 border-b bg-slate-50/60 flex items-center justify-between rounded-t-xl">
          <span className="text-sm font-semibold text-slate-700">
            Sale Returns&nbsp;
            <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-xs font-bold ml-1">{filteredReturns.length}</span>
          </span>
          <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs">
            <Printer size={12} /> Print Results
          </button>
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
                <th className="p-3.5 text-right pr-4">Total Credit</th>
                <th className="p-3.5 text-center pr-4" style={{ width: '110px' }}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredReturns.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center p-10 text-slate-400 text-sm">
                    No sale returns match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredReturns.map(ret => {
                  const cust     = state.customers.find(c => c.id === ret.customerId);
                  const subCust  = ret.subCustomerId ? state.subCustomers.find(sc => sc.id === ret.subCustomerId) : null;
                  const retValue = ret.items.reduce((sum, item) => sum + (item.value || 0), 0);
                  return (
                    <tr
                      key={ret.id}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="p-3.5 pl-4 font-mono text-slate-600 whitespace-nowrap">{ret.date}</td>
                      <td className="p-3.5 text-center">
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono">
                          {ret.id.replace('sr_', '')}
                        </span>
                      </td>
                      <td className="p-3.5 text-center font-mono font-bold text-slate-800">{ret.billNo}</td>
                      <td className="p-3.5 font-semibold text-slate-800">{cust?.name || 'Walk-in'}</td>
                      <td className="p-3.5 text-slate-600">
                        {subCust
                          ? <span className="text-slate-700 font-medium">{subCust.name}</span>
                          : <span className="text-slate-400 italic text-xs">SAME (Direct)</span>}
                      </td>
                      <td className="p-3.5 font-mono font-semibold">
                        {ret.biltyNo && ret.biltyNo !== '0'
                          ? <span className="text-slate-800">{ret.biltyNo}</span>
                          : <span className="bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider">Missing</span>}
                      </td>
                      <td className="p-3.5 font-mono font-semibold text-slate-600">{ret.gpNo || '-'}</td>
                      <td className="p-3.5 text-right font-mono font-bold text-amber-800 pr-4">{formatCurrency(retValue)}</td>
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
  );
}
