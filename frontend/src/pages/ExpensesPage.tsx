import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { Expense } from '@/types';
import { Save, Wallet } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';
import WeeklyExpensesTab from '@/components/WeeklyExpensesTab';
import MonthlyExpensesTab from '@/components/MonthlyExpensesTab';
import OverallExpensesTab from '@/components/OverallExpensesTab';

export default function ExpensesPage() {
  const { state, dispatch } = useApp();

  // Navigation / Tabs State
  const [activeTab, setActiveTab] = useState<'entry' | 'weekly' | 'monthly' | 'overall'>('entry');

  // Form State
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'Cheque' | 'Online'>('Cash');
  const [details, setDetails] = useState('');
  const [remarks, setRemarks] = useState('');

  // Alerts
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Business Account helper
  const selectedBizAc = useMemo(() => {
    return state.businessAccounts.find(b => b.id === businessAccountId);
  }, [businessAccountId, state.businessAccounts]);

  const bizParentAcName = useMemo(() => {
    if (!selectedBizAc) return '';
    return state.chartAccounts.find(a => a.id === selectedBizAc.controlId)?.name || 'EXPENSES ACCOUNTS';
  }, [selectedBizAc, state.chartAccounts]);

  const handleSaveExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return setErrorMsg('Please pick a date.');
    if (!businessAccountId) return setErrorMsg('Please select a business account.');
    if (amount <= 0) return setErrorMsg('Amount must be greater than 0.');

    const newExpense: Expense = {
      id: 'exp_' + Date.now(),
      date,
      businessAccountId,
      amount,
      paymentMode,
      details,
      remarks
    };

    dispatch({ type: 'ADD_EXPENSE', expense: newExpense });
    
    setSuccessMsg(`Expense of ${formatCurrency(amount)} saved successfully against ledger account!`);
    setTimeout(() => setSuccessMsg(''), 3500);

    // Reset Form
    setBusinessAccountId('');
    setAmount(0);
    setDetails('');
    setRemarks('');
    setErrorMsg('');
  };

  return (
    <AppLayout pageTitle="Expenses / Kharch Entry">
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
            Expense Entry
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
        {activeTab === 'weekly' && <WeeklyExpensesTab />}
        {activeTab === 'monthly' && <MonthlyExpensesTab />}
        {activeTab === 'overall' && <OverallExpensesTab />}

        {activeTab === 'entry' && (
          <div className="max-w-2xl mx-auto animate-fadeIn">
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
                <Wallet size={20} className="text-rose-600" /> New Expense (Kharch)
              </h3>
              
              <form onSubmit={handleSaveExpense} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Expense Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="soleria-input"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Select Ledger Account (Business A/C)</label>
                  <SearchableSelect
                    options={state.businessAccounts.map(b => ({
                      value: b.id,
                      label: `${b.name} (${b.id})`
                    }))}
                    value={businessAccountId}
                    onChange={setBusinessAccountId}
                    placeholder="Search & select business account..."
                    searchPlaceholder="Type to search..."
                  />
                </div>

                {selectedBizAc && (
                  <div className="flex flex-col gap-2.5 p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="block text-slate-500 font-medium">Account Code:</span>
                        <span className="font-semibold text-slate-700 font-mono">{selectedBizAc.id}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500 font-medium">Parent Class:</span>
                        <span className="font-semibold text-slate-700">{bizParentAcName}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Amount Spent (PKR)</label>
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
                  <Save size={16} /> Save Expense
                </button>
              </form>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
