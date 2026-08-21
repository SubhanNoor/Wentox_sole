import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type {
  BusinessAccountRow, JournalVoucherRow, JournalVoucherLineInput, JournalVoucherCreateInput,
} from '@/lib/api';
import { formatDate, getTodayDate } from '@/lib/utils';
import { Save, Edit, Search, Plus, Trash2 } from 'lucide-react';

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

  const refresh = useCallback(async () => {
    const res = await api.journalVouchers.list({});
    if (res.ok) setVouchers(res.data);
    else setLookupError('Failed to load journal vouchers: ' + res.error.message);
  }, []);

  useEffect(() => {
    (async () => {
      const ba = await api.listBusinessAccounts();
      if (ba.ok) setAccounts(ba.data); else setLookupError('Failed to load accounts: ' + ba.error.message);
    })();
    refresh();
  }, [refresh]);

  // ── entry form ──
  const [mode, setMode] = useState<'new' | 'edit' | 'view'>('new');
  const [jvId, setJvId] = useState<number | null>(null);
  const [status, setStatus] = useState<'CONFIRMED' | 'DRAFT'>('DRAFT');
  const [date, setDate] = useState(getTodayDate());
  const [voucherNo, setVoucherNo] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<UiLine[]>([emptyLine(), emptyLine()]);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const isViewMode = mode === 'view';
  const isPosted = status === 'CONFIRMED';

  // JV-02: search + filter on the journal voucher listing.
  const [jvSearch, setJvSearch] = useState('');
  const [jvStatusFilter, setJvStatusFilter] = useState<'all' | 'CONFIRMED' | 'DRAFT'>('all');

  const accountOptions = useMemo(
    () => accounts.map(a => ({ value: String(a.ba_id), label: `${a.name} (${a.code})` })),
    [accounts]
  );

  const filteredVouchers = useMemo(() => {
    return vouchers.filter(v => {
      if (jvStatusFilter !== 'all' && v.status !== jvStatusFilter) return false;
      if (jvSearch.trim()) {
        const q = jvSearch.trim().toLowerCase();
        const matches = (v.reason || '').toLowerCase().includes(q) || (v.voucher_no || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [vouchers, jvSearch, jvStatusFilter]);

  const handleNew = () => {
    setMode('new'); setJvId(null); setStatus('DRAFT');
    setDate(getTodayDate()); setVoucherNo(''); setReason('');
    setLines([emptyLine(), emptyLine()]);
    setErrorMsg('');
  };

  const updateLine = (uid: string, field: keyof UiLine, value: string | number) => {
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
  };

  const handlePost = async () => {
    if (jvId == null) return;
    const res = await api.journalVouchers.post(jvId);
    if (!res.ok) { fail('Failed to post: ' + res.error.message); return; }
    setStatus(res.data.status);
    flash('Journal Voucher posted — every line\'s ledger updated.');
    refresh();
  };

  const handleUnpost = async () => {
    if (jvId == null) return;
    const res = await api.journalVouchers.unpost(jvId);
    if (!res.ok) { fail('Failed to unpost: ' + res.error.message); return; }
    setStatus(res.data.status);
    flash('Journal Voucher unposted.');
    refresh();
  };

  // Listing rows only carry rolled-up totals (line_count/total_debit/total_credit), not the
  // per-line detail — a click fetches the full voucher (with lines) to hydrate the form.
  const loadRow = async (row: JournalVoucherRow) => {
    const res = await api.journalVouchers.get(row.jv_id);
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
    setErrorMsg('');
    setMode('view');
  };

  return (
    <AppLayout pageTitle="Journal Voucher">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {lookupError && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">{lookupError}</div>}
        {successMsg && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">{successMsg}</div>}
        {errorMsg && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">{errorMsg}</div>}

        {/* Toolbar — Save/Edit/Post/Unpost/New JV live in one dedicated bar above the card, same
            shape as the Receipts/Expenses/Sale Bill toolbars. */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 p-4 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }}>
          <div className="flex flex-wrap gap-2">
            {!isViewMode && (
              <button
                type="submit" form="jv-entry-form" disabled={!isValid}
                className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={16} /> {mode === 'edit' ? 'Update JV' : 'Save JV'}
              </button>
            )}
            {mode === 'view' && !isPosted && (
              <button type="button" onClick={() => setMode('edit')} className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all flex items-center gap-1.5">
                <Edit size={14} /> Edit
              </button>
            )}
            {mode === 'view' && jvId != null && (
              isPosted
                ? <button type="button" onClick={handleUnpost} className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-all">Unpost</button>
                : <button type="button" onClick={handlePost} className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all">Post</button>
            )}
            <button type="button" onClick={handleNew} className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all">
              New JV
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-lora font-bold text-sm text-slate-900">
              {mode === 'edit' ? `Editing JV #${jvId}` : mode === 'view' ? `JV #${jvId}` : 'New Journal Voucher'}
            </span>
            {jvId != null && (
              isPosted
                ? <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">Posted</span>
                : <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-900" title="Saved but not yet in the ledger — Post it to move any balance.">Not Posted</span>
            )}
          </div>
        </div>

        <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm mb-6">
          <p className="text-xs text-slate-500 mb-5 leading-relaxed">
            A real double-entry journal — every line names an account and either a debit or a
            credit, and the whole voucher must net to zero before it can be saved. Each line's
            own ledger (the account's Ledger screen) shows exactly what this JV moved through it.
          </p>

          <form id="jv-entry-form" onSubmit={handleSave}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 mb-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
                  <input type="date" value={date} disabled={isViewMode} onChange={e => setDate(e.target.value)} className="soleria-input font-semibold" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Number <span className="text-slate-400 font-normal normal-case">— optional</span>
                  </label>
                  <input type="text" value={voucherNo} disabled={isViewMode} onChange={e => setVoucherNo(e.target.value)}
                    placeholder="Manual voucher #..." className="soleria-input font-semibold" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Reason <span className="text-red-500 font-bold">*</span>
                </label>
                <input type="text" value={reason} disabled={isViewMode} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Eid compensation" className="soleria-input font-semibold" />
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4 w-64">A/C Code</th>
                    <th className="p-3">Narration</th>
                    <th className="p-3 text-right w-36">Debit</th>
                    <th className="p-3 text-right w-36">Credit</th>
                    {!isViewMode && <th className="p-3 w-12"></th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => (
                    <tr key={line.uid} className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-2 pl-4">
                        <SearchableSelect
                          options={accountOptions} value={line.baId}
                          onChange={v => updateLine(line.uid, 'baId', v)}
                          placeholder="Search account..." disabled={isViewMode}
                        />
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
                            className="text-rose-500 hover:text-rose-700 disabled:opacity-30 disabled:cursor-not-allowed">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                    <td colSpan={2} className="p-3 pl-4 text-right font-lora">Net Total</td>
                    <td className="p-3 text-right font-mono text-emerald-800">{formatCurrency(totals.totalDebit)}</td>
                    <td className="p-3 text-right font-mono text-rose-800">{formatCurrency(totals.totalCredit)}</td>
                    {!isViewMode && <td />}
                  </tr>
                  {totals.difference !== 0 && (
                    <tr>
                      <td colSpan={isViewMode ? 4 : 5} className="p-2 pl-4 text-xs font-semibold text-rose-600">
                        Out of balance by {formatCurrency(Math.abs(totals.difference))} — debit and credit must match before saving.
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>

            {!isViewMode && (
              <button type="button" onClick={addLine} className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all">
                <Plus size={14} /> Add Line
              </button>
            )}
          </form>
        </div>

        <div className="card-white p-6 bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="font-lora font-bold text-base text-slate-900">Recorded Journal Vouchers</h3>
            {/* JV-02: search + filter the listing. */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                <input
                  type="text"
                  value={jvSearch}
                  onChange={e => setJvSearch(e.target.value)}
                  placeholder="Search reason, number..."
                  className="soleria-input pl-8 py-1.5 text-xs w-64"
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
                {filteredVouchers.length === 0 ? (
                  <tr><td colSpan={6} className="text-center p-8 text-slate-400">{vouchers.length === 0 ? 'No journal vouchers recorded yet.' : 'No journal vouchers match your search/filter.'}</td></tr>
                ) : filteredVouchers.map(v => (
                  <tr key={v.jv_id} onClick={() => loadRow(v)} className="border-b hover:bg-slate-50/50 cursor-pointer" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4 text-xs font-mono text-slate-600">{formatDate(v.jv_date)}</td>
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
        </div>

      </div>
    </AppLayout>
  );
}
