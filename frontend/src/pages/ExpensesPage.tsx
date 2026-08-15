import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type {
  VendorRow, BankAccountRow, BusinessAccountRow, ChequeRow, ChequeAllocationRow,
  ExpenseRow, ExpenseCreateInput, DraftExpenseRow, ExpensePaymentMode
} from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Save, Wallet, Edit, Trash2 } from 'lucide-react';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import WeeklyExpensesTab from '@/components/WeeklyExpensesTab';
import MonthlyExpensesTab from '@/components/MonthlyExpensesTab';
import OverallExpensesTab from '@/components/OverallExpensesTab';
import AccountBalanceTooltip from '@/components/AccountBalanceTooltip';

const today = () => new Date().toISOString().split('T')[0];

// Cheques still in the drawer with value left — a fully-endorsed, cleared, bounced,
// or returned-to-sender cheque must not appear in the endorsement picker.
const NON_TERMINAL_CHEQUE_STATUS = new Set(['PENDING', 'DEPOSITED', 'ENDORSED', 'PARTIALLY_ENDORSED']);

export default function ExpensesPage() {
  // Navigation / Tabs State
  const [activeTab, setActiveTab] = useState<'entry' | 'weekly' | 'monthly' | 'overall'>('entry');

  // ── Real lookup / list data ──
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [businessAccounts, setBusinessAccounts] = useState<BusinessAccountRow[]>([]);
  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [cheques, setCheques] = useState<ChequeRow[]>([]);
  const [allocationsByReceipt, setAllocationsByReceipt] = useState<Record<number, ChequeAllocationRow[]>>({});
  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([]);
  const [drafts, setDrafts] = useState<DraftExpenseRow[]>([]);
  const [lookupError, setLookupError] = useState('');

  const refreshExpenses = useCallback(async () => {
    const res = await api.expenses.list({});
    if (res.ok) setExpenseRows(res.data);
    else setLookupError('Failed to load expenses: ' + res.error.message);
  }, []);

  const refreshDrafts = useCallback(async () => {
    const res = await api.draftExpenses.list({});
    if (res.ok) setDrafts(res.data);
    else setLookupError('Failed to load drafts: ' + res.error.message);
  }, []);

  const refreshCheques = useCallback(async () => {
    const res = await api.cheques.list();
    if (res.ok) {
      setCheques(res.data);
      const entries = await Promise.all(
        res.data.map(async c => {
          const allocRes = await api.cheques.allocationsForReceipt(c.receipt_id);
          return [c.receipt_id, allocRes.ok ? allocRes.data : []] as const;
        })
      );
      setAllocationsByReceipt(Object.fromEntries(entries));
    } else {
      setLookupError('Failed to load cheques: ' + res.error.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const [v, ba, bk] = await Promise.all([
        api.listVendors(), api.listBusinessAccounts(), api.bankAccounts.list()
      ]);
      const failures: string[] = [];
      if (v.ok) setVendors(v.data); else failures.push(v.error.message);
      if (ba.ok) setBusinessAccounts(ba.data); else failures.push(ba.error.message);
      if (bk.ok) setBanks(bk.data); else failures.push(bk.error.message);
      if (failures.length) setLookupError('Failed to load lookup data: ' + failures.join('; '));
    })();
    refreshExpenses();
    refreshDrafts();
    refreshCheques();
  }, [refreshExpenses, refreshDrafts, refreshCheques]);

  // ── Real-expense form (mirrors ReceiptsPage.tsx's mode structure) ──
  const [mode, setMode] = useState<'new' | 'edit' | 'view'>('new');
  const [expenseId, setExpenseId] = useState<number | null>(null);
  const [expenseStatus, setExpenseStatus] = useState<'CONFIRMED' | 'DRAFT'>('DRAFT');
  const [date, setDate] = useState(today());
  const [baId, setBaId] = useState('');
  // RJ-02/PN-01: previewed account while arrow-keying through the dropdown, for the live balance tooltip.
  const [previewBaId, setPreviewBaId] = useState<number | null>(null);

  // PN-01/RJ-06: delete an expense entry, password-gated.
  const [deleteTarget, setDeleteTarget] = useState<ExpenseRow | null>(null);
  const handleDeleteConfirmed = async (password: string) => {
    if (!deleteTarget) return;
    const res = await api.expenses.remove(deleteTarget.expense_id, password);
    setDeleteTarget(null);
    if (!res.ok) return fail('Failed to delete: ' + res.error.message);
    flash('Expense deleted.');
    refreshExpenses();
  };
  // Bumped after anything that posts, so the balance panel re-reads instead of showing a stale figure.
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const [amount, setAmount] = useState<number>(0);
  const [paymentMode, setPaymentMode] = useState<ExpensePaymentMode>('CASH');
  const [bankId, setBankId] = useState('');
  const [chequeId, setChequeId] = useState('');
  const [issuedChequeNo, setIssuedChequeNo] = useState('');
  const [issuedChequeDate, setIssuedChequeDate] = useState('');
  const [details, setDetails] = useState('');
  const [remarks, setRemarks] = useState('');

  // draftExpenses is a separate server-side feature (genuinely incomplete entries) —
  // distinct from an expense's own DRAFT/CONFIRMED status above. Loading one just
  // fills the form; since draftExpenses has no update(), re-saving replaces it.
  const [loadedDraftId, setLoadedDraftId] = useState<number | null>(null);
  const [selectedDraftPick, setSelectedDraftPick] = useState('');

  // Alerts
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');


  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const isViewMode = mode === 'view';
  const isPosted = expenseStatus === 'CONFIRMED';

  const bankOptions = useMemo(
    () => banks.filter(b => b.is_active).map(b => ({ value: String(b.bank_id), label: b.name })),
    [banks]
  );

  // Combined vendor + any-other-business-account picker. A vendor's own ba_id is a
  // business account too, so listBusinessAccounts() already covers it — options are
  // keyed by ba_id, with vendor-linked accounts given a distinguishing label.
  const accountOptions = useMemo(() => {
    return businessAccounts.map(ba => {
      const vendor = vendors.find(v => v.ba_id === ba.ba_id);
      return {
        value: String(ba.ba_id),
        label: vendor ? `${vendor.name} (Vendor)` : `${ba.name} (${ba.code})`
      };
    });
  }, [businessAccounts, vendors]);

  const selectedBa = useMemo(
    () => businessAccounts.find(b => b.ba_id === Number(baId)),
    [baId, businessAccounts]
  );

  // Vendor payments are Expense entries where the selected account's parent chart
  // account is "VENDORS ACCOUNTS" (210001) — no separate transaction page, this is
  // purely a UI-level distinction that feeds the Vendor Report.
  const isVendorPayment = selectedBa?.ac_code === '210001';
  const linkedVendor = useMemo(() => {
    if (!isVendorPayment || !selectedBa) return undefined;
    return vendors.find(v => v.ba_id === selectedBa.ba_id);
  }, [isVendorPayment, selectedBa, vendors]);

  function unallocatedFor(c: ChequeRow): number {
    if (c.cheque_status === 'BOUNCED' || c.cheque_status === 'RETURNED' || c.cheque_status === 'CLEARED') return 0;
    const active = (allocationsByReceipt[c.receipt_id] || []).filter(a => a.status === 'ACTIVE');
    const allocated = active.reduce((s, a) => s + a.amount, 0);
    return Math.max(0, (c.receipt_amount ?? 0) - allocated);
  }

  const selectedCheque = useMemo(
    () => cheques.find(c => c.cheque_id === Number(chequeId)),
    [chequeId, cheques]
  );

  const endorsableCheques = useMemo(() => {
    const list = cheques
      .filter(c => NON_TERMINAL_CHEQUE_STATUS.has(c.cheque_status))
      .map(c => ({ cheque: c, left: unallocatedFor(c) }))
      .filter(x => x.left > 0)
      .map(x => ({
        value: String(x.cheque.cheque_id),
        label: `${x.cheque.cheque_no} — ${formatCurrency(x.left)} left`
      }));
    // A previously-endorsed cheque (viewing/editing a posted expense) may no longer
    // carry remaining balance and drop out of the list above — keep it selectable so
    // the field doesn't render blank.
    if (chequeId && !list.some(o => o.value === chequeId) && selectedCheque) {
      list.unshift({ value: chequeId, label: `${selectedCheque.cheque_no} (${selectedCheque.cheque_status})` });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheques, allocationsByReceipt, chequeId, selectedCheque]);

  const resetModeFields = () => {
    setBankId('');
    setChequeId('');
    setIssuedChequeNo('');
    setIssuedChequeDate('');
  };

  const selectPaymentMode = (m: ExpensePaymentMode) => {
    setPaymentMode(m);
    resetModeFields();
    if (m === 'CASH') setDetails('');
  };

  const handleNew = () => {
    setMode('new');
    setExpenseId(null);
    setExpenseStatus('DRAFT');
    setDate(today());
    setBaId('');
    setAmount(0);
    setPaymentMode('CASH');
    resetModeFields();
    setDetails('');
    setRemarks('');
    setLoadedDraftId(null);
    setSelectedDraftPick('');
    setErrorMsg('');
  };

  const buildPayload = (): ExpenseCreateInput | null => {
    if (!date) { setErrorMsg('Please pick a date.'); return null; }
    if (!baId) { setErrorMsg('Please select an account to pay.'); return null; }
    if (amount <= 0) { setErrorMsg('Amount must be greater than 0.'); return null; }
    if ((paymentMode === 'ONLINE' || paymentMode === 'CHEQUE_ISSUED') && !bankId) {
      setErrorMsg('Select which bank account this payment leaves.'); return null;
    }
    if (paymentMode === 'CHEQUE_ISSUED') {
      if (!issuedChequeNo.trim()) { setErrorMsg('Enter the cheque number.'); return null; }
      if (!issuedChequeDate) { setErrorMsg('Enter the date on the cheque.'); return null; }
    }
    if (paymentMode === 'CHEQUE_ENDORSED') {
      if (!chequeId) { setErrorMsg('Pick which received cheque is being handed over.'); return null; }
      const left = selectedCheque ? unallocatedFor(selectedCheque) : 0;
      if (amount > left) {
        setErrorMsg(`That cheque only has ${formatCurrency(left)} left unallocated.`);
        return null;
      }
    }

    const vendor = vendors.find(v => v.ba_id === Number(baId));

    return {
      expense_date: date,
      amount,
      payment_mode: paymentMode,
      vendor_id: vendor ? vendor.vendor_id : undefined,
      ba_id: vendor ? undefined : Number(baId),
      details: details.trim() || undefined,
      remarks: remarks.trim() || undefined,
      bank_id: (paymentMode === 'ONLINE' || paymentMode === 'CHEQUE_ISSUED') ? Number(bankId) : undefined,
      cheque_id: paymentMode === 'CHEQUE_ENDORSED' ? Number(chequeId) : undefined,
      issued_cheque_no: paymentMode === 'CHEQUE_ISSUED' ? issuedChequeNo.trim() : undefined,
      issued_cheque_date: paymentMode === 'CHEQUE_ISSUED' ? issuedChequeDate : undefined
    };
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;

    const result = mode === 'edit' && expenseId != null
      ? await api.expenses.update(expenseId, payload)
      : await api.expenses.create(payload);

    if (!result.ok) { fail('Failed to save expense: ' + result.error.message); return; }

    // A confirmed real expense supersedes whatever draftExpenses entry it came from.
    if (loadedDraftId != null) {
      await api.draftExpenses.remove(loadedDraftId);
      refreshDrafts();
    }

    setExpenseId(result.data.expense_id);
    setExpenseStatus(result.data.status);
    setLoadedDraftId(null);
    setErrorMsg('');
    flash(
      isVendorPayment
        ? `Vendor payment of ${formatCurrency(amount)} recorded against ${linkedVendor?.name || 'vendor'}.`
        : (mode === 'edit' ? 'Expense updated successfully.' : 'Expense recorded successfully.')
    );
    setMode('view');
    refreshExpenses();
  };

  const loadExpenseRow = async (rowIn: ExpenseRow) => {
    // list() rows never carry cheque_no/cheque_status (only get()'s join does) — re-fetch
    // full detail whenever a CHEQUE_ENDORSED row is opened for view/edit.
    let row = rowIn;
    if (row.payment_mode === 'CHEQUE_ENDORSED' && row.cheque_no === undefined) {
      const res = await api.expenses.get(row.expense_id);
      if (!res.ok) { fail('Failed to load expense: ' + res.error.message); return; }
      row = res.data;
    }

    setExpenseId(row.expense_id);
    setExpenseStatus(row.status);
    setDate(row.expense_date.slice(0, 10));
    setBaId(String(row.ba_id));
    setAmount(row.amount);
    setPaymentMode(row.payment_mode);
    setBankId(row.bank_id != null ? String(row.bank_id) : '');
    setChequeId(row.cheque_id != null ? String(row.cheque_id) : '');
    setIssuedChequeNo(row.issued_cheque_no || '');
    setIssuedChequeDate(row.issued_cheque_date ? row.issued_cheque_date.slice(0, 10) : '');
    setDetails(row.details || '');
    setRemarks(row.remarks || '');
    setLoadedDraftId(null);
    setSelectedDraftPick('');
    setErrorMsg('');
    setMode('view');
  };

  const handlePost = async () => {
    if (expenseId == null) return;
    const res = await api.expenses.post(expenseId);
    if (!res.ok) { fail('Failed to post expense: ' + res.error.message); return; }
    setExpenseStatus(res.data.status);
    flash('Expense posted successfully.');
    refreshExpenses();
    setBalanceRefreshKey(k => k + 1);
    refreshCheques();
  };

  // unpost() rejects CHEQUE_ENDORSED with USE_CHEQUE_REVERSAL — that error surfaces
  // as-is through the banner below rather than hiding/disabling the button, matching
  // how ReceiptsPage.tsx handles CHEQUE_IN_USE on its own unpost.
  const handleUnpost = async () => {
    if (expenseId == null) return;
    const res = await api.expenses.unpost(expenseId);
    if (!res.ok) { fail('Failed to unpost expense: ' + res.error.message); return; }
    setExpenseStatus(res.data.status);
    flash('Expense unposted successfully.');
    refreshExpenses();
    setBalanceRefreshKey(k => k + 1);
    refreshCheques();
  };



  // ── draftExpenses (server-side, all 4 payment modes draftable) ──
  /*
  const handleSaveDraft = async () => {
    ...
  };
  */

  const loadDraft = (row: DraftExpenseRow) => {
    setMode('new');
    setExpenseId(null);
    setExpenseStatus('DRAFT');
    setDate(row.expense_date.slice(0, 10));
    setBaId(String(row.ba_id));
    setAmount(row.amount || 0);
    setPaymentMode(row.payment_mode);
    setBankId(row.bank_id != null ? String(row.bank_id) : '');
    setChequeId(row.cheque_id != null ? String(row.cheque_id) : '');
    setIssuedChequeNo(row.issued_cheque_no || '');
    setIssuedChequeDate(row.issued_cheque_date ? row.issued_cheque_date.slice(0, 10) : '');
    setDetails(row.details || '');
    setRemarks(row.remarks || '');
    setLoadedDraftId(row.draft_id);
    setErrorMsg('');
  };



  const handleConfirmDraft = async () => {
    if (!selectedDraftPick) { fail('Please select a draft first.'); return; }
    const id = Number(selectedDraftPick);
    const res = await api.draftExpenses.confirm(id);
    if (!res.ok) { fail('Failed to confirm draft: ' + res.error.message); return; }
    if (loadedDraftId === id) handleNew();
    setSelectedDraftPick('');
    flash('Draft confirmed and posted as an expense.');
    refreshDrafts();
    refreshExpenses();
    refreshCheques();
  };

  const sortedExpenses = useMemo(
    () => [...expenseRows].sort((a, b) => b.expense_date.localeCompare(a.expense_date)),
    [expenseRows]
  );

  const accountName = useCallback((id: number) => {
    const ba = businessAccounts.find(b => b.ba_id === id);
    if (!ba) return 'Unknown Account';
    const vendor = vendors.find(v => v.ba_id === id);
    return vendor ? vendor.name : ba.name;
  }, [businessAccounts, vendors]);

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
            {lookupError && (
              <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{lookupError}</div>
            )}
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
                    value={selectedDraftPick}
                    onChange={e => {
                      const draftId = e.target.value;
                      setSelectedDraftPick(draftId);
                      const selected = drafts.find(d => String(d.draft_id) === draftId);
                      if (selected) loadDraft(selected);
                    }}
                    className="soleria-input py-1 px-2.5 text-xs bg-white border cursor-pointer font-medium"
                    style={{ width: '240px' }}
                  >
                    <option value="">Select a draft to load...</option>
                    {drafts.map(d => (
                      <option key={d.draft_id} value={d.draft_id}>
                        {accountName(d.ba_id)} - {formatCurrency(d.amount)} ({formatDate(d.expense_date)})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleConfirmDraft}
                    className="text-xs text-emerald-700 hover:text-emerald-900 font-semibold transition-colors"
                  >
                    Confirm Draft
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDraft}
                    className="text-xs text-emerald-700 hover:text-emerald-900 font-semibold transition-colors"
                  >
                    Confirm Draft
                  </button>
                </div>
              </div>
            )}

            {/* Entry Form Card */}
            <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm" data-no-print>
              <div className="flex items-center justify-between border-b pb-3 mb-5">
                <h3 className="font-lora font-semibold text-xl text-slate-800 flex items-center gap-2">
                  <Wallet size={20} className="text-[#B08D57]" /> Expense / Payment Entry (Kharch)
                </h3>
                {mode === 'view' && (
                  <div className="flex items-center gap-2">
                    {!isPosted && (
                      <button
                        type="button"
                        onClick={() => setMode('edit')}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] border border-[#B08D57] shadow-sm transition-all flex items-center gap-1.5"
                      >
                        <Edit size={13} /> Edit
                      </button>
                    )}
                    {!isPosted ? (
                      <button
                        type="button"
                        onClick={handlePost}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
                      >
                        Post
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleUnpost}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-all"
                      >
                        Unpost
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleNew}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all"
                    >
                      New Expense
                    </button>
                  </div>
                )}
              </div>

              <form onSubmit={handleSaveExpense} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
                  <input
                    type="date"
                    value={date}
                    disabled={isViewMode}
                    onChange={e => setDate(e.target.value)}
                    className="soleria-input font-semibold"
                  />
                </div>

                {/* RJ-02/PN-01: account picker + a small live balance tooltip next to it,
                    updating as the user arrow-keys/hovers through the dropdown (falls back to
                    the committed account once closed). Replaces the old below-the-field panel. */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Select Account (Who to Pay) <span className="text-red-500 font-bold">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <SearchableSelect
                        options={accountOptions}
                        value={baId}
                        onChange={setBaId}
                        onHighlightChange={val => setPreviewBaId(val ? Number(val) : null)}
                        placeholder="Search account by name..."
                        disabled={isViewMode}
                      />
                    </div>
                    <AccountBalanceTooltip baId={previewBaId ?? (baId ? Number(baId) : null)} refreshKey={balanceRefreshKey} />
                  </div>
                </div>

                {/* Display Parent Account Group */}
                {selectedBa && (
                  <div className="p-3 bg-amber-50/60 border border-amber-200/80 rounded-lg text-xs flex justify-between items-center">
                    <span className="text-amber-900 font-medium">Control Account Head:</span>
                    <span className="font-bold text-amber-950 uppercase tracking-wide">
                      {selectedBa.ac_name || 'EXPENSES ACCOUNTS'}
                    </span>
                  </div>
                )}

                {/* PN-01: Remarks moved ahead of Amount so it's filled in first. */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks</label>
                  <textarea
                    value={remarks}
                    disabled={isViewMode}
                    onChange={e => setRemarks(e.target.value)}
                    placeholder="Enter remarks..."
                    className="soleria-input"
                    rows={2}
                    style={{ resize: 'none' }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Amount Paid (PKR)</label>
                  <input
                    type="number"
                    min={0}
                    value={amount || ''}
                    disabled={isViewMode}
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
                      disabled={isViewMode}
                      onClick={() => selectPaymentMode('CASH')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'CASH' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Cash
                    </button>
                    <button
                      type="button"
                      disabled={isViewMode}
                      onClick={() => selectPaymentMode('CHEQUE_ENDORSED')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'CHEQUE_ENDORSED' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Cheque Endorsed
                    </button>
                    <button
                      type="button"
                      disabled={isViewMode}
                      onClick={() => selectPaymentMode('CHEQUE_ISSUED')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'CHEQUE_ISSUED' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Cheque Issued
                    </button>
                    <button
                      type="button"
                      disabled={isViewMode}
                      onClick={() => selectPaymentMode('ONLINE')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'ONLINE' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Online
                    </button>
                  </div>
                </div>

                {(paymentMode === 'ONLINE' || paymentMode === 'CHEQUE_ISSUED') && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Paid From Bank Account <span className="text-red-500 font-bold">*</span>
                    </label>
                    {bankOptions.length === 0 ? (
                      <div className="soleria-input text-rose-600 text-sm flex items-center font-semibold">
                        Add a bank account first
                      </div>
                    ) : (
                      <SearchableSelect
                        options={bankOptions}
                        value={bankId}
                        onChange={setBankId}
                        placeholder="Select bank account..."
                        disabled={isViewMode}
                      />
                    )}
                  </div>
                )}

                {paymentMode === 'CHEQUE_ISSUED' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Issued Cheque No. <span className="text-red-500 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        value={issuedChequeNo}
                        disabled={isViewMode}
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
                        disabled={isViewMode}
                        onChange={e => setIssuedChequeDate(e.target.value)}
                        className="soleria-input"
                      />
                    </div>
                  </div>
                )}

                {paymentMode === 'CHEQUE_ENDORSED' && (
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
                        disabled={isViewMode}
                      />
                    )}
                  </div>
                )}

                {paymentMode !== 'CASH' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      {paymentMode === 'ONLINE' ? 'Online Reference Code / Details' : 'Details'}
                    </label>
                    <input
                      type="text"
                      value={details}
                      disabled={isViewMode}
                      onChange={e => setDetails(e.target.value)}
                      placeholder={paymentMode === 'ONLINE' ? 'e.g. Alfa ref 980124' : 'Optional notes'}
                      className="soleria-input"
                    />
                  </div>
                )}

                {/* RJ-04/PN-01: sticky so the post/save action stays reachable without
                    scrolling back up or down a long form. */}
                {!isViewMode && (
                  <div className="sticky bottom-0 z-10 -mx-6 md:-mx-8 px-6 md:px-8 pt-3 pb-4 mt-2 bg-white border-t" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        className="btn-gold w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold"
                      >
                        <Save size={16} /> {mode === 'edit' ? 'Update Expense' : 'Save Expense'}
                      </button>
                    </div>
                  </div>
                )}
              </form>
            </div>

            {/* Recorded Expenses */}
            <div className="card-white p-6 mt-8 bg-white border border-slate-200 rounded-xl shadow-sm">
              <h3 className="font-lora font-semibold text-lg text-slate-800 mb-4">Recorded Expenses</h3>
              {sortedExpenses.length === 0 ? (
                <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
                  No expenses recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                        <th className="p-3 pl-4">Date</th>
                        <th className="p-3">Account</th>
                        <th className="p-3 text-center">Mode</th>
                        <th className="p-3 text-right">Amount</th>
                        <th className="p-3 text-center">Status</th>
                        <th className="p-3 text-center" style={{ width: 50 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedExpenses.map(r => (
                        <tr
                          key={r.expense_id}
                          onClick={() => loadExpenseRow(r)}
                          className="border-b hover:bg-slate-50/50 cursor-pointer"
                          style={{ borderColor: 'var(--border-table)' }}
                        >
                          <td className="p-3 pl-4 font-mono text-slate-600">{formatDate(r.expense_date)}</td>
                          <td className="p-3 font-semibold text-slate-900">{r.ba_name || accountName(r.ba_id)}</td>
                          <td className="p-3 text-center text-xs text-slate-500">{r.payment_mode}</td>
                          <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(r.amount)}</td>
                          <td className="p-3 text-center">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                              r.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            {r.status !== 'CONFIRMED' && (
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); setDeleteTarget(r); }}
                                title="Delete"
                                className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}



      </div>

      <PasswordPromptModal
        isOpen={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        onSuccess={handleDeleteConfirmed}
        title="Delete Expense"
        subtitle={deleteTarget ? `Confirm your password to permanently delete this ${formatCurrency(deleteTarget.amount)} expense. This cannot be undone.` : undefined}
      />
    </AppLayout>
  );
}
