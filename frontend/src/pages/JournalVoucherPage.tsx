import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency, useApp } from '@/context/AppContext';
import { exportRowsToExcel } from '@/lib/export';
import AppLayout from '@/components/AppLayout';
import DocumentToolbar from '@/components/DocumentToolbar';
import RowActions from '@/components/RowActions';
import SearchModal from '@/components/SearchModal';
import { focusNextField } from '@/lib/fieldNav';
import * as api from '@/lib/api';
import type {
  BusinessAccountRow, JournalVoucherRow, JournalVoucherLineInput, JournalVoucherCreateInput,
  UnpostedJournalVoucherRow, PostAllResult,
} from '@/lib/api';
import { formatDate, getTodayDate, toDateInputValue } from '@/lib/utils';
import { Search, BookText, ChevronDown } from 'lucide-react';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import PageToasts from '@/components/PageToasts';
import AccountBalanceTooltip from '@/components/AccountBalanceTooltip';
import { usePersistentField, useClearPageDraft, useNewDocGate } from '@/hooks/usePersistentField';
import EditScopeRadios from '@/components/EditScopeRadios';
import { useAutoEditScope } from '@/hooks/useAutoEditScope';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';
import { amountToDebitCredit, debitCreditToAmount } from '@/lib/journalVoucherMath';

/**
 * Journal Voucher — a real multi-line double-entry journal (legacy "Journal Entry" screen): N
 * lines, each against its own business account, each a debit OR a credit, that together must net
 * to zero. There is no fixed counter-account — every line names a real account, so each one's own
 * ledger (the existing Ledger screen) shows exactly what a JV moved through it and why.
 */

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function newLineUid() {
  return 'jvl_' + Date.now() + Math.random().toString(36).slice(2, 7);
}

interface UiLine {
  uid: string;
  baId: string;
  // What's currently typed/shown in this row's own Account field — lives on the row itself
  // (rather than a separate uid-keyed Record) so each row's typed text is independent and never
  // gets clobbered by another row's re-render, same idea as every other typable+SearchModal field
  // in the app, just per-row instead of a single page-level field.
  baSearchText: string;
  debit: number;
  credit: number;
  narration: string;
}

// UiLine (above) is now only the COMMITTED shape, read-only in the grid and hydrated by loadJv —
// new/edited lines are built by handleCommitLine from the entry strip's own shape below instead.

// The entry strip's own "one line being typed" shape — a single signed Amount, not separate
// Debit/Credit inputs (see the entry-strip comment further down for the sign convention).
interface EntryLine {
  baId: string;
  baSearchText: string;
  amount: number;
  narration: string;
}

function emptyEntry(): EntryLine {
  return { baId: '', baSearchText: '', amount: 0, narration: '' };
}

