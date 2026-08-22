import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type {
  BusinessAccountRow, JournalVoucherRow, JournalVoucherLineInput, JournalVoucherCreateInput,
  UnpostedJournalVoucherRow, PostAllResult,
} from '@/lib/api';
import { formatDate, getTodayDate } from '@/lib/utils';
import { Save, Edit, Search, Plus, Trash2, BookText, ChevronDown, CheckCircle2 } from 'lucide-react';
import PasswordPromptModal from '@/components/PasswordPromptModal';

/**
 * Journal Voucher — a real multi-line double-entry journal (legacy "Journal Entry" screen): N
 * lines, each against its own business account, each a debit OR a credit, that together must net
 * to zero. There is no fixed counter-account — every line names a real account, so each one's own
 * ledger (the existing Ledger screen) shows exactly what a JV moved through it and why.
 */

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

interface UiLine {
  uid: string;
  baId: string;
  debit: number;
  credit: number;
  narration: string;
}

function emptyLine(): UiLine {
  return {
    uid: 'jvl_' + Date.now() + Math.random().toString(36).slice(2, 7),
    baId: '', debit: 0, credit: 0, narration: '',
  };
}

export default function JournalVoucherPage() {
  const [accounts, setAccounts] = useState<BusinessAccountRow[]>([]);
  const [vouchers, setVouchers] = useState<JournalVoucherRow[]>([]);
  const [lookupError, setLookupError] = useState('');

  // Smart default: the common case is one real party account plus a write-off, so an untouched
  // 2nd line auto-fills to this account balancing the 1st (matches jv2.0.jpeg's own example —
  // one line credits a customer, the other debits DISCOUNTS, CLAIMS & COMMISSIONS). Just a
  // convenience, not a fixed model: the user can still edit/remove that line or add more lines
  // for a real multi-account journal — see the auto-balance effect below.
  const [counterAccount, setCounterAccount] = useState<BusinessAccountRow | null>(null);

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
    (async () => {
      const ca = await api.journalVouchers.counterAccount();
      if (ca.ok) setCounterAccount(ca.data);
      // Not fatal if this fails — the smart default just won't fire; manual multi-line entry
      // still works fine without it.
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
  };

  // Recorded Journal Vouchers moved to its own tab (was inline below the live entry form on the
  // same page — every JV ever recorded rendering directly under a live entry form doesn't scale
  // and pushed the whole page well past one screen). Mirrors PurchasePage/SaleBillPage.
  const [activeTab, setActiveTab] = useState<'entry' | 'records'>('entry');

  // ── entry form ──
  const [mode, setMode] = useState<'new' | 'edit' | 'view'>('new');
  const [jvId, setJvId] = useState<number | null>(null);
  const [status, setStatus] = useState<'CONFIRMED' | 'DRAFT'>('DRAFT');
  const [date, setDate] = useState(getTodayDate());
  const [voucherNo, setVoucherNo] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<UiLine[]>([emptyLine(), emptyLine()]);
  // Turns off the 2nd-line auto-balance once the user edits that line themselves (it's their
  // line now, not ours to keep overwriting) — see the auto-balance effect below.
  const [secondLineTouched, setSecondLineTouched] = useState(false);

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
    setDate(getTodayDate()); setVoucherNo(''); setReason('');
    setLines([emptyLine(), emptyLine()]);
    setSecondLineTouched(false);
    setErrorMsg('');
  };

  const updateLine = (uid: string, field: keyof UiLine, value: string | number) => {
    const idx = lines.findIndex(l => l.uid === uid);
    // Editing the 2nd line directly, while it's still the auto-balance slot, hands it over to
    // the user — the effect below stops overwriting it from this point on.
    if (idx === 1 && lines.length === 2) setSecondLineTouched(true);
    setLines(prev => prev.map(l => {
      if (l.uid !== uid) return l;
      const updated = { ...l, [field]: value };
      // Single-sided per line, matching ledger_entries — typing one clears the other.
      if (field === 'debit' && Number(value) > 0) updated.credit = 0;
      if (field === 'credit' && Number(value) > 0) updated.debit = 0;
      return updated;
    }));
  };

  const addLine = () => setLines(prev => [...prev, emptyLine()]);
  const removeLine = (uid: string) => setLines(prev => prev.length > 2 ? prev.filter(l => l.uid !== uid) : prev);

  const totals = useMemo(() => {
    const totalDebit = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const totalCredit = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
    return { totalDebit, totalCredit, difference: round2(totalDebit - totalCredit) };
  }, [lines]);

  // Smart default: with exactly 2 lines and the 2nd untouched, keep it mirroring the 1st line's
  // account+amount on the opposite side against the counter-account. Stops the moment the user
  // edits that line themselves (secondLineTouched), adds/removes lines, or in view mode.
  useEffect(() => {
    if (isViewMode || secondLineTouched || lines.length !== 2 || !counterAccount) return;
    const [first, second] = lines;
    const firstAmount = Number(first.debit) || Number(first.credit) || 0;
    if (!first.baId || firstAmount <= 0) return;
    const wantDebit = Number(first.credit) > 0 ? firstAmount : 0;
    const wantCredit = Number(first.debit) > 0 ? firstAmount : 0;
    const counterBaId = String(counterAccount.ba_id);
    if (second.baId === counterBaId && Number(second.debit) === wantDebit && Number(second.credit) === wantCredit) return;
    setLines(prev => prev.map((l, i) => i === 1 ? { ...l, baId: counterBaId, debit: wantDebit, credit: wantCredit } : l));
  }, [lines, secondLineTouched, counterAccount, isViewMode]);

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
      setErrorMsg(`Total debit (${totals.totalDebit}) must equal total credit (${totals.totalCredit}).`); return null;
    }
    const payloadLines: JournalVoucherLineInput[] = lines.map(l => ({
      ba_id: Number(l.baId),
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      narration: l.narration.trim() || undefined,
    }));
    return {
      jv_date: date, voucher_no: voucherNo.trim() || undefined,
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
    refresh();
    refreshUnposted();
  };

  const handlePost = async () => {
    if (jvId == null) return;
    const res = await api.journalVouchers.post(jvId);
    if (!res.ok) { fail('Failed to post: ' + res.error.message); return; }
    setStatus(res.data.status);
    flash('Journal Voucher posted — every line\'s ledger updated.');
    refresh();
    refreshUnposted();
  };

  const handleUnpost = async () => {
    if (jvId == null) return;
    const res = await api.journalVouchers.unpost(jvId);
    if (!res.ok) { fail('Failed to unpost: ' + res.error.message); return; }
    setStatus(res.data.status);
    flash('Journal Voucher unposted.');
    refresh();
    refreshUnposted();
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
    setVoucherNo(jv.voucher_no || '');
    setReason(jv.reason);
    setLines((jv.lines || []).map(l => ({
      uid: 'jvl_' + l.line_id,
      baId: String(l.ba_id),
      debit: l.debit,
      credit: l.credit,
      narration: l.narration || '',
    })));
    // Loaded data is already whatever it is — the auto-balance effect must not overwrite an
    // existing voucher's 2nd line just because it happens to still look untouched.
    setSecondLineTouched(true);
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
  };

  // Entry card fills whatever vertical space is left in the viewport below it (mirrors
  // SaleBillPage/PurchasePage) — the line-items table (flex-1 inside it) grows into that space,
  // and the outer app window never scrolls (only the table does). Measured via
  // getBoundingClientRect rather than a CSS calc() of fixed chrome heights, since the banners
  // above this form change height dynamically.
  const entryCardRef = useRef<HTMLFormElement>(null);
  const [entryCardHeight, setEntryCardHeight] = useState<number | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

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

  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      <button
        onClick={() => { setActiveTab('entry'); handleNew(); }}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
          activeTab === 'entry' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        New Journal Voucher
      </button>
      <button
        onClick={() => setActiveTab('records')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
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

        {lookupError && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{lookupError}</div>}
        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>}

        {activeTab === 'entry' && (
        <>
        {/* Toolbar — standalone row above the card, matching PurchasePage/SaleBillPage: every
            action always renders, only `disabled` changes per state, instead of whole button
            groups mounting/unmounting per mode. */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2.5 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap gap-2">
            <button
              type="button" onClick={handleNew}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all"
            >
              New JV
            </button>
            <button
              type="submit" form="jv-entry-form" disabled={isViewMode || !isValid}
              className="btn-gold flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              <Save size={14} /> {mode === 'edit' ? 'Update JV' : 'Save JV'}
            </button>
            <button
              type="button"
              onClick={() => { if (jvId != null) loadJv(jvId); }}
              disabled={mode !== 'edit'}
              className="btn-outline px-3 py-1.5 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              Cancel Edit
            </button>
            <button
              type="button" onClick={() => setMode('edit')} disabled={!isViewMode || isPosted}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] border border-[#B08D57] shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              <Edit size={13} /> Edit
            </button>
            <button
              type="button" onClick={handlePost} disabled={!isViewMode || jvId == null || isPosted}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              Post
            </button>
            <button
              type="button" onClick={handleUnpost} disabled={!isViewMode || jvId == null || !isPosted}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            >
              Unpost
            </button>
          </div>
          {/* Status now lives in the card's own "Voucher Status" readout below — just the
              identity label here, matching Purchase/SaleBill's toolbar shape (buttons only). */}
          <span className="font-lora font-bold text-xs text-slate-900">
            {mode === 'edit' ? `Editing JV #${jvId}` : mode === 'view' ? `JV #${jvId}` : 'New Journal Voucher'}
          </span>
        </div>

        {/* This <form> IS the entry card — height pinned to the remaining viewport space (see
            entryCardHeight above) and laid out as a flex column, so the line-items table below
            can flex-grow into whatever room that leaves. Every other child keeps its natural
            size (shrink-0) — only the table wrapper is flex-1. */}
        <form
          id="jv-entry-form" ref={entryCardRef} onSubmit={handleSave}
          className="card-white p-6 bg-white border flex flex-col" style={{ height: entryCardHeight ?? undefined }}
          data-no-print
        >
          {/* Header row — "JOURNAL ENTRY" title (left) + a Voucher Status readout styled like a
              disabled select (right), mirroring the legacy Journal Entry screen's own title/
              status row, in the app's own navy/gold palette rather than the legacy grey chrome. */}
          <div className="shrink-0 flex items-center justify-between gap-4 border-b pb-3 mb-4">
            <div className="flex items-center gap-2">
              <BookText size={18} className="text-[#B08D57]" />
              <h3 className="font-lora font-bold text-lg tracking-wide text-slate-800">JOURNAL ENTRY</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Voucher Status</span>
              <span
                className={`flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-lg border text-xs font-bold ${
                  isPosted ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
                title={isPosted ? 'Posted — live in the ledger' : 'Saved but not yet in the ledger — Post it to move any balance.'}
              >
                {isPosted ? 'Posted' : 'UnPosted'}
                <ChevronDown size={12} className="opacity-50" />
              </span>
            </div>
          </div>

          {/* Date / Number / Reason — banded row (the app's gold tint standing in for the legacy
              screen's grey bar) so the master fields read as one grouped strip, same as the
              picture's Date/Number/Remarks bar. */}
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
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Number <span className="text-slate-400 font-normal normal-case">— optional</span>
              </label>
              <input
                type="text" value={voucherNo} disabled={isViewMode} onChange={e => setVoucherNo(e.target.value)}
                placeholder="Manual voucher #..." className="soleria-input" style={{ fontSize: '13px' }}
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

          {/* Line items — flex-1 so it grows to fill whatever space entryCardHeight (above)
              leaves after every other section takes its natural size (same treatment as
              PurchasePage/SaleBillPage's item tables). The header row is sticky within the
              scroll box so column labels stay visible past the first screenful of rows. */}
          <div className="flex-1 min-h-0 mb-4 rounded-lg border bg-white overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 pl-4" style={{ minWidth: '220px' }}>A/C Code</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3">Account Description</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3">Narration</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-right" style={{ width: '140px' }}>Debit (NAAM)</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-3 text-right" style={{ width: '140px' }}>Credit (JAMMA)</th>
                  {!isViewMode && <th className="sticky top-0 z-10 bg-slate-50 p-3" style={{ width: '50px' }}></th>}
                </tr>
              </thead>
              <tbody>
                {lines.map(line => {
                  const selectedAccount = accounts.find(a => a.ba_id === Number(line.baId));
                  return (
                    <tr key={line.uid} className="border-b hover:bg-slate-50/55 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-2 pl-4">
                        <SearchableSelect
                          options={accountOptions} value={line.baId}
                          onChange={v => updateLine(line.uid, 'baId', v)}
                          placeholder="Search account..." disabled={isViewMode}
                        />
                      </td>
                      <td className="p-2 text-xs text-slate-600 font-medium">
                        {selectedAccount ? `${selectedAccount.name} (${selectedAccount.code})` : '—'}
                      </td>
                      <td className="p-2">
                        <input type="text" value={line.narration} disabled={isViewMode}
                          onChange={e => updateLine(line.uid, 'narration', e.target.value)}
                          placeholder="Optional note for this line..." className="soleria-input text-xs" />
                      </td>
                      <td className="p-2">
                        <input type="number" min={0} value={line.debit || ''} disabled={isViewMode}
                          onChange={e => updateLine(line.uid, 'debit', Math.max(0, parseInt(e.target.value) || 0))}
                          placeholder="0" className="soleria-input font-mono text-right" />
                      </td>
                      <td className="p-2">
                        <input type="number" min={0} value={line.credit || ''} disabled={isViewMode}
                          onChange={e => updateLine(line.uid, 'credit', Math.max(0, parseInt(e.target.value) || 0))}
                          placeholder="0" className="soleria-input font-mono text-right" />
                      </td>
                      {!isViewMode && (
                        <td className="p-2 text-center">
                          <button type="button" onClick={() => removeLine(line.uid)} disabled={lines.length <= 2}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="Remove Row">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                  <td colSpan={3} className="p-3 pl-4 text-right font-lora">Net Total</td>
                  <td className="p-3 text-right font-mono text-emerald-800">{formatCurrency(totals.totalDebit)}</td>
                  <td className="p-3 text-right font-mono text-rose-800">{formatCurrency(totals.totalCredit)}</td>
                  {!isViewMode && <td />}
                </tr>
                {totals.difference !== 0 && (
                  <tr>
                    <td colSpan={isViewMode ? 5 : 6} className="p-2 pl-4 text-xs font-semibold text-rose-600">
                      Out of balance by {formatCurrency(Math.abs(totals.difference))} — debit and credit must match before saving.
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>

          {!isViewMode && (
            <button type="button" onClick={addLine} className="shrink-0 btn-outline flex items-center gap-1.5 px-4 py-2 text-sm">
              <Plus size={16} /> Add Line
            </button>
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
