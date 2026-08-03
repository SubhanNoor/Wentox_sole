import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';

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
    if (idx !== -1) return name.substring(0, idx).trim();
  }
  return name;
};

// Standalone Product Ledger — full pairs IN/OUT history per article,
// filterable by date range, vendor, and article/category (TASK-02 / UPDATE).
// This is the same report embedded as a tab inside the Stock page, exposed
// here as its own report for the unified Reports hub (TASK-19).
export default function ProductLedgerContent() {
  const { state } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());
  const [vendorFilter, setVendorFilter] = useState('all');

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

  const getProductLedgerEntries = (productId: string): ProductLedgerEntry[] => {
    const entries: ProductLedgerEntry[] = [];
    state.productionLogs
      .filter(l => l.productId === productId)
      .forEach(l => entries.push({ date: l.date, type: 'Production', ref: l.id.replace('pl_', ''), debit: l.quantity, credit: 0 }));
    state.saleBills
      .filter(b => b.status === 'Posted')
      .forEach(b => b.items.filter(it => it.productId === productId)
        .forEach(it => entries.push({ date: b.date, type: 'Sale', ref: b.billNo, debit: 0, credit: it.pairs })));
    state.saleReturns
      .filter(r => r.status === 'Posted')
      .forEach(r => r.items.filter(it => it.productId === productId)
        .forEach(it => entries.push({ date: r.date, type: 'Sale Return', ref: r.billNo, debit: it.pairs, credit: 0 })));
    return entries.sort((a, b) => a.date.localeCompare(b.date));
  };

  const ledgerTableEntries = useMemo(() => {
    const rows: (ProductLedgerEntry & { productId: string; productCode: string; articleName: string; color: string; vendorName: string })[] = [];

    filteredProducts.forEach(p => {
      if (vendorFilter !== 'all' && p.vendorId !== vendorFilter) return;
      const color = p.color || getColorFromName(p.name);
      const articleName = getCleanedArticleName(p.name, color);
      const vendorName = state.vendors.find(v => v.id === p.vendorId)?.name || 'General';

      getProductLedgerEntries(p.id).forEach(entry => {
        if (fromDate && entry.date < fromDate) return;
        if (toDate && entry.date > toDate) return;
        rows.push({ ...entry, productId: p.id, productCode: p.id, articleName, color, vendorName });
      });
    });

    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredProducts, vendorFilter, fromDate, toDate, state.vendors, state.productionLogs, state.saleBills, state.saleReturns]);

  const ledgerTotals = useMemo(() => {
    return ledgerTableEntries.reduce((acc, e) => ({
      debit: acc.debit + e.debit,
      credit: acc.credit + e.credit
    }), { debit: 0, credit: 0 });
  }, [ledgerTableEntries]);

  return (
    <div className="mx-auto" style={{ maxWidth: 1100 }}>
      {/* Filter Bar - data-no-print */}
      <div className="flex flex-col gap-4 p-4 rounded-xl border mb-6 bg-white shadow-sm" style={{ borderColor: 'var(--border-color)' }} data-no-print>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search by article code or name..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="soleria-input py-2 text-sm flex-1 min-w-[200px]"
          />
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
          <select
            value={vendorFilter}
            onChange={e => setVendorFilter(e.target.value)}
            className="soleria-input py-2 cursor-pointer text-sm max-w-[200px]"
          >
            <option value="all">All Vendors</option>
            {state.vendors.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500 uppercase">From:</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1.5 px-3 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1.5 px-3 text-sm" />
          </div>
        </div>
      </div>

      <div className="card-white p-6 md:p-8 bg-white border">
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
      </div>
    </div>
  );
}
