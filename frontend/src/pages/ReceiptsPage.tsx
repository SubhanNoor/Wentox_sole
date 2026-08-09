import { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { CustomerRow, BusinessAccountRow, RegionRow, CityRow, BankAccountRow, ReceiptRow, ReceiptCreateInput, DraftReceiptRow } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Save, Search, Edit } from 'lucide-react';
import WeeklyReceiptsTab from '@/components/WeeklyReceiptsTab';
import MonthlyReceiptsTab from '@/components/MonthlyReceiptsTab';
import OverallReceiptsTab from '@/components/OverallReceiptsTab';
import ChequesTab from '@/components/ChequesTab';
import AccountBalancePanel from '@/components/AccountBalancePanel';

type ReceiptTab = 'entry' | 'weekly' | 'monthly' | 'overall' | 'cheques';

const RECEIPT_TAB_LABELS: Record<ReceiptTab, string> = {
  entry: 'Receipt Entry',
  weekly: 'Weekly Records',
  monthly: 'Monthly Records',
  overall: 'Overall Records',
  cheques: 'Cheques Disposal'
};

const today = () => new Date().toISOString().split('T')[0];

export default function ReceiptsPage() {
  const { state } = useApp();

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

  // ── Real lookup / list data ──
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [businessAccounts, setBusinessAccounts] = useState<BusinessAccountRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [drafts, setDrafts] = useState<DraftReceiptRow[]>([]);
  const [lookupError, setLookupError] = useState('');

  const refreshReceipts = useCallback(async () => {
    const res = await api.receipts.list({});
    if (res.ok) setReceipts(res.data);
    else setLookupError('Failed to load receipts: ' + res.error.message);
  }, []);

  const refreshDrafts = useCallback(async () => {
    const res = await api.draftReceipts.list({});
    if (res.ok) setDrafts(res.data);
    else setLookupError('Failed to load drafts: ' + res.error.message);
  }, []);

  useEffect(() => {
    (async () => {
      const [c, ba, rg, ct, bk] = await Promise.all([
        api.listCustomers(), api.listBusinessAccounts(), api.listRegions(), api.listCities(),
        api.bankAccounts.list()
      ]);
      const failures: string[] = [];
      if (c.ok) setCustomers(c.data); else failures.push(c.error.message);
      if (ba.ok) setBusinessAccounts(ba.data); else failures.push(ba.error.message);
      if (rg.ok) setRegions(rg.data); else failures.push(rg.error.message);
      if (ct.ok) setCities(ct.data); else failures.push(ct.error.message);
      if (bk.ok) setBanks(bk.data); else failures.push(bk.error.message);
      if (failures.length) setLookupError('Failed to load lookup data: ' + failures.join('; '));
    })();
    refreshReceipts();
    refreshDrafts();
  }, [refreshReceipts, refreshDrafts]);

  // ── Real-receipt form (mirrors PurchasePage.tsx's mode structure) ──
  const [mode, setMode] = useState<'new' | 'edit' | 'view'>('new');
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [receiptStatus, setReceiptStatus] = useState<'CONFIRMED' | 'DRAFT'>('DRAFT');
  const [date, setDate] = useState(today());
  const [baId, setBaId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [commission, setCommission] = useState<number>(0);
  const [paymentMode, setPaymentMode] = useState<'CASH' | 'ONLINE' | 'CHEQUE'>('CASH');
  const [bankId, setBankId] = useState('');
  const [details, setDetails] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [chequeReceivedDate, setChequeReceivedDate] = useState('');
  const [remarks, setRemarks] = useState('');

  // draftReceipts is a separate server-side feature (genuinely incomplete entries) —
  // distinct from a receipt's own DRAFT/CONFIRMED status above. Loading one just
  // fills the form; since draftReceipts has no update(), re-saving replaces it.
  const [loadedDraftId, setLoadedDraftId] = useState<number | null>(null);
  const [selectedDraftPick, setSelectedDraftPick] = useState('');
  // Bumped after anything that posts, so the balance panel re-reads instead of showing a stale figure.
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);

  // Dropdown search state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [accountSearchQuery, setAccountSearchQuery] = useState('');

  // Alerts
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');


  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const isViewMode = mode === 'view';
  const isPosted = receiptStatus === 'CONFIRMED';

  // A receipt can name ANY business account, not just a customer's (migration 014) — the same
  // freedom the Expenses/Naam side has always had.
  const selectedAccount = useMemo(
    () => businessAccounts.find(b => b.ba_id === Number(baId)),
    [baId, businessAccounts]
  );

  // Commission is payment-time trade discount to a CUSTOMER (§7) and means nothing on money coming
  // back from a director, an employee or a bank — so the field only appears for a customer account.
  // customers.ba_id is UNIQUE, so this lookup is exact.
  const selectedCustomer = useMemo(
    () => (selectedAccount ? customers.find(c => c.ba_id === selectedAccount.ba_id) : undefined),
    [selectedAccount, customers]
  );

  // Dropdown list filter — same Region-then-City ordering the customer picker used; business
  // accounts carry region_id/city_id of their own, so nothing is lost by widening the list.
  const filteredDropdownAccounts = useMemo(() => {
    const regionName = (id: number | null) => id == null ? '' : regions.find(r => r.region_id === id)?.name || '';
    const cityName = (id: number | null) => id == null ? '' : cities.find(ct => ct.city_id === id)?.name || '';
    const query = accountSearchQuery.trim().toLowerCase();
    const list = query
      ? businessAccounts.filter(b =>
          b.name.toLowerCase().includes(query) ||
          b.code.toLowerCase().includes(query) ||
          (b.ac_name || '').toLowerCase().includes(query)
        )
      : businessAccounts;
    return [...list].sort((a, b) => {
      const regionCmp = regionName(a.region_id).localeCompare(regionName(b.region_id));
      if (regionCmp !== 0) return regionCmp;
      const cityCmp = cityName(a.city_id).localeCompare(cityName(b.city_id));
      if (cityCmp !== 0) return cityCmp;
      return a.name.localeCompare(b.name);
    });
  }, [accountSearchQuery, businessAccounts, regions, cities]);

  const bankOptions = useMemo(
    () => banks.filter(b => b.is_active).map(b => ({ value: String(b.bank_id), label: b.name })),
    [banks]
  );

  const handleNew = () => {
    setMode('new');
    setReceiptId(null);
    setReceiptStatus('DRAFT');
    setDate(today());
    setBaId('');
    setAccountSearchQuery('');
    setAmount(0);
    setCommission(0);
    setPaymentMode('CASH');
    setBankId('');
    setDetails('');
    setChequeNo('');
    setChequeDate('');
    setChequeReceivedDate('');
    setRemarks('');
    setLoadedDraftId(null);
    setSelectedDraftPick('');
    setErrorMsg('');
  };

  const buildPayload = (): ReceiptCreateInput | null => {
    if (!date) { setErrorMsg('Please pick a date.'); return null; }
    if (!baId) { setErrorMsg('Please select an account.'); return null; }
    if (amount <= 0) { setErrorMsg('Amount must be greater than 0.'); return null; }
    if (paymentMode === 'ONLINE' && !bankId) { setErrorMsg('Select which bank account received this money.'); return null; }
    if (paymentMode === 'CHEQUE' && !chequeNo.trim()) { setErrorMsg('Cheque No. is required for cheque payments.'); return null; }
    if (paymentMode === 'CHEQUE' && !chequeDate) { setErrorMsg('Date on Cheque is required for cheque payments.'); return null; }

    return {
      ba_id: Number(baId),
      receipt_date: date,
      amount,
      commission: selectedCustomer ? (commission || undefined) : undefined,
      payment_mode: paymentMode,
      details: details.trim() || undefined,
      bank_id: paymentMode === 'ONLINE' ? Number(bankId) : undefined,
      cheque_no: paymentMode === 'CHEQUE' ? chequeNo.trim() : undefined,
      cheque_date: paymentMode === 'CHEQUE' ? chequeDate : undefined,
      cheque_received_date: paymentMode === 'CHEQUE' ? (chequeReceivedDate || date) : undefined,
      remarks: remarks.trim() || undefined
    };
  };

  const handleSaveReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;

    const result = mode === 'edit' && receiptId != null
      ? await api.receipts.update(receiptId, payload)
      : await api.receipts.create(payload);

    if (!result.ok) { fail('Failed to save receipt: ' + result.error.message); return; }

    // A confirmed real receipt supersedes whatever draftReceipts entry it came from.
    if (loadedDraftId != null) {
      await api.draftReceipts.remove(loadedDraftId);
      refreshDrafts();
    }

    setReceiptId(result.data.receipt_id);
    setReceiptStatus(result.data.status);
    setLoadedDraftId(null);
    setErrorMsg('');
    flash(mode === 'edit' ? 'Receipt updated successfully.' : 'Receipt recorded successfully.');
    setMode('view');
    refreshReceipts();
    setBalanceRefreshKey(k => k + 1);
  };

  // Receipts are created DRAFT; only post() writes ledger_entries, so until this runs the receipt
  // has no effect on any balance or report. This page had no way to call it at all — receipts:post
  // and receipts:unpost existed on the backend and in lib/api.ts but nothing on screen invoked them,
  // so every receipt entered here stayed an invisible DRAFT forever (the seeded ones are CONFIRMED
  // only because dev-sample-data.js calls the service directly).
  const handlePost = async () => {
    if (receiptId == null) return;
    const res = await api.receipts.post(receiptId);
    if (!res.ok) { fail('Failed to post receipt: ' + res.error.message); return; }
    setReceiptStatus(res.data.status);
    flash('Receipt posted successfully.');
    refreshReceipts();
    setBalanceRefreshKey(k => k + 1);
  };

  // unpost() can reject with CHEQUE_IN_USE when the receipt's cheque has already been endorsed or
  // deposited; that error surfaces as-is in the banner rather than hiding the button, same as the
  // equivalent on ExpensesPage.
  const handleUnpost = async () => {
    if (receiptId == null) return;
    const res = await api.receipts.unpost(receiptId);
    if (!res.ok) { fail('Failed to unpost receipt: ' + res.error.message); return; }
    setReceiptStatus(res.data.status);
    flash('Receipt unposted successfully.');
    refreshReceipts();
    setBalanceRefreshKey(k => k + 1);
  };

  const loadReceiptRow = async (rowIn: ReceiptRow) => {
    // list() rows never carry cheque_no/cheque_date (only get()'s join does) — re-fetch
    // full detail whenever a CHEQUE row is opened for view/edit.
    let row = rowIn;
    if (row.payment_mode === 'CHEQUE' && row.cheque_no === undefined) {
      const res = await api.receipts.get(row.receipt_id);
      if (!res.ok) { fail('Failed to load receipt: ' + res.error.message); return; }
      row = res.data;
    }

    setReceiptId(row.receipt_id);
    setReceiptStatus(row.status);
    setDate(row.receipt_date.slice(0, 10));
    setBaId(String(row.ba_id));
    setAmount(row.amount);
    setCommission(row.commission || 0);
    setPaymentMode(row.payment_mode);
    setBankId(row.bank_id != null ? String(row.bank_id) : '');
    setDetails(row.details || '');
    setChequeNo(row.cheque_no || '');
    setChequeDate(row.cheque_date ? row.cheque_date.slice(0, 10) : '');
    setChequeReceivedDate(row.cheque_received_date ? row.cheque_received_date.slice(0, 10) : '');
    setRemarks(row.remarks || '');
    setLoadedDraftId(null);
    setSelectedDraftPick('');
    setErrorMsg('');
    setMode('view');
  };





  // ── draftReceipts (server-side, CASH/ONLINE only) ──
  /*
  const handleSaveDraft = async () => {
    ...
  };
  */

  const loadDraft = (row: DraftReceiptRow) => {
    setMode('new');
    setReceiptId(null);
    setReceiptStatus('DRAFT');
    setDate(row.receipt_date.slice(0, 10));
    setBaId(String(row.ba_id));
    setAmount(row.amount || 0);
    setCommission(row.commission || 0);
    setPaymentMode(row.payment_mode);
    setBankId(row.bank_id != null ? String(row.bank_id) : '');
    setDetails(row.details || '');
    setChequeNo('');
    setChequeDate('');
    setChequeReceivedDate('');
    setRemarks(row.remarks || '');
    setLoadedDraftId(row.draft_id);
    setErrorMsg('');
  };



  const handleConfirmDraft = async () => {
    if (!selectedDraftPick) { fail('Please select a draft first.'); return; }
    const id = Number(selectedDraftPick);
    const res = await api.draftReceipts.confirm(id);
    if (!res.ok) { fail('Failed to confirm draft: ' + res.error.message); return; }
    if (loadedDraftId === id) handleNew();
    setSelectedDraftPick('');
    flash('Draft confirmed and posted as a receipt.');
    refreshDrafts();
    refreshReceipts();
    setBalanceRefreshKey(k => k + 1);
  };

  const sortedReceipts = useMemo(
    () => [...receipts].sort((a, b) => b.receipt_date.localeCompare(a.receipt_date)),
    [receipts]
  );

  const accountName = useCallback(
    (id: number) => businessAccounts.find(b => b.ba_id === id)?.name || 'Unknown Account',
    [businessAccounts]
  );

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
                : 'bg-white border border-slate-200 text-[#111c2a] hover:bg-slate-50'
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
              Cheques Disposal
            </button>
          )}
        </div>

        {/* Tab Content */}
        {activeTab === 'weekly' && <WeeklyReceiptsTab />}
        {activeTab === 'monthly' && <MonthlyReceiptsTab />}
        {activeTab === 'overall' && <OverallReceiptsTab />}
        {activeTab === 'cheques' && state.currentUserRole !== 'User' && <ChequesTab />}

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
                    {drafts.length} incomplete receipt(s) cached
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
                        {d.account_name || accountName(d.ba_id)} - {formatCurrency(d.amount)} ({formatDate(d.receipt_date)})
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
                </div>
              </div>
            )}

            {/* Entry Form Card */}
            <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm" data-no-print>
              <div className="flex items-center justify-between border-b pb-3 mb-5">
                <div className="flex items-center gap-2">
                  <span className="font-lora font-bold text-lg text-slate-900">
                    {mode === 'edit' ? `Editing Receipt #${receiptId}` : mode === 'view' ? `Receipt #${receiptId}` : 'New Receipt Voucher'}
                  </span>
                  {receiptId != null && (
                    isPosted ? (
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">
                        Posted
                      </span>
                    ) : (
                      <span
                        className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-900"
                        title="Saved but not yet in the ledger — Post it to affect any balance or report."
                      >
                        Not Posted
                      </span>
                    )
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {mode === 'view' && !isPosted && (
                    <button
                      type="button"
                      onClick={() => setMode('edit')}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all flex items-center gap-1"
                    >
                      <Edit size={14} /> Edit
                    </button>
                  )}
                  {mode === 'view' && receiptId != null && (
                    isPosted ? (
                      <button
                        type="button"
                        onClick={handleUnpost}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-all"
                      >
                        Unpost
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handlePost}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
                      >
                        Post
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    onClick={handleNew}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all"
                  >
                    New Receipt
                  </button>
                </div>
              </div>

              <form onSubmit={handleSaveReceipt} className="flex flex-col gap-4">
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

                {/* Account Dropdown — any business account, not only customers */}
                <div className="relative">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Select Account <span className="text-red-500 font-bold">*</span>
                  </label>
                  <div
                    onClick={() => !isViewMode && setIsDropdownOpen(!isDropdownOpen)}
                    className={`soleria-input flex justify-between items-center font-semibold bg-white ${isViewMode ? '' : 'cursor-pointer'}`}
                  >
                    <span className={selectedAccount ? 'text-slate-800 font-semibold' : 'text-slate-400'}>
                      {selectedAccount ? `${selectedAccount.name} (${selectedAccount.code})` : 'Search account...'}
                    </span>
                    {!isViewMode && <span className="text-xs text-slate-400">▼</span>}
                  </div>

                  {isDropdownOpen && !isViewMode && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                      <div className="p-2 border-b sticky top-0 bg-white">
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Type to search..."
                            value={accountSearchQuery}
                            onChange={e => setAccountSearchQuery(e.target.value)}
                            className="w-full py-1.5 pl-8 pr-3 text-xs border rounded-md font-semibold"
                            autoFocus
                          />
                          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                        </div>
                      </div>
                      <div className="py-1">
                        {filteredDropdownAccounts.length === 0 ? (
                          <div className="p-3 text-xs text-slate-400 text-center font-medium">No matching accounts</div>
                        ) : (
                          filteredDropdownAccounts.map(b => {
                            const regName = b.region_id != null ? regions.find(r => r.region_id === b.region_id)?.name || '' : '';
                            const ctName = b.city_id != null ? cities.find(ct => ct.city_id === b.city_id)?.name || '' : '';
                            // The parent chart account is what tells a customer from a director or a
                            // bank, so it doubles as the row's secondary label when there is no city.
                            const place = [regName, ctName].filter(Boolean).join(' — ');
                            return (
                              <div
                                key={b.ba_id}
                                onClick={() => {
                                  setBaId(String(b.ba_id));
                                  setIsDropdownOpen(false);
                                  setAccountSearchQuery('');
                                }}
                                className="px-3 py-2 hover:bg-slate-50 cursor-pointer flex items-center justify-between text-xs gap-3"
                              >
                                <div className="min-w-0">
                                  <span className="font-semibold text-slate-800">{b.name}</span>
                                  <span className="text-slate-400 text-[10px] ml-2">({b.code})</span>
                                </div>
                                <div className="text-[10px] text-slate-500 font-medium text-right shrink-0">
                                  {place || b.ac_name || ''}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* A receipt CREDITS the selected account, so both lines push the balance down.
                    Commission only exists for a customer account (§7), hence the guard. */}
                <AccountBalancePanel
                  baId={baId ? Number(baId) : null}
                  refreshKey={balanceRefreshKey}
                  lines={[
                    { label: 'This receipt', delta: -amount },
                    { label: 'Commission', delta: selectedCustomer ? -commission : 0 },
                  ]}
                />

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Amount Received (PKR)</label>
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

                {/* Commission is customer-only (§7) — hidden for a director, employee, vendor or
                    bank account, where a trade discount has no meaning. */}
                {selectedCustomer && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Commission (PKR) <span className="text-slate-400 font-normal normal-case">— optional, reduces payable only</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={commission || ''}
                      disabled={isViewMode}
                      onChange={e => setCommission(Math.max(0, parseInt(e.target.value) || 0))}
                      placeholder="Enter commission given, if any..."
                      className="soleria-input font-semibold font-mono"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Payment Mode</label>
                  <div className="grid grid-cols-3 gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                    <button
                      type="button"
                      disabled={isViewMode}
                      onClick={() => { setPaymentMode('CASH'); setDetails(''); }}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'CASH' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Cash
                    </button>
                    <button
                      type="button"
                      disabled={isViewMode}
                      onClick={() => setPaymentMode('CHEQUE')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'CHEQUE' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Cheque
                    </button>
                    <button
                      type="button"
                      disabled={isViewMode}
                      onClick={() => setPaymentMode('ONLINE')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'ONLINE' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Online
                    </button>
                  </div>
                </div>

                {paymentMode === 'ONLINE' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Received Into <span className="text-red-500 font-bold">*</span>
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

                {paymentMode === 'CHEQUE' && (
                  <p className="text-[11px] text-slate-500 -mt-2">
                    A received cheque goes into <strong>Cheques in Hand</strong>, not a bank. You
                    choose the bank later, when it is deposited.
                  </p>
                )}

                {paymentMode !== 'CASH' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      {paymentMode === 'CHEQUE' ? 'Drawn On (customer\'s bank) / Details' : 'Online Reference Code / Details'}
                    </label>
                    <input
                      type="text"
                      value={details}
                      disabled={isViewMode}
                      onChange={e => setDetails(e.target.value)}
                      placeholder={paymentMode === 'CHEQUE' ? 'e.g. MCB Bank, Gulberg Branch' : 'e.g. Alfa ref 980124'}
                      className="soleria-input"
                    />
                  </div>
                )}

                {paymentMode === 'CHEQUE' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Cheque No. <span className="text-red-500 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        value={chequeNo}
                        disabled={isViewMode}
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
                        disabled={isViewMode}
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
                        disabled={isViewMode}
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
                    disabled={isViewMode}
                    onChange={e => setRemarks(e.target.value)}
                    placeholder="Enter remarks..."
                    className="soleria-input"
                    rows={2}
                    style={{ resize: 'none' }}
                  />
                </div>

                {!isViewMode && (
                  <div className="flex gap-3 mt-2">
                    <button
                      type="submit"
                      className="btn-gold w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold"
                    >
                      <Save size={16} /> {mode === 'edit' ? 'Update Receipt' : 'Save Receipt'}
                    </button>
                  </div>
                )}
              </form>
            </div>

            {/* Recorded Receipts */}
            <div className="card-white p-6 mt-8 bg-white border border-slate-200 rounded-xl shadow-sm">
              <h3 className="font-lora font-semibold text-lg text-slate-800 mb-4">Recorded Receipts</h3>
              {sortedReceipts.length === 0 ? (
                <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
                  No receipts recorded yet.
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
                      </tr>
                    </thead>
                    <tbody>
                      {sortedReceipts.map(r => (
                        <tr
                          key={r.receipt_id}
                          onClick={() => loadReceiptRow(r)}
                          className="border-b hover:bg-slate-50/50 cursor-pointer"
                          style={{ borderColor: 'var(--border-table)' }}
                        >
                          <td className="p-3 pl-4 font-mono text-slate-600">{formatDate(r.receipt_date)}</td>
                          <td className="p-3 font-semibold text-slate-900">{r.account_name || accountName(r.ba_id)}</td>
                          <td className="p-3 text-center text-xs text-slate-500">{r.payment_mode}</td>
                          <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(r.amount)}</td>
                          <td className="p-3 text-center">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                              r.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {r.status}
                            </span>
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
    </AppLayout>
  );
}