export default function JournalVoucherPage() {
  const { dispatch } = useApp();
  // New button + "cursor waits on New" (per the user, 2026-09-18): after a Post / Post All, and
  // whenever the form drops to the locked blank (useNewDocGate's awaitingNew), focus goes to New so
  // Enter starts the next document. Two frames, so a reset's own focus-first-field attempt (queued
  // first, and a no-op on the locked form) never wins. Declared first — Post handlers use it.
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const focusNewButton = () => requestAnimationFrame(() => requestAnimationFrame(() => newButtonRef.current?.focus()));
  const [accounts, setAccounts] = useState<BusinessAccountRow[]>([]);
  const [vouchers, setVouchers] = useState<JournalVoucherRow[]>([]);
  const [lookupError, setLookupError] = useState('');

  // JV Ledger — search + status filter, both applied server-side (search matches the header
  // OR any line: account name/code, per-line narration, debit/credit amount — see
  // journalVouchers.repository.js#list) so it finds a JV "from any detail", not just reason/number.
  const [jvSearch, setJvSearch] = useState('');
  const [jvStatusFilter, setJvStatusFilter] = useState<'all' | 'CONFIRMED' | 'DRAFT'>('all');

  const refresh = useCallback(async () => {
    const res = await api.journalVouchers.list({
      search: jvSearch.trim() || undefined,
      status: jvStatusFilter === 'all' ? undefined : jvStatusFilter,
    });
    if (res.ok) setVouchers(res.data);
    else setLookupError('Failed to load journal vouchers: ' + res.error.message);
  }, [jvSearch, jvStatusFilter]);

  // P-03/SB-06: JVs saved but not yet posted, so a run can be entered first and posted together.
  const [unpostedJvs, setUnpostedJvs] = useState<UnpostedJournalVoucherRow[]>([]);
  const [postAllBusy, setPostAllBusy] = useState(false);
  const [postAllResult, setPostAllResult] = useState<PostAllResult<'jv_id'> | null>(null);

  const refreshUnposted = useCallback(async () => {
    const res = await api.journalVouchers.listUnposted();
    if (res.ok) setUnpostedJvs(res.data);
    return res.ok ? res.data : null;
  }, []);

  useEffect(() => {
    (async () => {
      // excludeClosed per the user (2026-09-17): a deleted (closed) account must not be
      // selectable on a JV line, on top of no longer appearing in Setup's own list.
      const ba = await api.listBusinessAccounts({ excludeClosed: true });
      if (ba.ok) setAccounts(ba.data); else setLookupError('Failed to load accounts: ' + ba.error.message);
    })();
    // G-06 (changes-14-09-26.md, 2026-09-15): zero unposted vouchers on open must land on a fresh
    // blank entry, not wherever the session that closed the window left the screen pointed.
    // Originally gated on `mode === 'view'`, which misses a real case reported by the user
    // (2026-09-16, found on SaleBillPage's own equivalent bug): an edit-on-a-posted-record flow can
    // leave `mode: 'edit'` while the loaded record is still posted, so `mode === 'view'` alone
    // under-triggers. `isPosted` (derived from the persisted `status`) is the direct, unambiguous
    // signal — true iff an actual posted record is loaded, in EITHER 'view' or 'edit' mode; only
    // `handleNew()` ever resets `status` to 'DRAFT', so it can never be true while there's genuine
    // unsaved new-document work to protect.
    refreshUnposted().then(data => {
      if (data && data.length === 0 && isPosted) handleNew();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshUnposted]);

  // Debounced so typing a search term doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  const handlePostAll = async () => {
    setPostAllBusy(true);
    const res = await api.journalVouchers.postAll();
    setPostAllBusy(false);
    if (!res.ok) { fail('Failed to post all: ' + res.error.message); return; }
    setPostAllResult(res.data);
    refresh();
    refreshUnposted();
    refreshNav();
    // Same "ready for the next one" reset as the toolbar's own Post (per the user, 2026-08-19):
    // whatever was on screen is done either way — either it just posted (so showing it as if
    // still pending would be stale) or it wasn't part of this run and stays saved regardless.
    const workingDate = date;
    handleNew();
    setDate(workingDate);
    focusNewButton();
  };

  // Recorded Journal Vouchers moved to its own tab (was inline below the live entry form on the
  // same page — every JV ever recorded rendering directly under a live entry form doesn't scale
  // and pushed the whole page well past one screen). Mirrors PurchasePage/SaleBillPage.
  const [activeTab, setActiveTab] = useState<'entry' | 'records'>('entry');

  // ── entry form ──
  //
  // mode/jvId/status are persisted alongside the field values, NOT plain useState — see
  // SaleBillPage's own comment for the full reasoning. Short version: leaving them out lost track
  // of WHICH record was on screen after a page switch (no System No.), and the earlier "persist
  // the id and re-fetch on mount" attempt was worse still — it overwrote the user's unsaved edits
  // with the last-saved copy and reopened in 'view' mode, which disables Save.
  const [mode, setMode] = usePersistentField<'new' | 'edit' | 'view'>('journal-voucher', 'mode', 'new');
  // The posted/unposted/System No. rule (per the user, 2026-09-18) — see useNewDocGate for all of
  // it. hasPageDraftAtMount gates the auto-open further down (only genuine unsaved typing skips
  // it); hasClickedNew gates the No. preview and the awaitingNew lock; only New calls markNewClicked.
  const { hasRealDraftAtMount: hasPageDraftAtMount, hasClickedNew, setHasClickedNew, markNewClicked } =
    useNewDocGate('journal-voucher', ['reason', 'lines']);
  const [jvId, setJvId] = usePersistentField<number | null>('journal-voucher', 'jvId', null);
  // The system-generated Number (JV-01, changes-14-09-26.md) — distinct from jvId (the internal
  // identity used for API calls). Persisted alongside jvId/status/mode for the same reason.
  const [voucherNo, setVoucherNo] = usePersistentField<string | null>('journal-voucher', 'voucherNo', null);
  const [status, setStatus] = usePersistentField<'CONFIRMED' | 'DRAFT'>('journal-voucher', 'status', 'DRAFT');
  // Master/Detail edit-scope radio, per the user 2026-08-31: with a JV already unlocked via the
  // toolbar's Edit, this further splits WHICH half becomes editable — the header (Master) or the
  // entry strip/grid (Detail), never both at once. Only bites once mode is actually 'edit';
  // pre-picking it doesn't change anything until Edit is clicked.
  // Persisted, not plain useState: mode/svId/status already are, for the exact reason —
  // losing track of state across a page switch. editScope was the one piece left out, so
  // returning to an in-progress 'edit' draft always reset it to 'master', locking the
  // Detail half (entry strip + grid) shut even when that's what had been unlocked and typed
  // into — reported by the user (2026-09-04) as "all the buttons are disable except New".
  const [editScope, setEditScope] = usePersistentField<'master' | 'detail'>('journal-voucher', 'editScope', 'master');
  // Keeps the radios pointing at whichever half is being worked in — see the hook.
  const autoEditScope = useAutoEditScope(setEditScope);
  // A New Journal Voucher's own in-progress fields persist across switching pages AND an app
  // restart (usePersistentField — see src/hooks/usePersistentField.ts). Deliberately NOT applied
  // to mode/jvId/status — an already-saved JV loaded for view/edit is safely re-openable by id at
  // any time, so caching it risks showing a stale copy instead; only unsaved "new" work is ever at
  // risk of being lost for good.
  const clearJournalVoucherDraft = useClearPageDraft('journal-voucher');
  const [date, setDate] = usePersistentField('journal-voucher', 'date', getTodayDate());
  const [reason, setReason] = usePersistentField('journal-voucher', 'reason', '');
  const [lines, setLines] = usePersistentField<UiLine[]>('journal-voucher', 'lines', []);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const isViewMode = mode === 'view';
  const isPosted = status === 'CONFIRMED';
  // Derived from editScope — applied to every master/detail field's `disabled` below (2026-08-31).
  // A blank voucher reached any way other than New (first open with nothing unposted, after Post,
  // Post All, a delete…) stays locked — no System No. may be allocated without New (2026-09-18).
  const awaitingNew = mode === 'new' && voucherNo == null && !hasClickedNew;
  useEffect(() => { if (awaitingNew) focusNewButton(); }, [awaitingNew]);
  const masterLocked = awaitingNew || (mode === 'edit' && editScope !== 'master');
  const detailLocked = awaitingNew || (mode === 'edit' && editScope !== 'detail');

  const accountOptions = useMemo(
    // Business accounts show their PARENT chart account inline, appended to the same field with an em-dash rather than in a field of its own (2026-08-30, per the user). Matches how ReceiptsPage's own account picker already reads. `ac_name` is joined in by businessAccounts.repository.js's list().
    // searchText excludes the parent chart account name — typing it must not surface every
    // account under it (changes-14-09-26.md G-09, per the client 2026-09-14).
    () => accounts.map(a => ({
      value: String(a.ba_id),
      label: `${a.name} (${a.code})${a.ac_name ? ` — ${a.ac_name}` : ''}`,
      searchText: `${a.name} (${a.code})`,
    })),
    [accounts]
  );

  // With Detail scope selected on an already-open, unposted voucher, New means "add another line
  // to THIS voucher" — the exact reason Un Post now lands straight in edit mode (see handleUnpost's
  // own comment) — not "abandon it and start over." Only Master scope (or no voucher open yet)
  // gets the full reset below. Same reset shape handleCommitLine already uses after committing a
  // line, since the outcome is identical: an empty, focused entry strip, voucher untouched.
  const handleNew = () => {
    if (mode === 'edit' && editScope === 'detail' && jvId != null) {
      setEntry(emptyEntry());
      setEditingIndex(null);
      setSelectedIndex(null);
      setErrorMsg('');
      requestAnimationFrame(() => entryAccountTriggerRef.current?.focus());
      return;
    }
    setMode('new'); setHasClickedNew(false); setJvId(null); setVoucherNo(null); setStatus('DRAFT');
    setDate(getTodayDate()); setReason('');
    setLines([]);
    setEntry(emptyEntry());
    setEditingIndex(null);
    setSelectedIndex(null);
    setLastEnteredIndex(null);
    setErrorMsg('');
    setEditScope('master');
    clearJournalVoucherDraft();
    // Explicit focus, not just a mode-change effect: clicking New while already on a blank/new JV
    // (mode is already 'new') wouldn't otherwise re-trigger any such effect, so focus would stay
    // wherever it was (same fix as SaleBillPage/SaleReturnPage's own handleNew).
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };

  // ── Entry strip (ref-pic jv2.0's own bound-record pattern, 2026-08-26 per the user: "we select
  // the account... it has its own box as in the ref pic") — ONE editable A/C Code/Amount/Narration
  // row, NOT one editable row per grid line. A single signed Amount replaces separate Debit/Credit
  // inputs: positive types a debit (NAAM), negative types a credit (JAMMA) — ACC-01
  // (changes-14-09-26.md, confirmed by the client 2026-09-14): "+ve -> DEBIT, -ve -> CREDIT" is the
  // one sign rule for every account type, no exceptions — this superseded the original 2026-08-26
  // convention (positive = credit), which this screen had implemented backwards relative to that
  // rule. Enter on Narration (the strip's last field) commits the line into `lines` — appending,
  // or replacing `editingIndex`
  // when a grid row was clicked to re-open it — then always clears the strip and refocuses A/C
  // Code for the next line (per the user: "it goes to the first field of account code... but the
  // master details remain same" — Date/Reason above are never touched by this).
  const [entry, setEntry] = usePersistentField<EntryLine>('journal-voucher', 'entry', emptyEntry());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  // G-08 (changes-14-09-26.md, 2026-09-15): a click on a detail row must produce no visible change
  // at all — no edit load, no highlight. It only records which row Delete/Edit Row will act on
  // internally; `editingIndex` (the actually-loaded-for-editing row, and the only thing that
  // drives the blue highlight) is set exclusively by the Edit Row button now, never by a row click
  // directly. Cleared whenever `editingIndex` takes over so the two never point at different rows.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // G-05 (changes-14-09-26.md, 2026-09-15): the row most recently ADDED or UPDATED via the entry
  // strip — a pure position indicator (the ▶ gutter marker below), never a selection. Deliberately
  // separate from `selectedIndex`/`editingIndex` above: G-05's own text is explicit that the
  // pointer "must not look like, or behave as, the highlight described in G-08" — a click never
  // moves it, only committing a row does.
  const [lastEnteredIndex, setLastEnteredIndex] = useState<number | null>(null);
  // JV-02 (changes-14-09-26.md, 2026-09-15): the entry strip's own read-only balance readout for
  // the picked A/C Code (ref-pic jv2.0.jpeg's second boxed field, under the Amount box) — same
  // `AccountBalanceTooltip` shared component Receipts/Expenses already use next to their own
  // account pickers. Bumped after any mutation that can move this account's own ledger balance
  // (save/post/unpost/delete), matching the convention those two pages already use.
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  useEffect(() => {
    if (lastEnteredIndex != null) rowRefs.current[lastEnteredIndex]?.scrollIntoView({ block: 'nearest' });
  }, [lastEnteredIndex]);
  const entryAccountTriggerRef = useRef<HTMLInputElement>(null);
  const [isEntryAccountModalOpen, setIsEntryAccountModalOpen] = useState(false);
  const [entryAccountModalSeed, setEntryAccountModalSeed] = useState('');

  const openEntryAccountModal = () => {
    if (isViewMode || detailLocked) return;
    setEntryAccountModalSeed('');
    setIsEntryAccountModalOpen(true);
  };
  const handleEntryAccountKeyDown = (e: React.KeyboardEvent) => {
    // stopPropagation on every branch, not just preventDefault — otherwise this keydown keeps
    // bubbling past the trigger up to window-level listeners (AppLayout's own G-01 field-walk),
    // which would act on it at the same time the modal opens. Same reasoning as SearchModal's own
    // internal keydown handling.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openEntryAccountModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isViewMode || detailLocked) return;
      setEntryAccountModalSeed(entry.baSearchText);
      setIsEntryAccountModalOpen(true);
    }
  };
  const handleEntryAccountSelect = (val: string) => {
    const acc = accounts.find(a => String(a.ba_id) === val);
    setEntry(prev => ({ ...prev, baId: val, baSearchText: acc ? `${acc.name} (${acc.code})` : '' }));
    setIsEntryAccountModalOpen(false);
    requestAnimationFrame(() => focusNextField(entryAccountTriggerRef.current));
  };

  const handleCommitLine = () => {
    if (!entry.baId) { setErrorMsg('Select an account before adding the line.'); return; }
    if (entry.amount === 0) { setErrorMsg('Amount can\'t be 0 — positive for a debit, negative for a credit.'); return; }
    setErrorMsg('');
    const committed: UiLine = {
      uid: editingIndex != null ? lines[editingIndex].uid : newLineUid(),
      baId: entry.baId,
      baSearchText: entry.baSearchText,
      // ACC-01: +ve -> DEBIT, -ve -> CREDIT (see lib/journalVoucherMath.ts's own header for why
      // this is a separate, unit-tested function rather than inlined here).
      ...amountToDebitCredit(entry.amount),
      narration: entry.narration,
    };
    const pointerIdx = editingIndex != null ? editingIndex : lines.length;
    if (editingIndex != null) {
      setLines(prev => prev.map((l, i) => i === editingIndex ? committed : l));
    } else {
      setLines(prev => [...prev, committed]);
    }
    setLastEnteredIndex(pointerIdx);
    setEditingIndex(null);
    setSelectedIndex(null);
    setEntry(emptyEntry());
    requestAnimationFrame(() => entryAccountTriggerRef.current?.focus());
  };

  function handleEntryLastFieldKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    handleCommitLine();
  }

  // Loads an already-committed line back into the strip for editing (grid row click) — the signed
  // Amount is reconstructed from whichever side actually holds a value. ACC-01: debit -> +ve,
  // credit -> -ve (the exact inverse of handleCommitLine's own split above).
  const loadLineIntoEntry = (idx: number) => {
    const row = lines[idx];
    setEntry({ baId: row.baId, baSearchText: row.baSearchText, amount: debitCreditToAmount(row.debit, row.credit), narration: row.narration });
    setEditingIndex(idx);
    setSelectedIndex(null);
    requestAnimationFrame(() => entryAccountTriggerRef.current?.focus());
  };

  // G-08: now the Edit Row toolbar button's handler, not the row's own onClick — a row click just
  // records `selectedIndex` (see the grid below), and this only runs once the user presses Edit Row.
  const handleRowClick = (idx: number) => {
    // Detail locked (scope is Master while already editing) — grid rows stay inert, per the
    // Master/Detail edit-scope split (2026-08-31). New/view-mode behavior is untouched.
    if (mode === 'edit' && editScope !== 'detail') return;
    // JV-04 (changes-14-09-26.md, 2026-09-15): a posted voucher must never enter edit mode from a
    // row click — the toolbar's own Edit button is already disabled once posted
    // (`disabled={!isViewMode || jvId == null || isPosted}`), but this bypassed that guard, so
    // clicking a row on a POSTED JV would flip mode to 'edit', which in turn enabled the Delete
    // and Save buttons. Deleting a row then "worked" visually but Save always failed with
    // POSTED_LOCK ("Unpost the Journal Voucher before editing") — the reported broken delete.
    if (isViewMode) {
      if (isPosted) return;
      setMode('edit');
    }
    loadLineIntoEntry(idx);
  };

  const handleEditSelectedRow = () => {
    if (selectedIndex != null) handleRowClick(selectedIndex);
  };

  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
    if (editingIndex === idx) {
      setEditingIndex(null);
      setSelectedIndex(null);
      setEntry(emptyEntry());
    } else if (editingIndex != null && idx < editingIndex) {
      setEditingIndex(editingIndex - 1);
    }
    setSelectedIndex(null);
    // JV-04 (changes-14-09-26.md, 2026-09-15): deleting the POINTED row repositions the G-05
    // pointer to whatever row now takes its place — or the new last row if the deleted one was
    // last — rather than just clearing it, per this item's own explicit acceptance detail (every
    // other page's G-05 rollout clears the pointer here instead, since G-05's own spec didn't
    // require a reposition; JV-04 does).
    const newLength = lines.length - 1;
    if (lastEnteredIndex === idx) {
      setLastEnteredIndex(newLength === 0 ? null : Math.min(idx, newLength - 1));
    } else if (lastEnteredIndex != null && idx < lastEnteredIndex) {
      setLastEnteredIndex(lastEnteredIndex - 1);
    }
  };

  // Toolbar's Delete is dual-purpose, same convention as SaleBillPage/SaleReturnPage: a line
  // loaded for editing (editingIndex) takes priority; otherwise a merely-clicked row
  // (selectedIndex, G-08) is the target; with neither, it's the whole-JV delete (currently-open
  // unposted voucher).
  // Toolbar Delete ALWAYS deletes the whole document now (per the user, 2026-09-20: a new user
  // could not know a row had to be deselected first). Deleting a single row is the row's own
  // Delete button in the grid — one meaning per button.
  const handleDeleteAction = () => {
    if (jvId == null || isPosted) return;
    pendingDeleteJvId.current = jvId;
    setIsPasswordModalOpen(true);
  };

  const totals = useMemo(() => {
    const totalDebit = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const totalCredit = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
    return { totalDebit, totalCredit, difference: round2(totalDebit - totalCredit) };
  }, [lines]);

  // Net Total must be exactly 0 before Save is even reachable — per the user: "the net total must
  // be 0 if yes we can save it otherwise not".
  const isValid = useMemo(() => {
    if (awaitingNew) return false;
    if (!date) return false;
    if (lines.length < 2) return false;
    if (!lines.every(l => l.baId && ((Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0))) return false;
    return totals.difference === 0;
  }, [awaitingNew, date, lines, totals]);

  const buildPayload = (): JournalVoucherCreateInput | null => {
    if (!date) { setErrorMsg('Please pick a date.'); return null; }
    if (lines.length < 2) { setErrorMsg('A Journal Voucher needs at least 2 lines.'); return null; }
    if (!lines.every(l => l.baId)) { setErrorMsg('Every line needs an account.'); return null; }
    if (!lines.every(l => (Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0)) {
      setErrorMsg('Every line needs a debit or credit amount greater than 0.'); return null;
    }
    if (totals.difference !== 0) {
      setErrorMsg(`Net Total must be 0 — total debit (${totals.totalDebit}) must equal total credit (${totals.totalCredit}).`); return null;
    }
    const payloadLines: JournalVoucherLineInput[] = lines.map(l => ({
      ba_id: Number(l.baId),
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      narration: l.narration.trim() || undefined,
    }));
    return {
      jv_date: date,
      reason: reason.trim() || undefined,
      lines: payloadLines,
    };
  };

  // Save (keep editing) and Done (finish) share one path — `finalize` is the only difference,
  // matching Sale Bill/Purchase, where Save and Done have always been separate buttons
  // (toolbar standardisation, 2026-09-20). Returns the saved id, for Save+Post.
  const doSave = async (finalize: boolean) => {
    // Backstop for the awaitingNew lock.
    if (awaitingNew) { setErrorMsg('Click New to start a voucher first.'); return null; }
    const payload = buildPayload();
    if (!payload) return null;
    const result = mode === 'edit' && jvId != null
      ? await api.journalVouchers.update(jvId, payload)
      : await api.journalVouchers.create(payload);
    if (!result.ok) { fail('Failed to save Journal Voucher: ' + result.error.message); return null; }
    setJvId(result.data.jv_id);
    setVoucherNo(result.data.voucher_no);
    setStatus(result.data.status);
    setErrorMsg('');
    flash('Journal Voucher saved — Post it to update every line\'s ledger.');
    if (finalize) setMode('view');
    clearJournalVoucherDraft();
    refresh();
    refreshUnposted();
    refreshNav();
    setBalanceRefreshKey(k => k + 1);
    return result.data.jv_id;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await doSave(true);
  };

  // Cancel Edit — drops back to the saved copy, same as Purchase's own Cancel (2026-09-20).
  const handleCancelEdit = async () => {
    if (jvId == null) { handleNew(); return; }
    await loadJv(jvId);
    setMode('view');
  };

  // Save+Post in one click, same as Sale Bill's (2026-09-20).
  const handleSaveAndPost = async () => {
    const savedId = await doSave(true);
    if (savedId == null) return;
    await handlePost(savedId);
    focusNewButton();
  };

  // Posting finishes this JV and readies the form for the next one — same convention as Sale
  // Bill/Purchase's own "clear straight back to blank so the next can be typed immediately" (per
  // the user, 2026-08-26: "when I press the post... auto focus goes to the date alike... new
  // bill"). Reuses handleNew() (which already focuses Date itself) rather than repeating its
  // field list, then restores the working date — handleNew() snaps to today, and a run of JVs
  // entered for an earlier date would otherwise reset on every one.
  // `idOverride` lets Save+Post post the voucher it has just saved, before the id state has
  // re-rendered (toolbar standardisation, 2026-09-20).
  const handlePost = async (idOverride?: number) => {
    const postId = idOverride ?? jvId;
    if (postId == null) return;
    const res = await api.journalVouchers.post(postId);
    if (!res.ok) { fail('Failed to post: ' + res.error.message); return; }
    flash('Journal Voucher posted — every line\'s ledger updated.');
    refresh();
    refreshUnposted();
    refreshNav();
    setBalanceRefreshKey(k => k + 1);
    const workingDate = date;
    handleNew();
    setDate(workingDate);
    focusNewButton();
  };

  const handleUnpost = async () => {
    if (jvId == null) return;
    const res = await api.journalVouchers.unpost(jvId);
    if (!res.ok) { fail('Failed to unpost: ' + res.error.message); return; }
    setStatus(res.data.status);
    flash('Journal Voucher unposted.');
    refresh();
    refreshUnposted();
    refreshNav();
    setBalanceRefreshKey(k => k + 1);
    // It's a draft again now, so the window follows it back to the Unposted view (per the user,
    // 2026-08-30) rather than staying on Posted looking at a record that no longer belongs there.
    setBrowseFilter('unposted');
    // Land on the editable screen straight away (toolbar standardisation, 2026-09-20) — adding a
    // row to a just-unposted document is the whole reason for unposting it.
    setMode('edit');
  };

  // Listing rows only carry rolled-up totals (line_count/total_debit/total_credit), not the
  // per-line detail — loading a JV always re-fetches the full voucher (with lines) to hydrate the form.
  const loadJv = async (id: number) => {
    const res = await api.journalVouchers.get(id);
    if (!res.ok) { fail('Failed to load Journal Voucher: ' + res.error.message); return; }
    const jv = res.data;
    setJvId(jv.jv_id);
    setVoucherNo(jv.voucher_no);
    setStatus(jv.status);
    setDate(toDateInputValue(jv.jv_date));
    setReason(jv.reason || '');
    setLines((jv.lines || []).map(l => ({
      uid: 'jvl_' + l.line_id,
      baId: String(l.ba_id),
      baSearchText: l.ba_name ? `${l.ba_name} (${l.ba_code})` : '',
      debit: l.debit,
      credit: l.credit,
      narration: l.narration || '',
    })));
    setEntry(emptyEntry());
    setEditingIndex(null);
    setSelectedIndex(null);
    setLastEnteredIndex(null);
    setErrorMsg('');
    setEditScope('master');
    setMode('view');
  };

  const loadRow = (row: JournalVoucherRow) => { loadJv(row.jv_id); setActiveTab('entry'); };



  // Password-gated (verified server-side) — deleting a saved-unposted JV is destructive with no
  // reverse-never-erase trail, same guard level used on Sale Bill/Sale Return/Purchase.
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const pendingDeleteJvId = useRef<number | null>(null);


  const handleDeletePasswordSuccess = async (password: string) => {
    setIsPasswordModalOpen(false);
    const targetId = pendingDeleteJvId.current;
    pendingDeleteJvId.current = null;
    if (targetId == null) return;
    const res = await api.journalVouchers.remove(targetId, password);
    if (!res.ok) { fail('Failed to delete: ' + res.error.message); return; }
    flash('Journal Voucher deleted successfully.');
    if (jvId === targetId) handleNew();
    refresh();
    refreshUnposted();
    refreshNav();
  };

  // Entry card fills whatever vertical space is left in the viewport below it (mirrors
  // SaleBillPage/PurchasePage) — the line-items table (flex-1 inside it) grows into that space,
  // and the outer app window never scrolls (only the table does). Measured via
  // getBoundingClientRect rather than a CSS calc() of fixed chrome heights, since the banners
  // above this form change height dynamically.
  const entryCardRef = useRef<HTMLFormElement>(null);
  const [entryCardHeight, setEntryCardHeight] = useState<number | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // G-01: auto-focus Date whenever the entry tab becomes the active, editable view — including
  // the very first time the page itself is opened (per the user, 2026-08-26: "when I go to the JV
  // page auto focus on date"). AppLayout's own global auto-focus only re-scans when a <form> is
  // newly INSERTED into the DOM, which doesn't reliably cover switching tabs/mode on a page that
  // stays mounted the whole time — same fix as SaleReturnPage's own identical effect.
  useEffect(() => {
    if (activeTab === 'entry' && mode !== 'view') {
      requestAnimationFrame(() => firstFieldRef.current?.focus());
    }
  }, [activeTab, mode]);

  useEffect(() => {
    function recompute() {
      const el = entryCardRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // AppLayout's <main> (the only scroll container in the app) adds 32px of its own
      // padding-bottom below whatever height we claim here.
      setEntryCardHeight(Math.max(320, window.innerHeight - top - 32));
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [mode, lookupError, successMsg, errorMsg]);

  // ── Record navigation: First/Pre./Next/Last + Posted/Unposted dropdown (per the user, 2026-08-26:
  // "posted and unposted thing so that we can move to and fro") — same mechanism as SaleBillPage
  // §3. Fetched unfiltered (independent of the JV Ledger tab's own search/status filters), newest-
  // first per journalVouchers.repository.js#list — reversed here for oldest-first browsing, so
  // First = earliest, Last = most recent. Also doubles as the source for the auto "Number" preview
  // below, since jv_id is the ONE identity space a JV ever has (no separate draft table the way
  // Sale Bill/Purchase have — DRAFT and CONFIRMED are just a status on the same row).
  // Unposted is the default (per the user, 2026-08-30): that's the working mode you add and post
  // new JVs from. Posted is purely a browse mode over already-CONFIRMED JVs (First/Prev./Next/
  // Last + Un Post) — switching into it never blocks entry, it's just a different lens on the
  // same record list.
  const [browseFilter, setBrowseFilter] = useState<'posted' | 'unposted'>('unposted');
  const [navVouchers, setNavVouchers] = useState<JournalVoucherRow[]>([]);

  const refreshNav = useCallback(async () => {
    const res = await api.journalVouchers.list({});
    if (res.ok) setNavVouchers(res.data);
    return res.ok ? res.data : null;
  }, []);

  useEffect(() => { refreshNav(); }, [refreshNav]);

  const navPostedList = useMemo(
    () => [...navVouchers].filter(v => v.status === 'CONFIRMED').reverse(),
    [navVouchers]
  );
  // Unposted JVs are a single table with a status column (not a draft/real split), and loadJv()
  // already loads either kind uniformly by jv_id — so browsing Unposted just needs its own list,
  // the same shape as navPostedList. Previously First/Prev/Next/Last only ever browsed
  // navPostedList regardless of the dropdown, so switching to "Unposted" disabled all four nav
  // buttons entirely even though unpostedJvs was non-empty (per the user, 2026-09-07 — every other
  // page's nav list already swaps with this dropdown).
  const navUnpostedList = useMemo(() => [...unpostedJvs].reverse(), [unpostedJvs]);
  const navList = browseFilter === 'posted' ? navPostedList : navUnpostedList;

  const navIndex = useMemo(() => {
    if (jvId == null) return -1;
    return browseFilter === 'posted'
      ? (isPosted ? navPostedList.findIndex(v => v.jv_id === jvId) : -1)
      : (!isPosted ? navUnpostedList.findIndex(v => v.jv_id === jvId) : -1);
  }, [jvId, isPosted, browseFilter, navPostedList, navUnpostedList]);

  const canBrowse = navList.length > 0;
  const canNavPrevious = canBrowse && navIndex !== 0;
  const canNavNext = canBrowse && navIndex !== navList.length - 1;

  const goToNavIndex = async (idx: number) => {
    if (idx < 0 || idx >= navList.length) return;
    await loadJv(navList[idx].jv_id);
  };
  const handleFirst = () => goToNavIndex(0);
  const handlePrev = () => goToNavIndex(navIndex === -1 ? 0 : navIndex - 1);
  const handleNext = () => goToNavIndex(navIndex === -1 ? 0 : navIndex + 1);
  const handleLast = () => goToNavIndex(navList.length - 1);

  // Switching the Posted/Unposted dropdown (per the user, 2026-08-30):
  // - To Unposted: load the most recently saved unposted JV (or a blank New one if there isn't
  //   one), then focus New — Enter on it clicks New and lands on Date, ready to type the next JV.
  // - To Posted: re-fetch and jump straight to the most recently posted JV for browsing.
  const handleBrowseFilterChange = async (next: 'posted' | 'unposted') => {
    setBrowseFilter(next);
    if (next === 'unposted') {
      // Re-fetch first, like the Posted branch below — reading the list straight out of state
      // meant one posted or deleted since it was last loaded was still in it, so Unposted
      // opened something that is no longer unposted (2026-09-04).
      const freshUnposted = await refreshUnposted();
      const latest = (freshUnposted ?? unpostedJvs).slice(-1)[0];
      if (latest) await loadJv(latest.jv_id);
      else handleNew();
      focusNewButton();
    } else {
      const fresh = await refreshNav();
      const list = [...(fresh ?? navVouchers)].filter(v => v.status === 'CONFIRMED').reverse();
      const latest = list[list.length - 1];
      if (latest) await loadJv(latest.jv_id);
    }
  };

  // Landing on the page with nothing in progress: the Posted/Unposted dropdown already reads
  // Unposted, so open the newest unposted voucher and park focus on New, exactly as picking
  // Unposted from the dropdown does (per the user, 2026-09-04). Skipped when a draft was
  // restored — that is real in-progress work and must not be overwritten. Runs once; the ref
  // keeps a later state change from re-opening a record over whatever is being typed by then.
  // Per the user, 2026-09-16 (corrected same day — the first version also revealed the preview
  // after G-06's own automatic reset-to-blank, which the user does not consider a "New" press):
  // the System No. preview must not appear until the toolbar's New button (or the Records tabs'
  // own "New Voucher" tab, an equally deliberate click) is pressed — a restored in-progress draft
  // still counts (same as `hasPageDraftAtMount` already distinguishes elsewhere), but every other
  // path that resets to blank (G-06's auto-open, Post's "ready for the next one", the Unposted
  // dropdown's own empty-list fallback, etc.) must leave it blank. `handleNew()` itself always
  // resets this to false; only the two deliberate click sites set it true, right after calling
  // `handleNew()`.
  // (hasClickedNew/hasPageDraftAtMount come from useNewDocGate, declared right after `mode`.)
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (hasPageDraftAtMount || didAutoOpenRef.current) return;
    didAutoOpenRef.current = true;
    handleBrowseFilterChange('unposted');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preview of the Number a brand-new JV will get — voucher_no (JV-01, changes-14-09-26.md) is
  // system-generated from dbo.seq_journal_voucher_no the moment Save actually creates the row, so
  // this is a client-side preview only, correct as long as nothing else inserts a JV between now
  // and Save.
  // The Number shown before saving is only a PREVIEW (MAX(voucher_no)+1, never reserved
  // server-side). Always shown, from the moment the page opens — an earlier round gated it behind
  // pressing New, which the user reversed (2026-08-31): the number should just be there.
  const [deletedJvNumbers, setDeletedJvNumbers] = useState<{ system_no: number }[]>([]);
  useEffect(() => {
    api.journalVouchers.listDeletedNumbers().then(res => { if (res.ok) setDeletedJvNumbers(res.data); });
  }, [navVouchers]);

const nextJvNoPreview = useMemo(
    () => Math.max(
      0,
      ...navVouchers.map(v => Number(v.voucher_no) || 0),
      ...unpostedJvs.map(v => Number(v.voucher_no) || 0),
      // A deleted number is never reused — the sequence skips past it (migration 035), so the
      // preview must too, or it would promise #8 and Save would hand out #9.
      ...deletedJvNumbers.map(d => d.system_no),
    ) + 1,
    [navVouchers, unpostedJvs, deletedJvNumbers]
  );

  // Toolbar's Find — a quick jump to any JV (posted or unposted) by number or reason, searched
  // client-side over the already-loaded browse/pending lists.
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const closeFindJv = () => { setIsFindOpen(false); setFindQuery(''); };
  // G-07 (changes-14-09-26.md): Escape closes the topmost dialog.
  useEscapeToClose(isFindOpen, closeFindJv);
  const findResults = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = (v: { reason: string | null; voucher_no: string | null }) =>
      (v.reason || '').toLowerCase().includes(q) || (v.voucher_no || '').toLowerCase().includes(q);
    const posted = navVouchers.filter(v => v.status === 'CONFIRMED' && matches(v));
    const unposted = unpostedJvs.filter(matches);
    return [
      ...posted.map(v => ({ jv_id: v.jv_id, voucher_no: v.voucher_no, reason: v.reason, date: v.jv_date, status: 'posted' as const })),
      ...unposted.map(v => ({ jv_id: v.jv_id, voucher_no: v.voucher_no, reason: v.reason, date: v.jv_date, status: 'unposted' as const })),
    ].slice(0, 30);
  }, [findQuery, navVouchers, unpostedJvs]);
  const handleFindSelect = async (id: number) => {
    setIsFindOpen(false);
    setFindQuery('');
    await loadJv(id);
  };


  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      <button
        onClick={() => { setActiveTab('entry'); handleNew(); markNewClicked(); }}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'entry' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        New Journal Voucher
      </button>
      <button
        onClick={() => setActiveTab('records')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'records' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        JV Ledger
      </button>
    </div>
  );

  return (
    <AppLayout pageTitle="Journal Voucher" headerAction={tabBar}>
      <div className="mx-auto relative" style={{ maxWidth: 1200 }} {...autoEditScope}>

        {/* Master/Detail edit-scope — which half of the document the toolbar's Edit button
            unlocks (per the user, 2026-08-31). Two bare radios parked in the margin just left
            of the toolbar's New button, outside the card: absolute, so the centre card never
            moves, and behind no width gate, so no zoom level can hide them (per the user,
            2026-09-03). */}
        <PasswordPromptModal
          isOpen={isPasswordModalOpen}
          onClose={() => { setIsPasswordModalOpen(false); pendingDeleteJvId.current = null; }}
          onSuccess={handleDeletePasswordSuccess}
          title="Delete Unposted Journal Voucher"
          subtitle="This deletes the WHOLE voucher and every line on it — not a single row. It cannot be undone. Enter your password to confirm."
        />

        {/* Find Journal Voucher Modal — jump to any posted or unposted JV by number or reason. */}
        {isFindOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
            <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-lg mx-4 animate-scaleUp">
              <h3 className="font-lora font-bold text-lg text-slate-800 mb-4">Find Journal Voucher</h3>
              <input
                type="text"
                value={findQuery}
                onChange={e => setFindQuery(e.target.value)}
                placeholder="Number or remarks..."
                className="soleria-input w-full font-semibold mb-3"
                autoFocus
              />
              <ul className="max-h-72 overflow-y-auto border rounded-lg divide-y" style={{ borderColor: 'var(--border-color)' }}>
                {findResults.map(r => (
                  <li
                    key={`${r.status}-${r.jv_id}`}
                    onClick={() => handleFindSelect(r.jv_id)}
                    className="px-3 py-2 text-xs cursor-pointer hover:bg-amber-50/60 flex items-center justify-between gap-2"
                  >
                    <span className="font-mono font-semibold text-slate-700">#{r.voucher_no}</span>
                    <span className="text-slate-400 truncate flex-1">{r.reason}</span>
                    <span className="text-slate-400">{formatDate(r.date)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${r.status === 'posted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span>
                  </li>
                ))}
                {findQuery.trim() && findResults.length === 0 && (
                  <li className="px-3 py-3 text-xs text-slate-400 text-center">No matching journal vouchers.</li>
                )}
              </ul>
              <div className="flex justify-end mt-4">
                <button
                  type="button"
                  onClick={closeFindJv}
                  className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors text-sm font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Floated into the right-hand gutter, not rendered inline: a message used to push the
            toolbar and card down under the cursor mid-click (per the user, 2026-08-31). */}
        <PageToasts
          error={lookupError || errorMsg}
          success={successMsg}
          onDismissError={() => { setLookupError(''); setErrorMsg(''); }}
          onDismissSuccess={() => setSuccessMsg('')}
        />

        {activeTab === 'entry' && (
        <>
        {/* Toolbar — icon-over-label buttons (`.toolbar-btn`), matching ref-pic jv2.0's own set
            exactly (per the user, 2026-08-26): New/Delete/Edit/Done, First/Previous/Next/Last,
            Print/Find, Un Post/Post. Every action always renders, only `disabled` changes per
            state, instead of whole button groups mounting/unmounting per mode. */}
        <div className="flex items-center flex-nowrap overflow-x-auto justify-between gap-2 mb-1 p-1.5 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          <DocumentToolbar
            newAction={{ onClick: () => { handleNew(); markNewClicked(); }, disabled: browseFilter === 'posted', ref: newButtonRef }}
            remove={{
              onClick: handleDeleteAction,
              disabled: jvId == null || isPosted,
              title: 'Delete this whole voucher — every line on it goes too (asks for your password)',
            }}
            editRow={{ onClick: handleEditSelectedRow, disabled: selectedIndex == null || editingIndex != null || (isViewMode && isPosted) || (mode === 'edit' && editScope !== 'detail'), title: 'Edit selected line' }}
            edit={{
              onClick: () => {
                setMode('edit');
                requestAnimationFrame(() => {
                  if (editScope === 'detail') entryAccountTriggerRef.current?.focus();
                  else firstFieldRef.current?.focus();
                });
              },
              disabled: !isViewMode || jvId == null || isPosted,
            }}
            save={{ onClick: async () => { await doSave(false); }, disabled: isViewMode || !isValid, title: 'Save — keep editing this voucher' }}
            done={{ submit: true, form: 'jv-entry-form', disabled: isViewMode || !isValid, title: 'Done — finish this voucher, then Post it' }}
            cancel={{ onClick: handleCancelEdit, disabled: mode !== 'edit', title: 'Cancel Edit' }}
            first={{ onClick: handleFirst, disabled: !canBrowse }}
            prev={{ onClick: handlePrev, disabled: !canNavPrevious, title: 'Previous' }}
            next={{ onClick: handleNext, disabled: !canNavNext }}
            last={{ onClick: handleLast, disabled: !canBrowse }}
            print={{ onClick: () => window.print(), disabled: mode !== 'view' || jvId == null }}
            find={{ onClick: () => setIsFindOpen(true) }}
            unpost={{ onClick: handleUnpost, disabled: !isViewMode || jvId == null || !isPosted, title: 'Un Post — move this posted voucher back to unposted' }}
            post={{ onClick: async () => { await handlePost(); focusNewButton(); }, disabled: !isViewMode || jvId == null || isPosted }}
            exit={{ onClick: () => dispatch({ type: 'NAVIGATE', page: 'home' }) }}
            saveAndPost={{ onClick: handleSaveAndPost, disabled: isViewMode || !isValid, title: 'Save & Post' }}
            postAll={{ onClick: async () => { await handlePostAll(); focusNewButton(); }, disabled: postAllBusy || browseFilter === 'posted' || unpostedJvs.length === 0, title: postAllBusy ? 'Posting…' : `Post All (${unpostedJvs.length})` }}
            pdf={{ onClick: () => window.print(), disabled: mode !== 'view' || jvId == null, title: 'Export PDF — choose "Save as PDF" in the print dialog' }}
            excel={{
              onClick: () => exportRowsToExcel(`journal-voucher-${jvId}`, ['A/C Code', 'Account', 'Narration', 'Debit', 'Credit'], lines.map(l => [accounts.find(a => a.ba_id === Number(l.baId))?.code ?? '', accounts.find(a => a.ba_id === Number(l.baId))?.name ?? l.baSearchText, l.narration, l.debit, l.credit])),
              disabled: mode !== 'view' || jvId == null,
              title: 'Export Excel',
            }}
          />

          {/* Posted/Unposted — picks which list First/Prev./Next/Last page through. Same row as
              the toolbar icons. Unposted (default) = add/post new JVs; Posted = browse
              already-posted ones to Un Post one (per the user, 2026-08-30). */}
          <select
            value={browseFilter}
            onChange={e => handleBrowseFilterChange(e.target.value as 'posted' | 'unposted')}
            className="soleria-input soleria-input-compact cursor-pointer font-semibold"
            style={{ width: 'auto' }}
            title="Unposted = add new JVs. Posted = browse posted JVs to Un Post one."
            data-no-print
          >
            <option value="unposted">Unposted</option>
            <option value="posted">Posted</option>
          </select>

          {/* Post All's outcome. Was shown inside the left-hand Pending Posting panel; that panel
              is gone (per the user, 2026-09-03), so it lands here under the toolbar instead. A run
              can post 8 of 10, and the two that failed are the whole point — it stays until
              dismissed. */}
          {postAllResult && (
            <div className="w-full mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border-color)' }}>
              <p className="font-semibold text-slate-700">
                {postAllResult.posted.length} of {postAllResult.attempted} posted
                {postAllResult.failed.length > 0 && ` · ${postAllResult.failed.length} failed`}
                <button type="button" onClick={() => setPostAllResult(null)} className="ml-2 text-slate-500 hover:text-slate-700 font-semibold">Dismiss</button>
              </p>
              {postAllResult.failed.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {postAllResult.failed.map((fail, i) => (
                    <li key={i} className="text-rose-700">{fail.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Master/Detail edit-scope — which half of the document the toolbar's Edit button
            unlocks (per the user, 2026-08-31). Centred directly under the toolbar rather than
            out in the page margin where it used to sit, so it reads as part of the same
            control strip as the Edit button it modifies (per the user, 2026-09-04). */}
        <EditScopeRadios name="jv-edit-scope" value={editScope} onChange={setEditScope} />

        {/* This <form> IS the entry card — height pinned to the remaining viewport space (see
            entryCardHeight above) and laid out as a flex column, so the line-items table below
            can flex-grow into whatever room that leaves. Every other child keeps its natural
            size (shrink-0) — only the table wrapper is flex-1. */}
        <form
          id="jv-entry-form" ref={entryCardRef} onSubmit={handleSave}
          noValidate
          className="card-white p-3 md:p-4 bg-white border flex flex-col" style={{ height: entryCardHeight ?? undefined }}
          data-edit-scope="detail"
        >
          {/* Header row — "JOURNAL ENTRY" title. Master/Detail radios removed (per the user,
              2026-08-26) — display-only and didn't do anything, same reason they're gone from
              SaleBillPage too. */}
          <div className="shrink-0 flex items-center gap-2 border-b pb-2 mb-2">
            <BookText size={18} className="text-[#B08D57]" />
            <h3 className="font-lora font-bold text-lg tracking-wide text-slate-800">JOURNAL ENTRY</h3>
          </div>

          {/* Date / Number / Remarks — one row (JV-02, changes-14-09-26.md, 2026-09-15: matching
              ref-pic jv2.0.jpeg's own Date/Number/Remarks bar exactly, labeled "Remarks" not
              "Reason" to match — the underlying field is still `reason`/optional per JV-03, this
              is a display label only). Number is voucher_no, system-generated from
              dbo.seq_journal_voucher_no (JV-01) — read-only, previewing what Save will assign,
              same convention as SaleBillPage's own System No. Density matched to
              SaleBillPage/ReceiptsPage's own banded header row (`soleria-input-compact`, `gap-2`/
              `p-2`, not the old `gap-4`/`p-4` — JV-02's own "strip the extra vertical whitespace"). */}
          <div
            className="shrink-0 grid grid-cols-1 md:grid-cols-4 gap-2 mb-2 p-2 rounded-lg border"
            data-edit-scope="master"
            style={{ background: 'rgba(176,141,87,0.06)', borderColor: 'var(--border-color)' }}
          >
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Date <span className="text-red-500 font-bold">*</span>
              </label>
              <input
                ref={firstFieldRef} type="date" required value={date} disabled={isViewMode || masterLocked}
                onChange={e => setDate(e.target.value)} className="soleria-input soleria-input-compact"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Number</label>
              <input
                type="text"
                value={voucherNo != null ? `#${voucherNo}` : hasClickedNew ? `#${nextJvNoPreview}` : ''}
                disabled
                className="soleria-input soleria-input-compact bg-gray-50 text-gray-500 border-gray-200 font-mono"
              />
            </div>
            <div className="md:col-span-2">
              {/* Labeled "Remarks" (ref pic), optional per the client, 2026-09-14
                  (changes-14-09-26.md JV-03) — was required. */}
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Remarks
              </label>
              <input
                type="text" value={reason} disabled={isViewMode || masterLocked} onChange={e => setReason(e.target.value)}
                placeholder="e.g. Eid compensation (optional)" className="soleria-input soleria-input-compact"
              />
            </div>
          </div>

          {/* Entry strip (JV-02, changes-14-09-26.md, 2026-09-15 — ref-pic jv2.0.jpeg's own
              bound-record pattern). Visual layout via CSS grid AREAS rather than DOM order, so the
              field ORDER (tab/Enter walk) can differ from the visual grid the ref pic shows —
              specifically, the client's explicit reordering: "Narration comes before the amount"
              in tab order, even though Amount still sits visually in row 1 (matching the ref pic)
              and Narration in row 2. DOM order below is therefore code -> desc (disabled, skipped
              by the field walk) -> narr -> amt -> bal (no input, decorative), giving exactly that
              tab sequence. Enter now commits the line from the AMOUNT field (the new last
              tabbable field) instead of Narration — see the moved `onKeyDown` below. */}
          {!isViewMode && (
          <div className="shrink-0 mb-2 p-2 rounded-lg border" style={{ background: 'rgba(176,141,87,0.06)', borderColor: 'var(--border-color)' }}>
            <div
              className="grid gap-2 mb-2"
              style={{
                gridTemplateColumns: '1fr 2fr 160px',
                gridTemplateAreas: `"code desc amt" "narr narr bal"`,
              }}
            >
              <div className="relative" style={{ gridArea: 'code' }}>
                <label className="block text-xs font-medium text-slate-600 mb-1">A/C Code <span className="text-red-500 font-bold">*</span></label>
                <input
                  ref={entryAccountTriggerRef}
                  type="text"
                  required
                  disabled={detailLocked}
                  value={entry.baSearchText}
                  onChange={e => setEntry(prev => ({ ...prev, baSearchText: e.target.value }))}
                  onKeyDown={handleEntryAccountKeyDown}
                  placeholder="Type an account name, or press Enter to search..."
                  className="soleria-input soleria-input-compact pr-8"
                />
                <button
                  type="button"
                  disabled={detailLocked}
                  onClick={openEntryAccountModal}
                  title="Browse all accounts"
                  className="absolute right-2 bottom-1.5 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronDown size={14} />
                </button>
                <SearchModal
                  isOpen={isEntryAccountModalOpen}
                  title="Select Account"
                  options={accountOptions}
                  value={entry.baId}
                  onSelect={handleEntryAccountSelect}
                  onClose={() => setIsEntryAccountModalOpen(false)}
                  searchPlaceholder="Search account..."
                  initialSearch={entryAccountModalSeed}
                />
              </div>
              <div style={{ gridArea: 'desc' }}>
                <label className="block text-xs font-medium text-slate-600 mb-1">Account Description</label>
                <input
                  type="text"
                  value={accounts.find(a => String(a.ba_id) === entry.baId)?.name ?? ''}
                  disabled
                  placeholder="—"
                  className="soleria-input soleria-input-compact bg-gray-100 text-gray-500"
                />
              </div>
              <div style={{ gridArea: 'narr' }}>
                <label className="block text-xs font-medium text-slate-600 mb-1">Narration</label>
                <input
                  type="text"
                  disabled={detailLocked}
                  value={entry.narration}
                  onChange={e => setEntry(prev => ({ ...prev, narration: e.target.value }))}
                  placeholder="Optional note for this line..."
                  className="soleria-input soleria-input-compact"
                />
              </div>
              <div style={{ gridArea: 'amt' }}>
                {/* Single signed Amount, not separate Debit/Credit boxes. ACC-01
                    (changes-14-09-26.md): +ve -> debit (NAAM), -ve -> credit (JAMMA) — the one
                    sign rule for every account type. handleCommitLine splits this into the
                    committed line's own debit/credit. Now the strip's own LAST tabbable field
                    (JV-02's reordering) — Enter here commits the line, same role Narration's
                    onKeyDown used to have. */}
                <label className="block text-xs font-medium text-slate-600 mb-1">Amount <span className="text-red-500 font-bold">*</span></label>
                <input
                  type="number"
                  required
                  disabled={detailLocked}
                  value={entry.amount || ''}
                  onChange={e => setEntry(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                  onKeyDown={handleEntryLastFieldKeyDown}
                  placeholder="+debit / -credit"
                  className="soleria-input soleria-input-compact font-mono text-right"
                />
              </div>
              <div style={{ gridArea: 'bal' }} className="flex flex-col items-end justify-end">
                {/* JV-02: ref-pic jv2.0.jpeg's second boxed field, directly under Amount — the
                    picked account's own live balance. Read-only/informational, same shared
                    component Receipts/Expenses already use next to their own account pickers; no
                    new behavior, per this item's own "frontend only" scope. */}
                {entry.baId && (
                  <>
                    <label className="block text-xs font-medium text-slate-600 mb-1 self-end">Balance</label>
                    <AccountBalanceTooltip baId={Number(entry.baId)} refreshKey={balanceRefreshKey} className="w-full justify-end" />
                  </>
                )}
              </div>
            </div>
            {editingIndex != null && (
              <div className="mt-2 flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs">
                <span className="text-blue-700 font-semibold">Editing an existing line — commit (Enter on Amount) to save, or cancel.</span>
                <button type="button" onClick={() => { setEditingIndex(null); setEntry(emptyEntry()); }} className="text-blue-600 hover:text-blue-800 font-semibold underline">
                  Cancel
                </button>
              </div>
            )}
            <div className="mt-2">
              <button type="button" onClick={handleCommitLine} disabled={detailLocked} className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] disabled:opacity-40 disabled:cursor-not-allowed">
                {editingIndex != null ? 'Update Line' : 'Add Line'}
              </button>
            </div>
          </div>
          )}

          {/* Committed lines — read-only grid, matching ref-pic's own columns exactly. Click a
              row to load it back into the entry strip above for editing. A delete icon at the
              front of every row (JV-04, changes-14-09-26.md, 2026-09-15) removes it directly —
              active only while unposted and the page is in edit mode, same rule the entry strip
              fields below already apply. */}
          <div className="flex-1 min-h-0 mb-2 rounded-lg border bg-white overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  {/* G-05 (changes-14-09-26.md, 2026-09-15): narrow gutter for the ▶ row pointer —
                      unlabeled, matching the ref pic (ref-pics/batch2/jv2.0.jpeg). Separate from
                      the delete-icon column right after it (JV-04). */}
                  <th className="sticky top-0 z-10 bg-slate-50 p-1" style={{ width: '18px' }} />
                  <th className="sticky top-0 z-10 bg-slate-50 p-2 pl-4" style={{ minWidth: '160px' }}>A/C Code</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-2">Account Description</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-2">Narration</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-2 text-right" style={{ width: '140px' }}>Debit (NAAM)</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-2 text-right" style={{ width: '140px' }}>Credit (JAMMA)</th>
                  {/* Per-row Edit/Delete at the right-hand end (per the user, 2026-09-20) — the
                      toolbar's own Edit Row/Delete still work off the selected row. */}
                  <th className="sticky top-0 z-10 bg-slate-50 p-2 text-center" style={{ width: '84px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => {
                  const selectedAccount = accounts.find(a => a.ba_id === Number(line.baId));
                  // Both row buttons work straight from view mode (per the user, 2026-09-20: "why do
                  // I have to click a row then it enables the edit/delete button") — pressing either
                  // switches the voucher into edit mode itself, exactly as a row click used to. Only a
                  // POSTED voucher (unpost first), a line already loaded for editing, or the
                  // Master/Detail switch sitting on Master disables them.
                  const rowActionsEnabled = !isPosted && editingIndex == null && !(mode === 'edit' && editScope !== 'detail');
                  return (
                    <tr
                      key={line.uid}
                      ref={el => { rowRefs.current[idx] = el; }}
                      onClick={() => {
                        // G-08: a click must produce no visible change — it only records which
                        // row the Delete/Edit Row toolbar buttons act on next. Inert entirely
                        // while another row is actually loaded for editing.
                        if (editingIndex != null) return;
                        setSelectedIndex(prev => prev === idx ? null : idx);
                      }}
                      className={`border-b cursor-pointer hover:bg-slate-50/55 transition-colors ${idx === editingIndex ? 'bg-blue-50' : ''}`}
                      style={{ borderColor: 'var(--border-table)' }}
                    >
                      {/* G-05: a pure position indicator — never a background/highlight, so it
                          can never be confused with G-08's edit highlight above. */}
                      <td className="p-1 text-center text-emerald-600" aria-hidden="true">
                        {idx === lastEnteredIndex && '▶'}
                      </td>
                      <td className="p-2 pl-4 font-mono text-xs text-slate-600">{selectedAccount?.code ?? '—'}</td>
                      <td className="p-2 text-xs text-slate-800 font-semibold">
                        {selectedAccount ? selectedAccount.name : (line.baSearchText || '—')}
                      </td>
                      <td className="p-2 text-xs text-slate-600">{line.narration || '—'}</td>
                      <td className="p-2 text-right font-mono text-sm text-slate-700">{line.debit > 0 ? formatCurrency(line.debit) : '-'}</td>
                      <td className="p-2 text-right font-mono text-sm text-slate-700">{line.credit > 0 ? `(${formatCurrency(line.credit)})` : '-'}</td>
                      <td className="p-2 text-center whitespace-nowrap">
                        <RowActions
                          onEdit={() => { if (isViewMode) setMode('edit'); handleRowClick(idx); }}
                          onDelete={() => { if (isViewMode) setMode('edit'); removeLine(idx); }}
                          disabled={!rowActionsEnabled}
                          editTitle="Edit this line"
                          deleteTitle="Delete this line"
                          disabledTitle="Unpost the voucher (Detail scope) to change its lines"
                        />
                      </td>
                    </tr>
                  );
                })}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-3 text-center text-xs text-slate-400">
                      No lines added yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Bottom totals row — same small-boxed-fields style as SaleBillPage's own (per the
              user, 2026-08-26: "the net total must be shown as we have in the sale bill"), not a
              table tfoot. Total Debit/Total Credit are plain grey boxes; Net Total (their
              difference — the actual result of the math) is the dark/gold emphasized box, exactly
              like Sale Bill's own "Rs." field, except it flips to rose while out of balance
              (Save's own Net-Total-must-be-0 rule is checking this same number). */}
          <div className="shrink-0 flex flex-wrap items-center justify-end gap-3 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-table)' }}>
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Debit</label>
              <input type="text" value={formatCurrency(totals.totalDebit)} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-700 text-right font-mono font-semibold" style={{ width: '130px' }} />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Credit</label>
              <input type="text" value={`(${formatCurrency(totals.totalCredit)})`} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-700 text-right font-mono font-semibold" style={{ width: '130px' }} />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Net Total</label>
              <input
                type="text"
                value={formatCurrency(totals.difference)}
                disabled
                className="soleria-input soleria-input-compact text-right font-mono font-bold"
                // Balanced: light bar, not the dark navy fill — same fix as Reports Hub/Wage Run/
                // Receipts/Expenses/Sale Bill/Sale Return (per the user, 2026-09-03). Out-of-
                // balance keeps its own red warning state unchanged — white-on-saturated-red
                // already reads clearly, that one was never the reported issue.
                style={totals.difference === 0
                  ? { width: '140px', color: 'var(--brand-gold)', background: '#ffffff', borderColor: 'var(--border-color)' }
                  : { width: '140px', color: '#fff', background: '#be123c', borderColor: '#9f1239' }}
              />
            </div>
          </div>
          {totals.difference !== 0 && (
            <p className="shrink-0 text-xs font-semibold text-rose-600 text-right mt-1">
              Out of balance by {formatCurrency(Math.abs(totals.difference))} — debit and credit must match before saving.
            </p>
          )}
        </form>
        </>
        )}

        {/* JV Ledger — own tab now, rather than always rendering every JV ever recorded inline
            below the live entry form. Search matches the header OR any line (account name/code,
            per-line narration, debit/credit amount) — see journalVouchers.repository.js#list. */}
        {activeTab === 'records' && (
        <div className="card-white p-6 bg-white border">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h3 className="font-lora font-semibold text-lg text-slate-800">JV Ledger</h3>
            <div className="flex flex-wrap items-center gap-2" data-no-print>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                <input
                  type="text" value={jvSearch} onChange={e => setJvSearch(e.target.value)}
                  placeholder="Search by account, remarks, number, narration, amount..." className="soleria-input pl-8 py-1.5 text-xs w-80"
                />
              </div>
              <select
                value={jvStatusFilter}
                onChange={e => setJvStatusFilter(e.target.value as 'all' | 'CONFIRMED' | 'DRAFT')}
                className="soleria-input py-1.5 text-xs"
              >
                <option value="all">All Statuses</option>
                <option value="CONFIRMED">Posted</option>
                <option value="DRAFT">Not Posted</option>
              </select>
            </div>
          </div>
          {vouchers.length === 0 ? (
            <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
              {jvSearch.trim() || jvStatusFilter !== 'all' ? 'No journal vouchers match your search/filter.' : 'No journal vouchers recorded yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Date</th>
                    <th className="p-3">Number</th>
                    <th className="p-3">Remarks</th>
                    <th className="p-3 text-center">Lines</th>
                    <th className="p-3 text-right">Total</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map(v => (
                    <tr key={v.jv_id} onClick={() => loadRow(v)} className="border-b hover:bg-slate-50/40 cursor-pointer" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-mono text-xs text-slate-600">{formatDate(v.jv_date)}</td>
                      <td className="p-3 text-xs font-mono text-slate-500">{v.voucher_no || '-'}</td>
                      <td className="p-3 text-xs text-slate-500">{v.reason}</td>
                      <td className="p-3 text-center text-xs text-slate-500">{v.line_count}</td>
                      <td className="p-3 text-right font-bold font-mono text-slate-800">{formatCurrency(v.total_debit ?? 0)}</td>
                      <td className="p-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${v.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {v.status === 'CONFIRMED' ? 'Posted' : 'Not Posted'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

      </div>
    </AppLayout>
  );
}
