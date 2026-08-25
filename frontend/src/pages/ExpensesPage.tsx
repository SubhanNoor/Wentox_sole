import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import SearchModal from '@/components/SearchModal';
import * as api from '@/lib/api';
import type {
  VendorRow, BankAccountRow, BusinessAccountRow, ChequeRow, ChequeAllocationRow,
  ExpenseCreateInput, ExpensePaymentMode,
  ExpenseVoucherRow, VoucherActionResult
} from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { focusNextField } from '@/lib/fieldNav';
import {
  Save, Wallet, Edit, Trash2, Plus, CheckCircle2, Undo2, ChevronDown,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight
} from 'lucide-react';
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
  const [lookupError, setLookupError] = useState('');

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

  // Every voucher ever created (list() rows — no `lines`), for First/Previous/Next/Last record
  // navigation (frontend/pages_design.md §3), the System Voucher No. "next" preview, and the
  // Pending Posting panel below (which lists VOUCHERS, not individual draft expenses — posting
  // status belongs to the whole voucher, same correction made on Receipts).
  const [allVouchers, setAllVouchers] = useState<ExpenseVoucherRow[]>([]);
  const refreshAllVouchers = useCallback(async () => {
    const res = await api.expenseVouchers.list({});
    if (res.ok) setAllVouchers(res.data);
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
    refreshAllVouchers();
    refreshCheques();
  }, [refreshAllVouchers, refreshCheques]);

  // ── Real-expense form (mirrors ReceiptsPage.tsx's mode structure) ──
  const [mode, setMode] = useState<'new' | 'edit' | 'view'>('new');
  // First/Previous/Next/Last + Posted/Unposted dropdown (frontend/pages_design.md §3, mirrors
  // Receipts exactly): browses the RECEIPTS — here, the individual PAYMENTS — already entered in
  // the OPEN voucher, not other vouchers. `navFilter` arms which action you're browsing for:
  // 'unposted' means "I'm here to Unpost this voucher" and gates the Unpost button; 'posted' is
  // the default browsing/new-entry mode, where nav stays dull.
  const [navFilter, setNavFilter] = useState<'posted' | 'unposted'>('posted');
  const [expenseId, setExpenseId] = useState<number | null>(null);
  // Which table `expenseId` points into. An unposted expense now lives in dbo.draft_expenses and a
  // posted one in dbo.expenses, so the id alone is ambiguous — this says which id space it is in.
  const [entryIsDraft, setEntryIsDraft] = useState(false);
  const [date, setDate] = useState(today());
  const [baId, setBaId] = useState('');
  // RJ-02/PN-01: previewed account while arrow-keying through the picker, for the live balance tooltip.
  const [previewBaId, setPreviewBaId] = useState<number | null>(null);

  // PN-01/RJ-06: delete an expense entry, password-gated.
  type PendingDelete = { kind: 'draft' | 'expense' | 'voucher'; id: number; amount: number };
  const [deleteTarget, setDeleteTarget] = useState<PendingDelete | null>(null);
  const handleDeleteConfirmed = async (password: string) => {
    if (!deleteTarget) return;
    const res = deleteTarget.kind === 'draft'
      ? await api.draftExpenses.remove(deleteTarget.id, password)
      : deleteTarget.kind === 'voucher'
      ? await api.expenseVouchers.remove(deleteTarget.id, password)
      : await api.expenses.remove(deleteTarget.id, password);
    setDeleteTarget(null);
    if (!res.ok) return fail('Failed to delete: ' + res.error.message);
    flash(deleteTarget.kind === 'voucher' ? 'Voucher deleted.' : 'Expense deleted.');
    refreshAllVouchers();
    setBalanceRefreshKey(k => k + 1);
    if (deleteTarget.kind === 'voucher' && voucher?.voucher_id === deleteTarget.id) startNewVoucher();
    else if (voucher) await refreshVoucher(voucher.voucher_id);
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

  // ── PN-01: the open voucher ──────────────────────────────────────────────────────────────────
  // A run of payments is entered as ONE voucher with many entry lines, each line free to name its
  // own account, posted in a single action. Mirrors RJ-03 on the Receipts screen.
  //
  // Created LAZILY, on the first Done — voucher_no ("C.Book No") is allocated MAX+1, so creating one
  // when the page opens would burn a number every time somebody merely visited and walked away.
  const [voucher, setVoucher] = useState<ExpenseVoucherRow | null>(null);
  const [voucherRemarks, setVoucherRemarks] = useState('');
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherResult, setVoucherResult] = useState<VoucherActionResult<'expense_id', ExpenseVoucherRow> | null>(null);

  // Alerts
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');


  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const isViewMode = mode === 'view';
  const voucherLines = voucher?.lines ?? [];

  // PN-01: ref target for the post-Done cursor return — the first field of the entry row. The form
  // never unmounts between lines, so the app-wide G-01 auto-focus never re-fires and focus has to be
  // asked for.
  const firstEntryFieldWrapRef = useRef<HTMLDivElement>(null);
  const focusFirstEntryField = () => requestAnimationFrame(() => {
    firstEntryFieldWrapRef.current?.querySelector<HTMLElement>('button[data-field-nav]')?.focus();
  });

  const refreshVoucher = async (voucherId: number) => {
    // Re-read rather than patching local state: the derived status and per-mode totals are computed
    // on the server from the lines, so a local edit would duplicate that arithmetic and could
    // disagree with it.
    const res = await api.expenseVouchers.get(voucherId);
    if (res.ok) setVoucher(res.data);
    else fail('Failed to reload voucher: ' + res.error.message);
  };

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

  // Account field opens a centered "find" modal (SearchModal) instead of SearchableSelect's small
  // anchored panel — see frontend/pages_design.md §5. Enter (or Arrow Up/Down) on the field opens
  // it; RJ-02's live balance preview still works via SearchModal's own onHighlightChange.
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);

  const openAccountModal = () => {
    if (isViewMode) return;
    setIsAccountModalOpen(true);
  };

  function handleAccountTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openAccountModal();
    }
  }

  function handleAccountSelect(newBaId: string) {
    setBaId(newBaId);
    setIsAccountModalOpen(false);
    setPreviewBaId(null);
    requestAnimationFrame(() => focusNextField(accountTriggerRef.current));
  }

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

  // Payment Mode is a 4-way button toggle, not a native input/select — AppLayout's G-01 Enter-walk
  // only recognizes input/select/textarea/button[data-field-nav], so plain button[type="button"]s
  // were invisible to it and Enter silently skipped the whole group (same issue fixed on
  // ReceiptsPage). Roving-stop: only the currently SELECTED button carries data-field-nav, so the
  // group is exactly one stop, landing on whichever mode is active; Left/Right cycles the
  // selection and moves focus with it.
  const PAYMENT_MODES: ExpensePaymentMode[] = ['CASH', 'CHEQUE_ENDORSED', 'CHEQUE_ISSUED', 'ONLINE'];
  const PAYMENT_MODE_LABELS: Record<ExpensePaymentMode, string> = {
    CASH: 'Cash', CHEQUE_ENDORSED: 'Cheque Endorsed', CHEQUE_ISSUED: 'Cheque Issued', ONLINE: 'Online',
  };
  const paymentModeRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handlePaymentModeKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation(); // don't also let AppLayout's own Left/Right field-walk fire on this keystroke
    const nextIdx = e.key === 'ArrowRight' ? (idx + 1) % PAYMENT_MODES.length : (idx - 1 + PAYMENT_MODES.length) % PAYMENT_MODES.length;
    selectPaymentMode(PAYMENT_MODES[nextIdx]);
    paymentModeRefs.current[nextIdx]?.focus();
  }

  const handleNew = () => {
    setMode('new');
    setExpenseId(null);
    setEntryIsDraft(false);
    setDate(today());
    setBaId('');
    setPreviewBaId(null);
    setAmount(0);
    setPaymentMode('CASH');
    resetModeFields();
    setDetails('');
    setRemarks('');
    setErrorMsg('');
  };

  // "New Voucher" focuses Date, matching PurchasePage's startNewPurchase (frontend/pages_design.md §2).
  const firstFieldRef = useRef<HTMLInputElement>(null);

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

  // PN-01: clears the entry row only — the voucher, its committed lines and the header date stay
  // put, because the next thing typed is the next line of the SAME voucher. Distinct from
  // handleNew(), which abandons the whole voucher.
  const clearEntryRow = () => {
    setMode('new');
    setExpenseId(null);
    setEntryIsDraft(false);
    setBaId('');
    setPreviewBaId(null);
    setAmount(0);
    setPaymentMode('CASH');
    resetModeFields();
    setDetails('');
    setRemarks('');
    setErrorMsg('');
    focusFirstEntryField();
  };

  // PN-01: "Done" — commit the entry row as a line of the open voucher and re-arm the form.
  // Creates the voucher on first use (see the `voucher` state note).
  const handleDone = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;

    let openVoucher = voucher;
    if (!openVoucher) {
      const created = await api.expenseVouchers.create({ voucher_date: date, remarks: voucherRemarks.trim() || undefined });
      if (!created.ok) { fail('Failed to open voucher: ' + created.error.message); return; }
      openVoucher = created.data;
    }

    // Every line carries the voucher's own date — the header owns the date on this screen.
    const linePayload = { ...payload, expense_date: openVoucher.voucher_date, voucher_id: openVoucher.voucher_id };

    // A voucher line is saved UNPOSTED, so it goes into dbo.draft_expenses — the real expenses
    // table only ever holds posted documents now. Posting the voucher is what moves each line
    // across (draftExpenses.confirm), and unposting moves it back.
    const result = mode === 'edit' && expenseId != null && entryIsDraft
      ? await api.draftExpenses.update(expenseId, linePayload)
      : await api.draftExpenses.create(linePayload);

    if (!result.ok) { fail('Failed to save entry: ' + result.error.message); return; }

    const wasEdit = mode === 'edit';
    const paidVendor = isVendorPayment ? linkedVendor?.name : null;
    await refreshVoucher(openVoucher.voucher_id);
    refreshAllVouchers(); // a first Done on a fresh entry just created a new voucher
    clearEntryRow();
    flash(
      wasEdit ? 'Entry updated.'
        : paidVendor ? `Payment to ${paidVendor} added to the voucher.`
        : 'Entry added to the voucher.'
    );
    setBalanceRefreshKey(k => k + 1);
    refreshCheques();
  };

  // PN-01: post every line of the voucher in one action. Each line posts in its own transaction on
  // the backend, so this can come back partly done — `failed` is read and shown per line rather than
  // treating a resolved call as success.
  const handlePostVoucher = async () => {
    if (!voucher) return;
    setVoucherBusy(true);
    setVoucherResult(null);
    const res = await api.expenseVouchers.post(voucher.voucher_id);
    setVoucherBusy(false);

    if (!res.ok) { fail('Failed to post voucher: ' + res.error.message); return; }
    setVoucherResult(res.data);
    setVoucher(res.data.voucher);
    setBalanceRefreshKey(k => k + 1);
    refreshAllVouchers();
    // A CHEQUE_ENDORSED line allocates against a received cheque when it posts, so the endorsement
    // picker has to re-read or it keeps offering value that is already spent.
    refreshCheques();

    if (res.data.failed.length === 0) {
      flash(`Voucher ${voucher.voucher_no} posted — ${res.data.posted?.length ?? 0} entr${(res.data.posted?.length ?? 0) === 1 ? 'y' : 'ies'}. Ready for the next voucher.`);
      startNewVoucher();
    }
  };

  const handleUnpostVoucher = async () => {
    if (!voucher) return;
    setVoucherBusy(true);
    setVoucherResult(null);
    const res = await api.expenseVouchers.unpost(voucher.voucher_id);
    setVoucherBusy(false);

    if (!res.ok) { fail('Failed to unpost voucher: ' + res.error.message); return; }
    setVoucherResult(res.data);
    setVoucher(res.data.voucher);
    setBalanceRefreshKey(k => k + 1);
    refreshAllVouchers();
    refreshCheques(); // unposting releases any cheque allocation the lines held
    if (res.data.failed.length === 0) flash(`Voucher ${voucher.voucher_no} unposted.`);
  };

  // PN-01: abandon the voucher on screen and start a blank one. Nothing is deleted — an unposted
  // voucher with lines still exists and is reachable from the Pending Posting panel.
  const startNewVoucher = () => {
    setVoucher(null);
    setVoucherRemarks('');
    setVoucherResult(null);
    setNavFilter('posted'); // back to default browsing/new-entry mode
    handleNew(); // one definition of "a blank entry row", and it resets the date too
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };

  // PN-01: pull a committed line back into the entry row to correct it. Unposted lines only — a
  // posted line has ledger entries and expenses:update rejects it outright.
  const handleEditLine = (line: api.ExpenseVoucherLineRow) => {
    if (line.status === 'CONFIRMED' || line.draft_id == null) {
      fail('Unpost this voucher before editing that entry.');
      return;
    }
    setMode('edit');
    // An unposted line lives in draft_expenses, so the id the entry row carries while editing is a
    // draft_id — handleDone routes on entryIsDraft to know which table to write back to.
    setEntryIsDraft(true);
    setExpenseId(line.draft_id);
    setBaId(String(line.ba_id));
    setPreviewBaId(line.ba_id);
    setAmount(Number(line.amount));
    setPaymentMode(line.payment_mode);
    setBankId(line.bank_id != null ? String(line.bank_id) : '');
    setChequeId(line.cheque_id != null ? String(line.cheque_id) : '');
    setIssuedChequeNo(line.issued_cheque_no || '');
    setIssuedChequeDate(line.issued_cheque_date ? line.issued_cheque_date.slice(0, 10) : '');
    setDetails(line.details || '');
    setRemarks(line.remarks || '');
    setErrorMsg('');
    focusFirstEntryField();
  };

  // Corrected per the user (2026-08-26, same fix as Receipts): First/Previous/Next/Last browse
  // the PAYMENTS (lines) already entered in the OPEN voucher, not other vouchers — "one voucher,
  // many payments, same C.Book No" (ref-pics/batch2/payment naam.png). `voucherLines` is already
  // oldest-first (backend: ORDER BY created_at ASC). To open a DIFFERENT voucher, use the Pending
  // Posting panel instead — these buttons stay inside the one on screen.
  const currentLineIndex = !voucher || expenseId == null
    ? -1
    : voucherLines.findIndex(l => entryIsDraft ? l.draft_id === expenseId : l.expense_id === expenseId);

  const canNavPrevious = voucherLines.length > 0 && currentLineIndex !== 0;
  const canNavNext = voucherLines.length > 0 && currentLineIndex !== voucherLines.length - 1;

  // Lands on one payment of the open voucher, read-only — same shape as handleEditLine, but always
  // allowed (a posted line can be browsed, just not edited — that still needs Unpost first) and
  // lands in 'view' rather than 'edit'.
  const loadLineForView = (line: api.ExpenseVoucherLineRow) => {
    setMode('view');
    setEntryIsDraft(line.draft_id != null);
    setExpenseId(line.draft_id ?? line.expense_id);
    setBaId(String(line.ba_id));
    setPreviewBaId(line.ba_id);
    setAmount(Number(line.amount));
    setPaymentMode(line.payment_mode);
    setBankId(line.bank_id != null ? String(line.bank_id) : '');
    setChequeId(line.cheque_id != null ? String(line.cheque_id) : '');
    setIssuedChequeNo(line.issued_cheque_no || '');
    setIssuedChequeDate(line.issued_cheque_date ? line.issued_cheque_date.slice(0, 10) : '');
    setDetails(line.details || '');
    setRemarks(line.remarks || '');
    setErrorMsg('');
  };

  const handleNavFirst = () => { if (voucherLines.length) loadLineForView(voucherLines[0]); };
  const handleNavLast = () => { if (voucherLines.length) loadLineForView(voucherLines[voucherLines.length - 1]); };
  const handleNavPrevious = () => {
    const targetIdx = currentLineIndex === -1 ? 0 : currentLineIndex - 1;
    if (targetIdx < 0 || targetIdx >= voucherLines.length) return;
    loadLineForView(voucherLines[targetIdx]);
  };
  const handleNavNext = () => {
    const targetIdx = currentLineIndex === -1 ? 0 : currentLineIndex + 1;
    if (targetIdx < 0 || targetIdx >= voucherLines.length) return;
    loadLineForView(voucherLines[targetIdx]);
  };

  // Preview of the System Voucher No. a brand-new voucher will get — voucher_no is ONE sequence
  // across the whole expense_vouchers table regardless of status (MAX+1, allocated inside
  // expenseVouchers.create() on the backend).
  const nextVoucherNo = useMemo(
    () => Math.max(0, ...allVouchers.map(v => v.voucher_no)) + 1,
    [allVouchers]
  );

  // Opens a voucher straight into the read-only view on the Expense Entry tab (its own lines +
  // totals below) — same shape as PurchasePage's loadPurchaseRow. Used by the Pending Posting
  // sidebar AND by the Weekly/Monthly/Overall records tabs after unposting a voucher there.
  const openVoucherInEntry = async (voucherId: number) => {
    const res = await api.expenseVouchers.get(voucherId);
    if (!res.ok) { fail('Failed to load voucher: ' + res.error.message); return; }
    handleNew(); // resets every entry field AND the date — do this first, then override below
    setVoucher(res.data);
    setVoucherResult(null);
    setDate(res.data.voucher_date);
    setMode('view');
  };

  // Passed down to the records tabs: unposting a voucher there switches back to Expense Entry and
  // loads that same voucher on screen.
  const handleVoucherUnpostedElsewhere = async (voucherId: number) => {
    setActiveTab('entry');
    await openVoucherInEntry(voucherId);
    await refreshAllVouchers();
  };

  // Pending Posting panel (left sidebar) — same layout as PurchasePage/Receipts, listing VOUCHERS,
  // not individual draft expenses: a voucher is posted or unposted as a WHOLE. Post one specific
  // voucher, delete one (password-gated, whole voucher — only while entirely UNPOSTED), or Post
  // All. No confirmAll()-equivalent exists for whole vouchers on the backend — Post All here is a
  // client-side loop over expenseVouchers.post(), one voucher at a time.
  const pendingVouchers = useMemo(
    () => [...allVouchers].filter(v => v.status !== 'POSTED').sort((a, b) => a.voucher_date.localeCompare(b.voucher_date) || a.voucher_no - b.voucher_no),
    [allVouchers]
  );

  const [postingVoucherId, setPostingVoucherId] = useState<number | null>(null);
  const [postAllVouchersBusy, setPostAllVouchersBusy] = useState(false);
  const [postAllVouchersResult, setPostAllVouchersResult] = useState<{
    posted: { voucher_id: number }[];
    failed: { voucher_id: number; message: string }[];
    attempted: number;
  } | null>(null);

  const handlePostOneVoucher = async (voucherId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPostingVoucherId(voucherId);
    const res = await api.expenseVouchers.post(voucherId);
    setPostingVoucherId(null);
    if (!res.ok) { fail('Failed to post voucher: ' + res.error.message); return; }
    flash(`Voucher ${res.data.voucher.voucher_no} posted.`);
    refreshAllVouchers();
    refreshCheques();
    setBalanceRefreshKey(k => k + 1);
    if (voucher?.voucher_id === voucherId) setVoucher(res.data.voucher);
  };

  const handlePostAllVouchers = async () => {
    setPostAllVouchersBusy(true);
    setPostAllVouchersResult(null);
    const posted: { voucher_id: number }[] = [];
    const failed: { voucher_id: number; message: string }[] = [];
    for (const v of pendingVouchers) {
      const res = await api.expenseVouchers.post(v.voucher_id);
      if (res.ok) posted.push({ voucher_id: v.voucher_id });
      else failed.push({ voucher_id: v.voucher_id, message: res.error.message });
    }
    setPostAllVouchersBusy(false);
    setPostAllVouchersResult({ posted, failed, attempted: pendingVouchers.length });
    refreshAllVouchers();
    refreshCheques();
    setBalanceRefreshKey(k => k + 1);
    if (voucher && posted.some(p => p.voucher_id === voucher.voucher_id)) await refreshVoucher(voucher.voucher_id);
    if (failed.length === 0) flash(`${posted.length} voucher(s) posted.`);
  };

  const handleDeleteVoucherClick = (v: ExpenseVoucherRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget({ kind: 'voucher', id: v.voucher_id, amount: Number(v.total_amount) });
  };

  const accountName = useCallback((id: number) => {
    const ba = businessAccounts.find(b => b.ba_id === id);
    if (!ba) return 'Unknown Account';
    const vendor = vendors.find(v => v.ba_id === id);
    return vendor ? vendor.name : ba.name;
  }, [businessAccounts, vendors]);

  // Sub-tab switcher — lives in the top header bar next to the page title (AppLayout's
  // headerAction slot), same treatment as Sale Bill/Sale Return/Receipts.
  const tabBar = (
    <div className="flex flex-wrap gap-1.5" data-no-print>
      <button
        onClick={() => setActiveTab('entry')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'entry'
            ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        Expense Entry
      </button>
      <button
        onClick={() => setActiveTab('weekly')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'weekly'
            ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        Weekly Records
      </button>
      <button
        onClick={() => setActiveTab('monthly')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'monthly'
            ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        Monthly Records
      </button>
      <button
        onClick={() => setActiveTab('overall')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
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
    <AppLayout pageTitle="Expenses / Kharch Entry" headerAction={tabBar}>
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {/* Tab Content */}
        {activeTab === 'weekly' && <WeeklyExpensesTab onVoucherUnposted={handleVoucherUnpostedElsewhere} />}
        {activeTab === 'monthly' && <MonthlyExpensesTab onVoucherUnposted={handleVoucherUnpostedElsewhere} />}
        {activeTab === 'overall' && <OverallExpensesTab onVoucherUnposted={handleVoucherUnpostedElsewhere} />}

        {activeTab === 'entry' && (
          <div className="max-w-5xl mx-auto relative animate-fadeIn">

            {/* Pending Posting — pinned outside the card's own left edge, same layout as
                PurchasePage/Receipts (frontend/pages_design.md): `absolute`, anchored via
                `right: calc(100% + gap)` to this wrapper's left edge. Only shown from `2xl` up. */}
            {(pendingVouchers.length > 0 || postAllVouchersResult) && (
              <aside
                className="hidden 2xl:block absolute top-0 w-64 space-y-3"
                style={{ right: 'calc(100% + 24px)' }}
                data-no-print
              >
                <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl text-sm">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-semibold text-slate-700">Pending Posting</span>
                    <span className="text-xs bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full font-mono font-bold">
                      {pendingVouchers.length}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mb-3">
                    {pendingVouchers.length > 0 && `Total ${formatCurrency(pendingVouchers.reduce((s, v) => s + Number(v.total_amount), 0))}`}
                  </div>
                  {pendingVouchers.length > 0 && (
                    <button
                      type="button"
                      onClick={handlePostAllVouchers}
                      disabled={postAllVouchersBusy}
                      className="w-full px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                    >
                      {postAllVouchersBusy ? 'Posting…' : `Post All (${pendingVouchers.length})`}
                    </button>
                  )}

                  {postAllVouchersResult && (
                    <div className="mt-3 pt-3 border-t border-amber-200">
                      <p className="text-xs font-semibold text-slate-700">
                        {postAllVouchersResult.posted.length} of {postAllVouchersResult.attempted} posted
                        {postAllVouchersResult.failed.length > 0 && ` · ${postAllVouchersResult.failed.length} failed`}
                      </p>
                      {postAllVouchersResult.failed.length > 0 && (
                        <ul className="mt-1.5 space-y-1">
                          {postAllVouchersResult.failed.map(f => (
                            <li key={f.voucher_id} className="text-xs text-rose-700">
                              <span className="font-mono font-semibold">#{f.voucher_id}</span>
                              {' — '}{f.message}
                            </li>
                          ))}
                        </ul>
                      )}
                      <button
                        type="button"
                        onClick={() => setPostAllVouchersResult(null)}
                        className="mt-2 text-xs text-slate-500 hover:text-slate-700 font-semibold"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>

                {pendingVouchers.length > 0 && (
                  <ul className="bg-white border border-slate-200 rounded-xl overflow-hidden max-h-[70vh] overflow-y-auto">
                    {pendingVouchers.map(v => (
                      <li
                        key={v.voucher_id}
                        onClick={() => openVoucherInEntry(v.voucher_id)}
                        className="px-3 py-2.5 text-xs border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-amber-50/60 transition-colors"
                      >
                        <div className="min-w-0 flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-mono font-semibold text-slate-700">
                              #{v.voucher_no} {v.status === 'PARTIAL' && (
                                <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold uppercase bg-orange-100 text-orange-900">Partial</span>
                              )}
                            </div>
                            <div className="text-slate-400">{v.line_count ?? 0} payment{(v.line_count ?? 0) === 1 ? '' : 's'}</div>
                            <div className="text-slate-400">{formatDate(v.voucher_date)} · {formatCurrency(Number(v.total_amount))}</div>
                          </div>
                          <button
                            type="button"
                            title="Post this voucher"
                            onClick={(e) => handlePostOneVoucher(v.voucher_id, e)}
                            disabled={postingVoucherId === v.voucher_id}
                            className="flex-shrink-0 p-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                          >
                            <CheckCircle2 size={12} />
                          </button>
                          {v.status === 'UNPOSTED' && (
                            <button
                              type="button"
                              title="Delete this voucher (password required)"
                              onClick={(e) => handleDeleteVoucherClick(v, e)}
                              disabled={postingVoucherId === v.voucher_id}
                              className="flex-shrink-0 p-1 rounded bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            )}

            {lookupError && (
              <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{lookupError}</div>
            )}
            {successMsg && (
              <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
            )}
            {errorMsg && (
              <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
            )}

            {/* Toolbar — restyled per frontend/pages_design.md §1: small square icon-over-label
                buttons instead of pill-shaped colored ones, matching Purchase/Purchase Return/
                Receipts. "Done" submits the form below via the form="" attribute since the button
                itself now sits outside the <form> tag. */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
              <div className="flex flex-wrap items-center gap-0.5">
                {!isViewMode && (
                  <button type="submit" form="expense-entry-form" title={mode === 'edit' ? 'Update Entry' : 'Done'} className="toolbar-btn">
                    <Save size={20} strokeWidth={2.5} className="text-blue-600" />
                    <span>{mode === 'edit' ? 'Update' : 'Done'}</span>
                  </button>
                )}
                <button type="button" onClick={startNewVoucher} title="New Voucher" className="toolbar-btn">
                  <Plus size={20} strokeWidth={2.5} className="text-emerald-600" />
                  <span>New</span>
                </button>

                <div className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

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

                <div className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

                <button
                  type="button"
                  onClick={handleUnpostVoucher}
                  disabled={!voucher || voucherLines.length === 0 || voucher.status === 'UNPOSTED' || voucherBusy || navFilter !== 'unposted'}
                  title={navFilter !== 'unposted' ? 'Switch the dropdown to Unposted first' : 'Unpost Voucher'}
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
              </div>

              <select
                value={navFilter}
                onChange={e => setNavFilter(e.target.value as 'posted' | 'unposted')}
                className="soleria-input soleria-input-compact cursor-pointer font-semibold"
                style={{ width: 'auto' }}
                title="Posted = add new vouchers. Unposted = required to Unpost this one."
              >
                <option value="posted">Posted</option>
                <option value="unposted">Unposted</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-6 px-1" data-no-print>
              <span className="font-lora font-bold text-sm text-slate-900 flex items-center gap-1.5">
                <Wallet size={16} className="text-[#B08D57]" />
                {voucher ? `Payment Voucher — C.Book No ${voucher.voucher_no}` : 'New Payment Voucher (Naam)'}
              </span>
              {voucher && (
                voucher.status === 'POSTED' ? (
                  <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">Posted</span>
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
              {mode === 'edit' && expenseId != null && (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-sky-100 text-sky-800">
                  Editing entry #{expenseId}
                </span>
              )}
            </div>

            {/* Entry Form Card */}
            <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm" data-no-print>

              <form id="expense-entry-form" onSubmit={handleDone} className="flex flex-col gap-4">
                {/* Row 1 — matches ref-pics/batch2/payment naam.png's own top row: Date, C.Book No
                    and Remarks together (voucher-level fields). */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* MASTER field, matching Receipts' correction: Date/System Voucher No./Remarks
                      are selected ONCE and locked for the whole voucher until "New Voucher" is
                      pressed — Account/Narration/Payment Mode/Amount are the DETAIL, re-entered
                      fresh for every payment. Locked the moment the voucher exists at all (first
                      Done), not only once posted. */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
                    <input
                      ref={firstFieldRef}
                      type="date"
                      value={voucher ? voucher.voucher_date : date}
                      disabled={!!voucher}
                      onChange={e => setDate(e.target.value)}
                      className="soleria-input font-semibold"
                    />
                  </div>

                  {/* System Voucher No. (C.Book No) — voucher.voucher_no, assigned by the database
                      (MAX+1 over the whole expense_vouchers table), never typed. Read-only always.
                      Before the first Done creates the voucher, shows nextVoucherNo — a PREVIEW of
                      what will be assigned. */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">System Voucher No. (C.Book No)</label>
                    <input
                      type="text"
                      value={voucher ? `#${voucher.voucher_no}` : `#${nextVoucherNo} (pending)`}
                      disabled
                      readOnly
                      className="soleria-input bg-slate-100 text-slate-500 font-mono"
                    />
                  </div>

                  {/* MASTER field — see the Date field's own comment above. */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks</label>
                    <input
                      type="text"
                      value={voucher ? (voucher.remarks ?? '') : voucherRemarks}
                      disabled={!!voucher}
                      onChange={e => setVoucherRemarks(e.target.value)}
                      placeholder="Applies to the whole voucher (each payment has its own narration below)"
                      className="soleria-input"
                    />
                  </div>
                </div>

                {/* Row 2 — Account, full width and prominent, matching the ref screenshot's own
                    A/C Code + Account Description row. */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Select Account (Who to Pay) <span className="text-red-500 font-bold">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0" ref={firstEntryFieldWrapRef}>
                      <button
                        ref={accountTriggerRef}
                        type="button"
                        data-field-nav="true"
                        disabled={isViewMode}
                        onClick={openAccountModal}
                        onKeyDown={handleAccountTriggerKeyDown}
                        className="w-full flex items-center justify-between pl-3.5 pr-3.5 py-2 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-sm font-medium text-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold)]/30 focus:border-[var(--brand-gold)] shadow-2xs disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed min-h-[38px] text-left"
                      >
                        <span className={baId ? 'text-slate-800 font-semibold' : 'text-slate-400'}>
                          {baId ? accountOptions.find(o => o.value === baId)?.label : 'Search account by name...'}
                        </span>
                        <ChevronDown size={16} className="text-slate-400" />
                      </button>
                      <SearchModal
                        isOpen={isAccountModalOpen}
                        title="Select Account"
                        options={accountOptions}
                        value={baId}
                        onSelect={handleAccountSelect}
                        onClose={() => { setIsAccountModalOpen(false); setPreviewBaId(null); }}
                        onHighlightChange={val => setPreviewBaId(val ? Number(val) : null)}
                        searchPlaceholder="Search account by name..."
                      />
                    </div>
                    <AccountBalanceTooltip baId={previewBaId ?? (baId ? Number(baId) : null)} refreshKey={balanceRefreshKey} />
                  </div>
                  {selectedBa && (
                    <div className="mt-2 p-3 bg-amber-50/60 border border-amber-200/80 rounded-lg text-xs flex justify-between items-center">
                      <span className="text-amber-900 font-medium">Control Account Head:</span>
                      <span className="font-bold text-amber-950 uppercase tracking-wide">
                        {selectedBa.ac_name || 'EXPENSES ACCOUNTS'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Row 3 — Narration, Payment Mode, Amount, grouped together as one row matching
                    the ref screenshot's own Narration/Type/Amount row. */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Narration</label>
                    <input
                      type="text"
                      value={remarks}
                      disabled={isViewMode}
                      onChange={e => setRemarks(e.target.value)}
                      placeholder="Enter narration..."
                      className="soleria-input"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Payment Mode</label>
                    <div className="grid grid-cols-4 gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                      {PAYMENT_MODES.map((pm, idx) => (
                        <button
                          key={pm}
                          type="button"
                          ref={el => { paymentModeRefs.current[idx] = el; }}
                          data-field-nav={paymentMode === pm ? 'true' : undefined}
                          disabled={isViewMode}
                          onClick={() => selectPaymentMode(pm)}
                          onKeyDown={e => handlePaymentModeKeyDown(e, idx)}
                          className={`py-2 rounded-md transition-colors ${paymentMode === pm ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                        >
                          {PAYMENT_MODE_LABELS[pm]}
                        </button>
                      ))}
                    </div>
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
                    {/* Current account balance alongside what's being entered right now. */}
                    {baId && (
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
                        <span>Current:</span>
                        <AccountBalanceTooltip baId={Number(baId)} refreshKey={balanceRefreshKey} />
                        {amount > 0 && (
                          <span className="font-mono font-semibold text-slate-700">
                            - {formatCurrency(amount)} paying
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-4">
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
                </div>
              </form>

              {/* ── PN-01: the voucher's committed entry lines ──────────────────────────────────
                  Merged into the SAME card as the entry form, not a separate box below it — more
                  room to actually show entries. */}
              {voucherLines.length > 0 && (
                <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <h4 className="font-lora font-semibold text-slate-800 mb-3">
                    Entries in this Voucher
                    <span className="ml-2 text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-mono font-bold">
                      {voucherLines.length}
                    </span>
                  </h4>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                          <th className="p-2.5 pl-3">A/C Code</th>
                          <th className="p-2.5">Account Description</th>
                          <th className="p-2.5">Narration</th>
                          <th className="p-2.5">Cheque No</th>
                          <th className="p-2.5 text-center">Type</th>
                          <th className="p-2.5 text-right">Rs. (Naam)</th>
                          <th className="p-2.5 text-center">Status</th>
                          <th className="p-2.5 text-center" data-no-print>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {voucherLines.map(line => (
                          <tr key={line.expense_id} className="border-b hover:bg-slate-50/60 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                            <td className="p-2.5 pl-3 font-mono text-xs text-slate-600">{line.account_code || '—'}</td>
                            <td className="p-2.5 font-semibold text-slate-800">{line.account_name || accountName(line.ba_id)}</td>
                            <td className="p-2.5 text-slate-600 text-xs">{line.remarks || '—'}</td>
                            {/* A line is paid by a cheque WE wrote (issued_cheque_no) or one we
                                received and handed on (endorsed_cheque_no) — never both. */}
                            <td className="p-2.5 font-mono text-xs text-slate-600">
                              {line.issued_cheque_no || line.endorsed_cheque_no || '—'}
                            </td>
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
                                        : { kind: 'expense', id: line.expense_id as number, amount: Number(line.amount) })}
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

                  {voucherResult && voucherResult.failed.length > 0 && (
                    <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200">
                      <p className="text-xs font-bold text-rose-900">
                        {voucherResult.failed.length} entr{voucherResult.failed.length === 1 ? 'y' : 'ies'} could not be posted — the rest went through.
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {voucherResult.failed.map(f => (
                          <li key={f.expense_id} className="text-xs text-rose-800">
                            <span className="font-semibold">{f.account_name || `#${f.expense_id}`}</span>
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
