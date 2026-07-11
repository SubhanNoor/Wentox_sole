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
    return filteredProducts.reduce((sum, p) => sum + Math.floor((p.stock || 0) / (p.packing || 12)), 0);
  }, [filteredProducts]);

  const totalExtraPairs = useMemo(() => {
    return filteredProducts.reduce((sum, p) => sum + ((p.stock || 0) % (p.packing || 12)), 0);
  }, [filteredProducts]);

  return (
    <AppLayout pageTitle="Current Stock Report">
      <div className="mx-auto" style={{ maxWidth: 1000 }}>
        
        {/* On-screen View - hidden on print */}
        <div data-no-print>
          {/* Search and Filters */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }}>
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

          {/* On-screen Layout Table */}
          <div className="card-white p-6 md:p-8 bg-white border">
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
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center p-8 text-slate-400">
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
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Printable Excel-style layout for physical printers */}
        <div className="hidden print:block excel-print-container">
          <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '10px' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>WENTO ERP</h1>
              <p style={{ margin: 0, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#555555' }}>
                Footwear Wholesale Distribution
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>CURRENT STOCK REPORT</h2>
              <p style={{ margin: 0, fontSize: '11px', color: '#555555' }}>Date: {new Date().toLocaleDateString()}</p>
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

          {/* Signatures */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '60px', fontSize: '11px' }}>
            <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
              Prepared By
            </div>
            <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
              Checked By
            </div>
            <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
              Manager Stock
            </div>
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
