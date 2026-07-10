import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { Receipt } from '@/types';
import { Save, DollarSign, Search } from 'lucide-react';
import WeeklyReceiptsTab from '@/components/WeeklyReceiptsTab';
import MonthlyReceiptsTab from '@/components/MonthlyReceiptsTab';
import OverallReceiptsTab from '@/components/OverallReceiptsTab';

export default function ReceiptsPage() {
  const { state, dispatch } = useApp();

  // Navigation / Tabs State
  const [activeTab, setActiveTab] = useState<'entry' | 'weekly' | 'monthly' | 'overall'>('entry');

  // Form State
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [customerId, setCustomerId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'Cheque' | 'Online'>('Cash');
  const [details, setDetails] = useState('');
  const [remarks, setRemarks] = useState('');

  // Dropdown search state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');

  // Alerts
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Customer account group helpers
  const selectedCustomer = useMemo(() => {
    return state.customers.find(c => c.id === customerId);
  }, [customerId, state.customers]);

  const customerMainAcName = useMemo(() => {
    if (!selectedCustomer) return '';
    return state.chartAccounts.find(a => a.id === selectedCustomer.acId)?.name || 'CUSTOMERS ACCOUNTS';
  }, [selectedCustomer, state.chartAccounts]);

  // Dropdown list filter
  const filteredDropdownCustomers = useMemo(() => {
    if (!customerSearchQuery.trim()) return state.customers;
    const query = customerSearchQuery.toLowerCase();
    return state.customers.filter(c => 
      c.name.toLowerCase().includes(query) || 
      c.id.toLowerCase().includes(query)
    );
  }, [customerSearchQuery, state.customers]);

  // Customer balance calculations
  const customerBalanceDetails = useMemo(() => {
    if (!customerId) return null;

    // 1. Posted Sale Bills (Debits)
    const totalDebit = state.saleBills
      .filter(bill => bill.customerId === customerId && bill.status === 'Posted')
      .reduce((sum, bill) => sum + bill.totalValue, 0);

    // 2. Posted Sale Returns (Credits)
    const totalReturns = state.saleReturns
      .filter(ret => ret.customerId === customerId && ret.status === 'Posted')
      .reduce((sum, ret) => sum + ret.items.reduce((s, it) => s + it.value, 0), 0);

    // 3. Receipts (Credits)
    const totalReceipts = state.receipts
      .filter(rec => rec.customerId === customerId)
      .reduce((sum, rec) => sum + rec.amount, 0);

    const currentBalance = totalDebit - (totalReturns + totalReceipts);
    const remainingBalance = currentBalance - amount;

    return {
      currentBalance,
      remainingBalance
    };
  }, [customerId, state.saleBills, state.saleReturns, state.receipts, amount]);

  const handleSaveReceipt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return setErrorMsg('Please pick a date.');
    if (!customerId) return setErrorMsg('Please select a customer.');
    if (amount <= 0) return setErrorMsg('Amount must be greater than 0.');

    const newReceipt: Receipt = {
      id: 'rc_' + Date.now(),
      date,
      customerId,
      amount,
      paymentMode,
      details,
      remarks
    };

    dispatch({ type: 'ADD_RECEIPT', receipt: newReceipt });
    
    setSuccessMsg(`Receipt of ${formatCurrency(amount)} saved successfully against customer!`);
    setTimeout(() => setSuccessMsg(''), 3500);

    // Reset Form
    setCustomerId('');
    setCustomerSearchQuery('');
    setAmount(0);
    setDetails('');
    setRemarks('');
    setErrorMsg('');
  };

  return (
    <AppLayout pageTitle="Receipts / Jamma Entry">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        
        {/* Top Tab Navigation */}
        <div className="flex flex-wrap gap-2 mb-6 border-b pb-3" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <button
            onClick={() => setActiveTab('entry')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'entry'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Receipt Entry
          </button>
          <button
            onClick={() => setActiveTab('weekly')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'weekly'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Weekly Records
          </button>
          <button
            onClick={() => setActiveTab('monthly')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'monthly'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Monthly Records
          </button>
          <button
            onClick={() => setActiveTab('overall')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === 'overall'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Overall Records
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'weekly' && <WeeklyReceiptsTab />}
        {activeTab === 'monthly' && <MonthlyReceiptsTab />}
        {activeTab === 'overall' && <OverallReceiptsTab />}

        {activeTab === 'entry' && (
          <div className="max-w-2xl mx-auto">
            {/* Banner Alerts */}
            {successMsg && (
              <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
            )}
            {errorMsg && (
              <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
            )}

            {/* Entry Form Card */}
            <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm" data-no-print>
              <h3 className="font-lora font-semibold text-xl border-b pb-3 mb-5 text-slate-800 flex items-center gap-2">
                <DollarSign size={20} className="text-green-600" /> New Receipt (Jamma)
              </h3>
              
              <form onSubmit={handleSaveReceipt} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Receipt Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="soleria-input"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Select Customer</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search & select customer..."
                      value={isDropdownOpen ? customerSearchQuery : (selectedCustomer ? selectedCustomer.name : '')}
                      onChange={e => {
                        setCustomerSearchQuery(e.target.value);
                        setIsDropdownOpen(true);
                      }}
                      onFocus={() => {
                        setIsDropdownOpen(true);
                        setCustomerSearchQuery(selectedCustomer ? selectedCustomer.name : '');
                      }}
                      onBlur={() => {
                        setTimeout(() => {
                          setIsDropdownOpen(false);
                        }, 200);
                      }}
                      className="soleria-input pr-10 font-semibold"
                    />
                    <div className="absolute right-3 top-2.5 flex items-center pointer-events-none text-slate-400">
                      <Search size={16} />
                    </div>
                    {isDropdownOpen && (
                      <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                        {filteredDropdownCustomers.length === 0 ? (
                          <div className="p-3 text-xs text-slate-400 italic">No customers found</div>
                        ) : (
                          filteredDropdownCustomers.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onMouseDown={() => {
                                setCustomerId(c.id);
                                setCustomerSearchQuery(c.name);
                                setIsDropdownOpen(false);
                              }}
                              className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors border-b last:border-0 flex items-center justify-between ${customerId === c.id ? 'bg-slate-50 text-amber-600 font-semibold' : 'text-slate-700'}`}
                              style={{ borderColor: 'var(--border-table)' }}
                            >
                              <span>{c.name}</span>
                              <span className="font-mono text-xs text-slate-400">Code: {c.id}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {selectedCustomer && customerBalanceDetails && (
                  <div className="flex flex-col gap-2.5 p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                    <div className="grid grid-cols-2 gap-2 pb-2.5 border-b border-slate-200/60">
                      <div>
                        <span className="block text-slate-500 font-medium">Customer Code:</span>
                        <span className="font-semibold text-slate-700 font-mono">{selectedCustomer.id}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500 font-medium">Main A/C Group:</span>
                        <span className="font-semibold text-slate-700">{customerMainAcName}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <div>
                        <span className="block text-slate-500 font-medium mb-0.5">Current Balance:</span>
                        <span className={`font-bold font-mono text-sm ${customerBalanceDetails.currentBalance > 0 ? 'text-rose-700' : customerBalanceDetails.currentBalance < 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                          {formatCurrency(customerBalanceDetails.currentBalance)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-slate-500 font-medium mb-0.5">Remaining Balance:</span>
                        <span className={`font-bold font-mono text-sm ${customerBalanceDetails.remainingBalance > 0 ? 'text-rose-700' : customerBalanceDetails.remainingBalance < 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                          {formatCurrency(customerBalanceDetails.remainingBalance)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Amount Received (PKR)</label>
                  <input
                    type="number"
                    min={0}
                    value={amount || ''}
                    onChange={e => setAmount(Math.max(0, parseInt(e.target.value) || 0))}
                    placeholder="Enter amount in Rs..."
                    className="soleria-input font-semibold font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Payment Mode</label>
                  <div className="grid grid-cols-3 gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => { setPaymentMode('Cash'); setDetails(''); }}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'Cash' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Cash
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMode('Cheque')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'Cheque' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Cheque
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMode('Online')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'Online' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Online
                    </button>
                  </div>
                </div>

                {paymentMode !== 'Cash' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      {paymentMode === 'Cheque' ? 'Cheque No. & Bank Name' : 'Online Reference Code / Details'}
                    </label>
                    <input
                      type="text"
                      value={details}
                      onChange={e => setDetails(e.target.value)}
                      placeholder={paymentMode === 'Cheque' ? 'e.g. MCB Cheque No. 982341' : 'e.g. Alfa ref 980124'}
                      className="soleria-input"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks</label>
                  <textarea
                    value={remarks}
                    onChange={e => setRemarks(e.target.value)}
                    placeholder="Enter remarks..."
                    className="soleria-input"
                    rows={2}
                    style={{ resize: 'none' }}
                  />
                </div>

                <button type="submit" className="btn-gold w-full mt-2 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold">
                  <Save size={16} /> Save Receipt
                </button>
              </form>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}


