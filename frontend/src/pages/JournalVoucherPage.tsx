import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchModal from '@/components/SearchModal';
import { focusNextField } from '@/lib/fieldNav';
import * as api from '@/lib/api';
import type {
  BusinessAccountRow, JournalVoucherRow, JournalVoucherLineInput, JournalVoucherCreateInput,
  UnpostedJournalVoucherRow, PostAllResult,
} from '@/lib/api';
import { formatDate, getTodayDate } from '@/lib/utils';
import {
  Edit, Search, Plus, Trash2, BookText, ChevronDown, CheckCircle2, PackageCheck, Undo2,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Printer
} from 'lucide-react';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import { usePersistentField, useClearPageDraft } from '@/hooks/usePersistentField';

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
  const [postingJvId, setPostingJvId] = useState<number | null>(null);

  const refreshUnposted = useCallback(async () => {
    const res = await api.journalVouchers.listUnposted();
    if (res.ok) setUnpostedJvs(res.data);
  }, []);

  useEffect(() => {
    (async () => {
      const ba = await api.listBusinessAccounts();
      if (ba.ok) setAccounts(ba.data); else setLookupError('Failed to load accounts: ' + ba.error.message);
    })();
    refreshUnposted();
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
  };

  // Recorded Journal Vouchers moved to its own tab (was inline below the live entry form on the
  // same page — every JV ever recorded rendering directly under a live entry form doesn't scale
  // and pushed the whole page well past one screen). Mirrors PurchasePage/SaleBillPage.
  const [activeTab, setActiveTab] = useState<'entry' | 'records'>('entry');

  // ── entry form ──
  const [mode, setMode] = useState<'new' | 'edit' | 'view'>('new');
  const [jvId, setJvId] = useState<number | null>(null);
  const [status, setStatus] = useState<'CONFIRMED' | 'DRAFT'>('DRAFT');
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

  const accountOptions = useMemo(
    () => accounts.map(a => ({ value: String(a.ba_id), label: `${a.name} (${a.code})` })),
    [accounts]
  );

  const handleNew = () => {
    setMode('new'); setJvId(null); setStatus('DRAFT');
    setDate(getTodayDate()); setReason('');
    setLines([]);
    setEntry(emptyEntry());
    setEditingIndex(null);
    setErrorMsg('');
    clearJournalVoucherDraft();
    // Explicit focus, not just a mode-change effect: clicking New while already on a blank/new JV
    // (mode is already 'new') wouldn't otherwise re-trigger any such effect, so focus would stay
    // wherever it was (same fix as SaleBillPage/SaleReturnPage's own handleNew).
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };

  // ── Entry strip (ref-pic jv2.0's own bound-record pattern, 2026-08-26 per the user: "we select
  // the account... it has its own box as in the ref pic") — ONE editable A/C Code/Amount/Narration
  // row, NOT one editable row per grid line. A single signed Amount replaces separate Debit/Credit
  // inputs: positive types a credit (JAMMA), negative types a debit (NAAM) — per the user: "if it
  // is positive... we are doing credit and if it's negative it is debit". Enter on Narration (the
  // strip's last field) commits the line into `lines` — appending, or replacing `editingIndex`
  // when a grid row was clicked to re-open it — then always clears the strip and refocuses A/C
  // Code for the next line (per the user: "it goes to the first field of account code... but the
  // master details remain same" — Date/Reason above are never touched by this).
  const [entry, setEntry] = usePersistentField<EntryLine>('journal-voucher', 'entry', emptyEntry());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const entryAccountTriggerRef = useRef<HTMLInputElement>(null);
  const [isEntryAccountModalOpen, setIsEntryAccountModalOpen] = useState(false);
  const [entryAccountModalSeed, setEntryAccountModalSeed] = useState('');

  const openEntryAccountModal = () => {
    if (isViewMode) return;
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
      if (isViewMode) return;
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
    if (entry.amount === 0) { setErrorMsg('Amount can\'t be 0 — positive for a credit, negative for a debit.'); return; }
    setErrorMsg('');
    const committed: UiLine = {
      uid: editingIndex != null ? lines[editingIndex].uid : newLineUid(),
      baId: entry.baId,
      baSearchText: entry.baSearchText,
      debit: entry.amount < 0 ? Math.abs(entry.amount) : 0,
      credit: entry.amount > 0 ? entry.amount : 0,
      narration: entry.narration,
    };
    if (editingIndex != null) {
      setLines(prev => prev.map((l, i) => i === editingIndex ? committed : l));
    } else {
      setLines(prev => [...prev, committed]);
    }
    setEditingIndex(null);
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
  // Amount is reconstructed from whichever side actually holds a value.
  const loadLineIntoEntry = (idx: number) => {
    const row = lines[idx];
    setEntry({ baId: row.baId, baSearchText: row.baSearchText, amount: row.credit > 0 ? row.credit : -row.debit, narration: row.narration });
    setEditingIndex(idx);
    requestAnimationFrame(() => entryAccountTriggerRef.current?.focus());
  };

  const handleRowClick = (idx: number) => {
    if (isViewMode) setMode('edit');
    loadLineIntoEntry(idx);
  };

  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
    if (editingIndex === idx) {
      setEditingIndex(null);
      setEntry(emptyEntry());
    } else if (editingIndex != null && idx < editingIndex) {
      setEditingIndex(editingIndex - 1);
    }
  };

  // Toolbar's Delete is dual-purpose, same convention as SaleBillPage/SaleReturnPage: with a line
  // loaded into the strip for editing, it removes THAT line; otherwise it's the whole-JV delete
  // (currently-open unposted voucher).
  const handleDeleteAction = () => {
    if (editingIndex != null) {
      removeLine(editingIndex);
      return;
    }
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
    if (!date || !reason.trim()) return false;
    if (lines.length < 2) return false;
    if (!lines.every(l => l.baId && ((Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0))) return false;
    return totals.difference === 0;
  }, [date, reason, lines, totals]);

  const buildPayload = (): JournalVoucherCreateInput | null => {
    if (!date) { setErrorMsg('Please pick a date.'); return null; }
    if (!reason.trim()) { setErrorMsg('A reason is required — a JV without one cannot be explained later.'); return null; }
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
      reason: reason.trim(),
      lines: payloadLines,
    };
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;
    const result = mode === 'edit' && jvId != null
      ? await api.journalVouchers.update(jvId, payload)
      : await api.journalVouchers.create(payload);
    if (!result.ok) { fail('Failed to save Journal Voucher: ' + result.error.message); return; }
    setJvId(result.data.jv_id);
    setStatus(result.data.status);
    setErrorMsg('');
    flash('Journal Voucher saved — Post it to update every line\'s ledger.');
    setMode('view');
    clearJournalVoucherDraft();
    refresh();
    refreshUnposted();
    refreshNav();
  };

  // Posting finishes this JV and readies the form for the next one — same convention as Sale
  // Bill/Purchase's own "clear straight back to blank so the next can be typed immediately" (per
  // the user, 2026-08-26: "when I press the post... auto focus goes to the date alike... new
  // bill"). Reuses handleNew() (which already focuses Date itself) rather than repeating its
  // field list, then restores the working date — handleNew() snaps to today, and a run of JVs
  // entered for an earlier date would otherwise reset on every one.
  const handlePost = async () => {
    if (jvId == null) return;
    const res = await api.journalVouchers.post(jvId);
    if (!res.ok) { fail('Failed to post: ' + res.error.message); return; }
    flash('Journal Voucher posted — every line\'s ledger updated.');
    refresh();
    refreshUnposted();
    refreshNav();
    const workingDate = date;
    handleNew();
    setDate(workingDate);
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
  };

  // Listing rows only carry rolled-up totals (line_count/total_debit/total_credit), not the
  // per-line detail — loading a JV always re-fetches the full voucher (with lines) to hydrate the form.
  const loadJv = async (id: number) => {
    const res = await api.journalVouchers.get(id);
    if (!res.ok) { fail('Failed to load Journal Voucher: ' + res.error.message); return; }
    const jv = res.data;
    setJvId(jv.jv_id);
    setStatus(jv.status);
    setDate(jv.jv_date.slice(0, 10));
    setReason(jv.reason);
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
    setErrorMsg('');
    setMode('view');
  };

  const loadRow = (row: JournalVoucherRow) => { loadJv(row.jv_id); setActiveTab('entry'); };

  // Pending Posting sidebar: opening a row loads that JV straight into the form.
  const handleOpenUnposted = (jvId: number) => { loadJv(jvId); setActiveTab('entry'); };

  // Posts a single JV straight from the sidebar without loading it into the form — for the common
  // case of "this one's ready, the rest of the run isn't yet". stopPropagation keeps the click
  // from also triggering the row's own open-for-edit handler.
  const handlePostOneUnposted = async (targetId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPostingJvId(targetId);
    const res = await api.journalVouchers.post(targetId);
    setPostingJvId(null);
    if (!res.ok) { fail('Failed to post: ' + res.error.message); return; }
    flash(`Journal Voucher ${res.data.voucher_no || `#${res.data.jv_id}`} posted.`);
    refresh();
    refreshUnposted();
    refreshNav();
    if (targetId === jvId) setStatus(res.data.status);
  };

  // Password-gated (verified server-side) — deleting a saved-unposted JV is destructive with no
  // reverse-never-erase trail, same guard level used on Sale Bill/Sale Return/Purchase.
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const pendingDeleteJvId = useRef<number | null>(null);

  const handleDeleteUnposted = (targetId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    pendingDeleteJvId.current = targetId;
    setIsPasswordModalOpen(true);
  };

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
  const [browseFilter, setBrowseFilter] = useState<'posted' | 'unposted'>('posted');
  const [navVouchers, setNavVouchers] = useState<JournalVoucherRow[]>([]);

  const refreshNav = useCallback(async () => {
    const res = await api.journalVouchers.list({});
    if (res.ok) setNavVouchers(res.data);
  }, []);

  useEffect(() => { refreshNav(); }, [refreshNav]);

  const navPostedList = useMemo(
    () => [...navVouchers].filter(v => v.status === 'CONFIRMED').reverse(),
    [navVouchers]
  );

  const navIndex = useMemo(() => {
    if (jvId == null || !isPosted) return -1;
    return navPostedList.findIndex(v => v.jv_id === jvId);
  }, [jvId, isPosted, navPostedList]);

  const canBrowse = browseFilter === 'unposted' && navPostedList.length > 0;
  const canNavPrevious = canBrowse && navIndex !== 0;
  const canNavNext = canBrowse && navIndex !== navPostedList.length - 1;

  const goToNavIndex = async (idx: number) => {
    if (idx < 0 || idx >= navPostedList.length) return;
    await loadJv(navPostedList[idx].jv_id);
  };
  const handleFirst = () => goToNavIndex(0);
  const handlePrev = () => goToNavIndex(navIndex === -1 ? 0 : navIndex - 1);
  const handleNext = () => goToNavIndex(navIndex === -1 ? 0 : navIndex + 1);
  const handleLast = () => goToNavIndex(navPostedList.length - 1);

  // Preview of the Number a brand-new JV will get — jv_id is assigned the moment Save actually
  // creates the row (draft or posted alike), so this is a client-side preview only, correct as
  // long as nothing else inserts a JV between now and Save.
  const nextJvNoPreview = useMemo(
    () => Math.max(0, ...navVouchers.map(v => v.jv_id), ...unpostedJvs.map(v => v.jv_id)) + 1,
    [navVouchers, unpostedJvs]
  );

  // Toolbar's Find — a quick jump to any JV (posted or unposted) by number or reason, searched
  // client-side over the already-loaded browse/pending lists.
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const findResults = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = (v: { reason: string; jv_id: number }) =>
      v.reason.toLowerCase().includes(q) || String(v.jv_id).includes(q);
    const posted = navVouchers.filter(v => v.status === 'CONFIRMED' && matches(v));
    const unposted = unpostedJvs.filter(matches);
    return [
      ...posted.map(v => ({ jv_id: v.jv_id, reason: v.reason, date: v.jv_date, status: 'posted' as const })),
      ...unposted.map(v => ({ jv_id: v.jv_id, reason: v.reason, date: v.jv_date, status: 'unposted' as const })),
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
        onClick={() => { setActiveTab('entry'); handleNew(); }}
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
      <div className="mx-auto relative" style={{ maxWidth: 1200 }}>

        {/* Pending Posting — pinned outside the card's own left edge, matching PurchasePage's
            P-03/SaleBillPage's SB-06 sidebar exactly: enter a run of JVs first, post them all in
            one action at the end. Only shown from `2xl` up, same as Purchase/SaleBill — below
            that there usually isn't 280px of free margin for it to land in. */}
        {(unpostedJvs.length > 0 || postAllResult) && (
          <aside
            className="hidden 2xl:block absolute top-0 w-64 space-y-3"
            style={{ right: 'calc(100% + 24px)' }}
            data-no-print
          >
            <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl text-sm">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-slate-700">Pending Posting</span>
                <span className="text-xs bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full font-mono font-bold">
                  {unpostedJvs.length}
                </span>
              </div>
              <div className="text-xs text-slate-500 mb-3">
                {unpostedJvs.length > 0 && `Total ${formatCurrency(unpostedJvs.reduce((s, v) => s + Number(v.total_debit), 0))}`}
              </div>
              {unpostedJvs.length > 0 && (
                <button
                  type="button"
                  onClick={handlePostAll}
                  disabled={postAllBusy}
                  className="w-full px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {postAllBusy ? 'Posting…' : `Post All (${unpostedJvs.length})`}
                </button>
              )}

              {/* Stays until dismissed — a run can post 18 of 20, and the two that failed are the
                  whole point of the message. Never auto-hidden on a timer. */}
              {postAllResult && (
                <div className="mt-3 pt-3 border-t border-amber-200">
                  <p className="text-xs font-semibold text-slate-700">
                    {postAllResult.posted.length} of {postAllResult.attempted} posted
                    {postAllResult.failed.length > 0 && ` · ${postAllResult.failed.length} failed`}
                  </p>
                  {postAllResult.failed.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {postAllResult.failed.map(f => (
                        <li key={f.jv_id} className="text-xs text-rose-700">
                          <span className="font-mono font-semibold">{f.bill_no || `#${f.jv_id}`}</span>
                          {' — '}{f.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => setPostAllResult(null)}
                    className="mt-2 text-xs text-slate-500 hover:text-slate-700 font-semibold"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>

            {/* Flat list — every unposted JV, oldest first (same order the backend returns).
                Each row opens straight into the form for editing, with inline Post/Delete actions
                so a single ready one doesn't need to be opened first just to post it. */}
            {unpostedJvs.length > 0 && (
              <ul className="bg-white border border-slate-200 rounded-xl overflow-hidden max-h-[70vh] overflow-y-auto">
                {unpostedJvs.map(v => (
                  <li
                    key={v.jv_id}
                    onClick={() => handleOpenUnposted(v.jv_id)}
                    className="px-3 py-2.5 text-xs border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-amber-50/60 transition-colors"
                  >
                    <div className="min-w-0 flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-semibold text-slate-700">{v.voucher_no || `#${v.jv_id}`}</div>
                        <div className="text-slate-400 truncate">{v.reason}</div>
                        <div className="text-slate-400">{formatDate(v.jv_date)} · {formatCurrency(Number(v.total_debit))}</div>
                      </div>
                      <button
                        type="button"
                        title="Post this Journal Voucher"
                        onClick={(e) => handlePostOneUnposted(v.jv_id, e)}
                        disabled={postingJvId === v.jv_id}
                        className="flex-shrink-0 p-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                      >
                        <CheckCircle2 size={12} />
                      </button>
                      <button
                        type="button"
                        title="Delete this Journal Voucher (password required)"
                        onClick={(e) => handleDeleteUnposted(v.jv_id, e)}
                        disabled={postingJvId === v.jv_id}
                        className="flex-shrink-0 p-1 rounded bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}

        <PasswordPromptModal
          isOpen={isPasswordModalOpen}
          onClose={() => { setIsPasswordModalOpen(false); pendingDeleteJvId.current = null; }}
          onSuccess={handleDeletePasswordSuccess}
          title="Delete Unposted Journal Voucher"
          subtitle="Enter your password to permanently delete this unposted Journal Voucher."
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
                placeholder="Number or reason..."
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
                    <span className="font-mono font-semibold text-slate-700">#{r.jv_id}</span>
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
                  onClick={() => { setIsFindOpen(false); setFindQuery(''); }}
                  className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors text-sm font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {lookupError && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{lookupError}</div>}
        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>}

        {activeTab === 'entry' && (
        <>
        {/* Toolbar — icon-over-label buttons (`.toolbar-btn`), matching ref-pic jv2.0's own set
            exactly (per the user, 2026-08-26): New/Delete/Edit/Done, First/Previous/Next/Last,
            Print/Find, Un Post/Post. Every action always renders, only `disabled` changes per
            state, instead of whole button groups mounting/unmounting per mode. */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2.5 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-0.5">
            <button type="button" onClick={handleNew} title="New" className="toolbar-btn">
              <Plus size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>New</span>
            </button>
            <button
              type="button"
              onClick={handleDeleteAction}
              disabled={editingIndex != null ? isViewMode : (mode !== 'view' || jvId == null || isPosted)}
              title={editingIndex != null ? 'Delete selected line' : 'Delete'}
              className="toolbar-btn"
            >
              <Trash2 size={20} strokeWidth={2.5} className="text-rose-600" />
              <span>Delete</span>
            </button>
            <button
              type="button" onClick={() => setMode('edit')} disabled={!isViewMode || jvId == null || isPosted}
              title="Edit"
              className="toolbar-btn"
            >
              <Edit size={20} strokeWidth={2.5} className="text-sky-600" />
              <span>Edit</span>
            </button>
            <button
              type="submit" form="jv-entry-form" disabled={isViewMode || !isValid}
              title="Done"
              className="toolbar-btn"
            >
              <CheckCircle2 size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>Done</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button type="button" onClick={handleFirst} disabled={!canBrowse} title="First" className="toolbar-btn">
              <ChevronsLeft size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>First</span>
            </button>
            <button type="button" onClick={handlePrev} disabled={!canNavPrevious} title="Previous" className="toolbar-btn">
              <ChevronLeft size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Prev.</span>
            </button>
            <button type="button" onClick={handleNext} disabled={!canNavNext} title="Next" className="toolbar-btn">
              <ChevronRight size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Next</span>
            </button>
            <button type="button" onClick={handleLast} disabled={!canBrowse} title="Last" className="toolbar-btn">
              <ChevronsRight size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Last</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button
              type="button"
              onClick={() => window.print()}
              disabled={mode !== 'view' || jvId == null}
              title="Print"
              className="toolbar-btn"
            >
              <Printer size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>Print</span>
            </button>
            <button type="button" onClick={() => setIsFindOpen(true)} title="Find" className="toolbar-btn">
              <Search size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>Find</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button
              type="button" onClick={handleUnpost} disabled={!isViewMode || jvId == null || !isPosted || browseFilter !== 'unposted'}
              title="Un Post — switch the dropdown to Unposted first"
              className="toolbar-btn"
            >
              <Undo2 size={20} strokeWidth={2.5} className="text-rose-600" />
              <span>Un Post</span>
            </button>
            <button
              type="button" onClick={handlePost} disabled={!isViewMode || jvId == null || isPosted}
              title="Post"
              className="toolbar-btn"
            >
              <PackageCheck size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>Post</span>
            </button>
          </div>

          {/* Posted/Unposted — picks which list First/Prev./Next/Last page through. Same row as
              the toolbar icons (per the user, 2026-08-30), matching PurchasePage's own layout. */}
          <select
            value={browseFilter}
            onChange={e => setBrowseFilter(e.target.value as 'posted' | 'unposted')}
            className="soleria-input soleria-input-compact cursor-pointer font-semibold"
            style={{ width: 'auto' }}
            title="Posted = add new JVs. Unposted = browse posted JVs to Unpost one."
            data-no-print
          >
            <option value="posted">Posted</option>
            <option value="unposted">Unposted</option>
          </select>
        </div>

        {/* This <form> IS the entry card — height pinned to the remaining viewport space (see
            entryCardHeight above) and laid out as a flex column, so the line-items table below
            can flex-grow into whatever room that leaves. Every other child keeps its natural
            size (shrink-0) — only the table wrapper is flex-1. */}
        <form
          id="jv-entry-form" ref={entryCardRef} onSubmit={handleSave}
          className="card-white p-6 bg-white border flex flex-col" style={{ height: entryCardHeight ?? undefined }}
        >
          {/* Header row — "JOURNAL ENTRY" title. Master/Detail radios removed (per the user,
              2026-08-26) — display-only and didn't do anything, same reason they're gone from
              SaleBillPage too. */}
          <div className="shrink-0 flex items-center gap-2 border-b pb-3 mb-4">
            <BookText size={18} className="text-[#B08D57]" />
            <h3 className="font-lora font-bold text-lg tracking-wide text-slate-800">JOURNAL ENTRY</h3>
          </div>

          {/* Date / Number / Reason — banded row (the app's gold tint standing in for the legacy
              screen's grey bar) so the master fields read as one grouped strip, same as the
              picture's Date/Number/Remarks bar. Number is auto-generated by the system (jv_id) —
              per the user, 2026-08-26: "the number is auto generated by the system and must be
              shown to us" — read-only, previewing what Save will assign, same convention as
              SaleBillPage's own System No. */}
          <div
            className="shrink-0 grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 p-4 rounded-lg border"
            style={{ background: 'rgba(176,141,87,0.06)', borderColor: 'var(--border-color)' }}
          >
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Date <span className="text-red-500 font-bold">*</span>
              </label>
              <input
                ref={firstFieldRef} type="date" value={date} disabled={isViewMode}
                onChange={e => setDate(e.target.value)} className="soleria-input" style={{ fontSize: '13px' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Number</label>
              <input
                type="text"
                value={jvId != null ? `#${jvId}` : `#${nextJvNoPreview} (pending)`}
                disabled
                className="soleria-input bg-gray-50 text-gray-500 border-gray-200 font-mono"
                style={{ fontSize: '13px' }}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Reason <span className="text-red-500 font-bold">*</span>
              </label>
              <input
                type="text" value={reason} disabled={isViewMode} onChange={e => setReason(e.target.value)}
                placeholder="e.g. Eid compensation" className="soleria-input" style={{ fontSize: '13px' }}
              />
            </div>
          </div>

          {/* Entry strip (ref-pic jv2.0's own bound-record pattern) — A/C Code + Account
              Description + a single signed Amount on one row, Narration on the next. This is the
              ONE "current line" being typed; Enter on Narration commits it into the grid below
              (handleCommitLine) and resets the strip back to A/C Code. Clicking a grid row loads
              it back in here for editing. */}
          {!isViewMode && (
          <div className="shrink-0 mb-3 p-3 rounded-lg border" style={{ background: 'rgba(176,141,87,0.06)', borderColor: 'var(--border-color)' }}>
            <div className="grid gap-3 mb-2" style={{ gridTemplateColumns: '1fr 2fr 160px' }}>
              <div className="relative">
                <label className="block text-xs font-medium text-slate-600 mb-1">A/C Code <span className="text-red-500 font-bold">*</span></label>
                <input
                  ref={entryAccountTriggerRef}
                  type="text"
                  value={entry.baSearchText}
                  onChange={e => setEntry(prev => ({ ...prev, baSearchText: e.target.value }))}
                  onKeyDown={handleEntryAccountKeyDown}
                  placeholder="Type an account name, or press Enter to search..."
                  className="soleria-input pr-8"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  onClick={openEntryAccountModal}
                  title="Browse all accounts"
                  className="absolute right-2 bottom-2 p-0.5 text-slate-400 hover:text-slate-600"
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
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Account Description</label>
                <input
                  type="text"
                  value={accounts.find(a => String(a.ba_id) === entry.baId)?.name ?? ''}
                  disabled
                  placeholder="—"
                  className="soleria-input bg-gray-100 text-gray-500"
                  style={{ fontSize: '13px' }}
                />
              </div>
              <div>
                {/* Single signed Amount, not separate Debit/Credit boxes — per the user
                    (2026-08-26): "when we enter price if it is positive... we are doing credit
                    and if it's negative it is debit". handleCommitLine splits this into the
                    committed line's own debit/credit on Enter. */}
                <label className="block text-xs font-medium text-slate-600 mb-1">Amount <span className="text-red-500 font-bold">*</span></label>
                <input
                  type="number"
                  value={entry.amount || ''}
                  onChange={e => setEntry(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                  placeholder="+credit / -debit"
                  className="soleria-input font-mono text-right"
                  style={{ fontSize: '13px' }}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Narration</label>
              <input
                type="text"
                value={entry.narration}
                onChange={e => setEntry(prev => ({ ...prev, narration: e.target.value }))}
                onKeyDown={handleEntryLastFieldKeyDown}
                placeholder="Optional note for this line..."
                className="soleria-input"
                style={{ fontSize: '13px' }}
              />
            </div>
            {editingIndex != null && (
              <div className="mt-2 flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs">
                <span className="text-blue-700 font-semibold">Editing an existing line — commit (Enter on Narration) to save, or cancel.</span>
                <button type="button" onClick={() => { setEditingIndex(null); setEntry(emptyEntry()); }} className="text-blue-600 hover:text-blue-800 font-semibold underline">
                  Cancel
                </button>
              </div>
            )}
            <div className="mt-2">
              <button type="button" onClick={handleCommitLine} className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d]">
                {editingIndex != null ? 'Update Line' : 'Add Line'}
              </button>
            </div>
          </div>
          )}

          {/* Committed lines — read-only grid, matching ref-pic's own columns exactly. Click a
              row to load it back into the entry strip above for editing. No per-row delete —
              that's the toolbar's own Delete button, enabled only while a row is selected. */}
          <div className="flex-1 min-h-0 mb-4 rounded-lg border bg-white overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 pl-4" style={{ minWidth: '160px' }}>A/C Code</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3">Account Description</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3">Narration</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-right" style={{ width: '140px' }}>Debit (NAAM)</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-right" style={{ width: '140px' }}>Credit (JAMMA)</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => {
                  const selectedAccount = accounts.find(a => a.ba_id === Number(line.baId));
                  return (
                    <tr
                      key={line.uid}
                      onClick={() => handleRowClick(idx)}
                      className={`border-b cursor-pointer hover:bg-slate-50/55 transition-colors ${idx === editingIndex ? 'bg-blue-50' : ''}`}
                      style={{ borderColor: 'var(--border-table)' }}
                    >
                      <td className="p-2 pl-4 font-mono text-xs text-slate-600">{selectedAccount?.code ?? '—'}</td>
                      <td className="p-2 text-xs text-slate-800 font-semibold">
                        {selectedAccount ? selectedAccount.name : (line.baSearchText || '—')}
                      </td>
                      <td className="p-2 text-xs text-slate-600">{line.narration || '—'}</td>
                      <td className="p-2 text-right font-mono text-sm text-slate-700">{line.debit > 0 ? formatCurrency(line.debit) : '-'}</td>
                      <td className="p-2 text-right font-mono text-sm text-slate-700">{line.credit > 0 ? formatCurrency(line.credit) : '-'}</td>
                    </tr>
                  );
                })}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-3 text-center text-xs text-slate-400">
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
              <input type="text" value={formatCurrency(totals.totalCredit)} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-700 text-right font-mono font-semibold" style={{ width: '130px' }} />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Net Total</label>
              <input
                type="text"
                value={formatCurrency(totals.difference)}
                disabled
                className="soleria-input soleria-input-compact text-right font-mono font-bold"
                style={totals.difference === 0
                  ? { width: '140px', color: 'var(--brand-gold)', background: '#111c2a', borderColor: '#334155' }
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
                  placeholder="Search by account, reason, number, narration, amount..." className="soleria-input pl-8 py-1.5 text-xs w-80"
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
                    <th className="p-3">Reason</th>
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
