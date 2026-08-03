import { useState, useMemo, useEffect } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import { getCustomerBalance } from '@/lib/cheques';
import AppLayout from '@/components/AppLayout';
import type { Receipt } from '@/types';
import { Save, DollarSign, Search } from 'lucide-react';
import WeeklyReceiptsTab from '@/components/WeeklyReceiptsTab';
import MonthlyReceiptsTab from '@/components/MonthlyReceiptsTab';
import OverallReceiptsTab from '@/components/OverallReceiptsTab';
import ChequesTab from '@/components/ChequesTab';
import SearchableSelect from '@/components/SearchableSelect';

type ReceiptTab = 'entry' | 'weekly' | 'monthly' | 'overall' | 'cheques';

const RECEIPT_TAB_LABELS: Record<ReceiptTab, string> = {
  entry: 'Receipt Entry',
  weekly: 'Weekly Records',
  monthly: 'Monthly Records',
  overall: 'Overall Records',
  cheques: 'Cheques Disposal'
};

export default function ReceiptsPage() {
  const { state, dispatch } = useApp();

  // Navigation / Tabs State — sync with state.currentTab
  const [activeTab, setActiveTab] = useState<ReceiptTab>(() => {
    if (state.currentTab && ['entry', 'weekly', 'monthly', 'overall', 'cheques'].includes(state.currentTab)) {
      if (state.currentTab === 'cheques' && state.currentUserRole === 'User') return 'entry';
      return state.currentTab as ReceiptTab;
    }
    return 'entry';
  });

  useEffect(() => {
    if (state.currentTab && ['entry', 'weekly', 'monthly', 'overall', 'cheques'].includes(state.currentTab)) {
      if (state.currentTab === 'cheques' && state.currentUserRole === 'User') return;
      setActiveTab(state.currentTab as ReceiptTab);
    }
  }, [state.currentTab, state.currentUserRole]);

  // Form State
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [customerId, setCustomerId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [commission, setCommission] = useState<number>(0);
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'Cheque' | 'Online'>('Cash');
  // ONLINE only — which of our accounts the money landed in. Without it the
  // receipt is one-sided and no bank balance can be trusted.
  const [bankId, setBankId] = useState('');
  const [details, setDetails] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [chequeReceivedDate, setChequeReceivedDate] = useState('');
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

  // Dropdown list filter — Customer search: Primary = Region, Secondary = City
  const filteredDropdownCustomers = useMemo(() => {
    const regionName = (id: string) => state.regions.find(r => r.id === id)?.name || '';
    const cityName = (id: string) => state.cities.find(ct => ct.id === id)?.name || '';
    const query = customerSearchQuery.trim().toLowerCase();
    const list = query
      ? state.customers.filter(c =>
          c.name.toLowerCase().includes(query) ||
          c.id.toLowerCase().includes(query)
        )
      : state.customers;
    return [...list].sort((a, b) => {
      const regionCmp = regionName(a.regionId).localeCompare(regionName(b.regionId));
      if (regionCmp !== 0) return regionCmp;
      return cityName(a.cityId).localeCompare(cityName(b.cityId));
    });
  }, [customerSearchQuery, state.customers, state.regions, state.cities]);

  // Customer balance calculations. Uses the shared helper so a BOUNCED cheque
  // stops counting as payment here exactly as it does in the Account Ledger.
  const customerBalanceDetails = useMemo(() => {
    if (!customerId) return null;

    const currentBalance = getCustomerBalance(
      customerId, state.saleBills, state.saleReturns, state.receipts
    );
    const afterCommission = currentBalance - commission;
    const remainingBalance = afterCommission - amount;

    return {
      currentBalance,
      afterCommission,
      remainingBalance
    };
  }, [customerId, state.saleBills, state.saleReturns, state.receipts, amount, commission]);

  const handleSaveReceipt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return setErrorMsg('Please pick a date.');
    if (!customerId) return setErrorMsg('Please select a customer.');
    if (amount <= 0) return setErrorMsg('Amount must be greater than 0.');
    if (paymentMode === 'Cheque' && !chequeNo.trim()) return setErrorMsg('Cheque No. is required for cheque payments.');
    if (paymentMode === 'Cheque' && !chequeDate) return setErrorMsg('Date on Cheque is required for cheque payments.');
    if (paymentMode === 'Online' && !bankId) return setErrorMsg('Select which bank account received this money.');

    const newReceipt: Receipt = {
      id: 'rc_' + Date.now(),
      date,
      customerId,
      amount,
      commission: commission || undefined,
      paymentMode,
      bankId: paymentMode === 'Online' ? bankId : undefined,
      details,
      ...(paymentMode === 'Cheque' ? {
        chequeNo: chequeNo.trim(),
        chequeDate,
        chequeReceivedDate: chequeReceivedDate || date,
        chequeStatus: 'PENDING' as const
      } : {}),
      remarks
    };

    dispatch({ type: 'ADD_RECEIPT', receipt: newReceipt });

    const commissionNote = commission > 0 ? ` (+ ${formatCurrency(commission)} commission)` : '';
    setSuccessMsg(`Receipt of ${formatCurrency(amount)}${commissionNote} saved successfully against customer!`);
    setTimeout(() => setSuccessMsg(''), 3500);

    // Reset Form
    setCustomerId('');
    setCustomerSearchQuery('');
    setBankId('');
    setAmount(0);
    setCommission(0);
    setDetails('');
    setChequeNo('');
    setChequeDate('');
    setChequeReceivedDate('');
    setRemarks('');
    setErrorMsg('');
  };

  return (
    <AppLayout pageTitle="Receipts / Jamma Entry" subTabTitle={RECEIPT_TAB_LABELS[activeTab]} subTabId={activeTab}>
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        
        {/* Top Tab Navigation */}
        <div className="flex flex-wrap gap-2 mb-6 border-b pb-3" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <button
            draggable={true}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', JSON.stringify({ page: 'receipts-jamma', tab: 'entry', label: 'Receipt Entry' }));
            }}
            onClick={() => setActiveTab('entry')}
            title="Drag tab to Quick Access Menu Bar to pin"
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all cursor-grab active:cursor-grabbing ${
              activeTab === 'entry'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Receipt Entry
          </button>
          <button
            draggable={true}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', JSON.stringify({ page: 'receipts-jamma', tab: 'weekly', label: 'Weekly Records' }));
            }}
            onClick={() => setActiveTab('weekly')}
            title="Drag tab to Quick Access Menu Bar to pin"
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all cursor-grab active:cursor-grabbing ${
              activeTab === 'weekly'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Weekly Records
          </button>
          <button
            draggable={true}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', JSON.stringify({ page: 'receipts-jamma', tab: 'monthly', label: 'Monthly Records' }));
            }}
            onClick={() => setActiveTab('monthly')}
            title="Drag tab to Quick Access Menu Bar to pin"
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all cursor-grab active:cursor-grabbing ${
              activeTab === 'monthly'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Monthly Records
          </button>
          <button
            draggable={true}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', JSON.stringify({ page: 'receipts-jamma', tab: 'overall', label: 'Overall Records' }));
            }}
            onClick={() => setActiveTab('overall')}
            title="Drag tab to Quick Access Menu Bar to pin"
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all cursor-grab active:cursor-grabbing ${
              activeTab === 'overall'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Overall Records
          </button>
          {state.currentUserRole !== 'User' && (
            <button
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ page: 'receipts-jamma', tab: 'cheques', label: 'Cheques Disposal' }));
              }}
              onClick={() => setActiveTab('cheques')}
              title="Drag tab to Quick Access Menu Bar to pin"
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all cursor-grab active:cursor-grabbing ${
                activeTab === 'cheques'
                  ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Cheques
            </button>
          )}
        </div>

        {/* Tab Content */}
        {activeTab === 'weekly' && <WeeklyReceiptsTab />}
        {activeTab === 'monthly' && <MonthlyReceiptsTab />}
        {activeTab === 'overall' && <OverallReceiptsTab />}
        {activeTab === 'cheques' && state.currentUserRole !== 'User' && <ChequesTab />}

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
                              <span className="font-mono text-xs text-slate-400">
                                {state.regions.find(r => r.id === c.regionId)?.name || 'No Region'} · Code: {c.id}
                              </span>
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
                        <span className="block text-slate-500 font-medium mb-0.5">Amount Due:</span>
                        <span className={`font-bold font-mono text-sm ${customerBalanceDetails.currentBalance > 0 ? 'text-rose-700' : customerBalanceDetails.currentBalance < 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                          {formatCurrency(customerBalanceDetails.currentBalance)}
                        </span>
                      </div>
                      {commission > 0 && (
                        <div>
                          <span className="block text-slate-500 font-medium mb-0.5">After Commission:</span>
                          <span className={`font-bold font-mono text-sm ${customerBalanceDetails.afterCommission > 0 ? 'text-rose-700' : customerBalanceDetails.afterCommission < 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                            {formatCurrency(customerBalanceDetails.afterCommission)}
                          </span>
                        </div>
                      )}
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
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Commission (PKR) <span className="text-slate-400 font-normal normal-case">— optional, reduces payable only</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={commission || ''}
                    onChange={e => setCommission(Math.max(0, parseInt(e.target.value) || 0))}
                    placeholder="Enter commission given, if any..."
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

                {paymentMode === 'Online' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Received Into <span className="text-red-500 font-bold">*</span>
                    </label>
                    {state.bankAccounts.length === 0 ? (
                      <div className="soleria-input text-rose-600 text-sm flex items-center font-semibold">
                        Add a bank account first
                      </div>
                    ) : (
                      <SearchableSelect
                        options={state.bankAccounts.map(b => ({ value: b.id, label: b.name }))}
                        value={bankId}
                        onChange={setBankId}
                        placeholder="Select bank account..."
                      />
                    )}
                  </div>
                )}

                {paymentMode === 'Cheque' && (
                  <p className="text-[11px] text-slate-500 -mt-2">
                    A received cheque goes into <strong>Cheques in Hand</strong>, not a bank. You
                    choose the bank later, when it is deposited.
                  </p>
                )}

                {paymentMode !== 'Cash' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      {paymentMode === 'Cheque' ? 'Drawn On (customer\'s bank) / Details' : 'Online Reference Code / Details'}
                    </label>
                    <input
                      type="text"
                      value={details}
                      onChange={e => setDetails(e.target.value)}
                      placeholder={paymentMode === 'Cheque' ? 'e.g. MCB Bank, Gulberg Branch' : 'e.g. Alfa ref 980124'}
                      className="soleria-input"
                    />
                  </div>
                )}

                {paymentMode === 'Cheque' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Cheque No. <span className="text-red-500 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        value={chequeNo}
                        onChange={e => setChequeNo(e.target.value)}
                        placeholder="e.g. 982341"
                        className="soleria-input font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Date on Cheque <span className="text-red-500 font-bold">*</span>
                      </label>
                      <input
                        type="date"
                        value={chequeDate}
                        onChange={e => setChequeDate(e.target.value)}
                        className="soleria-input"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Cheque Received Date
                      </label>
                      <input
                        type="date"
                        value={chequeReceivedDate}
                        onChange={e => setChequeReceivedDate(e.target.value)}
                        placeholder={date}
                        className="soleria-input"
                      />
                      <p className="text-[10px] text-slate-400 mt-0.5">Defaults to Receipt Date if left blank</p>
                    </div>
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


