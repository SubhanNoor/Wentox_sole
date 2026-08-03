import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Printer, Download, MapPin, Edit2, Trash2, FileDown } from 'lucide-react';
import { exportToPDF } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import type { Customer } from '@/types';

interface ProductLedgerRow {
  date: string;
  refId: string;
  article: string;
  debit: number;       // sale value for that article
  credit: number;       // sale return value for that article
  returnQty: number;    // pairs returned for that article
}

export default function CustomerSetupPage() {
  const { state, dispatch } = useApp();

  // Directory view state
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Add/Edit Customer modal state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerRegionId, setNewCustomerRegionId] = useState('');
  const [newCustomerCityId, setNewCustomerCityId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Ledger detail filters
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());
  const [articleFilter, setArticleFilter] = useState('');

  const selectedCustomer = useMemo(() => {
    return state.customers.find(c => c.id === selectedCustomerId);
  }, [selectedCustomerId, state.customers]);

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return state.customers;
    const q = searchQuery.toLowerCase();
    return state.customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    );
  }, [state.customers, searchQuery]);

  // FOUR-digit serial — two digits caps a chart account at 99 children, and
  // the client's legacy data already holds 200+ accounts under one head.
  // See database_schema.md §3.2.
  const getNextCustomerCode = () => {
    const customerAccounts = state.businessAccounts.filter(acc => acc.controlId === '110001');
    const maxSuffix = customerAccounts.reduce((max, acc) => {
      const num = parseInt(acc.id.substring(6), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    return `110001${String(maxSuffix + 1).padStart(4, '0')}`;
  };

  const handleOpenAdd = () => {
    setEditingCustomerId(null);
    setNewCustomerName('');
    setNewCustomerRegionId('');
    setNewCustomerCityId('');
    setErrorMsg('');
    setIsFormOpen(true);
  };

  const handleOpenEdit = (c: Customer) => {
    setEditingCustomerId(c.id);
    setNewCustomerName(c.name);
    setNewCustomerRegionId(c.regionId);
    setNewCustomerCityId(c.cityId);
    setErrorMsg('');
    setIsFormOpen(true);
  };

  const handleSaveCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim()) return setErrorMsg('Customer name is required.');
    if (!newCustomerRegionId) return setErrorMsg('Region is required.');
    if (!newCustomerCityId) return setErrorMsg('City is required.');

    if (editingCustomerId) {
      dispatch({
        type: 'UPDATE_CUSTOMER',
        customer: {
          id: editingCustomerId,
          name: newCustomerName.trim(),
          acId: '110001',
          regionId: newCustomerRegionId,
          cityId: newCustomerCityId
        }
      });
      setSuccessMsg('Customer details updated successfully.');
    } else {
      const regionName = state.regions.find(r => r.id === newCustomerRegionId)?.name || 'LOCAL';
      const newId = getNextCustomerCode();

      dispatch({
        type: 'ADD_BUSINESS_ACCOUNT',
        account: {
          id: newId,
          name: newCustomerName.trim(),
          controlId: '110001',
          linkCode: 'A',
          region: regionName,
          status: 'Active'
        }
      });

      dispatch({
        type: 'ADD_CUSTOMER',
        customer: {
          id: newId,
          name: newCustomerName.trim(),
          acId: '110001',
          regionId: newCustomerRegionId,
          cityId: newCustomerCityId
        }
      });
      setSuccessMsg('New customer added successfully.');
    }

    setIsFormOpen(false);
    setEditingCustomerId(null);
    setNewCustomerName('');
    setNewCustomerRegionId('');
    setNewCustomerCityId('');
    setErrorMsg('');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleDeleteCustomer = (id: string) => {
    const hasBills = state.saleBills.some(b => b.customerId === id);
    const hasReturns = state.saleReturns.some(r => r.customerId === id);
    const hasReceipts = state.receipts.some(r => r.customerId === id);
    if (hasBills || hasReturns || hasReceipts) {
      alert('Cannot delete this customer. They have linked sale bills, returns, or receipts.');
      return;
    }

    if (window.confirm('Are you sure you want to delete this customer?')) {
      dispatch({ type: 'DELETE_CUSTOMER', id });
      setSuccessMsg('Customer deleted successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    }
  };

  // Product ledger rows for the selected customer (article-wise, not money-wise Khaata)
  const ledgerRows = useMemo(() => {
    if (!selectedCustomerId) return [];
    const rows: ProductLedgerRow[] = [];

    state.saleBills.forEach(bill => {
      if (bill.customerId !== selectedCustomerId || bill.status !== 'Posted') return;
      bill.items.forEach(item => {
        rows.push({
          date: bill.date,
          refId: bill.billNo,
          article: item.productName,
          debit: item.value,
          credit: 0,
          returnQty: 0
        });
      });
    });

    state.saleReturns.forEach(ret => {
      if (ret.customerId !== selectedCustomerId || ret.status !== 'Posted') return;
      ret.items.forEach(item => {
        rows.push({
          date: ret.date,
          refId: ret.billNo,
          article: item.productName,
          debit: 0,
          credit: item.value,
          returnQty: item.pairs
        });
      });
    });

    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [selectedCustomerId, state.saleBills, state.saleReturns]);

  const filteredLedgerRows = useMemo(() => {
    return ledgerRows.filter(row => {
      if (fromDate && row.date < fromDate) return false;
      if (toDate && row.date > toDate) return false;
      if (articleFilter && row.article !== articleFilter) return false;
      return true;
    });
  }, [ledgerRows, fromDate, toDate, articleFilter]);

  const ledgerTotals = useMemo(() => {
    return filteredLedgerRows.reduce((acc, r) => ({
      debit: acc.debit + r.debit,
      credit: acc.credit + r.credit,
      returnQty: acc.returnQty + r.returnQty
    }), { debit: 0, credit: 0, returnQty: 0 });
  }, [filteredLedgerRows]);

  const articleOptions = useMemo(() => {
    return Array.from(new Set(ledgerRows.map(r => r.article))).sort();
  }, [ledgerRows]);

  const handleExportExcel = () => {
    const header = ['Date', 'Ref No', 'Article', 'Debit', 'Credit', 'Sale Return (Pairs)'];
    const lines = filteredLedgerRows.map(r => [r.date, r.refId, r.article, r.debit, r.credit, r.returnQty]);
    const csv = [header, ...lines].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedCustomer?.name || 'customer'}_product_ledger.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout pageTitle="Customers">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
        )}
        {errorMsg && !isFormOpen && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
        )}

        {!selectedCustomerId ? (
          /* ───── Directory View ───── */
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6" data-no-print>
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Customers Directory</h3>
                <p className="text-xs text-slate-500 font-medium">Browse customers as cards. Select a card to view its product ledger.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative min-w-[240px]">
                  <input
                    type="text"
                    placeholder="Search by name or code..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold bg-white"
                  />
                  <Search className="absolute right-3 top-2.5 text-slate-400" size={14} />
                </div>
                <button
                  onClick={handleOpenAdd}
                  className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm"
                >
                  <Plus size={16} /> Add New Customer
                </button>
              </div>
            </div>

            {filteredCustomers.length === 0 ? (
              <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
                No registered customers found matching your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCustomers.map(c => {
                  const regionName = state.regions.find(r => r.id === c.regionId)?.name || 'No Region';
                  const cityName = state.cities.find(ct => ct.id === c.cityId)?.name || 'No City';
                  const initialLetter = c.name.charAt(0).toUpperCase();

                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelectedCustomerId(c.id)}
                      className="bg-white border rounded-xl p-5 hover:border-amber-500 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col justify-between group"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-3.5 gap-2">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                            CODE: {c.id}
                          </span>
                          <span className="text-[10px] font-bold text-[#B08D57] uppercase tracking-wider flex items-center gap-1">
                            <MapPin size={10} /> {regionName}
                          </span>
                        </div>

                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                            {initialLetter}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 group-hover:text-[#B08D57] transition-colors leading-tight text-[15px] truncate">
                              {c.name}
                            </h4>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5 uppercase tracking-wider truncate">
                              {cityName}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="border-t pt-3 mt-1 flex items-center justify-between gap-2">
                        <button
                          onClick={() => setSelectedCustomerId(c.id)}
                          className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-[#B08D57] transition-colors"
                        >
                          View Product Ledger <span className="text-sm font-bold">&rarr;</span>
                        </button>
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleOpenEdit(c)}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                            title="Edit Customer"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDeleteCustomer(c.id)}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                            title="Delete Customer"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* ───── Product Ledger Detail View ───── */
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedCustomerId('')}
                  className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm font-semibold"
                >
                  &larr; Back to Directory
                </button>
                <div className="text-sm font-semibold text-slate-600">
                  Product Ledger: <span className="text-amber-800 font-bold">{selectedCustomer?.name}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-0.5">From:</span>
                  <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1 text-xs" />
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-0.5">To:</span>
                  <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1 text-xs" />
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-0.5">Article:</span>
                  <select value={articleFilter} onChange={e => setArticleFilter(e.target.value)} className="soleria-input py-1 text-xs cursor-pointer">
                    <option value="">Overall (All Articles)</option>
                    {articleOptions.map(a => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
                  <Download size={16} /> Export Excel
                </button>
                <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
                  <Printer size={16} /> Print
                </button>
                <button onClick={exportToPDF} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
                  <FileDown size={16} /> Export PDF
                </button>
              </div>
            </div>

            <div className="card-white p-6 md:p-8 bg-white border">
              <div className="flex items-center justify-between border-b pb-4 mb-6">
                <div>
                  <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTO ERP</h1>
                  <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Customer Product Ledger</p>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-700">{selectedCustomer?.name}</div>
                  <div className="text-xs text-slate-500 font-medium">
                    Code: {selectedCustomer?.id}
                  </div>
                  {(fromDate || toDate) && (
                    <div className="text-xs text-amber-700 font-semibold mt-0.5">
                      Period: {fromDate || 'Start'} to {toDate || 'End'}
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4">Date</th>
                      <th className="p-3 text-center">Ref No</th>
                      <th className="p-3">Article</th>
                      <th className="p-3 text-right">Debit</th>
                      <th className="p-3 text-right">Credit</th>
                      <th className="p-3 text-right">Sale Return (Pairs)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLedgerRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center p-8 text-slate-400">
                          No product ledger entries found matching your filters.
                        </td>
                      </tr>
                    ) : (
                      filteredLedgerRows.map((row, idx) => (
                        <tr key={idx} className="border-b text-slate-700 hover:bg-slate-50/30" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-3 pl-4 font-semibold text-slate-700">{row.date}</td>
                          <td className="p-3 text-center font-medium text-slate-600">{row.refId}</td>
                          <td className="p-3 font-medium text-slate-700">{row.article}</td>
                          <td className="p-3 text-right text-rose-700 font-bold">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                          <td className="p-3 text-right text-emerald-700 font-bold">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                          <td className="p-3 text-right font-bold text-slate-800">{row.returnQty > 0 ? row.returnQty : '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {filteredLedgerRows.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-50 border-t-2 font-bold text-slate-800" style={{ borderColor: 'var(--border-color)' }}>
                        <td className="p-3 pl-4" colSpan={3}>Totals</td>
                        <td className="p-3 text-right text-rose-700">{formatCurrency(ledgerTotals.debit)}</td>
                        <td className="p-3 text-right text-emerald-700">{formatCurrency(ledgerTotals.credit)}</td>
                        <td className="p-3 text-right">{ledgerTotals.returnQty}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        )}

        {/* Add/Edit Customer Modal */}
        {isFormOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
            <form onSubmit={handleSaveCustomer} className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
              <h3 className="font-lora font-bold text-lg text-slate-800 mb-4">
                {editingCustomerId ? `Edit Customer: ${newCustomerName}` : 'Add New Customer'}
              </h3>

              {errorMsg && (
                <div className="banner-error rounded-lg px-3 py-2 text-xs mb-4">{errorMsg}</div>
              )}

              <div className="mb-4">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Customer Name <span className="text-red-500 font-bold">*</span>
                </label>
                <input
                  type="text"
                  value={newCustomerName}
                  onChange={e => setNewCustomerName(e.target.value)}
                  placeholder="Enter customer name..."
                  className="soleria-input font-semibold"
                  autoFocus
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Select Region <span className="text-red-500 font-bold">*</span>
                </label>
                <select
                  value={newCustomerRegionId}
                  onChange={e => setNewCustomerRegionId(e.target.value)}
                  className="soleria-input cursor-pointer font-semibold"
                  required
                >
                  <option value="">Select Region...</option>
                  {state.regions.map(rg => (
                    <option key={rg.id} value={rg.id}>{rg.name}</option>
                  ))}
                </select>
              </div>

              <div className="mb-6">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Select City <span className="text-red-500 font-bold">*</span>
                </label>
                <select
                  value={newCustomerCityId}
                  onChange={e => setNewCustomerCityId(e.target.value)}
                  className="soleria-input cursor-pointer font-semibold"
                  required
                >
                  <option value="">Select City...</option>
                  {state.cities.map(ct => (
                    <option key={ct.id} value={ct.id}>{ct.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 text-sm font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setIsFormOpen(false);
                    setEditingCustomerId(null);
                    setNewCustomerName('');
                    setNewCustomerRegionId('');
                    setNewCustomerCityId('');
                    setErrorMsg('');
                  }}
                  className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#111c2a] text-[#B08D57] rounded-lg hover:opacity-90 transition-opacity"
                >
                  {editingCustomerId ? 'Update Customer' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
