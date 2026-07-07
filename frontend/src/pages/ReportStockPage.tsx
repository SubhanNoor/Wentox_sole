import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Search, Printer } from 'lucide-react';

export default function ReportStockPage() {
  const { state } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

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
    return filteredProducts.reduce((sum, p) => sum + Math.round((p.stock || 0) / (p.packing || 12)), 0);
  }, [filteredProducts]);

  return (
    <AppLayout pageTitle="Current Stock Report">
      <div className="mx-auto" style={{ maxWidth: 1000 }}>
        
        {/* Search and Filters - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
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
              className="soleria-input py-2 cursor-pointer text-sm max-w-[220px]"
            >
              <option value="all">All Categories</option>
              {state.categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
            <Printer size={16} /> Print Stock Sheet
          </button>
        </div>

        {/* Printable Layout */}
        <div className="card-white p-6 md:p-8 bg-white border">
          <div className="hidden print:flex items-center justify-between border-b pb-4 mb-6">
            <div>
              <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTO ERP</h1>
              <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Footwear Distribution System</p>
            </div>
            <div className="text-right">
              <h2 className="font-lora font-semibold text-lg">CURRENT STOCK REPORT</h2>
              <p className="text-xs text-slate-500 font-mono">Printed on: {new Date().toLocaleDateString()}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">Product Code</th>
                  <th className="p-3">Article Name</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Vendor</th>
                  <th className="p-3 text-center">Packing</th>
                  <th className="p-3 text-right">Stock (Cartons)</th>
                  <th className="p-3 text-right">Stock (Pairs)</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center p-8 text-slate-400">
                      No products found matching stock criteria.
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map(prod => {
                    const catName = state.categories.find(c => c.id === prod.categoryId)?.name || 'General';
                    const vendName = state.vendors.find(v => v.id === prod.vendorId)?.name || 'General';
                    const pairs = prod.stock || 0;
                    const cartons = Math.floor(pairs / prod.packing);
                    const remPairs = pairs % prod.packing;

                    return (
                      <tr key={prod.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-mono font-semibold text-slate-700">{prod.id}</td>
                        <td className="p-3 font-semibold text-slate-800">{prod.name}</td>
                        <td className="p-3 text-slate-500">{catName}</td>
                        <td className="p-3 text-slate-500">{vendName}</td>
                        <td className="p-3 text-center font-mono text-slate-600">{prod.packing}</td>
                        <td className="p-3 text-right font-mono text-slate-700 font-semibold">
                          {cartons} ctn {remPairs > 0 ? `+ ${remPairs} prs` : ''}
                        </td>
                        <td className={`p-3 text-right font-mono font-semibold ${pairs <= 0 ? 'text-red-600' : 'text-slate-900'}`}>
                          {pairs.toLocaleString()} prs
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              
              {/* Report Summary */}
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                  <td colSpan={5} className="p-4 text-left font-lora">REPORT TOTAL</td>
                  <td className="p-4 text-right font-mono">{totalCartons} Cartons</td>
                  <td className="p-4 text-right font-mono text-emerald-800 text-lg" style={{ color: 'var(--brand-gold)' }}>
                    {totalPairs.toLocaleString()} Pairs
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
