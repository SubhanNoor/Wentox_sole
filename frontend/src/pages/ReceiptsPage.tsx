import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { CustomerRow, BusinessAccountRow, RegionRow, CityRow, BankAccountRow, ReceiptRow, ReceiptCreateInput, DraftReceiptRow, SettlementRow, SettlementCreateInput, ReceiptVoucherRow, VoucherActionResult } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Save, Edit, Trash2 } from 'lucide-react';
import WeeklyReceiptsTab from '@/components/WeeklyReceiptsTab';
import MonthlyReceiptsTab from '@/components/MonthlyReceiptsTab';
import OverallReceiptsTab from '@/components/OverallReceiptsTab';
import AccountBalanceTooltip from '@/components/AccountBalanceTooltip';
import PasswordPromptModal from '@/components/PasswordPromptModal';

// Cheque disposal (deposit/endorse/bounce/return) moved to the consolidated Cheque page's
// Disposal tab — see ChequePage.tsx. This page keeps only receipt entry/records.
type ReceiptTab = 'entry' | 'weekly' | 'monthly' | 'overall';

const RECEIPT_TAB_LABELS: Record<ReceiptTab, string> = {
  entry: 'Receipt Entry',
  weekly: 'Weekly Records',
  monthly: 'Monthly Records',
  overall: 'Overall Records',
};

const today = () => new Date().toISOString().split('T')[0];

