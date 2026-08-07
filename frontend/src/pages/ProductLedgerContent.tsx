import { useState, useEffect, useCallback } from 'react';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { ProductLedgerResult, CategoryRow, VendorRow, StockMovementType } from '@/lib/api';

const MOVEMENT_TYPE_LABEL: Record<StockMovementType, string> = {
  PRODUCTION: 'Production',
  SALE: 'Sale',
  SALE_RETURN: 'Sale Return',
  OPENING: 'Opening',
  ADJUSTMENT: 'Adjustment',
};

// Standalone Product Ledger — full pairs IN/OUT history per article, filterable by date range,
// vendor, and article/category. This is the same report embedded as a tab inside the Stock page,
// exposed here as its own report for the unified Reports hub.
export default function ProductLedgerContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());
  const [vendorFilter, setVendorFilter] = useState('all');

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [result, setResult] = useState<ProductLedgerResult>({ rows: [], total_in: 0, total_out: 0, net: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listCategories().then(r => { if (r.ok) setCategories(r.data); });
    api.listVendors().then(r => { if (r.ok) setVendors(r.data); });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.productLedger({
      category_id: selectedCategory !== 'all' ? Number(selectedCategory) : undefined,
      vendor_id: vendorFilter !== 'all' ? Number(vendorFilter) : undefined,
      search: searchQuery.trim() || undefined,
      date_from: fromDate || undefined,
      date_to: toDate || undefined,
    });
    if (res.ok) setResult(res.data);
    setLoading(false);
  }, [selectedCategory, vendorFilter, searchQuery, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

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
          <div className="w-48">
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
          <div className="w-48">
            <SearchableSelect
              options={[
                { value: 'all', label: 'All Vendors' },
                ...vendors.map(v => ({ value: String(v.vendor_id), label: v.name }))
              ]}
              value={vendorFilter}
              onChange={setVendorFilter}
              placeholder="All Vendors"
              searchPlaceholder="Filter vendor..."
            />
          </div>
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
              {loading ? (
                <tr><td colSpan={9} className="text-center p-8 text-slate-400">Loading…</td></tr>
              ) : result.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center p-8 text-slate-400">
                    No product ledger movements found matching your filters.
                  </td>
                </tr>
              ) : (
                result.rows.map((entry) => (
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
                <td className="p-4 text-right text-emerald-800">{result.total_in.toLocaleString()}</td>
                <td className="p-4 text-right text-rose-800">{result.total_out.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
