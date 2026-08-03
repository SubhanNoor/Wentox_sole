import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { Expense, ExpenseMode } from '@/types';
import { Save, Wallet } from 'lucide-react';
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
      id: 'exp_' + Date.now(),
      date,
      businessAccountId,
      amount,
      paymentMode,
      bankId: (paymentMode === 'Online' || paymentMode === 'ChequeIssued') ? bankId : undefined,
      chequeId: paymentMode === 'ChequeEndorsed' ? chequeId : undefined,
      issuedChequeNo: paymentMode === 'ChequeIssued' ? issuedChequeNo.trim() : undefined,
      issuedChequeDate: paymentMode === 'ChequeIssued' ? issuedChequeDate : undefined,
      details,
      remarks
    };

    dispatch({ type: 'ADD_EXPENSE', expense: newExpense });

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
                  <div className={`flex flex-col gap-2.5 p-3.5 border rounded-lg text-xs ${isVendorPayment ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                    {isVendorPayment && (
                      <div className="flex items-center gap-1.5 pb-2 border-b border-amber-200/70">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300">
                          Vendor Payment
                        </span>
                        <span className="text-amber-700 font-medium">
                          Counts toward {linkedVendor?.name || 'this vendor'}'s "Payment Paid" total in Vendor Report
                        </span>
                      </div>
                    )}
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
                  {/*
                    Four modes, not three. "Cheque" split in two because they
                    take money from DIFFERENT places: endorsing hands on a
                    customer's cheque out of Cheques in Hand, while issuing
                    writes our own and draws on a bank.
                  */}
                  <div className="grid grid-cols-2 gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                    {([
                      { m: 'Cash' as ExpenseMode, label: 'Cash', hint: 'from Petty Cash' },
                      { m: 'Online' as ExpenseMode, label: 'Online', hint: 'from a bank' },
                      { m: 'ChequeIssued' as ExpenseMode, label: 'Cheque — Issue', hint: 'we write it' },
                      { m: 'ChequeEndorsed' as ExpenseMode, label: 'Cheque — Endorse', hint: 'hand on a received one' },
                    ]).map(opt => (
                      <button
                        key={opt.m}
                        type="button"
                        onClick={() => resetModeFields(opt.m)}
                        className={`py-2 px-1 rounded-md transition-colors leading-tight ${paymentMode === opt.m ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                      >
                        <span className="block">{opt.label}</span>
                        <span className="block text-[10px] font-medium text-slate-400">{opt.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {(paymentMode === 'Online' || paymentMode === 'ChequeIssued') && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Paid From <span className="text-red-500 font-bold">*</span>
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
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Cheque No. <span className="text-red-500 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        value={issuedChequeNo}
                        onChange={e => setIssuedChequeNo(e.target.value)}
                        placeholder="e.g. 441098"
                        className="soleria-input font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Cheque Date <span className="text-red-500 font-bold">*</span>
                      </label>
                      <input
                        type="date"
                        value={issuedChequeDate}
                        onChange={e => setIssuedChequeDate(e.target.value)}
                        className="soleria-input"
                      />
                    </div>
                    <p className="col-span-2 text-[10px] text-slate-400 -mt-1">
                      The bank is reduced on the date the cheque is written, not when it clears —
                      so this balance shows what you have committed, not what the bank would say today.
                    </p>
                  </div>
                )}

                {paymentMode === 'ChequeEndorsed' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Which Received Cheque <span className="text-red-500 font-bold">*</span>
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
