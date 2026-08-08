import { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { CustomerRow, RegionRow, CityRow, BankAccountRow, ReceiptRow, ReceiptCreateInput, DraftReceiptRow } from '@/lib/api';
import { Save, DollarSign, Search, Edit, Trash2, AlertTriangle } from 'lucide-react';
import WeeklyReceiptsTab from '@/components/WeeklyReceiptsTab';
import MonthlyReceiptsTab from '@/components/MonthlyReceiptsTab';
import OverallReceiptsTab from '@/components/OverallReceiptsTab';
import ChequesTab from '@/components/ChequesTab';

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
      const [c, rg, ct, bk] = await Promise.all([
        api.listCustomers(), api.listRegions(), api.listCities(), api.bankAccounts.list()
      ]);
      const failures: string[] = [];
      if (c.ok) setCustomers(c.data); else failures.push(c.error.message);
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
  const [customerId, setCustomerId] = useState('');
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

  // Dropdown search state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');

  // Alerts
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ReceiptRow | null>(null);

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const isViewMode = mode === 'view';
  const isPosted = receiptStatus === 'CONFIRMED';

  // Customer account group helpers
  const selectedCustomer = useMemo(() => {
    return customers.find(c => c.customer_id === Number(customerId));
  }, [customerId, customers]);

  // Dropdown list filter — Customer search: Primary = Region, Secondary = City
  const filteredDropdownCustomers = useMemo(() => {
    const regionName = (id: number) => regions.find(r => r.region_id === id)?.name || '';
    const cityName = (id: number | null) => id == null ? '' : cities.find(ct => ct.city_id === id)?.name || '';
    const query = customerSearchQuery.trim().toLowerCase();
    const list = query
      ? customers.filter(c =>
          c.name.toLowerCase().includes(query) ||
          String(c.customer_id).includes(query)
        )
      : customers;
    return [...list].sort((a, b) => {
      const regionCmp = regionName(a.region_id).localeCompare(regionName(b.region_id));
      if (regionCmp !== 0) return regionCmp;
      return cityName(a.city_id).localeCompare(cityName(b.city_id));
    });
  }, [customerSearchQuery, customers, regions, cities]);

  const bankOptions = useMemo(
    () => banks.filter(b => b.is_active).map(b => ({ value: String(b.bank_id), label: b.name })),
    [banks]
  );

  const handleNew = () => {
    setMode('new');
    setReceiptId(null);
    setReceiptStatus('DRAFT');
    setDate(today());
    setCustomerId('');
    setCustomerSearchQuery('');
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
    if (!customerId) { setErrorMsg('Please select a customer.'); return null; }
    if (amount <= 0) { setErrorMsg('Amount must be greater than 0.'); return null; }
    if (paymentMode === 'ONLINE' && !bankId) { setErrorMsg('Select which bank account received this money.'); return null; }
    if (paymentMode === 'CHEQUE' && !chequeNo.trim()) { setErrorMsg('Cheque No. is required for cheque payments.'); return null; }
    if (paymentMode === 'CHEQUE' && !chequeDate) { setErrorMsg('Date on Cheque is required for cheque payments.'); return null; }

    return {
      customer_id: Number(customerId),
      receipt_date: date,
      amount,
      commission: commission || undefined,
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
    setCustomerId(String(row.customer_id));
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

  const handlePost = async () => {
    if (receiptId == null) return;
    const res = await api.receipts.post(receiptId);
    if (!res.ok) { fail('Failed to post receipt: ' + res.error.message); return; }
    setReceiptStatus(res.data.status);
    flash('Receipt posted successfully.');
    refreshReceipts();
  };

  const handleUnpost = async () => {
    if (receiptId == null) return;
    const res = await api.receipts.unpost(receiptId);
    if (!res.ok) { fail('Failed to unpost receipt: ' + res.error.message); return; }
    setReceiptStatus(res.data.status);
    flash('Receipt unposted successfully.');
    refreshReceipts();
  };

  const confirmDeleteReceipt = async () => {
    if (!deleteTarget) return;
    const res = await api.receipts.remove(deleteTarget.receipt_id);
    setDeleteTarget(null);
    if (!res.ok) { fail('Failed to delete receipt: ' + res.error.message); return; }
    flash('Receipt deleted.');
    if (receiptId === deleteTarget.receipt_id) handleNew();
    refreshReceipts();
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
    setCustomerId(String(row.customer_id));
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

  const handleDeleteDraft = async () => {
    if (!selectedDraftPick) { fail('Please select a draft first.'); return; }
    const id = Number(selectedDraftPick);
    const res = await api.draftReceipts.remove(id);
    if (!res.ok) { fail('Failed to delete draft: ' + res.error.message); return; }
    if (loadedDraftId === id) handleNew();
    setSelectedDraftPick('');
    flash('Draft deleted successfully.');
    refreshDrafts();
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
  };

  const sortedReceipts = useMemo(
    () => [...receipts].sort((a, b) => b.receipt_date.localeCompare(a.receipt_date)),
    [receipts]
  );

  const customerName = useCallback(
    (id: number) => customers.find(c => c.customer_id === id)?.name || 'Unknown Customer',
    [customers]
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
                        {customerName(d.customer_id)} - {formatCurrency(d.amount)} ({d.receipt_date.slice(0, 10)})
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
                    onClick={handleDeleteDraft}
                    className="text-xs text-rose-600 hover:text-rose-800 font-semibold transition-colors"
                  >
                    Delete Selected Draft
                  </button>
                </div>
              </div>
            )}

            {/* Entry Form Card */}
            <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm" data-no-print>
              <div className="flex items-center justify-between border-b pb-3 mb-5">
                <h3 className="font-lora font-semibold text-xl text-slate-800 flex items-center gap-2">
                  <DollarSign size={20} className="text-[#B08D57]" /> Customer Payment Receipt (Jamma)
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
                    {!isPosted && receiptId != null && (
                      <button
                        type="button"
                        onClick={() => {
                          const row = receipts.find(r => r.receipt_id === receiptId);
                          if (row) setDeleteTarget(row);
                        }}
                        className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleNew}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all"
                    >
                      New Receipt
                    </button>
                  </div>
                )}
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

                {/* Customer Dropdown */}
                <div className="relative">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Select Customer Account <span className="text-red-500 font-bold">*</span>
                  </label>
                  <div
                    onClick={() => !isViewMode && setIsDropdownOpen(!isDropdownOpen)}
                    className={`soleria-input flex justify-between items-center font-semibold bg-white ${isViewMode ? '' : 'cursor-pointer'}`}
                  >
                    <span className={selectedCustomer ? 'text-slate-800 font-semibold' : 'text-slate-400'}>
                      {selectedCustomer ? `${selectedCustomer.name} (${selectedCustomer.customer_id})` : 'Search customer...'}
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
                            value={customerSearchQuery}
                            onChange={e => setCustomerSearchQuery(e.target.value)}
                            className="w-full py-1.5 pl-8 pr-3 text-xs border rounded-md font-semibold"
                            autoFocus
                          />
                          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                        </div>
                      </div>
                      <div className="py-1">
                        {filteredDropdownCustomers.length === 0 ? (
                          <div className="p-3 text-xs text-slate-400 text-center font-medium">No matching customers</div>
                        ) : (
                          filteredDropdownCustomers.map(c => {
                            const regName = regions.find(r => r.region_id === c.region_id)?.name || '';
                            const ctName = c.city_id != null ? cities.find(ct => ct.city_id === c.city_id)?.name || '' : '';
                            return (
                              <div
                                key={c.customer_id}
                                onClick={() => {
                                  setCustomerId(String(c.customer_id));
                                  setIsDropdownOpen(false);
                                  setCustomerSearchQuery('');
                                }}
                                className="px-3 py-2 hover:bg-slate-50 cursor-pointer flex items-center justify-between text-xs"
                              >
                                <div>
                                  <span className="font-semibold text-slate-800">{c.name}</span>
                                  <span className="text-slate-400 text-[10px] ml-2">({c.customer_id})</span>
                                </div>
                                <div className="text-[10px] text-slate-500 font-medium">
                                  {regName} {ctName ? `— ${ctName}` : ''}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>

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
                        <th className="p-3">Customer</th>
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
                          <td className="p-3 pl-4 font-mono text-slate-600">{r.receipt_date.slice(0, 10)}</td>
                          <td className="p-3 font-semibold text-slate-900">{r.customer_name || customerName(r.customer_id)}</td>
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

        {/* ── Delete confirmation ── */}
        {deleteTarget && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
            <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
              <h3 className="font-lora font-bold text-lg text-slate-800 mb-2 flex items-center gap-2">
                <AlertTriangle size={18} className="text-rose-600" /> Delete Receipt
              </h3>
              <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                This receipt of <strong>{formatCurrency(deleteTarget.amount)}</strong> will be permanently removed. This cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteReceipt}
                  className="px-4 py-2 text-sm rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