export default function ReceiptsPage() {
  const { state } = useApp();

  // Navigation / Tabs State — sync with state.currentTab
  const [activeTab, setActiveTab] = useState<ReceiptTab>(() => {
    if (state.currentTab && ['entry', 'weekly', 'monthly', 'overall'].includes(state.currentTab)) {
      return state.currentTab as ReceiptTab;
    }
    return 'entry';
  });

  useEffect(() => {
    if (state.currentTab && ['entry', 'weekly', 'monthly', 'overall'].includes(state.currentTab)) {
      setActiveTab(state.currentTab as ReceiptTab);
    }
  }, [state.currentTab]);

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

  const refreshSettlements = useCallback(async () => {
    const res = await api.settlements.list({});
    if (res.ok) setSettlements(res.data);
    else setLookupError('Failed to load endorsed settlements: ' + res.error.message);
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
    refreshSettlements();
  }, [refreshReceipts, refreshDrafts, refreshSettlements]);

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

  // Endorse: the payer settles their debt by paying one of OUR creditors directly instead of paying
  // us. The money never reaches our cash, bank or cheque drawer, so this is NOT a receipt at all —
  // saving writes a `settlements` row (Dr the endorsed account / Cr the payer, both ba_id) instead.
  // docKind tracks which document the form is currently holding, because Post/Unpost/Edit have to
  // dispatch to the right service.
  const [isEndorsed, setIsEndorsed] = useState(false);
  const [endorseToBaId, setEndorseToBaId] = useState('');
  const [docKind, setDocKind] = useState<'RECEIPT' | 'SETTLEMENT'>('RECEIPT');
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);

  // RJ-02: previewed account while arrow-keying through the dropdown, for the live balance tooltip.
  const [previewBaId, setPreviewBaId] = useState<number | null>(null);
  const [previewEndorseBaId, setPreviewEndorseBaId] = useState<number | null>(null);

  // RJ-06: delete a receipt entry, password-gated.
  const [deleteTarget, setDeleteTarget] = useState<ReceiptRow | null>(null);
  const handleDeleteConfirmed = async (password: string) => {
    if (!deleteTarget) return;
    const res = await api.receipts.remove(deleteTarget.receipt_id, password);
    setDeleteTarget(null);
    if (!res.ok) return fail('Failed to delete: ' + res.error.message);
    flash('Receipt deleted.');
    refreshReceipts();
    // RJ-03: the deleted row may have been a line of the voucher on screen — re-read it so the grid
    // and the per-mode totals lose it too, instead of showing an entry that no longer exists.
    if (voucher && deleteTarget.voucher_id === voucher.voucher_id) await refreshVoucher(voucher.voucher_id);
    setBalanceRefreshKey(k => k + 1);
  };

  // ── RJ-03: the open voucher ──────────────────────────────────────────────────────────────────
  // A day's takings are entered as ONE voucher with many entry lines, each line free to name its
  // own account, posted in a single action at the end.
  //
  // The voucher is created LAZILY, on the first Done — not when the page opens. voucher_no is the
  // client's "C.Book No" and is allocated MAX+1, so creating one eagerly would burn a number every
  // time somebody merely visited the screen and walked away.
  const [voucher, setVoucher] = useState<ReceiptVoucherRow | null>(null);
  const [voucherRemarks, setVoucherRemarks] = useState('');
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherResult, setVoucherResult] = useState<VoucherActionResult<'receipt_id', ReceiptVoucherRow> | null>(null);

  // Alerts
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');


  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const voucherLines = voucher?.lines ?? [];

  // RJ-03: wraps the first entry field (the account picker) so Done can put the cursor back on it.
  // The form does not unmount between lines, so the app-wide G-01 auto-focus never re-fires and the
  // focus has to be asked for. SearchableSelect renders its trigger as button[data-field-nav] — the
  // same hook G-01's own field walker uses — so this finds it without SearchableSelect needing to
  // forward a ref.
  const firstEntryFieldWrapRef = useRef<HTMLDivElement>(null);
  const firstEntryFieldRef = {
    get current() {
      return firstEntryFieldWrapRef.current?.querySelector<HTMLElement>('button[data-field-nav]') ?? null;
    },
  };

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

  // Dropdown list — same Region-then-City ordering the customer picker used; business accounts
  // carry region_id/city_id of their own, so nothing is lost by widening the list. ac_name is
  // folded into the label so SearchableSelect's own built-in search still matches it.
  const accountOptions = useMemo(() => {
    const regionName = (id: number | null) => id == null ? '' : regions.find(r => r.region_id === id)?.name || '';
    const cityName = (id: number | null) => id == null ? '' : cities.find(ct => ct.city_id === id)?.name || '';
    return [...businessAccounts]
      .sort((a, b) => {
        const regionCmp = regionName(a.region_id).localeCompare(regionName(b.region_id));
        if (regionCmp !== 0) return regionCmp;
        const cityCmp = cityName(a.city_id).localeCompare(cityName(b.city_id));
        if (cityCmp !== 0) return cityCmp;
        return a.name.localeCompare(b.name);
      })
      .map(b => {
        const place = [regionName(b.region_id), cityName(b.city_id)].filter(Boolean).join(' — ');
        return {
          value: String(b.ba_id),
          label: `${b.name} (${b.code})${place ? ` — ${place}` : ''}${b.ac_name ? ` — ${b.ac_name}` : ''}`,
        };
      });
  }, [businessAccounts, regions, cities]);

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
    setPreviewBaId(null);
    setIsEndorsed(false);
    setEndorseToBaId('');
    setDocKind('RECEIPT');
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

  // Endorsed entries are settlements, not receipts — a different table, a different posting, and
  // deliberately no cash/bank/cheque leg. payment_mode and the cheque number ride along as
  // information about how the OTHER two parties transacted; they select nothing here.
  const buildSettlementPayload = (): SettlementCreateInput | null => {
    if (!date) { setErrorMsg('Please pick a date.'); return null; }
    if (!baId) { setErrorMsg('Please select an account.'); return null; }
    if (!endorseToBaId) { setErrorMsg('Select who the payment should go to.'); return null; }
    if (baId === endorseToBaId) { setErrorMsg('The two accounts must be different.'); return null; }
    if (amount <= 0) { setErrorMsg('Amount must be greater than 0.'); return null; }
    if (paymentMode === 'CHEQUE' && !chequeNo.trim()) { setErrorMsg('Cheque No. is required for cheque payments.'); return null; }

    return {
      settlement_date: date,
      from_ba_id: Number(baId),
      to_ba_id: Number(endorseToBaId),
      amount,
      payment_mode: paymentMode,
      cheque_no: paymentMode === 'CHEQUE' ? chequeNo.trim() : undefined,
      cheque_date: paymentMode === 'CHEQUE' ? (chequeDate || undefined) : undefined,
      remarks: remarks.trim() || undefined,
    };
  };

  const handleSaveSettlement = async () => {
    const payload = buildSettlementPayload();
    if (!payload) return;
    const result = mode === 'edit' && receiptId != null && docKind === 'SETTLEMENT'
      ? await api.settlements.update(receiptId, payload)
      : await api.settlements.create(payload);
    if (!result.ok) { fail('Failed to save endorsement: ' + result.error.message); return; }

    setDocKind('SETTLEMENT');
    setReceiptId(result.data.settlement_id);
    setReceiptStatus(result.data.status);
    setErrorMsg('');
    flash('Endorsement saved — Post it to update both ledgers.');
    setMode('view');
    refreshSettlements();
    setBalanceRefreshKey(k => k + 1);
  };

  // RJ-03: clears the entry row only — the voucher, its committed lines and the header date all
  // stay put, because the next thing the user types is the next line of the SAME voucher. This is
  // what "Done" leaves behind. Distinct from handleNew(), which abandons the whole voucher.
  const clearEntryRow = () => {
    setMode('new');
    setReceiptId(null);
    setReceiptStatus('DRAFT');
    setBaId('');
    setPreviewBaId(null);
    setIsEndorsed(false);
    setEndorseToBaId('');
    setDocKind('RECEIPT');
    setAmount(0);
    setCommission(0);
    setPaymentMode('CASH');
    setBankId('');
    setDetails('');
    setChequeNo('');
    setChequeDate('');
    setChequeReceivedDate('');
    setRemarks('');
    setErrorMsg('');
    // Cursor back to the first entry field, ready to type — the client's flow is Done → type →
    // Done → type, with no mouse. The app-wide G-01 rule focuses a form's first field on mount, but
    // this form never unmounts between lines, so the focus has to be asked for explicitly.
    requestAnimationFrame(() => firstEntryFieldRef.current?.focus());
  };

  // RJ-03: "Done" — commit the entry row as a line of the open voucher and re-arm the form.
  //
  // Creates the voucher on first use (see the `voucher` state note). An endorsement is NOT a
  // receipt — it lives in dbo.settlements, has no cash/bank leg and no voucher_id — so it still
  // saves through its own path and never joins the grid.
  const handleDone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEndorsed) { await handleSaveSettlement(); return; }
    const payload = buildPayload();
    if (!payload) return;

    let openVoucher = voucher;
    if (!openVoucher) {
      const created = await api.receiptVouchers.create({ voucher_date: date, remarks: voucherRemarks.trim() || undefined });
      if (!created.ok) { fail('Failed to open voucher: ' + created.error.message); return; }
      openVoucher = created.data;
    }

    // Every line carries the voucher's own date, not whatever the entry row happens to hold — the
    // header owns the date on this screen (there is one Date field, on the head).
    const linePayload = { ...payload, receipt_date: openVoucher.voucher_date, voucher_id: openVoucher.voucher_id };

    const result = mode === 'edit' && receiptId != null
      ? await api.receipts.update(receiptId, linePayload)
      : await api.receipts.create(linePayload);

    if (!result.ok) { fail('Failed to save entry: ' + result.error.message); return; }

    // A confirmed real receipt supersedes whatever draftReceipts entry it came from.
    if (loadedDraftId != null) {
      await api.draftReceipts.remove(loadedDraftId);
      refreshDrafts();
    }
    setLoadedDraftId(null);

    const wasEdit = mode === 'edit';
    await refreshVoucher(openVoucher.voucher_id);
    clearEntryRow();
    flash(wasEdit ? 'Entry updated.' : 'Entry added to the voucher.');
    refreshReceipts();
    setBalanceRefreshKey(k => k + 1);
  };

  // Re-reads the whole voucher rather than patching the line into local state: the header's derived
  // status and the per-mode totals are computed on the server from the lines, so a local edit would
  // have to duplicate that arithmetic and could disagree with it.
  const refreshVoucher = async (voucherId: number) => {
    const res = await api.receiptVouchers.get(voucherId);
    if (res.ok) setVoucher(res.data);
    else fail('Failed to reload voucher: ' + res.error.message);
  };

  // RJ-03: post every line of the voucher in one action.
  //
  // Each line posts in its own transaction on the backend, so this can come back partly done —
  // `failed` is read and shown per line rather than treating a resolved call as success. When
  // everything posts, the screen moves straight on to a fresh voucher, which is the client's flow.
  const handlePostVoucher = async () => {
    if (!voucher) return;
    setVoucherBusy(true);
    setVoucherResult(null);
    const res = await api.receiptVouchers.post(voucher.voucher_id);
    setVoucherBusy(false);

    if (!res.ok) { fail('Failed to post voucher: ' + res.error.message); return; }
    setVoucherResult(res.data);
    setVoucher(res.data.voucher);
    refreshReceipts();
    setBalanceRefreshKey(k => k + 1);

    if (res.data.failed.length === 0) {
      flash(`Voucher ${voucher.voucher_no} posted — ${res.data.posted?.length ?? 0} entr${(res.data.posted?.length ?? 0) === 1 ? 'y' : 'ies'}. Ready for the next voucher.`);
      startNewVoucher();
    }
  };

  const handleUnpostVoucher = async () => {
    if (!voucher) return;
    setVoucherBusy(true);
    setVoucherResult(null);
    const res = await api.receiptVouchers.unpost(voucher.voucher_id);
    setVoucherBusy(false);

    if (!res.ok) { fail('Failed to unpost voucher: ' + res.error.message); return; }
    setVoucherResult(res.data);
    setVoucher(res.data.voucher);
    refreshReceipts();
    setBalanceRefreshKey(k => k + 1);
    if (res.data.failed.length === 0) flash(`Voucher ${voucher.voucher_no} unposted.`);
  };

  // RJ-03: abandon the voucher on screen and start a blank one. Nothing is deleted — an unposted
  // voucher with lines still exists and is reachable from the records list; this just stops
  // pointing at it. The next Done allocates a new C.Book No.
  const startNewVoucher = () => {
    setVoucher(null);
    setVoucherRemarks('');
    setVoucherResult(null);
    handleNew(); // resets every entry field and the date — one definition of "a blank entry row"
    requestAnimationFrame(() => firstEntryFieldRef.current?.focus());
  };

  // RJ-03: pull a committed line back into the entry row to correct it. Only while the line itself
  // is unposted — a posted line has ledger entries, and receipts:update rejects it outright.
  const handleEditLine = (line: ReceiptRow) => {
    if (line.status === 'CONFIRMED') {
      fail('Unpost this voucher before editing that entry.');
      return;
    }
    setMode('edit');
    setDocKind('RECEIPT');
    setReceiptId(line.receipt_id);
    setReceiptStatus(line.status);
    setBaId(String(line.ba_id));
    setPreviewBaId(line.ba_id);
    setAmount(Number(line.amount));
    setCommission(Number(line.commission) || 0);
    setPaymentMode(line.payment_mode);
    setBankId(line.bank_id != null ? String(line.bank_id) : '');
    setDetails(line.details || '');
    setChequeNo(line.cheque_no || '');
    setChequeDate(line.cheque_date ? line.cheque_date.slice(0, 10) : '');
    setChequeReceivedDate(line.cheque_received_date ? line.cheque_received_date.slice(0, 10) : '');
    setRemarks(line.remarks || '');
    setIsEndorsed(false);
    setErrorMsg('');
    requestAnimationFrame(() => firstEntryFieldRef.current?.focus());
  };

  // Receipts are created DRAFT; only post() writes ledger_entries, so until this runs the receipt
  // has no effect on any balance or report. This page had no way to call it at all — receipts:post
  // and receipts:unpost existed on the backend and in lib/api.ts but nothing on screen invoked them,
  // so every receipt entered here stayed an invisible DRAFT forever (the seeded ones are CONFIRMED
  // only because dev-sample-data.js calls the service directly).
  const handlePost = async () => {
    if (receiptId == null) return;
    const res = docKind === 'SETTLEMENT'
      ? await api.settlements.post(receiptId)
      : await api.receipts.post(receiptId);
    if (!res.ok) { fail('Failed to post: ' + res.error.message); return; }
    setReceiptStatus(res.data.status);
    flash(docKind === 'SETTLEMENT' ? 'Endorsement posted — both ledgers updated.' : 'Receipt posted successfully.');
    if (docKind === 'SETTLEMENT') refreshSettlements(); else refreshReceipts();
    setBalanceRefreshKey(k => k + 1);
  };

  // unpost() can reject with CHEQUE_IN_USE when the receipt's cheque has already been endorsed or
  // deposited; that error surfaces as-is in the banner rather than hiding the button, same as the
  // equivalent on ExpensesPage.
  const handleUnpost = async () => {
    if (receiptId == null) return;
    const res = docKind === 'SETTLEMENT'
      ? await api.settlements.unpost(receiptId)
      : await api.receipts.unpost(receiptId);
    if (!res.ok) { fail('Failed to unpost: ' + res.error.message); return; }
    setReceiptStatus(res.data.status);
    flash(docKind === 'SETTLEMENT' ? 'Endorsement unposted.' : 'Receipt unposted successfully.');
    if (docKind === 'SETTLEMENT') refreshSettlements(); else refreshReceipts();
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

    setDocKind('RECEIPT');
    setIsEndorsed(false);
    setEndorseToBaId('');
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

    // RJ-03: opening a receipt from the records list also opens the voucher it belongs to, so its
    // sibling entries, the per-mode totals and the voucher's Post/Un Post are all on screen —
    // otherwise the user is looking at one line of a document with no way to reach the rest of it.
    // Every receipt has a voucher (migration 022 backfilled the old ones), but voucher_id is
    // nullable in the column, so this stays guarded rather than assuming.
    if (row.voucher_id != null) await refreshVoucher(row.voucher_id);
    else setVoucher(null);
    setVoucherResult(null);
  };





  const loadSettlementRow = (row: SettlementRow) => {
    setDocKind('SETTLEMENT');
    setIsEndorsed(true);
    setReceiptId(row.settlement_id);
    setReceiptStatus(row.status);
    setDate(row.settlement_date.slice(0, 10));
    setBaId(String(row.from_ba_id));
    setEndorseToBaId(String(row.to_ba_id));
    setAmount(row.amount);
    setCommission(0);
    setPaymentMode(row.payment_mode || 'CASH');
    setBankId('');
    setDetails('');
    setChequeNo(row.cheque_no || '');
    setChequeDate(row.cheque_date ? row.cheque_date.slice(0, 10) : '');
    setChequeReceivedDate('');
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
        </div>

        {/* Tab Content */}
        {activeTab === 'weekly' && <WeeklyReceiptsTab />}
        {activeTab === 'monthly' && <MonthlyReceiptsTab />}
        {activeTab === 'overall' && <OverallReceiptsTab />}

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

            {/* RJ-03: Entry Form Card — now the head of a VOUCHER, not a single receipt. Post and
                Unpost act on the whole voucher; the per-line status badge moved into the grid. */}
            <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm" data-no-print>
              <div className="flex items-center justify-between border-b pb-3 mb-5">
                <div className="flex items-center gap-2">
                  <span className="font-lora font-bold text-lg text-slate-900">
                    {voucher
                      ? `Receipt Voucher — C.Book No ${voucher.voucher_no}`
                      : 'New Receipt Voucher'}
                  </span>
                  {voucher && (
                    voucher.status === 'POSTED' ? (
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">
                        Posted
                      </span>
                    ) : voucher.status === 'PARTIAL' ? (
                      <span
                        className="px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-900"
                        title="Some entries on this voucher are in the ledger and some are not — post it again to finish, or unpost to back it all out."
                      >
                        Partly Posted
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
                  {mode === 'edit' && receiptId != null && docKind === 'RECEIPT' && (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-sky-100 text-sky-800">
                      Editing entry #{receiptId}
                    </span>
                  )}
                  {/* An endorsement is not a voucher line — it lives in dbo.settlements, has no
                      cash/bank leg and no voucher_id — so it keeps its own document-level badge and
                      its own Post/Unpost on the right. */}
                  {docKind === 'SETTLEMENT' && receiptId != null && (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-violet-100 text-violet-800">
                      Endorsement #{receiptId} · {isPosted ? 'Posted' : 'Not Posted'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Endorsements post on their own, not with a voucher. */}
                  {docKind === 'SETTLEMENT' && mode === 'view' && receiptId != null && (
                    isPosted ? (
                      <button
                        type="button"
                        onClick={handleUnpost}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-all"
                      >
                        Unpost Endorsement
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handlePost}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
                      >
                        Post Endorsement
                      </button>
                    )
                  )}
                  {/* Post/Unpost are voucher-level. Post needs at least one committed line; an empty
                      voucher has nothing to post (the backend rejects it with EMPTY_VOUCHER). */}
                  {voucher && voucherLines.length > 0 && voucher.status !== 'UNPOSTED' && (
                    <button
                      type="button"
                      onClick={handleUnpostVoucher}
                      disabled={voucherBusy}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white shadow-sm transition-all"
                    >
                      {voucherBusy ? 'Working…' : 'Un Post'}
                    </button>
                  )}
                  {voucher && voucherLines.length > 0 && voucher.status !== 'POSTED' && (
                    <button
                      type="button"
                      onClick={handlePostVoucher}
                      disabled={voucherBusy}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white shadow-sm transition-all"
                    >
                      {voucherBusy ? 'Posting…' : `Post Voucher (${voucherLines.length})`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={startNewVoucher}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all"
                  >
                    New Voucher
                  </button>
                </div>
              </div>

              {/* RJ-03: head-level Remarks, alongside the Date field below. Editable only while the
                  voucher is entirely unposted — once a line is in the ledger the header is locked
                  server-side (POSTED_LOCK), so offering the field would be a lie. */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-600 mb-1">Voucher Remarks</label>
                <input
                  type="text"
                  value={voucher ? (voucher.remarks ?? '') : voucherRemarks}
                  disabled={!!voucher && voucher.status !== 'UNPOSTED'}
                  onChange={e => {
                    if (!voucher) { setVoucherRemarks(e.target.value); return; }
                    setVoucher({ ...voucher, remarks: e.target.value });
                  }}
                  onBlur={async e => {
                    // Persisted on blur rather than per keystroke. Only meaningful once the voucher
                    // exists — before the first Done there is no row to write to, so the value is
                    // held locally and passed to create().
                    if (!voucher || voucher.status !== 'UNPOSTED') return;
                    const res = await api.receiptVouchers.update(voucher.voucher_id, {
                      voucher_date: voucher.voucher_date,
                      remarks: e.target.value.trim() || undefined,
                    });
                    if (res.ok) setVoucher(res.data);
                  }}
                  placeholder="Applies to the whole voucher (each entry has its own narration below)"
                  className="soleria-input"
                />
              </div>

              {/* RJ-03: submitting the form is "Done" — it commits the entry row as a line of the
                  voucher and re-arms for the next one. G-01's Enter-on-last-field rule fires the
                  form's submit button, so Enter through the row ends in Done with no mouse. */}
              <form onSubmit={handleDone} className="flex flex-col gap-4">
                {/* RJ-03: the Date is head-level — one date for the whole voucher, as on the
                    client's screen. Locked once the voucher has a line, because every line already
                    carries this date and moving it means moving them all (which the backend does,
                    but only while nothing is posted). Editing it goes through the header update so
                    the lines are carried with it. */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
                  <input
                    type="date"
                    value={voucher ? voucher.voucher_date : date}
                    disabled={!!voucher && voucher.status !== 'UNPOSTED'}
                    onChange={async e => {
                      const next = e.target.value;
                      setDate(next);
                      if (!voucher || voucher.status !== 'UNPOSTED') return;
                      const res = await api.receiptVouchers.update(voucher.voucher_id, {
                        voucher_date: next,
                        remarks: voucher.remarks ?? undefined,
                      });
                      if (res.ok) setVoucher(res.data);
                      else fail('Failed to change the voucher date: ' + res.error.message);
                    }}
                    className="soleria-input font-semibold"
                  />
                </div>

                {/* RJ-02: account picker + a small live balance tooltip next to it, updating as
                    the user arrow-keys/hovers through the dropdown (falls back to the committed
                    account once closed). Replaces the old below-the-field balance panel. */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Select Account <span className="text-red-500 font-bold">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {/* RJ-03: ref target for the post-Done cursor return — this is the first field
                        of the entry row. */}
                    <div className="flex-1 min-w-0" ref={firstEntryFieldWrapRef}>
                      <SearchableSelect
                        options={accountOptions}
                        value={baId}
                        onChange={setBaId}
                        onHighlightChange={val => setPreviewBaId(val ? Number(val) : null)}
                        placeholder="Search account..."
                        disabled={isViewMode}
                      />
                    </div>
                    <AccountBalanceTooltip baId={previewBaId ?? (baId ? Number(baId) : null)} refreshKey={balanceRefreshKey} />
                  </div>
                </div>

                {/* RJ-01: Remarks moved ahead of Amount so it's filled in first. */}
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
                {selectedCustomer && !isEndorsed && (
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

                {/* Endorse — the payer settles by paying one of OUR creditors instead of paying us.
                    Available on every payment mode; the mode itself becomes information about how
                    those two transacted, since none of it reaches our accounts. */}
                <div className="rounded-xl border p-3" style={{ borderColor: isEndorsed ? 'var(--brand-gold)' : 'var(--border-color)' }}>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEndorsed}
                      disabled={isViewMode || (mode === 'edit' && docKind === 'RECEIPT')}
                      onChange={e => { setIsEndorsed(e.target.checked); if (!e.target.checked) setEndorseToBaId(''); }}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-xs font-bold text-slate-800">
                        Endorse this payment to another account
                      </span>
                      <span className="block text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                        They pay someone you owe, instead of paying you. Both ledgers update and each
                        one says where the money went. <strong>Nothing enters your cash, bank or
                        cheque drawer</strong>, so this never reaches the Cash Book.
                      </span>
                    </span>
                  </label>

                  {isEndorsed && (
                    <div className="mt-3">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Pay To <span className="text-red-500 font-bold">*</span>
                        <span className="text-slate-400 font-normal normal-case ml-1">— whoever you owe</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <SearchableSelect
                            options={businessAccounts.filter(a => String(a.ba_id) !== baId)
                              .map(a => ({ value: String(a.ba_id), label: `${a.name} (${a.code})` }))}
                            value={endorseToBaId}
                            onChange={setEndorseToBaId}
                            onHighlightChange={val => setPreviewEndorseBaId(val ? Number(val) : null)}
                            placeholder="Search account to pay..."
                            disabled={isViewMode}
                          />
                        </div>
                        <AccountBalanceTooltip baId={previewEndorseBaId ?? (endorseToBaId ? Number(endorseToBaId) : null)} refreshKey={balanceRefreshKey} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Endorsed money never lands in one of our banks, so there is nothing to pick. */}
                {paymentMode === 'ONLINE' && !isEndorsed && (
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

                {/* RJ-04: sticky so the post/save action stays reachable without scrolling back
                    up or down a long form. */}
                {!isViewMode && (
                  <div className="sticky bottom-0 z-10 -mx-6 md:-mx-8 px-6 md:px-8 pt-3 pb-4 mt-2 bg-white border-t" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="flex gap-3">
                      {/* RJ-03: "Done" — the client's own word for it. Commits this entry to the
                          voucher and clears for the next; Post (in the header) is the separate,
                          later action that puts the whole voucher in the ledger. */}
                      <button
                        type="submit"
                        className="btn-gold w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold"
                      >
                        <Save size={16} /> {mode === 'edit' ? 'Update Entry' : 'Done — Add to Voucher'}
                      </button>
                    </div>
                  </div>
                )}
              </form>

              {/* ── RJ-03: the voucher's committed entry lines ──────────────────────────────────
                  Rows, not cards — the same grid the client's screen shows beneath the entry
                  fields, so a voucher can be read back at a glance before posting. */}
              {voucherLines.length > 0 && (
                <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-lora font-semibold text-slate-800">
                      Entries in this Voucher
                      <span className="ml-2 text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-mono font-bold">
                        {voucherLines.length}
                      </span>
                    </h4>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                          <th className="p-2.5 pl-3">A/C Code</th>
                          <th className="p-2.5">Account Description</th>
                          <th className="p-2.5">Narration</th>
                          <th className="p-2.5">Cheque No</th>
                          <th className="p-2.5 text-center">Type</th>
                          <th className="p-2.5 text-right">Rs. (Jamma)</th>
                          <th className="p-2.5 text-center">Status</th>
                          <th className="p-2.5 text-center" data-no-print>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {voucherLines.map(line => (
                          <tr key={line.receipt_id} className="border-b hover:bg-slate-50/60 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                            <td className="p-2.5 pl-3 font-mono text-xs text-slate-600">{line.account_code || '—'}</td>
                            <td className="p-2.5 font-semibold text-slate-800">{line.account_name}</td>
                            <td className="p-2.5 text-slate-600 text-xs">{line.remarks || '—'}</td>
                            <td className="p-2.5 font-mono text-xs text-slate-600">{line.cheque_no || '—'}</td>
                            <td className="p-2.5 text-center text-xs font-semibold text-slate-700">{line.payment_mode}</td>
                            <td className="p-2.5 text-right font-mono font-semibold text-slate-900">
                              {formatCurrency(Number(line.amount))}
                            </td>
                            <td className="p-2.5 text-center">
                              {line.status === 'CONFIRMED' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800">Posted</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-900">Pending</span>
                              )}
                            </td>
                            <td className="p-2.5 text-center" data-no-print>
                              <div className="flex items-center justify-center gap-1.5">
                                {/* Both actions are unposted-only. A posted line has ledger entries;
                                    the backend rejects editing or deleting it, so showing the
                                    buttons would only produce an error. */}
                                {line.status === 'DRAFT' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleEditLine(line)}
                                      title="Pull this entry back into the form to correct it"
                                      className="text-slate-500 hover:text-slate-800 transition-colors"
                                    >
                                      <Edit size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeleteTarget(line)}
                                      title="Delete this entry (asks for your password)"
                                      className="text-rose-500 hover:text-rose-700 transition-colors"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {/* RJ-03: the client's own footer — totals split by how the money arrived. */}
                      <tfoot>
                        <tr className="border-t-2 bg-slate-50/70 font-semibold" style={{ borderColor: 'var(--border-color)' }}>
                          <td className="p-2.5 pl-3 text-xs uppercase tracking-wider text-slate-500" colSpan={4}>
                            Total Cheque {formatCurrency(Number(voucher?.total_cheque ?? 0))}
                            {'  ·  '}Total Online {formatCurrency(Number(voucher?.total_online ?? 0))}
                            {'  ·  '}Total Cash {formatCurrency(Number(voucher?.total_cash ?? 0))}
                          </td>
                          <td className="p-2.5 text-right text-xs uppercase tracking-wider text-slate-500">Voucher Total</td>
                          <td className="p-2.5 text-right font-mono text-slate-900">
                            {formatCurrency(Number(voucher?.total_amount ?? 0))}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Per-line outcome of the last Post/Un Post. Deliberately NOT auto-hidden on a
                      timer like the ordinary banner: a voucher can post 8 of 10 lines, and the two
                      that failed are the entire point of the message. */}
                  {voucherResult && voucherResult.failed.length > 0 && (
                    <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200">
                      <p className="text-xs font-bold text-rose-900">
                        {voucherResult.failed.length} entr{voucherResult.failed.length === 1 ? 'y' : 'ies'} could not be posted — the rest went through.
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {voucherResult.failed.map(f => (
                          <li key={f.receipt_id} className="text-xs text-rose-800">
                            <span className="font-semibold">{f.account_name || `#${f.receipt_id}`}</span>
                            {' '}({formatCurrency(Number(f.amount))}){' — '}{f.message}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => setVoucherResult(null)}
                        className="mt-2 text-xs text-slate-500 hover:text-slate-700 font-semibold"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              )}
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
                        <th className="p-3 text-center">Type</th>
                        <th className="p-3 text-center">Status</th>
                        <th className="p-3 text-center" style={{ width: 50 }} />
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
                          <td className="p-3 text-center text-[10px] font-bold uppercase text-slate-500">Receipt</td>
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
                      {/* Endorsed entries live in `settlements`, not `receipts`, but they were
                          entered here so they belong in the same list — the Type column is what
                          tells them apart. */}
                      {settlements.map(st => (
                        <tr
                          key={`st-${st.settlement_id}`}
                          onClick={() => loadSettlementRow(st)}
                          className="border-b hover:bg-slate-50/50 cursor-pointer"
                          style={{ borderColor: 'var(--border-table)' }}
                        >
                          <td className="p-3 pl-4 font-mono text-slate-600">{formatDate(st.settlement_date)}</td>
                          <td className="p-3 font-semibold text-slate-900">
                            {st.from_name || accountName(st.from_ba_id)}
                            <span className="text-slate-400 font-normal"> → {st.to_name || accountName(st.to_ba_id)}</span>
                          </td>
                          <td className="p-3 text-center text-xs text-slate-500">{st.payment_mode || '-'}</td>
                          <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(st.amount)}</td>
                          <td className="p-3 text-center text-[10px] font-bold uppercase text-amber-700">Endorsed</td>
                          <td className="p-3 text-center">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                              st.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {st.status}
                            </span>
                          </td>
                          <td className="p-3" />
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
        title="Delete Receipt"
        subtitle={deleteTarget ? `Confirm your password to permanently delete this ${formatCurrency(deleteTarget.amount)} receipt. This cannot be undone.` : undefined}
      />
    </AppLayout>
  );
}
