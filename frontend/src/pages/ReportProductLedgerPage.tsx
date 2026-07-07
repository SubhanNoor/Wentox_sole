import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Printer, BookOpen } from 'lucide-react';

interface LedgerRow {
  date: string;
  type: 'Initial Stock' | 'Sale Bill' | 'Sale Return';
  refId: string;
  partyName: string;
  storeName: string;
  inQty: number; // returned pairs
  outQty: number; // sold pairs
}

export default function ReportProductLedgerPage() {
  const { state } = useApp();

  const [productId, setProductId] = useState('');

  // Find the selected product details
  const selectedProduct = useMemo(() => {
    return state.products.find(p => p.id === productId);
  }, [productId, state.products]);

  // Compute ledger entries
  const ledgerEntries = useMemo(() => {
    if (!productId) return [];

    const entries: LedgerRow[] = [];

    // 1. Gather Posted Sale Bills
    state.saleBills.forEach(bill => {
      if (bill.status !== 'Posted') return;
      
      const item = bill.items.find(it => it.productId === productId);
      if (item) {
        const custName = state.customers.find(c => c.id === bill.customerId)?.name || 'Direct';
        const storeName = state.stores.find(s => s.id === bill.storeId)?.name || 'Main';
        entries.push({
          date: bill.date,
          type: 'Sale Bill',
          refId: bill.billNo,
          partyName: custName,
          storeName,
          inQty: 0,
          outQty: item.pairs
        });
      }
    });

    // 2. Gather Posted Sale Returns
    state.saleReturns.forEach(ret => {
      if (ret.status !== 'Posted') return;

      const item = ret.items.find(it => it.productId === productId);
      if (item) {
        const custName = state.customers.find(c => c.id === ret.customerId)?.name || 'Direct';
        const storeName = state.stores.find(s => s.id === ret.storeId)?.name || 'Main';
        entries.push({
          date: ret.date,
          type: 'Sale Return',
          refId: ret.billNo,
          partyName: custName,
          storeName,
          inQty: item.pairs,
          outQty: 0
        });
      }
    });

    // Sort by Date
    entries.sort((a, b) => a.date.localeCompare(b.date));

    return entries;
  }, [productId, state.saleBills, state.saleReturns, state.customers, state.stores]);

  // Calculate Running Balance
  const runningLedger = useMemo(() => {
    let runningBalance = 0;
    
    // We can assume the final current stock is what is in state.products.
    // So the initial stock at the very beginning = Current Stock + Total Out - Total In.
    const totalOut = ledgerEntries.reduce((sum, e) => sum + e.outQty, 0);
    const totalIn = ledgerEntries.reduce((sum, e) => sum + e.inQty, 0);
    const currentStock = selectedProduct?.stock || 0;
    const initialStock = Math.max(0, currentStock + totalOut - totalIn);

    runningBalance = initialStock;

    const finalRows = [
      {
        date: '---',
        type: 'Initial Stock' as const,
        refId: '-',
        partyName: 'Opening Balance',
        storeName: '-',
        inQty: initialStock,
        outQty: 0,
        balance: initialStock
      },
      ...ledgerEntries.map(e => {
        runningBalance = runningBalance + e.inQty - e.outQty;
        return {
          ...e,
          balance: runningBalance
        };
      })
    ];

    return finalRows;
  }, [ledgerEntries, selectedProduct]);

  return (
    <AppLayout pageTitle="Product Ledger Report">
      <div className="mx-auto" style={{ maxWidth: 1000 }}>
        
        {/* Selection bar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex items-center gap-3 flex-1">
            <span className="text-sm font-semibold text-slate-600">Select Footwear Article:</span>
            <select
              value={productId}
              onChange={e => setProductId(e.target.value)}
              className="soleria-input py-2 cursor-pointer text-sm max-w-[320px]"
            >
              <option value="">Select an article...</option>
              {state.products.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => window.print()}
            disabled={!productId}
            className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
          >
            <Printer size={16} /> Print Ledger
          </button>
        </div>

        {/* Ledger Sheet */}
        {productId ? (
          <div className="card-white p-6 md:p-8 bg-white border">
            
            {/* Header info */}
            <div className="flex items-center justify-between border-b pb-4 mb-6">
              <div>
                <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTO ERP</h1>
                <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Lahore Footwear Manufacturing</p>
              </div>
              <div className="text-right">
                <h2 className="font-lora font-semibold text-lg uppercase">Product Ledger</h2>
                <div className="text-sm font-semibold text-slate-700 mt-1">{selectedProduct?.name}</div>
                <div className="text-xs text-slate-500 font-mono">Article Code: {selectedProduct?.id} | Packing: {selectedProduct?.packing}</div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Date</th>
                    <th className="p-3">Voucher Type</th>
                    <th className="p-3 text-center">Ref Bill No.</th>
                    <th className="p-3">Customer / Supplier</th>
                    <th className="p-3">Store Location</th>
                    <th className="p-3 text-right">In (Pairs)</th>
                    <th className="p-3 text-right">Out (Pairs)</th>
                    <th className="p-3 text-right">Balance (Pairs)</th>
                  </tr>
                </thead>
                <tbody>
                  {runningLedger.map((row, idx) => (
                    <tr
                      key={idx}
                      className={`border-b text-slate-700 ${row.type === 'Initial Stock' ? 'bg-slate-50 font-medium' : 'hover:bg-slate-50/30'}`}
                      style={{ borderColor: 'var(--border-table)' }}
                    >
                      <td className="p-3 pl-4 font-mono">{row.date}</td>
                      <td className="p-3">
                        <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-bold ${row.type === 'Sale Bill' ? 'bg-red-50 text-red-700' : row.type === 'Sale Return' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                          {row.type}
                        </span>
                      </td>
                      <td className="p-3 text-center font-mono">{row.refId}</td>
                      <td className="p-3 font-semibold">{row.partyName}</td>
                      <td className="p-3 text-slate-500">{row.storeName}</td>
                      <td className="p-3 text-right font-mono text-blue-600">
                        {row.inQty > 0 ? `+${row.inQty}` : '-'}
                      </td>
                      <td className="p-3 text-right font-mono text-red-600">
                        {row.outQty > 0 ? `-${row.outQty}` : '-'}
                      </td>
                      <td className="p-3 text-right font-mono font-bold" style={{ color: 'var(--brand-gold)' }}>
                        {row.balance.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        ) : (
          <div className="card-white p-12 bg-slate-50/50 border text-center flex flex-col items-center justify-center text-slate-400">
            <BookOpen size={48} className="text-slate-300 mb-3" />
            <p className="font-lora text-lg font-semibold text-slate-500 mb-1 font-inter">No Article Selected</p>
            <p className="text-sm max-w-sm">Please select a footwear article from the dropdown above to generate its stock flow ledger.</p>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
