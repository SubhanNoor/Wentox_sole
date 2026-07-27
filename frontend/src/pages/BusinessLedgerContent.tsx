import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';

interface ActivityEntry {
  date: string;
  type: string;
  ref: string;
  debit: number;
  credit: number;
}

// Business Accounts Ledger (TASK-19 item 6) — a general-purpose ledger over
// ALL business accounts (not just customers), since Account Ledger (Khaata)
// is scoped to customers only and Vendor Report is scoped to vendors only.
export default function BusinessLedgerContent() {
  const { state } = useApp();

  const [viewMode, setViewMode] = useState<'summary' | 'detail' | 'customer'>('summary');
  const [accountFilter, setAccountFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const inRange = (date: string) => (!fromDate || date >= fromDate) && (!toDate || date <= toDate);

  const visibleAccounts = useMemo(() => {
    if (viewMode === 'customer') {
      return state.businessAccounts.filter(b => b.controlId === '110001');
    }
    return state.businessAccounts;
  }, [state.businessAccounts, viewMode]);

  // Net activity (Debit - Credit) for a business account within the range,
  // sourced from whichever ledger applies to that account's type.
  const getAccountActivity = (baId: string): { debit: number; credit: number } => {
    const cust = state.customers.find(c => c.id === baId);
    if (cust) {
      const debit = state.saleBills
        .filter(b => b.customerId === cust.id && b.status === 'Posted' && inRange(b.date))
        .reduce((s, b) => s + b.totalValue, 0);
      const credit = state.saleReturns
        .filter(r => r.customerId === cust.id && r.status === 'Posted' && inRange(r.date))
        .reduce((s, r) => s + r.items.reduce((si, it) => si + it.value, 0), 0)
        + state.receipts
        .filter(r => r.customerId === cust.id && inRange(r.date))
        .reduce((s, r) => s + r.amount + (r.commission || 0), 0);
      return { debit, credit };
    }

    const vendor = state.vendors.find(v => v.baId === baId);
    if (vendor) {
      const debit = state.purchases
        .filter(p => p.vendorId === vendor.id && inRange(p.date))
        .reduce((s, p) => s + p.totalValue, 0);
      const credit = state.purchaseReturns
        .filter(r => r.vendorId === vendor.id && inRange(r.date))
        .reduce((s, r) => s + r.totalValue, 0)
        + state.expenses
        .filter(e => e.businessAccountId === baId && inRange(e.date))
        .reduce((s, e) => s + e.amount, 0);
      return { debit, credit };
    }

    const credit = state.expenses
      .filter(e => e.businessAccountId === baId && inRange(e.date))
      .reduce((s, e) => s + e.amount, 0);
    return { debit: 0, credit };
  };

  const summaryRows = useMemo(() => {
    return visibleAccounts.map(b => {
      const chartName = state.chartAccounts.find(c => c.id === b.controlId)?.name || 'UNKNOWN';
      const activity = getAccountActivity(b.id);
      return { ...b, chartName, ...activity };
    });
  }, [visibleAccounts, state.chartAccounts, state.customers, state.vendors, state.saleBills, state.saleReturns, state.receipts, state.purchases, state.purchaseReturns, state.expenses, fromDate, toDate]);

  const selectedAccount = useMemo(() => state.businessAccounts.find(b => b.id === accountFilter), [accountFilter, state.businessAccounts]);

  const detailEntries = useMemo((): ActivityEntry[] => {
    if (!selectedAccount) return [];
    const entries: ActivityEntry[] = [];
    const cust = state.customers.find(c => c.id === selectedAccount.id);
    const vendor = state.vendors.find(v => v.baId === selectedAccount.id);

    if (cust) {
      state.saleBills.filter(b => b.customerId === cust.id && b.status === 'Posted' && inRange(b.date))
        .forEach(b => entries.push({ date: b.date, type: 'Sale Bill', ref: b.billNo, debit: b.totalValue, credit: 0 }));
      state.saleReturns.filter(r => r.customerId === cust.id && r.status === 'Posted' && inRange(r.date))
        .forEach(r => entries.push({ date: r.date, type: 'Sale Return', ref: r.billNo, debit: 0, credit: r.items.reduce((s, it) => s + it.value, 0) }));
      state.receipts.filter(r => r.customerId === cust.id && inRange(r.date))
        .forEach(r => entries.push({ date: r.date, type: 'Receipt', ref: r.id, debit: 0, credit: r.amount }));
    } else if (vendor) {
      state.purchases.filter(p => p.vendorId === vendor.id && inRange(p.date))
        .forEach(p => entries.push({ date: p.date, type: 'Purchase', ref: p.id, debit: p.totalValue, credit: 0 }));
      state.purchaseReturns.filter(r => r.vendorId === vendor.id && inRange(r.date))
        .forEach(r => entries.push({ date: r.date, type: 'Purchase Return', ref: r.id, debit: 0, credit: r.totalValue }));
      state.expenses.filter(e => e.businessAccountId === selectedAccount.id && inRange(e.date))
        .forEach(e => entries.push({ date: e.date, type: 'Payment', ref: e.id, debit: 0, credit: e.amount }));
    } else {
      state.expenses.filter(e => e.businessAccountId === selectedAccount.id && inRange(e.date))
        .forEach(e => entries.push({ date: e.date, type: 'Expense', ref: e.id, debit: 0, credit: e.amount }));
    }

    return entries.sort((a, b) => a.date.localeCompare(b.date));
  }, [selectedAccount, state.customers, state.vendors, state.saleBills, state.saleReturns, state.receipts, state.purchases, state.purchaseReturns, state.expenses, fromDate, toDate]);

  return (
    <div className="mx-auto" style={{ maxWidth: 1100 }}>
      {/* Filter Bar - data-no-print */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
            <button onClick={() => setViewMode('summary')} className={`px-3 py-2 rounded-md transition-all ${viewMode === 'summary' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}>Summary</button>
            <button onClick={() => setViewMode('detail')} className={`px-3 py-2 rounded-md transition-all ${viewMode === 'detail' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}>Detail</button>
            <button onClick={() => setViewMode('customer')} className={`px-3 py-2 rounded-md transition-all ${viewMode === 'customer' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}>Customer</button>
          </div>

          {viewMode === 'detail' && (
            <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)} className="soleria-input py-1.5 cursor-pointer text-sm min-w-[220px]">
              <option value="">Select an account...</option>
              {state.businessAccounts.map(b => (
                <option key={b.id} value={b.id}>{b.name} ({b.id})</option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500 uppercase">From:</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
          </div>
        </div>
      </div>

      <div className="card-white p-6 md:p-8 bg-white border">
        {viewMode === 'detail' ? (
          !selectedAccount ? (
            <div className="text-center p-8 text-slate-400">Select an account above to view its transaction detail.</div>
          ) : (
            <div className="overflow-x-auto">
              <div className="mb-4">
                <h3 className="font-lora font-semibold text-lg text-slate-800">{selectedAccount.name}</h3>
                <p className="text-xs text-slate-500">Code: {selectedAccount.id}</p>
              </div>
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Date</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Ref</th>
                    <th className="p-3 text-right">Debit</th>
                    <th className="p-3 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {detailEntries.length === 0 ? (
                    <tr><td colSpan={5} className="text-center p-8 text-slate-400">No transactions found for this account / date range.</td></tr>
                  ) : (
                    detailEntries.map((e, idx) => (
                      <tr key={idx} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-mono text-slate-600">{e.date}</td>
                        <td className="p-3 text-slate-700">{e.type}</td>
                        <td className="p-3 text-slate-500">{e.ref}</td>
                        <td className="p-3 text-right font-bold text-rose-700">{e.debit > 0 ? formatCurrency(e.debit) : '-'}</td>
                        <td className="p-3 text-right font-bold text-emerald-700">{e.credit > 0 ? formatCurrency(e.credit) : '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">Code</th>
                  <th className="p-3">Description</th>
                  <th className="p-3">Main Account</th>
                  <th className="p-3">City / Region</th>
                  <th className="p-3 text-right">Debit</th>
                  <th className="p-3 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.length === 0 ? (
                  <tr><td colSpan={6} className="text-center p-8 text-slate-400">No business accounts found.</td></tr>
                ) : (
                  summaryRows.map(row => (
                    <tr key={row.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-mono text-slate-600">{row.id}</td>
                      <td className="p-3 font-semibold text-slate-800">{row.name}</td>
                      <td className="p-3 text-slate-500">{row.chartName}</td>
                      <td className="p-3 text-slate-500">{row.region}</td>
                      <td className="p-3 text-right font-bold text-rose-700">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                      <td className="p-3 text-right font-bold text-emerald-700">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
