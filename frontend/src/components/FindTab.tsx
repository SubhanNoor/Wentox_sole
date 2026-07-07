import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import type { SaleBill } from '@/types';
import { Search, Printer, Calendar, FileText, User, Pencil, Package, Truck } from 'lucide-react';

interface FindTabProps {
  onEditBill: (bill: SaleBill) => void;
  onPrintBill: (bill: SaleBill) => void;
}

export default function FindTab({ onEditBill, onPrintBill }: FindTabProps) {
  const { state } = useApp();

  // ── Search Filter State ──────────────────────────────────────────────────────
  const [fromDate, setFromDate]             = useState('');
  const [toDate, setToDate]                 = useState('');
  const [customerQuery, setCustomerQuery]   = useState('');
  const [subCustomerQuery, setSubCustomerQuery] = useState('');
  const [billNoQuery, setBillNoQuery]       = useState('');
  const [biltyNoQuery, setBiltyNoQuery]     = useState('');
  const [addaFilter, setAddaFilter]         = useState('');
  const [articleFilter, setArticleFilter]   = useState('');
  const [missingFilter, setMissingFilter]   = useState<'all' | 'no_adda' | 'no_bilty' | 'no_any'>('all');

  // ── Filtered Invoice List ────────────────────────────────────────────────────
  const filteredInvoices = useMemo(() => {
    let result = [...state.saleBills];

    if (fromDate)  result = result.filter(b => b.date >= fromDate);
    if (toDate)    result = result.filter(b => b.date <= toDate);

    if (billNoQuery.trim()) {
      result = result.filter(b => b.billNo.includes(billNoQuery.trim()));
    }

    if (biltyNoQuery.trim()) {
      const q = biltyNoQuery.trim().toLowerCase();
      result = result.filter(b => (b.biltyNo || '').toLowerCase().includes(q));
    }

    if (customerQuery.trim()) {
      const q = customerQuery.toLowerCase();
      result = result.filter(b => {
        const name = state.customers.find(c => c.id === b.customerId)?.name.toLowerCase() || '';
        return name.includes(q);
      });
    }

    if (subCustomerQuery.trim()) {
      const q = subCustomerQuery.toLowerCase();
      result = result.filter(b => {
        if (!b.subCustomerId) return false;
        const name = state.subCustomers.find(sc => sc.id === b.subCustomerId)?.name.toLowerCase() || '';
        return name.includes(q);
      });
    }

    if (addaFilter) {
      result = result.filter(b => b.addaId === addaFilter);
    }

    if (articleFilter) {
      result = result.filter(b =>
        b.items.some(item => item.productId === articleFilter)
      );
    }

    if (missingFilter === 'no_adda')  result = result.filter(b => !b.addaId);
    if (missingFilter === 'no_bilty') result = result.filter(b => !b.biltyNo || !b.biltyNo.trim());
    if (missingFilter === 'no_any')   result = result.filter(b => !b.addaId || !b.biltyNo || !b.biltyNo.trim());

    result.sort((a, b) => b.date.localeCompare(a.date));
    return result;
  }, [
    state.saleBills, state.customers, state.subCustomers,
    fromDate, toDate, billNoQuery, biltyNoQuery,
    customerQuery, subCustomerQuery, addaFilter, articleFilter, missingFilter
  ]);

  const hasFilters = fromDate || toDate || billNoQuery || biltyNoQuery || customerQuery || subCustomerQuery || addaFilter || articleFilter || missingFilter !== 'all';

  const clearAllFilters = () => {
    setFromDate(''); setToDate(''); setBillNoQuery(''); setBiltyNoQuery('');
    setCustomerQuery(''); setSubCustomerQuery(''); setAddaFilter(''); setArticleFilter('');
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
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
              <Truck size={12} /> By Adda
            </label>
            <select value={addaFilter} onChange={e => setAddaFilter(e.target.value)} className="soleria-input text-xs cursor-pointer">
              <option value="">All Addas</option>
              {state.addas.map(ad => (
                <option key={ad.id} value={ad.id}>{ad.name}</option>
              ))}
            </select>
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
            { value: 'all',      label: 'All Invoices' },
            { value: 'no_adda',  label: 'Missing Adda' },
            { value: 'no_bilty', label: 'Missing Bilty No.' },
            { value: 'no_any',   label: 'Missing Bilty or Adda' },
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
            Sale Bills&nbsp;
            <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-xs font-bold ml-1">{filteredInvoices.length}</span>
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
                <th className="p-3.5 text-center">Bill No.</th>
                <th className="p-3.5">Customer</th>
                <th className="p-3.5">Sub-Customer</th>
                <th className="p-3.5">Bilty No.</th>
                <th className="p-3.5">Adda</th>
                <th className="p-3.5 text-center pr-4" style={{ width: '110px' }}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center p-10 text-slate-400 text-sm">
                    No invoices match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map(bill => {
                  const cust     = state.customers.find(c => c.id === bill.customerId);
                  const subCust  = bill.subCustomerId ? state.subCustomers.find(sc => sc.id === bill.subCustomerId) : null;
                  const adda     = state.addas.find(ad => ad.id === bill.addaId);
                  return (
                    <tr
                      key={bill.id}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="p-3.5 pl-4 font-mono text-slate-600 whitespace-nowrap">{bill.date}</td>
                      <td className="p-3.5 text-center">
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono">
                          {bill.id.replace('sb_', '')}
                        </span>
                      </td>
                      <td className="p-3.5 text-center font-mono font-bold text-slate-800">{bill.billNo}</td>
                      <td className="p-3.5 font-semibold text-slate-800">{cust?.name || 'Walk-in'}</td>
                      <td className="p-3.5 text-slate-600">
                        {subCust
                          ? <span className="text-slate-700 font-medium">{subCust.name}</span>
                          : <span className="text-slate-400 italic text-xs">SAME (Direct)</span>}
                      </td>
                      <td className="p-3.5 font-mono font-semibold">
                        {bill.biltyNo
                          ? <span className="text-slate-800">{bill.biltyNo}</span>
                          : <span className="bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider">Missing</span>}
                      </td>
                      <td className="p-3.5">
                        {adda
                          ? <span className="text-slate-700 font-medium">{adda.name}</span>
                          : <span className="bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider">Unassigned</span>}
                      </td>
                      <td className="p-3.5 text-center pr-4" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-center items-center gap-3">
                          <button
                            onClick={() => onEditBill(bill)}
                            title="Edit Bill"
                            className="w-8 h-8 rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 hover:text-amber-800 border border-amber-200 shadow-sm transition-all flex items-center justify-center hover:scale-105"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => onPrintBill(bill)}
                            title="Print Bill"
                            className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-800 border border-blue-200 shadow-sm transition-all flex items-center justify-center hover:scale-105"
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
