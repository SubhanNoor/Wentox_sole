import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import SearchModal from '@/components/SearchModal';
import * as api from '@/lib/api';
import type { CustomerRow, BusinessAccountRow, RegionRow, CityRow, BankAccountRow, ReceiptCreateInput, SettlementCreateInput, ReceiptVoucherRow, VoucherActionResult } from '@/lib/api';
import { focusFirstField, focusNextField } from '@/lib/fieldNav';
import { useHeldKey } from '@/hooks/useHeldKey';
import { usePersistentField, useClearPageDraft } from '@/hooks/usePersistentField';
import {
  Save, Edit, Trash2, Plus, CheckCircle2, Undo2, ChevronDown,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, PackageCheck, Search
} from 'lucide-react';
import WeeklyReceiptsTab from '@/components/WeeklyReceiptsTab';
import MonthlyReceiptsTab from '@/components/MonthlyReceiptsTab';
import OverallReceiptsTab from '@/components/OverallReceiptsTab';
import AccountBalanceTooltip from '@/components/AccountBalanceTooltip';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import { toDateInputValue } from '@/lib/utils';

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
  const [lookupError, setLookupError] = useState('');

  // Every voucher ever created (list() rows — no `lines`), for First/Previous/Next/Last record
  // navigation (frontend/pages_design.md §3), the System Voucher No. "next" preview, and the
  // Pending Posting panel below (which lists VOUCHERS, not individual draft receipts — posting
  // status belongs to the whole voucher, corrected per the user 2026-08-26; there is no longer a
  // separate fetch of individual draftReceipts rows on this page for that reason).
  const [allVouchers, setAllVouchers] = useState<ReceiptVoucherRow[]>([]);
  const refreshAllVouchers = useCallback(async () => {
    const res = await api.receiptVouchers.list({});
    if (res.ok) setAllVouchers(res.data);
    return res.ok ? res.data : null;
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
    refreshAllVouchers();
  }, [refreshAllVouchers]);

  // ── Real-receipt form (mirrors PurchasePage.tsx's mode structure) ──
  const [mode, setMode] = useState<'new' | 'edit' | 'view'>('new');
  // First/Previous/Next/Last + Posted/Unposted dropdown. `navFilter` is a REAL data filter and the
  // buttons page through whole VOUCHERS: 'posted' walks fully-posted ones, 'unposted' walks those
  // still awaiting posting (UNPOSTED or PARTIAL).
  //
  // Superseded twice, both on the user's explicit instruction — worth stating so neither gets
  // "restored": (1) 2026-08-26, these paged through the LINES inside the open voucher; (2) before
  // that, navFilter merely armed the Unpost button while both values browsed the posted list.
  // Changed 2026-08-27 to match Sale Bill, alongside removing the left-hand Pending Posting panel
  // (whose job — reaching another pending voucher — these buttons now do).
  //
  // Unposted is the default (per the user, 2026-08-30): that's the working mode you add and post
  // new vouchers from. Posted is purely a browse mode over already-posted vouchers (First/Prev./
  // Next/Last + Unpost).
  const [navFilter, setNavFilter] = useState<'posted' | 'unposted'>('unposted');
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [receiptStatus, setReceiptStatus] = useState<'CONFIRMED' | 'DRAFT'>('DRAFT');
  // In-progress entry-row fields persist across switching pages AND an app restart
  // (usePersistentField — see src/hooks/usePersistentField.ts). Deliberately NOT applied to
  // mode/receiptId/receiptStatus/entryIsDraft/docKind/voucher — an already-saved receipt or
  // voucher loaded for view/edit is safely re-openable by id at any time, so caching it risks
  // showing a stale copy; only unsaved "new" work is ever at risk of being lost.
  const clearReceiptsDraft = useClearPageDraft('receipts');
  const [date, setDate] = usePersistentField('receipts', 'date', today());
  const [baId, setBaId] = usePersistentField('receipts', 'baId', '');
  const [amount, setAmount] = usePersistentField('receipts', 'amount', 0);
  const [commission, setCommission] = usePersistentField('receipts', 'commission', 0);
  const [paymentMode, setPaymentMode] = usePersistentField<'CASH' | 'ONLINE' | 'CHEQUE'>('receipts', 'paymentMode', 'CASH');
  const [bankId, setBankId] = usePersistentField('receipts', 'bankId', '');
  const [details, setDetails] = usePersistentField('receipts', 'details', '');
  const [chequeNo, setChequeNo] = usePersistentField('receipts', 'chequeNo', '');
  const [chequeDate, setChequeDate] = usePersistentField('receipts', 'chequeDate', '');
  const [chequeReceivedDate, setChequeReceivedDate] = usePersistentField('receipts', 'chequeReceivedDate', '');
  const [remarks, setRemarks] = usePersistentField('receipts', 'remarks', '');

  // draftReceipts is a separate server-side feature (genuinely incomplete entries) —
  // distinct from a receipt's own DRAFT/CONFIRMED status above. Loading one just
  // fills the form; since draftReceipts has no update(), re-saving replaces it.
  // Bumped after anything that posts, so the balance panel re-reads instead of showing a stale figure.
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);

  // Endorse: the payer settles their debt by paying one of OUR creditors directly instead of paying
  // us. The money never reaches our cash, bank or cheque drawer, so this is NOT a receipt at all —
  // saving writes a `settlements` row (Dr the endorsed account / Cr the payer, both ba_id) instead.
  // docKind tracks which document the form is currently holding, because Post/Unpost/Edit have to
  // dispatch to the right service.
  const [isEndorsed, setIsEndorsed] = usePersistentField('receipts', 'isEndorsed', false);
  const [endorseToBaId, setEndorseToBaId] = usePersistentField('receipts', 'endorseToBaId', '');
  const [docKind, setDocKind] = useState<'RECEIPT' | 'SETTLEMENT'>('RECEIPT');
  // Which table `receiptId` points into. An unposted receipt now lives in dbo.draft_receipts and a
  // posted one in dbo.receipts, so the id alone is ambiguous — this says which id space it is in.
  const [entryIsDraft, setEntryIsDraft] = useState(false);

  // RJ-02: previewed account while arrow-keying through the dropdown, for the live balance tooltip.
  const [previewBaId, setPreviewBaId] = useState<number | null>(null);
  const [previewEndorseBaId, setPreviewEndorseBaId] = useState<number | null>(null);

  // RJ-06: delete a receipt entry, password-gated. An unposted receipt lives in dbo.draft_receipts
  // and a posted one in dbo.receipts, so the target carries which table it is in — the id alone is
  // ambiguous now. In practice only unposted rows are ever deletable (every delete button is gated
  // on that), so `kind` is 'draft' for everything the UI offers; the 'receipt' branch is kept for
  // any row predating the draft/real split.
  // 'voucher' deletes the WHOLE voucher (and every line with it) — the Pending Posting panel
  // (below) offers this, not per-receipt delete: posting status belongs to the voucher, not to
  // individual receipts (corrected per the user, 2026-08-26). Only reachable while the whole
  // voucher is UNPOSTED (receiptVouchers.remove() rejects a PARTIAL one — some of its lines already
  // have ledger entries).
  type PendingDelete = { kind: 'draft' | 'receipt' | 'voucher'; id: number; amount: number };
  const [deleteTarget, setDeleteTarget] = useState<PendingDelete | null>(null);
  const handleDeleteConfirmed = async (password: string) => {
    if (!deleteTarget) return;
    const res = deleteTarget.kind === 'draft'
      ? await api.draftReceipts.remove(deleteTarget.id, password)
      : deleteTarget.kind === 'voucher'
      ? await api.receiptVouchers.remove(deleteTarget.id, password)
      : await api.receipts.remove(deleteTarget.id, password);
    setDeleteTarget(null);
    if (!res.ok) return fail('Failed to delete: ' + res.error.message);
    flash(deleteTarget.kind === 'voucher' ? 'Voucher deleted.' : 'Receipt deleted.');
    refreshAllVouchers();
    setBalanceRefreshKey(k => k + 1);
    // The deleted voucher may be the one open on screen — reset rather than leave the form
    // pointed at a voucher that no longer exists. Any other delete just re-reads it.
    if (deleteTarget.kind === 'voucher' && voucher?.voucher_id === deleteTarget.id) startNewVoucher();
    else if (voucher) await refreshVoucher(voucher.voucher_id);
  };

  // ── RJ-03: the open voucher ──────────────────────────────────────────────────────────────────
  // A day's takings are entered as ONE voucher with many entry lines, each line free to name its
  // own account, posted in a single action at the end.
  //
  // The voucher is created LAZILY, on the first Done — not when the page opens. voucher_no is the
  // client's "C.Book No" and is allocated MAX+1, so creating one eagerly would burn a number every
  // time somebody merely visited the screen and walked away.
  const [voucher, setVoucher] = useState<ReceiptVoucherRow | null>(null);
  const [voucherRemarks, setVoucherRemarks] = usePersistentField('receipts', 'voucherRemarks', '');
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherResult, setVoucherResult] = useState<VoucherActionResult<'receipt_id', ReceiptVoucherRow> | null>(null);

  // Alerts
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');


  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const voucherLines = voucher?.lines ?? [];

  // RJ-03: wraps the first entry field (the account picker) so Done/New can put the cursor back on
  // it. The form does not unmount between lines, so the app-wide G-01 auto-focus never re-fires and
  // the focus has to be asked for.
  //
  // The selector is `[data-field-nav]`, NOT `button[data-field-nav]`: the account field used to be
  // a SearchableSelect (whose trigger IS a button), but it's a typable <input> + SearchModal now.
  // The old button-only selector therefore matched nothing and silently focused nothing at all —
  // reported directly by the user as "clicking New loses autofocus" here, and as focus landing on
  // Amount instead of the account on Payments. Any element carrying the G-01 hook counts.
  const firstEntryFieldWrapRef = useRef<HTMLDivElement>(null);
  const firstEntryFieldRef = {
    get current() {
      return firstEntryFieldWrapRef.current?.querySelector<HTMLElement>('[data-field-nav]') ?? null;
    },
  };

  // Payment Mode is a native <select> (rebuilt to the ref pic, 2026-08-31 — it was a 3-way button
  // toggle before). G-01's Enter-walk recognizes select on its own, so unlike the old buttons it
  // needs no data-field-nav marker and no roving-stop trick to be a stop in the walk.
  const PAYMENT_MODES = ['CASH', 'CHEQUE', 'ONLINE'] as const;
  const PAYMENT_MODE_LABELS: Record<typeof PAYMENT_MODES[number], string> = { CASH: 'Cash', CHEQUE: 'Cheque', ONLINE: 'Online' };

  // Commits a mode. CASH clears `details` because that field is the cheque/online reference and
  // has no meaning on cash — leaving a stale value there would ride along onto the saved row.
  function selectPaymentMode(next: typeof PAYMENT_MODES[number]) {
    setPaymentMode(next);
    if (next === 'CASH') setDetails('');
  }

  // Letter shortcuts on the mode <select>, per the user (2026-08-31): C moves Cash→Cheque and back,
  // O jumps straight to Online. Handled here rather than left to the browser's own type-ahead
  // because BOTH Cash and Cheque start with C — a plain "first letter wins" rule could never reach
  // Cheque. preventDefault stops the native type-ahead from then fighting this, and stopPropagation
  // keeps AppLayout's G-01 field-walk from also acting on the same keystroke.
  function handlePaymentModeKeyDown(e: React.KeyboardEvent<HTMLSelectElement>) {
    const key = e.key.toLowerCase();
    if (key === 'c') {
      e.preventDefault();
      e.stopPropagation();
      selectPaymentMode(paymentMode === 'CASH' ? 'CHEQUE' : 'CASH');
    } else if (key === 'o') {
      e.preventDefault();
      e.stopPropagation();
      selectPaymentMode('ONLINE');
    }
  }

  // Endorse checkbox: Shift+Enter/Ctrl+Enter/'.'+Enter is the same "do the explicit extra thing"
  // chord used elsewhere (SaleBillPage/SaleReturnPage/PurchasePage's "add a row") — here it checks
  // the box and reveals the Pay To field, focusing straight into it. Plain Enter is left alone so
  // G-01's own handler runs unmodified: walk to the next field, or submit (save the receipt
  // unposted) if the checkbox happens to be the last field currently on screen.
  const periodHeld = useHeldKey('.');
  const endorseToWrapRef = useRef<HTMLDivElement>(null);
  // Shown only while the checkbox itself has focus — a permanent caption under the checkbox was
  // easy to miss (reported directly by the user, 2026-08-26); tying it to focus makes it appear
  // exactly "when we are on the endorse checkbox".
  const [isEndorseFocused, setIsEndorseFocused] = useState(false);

  function handleEndorseCheckboxKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' || !(e.shiftKey || e.ctrlKey || periodHeld.current)) return;
    e.preventDefault();
    e.stopPropagation(); // don't also let AppLayout's own Enter handler walk/submit this keystroke
    const next = !isEndorsed;
    setIsEndorsed(next);
    if (!next) setEndorseToBaId('');
    if (next) requestAnimationFrame(() => focusFirstField(endorseToWrapRef.current));
  }

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

  // Account field opens a centered "find" modal (SearchModal) instead of SearchableSelect's small
  // anchored panel — see frontend/pages_design.md §5. It's a real, typable <input> (same pattern
  // as Purchase's Vendor field, 2026-08-27): type an account name/city and press Enter (or Arrow
  // Up/Down for the full list) to open the modal seeded with what's typed, and keep searching
  // inside it. The small chevron button alongside it still opens the full list blank, for a plain
  // click with nothing typed. RJ-02's live balance preview still works via SearchModal's own
  // onHighlightChange (added for this). Committing an account closes the modal, updates the
  // displayed text to the picked account's label (see the sync effect below), and advances focus
  // via the app's G-01 rule.
  const accountTriggerRef = useRef<HTMLInputElement>(null);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [accountSearchText, setAccountSearchText] = useState('');
  // Seeds the modal's search box when opened via Enter on the typed input (blank when opened via
  // the chevron button or Arrow Up/Down instead).
  const [accountModalSeed, setAccountModalSeed] = useState('');

  // Keeps the input's displayed text in sync with whatever baId actually is — covers every place
  // baId gets set (picking one, New clearing it, loading a posted/draft record) without
  // duplicating each of those call sites. Typing itself never touches baId, so this never fights
  // the user mid-type — it only ever runs when the SELECTION changes.
  useEffect(() => {
    const opt = accountOptions.find(o => o.value === baId);
    setAccountSearchText(opt?.label ?? '');
  }, [baId, accountOptions]);

  const openAccountModal = () => {
    if (isViewMode) return;
    setAccountModalSeed('');
    setIsAccountModalOpen(true);
  };

  function handleAccountTriggerKeyDown(e: React.KeyboardEvent) {
    // stopPropagation on every branch — otherwise this keydown keeps bubbling past the trigger up
    // to window-level listeners (AppLayout's own G-01 field-walk), acting on it at the same time
    // the modal opens. Same reasoning as SearchModal's own internal keydown handling.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openAccountModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      setAccountModalSeed(accountSearchText);
      setIsAccountModalOpen(true);
    }
  }

  function handleAccountSelect(newBaId: string) {
    setBaId(newBaId);
    setIsAccountModalOpen(false);
    setPreviewBaId(null);
    requestAnimationFrame(() => focusNextField(accountTriggerRef.current));
  }

  // "Received Into" uses the SAME centered-modal picker as the account field above (per the user,
  // 2026-08-31 — it was a SearchableSelect dropdown before). Now that ONLINE reaches every business
  // account rather than a short list of banks, the small anchored panel was the wrong control for
  // the size of the list. Identical interaction to the account trigger: type and press Enter to
  // open the modal seeded with what's typed, Arrow Up/Down to open it blank, or click the chevron.
  const bankTriggerRef = useRef<HTMLInputElement>(null);
  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [bankSearchText, setBankSearchText] = useState('');
  const [bankModalSeed, setBankModalSeed] = useState('');

  const openBankModal = () => {
    if (isViewMode) return;
    setBankModalSeed('');
    setIsBankModalOpen(true);
  };

  function handleBankTriggerKeyDown(e: React.KeyboardEvent) {
    // stopPropagation on every branch, for the same reason as handleAccountTriggerKeyDown: without
    // it the keystroke bubbles to AppLayout's window-level G-01 field-walk, which would move focus
    // at the same moment the modal opens.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openBankModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      setBankModalSeed(bankSearchText);
      setIsBankModalOpen(true);
    }
  }

  function handleBankSelect(newBankId: string) {
    setBankId(newBankId);
    setIsBankModalOpen(false);
    requestAnimationFrame(() => focusNextField(bankTriggerRef.current));
  }

  // ONLINE can settle against ANY business account, not only a bank (migration 028, per the user
  // 2026-08-30). Values are ba_id now, sent as online_ba_id — bank_id is left untouched on every
  // row already recorded, and posting still resolves those through the original bank lookup.
  // Parent chart account shown inline, same as every other business-account picker.
  const bankOptions = useMemo(
    () => businessAccounts.map(b => ({
      value: String(b.ba_id),
      label: `${b.name} (${b.code})${b.ac_name ? ` — ${b.ac_name}` : ''}`,
    })),
    [businessAccounts]
  );

  // Mirrors the account field's own sync effect: keeps the trigger's displayed text matched to
  // whatever bankId actually is, so every place it gets set — picking one, New clearing it, or
  // loading a saved line (including the legacy bank_id -> ba_id mapping) — shows the right label
  // without each of those call sites having to set the text itself. Typing never touches bankId,
  // so this only runs when the SELECTION changes and never fights the user mid-type.
  useEffect(() => {
    const opt = bankOptions.find(o => o.value === bankId);
    setBankSearchText(opt?.label ?? '');
  }, [bankId, bankOptions]);

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
    setErrorMsg('');
    clearReceiptsDraft();
  };

  const buildPayload = (): ReceiptCreateInput | null => {
    if (!date) { setErrorMsg('Please pick a date.'); return null; }
    if (!baId) { setErrorMsg('Please select an account.'); return null; }
    if (amount <= 0) { setErrorMsg('Amount must be greater than 0.'); return null; }
    if (paymentMode === 'ONLINE' && !bankId) { setErrorMsg('Select which account received this money.'); return null; }
    if (paymentMode === 'CHEQUE' && !chequeNo.trim()) { setErrorMsg('Cheque No. is required for cheque payments.'); return null; }
    if (paymentMode === 'CHEQUE' && !chequeDate) { setErrorMsg('Date on Cheque is required for cheque payments.'); return null; }

    return {
      ba_id: Number(baId),
      receipt_date: date,
      amount,
      commission: selectedCustomer ? (commission || undefined) : undefined,
      payment_mode: paymentMode,
      details: details.trim() || undefined,
      online_ba_id: paymentMode === 'ONLINE' ? Number(bankId) : undefined,
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
    clearReceiptsDraft();
    setBalanceRefreshKey(k => k + 1);
  };

  // RJ-03: clears the entry row only — the voucher, its committed lines and the header date all
  // stay put, because the next thing the user types is the next line of the SAME voucher. This is
  // what "Done" leaves behind. Distinct from handleNew(), which abandons the whole voucher.
  const clearEntryRow = () => {
    setMode('new');
    setReceiptId(null);
    setEntryIsDraft(false);
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
    clearReceiptsDraft();
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

    // Done on an UNTOUCHED entry row means "I'm finished with this voucher", not "commit this
    // row" — reported by the user (2026-08-31) after adding two entries and being told to
    // "select an account" when there was nothing left to add. Every line is already saved in
    // draft_receipts by the Done that committed it, so there is genuinely nothing to write here
    // and refusing was just noise. Say what state the voucher is in and point at Post, rather
    // than silently doing nothing.
    //
    // Deliberately only when the row is COMPLETELY untouched: if any field is filled the user
    // was part-way through an entry, so the normal per-field validation below still runs and
    // tells them what is missing instead of quietly discarding what they typed.
    const entryRowUntouched = !baId && amount <= 0 && !remarks.trim() && !details.trim()
      && !chequeNo.trim() && !chequeDate && mode !== 'edit';
    if (entryRowUntouched) {
      if (voucher && voucherLines.length > 0) {
        flash(`Voucher saved — ${voucherLines.length} ${voucherLines.length === 1 ? 'entry' : 'entries'}. Press Post to send it to the ledger.`);
      } else {
        setErrorMsg('Add at least one entry before finishing this voucher.');
      }
      return;
    }

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

    // A voucher line is saved UNPOSTED, so it goes into dbo.draft_receipts — the real receipts
    // table only ever holds posted documents now. Posting the voucher is what moves each line
    // across (draftReceipts.confirm), and unposting moves it back.
    const result = mode === 'edit' && receiptId != null && entryIsDraft
      ? await api.draftReceipts.update(receiptId, linePayload)
      : await api.draftReceipts.create(linePayload);

    if (!result.ok) { fail('Failed to save entry: ' + result.error.message); return; }

    // Nothing to clean up: an unposted receipt IS a draft now, so loading one into the entry row
    // and pressing Done edits that same row in place (the update() branch above) rather than
    // creating a second copy that the original then had to be deleted to avoid duplicating.
    refreshAllVouchers(); // a first Done on a fresh entry just created a new voucher

    const wasEdit = mode === 'edit';
    await refreshVoucher(openVoucher.voucher_id);
    clearEntryRow();
    flash(wasEdit ? 'Entry updated.' : 'Entry added to the voucher.');
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
    setBalanceRefreshKey(k => k + 1);
    refreshAllVouchers();

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
    setBalanceRefreshKey(k => k + 1);
    refreshAllVouchers();
    if (res.data.failed.length === 0) flash(`Voucher ${voucher.voucher_no} unposted.`);
    // It's not fully posted any more, so the window follows it back to the Unposted view (per the
    // user, 2026-08-30) rather than staying on Posted looking at a voucher that no longer belongs
    // there.
    setNavFilter('unposted');
  };

  // RJ-03: abandon the voucher on screen and start a blank one. Nothing is deleted — an unposted
  // voucher with lines still exists and is reachable from the records list; this just stops
  // pointing at it. The next Done allocates a new C.Book No.
  const startNewVoucher = () => {
    setVoucher(null);
    setVoucherRemarks('');
    setVoucherResult(null);
    setNavFilter('unposted'); // back to default working/new-entry mode
    handleNew(); // resets every entry field and the date — one definition of "a blank entry row"
    requestAnimationFrame(() => firstEntryFieldRef.current?.focus());
  };

  // Preview of the System Voucher No. a brand-new voucher will get — voucher_no is ONE sequence
  // across the whole receipt_vouchers table regardless of status (`MAX(voucher_no)+1`, allocated
  // inside receiptVouchers.create() on the backend), unlike Purchase's split real-id/draft-id
  // sequences, so this preview needs no draft/posted distinction.
    // The System No. shown before saving is only a PREVIEW (MAX(id)+1, never reserved server-side).
  // It stays blank until the user actually starts a record with the New button (2026-08-30, per
  // the user: landing on a voucher page should not already show a number). Deliberately set from
  // the button's own onClick rather than inside the New handler: that handler is also called
  // internally on mount, after Post, and after a delete, so keying off it would light the preview
  // up without the user having asked for a new record.
  const [startedNew, setStartedNew] = useState(false);

const nextVoucherNo = useMemo(
    () => Math.max(0, ...allVouchers.map(v => v.voucher_no)) + 1,
    [allVouchers]
  );

  // Voucher-level navigation (2026-08-27, per the user: "match Sale Bill — page through whole
  // vouchers"). Both lists are oldest-first, so First = earliest voucher, Last = most recent.
  const navPostedVouchers = useMemo(
    () => [...allVouchers].filter(v => v.status === 'POSTED')
      .sort((a, b) => a.voucher_date.localeCompare(b.voucher_date) || a.voucher_no - b.voucher_no),
    [allVouchers]
  );
  // Everything not fully posted (UNPOSTED or PARTIAL), same ordering.
  const navUnpostedVouchers = useMemo(
    () => [...allVouchers].filter(v => v.status !== 'POSTED')
      .sort((a, b) => a.voucher_date.localeCompare(b.voucher_date) || a.voucher_no - b.voucher_no),
    [allVouchers]
  );
  const navList = navFilter === 'posted' ? navPostedVouchers : navUnpostedVouchers;

  // -1 when the voucher on screen isn't in the ACTIVE list (nothing open yet, or it's posted while
  // the dropdown says Unposted and vice versa) — handlers treat that as "start from the beginning".
  const navIndex = voucher == null
    ? -1
    : navList.findIndex(v => v.voucher_id === voucher.voucher_id);

  const canNavPrevious = navList.length > 0 && navIndex !== 0;
  const canNavNext = navList.length > 0 && navIndex !== navList.length - 1;


  // Opens whichever VOUCHER sits at `idx` of the active list, with all of its lines — the entries
  // grid below the form is what shows them, which is why the left-hand Pending Posting panel could
  // be dropped entirely (per the user, 2026-08-27).
  const goToNavIndex = (idx: number) => {
    if (idx < 0 || idx >= navList.length) return;
    openVoucherInEntry(navList[idx].voucher_id);
  };

  // navIndex === -1 (nothing from this list open yet) behaves like First, not a no-op.
  // Toolbar "Find" — jump straight to any voucher (posted or not) by C.Book No, date or remarks,
  // searched client-side over the already-loaded lists since both are in memory for the nav
  // buttons anyway. Added 2026-08-27: the other transaction pages all had a Find and these two
  // did not, which mattered more once the Pending Posting panel (the old way to reach a specific
  // pending voucher by eye) was removed.
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const findResults = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return [];
    return [...navPostedVouchers, ...navUnpostedVouchers]
      .filter(v =>
        String(v.voucher_no).includes(q) ||
        v.voucher_date.toLowerCase().includes(q) ||
        (v.remarks || '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [findQuery, navPostedVouchers, navUnpostedVouchers]);

  const handleFindSelect = (v: { voucher_id: number; status: string }) => {
    setIsFindOpen(false);
    setFindQuery('');
    // Point the dropdown at the list this voucher actually belongs to, so First/Prev./Next/Last
    // keep working relative to where you just landed.
    setNavFilter(v.status === 'POSTED' ? 'posted' : 'unposted');
    openVoucherInEntry(v.voucher_id);
  };

  const handleNavFirst = () => goToNavIndex(0);
  const handleNavLast = () => goToNavIndex(navList.length - 1);
  const handleNavPrevious = () => goToNavIndex(navIndex === -1 ? 0 : navIndex - 1);
  const handleNavNext = () => goToNavIndex(navIndex === -1 ? 0 : navIndex + 1);

  // Switching the Posted/Unposted dropdown (per the user, 2026-08-30):
  // - To Unposted: open the most recently saved unposted/partial voucher (or start a blank new
  //   one if there isn't one), then focus New — Enter on it clicks New and lands on Date.
  // - To Posted: re-fetch and jump straight to the most recently posted voucher for browsing.
  const handleNavFilterChange = async (next: 'posted' | 'unposted') => {
    setNavFilter(next);
    if (next === 'unposted') {
      const latest = navUnpostedVouchers[navUnpostedVouchers.length - 1];
      if (latest) await openVoucherInEntry(latest.voucher_id);
      else startNewVoucher();
      requestAnimationFrame(() => newButtonRef.current?.focus());
    } else {
      const fresh = await refreshAllVouchers();
      const list = [...(fresh ?? allVouchers).filter(v => v.status === 'POSTED')]
        .sort((a, b) => a.voucher_date.localeCompare(b.voucher_date) || a.voucher_no - b.voucher_no);
      const latest = list[list.length - 1];
      if (latest) await openVoucherInEntry(latest.voucher_id);
    }
  };

  // RJ-03: pull a committed line back into the entry row to correct it. Only while the line itself
  // is unposted — a posted line has ledger entries, and receipts:update rejects it outright.
  const handleEditLine = (line: api.ReceiptVoucherLineRow) => {
    if (line.status === 'CONFIRMED' || line.draft_id == null) {
      fail('Unpost this voucher before editing that entry.');
      return;
    }
    setMode('edit');
    setDocKind('RECEIPT');
    // An unposted line lives in draft_receipts, so the id the entry row carries while editing is a
    // draft_id — handleDone routes on entryIsDraft to know which table to write back to.
    setEntryIsDraft(true);
    setReceiptId(line.draft_id);
    setReceiptStatus(line.status);
    setBaId(String(line.ba_id));
    setPreviewBaId(line.ba_id);
    setAmount(Number(line.amount));
    setCommission(Number(line.commission) || 0);
    setPaymentMode(line.payment_mode);
    // online_ba_id when present; otherwise a pre-migration-028 row, whose bank_id must be
    // mapped through to that bank's linked business account (bank_accounts.ba_id) — the picker
    // is keyed by ba_id now, and posting resolved such rows to this same account anyway.
    setBankId(
      line.online_ba_id != null
        ? String(line.online_ba_id)
        : (line.bank_id != null
            ? String(banks.find(b => b.bank_id === line.bank_id)?.ba_id ?? '')
            : '')
    );
    setDetails(line.details || '');
    setChequeNo(line.cheque_no || '');
    setChequeDate(toDateInputValue(line.cheque_date));
    setChequeReceivedDate(toDateInputValue(line.cheque_received_date));
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
    setBalanceRefreshKey(k => k + 1);
  };

  // unpost() can reject with CHEQUE_IN_USE when the receipt's cheque has already been endorsed or
  // deposited; that error surfaces as-is in the banner rather than hiding the button, same as the
  // equivalent on ExpensesPage.
  const handleUnpost = async () => {
    if (receiptId == null) return;
    const res = docKind === 'SETTLEMENT'
      ? await api.settlements.unpost(receiptId)
      : await api.receipts.unconfirm(receiptId);
    if (!res.ok) { fail('Failed to unpost: ' + res.error.message); return; }
    // unconfirm() resolves the NEW draft, so the entry row has to re-point at the draft id space.
    if (docKind !== 'SETTLEMENT' && 'draft_id' in res.data) {
      setReceiptId(res.data.draft_id);
      setEntryIsDraft(true);
      setReceiptStatus('DRAFT');
    } else {
      setReceiptStatus((res.data as { status: 'CONFIRMED' | 'DRAFT' }).status);
    }
    flash(docKind === 'SETTLEMENT' ? 'Endorsement unposted.' : 'Receipt unposted successfully.');
    setBalanceRefreshKey(k => k + 1);
  };

  // ── draftReceipts (server-side, CASH/ONLINE only) ──
  /*
  const handleSaveDraft = async () => {
    ...
  };
  */



  // Pending Posting panel (below, left sidebar) — same layout as PurchasePage, but listing
  // VOUCHERS, not individual receipts: corrected per the user (2026-08-26) — a voucher is posted
  // or unposted as a WHOLE, not one specific receipt independently of the others in it. Post one
  // specific voucher, delete one (password-gated, whole voucher — only while entirely UNPOSTED),
  // or Post All. No confirmAll()-equivalent exists for whole vouchers on the backend — Post All
  // here is a client-side loop over receiptVouchers.post(), one voucher at a time, collecting the
  // same posted/failed shape PurchasePage's real confirmAll() result carries.
  // Opens a voucher straight into the read-only view on the Receipt Entry tab (its own lines +
  // totals below) — same shape as PurchasePage's loadPurchaseRow. Editing a specific receipt
  // inside it is still its own deliberate action via the grid's own Edit icon. Used by the Pending
  // Posting sidebar (clicking a row) AND by the Weekly/Monthly/Overall records tabs after
  // unposting a voucher there (see onVoucherUnposted below) — pressing Unpost on a records page
  // now lands you back on Receipt Entry with that voucher on screen, per the user (2026-08-26),
  // instead of leaving you on the records list where the just-unposted voucher no longer belongs.
  const openVoucherInEntry = async (voucherId: number) => {
    const res = await api.receiptVouchers.get(voucherId);
    if (!res.ok) { fail('Failed to load voucher: ' + res.error.message); return; }
    handleNew(); // resets every entry field AND the date — do this first, then override below
    setVoucher(res.data);
    setVoucherResult(null);
    setDate(res.data.voucher_date);
    setMode('view');
  };

  // Passed down to the records tabs: unposting a voucher there switches back to Receipt Entry and
  // loads that same voucher on screen.
  const handleVoucherUnpostedElsewhere = async (voucherId: number) => {
    setActiveTab('entry');
    await openVoucherInEntry(voucherId);
    await refreshAllVouchers();
  };

  const [postAllVouchersBusy, setPostAllVouchersBusy] = useState(false);
  const [postAllVouchersResult, setPostAllVouchersResult] = useState<{
    posted: { voucher_id: number }[];
    failed: { voucher_id: number; message: string }[];
    attempted: number;
  } | null>(null);

  const handlePostAllVouchers = async () => {
    setPostAllVouchersBusy(true);
    setPostAllVouchersResult(null);
    const posted: { voucher_id: number }[] = [];
    const failed: { voucher_id: number; message: string }[] = [];
    for (const v of navUnpostedVouchers) {
      const res = await api.receiptVouchers.post(v.voucher_id);
      if (res.ok) posted.push({ voucher_id: v.voucher_id });
      else failed.push({ voucher_id: v.voucher_id, message: res.error.message });
    }
    setPostAllVouchersBusy(false);
    setPostAllVouchersResult({ posted, failed, attempted: navUnpostedVouchers.length });
    refreshAllVouchers();
    setBalanceRefreshKey(k => k + 1);
    if (voucher && posted.some(p => p.voucher_id === voucher.voucher_id)) await refreshVoucher(voucher.voucher_id);
    if (failed.length === 0) flash(`${posted.length} voucher(s) posted.`);
  };

  // Deletes the voucher currently on screen (password-gated via the shared PasswordPromptModal).
  // Was a per-row button in the removed Pending Posting panel; it's a toolbar action now, so it
  // targets the open voucher rather than an arbitrary one from a list. Backend rejects deleting a
  // PARTIAL voucher (some lines already posted), which is why the button below requires UNPOSTED.
  const handleDeleteVoucherClick = () => {
    if (!voucher) return;
    setDeleteTarget({ kind: 'voucher', id: voucher.voucher_id, amount: Number(voucher.total_amount) });
  };

  // Sub-tab switcher — lives in the top header bar next to the page title (AppLayout's
  // headerAction slot), same treatment as Sale Bill/Sale Return, so the content below the Quick
  // Menu bar starts immediately instead of losing a row's height to a tab bar first.
  const tabBar = (
    <div className="flex flex-wrap gap-1.5" data-no-print>
      <button
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', JSON.stringify({ page: 'receipts-jamma', tab: 'entry', label: 'Receipt Entry' }));
        }}
        onClick={() => setActiveTab('entry')}
        title="Drag tab to Quick Access Menu Bar to pin"
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all cursor-grab active:cursor-grabbing ${
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
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all cursor-grab active:cursor-grabbing ${
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
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all cursor-grab active:cursor-grabbing ${
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
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all cursor-grab active:cursor-grabbing ${
          activeTab === 'overall'
            ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        Overall Records
      </button>
    </div>
  );

  return (
    <AppLayout pageTitle="Receipts / Jamma Entry" subTabTitle={RECEIPT_TAB_LABELS[activeTab]} subTabId={activeTab} headerAction={tabBar}>
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {/* Tab Content */}
        {activeTab === 'weekly' && <WeeklyReceiptsTab onVoucherUnposted={handleVoucherUnpostedElsewhere} />}
        {activeTab === 'monthly' && <MonthlyReceiptsTab onVoucherUnposted={handleVoucherUnpostedElsewhere} />}
        {activeTab === 'overall' && <OverallReceiptsTab onVoucherUnposted={handleVoucherUnpostedElsewhere} />}

        {activeTab === 'entry' && (
          <div className="max-w-5xl mx-auto relative animate-fadeIn">

            {/* The left-hand "Pending Posting" panel that used to live here (a floating list
                of every not-yet-posted voucher, with its own Post All / per-voucher Post and
                Delete) was removed 2026-08-27 at the user's request: Receipts should read like
                Sale Bill, where a voucher and its entries live in the main area rather than as
                cards off to one side. Reaching another pending voucher is now the toolbar's
                First/Prev./Next/Last, with the Posted/Unposted dropdown choosing which list —
                and "Post All" moved into that same toolbar. */}

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

            {/* RJ-03: Toolbar — every action for the voucher on screen (Done, Post/Un Post, New
                Voucher, the endorsement's own Post/Unpost, and record navigation) lives in one
                dedicated bar above the card. Restyled per frontend/pages_design.md §1: small
                square icon-over-label buttons instead of pill-shaped colored ones, matching
                Purchase/Purchase Return. "Done" submits the form below via the form="" attribute
                since the button itself now sits outside the <form> tag. */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
              <div className="flex flex-wrap items-center gap-0.5">
                {!isViewMode && (
                  <button type="submit" form="receipt-entry-form" title={mode === 'edit' ? 'Update Entry' : 'Done'} className="toolbar-btn">
                    <Save size={20} strokeWidth={2.5} className="text-blue-600" />
                    <span>{mode === 'edit' ? 'Update' : 'Done'}</span>
                  </button>
                )}
                <button
              data-new-action="true" ref={newButtonRef} type="button" onClick={() => { setStartedNew(true); startNewVoucher(); }} title="New Voucher" className="toolbar-btn">
                  <Plus size={20} strokeWidth={2.5} className="text-emerald-600" />
                  <span>New</span>
                </button>
                {/* Whole-voucher delete (password-gated). UNPOSTED only — the backend refuses to
                    delete a PARTIAL voucher, since some of its lines already have ledger entries. */}
                <button
                  type="button"
                  onClick={handleDeleteVoucherClick}
                  disabled={!voucher || voucher.status !== 'UNPOSTED'}
                  title="Delete this voucher (asks for your password)"
                  className="toolbar-btn"
                >
                  <Trash2 size={20} strokeWidth={2.5} className="text-rose-600" />
                  <span>Delete</span>
                </button>

                <div className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

                {/* Record navigation — pages through whole VOUCHERS from whichever list the
                    Posted/Unposted dropdown (right) selects. See navFilter's own comment. */}
                <button type="button" onClick={handleNavFirst} disabled={!canNavPrevious} title="First" className="toolbar-btn">
                  <ChevronsLeft size={20} strokeWidth={2.5} className="text-amber-600" />
                  <span>First</span>
                </button>
                <button type="button" onClick={handleNavPrevious} disabled={!canNavPrevious} title="Previous" className="toolbar-btn">
                  <ChevronLeft size={20} strokeWidth={2.5} className="text-amber-600" />
                  <span>Prev.</span>
                </button>
                <button type="button" onClick={handleNavNext} disabled={!canNavNext} title="Next" className="toolbar-btn">
                  <ChevronRight size={20} strokeWidth={2.5} className="text-amber-600" />
                  <span>Next</span>
                </button>
                <button type="button" onClick={handleNavLast} disabled={!canNavNext} title="Last" className="toolbar-btn">
                  <ChevronsRight size={20} strokeWidth={2.5} className="text-amber-600" />
                  <span>Last</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsFindOpen(true)}
                  title="Find a voucher by C.Book No, date or remarks"
                  className="toolbar-btn"
                >
                  <Search size={20} strokeWidth={2.5} className="text-slate-600" />
                  <span>Find</span>
                </button>

                <div className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

                {/* Post/Unpost are voucher-level. Post needs at least one committed line; an empty
                    voucher has nothing to post (the backend rejects it with EMPTY_VOUCHER). Unpost
                    is gated only on the voucher's own status, not on navFilter. */}
                <button
                  type="button"
                  onClick={handleUnpostVoucher}
                  disabled={!voucher || voucherLines.length === 0 || voucher.status === 'UNPOSTED' || voucherBusy}
                  title="Unpost Voucher"
                  className="toolbar-btn"
                >
                  <Undo2 size={20} strokeWidth={2.5} className="text-rose-600" />
                  <span>Unpost</span>
                </button>
                <button
                  type="button"
                  onClick={handlePostVoucher}
                  disabled={!voucher || voucherLines.length === 0 || voucher.status === 'POSTED' || voucherBusy}
                  title={voucherBusy ? 'Posting…' : `Post Voucher${voucherLines.length ? ` (${voucherLines.length})` : ''}`}
                  className="toolbar-btn"
                >
                  <CheckCircle2 size={20} strokeWidth={2.5} className="text-emerald-600" />
                  <span>Post</span>
                </button>
                {/* Moved here from the removed Pending Posting panel — posts every voucher still
                    awaiting posting, one at a time, reporting any that fail. */}
                <button
                  type="button"
                  onClick={handlePostAllVouchers}
                  disabled={navUnpostedVouchers.length === 0 || postAllVouchersBusy}
                  title={postAllVouchersBusy ? 'Posting…' : `Post All (${navUnpostedVouchers.length})`}
                  className="toolbar-btn"
                >
                  <PackageCheck size={20} strokeWidth={2.5} className="text-emerald-600" />
                  <span>Post All</span>
                </button>

                {/* Endorsements post on their own, not with a voucher — same Unpost gate applies. */}
                {docKind === 'SETTLEMENT' && mode === 'view' && receiptId != null && (
                  isPosted ? (
                    <button
                      type="button"
                      onClick={handleUnpost}
                      title="Unpost Endorsement"
                      className="toolbar-btn"
                    >
                      <Undo2 size={20} strokeWidth={2.5} className="text-rose-600" />
                      <span>Unpost</span>
                    </button>
                  ) : (
                    <button type="button" onClick={handlePost} title="Post Endorsement" className="toolbar-btn">
                      <CheckCircle2 size={20} strokeWidth={2.5} className="text-emerald-600" />
                      <span>Post</span>
                    </button>
                  )
                )}
              </div>

              {/* Posted/Unposted — picks which list Previous/Next/First/Last page through. Unposted
                  (default) = add/post new vouchers; Posted = browse already-posted ones (per the
                  user, 2026-08-30). */}
              <select
                value={navFilter}
                onChange={e => handleNavFilterChange(e.target.value as 'posted' | 'unposted')}
                className="soleria-input soleria-input-compact cursor-pointer font-semibold"
                style={{ width: 'auto' }}
                title="Which vouchers First/Prev./Next/Last page through: posted ones, or those still awaiting posting."
              >
                <option value="unposted">Unposted ({navUnpostedVouchers.length})</option>
                <option value="posted">Posted ({navPostedVouchers.length})</option>
              </select>

              {/* Post All's outcome. Stays until dismissed — a run can post 8 of 10, and the two
                  that failed are the whole point of the message. Previously lived in the removed
                  Pending Posting panel. */}
              {postAllVouchersResult && (
                <div className="w-full mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border-color)' }}>
                  <p className="font-semibold text-slate-700">
                    {postAllVouchersResult.posted.length} of {postAllVouchersResult.attempted} posted
                    {postAllVouchersResult.failed.length > 0 && ` · ${postAllVouchersResult.failed.length} failed`}
                    <button
                      type="button"
                      onClick={() => setPostAllVouchersResult(null)}
                      className="ml-2 text-slate-500 hover:text-slate-700 font-semibold"
                    >
                      Dismiss
                    </button>
                  </p>
                  {postAllVouchersResult.failed.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {postAllVouchersResult.failed.map(f => (
                        <li key={f.voucher_id} className="text-rose-700">
                          <span className="font-mono font-semibold">#{f.voucher_id}</span>{' — '}{f.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Status badges only. The old "Receipt Voucher — C.Book No N" / "New Receipt
                Voucher" heading that sat here was removed (per the user, 2026-08-31): it pushed
                the entry card away from the toolbar, and the number it showed is already the
                C.Book No field in row 1. The badges move up into this thin strip so the toolbar
                and the entry card read as one joined block, exactly like Sale Bill. */}
            {(voucher || (mode === 'edit' && receiptId != null && docKind === 'RECEIPT') || (docKind === 'SETTLEMENT' && receiptId != null)) && (
              <div className="flex flex-wrap items-center gap-2 mb-2 px-1" data-no-print>
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
                    cash/bank leg and no voucher_id — so it keeps its own document-level badge. */}
                {docKind === 'SETTLEMENT' && receiptId != null && (
                  <span className="px-2 py-0.5 rounded text-xs font-semibold bg-violet-100 text-violet-800">
                    Endorsement #{receiptId} · {isPosted ? 'Posted' : 'Not Posted'}
                  </span>
                )}
              </div>
            )}

            {/* RJ-03: Entry Form Card — the head of a VOUCHER, not a single receipt. Post and
                Unpost act on the whole voucher; the per-line status badge lives in the grid.
                Padding matched to Sale Bill's own card (p-3/md:p-4, not p-6/md:p-8) — the user's
                standing "keep it compact as the sale bill" rule. */}
            <div className="card-white p-3 md:p-4 bg-white border border-slate-200 rounded-xl shadow-sm" data-no-print>

              {/* RJ-03: submitting the form is "Done" — it commits the entry row as a line of the
                  voucher and re-arms for the next one. G-01's Enter-on-last-field rule fires the
                  form's submit button, so Enter through the row ends in Done with no mouse.

                  Layout is one CSS grid for ALL rows, rebuilt to ref-pics/batch2/receipt jamma.png
                  (per the user, 2026-08-31). Same technique as SaleBillPage's master section: a
                  single shared column template with explicit `gridArea` placement, so every box
                  starts and ends on the same vertical lines down the whole form — that alignment
                  is the entire reason this is one grid rather than a stack of independent rows.

                  The template is a 105px inline-label column + 12 equal units, and the ref pic's
                  own box widths land on exact unit boundaries:
                    row 1  Date (label+2u) · C.Book No (2u) · Remarks (8u)
                    row 2  A/C Code (2u) · Account name (8u) · Balance (2u)
                    row 3  Narration (4u) · Mode (2u) · Cheque No (2u) · Cheque Date (2u) · Amount (2u)
                    row 4  Received Into (4u) · Online Ref. Code (8u)   ← ONLINE only, not in ref pic
                  Row 1 labels sit ABOVE their boxes and rows 2-4 use inline labels, matching the
                  ref pic exactly.

                  Cheque No / Date on Cheque render only for CHEQUE and Received Into / Ref. Code
                  only for ONLINE. They are left as EMPTY grid cells rather than collapsed, so
                  Amount stays pinned to the right-hand column in every mode — the ref pic's own
                  placement — and the boxes never shift under the user as the mode changes. */}
              <form id="receipt-entry-form" onSubmit={handleDone} className="flex flex-col gap-2">
                <div
                  className="grid gap-x-2 gap-y-1.5"
                  style={{
                    gridTemplateColumns: '105px repeat(12, 1fr)',
                    gridTemplateAreas: `
                      "date    date    date    cbook   cbook   remarks remarks remarks remarks remarks remarks remarks remarks"
                      "aclbl   accode  accode  acname  acname  acname  acname  acname  acname  acname  acname  acbal   acbal"
                      "narlbl  narr    narr    narr    narr    mode    mode    chqno   chqno   chqdt   chqdt   amt     amt"
                      "onlbl   rcvinto rcvinto rcvinto rcvinto refcode refcode refcode refcode refcode refcode refcode refcode"
                    `,
                  }}
                >
                  {/* ── Row 1 ── labels above the boxes, per the ref pic. */}

                  {/* MASTER field, per the user (2026-08-26): Date/System Voucher No./Remarks are
                      selected ONCE and locked for the whole voucher until "New Voucher" is
                      pressed — Account/Narration/Payment Mode/Amount/Endorse are the DETAIL,
                      re-entered fresh for every receipt. Locked the moment the voucher exists at
                      all (first Done), not only once posted. */}
                  <div style={{ gridArea: 'date' }}>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--secondary-text)' }}>Date</label>
                    <input
                      type="date"
                      value={voucher ? voucher.voucher_date : date}
                      disabled={!!voucher}
                      onChange={e => setDate(e.target.value)}
                      className="soleria-input soleria-input-compact font-semibold"
                    />
                  </div>

                  {/* System Voucher No. — the ref pic's "C.Book No". voucher.voucher_no, assigned
                      by the database (MAX+1 over receipt_vouchers), never typed. Every receipt
                      added to this voucher shares this SAME number. Before the first Done creates
                      the voucher it shows nextVoucherNo, a PREVIEW of what will be assigned. */}
                  <div style={{ gridArea: 'cbook' }}>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--secondary-text)' }}>C.Book No</label>
                    <input
                      type="text"
                      value={voucher ? String(voucher.voucher_no) : (startedNew ? `${nextVoucherNo}` : '')}
                      disabled
                      readOnly
                      className="soleria-input soleria-input-compact bg-slate-100 text-slate-600 font-mono text-center"
                      title={voucher ? undefined : 'Assigned by the system when this voucher is first saved'}
                    />
                  </div>

                  {/* MASTER field — see the Date field's own comment above. */}
                  <div style={{ gridArea: 'remarks' }}>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--secondary-text)' }}>Remarks</label>
                    <input
                      type="text"
                      value={voucher ? (voucher.remarks ?? '') : voucherRemarks}
                      disabled={!!voucher}
                      onChange={e => setVoucherRemarks(e.target.value)}
                      placeholder="Applies to the whole voucher"
                      className="soleria-input soleria-input-compact"
                    />
                  </div>

                  {/* ── Row 2 ── A/C Code · Account name · Balance, inline label. */}
                  <label style={{ gridArea: 'aclbl' }} className="self-center text-[11px] font-semibold uppercase tracking-wider" >
                    A/C Code <span className="text-red-500 font-bold">*</span>
                  </label>

                  {/* Read-only — the code follows whichever account the name field selects. */}
                  <div style={{ gridArea: 'accode' }}>
                    <input
                      type="text"
                      value={selectedAccount?.code ?? ''}
                      disabled
                      readOnly
                      className="soleria-input soleria-input-compact bg-slate-100 text-slate-600 font-mono"
                    />
                  </div>

                  {/* The account picker itself. Tinted like the ref pic's own highlighted
                      description box — inline `style`, not a Tailwind colour utility, because
                      `.soleria-input` sets background/border-color as a plain class of equal
                      specificity that lands later in the sheet, so a Tailwind colour class on the
                      same element silently loses to it (verified: computed background stayed
                      #ffffff until this moved inline). Opens a centered SearchModal (pages_design.md §5) rather
                      than SearchableSelect's small anchored panel — Enter/Arrow Up/Down opens it.
                      RJ-03: also the ref target for the post-Done cursor return, being the first
                      field of the entry row. */}
                  <div style={{ gridArea: 'acname' }} className="min-w-0" ref={firstEntryFieldWrapRef}>
                    <div className="relative">
                      <input
                        ref={accountTriggerRef}
                        type="text"
                        data-field-nav="true"
                        disabled={isViewMode}
                        value={accountSearchText}
                        onChange={e => setAccountSearchText(e.target.value)}
                        onKeyDown={handleAccountTriggerKeyDown}
                        placeholder="Type an account name, or press Enter to search..."
                        className="soleria-input soleria-input-compact pr-8 font-semibold"
                        style={{ background: '#e6fffb', borderColor: '#7fd6cc', color: '#0f4f47' }}
                      />
                      <button
                        type="button"
                        disabled={isViewMode}
                        onClick={openAccountModal}
                        title="Browse all accounts"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                    <SearchModal
                      isOpen={isAccountModalOpen}
                      title="Select Account"
                      options={accountOptions}
                      value={baId}
                      onSelect={handleAccountSelect}
                      onClose={() => { setIsAccountModalOpen(false); setPreviewBaId(null); }}
                      onHighlightChange={val => setPreviewBaId(val ? Number(val) : null)}
                      searchPlaceholder="Search account..."
                      initialSearch={accountModalSeed}
                    />
                  </div>

                  {/* RJ-02: the selected account's live balance, in the ref pic's own right-hand
                      box on this row. Follows the HIGHLIGHTED account while the picker is open,
                      so it updates as the user arrow-keys the list, before committing to one. */}
                  <div style={{ gridArea: 'acbal' }} className="min-w-0">
                    <AccountBalanceTooltip
                      baId={previewBaId ?? (baId ? Number(baId) : null)}
                      refreshKey={balanceRefreshKey}
                      className="w-full justify-end"
                    />
                  </div>

                  {/* ── Row 3 ── Narration · Mode · Cheque No · Date on Cheque · Amount. */}
                  <label style={{ gridArea: 'narlbl' }} className="self-center text-[11px] font-semibold uppercase tracking-wider">
                    Narration
                  </label>
                  <div style={{ gridArea: 'narr' }}>
                    <input
                      type="text"
                      value={remarks}
                      disabled={isViewMode}
                      onChange={e => setRemarks(e.target.value)}
                      placeholder="Enter narration..."
                      className="soleria-input soleria-input-compact"
                    />
                  </div>

                  {/* Payment mode is a real <select> now (per the user, 2026-08-31), not the old
                      three-button toggle — the ref pic shows a dropdown, and a native select also
                      gives G-01's Enter-walk a field it already recognizes for free. The letter
                      keys the user asked for are handled explicitly rather than left to the
                      browser's type-ahead: C moves Cash→Cheque (and back), O jumps to Online.
                      Both Cash and Cheque start with C, so a bare "first letter wins" rule could
                      never reach Cheque — hence the toggle. */}
                  <div style={{ gridArea: 'mode' }}>
                    <select
                      value={paymentMode}
                      disabled={isViewMode}
                      onChange={e => selectPaymentMode(e.target.value as typeof PAYMENT_MODES[number])}
                      onKeyDown={handlePaymentModeKeyDown}
                      className="soleria-input soleria-input-compact cursor-pointer font-semibold"
                    >
                      {PAYMENT_MODES.map(pm => (
                        <option key={pm} value={pm}>{PAYMENT_MODE_LABELS[pm]}</option>
                      ))}
                    </select>
                  </div>

                  {/* CHEQUE only — skipped entirely in any other mode, leaving the cell empty so
                      Amount keeps its ref-pic position on the right. */}
                  {paymentMode === 'CHEQUE' && (
                    <div style={{ gridArea: 'chqno' }}>
                      <input
                        type="text"
                        value={chequeNo}
                        disabled={isViewMode}
                        onChange={e => setChequeNo(e.target.value)}
                        placeholder="Cheque No."
                        title="Cheque No."
                        className="soleria-input soleria-input-compact font-mono"
                      />
                    </div>
                  )}
                  {paymentMode === 'CHEQUE' && (
                    <div style={{ gridArea: 'chqdt' }}>
                      <input
                        type="date"
                        value={chequeDate}
                        disabled={isViewMode}
                        onChange={e => setChequeDate(e.target.value)}
                        title="Date on Cheque"
                        className="soleria-input soleria-input-compact"
                      />
                    </div>
                  )}

                  <div style={{ gridArea: 'amt' }}>
                    <input
                      type="number"
                      min={0}
                      value={amount || ''}
                      disabled={isViewMode}
                      onChange={e => setAmount(Math.max(0, parseInt(e.target.value) || 0))}
                      placeholder="Amount"
                      title="Amount Received (PKR)"
                      className="soleria-input soleria-input-compact font-semibold font-mono text-right"
                    />
                  </div>

                  {/* ── Row 4 ── ONLINE only; not in the ref pic, placed by the user (2026-08-31)
                      on the same column lines as the rows above. Endorsed money never lands in one
                      of our accounts, so there is nothing to receive it into. */}
                  {paymentMode === 'ONLINE' && !isEndorsed && (
                    <label style={{ gridArea: 'onlbl' }} className="self-center text-[11px] font-semibold uppercase tracking-wider leading-tight">
                      Received Into <span className="text-red-500 font-bold">*</span>
                    </label>
                  )}
                  {paymentMode === 'ONLINE' && !isEndorsed && (
                    <div style={{ gridArea: 'rcvinto' }} className="min-w-0">
                      {bankOptions.length === 0 ? (
                        <div className="soleria-input soleria-input-compact text-rose-600 flex items-center font-semibold">
                          No business accounts yet — add one in Setup first
                        </div>
                      ) : (
                        <>
                          <div className="relative">
                            <input
                              ref={bankTriggerRef}
                              type="text"
                              data-field-nav="true"
                              disabled={isViewMode}
                              value={bankSearchText}
                              onChange={e => setBankSearchText(e.target.value)}
                              onKeyDown={handleBankTriggerKeyDown}
                              placeholder="Type an account name, or press Enter to search..."
                              className="soleria-input soleria-input-compact pr-8"
                            />
                            <button
                              type="button"
                              disabled={isViewMode}
                              onClick={openBankModal}
                              title="Browse all accounts"
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <ChevronDown size={14} />
                            </button>
                          </div>
                          <SearchModal
                            isOpen={isBankModalOpen}
                            title="Received Into"
                            options={bankOptions}
                            value={bankId}
                            onSelect={handleBankSelect}
                            onClose={() => setIsBankModalOpen(false)}
                            searchPlaceholder="Search account..."
                            initialSearch={bankModalSeed}
                          />
                        </>
                      )}
                    </div>
                  )}
                  {paymentMode === 'ONLINE' && (
                    <div style={{ gridArea: 'refcode' }} className="flex items-center gap-2 min-w-0">
                      <label className="shrink-0 text-[11px] font-semibold uppercase tracking-wider">Ref. Code</label>
                      <input
                        type="text"
                        value={details}
                        disabled={isViewMode}
                        onChange={e => setDetails(e.target.value)}
                        placeholder="e.g. Alfa ref 980124"
                        title="Online Reference Code / Details"
                        className="soleria-input soleria-input-compact"
                      />
                    </div>
                  )}
                </div>

                {/* Fields with no box in the ref pic. Kept below the four ref rows rather than
                    squeezed into them, so rows 1-4 stay exactly as the user specified while none
                    of the existing behaviour is lost — "Drawn On" in particular is still written
                    to receipts.details and re-read when a cheque line is opened for edit, so
                    dropping its input would have made saved data uneditable. Same column template
                    as the rows above, so these still line up with them. */}
                {(paymentMode === 'CHEQUE' || (selectedCustomer && !isEndorsed)) && (
                  <div
                    className="grid gap-x-2 gap-y-1.5 pt-1.5 border-t"
                    style={{
                      borderColor: 'var(--border-table)',
                      gridTemplateColumns: '105px repeat(12, 1fr)',
                      gridTemplateAreas: `
                        "extlbl  extone  extone  extone  exttwo  exttwo  exttwo  exttwo  extthree extthree extthree extthree extthree"
                      `,
                    }}
                  >
                    {paymentMode === 'CHEQUE' && (
                      <>
                        <label style={{ gridArea: 'extlbl' }} className="self-center text-[11px] font-semibold uppercase tracking-wider leading-tight">
                          Recd. Date
                        </label>
                        <div style={{ gridArea: 'extone' }}>
                          <input
                            type="date"
                            value={chequeReceivedDate}
                            disabled={isViewMode}
                            onChange={e => setChequeReceivedDate(e.target.value)}
                            placeholder={date}
                            title="Cheque Received Date — defaults to the Date above if left blank"
                            className="soleria-input soleria-input-compact"
                          />
                        </div>
                        {/* A received cheque goes into Cheques in Hand, not a bank — the bank is
                            chosen later, when it is deposited — so there is no account to pick
                            here, only the customer's own drawing bank to record. */}
                        <div style={{ gridArea: 'exttwo' }} className="flex items-center gap-2 min-w-0">
                          <label className="shrink-0 text-[11px] font-semibold uppercase tracking-wider">Drawn On</label>
                          <input
                            type="text"
                            value={details}
                            disabled={isViewMode}
                            onChange={e => setDetails(e.target.value)}
                            placeholder="e.g. MCB Gulberg"
                            title="Drawn On — the customer's own bank. The cheque itself goes into Cheques in Hand until deposited."
                            className="soleria-input soleria-input-compact"
                          />
                        </div>
                      </>
                    )}
                    {/* Commission is payment-time trade discount to a CUSTOMER (§7) — meaningless
                        on money back from a director, employee, vendor or bank. */}
                    {selectedCustomer && !isEndorsed && (
                      <div style={{ gridArea: 'extthree' }} className="flex items-center gap-2 min-w-0">
                        <label className="shrink-0 text-[11px] font-semibold uppercase tracking-wider">Commission</label>
                        <input
                          type="number"
                          min={0}
                          value={commission || ''}
                          disabled={isViewMode}
                          onChange={e => setCommission(Math.max(0, parseInt(e.target.value) || 0))}
                          placeholder="Optional"
                          className="soleria-input soleria-input-compact font-semibold font-mono text-right"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Endorse — the payer settles by paying one of OUR creditors instead of paying
                    us. Available on every payment mode; the mode itself becomes information about
                    how those two transacted, since none of it reaches our accounts. */}
                <div className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: isEndorsed ? 'var(--brand-gold)' : 'var(--border-color)' }}>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEndorsed}
                      disabled={isViewMode || (mode === 'edit' && docKind === 'RECEIPT')}
                      onChange={e => { setIsEndorsed(e.target.checked); if (!e.target.checked) setEndorseToBaId(''); }}
                      onKeyDown={handleEndorseCheckboxKeyDown}
                      onFocus={() => setIsEndorseFocused(true)}
                      onBlur={() => setIsEndorseFocused(false)}
                    />
                    <span className="text-[11px] font-bold text-slate-800">
                      Endorse this payment to another account
                    </span>
                    <span className="text-[10px] text-slate-500 leading-tight">
                      They pay someone you owe instead of paying you — nothing enters your cash, bank or cheque drawer.
                    </span>
                    {/* Matches handleEndorseCheckboxKeyDown: plain Enter finishes the receipt
                        (adds it to the voucher); Shift+Enter checks this box instead. Only shown
                        while the checkbox itself has focus. */}
                    {isEndorseFocused && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] font-semibold text-blue-700 shrink-0">
                        Shift+Enter to check · Enter adds the receipt
                      </span>
                    )}
                  </label>

                  {isEndorsed && (
                    <div className="mt-1.5 flex items-center gap-2" ref={endorseToWrapRef}>
                      <label className="shrink-0 text-[11px] font-semibold uppercase tracking-wider">
                        Pay To <span className="text-red-500 font-bold">*</span>
                      </label>
                      <div className="flex-1 min-w-0">
                        <SearchableSelect
                          options={businessAccounts.filter(a => String(a.ba_id) !== baId)
                            .map(a => ({
                              value: String(a.ba_id),
                              label: `${a.name} (${a.code})${a.ac_name ? ` — ${a.ac_name}` : ''}`,
                            }))}
                          value={endorseToBaId}
                          onChange={setEndorseToBaId}
                          onHighlightChange={val => setPreviewEndorseBaId(val ? Number(val) : null)}
                          placeholder="Search account to pay..."
                          disabled={isViewMode}
                        />
                      </div>
                      <AccountBalanceTooltip baId={previewEndorseBaId ?? (endorseToBaId ? Number(endorseToBaId) : null)} refreshKey={balanceRefreshKey} />
                    </div>
                  )}
                </div>

              </form>

              {/* ── RJ-03: the voucher's committed entry lines ──────────────────────────────────
                  Merged back into the SAME card as the entry form, not a separate box below it
                  (per the user, 2026-08-26 — a separate box just ate extra padding/border space
                  for no benefit; this way there's more room to actually show entries). The same
                  grid the client's screen shows, plus the Cheque/Online/Cash/Voucher totals in its
                  own footer, so a voucher can be read back at a glance before posting. Always
                  rendered — even with zero lines — matching Purchase's own articles box, which
                  shows its empty state ("No articles added yet...") rather than disappearing
                  entirely (per the user, 2026-08-26). */}
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
                        {voucherLines.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="p-6 text-center text-slate-400 text-sm">
                              No receipts added yet — fill the fields above and press Enter.
                            </td>
                          </tr>
                        ) : voucherLines.map(line => (
                          <tr key={line.receipt_id ?? `draft_${line.draft_id}`} className="border-b hover:bg-slate-50/60 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
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
                                      onClick={() => setDeleteTarget(line.draft_id != null
                                        ? { kind: 'draft', id: line.draft_id, amount: Number(line.amount) }
                                        : { kind: 'receipt', id: line.receipt_id as number, amount: Number(line.amount) })}
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
                    </table>
                  </div>

                  {/* RJ-03: ref-pic's small boxed totals — Total Cheque/Online/Cash on the bottom
                      right plus a Total Amount field, matching Sale Bill's totals-row style
                      instead of the old inline footer text. */}
                  <div className="flex flex-wrap items-end justify-end gap-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-table)' }}>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Cheque</label>
                      <input type="text" value={formatCurrency(Number(voucher?.total_cheque ?? 0))} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-700 text-right font-mono font-semibold" style={{ width: '120px' }} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Online</label>
                      <input type="text" value={formatCurrency(Number(voucher?.total_online ?? 0))} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-700 text-right font-mono font-semibold" style={{ width: '120px' }} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Cash</label>
                      <input type="text" value={formatCurrency(Number(voucher?.total_cash ?? 0))} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-700 text-right font-mono font-semibold" style={{ width: '120px' }} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Amount</label>
                      <input
                        type="text"
                        value={formatCurrency(Number(voucher?.total_amount ?? 0))}
                        disabled
                        className="soleria-input soleria-input-compact text-right font-mono font-bold"
                        style={{ width: '140px', color: 'var(--brand-gold)', background: '#111c2a', borderColor: '#334155' }}
                      />
                    </div>
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

      {/* Find Voucher — jump to any voucher by C.Book No, date or remarks. */}
      {isFindOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-lg mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-4">Find Voucher</h3>
            <input
              type="text"
              value={findQuery}
              onChange={e => setFindQuery(e.target.value)}
              placeholder="C.Book No, date (YYYY-MM-DD) or remarks..."
              className="soleria-input w-full font-semibold mb-3"
              autoFocus
            />
            <ul className="max-h-72 overflow-y-auto border rounded-lg divide-y" style={{ borderColor: 'var(--border-color)' }}>
              {findResults.map(v => (
                <li
                  key={v.voucher_id}
                  onClick={() => handleFindSelect(v)}
                  className="px-3 py-2 text-xs cursor-pointer hover:bg-amber-50/60 flex items-center justify-between gap-2"
                >
                  <span className="font-mono font-semibold text-slate-700">#{v.voucher_no}</span>
                  <span className="text-slate-400 truncate">{v.voucher_date} · {formatCurrency(Number(v.total_amount))}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${v.status === 'POSTED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {v.status === 'POSTED' ? 'posted' : 'unposted'}
                  </span>
                </li>
              ))}
              {findQuery.trim() && findResults.length === 0 && (
                <li className="px-3 py-3 text-xs text-slate-400 text-center">No matching vouchers.</li>
              )}
            </ul>
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => { setIsFindOpen(false); setFindQuery(''); }}
                className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors text-sm font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
