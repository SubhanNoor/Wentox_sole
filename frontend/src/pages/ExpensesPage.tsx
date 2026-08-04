import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { Expense, ExpenseMode } from '@/types';
import { Save, Wallet, FileText } from 'lucide-react';
import { getUnallocatedCheque } from '@/lib/cashbank';
import SearchableSelect from '@/components/SearchableSelect';
import WeeklyExpensesTab from '@/components/WeeklyExpensesTab';
import MonthlyExpensesTab from '@/components/MonthlyExpensesTab';
import OverallExpensesTab from '@/components/OverallExpensesTab';

export default function ExpensesPage() {
  const { state, dispatch } = useApp();

  // Navigation / Tabs State
  const [activeTab, setActiveTab] = useState<'entry' | 'weekly' | 'monthly' | 'overall'>('entry');

  // Form State
  const [expenseId, setExpenseId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [paymentMode, setPaymentMode] = useState<ExpenseMode>('Cash');
  const [bankId, setBankId] = useState('');
  const [chequeId, setChequeId] = useState('');
  const [issuedChequeNo, setIssuedChequeNo] = useState('');
  const [issuedChequeDate, setIssuedChequeDate] = useState('');
  const [details, setDetails] = useState('');
  const [remarks, setRemarks] = useState('');

  // Drafts state
  const [drafts, setDrafts] = useState<Expense[]>(() => {
    const saved = localStorage.getItem('wento_expense_drafts');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedDraftId, setSelectedDraftId] = useState('');

  const bankOptions = useMemo(
    () => state.bankAccounts.map(b => ({ value: b.id, label: b.name })),
    [state.bankAccounts]
  );

  // Cheques still in the drawer with value left — the only ones that can be
  // handed on. A fully-endorsed, bounced, or returned-to-sender cheque must not appear here.
  const endorsableCheques = useMemo(() => {
    return state.receipts
      .filter(r => r.paymentMode === 'Cheque' && r.chequeStatus !== 'BOUNCED' && r.chequeStatus !== 'RETURNED')
      .map(r => ({ receipt: r, left: getUnallocatedCheque(state, r.id) }))
      .filter(x => x.left > 0)
      .map(x => ({
        value: x.receipt.id,
        label: `${x.receipt.chequeNo || 'Cheque'} — ${formatCurrency(x.left)} left`
      }));
  }, [state]);

  const resetModeFields = (mode: ExpenseMode) => {
    setPaymentMode(mode);
    setBankId('');
    setChequeId('');
    setIssuedChequeNo('');
    setIssuedChequeDate('');
    if (mode === 'Cash') setDetails('');
  };

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

  // Vendor payments are Expense entries where the selected account's parent
  // chart account is "VENDORS ACCOUNTS" (210001) — no separate transaction
  // page, this is purely a UI-level distinction that feeds Vendor Report.
  const isVendorPayment = selectedBizAc?.controlId === '210001';
  const linkedVendor = useMemo(() => {
    if (!isVendorPayment || !selectedBizAc) return undefined;
    return state.vendors.find(v => v.baId === selectedBizAc.id);
  }, [isVendorPayment, selectedBizAc, state.vendors]);

  const loadExpense = (exp: Expense) => {
    setExpenseId(exp.id);
    setDate(exp.date);
    setBusinessAccountId(exp.businessAccountId);
    setAmount(exp.amount || 0);
    setPaymentMode(exp.paymentMode);
    setBankId(exp.bankId || '');
    setChequeId(exp.chequeId || '');
    setIssuedChequeNo(exp.issuedChequeNo || '');
    setIssuedChequeDate(exp.issuedChequeDate || '');
    setDetails(exp.details || '');
    setRemarks(exp.remarks || '');
    setErrorMsg('');
  };

  const handleSaveDraft = () => {
    const currentId = expenseId || 'exp_draft_' + Date.now();
    const draftExpense: Expense = {
      id: currentId,
      date,
      businessAccountId,
      amount: amount || 0,
      paymentMode,
      bankId: (paymentMode === 'Online' || paymentMode === 'ChequeIssued') ? bankId : undefined,
      chequeId: paymentMode === 'ChequeEndorsed' ? chequeId : undefined,
      issuedChequeNo: paymentMode === 'ChequeIssued' ? issuedChequeNo.trim() : undefined,
      issuedChequeDate: paymentMode === 'ChequeIssued' ? issuedChequeDate : undefined,
      details,
      remarks,
      status: 'Unposted'
    };

    setDrafts(prev => {
      const existingIdx = prev.findIndex(d => d.id === currentId);
      let updated;
      if (existingIdx !== -1) {
        updated = [...prev];
        updated[existingIdx] = draftExpense;
      } else {
        updated = [draftExpense, ...prev];
      }
      localStorage.setItem('wento_expense_drafts', JSON.stringify(updated));
      return updated;
    });

    setExpenseId(currentId);
    setSelectedDraftId(currentId);
    setSuccessMsg('Expense saved to drafts cache.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleSaveExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return setErrorMsg('Please pick a date.');
    if (!businessAccountId) return setErrorMsg('Please select a business account.');
    if (amount <= 0) return setErrorMsg('Amount must be greater than 0.');

    // Every mode except cash has to say WHICH account the money left, or the
    // entry is one-sided and no bank balance can ever be trusted.
    if ((paymentMode === 'Online' || paymentMode === 'ChequeIssued') && !bankId) {
      return setErrorMsg('Select which bank account this payment leaves.');
    }
    if (paymentMode === 'ChequeIssued') {
      if (!issuedChequeNo.trim()) return setErrorMsg('Enter the cheque number.');
      if (!issuedChequeDate) return setErrorMsg('Enter the date on the cheque.');
    }
    if (paymentMode === 'ChequeEndorsed') {
      if (!chequeId) return setErrorMsg('Pick which received cheque is being handed over.');
      const left = getUnallocatedCheque(state, chequeId);
      if (amount > left) {
        return setErrorMsg(`That cheque only has ${formatCurrency(left)} left unallocated.`);
      }
    }

    const newExpense: Expense = {
      id: expenseId || ('exp_' + Date.now()),
      date,
      businessAccountId,
      amount,
      paymentMode,
      bankId: (paymentMode === 'Online' || paymentMode === 'ChequeIssued') ? bankId : undefined,
      chequeId: paymentMode === 'ChequeEndorsed' ? chequeId : undefined,
      issuedChequeNo: paymentMode === 'ChequeIssued' ? issuedChequeNo.trim() : undefined,
      issuedChequeDate: paymentMode === 'ChequeIssued' ? issuedChequeDate : undefined,
      details,
      remarks,
      status: 'Posted'
    };

    dispatch({ type: 'ADD_EXPENSE', expense: newExpense });

    // Clean up draft from cache if saved/confirmed
    setDrafts(prev => {
      const updated = prev.filter(d => d.id !== expenseId && d.id !== selectedDraftId);
      localStorage.setItem('wento_expense_drafts', JSON.stringify(updated));
      return updated;
    });
    setSelectedDraftId('');
    setExpenseId('');

    setSuccessMsg(
      isVendorPayment
        ? `Vendor payment of ${formatCurrency(amount)} recorded against ${linkedVendor?.name || 'vendor'}!`
        : `Expense of ${formatCurrency(amount)} saved successfully against ledger account!`
    );
    setTimeout(() => setSuccessMsg(''), 3500);

    // Reset Form
    setBusinessAccountId('');
    setAmount(0);
    setDetails('');
    setRemarks('');
    resetModeFields('Cash');
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

            {/* Drafts Loader Panel */}
            {drafts.length > 0 && (
              <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-4 text-sm" data-no-print>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-700">Saved Drafts:</span>
                  <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-mono font-bold">
                    {drafts.length} incomplete expense(s) cached
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={selectedDraftId}
                    onChange={e => {
                      const draftId = e.target.value;
                      setSelectedDraftId(draftId);
                      const selected = drafts.find(d => d.id === draftId);
                      if (selected) {
                        loadExpense(selected);
                      }
                    }}
                    className="soleria-input py-1 px-2.5 text-xs bg-white border cursor-pointer font-medium"
                    style={{ width: '240px' }}
                  >
                    <option value="">Select a draft to load...</option>
                    {drafts.map(d => {
                      const bizAcName = state.businessAccounts.find(b => b.id === d.businessAccountId)?.name || 'Unnamed Account';
                      return (
                        <option key={d.id} value={d.id}>
                          {bizAcName} - {formatCurrency(d.amount)} ({d.date})
                        </option>
                      );
                    })}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedDraftId) {
                        setDrafts(prev => {
                          const updated = prev.filter(d => d.id !== selectedDraftId);
                          localStorage.setItem('wento_expense_drafts', JSON.stringify(updated));
                          return updated;
                        });
                        setSelectedDraftId('');
                        setExpenseId('');
                        setBusinessAccountId('');
                        setAmount(0);
                        setDetails('');
                        setRemarks('');
                        resetModeFields('Cash');
                        setSuccessMsg('Draft deleted successfully.');
                        setTimeout(() => setSuccessMsg(''), 2000);
                      } else {
                        setErrorMsg('Please select a draft first.');
                        setTimeout(() => setErrorMsg(''), 2000);
                      }
                    }}
                    className="text-xs text-rose-600 hover:text-rose-800 font-semibold transition-colors"
                  >
                    Delete Selected Draft
                  </button>
                </div>
              </div>
            )}

            {/* Entry Form Card */}
            <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm" data-no-print>
              <h3 className="font-lora font-semibold text-xl border-b pb-3 mb-5 text-slate-800 flex items-center gap-2">
                <Wallet size={20} className="text-[#B08D57]" /> Expense / Payment Entry (Kharch)
              </h3>
              
              <form onSubmit={handleSaveExpense} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="soleria-input font-semibold"
                  />
                </div>

                {/* Business Account Dropdown */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Select Account (Who to Pay) <span className="text-red-500 font-bold">*</span>
                  </label>
                  <SearchableSelect
                    options={state.businessAccounts.map(b => ({
                      value: b.id,
                      label: `${b.name} (${b.id})`
                    }))}
                    value={businessAccountId}
                    onChange={setBusinessAccountId}
                    placeholder="Search account by name..."
                  />
                </div>

                {/* Display Parent Account Group */}
                {selectedBizAc && (
                  <div className="p-3 bg-amber-50/60 border border-amber-200/80 rounded-lg text-xs flex justify-between items-center">
                    <span className="text-amber-900 font-medium">Control Account Head:</span>
                    <span className="font-bold text-amber-950 uppercase tracking-wide">{bizParentAcName}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Amount Paid (PKR)</label>
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
                  <div className="grid grid-cols-4 gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => resetModeFields('Cash')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'Cash' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Cash
                    </button>
                    <button
                      type="button"
                      onClick={() => resetModeFields('ChequeEndorsed')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'ChequeEndorsed' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Cheque Endorsed
                    </button>
                    <button
                      type="button"
                      onClick={() => resetModeFields('ChequeIssued')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'ChequeIssued' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Cheque Issued
                    </button>
                    <button
                      type="button"
                      onClick={() => resetModeFields('Online')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'Online' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Online
                    </button>
                  </div>
                </div>

                {(paymentMode === 'Online' || paymentMode === 'ChequeIssued') && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Paid From Bank Account <span className="text-red-500 font-bold">*</span>
                    </label>
                    {state.bankAccounts.length === 0 ? (
                      <div className="soleria-input text-rose-600 text-sm flex items-center font-semibold">
                        Add a bank account first
                      </div>
                    ) : (
                      <SearchableSelect
                        options={bankOptions}
                        value={bankId}
                        onChange={setBankId}
                        placeholder="Select bank account..."
                      />
                    )}
                  </div>
                )}

                {paymentMode === 'ChequeIssued' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Issued Cheque No. <span className="text-red-500 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        value={issuedChequeNo}
                        onChange={e => setIssuedChequeNo(e.target.value)}
                        placeholder="e.g. 109283"
                        className="soleria-input font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Date Written on Cheque <span className="text-red-500 font-bold">*</span>
                      </label>
                      <input
                        type="date"
                        value={issuedChequeDate}
                        onChange={e => setIssuedChequeDate(e.target.value)}
                        className="soleria-input"
                      />
                    </div>
                  </div>
                )}

                {paymentMode === 'ChequeEndorsed' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Select Cheque to Hand Over <span className="text-red-500 font-bold">*</span>
                    </label>
                    {endorsableCheques.length === 0 ? (
                      <div className="soleria-input text-slate-400 text-sm flex items-center">
                        No cheques in hand with value left
                      </div>
                    ) : (
                      <SearchableSelect
                        options={endorsableCheques}
                        value={chequeId}
                        onChange={setChequeId}
                        placeholder="Select cheque to endorse..."
                      />
                    )}
                  </div>
                )}

                {paymentMode !== 'Cash' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      {paymentMode === 'Online' ? 'Online Reference Code / Details' : 'Details'}
                    </label>
                    <input
                      type="text"
                      value={details}
                      onChange={e => setDetails(e.target.value)}
                      placeholder={paymentMode === 'Online' ? 'e.g. Alfa ref 980124' : 'Optional notes'}
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

                <div className="flex gap-3 mt-2">
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    className="btn-outline flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold"
                  >
                    <FileText size={16} /> Save in Draft
                  </button>
                  <button
                    type="submit"
                    className="btn-gold flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold"
                  >
                    <Save size={16} /> Save Expense
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
