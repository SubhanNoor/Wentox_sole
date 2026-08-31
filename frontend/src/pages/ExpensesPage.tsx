import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchModal from '@/components/SearchModal';
import * as api from '@/lib/api';
import type {
  VendorRow, BankAccountRow, BusinessAccountRow, ChequeRow, ChequeAllocationRow,
  ExpenseCreateInput, ExpensePaymentMode,
  ExpenseVoucherRow, VoucherActionResult
} from '@/lib/api';
import { focusNextField } from '@/lib/fieldNav';
import { usePersistentField, useClearPageDraft } from '@/hooks/usePersistentField';
import {
  Save, Edit, Trash2, Plus, CheckCircle2, Undo2, ChevronDown,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, PackageCheck, Search
} from 'lucide-react';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import WeeklyExpensesTab from '@/components/WeeklyExpensesTab';
import MonthlyExpensesTab from '@/components/MonthlyExpensesTab';
import OverallExpensesTab from '@/components/OverallExpensesTab';
import AccountBalanceTooltip from '@/components/AccountBalanceTooltip';
import { toDateInputValue } from '@/lib/utils';

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
    return res.ok ? res.data : null;
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
  // Master/Detail edit-scope radio (left-side widget, below), mirroring ReceiptsPage's own —
  // which half becomes editable while an existing (unposted) line is pulled back into the strip
  // via handleEditLine: Master unlocks only the voucher header (Date/Remarks), Detail unlocks
  // only the entry strip and the entries table's Edit/Delete. Only bites once mode is actually
  // 'edit'; reset to 'master' on New/loading a voucher so a stale scope never carries over, per
  // the user 2026-08-31.
  const [editScope, setEditScope] = useState<'master' | 'detail'>('master');
  // First/Previous/Next/Last + Posted/Unposted dropdown, mirroring Receipts. `navFilter` is a REAL
  // data filter and the buttons page through whole VOUCHERS: 'posted' walks fully-posted ones,
  // 'unposted' walks those still awaiting posting (UNPOSTED or PARTIAL). Changed 2026-08-27 on the
  // user's instruction, alongside removing the left-hand Pending Posting panel — see Receipts'
  // own comment for the full history.
  //
  // Unposted is the default (per the user, 2026-08-30): that's the working mode you add and post
  // new vouchers from. Posted is purely a browse mode over already-posted vouchers (First/Prev./
  // Next/Last + Unpost).
  const [navFilter, setNavFilter] = useState<'posted' | 'unposted'>('unposted');
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const [expenseId, setExpenseId] = useState<number | null>(null);
  // Which table `expenseId` points into. An unposted expense now lives in dbo.draft_expenses and a
  // posted one in dbo.expenses, so the id alone is ambiguous — this says which id space it is in.
  const [entryIsDraft, setEntryIsDraft] = useState(false);
  // In-progress entry-row fields persist across switching pages AND an app restart
  // (usePersistentField — see src/hooks/usePersistentField.ts). Deliberately NOT applied to
  // mode/expenseId/entryIsDraft/voucher — an already-saved expense or voucher loaded for
  // view/edit is safely re-openable by id at any time, so caching it risks showing a stale copy;
  // only unsaved "new" work is ever at risk of being lost.
  const clearExpensesDraft = useClearPageDraft('expenses');
  const [date, setDate] = usePersistentField('expenses', 'date', today());
  const [baId, setBaId] = usePersistentField('expenses', 'baId', '');
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
  const [amount, setAmount] = usePersistentField('expenses', 'amount', 0);
  const [paymentMode, setPaymentMode] = usePersistentField<ExpensePaymentMode>('expenses', 'paymentMode', 'CASH');
  const [bankId, setBankId] = usePersistentField('expenses', 'bankId', '');
  const [chequeId, setChequeId] = usePersistentField('expenses', 'chequeId', '');
  const [issuedChequeNo, setIssuedChequeNo] = usePersistentField('expenses', 'issuedChequeNo', '');
  const [issuedChequeDate, setIssuedChequeDate] = usePersistentField('expenses', 'issuedChequeDate', '');
  const [details, setDetails] = usePersistentField('expenses', 'details', '');
  const [remarks, setRemarks] = usePersistentField('expenses', 'remarks', '');
  const [isSourceAccountModalOpen, setIsSourceAccountModalOpen] = useState(false);

  // ── PN-01: the open voucher ──────────────────────────────────────────────────────────────────
  // A run of payments is entered as ONE voucher with many entry lines, each line free to name its
  // own account, posted in a single action. Mirrors RJ-03 on the Receipts screen.
  //
  // Created LAZILY, on the first Done — voucher_no ("C.Book No") is allocated MAX+1, so creating one
  // when the page opens would burn a number every time somebody merely visited and walked away.
  const [voucher, setVoucher] = useState<ExpenseVoucherRow | null>(null);
  const [voucherRemarks, setVoucherRemarks] = usePersistentField('expenses', 'voucherRemarks', '');
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherResult, setVoucherResult] = useState<VoucherActionResult<'expense_id', ExpenseVoucherRow> | null>(null);

  // Alerts
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');


  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const isViewMode = mode === 'view';
  // Derived from editScope — applied to the header fields and to the entry strip/entries-table
  // interactivity below (2026-08-31). Header fields (Date/Remarks) used to be locked forever once
  // a voucher existed at all (`!!voucher`, regardless of mode/scope) — a genuine bug, since it left
  // no way to ever unlock them again. Fixed alongside adding the toolbar Edit button (2026-08-31):
  // now locked only while viewing, or while mode is 'edit' with Detail scope picked.
  const masterFieldsLocked = isViewMode || (mode === 'edit' && editScope !== 'master');
  const detailFieldsLocked = mode === 'edit' && editScope !== 'detail';
  // True only in the narrow window the Edit button (Master scope) opens — display of Date/Remarks
  // switches from the loaded voucher's own fields to the local editable ones only here, so typing
  // is actually visible while unlocked; committed via commitHeaderEdit() (expenseVouchers.update()),
  // the toolbar's Update button routes there instead of commitEntryLine() while this is true.
  const isHeaderEditing = mode === 'edit' && editScope === 'master';
  const voucherLines = voucher?.lines ?? [];

  // PN-01: ref target for the post-Done cursor return — the first field of the entry row. The form
  // never unmounts between lines, so the app-wide G-01 auto-focus never re-fires and focus has to be
  // asked for.
  //
  // The selector is `[data-field-nav]`, NOT `button[data-field-nav]`: the account field used to be a
  // SearchableSelect (button trigger) but is a typable <input> + SearchModal now, so the button-only
  // selector matched nothing and focus fell through to Amount — reported directly by the user.
  const firstEntryFieldWrapRef = useRef<HTMLDivElement>(null);
  const focusFirstEntryField = () => requestAnimationFrame(() => {
    firstEntryFieldWrapRef.current?.querySelector<HTMLElement>('[data-field-nav]')?.focus();
  });

  const refreshVoucher = async (voucherId: number) => {
    // Re-read rather than patching local state: the derived status and per-mode totals are computed
    // on the server from the lines, so a local edit would duplicate that arithmetic and could
    // disagree with it.
    const res = await api.expenseVouchers.get(voucherId);
    if (res.ok) setVoucher(res.data);
    else fail('Failed to reload voucher: ' + res.error.message);
  };

  // CHEQUE_ISSUED stays bank-only: an issued cheque is drawn on a real bank's cheque book, so a
  // non-bank account has no meaning there (the backend enforces the same rule).
  const bankOnlyOptions = useMemo(
    () => banks.filter(b => b.is_active).map(b => ({ value: String(b.bank_id), label: b.name })),
    [banks]
  );

  // ONLINE can settle against ANY business account (migration 028, per the user 2026-08-30).
  // Keyed by ba_id and sent as online_ba_id; bank_id is untouched on rows already recorded.
  const onlineAccountOptions = useMemo(
    () => businessAccounts.map(b => ({
      value: String(b.ba_id),
      label: `${b.name} (${b.code})${b.ac_name ? ` — ${b.ac_name}` : ''}`,
    })),
    [businessAccounts]
  );

  // The single Paid-From field swaps its list on payment mode — and because the two lists are keyed
  // by DIFFERENT ids (bank_id vs ba_id), `bankId` means different things per mode. Both the payload
  // and the line-loader below branch on the same condition, so the two never get crossed.
  const bankOptions = paymentMode === 'ONLINE' ? onlineAccountOptions : bankOnlyOptions;

  // Combined vendor + any-other-business-account picker. A vendor's own ba_id is a
  // business account too, so listBusinessAccounts() already covers it — options are
  // keyed by ba_id, with vendor-linked accounts given a distinguishing label.
  const accountOptions = useMemo(() => {
    return businessAccounts.map(ba => {
      const vendor = vendors.find(v => v.ba_id === ba.ba_id);
      return {
        value: String(ba.ba_id),
        // Business accounts show their PARENT chart account inline, appended to the same field with an em-dash rather than in a field of its own (2026-08-30, per the user). Matches how ReceiptsPage's own account picker already reads. `ac_name` is joined in by businessAccounts.repository.js's list().
        label: (vendor ? `${vendor.name} (Vendor)` : `${ba.name} (${ba.code})`)
          + (ba.ac_name ? ` — ${ba.ac_name}` : '')
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
  // anchored panel — see frontend/pages_design.md §5. It's a real, typable <input> (same pattern
  // as Purchase's Vendor field / Receipts' Account field, 2026-08-27): type an account name/city
  // and press Enter (or Arrow Up/Down for the full list) to open the modal seeded with what's
  // typed, and keep searching inside it. The small chevron button alongside it still opens the
  // full list blank, for a plain click with nothing typed. RJ-02's live balance preview still
  // works via SearchModal's own onHighlightChange. Committing an account closes the modal, updates
  // the displayed text to the picked account's label (see the sync effect below), and advances
  // focus via the app's G-01 rule.
  const accountTriggerRef = useRef<HTMLInputElement>(null);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [accountSearchText, setAccountSearchText] = useState('');
  // Seeds the modal's search box when opened via Enter on the typed input (blank when opened via
  // the chevron button or Arrow Up/Down instead).
  const [accountModalSeed, setAccountModalSeed] = useState('');

  // Keeps the input's displayed text in sync with whatever baId actually is — see Receipts' own
  // identical effect for why this only runs on selection changes, never fighting mid-type.
  useEffect(() => {
    const opt = accountOptions.find(o => o.value === baId);
    setAccountSearchText(opt?.label ?? '');
  }, [baId, accountOptions]);

  const openAccountModal = () => {
    if (isViewMode || detailFieldsLocked) return;
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
    if (chequeId && !list.some(o => o.value === chequeId) && selectedCheque) {
      list.unshift({ value: chequeId, label: `${selectedCheque.cheque_no} (${selectedCheque.cheque_status})` });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheques, allocationsByReceipt, chequeId, selectedCheque]);

  // Paid-From / Bank Account field for Online / Cheques — typable input + SearchModal pop up on Enter
  const sourceAccountTriggerRef = useRef<HTMLInputElement>(null);
  const [sourceAccountSearchText, setSourceAccountSearchText] = useState('');
  const [sourceAccountModalSeed, setSourceAccountModalSeed] = useState('');

  useEffect(() => {
    if (paymentMode === 'CHEQUE_ENDORSED') {
      const opt = endorsableCheques.find(o => o.value === chequeId);
      setSourceAccountSearchText(opt?.label ?? '');
    } else {
      const opt = bankOptions.find(o => o.value === bankId);
      setSourceAccountSearchText(opt?.label ?? '');
    }
  }, [bankId, chequeId, paymentMode, bankOptions, endorsableCheques]);

  const openSourceAccountModal = () => {
    if (isViewMode || detailFieldsLocked) return;
    setSourceAccountModalSeed('');
    setIsSourceAccountModalOpen(true);
  };

  function handleSourceAccountTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openSourceAccountModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      setSourceAccountModalSeed(sourceAccountSearchText);
      setIsSourceAccountModalOpen(true);
    }
  }

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

  const handleSelectEndorsedCheque = (chequeVal: string) => {
    setChequeId(chequeVal);
    const found = cheques.find(c => String(c.cheque_id) === chequeVal);
    if (found) {
      if (found.cheque_no) setIssuedChequeNo(found.cheque_no);
      if (found.cheque_date) setIssuedChequeDate(found.cheque_date);
    }
  };

  // Payment Mode dropdown keydown handler:
  // Pressing 'c' / 'C' cycles through Cash -> Cheque -> Cheque Endorsement -> Cash
  // Pressing 'o' / 'O' selects Online
  function handlePaymentModeKeyDown(e: React.KeyboardEvent<HTMLSelectElement>) {
    if (isViewMode || detailFieldsLocked) return;
    const key = e.key.toLowerCase();

    if (key === 'c') {
      e.preventDefault();
      e.stopPropagation();
      if (paymentMode === 'CASH') {
        selectPaymentMode('CHEQUE_ISSUED');
      } else if (paymentMode === 'CHEQUE_ISSUED') {
        selectPaymentMode('CHEQUE_ENDORSED');
      } else if (paymentMode === 'CHEQUE_ENDORSED') {
        selectPaymentMode('CASH');
      } else {
        selectPaymentMode('CASH');
      }
    } else if (key === 'o') {
      e.preventDefault();
      e.stopPropagation();
      selectPaymentMode('ONLINE');
    }
  }

  const handleNew = () => {
    setMode('new');
    setEditScope('master'); // a blank voucher starts scoped to Master, same as any freshly loaded one
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
    clearExpensesDraft();
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
      bank_id: paymentMode === 'CHEQUE_ISSUED' ? Number(bankId) : undefined,
      online_ba_id: paymentMode === 'ONLINE' ? Number(bankId) : undefined,
      cheque_id: paymentMode === 'CHEQUE_ENDORSED' ? Number(chequeId) : undefined,
      issued_cheque_no: (paymentMode === 'CHEQUE_ISSUED' || paymentMode === 'CHEQUE_ENDORSED') && issuedChequeNo.trim() ? issuedChequeNo.trim() : undefined,
      issued_cheque_date: (paymentMode === 'CHEQUE_ISSUED' || paymentMode === 'CHEQUE_ENDORSED') && issuedChequeDate ? issuedChequeDate : undefined
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
    clearExpensesDraft();
    focusFirstEntryField();
  };

  // Saves the voucher header (Date/Remarks) edited via Edit + Master scope — the gap flagged
  // when that button was added (2026-08-31): unlocking the fields alone doesn't persist anything,
  // expenseVouchers.update() was never actually called from here. Mirrors commitEntryLine's own
  // return-a-boolean/set-errorMsg-on-failure shape so the Update button can treat both the same way.
  const commitHeaderEdit = async (): Promise<boolean> => {
    if (!voucher) return false;
    if (!date) { fail('Please pick a date.'); return false; }
    const res = await api.expenseVouchers.update(voucher.voucher_id, {
      voucher_date: date,
      remarks: voucherRemarks.trim() || undefined,
    });
    if (!res.ok) { fail('Failed to update voucher: ' + res.error.message); return false; }
    await refreshVoucher(voucher.voucher_id);
    refreshAllVouchers();
    flash('Voucher header updated.');
    return true;
  };

  // Commits the entry strip as one line of the open voucher, opening the voucher on first use
  // (see the `voucher` state note). Returns whether it succeeded — buildPayload/the save call
  // already set errorMsg on failure, so callers just bail out without their own message.
  const commitEntryLine = async (): Promise<boolean> => {
    const payload = buildPayload();
    if (!payload) return false;

    let openVoucher = voucher;
    if (!openVoucher) {
      const created = await api.expenseVouchers.create({ voucher_date: date, remarks: voucherRemarks.trim() || undefined });
      if (!created.ok) { fail('Failed to open voucher: ' + created.error.message); return false; }
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

    if (!result.ok) { fail('Failed to save entry: ' + result.error.message); return false; }

    const wasEdit = mode === 'edit';
    const paidVendor = isVendorPayment ? linkedVendor?.name : null;
    await refreshVoucher(openVoucher.voucher_id);
    refreshAllVouchers(); // a first line on a fresh entry just created a new voucher
    flash(
      wasEdit ? 'Entry updated.'
        : paidVendor ? `Payment to ${paidVendor} added to the voucher.`
          : 'Entry added to the voucher.'
    );
    setBalanceRefreshKey(k => k + 1);
    refreshCheques();
    return true;
  };

  // PN-01: Enter on any entry field submits the form — commits the line and re-arms the strip for
  // the NEXT entry on the SAME voucher. Only the toolbar's Done button finishes the voucher (per
  // the user, 2026-08-30 follow-up: Enter keeps adding to this voucher; Done is the one that closes
  // it and starts a new one).
  const handleEntrySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(await commitEntryLine())) return;
    clearEntryRow();
  };

  // Toolbar's Done button — finishes the OPEN voucher (still unposted/pending, ready to Post
  // later) and opens a fresh blank one for the next voucher, committing whatever's in the entry
  // strip first if it's been filled in (per the user, 2026-08-30 follow-up).
  const handleDoneButton = async () => {
    const hasEntryContent = !!baId || amount > 0;
    if (hasEntryContent) {
      if (!(await commitEntryLine())) return;
    } else if (!voucher) {
      setErrorMsg('Nothing to finish — fill in a payment first.');
      return;
    }
    startNewVoucher();
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
    // It's not fully posted any more, so the window follows it back to the Unposted view (per the
    // user, 2026-08-30) rather than staying on Posted looking at a voucher that no longer belongs
    // there.
    setNavFilter('unposted');
  };

  // PN-01: abandon the voucher on screen and start a blank one. Nothing is deleted — an unposted
  // voucher with lines still exists and is reachable from the Pending Posting panel.
  const startNewVoucher = () => {
    setVoucher(null);
    setVoucherRemarks('');
    setVoucherResult(null);
    setNavFilter('unposted'); // back to default working/new-entry mode
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
    setEditScope('master'); // opening a different line for correction must not carry over a stale edit scope
    // An unposted line lives in draft_expenses, so the id the entry row carries while editing is a
    // draft_id — handleDone routes on entryIsDraft to know which table to write back to.
    setEntryIsDraft(true);
    setExpenseId(line.draft_id);
    setBaId(String(line.ba_id));
    setPreviewBaId(line.ba_id);
    setAmount(Number(line.amount));
    setPaymentMode(line.payment_mode);
    // ONLINE prefers online_ba_id; a pre-028 ONLINE row only has bank_id, so map it through to
    // that bank's own linked business account, since the ONLINE list is keyed by ba_id.
    // CHEQUE_ISSUED keeps using bank_id directly — its list is still banks.
    setBankId(
      line.payment_mode === 'ONLINE'
        ? (line.online_ba_id != null
          ? String(line.online_ba_id)
          : (line.bank_id != null ? String(banks.find(b => b.bank_id === line.bank_id)?.ba_id ?? '') : ''))
        : (line.bank_id != null ? String(line.bank_id) : '')
    );
    setChequeId(line.cheque_id != null ? String(line.cheque_id) : '');
    setIssuedChequeNo(line.issued_cheque_no || '');
    setIssuedChequeDate(toDateInputValue(line.issued_cheque_date));
    setDetails(line.details || '');
    setRemarks(line.remarks || '');
    setErrorMsg('');
    focusFirstEntryField();
  };

  // Voucher-level navigation (2026-08-27, per the user: "match Sale Bill — page through whole
  // vouchers"). Both lists oldest-first, so First = earliest voucher, Last = most recent.
  const navPostedVouchers = useMemo(
    () => [...allVouchers].filter(v => v.status === 'POSTED')
      .sort((a, b) => a.voucher_date.localeCompare(b.voucher_date) || a.voucher_no - b.voucher_no),
    [allVouchers]
  );
  const navUnpostedVouchers = useMemo(
    () => [...allVouchers].filter(v => v.status !== 'POSTED')
      .sort((a, b) => a.voucher_date.localeCompare(b.voucher_date) || a.voucher_no - b.voucher_no),
    [allVouchers]
  );
  const navList = navFilter === 'posted' ? navPostedVouchers : navUnpostedVouchers;

  // -1 when the voucher on screen isn't in the ACTIVE list — handlers treat that as "start over".
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

  // Preview of the System Voucher No. a brand-new voucher will get — voucher_no is ONE sequence
  // across the whole expense_vouchers table regardless of status (MAX+1, allocated inside
  // expenseVouchers.create() on the backend).
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
      const res = await api.expenseVouchers.post(v.voucher_id);
      if (res.ok) posted.push({ voucher_id: v.voucher_id });
      else failed.push({ voucher_id: v.voucher_id, message: res.error.message });
    }
    setPostAllVouchersBusy(false);
    setPostAllVouchersResult({ posted, failed, attempted: navUnpostedVouchers.length });
    refreshAllVouchers();
    refreshCheques();
    setBalanceRefreshKey(k => k + 1);
    if (voucher && posted.some(p => p.voucher_id === voucher.voucher_id)) await refreshVoucher(voucher.voucher_id);
    if (failed.length === 0) flash(`${posted.length} voucher(s) posted.`);
  };

  // Deletes the voucher currently on screen (password-gated). Was a per-row button in the removed
  // Pending Posting panel; a toolbar action now, so it targets the open voucher. Backend rejects
  // deleting a PARTIAL voucher, hence the UNPOSTED-only gate on the button.
  const handleDeleteVoucherClick = () => {
    if (!voucher) return;
    setDeleteTarget({ kind: 'voucher', id: voucher.voucher_id, amount: Number(voucher.total_amount) });
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
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${activeTab === 'entry'
          ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
      >
        Expense Entry
      </button>
      <button
        onClick={() => setActiveTab('weekly')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${activeTab === 'weekly'
          ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
      >
        Weekly Records
      </button>
      <button
        onClick={() => setActiveTab('monthly')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${activeTab === 'monthly'
          ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
      >
        Monthly Records
      </button>
      <button
        onClick={() => setActiveTab('overall')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${activeTab === 'overall'
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
          <div className="max-w-6xl mx-auto flex items-start gap-3 animate-fadeIn">

            {/* Master/Detail edit-scope widget — small vertical block on the LEFT SIDE of the
                page, outside the toolbar row (per the user, 2026-08-31), mirroring Receipts' own.
                Whichever radio is selected decides what becomes editable while an existing draft
                line is pulled back into the strip: Master unlocks only the header (Date/Remarks),
                Detail unlocks only the entry strip and the entries table's Edit/Delete — see
                masterFieldsLocked/detailFieldsLocked above. Both radios stay enabled always; they
                only have any effect once mode is 'edit'. */}
            <div
              className="shrink-0 sticky top-4 p-3 bg-white border rounded-xl text-sm"
              style={{ width: 84, borderColor: 'var(--border-color)' }}
              data-no-print
            >
              <div className="font-semibold text-slate-700 text-xs uppercase tracking-wider mb-2">
                Edit Scope
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer">
                  <input
                    type="radio"
                    name="expense-edit-scope"
                    checked={editScope === 'master'}
                    onChange={() => setEditScope('master')}
                  />
                  Master
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer">
                  <input
                    type="radio"
                    name="expense-edit-scope"
                    checked={editScope === 'detail'}
                    onChange={() => setEditScope('detail')}
                  />
                  Detail
                </label>
              </div>
            </div>

            <div className="flex-1 min-w-0 max-w-5xl relative">

            {/* The left-hand "Pending Posting" panel that used to live here was removed
                226-08-27 at the user's request, same as Receipts: Payments should read like Sale
                Bill, with the voucher and its entries in the main area rather than as cards off
                to one side. Reaching another pending voucher is now the toolbar's
                First/Prev./Next/Last, with the Posted/Unposted dropdown choosing which list —
                and "Post All" moved into that same toolbar. */}

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
                Receipts. Done/Update is a plain button now, not a form submit — Enter (the form's
                own onSubmit) and Done diverge on purpose, see their own comments above. */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
              <div className="flex flex-wrap items-center gap-0.5">
                {/* Update (editing a line, or the header via Edit + Master scope) just commits
                    that one correction and stays on the open voucher, same as Enter — only Done
                    (a fresh line) finishes the whole voucher and starts a new one (per the user,
                    2026-08-30/2026-08-31 follow-ups). */}
                {!isViewMode && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (isHeaderEditing) {
                        if (await commitHeaderEdit()) clearEntryRow();
                      } else if (mode === 'edit') {
                        if (await commitEntryLine()) clearEntryRow();
                      } else {
                        await handleDoneButton();
                      }
                    }}
                    title={isHeaderEditing ? 'Update Voucher Header' : mode === 'edit' ? 'Update Entry' : 'Done — finish this voucher and start a new one'}
                    className="toolbar-btn"
                  >
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
                {/* Edit — the only way to unlock the voucher header (Date/Remarks) again once a
                    voucher exists; per-row Edit on a line still exists separately for detail
                    lines. Lands focus on the first field of whichever scope is picked. Per the
                    user, 2026-08-31. */}
                <button
                  type="button"
                  onClick={() => {
                    setMode('edit');
                    if (editScope === 'master' && voucher) {
                      // Seed the local editable copies from the voucher's own values so the
                      // fields show the right starting point the moment they unlock — the value
                      // binding below switches to these while isHeaderEditing.
                      setDate(voucher.voucher_date);
                      setVoucherRemarks(voucher.remarks ?? '');
                    }
                    if (editScope === 'detail') focusFirstEntryField();
                    else requestAnimationFrame(() => firstFieldRef.current?.focus());
                  }}
                  disabled={!voucher || voucher.status === 'POSTED'}
                  title="Edit — unlock the voucher header or entry strip, per the Edit Scope selected"
                  className="toolbar-btn"
                >
                  <Edit size={20} strokeWidth={2.5} className="text-sky-600" />
                  <span>Edit</span>
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
                {/* Moved here from the removed Pending Posting panel. */}
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
              </div>

              {/* Unposted (default) = add/post new vouchers; Posted = browse already-posted ones
                  (per the user, 2026-08-30). */}
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

              {/* Post All's outcome — stays until dismissed, since the failures are the point.
                  Previously lived in the removed Pending Posting panel. */}
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



            {/* Entry Form Card */}
            <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm" data-no-print>

              <form id="expense-entry-form" onSubmit={handleEntrySubmit} className="flex flex-col gap-4">
                {/* Hidden submit target for the app-wide G-01 rule (see fieldNav.ts#findSubmitButton)
                    — it looks for a type="submit" button to click when Enter lands on the form's
                    last field, so Enter can commit-this-line-and-stay-open (handleEntrySubmit) even
                    though the visible Done/Update button below is a plain type="button" with its
                    own, different click behavior (finish the whole voucher). */}
                <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
                {/* Row 1 — Date, System Voucher No. (C.Book No), Remarks */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-1">Date</label>
                    <input
                      ref={firstFieldRef}
                      type="date"
                      value={voucher && !isHeaderEditing ? voucher.voucher_date : date}
                      disabled={masterFieldsLocked}
                      onChange={e => setDate(e.target.value)}
                      className="soleria-input py-1.5 text-xs font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-1">System Voucher No. (C.Book No)</label>
                    <input
                      type="text"
                      value={voucher ? `#${voucher.voucher_no}` : (startedNew ? `#${nextVoucherNo} (pending)` : '')}
                      disabled
                      readOnly
                      className="soleria-input py-1.5 text-xs bg-slate-100 text-slate-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-1">Remarks</label>
                    <input
                      type="text"
                      value={voucher && !isHeaderEditing ? (voucher.remarks ?? '') : voucherRemarks}
                      disabled={masterFieldsLocked}
                      onChange={e => setVoucherRemarks(e.target.value)}
                      placeholder="Applies to the whole voucher (each payment has its own narration below)"
                      className="soleria-input py-1.5 text-xs"
                    />
                  </div>
                </div>

                {/* Row 2 — Select Account & Narration in the SAME line */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-1">
                      Select Account (Who to Pay) <span className="text-red-500 font-bold">*</span>
                    </label>
                    <div className="relative" ref={firstEntryFieldWrapRef}>
                      <input
                        ref={accountTriggerRef}
                        type="text"
                        data-field-nav="true"
                        disabled={isViewMode || detailFieldsLocked}
                        value={accountSearchText}
                        onChange={e => setAccountSearchText(e.target.value)}
                        onKeyDown={handleAccountTriggerKeyDown}
                        placeholder="Type an account name, or press Enter to search..."
                        className="soleria-input py-1 pr-9 text-xs font-medium"
                      />
                      <button
                        type="button"
                        disabled={isViewMode || detailFieldsLocked}
                        onClick={openAccountModal}
                        title="Browse all accounts"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <ChevronDown size={16} />
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
                        initialSearch={accountModalSeed}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-1">Narration</label>
                    <input
                      type="text"
                      value={remarks}
                      disabled={isViewMode || detailFieldsLocked}
                      onChange={e => setRemarks(e.target.value)}
                      placeholder="Enter narration..."
                      className="soleria-input py-1 text-xs"
                    />
                  </div>
                </div>

                {/* Row 3 — Payment Method Dropdown, Cheque No, Cheque Date, Amount Paid (Always shown by default) */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-1">Payment Method</label>
                    <select
                      value={paymentMode}
                      data-field-nav="true"
                      disabled={isViewMode || detailFieldsLocked}
                      onChange={e => selectPaymentMode(e.target.value as ExpensePaymentMode)}
                      onKeyDown={handlePaymentModeKeyDown}
                      className="soleria-input py-1 text-xs font-semibold cursor-pointer"
                      title="Press 'c' to cycle Cash -> Cheque -> Cheque Endorsement, or 'o' for Online"
                    >
                      <option value="CASH">Cash</option>
                      <option value="CHEQUE_ISSUED">Cheque</option>
                      <option value="CHEQUE_ENDORSED">Cheque Endorsement</option>
                      <option value="ONLINE">Online</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-1">
                      Cheque No. {(paymentMode === 'CHEQUE_ISSUED' || paymentMode === 'CHEQUE_ENDORSED') && <span className="text-red-500 font-bold">*</span>}
                    </label>
                    <input
                      type="text"
                      value={issuedChequeNo}
                      disabled={isViewMode || detailFieldsLocked || (paymentMode !== 'CHEQUE_ISSUED' && paymentMode !== 'CHEQUE_ENDORSED')}
                      onChange={e => setIssuedChequeNo(e.target.value)}
                      placeholder="e.g. 109283"
                      className="soleria-input py-1 text-xs font-mono disabled:bg-slate-100/60 disabled:text-slate-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-900 mb-1">
                      Cheque Date {(paymentMode === 'CHEQUE_ISSUED' || paymentMode === 'CHEQUE_ENDORSED') && <span className="text-red-500 font-bold">*</span>}
                    </label>
                    <input
                      type="date"
                      value={issuedChequeDate}
                      disabled={isViewMode || detailFieldsLocked || (paymentMode !== 'CHEQUE_ISSUED' && paymentMode !== 'CHEQUE_ENDORSED')}
                      onChange={e => setIssuedChequeDate(e.target.value)}
                      className="soleria-input py-1 text-xs disabled:bg-slate-100/60 disabled:text-slate-400"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <label className="block text-xs font-bold text-slate-900 truncate">Amount Paid (PKR)</label>
                      {baId && (
                        <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500 shrink-0">
                          <AccountBalanceTooltip baId={previewBaId ?? Number(baId)} refreshKey={balanceRefreshKey} hideLabel className="py-0 px-1 text-[10px] shadow-none border-none bg-transparent" />
                        </div>
                      )}
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={amount || ''}
                      disabled={isViewMode || detailFieldsLocked}
                      onChange={e => setAmount(Math.max(0, parseInt(e.target.value) || 0))}
                      placeholder="Enter amount in Rs..."
                      className="soleria-input py-1 text-xs font-semibold font-mono"
                    />
                  </div>
                </div>

                {/* Row 4 — Paid-From Bank/Cheque Account & Optional Notes in the SAME line */}
                {(paymentMode === 'ONLINE' || paymentMode === 'CHEQUE_ISSUED' || paymentMode === 'CHEQUE_ENDORSED') && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-900 mb-1">
                        {paymentMode === 'ONLINE'
                          ? 'Paid From Account'
                          : paymentMode === 'CHEQUE_ISSUED'
                            ? 'Paid From Bank Account'
                            : 'Select Cheque to Endorse'} <span className="text-red-500 font-bold">*</span>
                      </label>
                      <div className="relative">
                        <input
                          ref={sourceAccountTriggerRef}
                          type="text"
                          data-field-nav="true"
                          disabled={isViewMode || detailFieldsLocked}
                          value={sourceAccountSearchText}
                          onChange={e => setSourceAccountSearchText(e.target.value)}
                          onKeyDown={handleSourceAccountTriggerKeyDown}
                          placeholder={
                            paymentMode === 'CHEQUE_ENDORSED'
                              ? 'Type cheque no or press Enter to search...'
                              : 'Type bank/account name or press Enter to search...'
                          }
                          className="soleria-input py-1 pr-9 text-xs font-medium"
                        />
                        <button
                          type="button"
                          disabled={isViewMode || detailFieldsLocked}
                          onClick={openSourceAccountModal}
                          title="Browse all accounts/cheques"
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-900 mb-1">
                        {paymentMode === 'ONLINE' ? 'Online Reference Code / Details' : 'Details / Optional Notes'}
                      </label>
                      <input
                        type="text"
                        value={details}
                        disabled={isViewMode || detailFieldsLocked}
                        onChange={e => setDetails(e.target.value)}
                        placeholder={paymentMode === 'ONLINE' ? 'e.g. Alfa ref 980124' : 'Optional notes...'}
                        className="soleria-input py-1 text-xs"
                      />
                    </div>
                  </div>
                )}

                <SearchModal
                  isOpen={isSourceAccountModalOpen}
                  title={
                    paymentMode === 'ONLINE'
                      ? 'Select Paid-From Account'
                      : paymentMode === 'CHEQUE_ISSUED'
                        ? 'Select Drawn-On Bank Account'
                        : 'Select Cheque to Endorse'
                  }
                  options={paymentMode === 'CHEQUE_ENDORSED' ? endorsableCheques : bankOptions}
                  value={paymentMode === 'CHEQUE_ENDORSED' ? chequeId : bankId}
                  onSelect={val => {
                    if (paymentMode === 'CHEQUE_ENDORSED') {
                      handleSelectEndorsedCheque(val);
                    } else {
                      setBankId(val);
                    }
                    setIsSourceAccountModalOpen(false);
                    requestAnimationFrame(() => focusNextField(sourceAccountTriggerRef.current));
                  }}
                  onClose={() => setIsSourceAccountModalOpen(false)}
                  searchPlaceholder={
                    paymentMode === 'CHEQUE_ENDORSED'
                      ? 'Search cheque number or status...'
                      : 'Search account or bank name...'
                  }
                  initialSearch={sourceAccountModalSeed}
                />
              </form>

              {/* ── PN-01: the voucher's committed entry lines ──────────────────────────────────
                  Merged into the SAME card as the entry form, not a separate box below it — more
                  room to actually show entries. Always rendered — even with zero lines — matching
                  Purchase's own articles box, which shows its empty state ("No articles added
                  yet...") rather than disappearing entirely (per the user, 2026-08-26). */}
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
                      {voucherLines.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-6 text-center text-slate-400 text-sm">
                            No payments added yet — fill the fields above and press Enter.
                          </td>
                        </tr>
                      ) : voucherLines.map(line => (
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
                                  {/* Detail-scope interaction — locked while mid-correction of a
                                      DIFFERENT line with Master selected (2026-08-31), same
                                      mirror-image gate as the entry strip fields above. */}
                                  <button
                                    type="button"
                                    onClick={() => { if (!detailFieldsLocked) handleEditLine(line); }}
                                    disabled={detailFieldsLocked}
                                    title={detailFieldsLocked ? 'Select Detail to edit voucher entries' : 'Pull this entry back into the form to correct it'}
                                    className="text-slate-500 hover:text-slate-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                  >
                                    <Edit size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { if (detailFieldsLocked) return; setDeleteTarget(line.draft_id != null
                                      ? { kind: 'draft', id: line.draft_id, amount: Number(line.amount) }
                                      : { kind: 'expense', id: line.expense_id as number, amount: Number(line.amount) }); }}
                                    disabled={detailFieldsLocked}
                                    title={detailFieldsLocked ? 'Select Detail to delete voucher entries' : 'Delete this entry (asks for your password)'}
                                    className="text-rose-500 hover:text-rose-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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

                {/* PN-03: ref-pic's small boxed totals — Total Cheque/Online/Cash on the bottom
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
            </div>
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
