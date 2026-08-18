import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency, balanceColor } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import AccountBalancePanel from '@/components/AccountBalancePanel';
import * as api from '@/lib/api';
import type {
  BusinessAccountRow, JournalVoucherRow, JournalVoucherCreateInput, LedgerRow,
} from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Save, Edit, Search } from 'lucide-react';

/**
 * Journal Voucher — goodwill written off a party's balance ("eidi" on what a customer owes, or a
 * concession a vendor grants us). Not commission, which only exists attached to a receipt.
 *
 * CREDIT reduces what the party owes us; DEBIT reduces what we owe them. The other leg always
 * lands on the JOURNAL VOUCHER business account, so the Ledger tab below answers "what have we
 * given away in JVs" from a real account rather than a derived total.
 */

type JvTab = 'entry' | 'ledger';

const today = () => new Date().toISOString().split('T')[0];

export default function JournalVoucherPage() {
  const [activeTab, setActiveTab] = useState<JvTab>('entry');

  const [accounts, setAccounts] = useState<BusinessAccountRow[]>([]);
  const [jvAccount, setJvAccount] = useState<BusinessAccountRow | null>(null);
  const [vouchers, setVouchers] = useState<JournalVoucherRow[]>([]);
  const [lookupError, setLookupError] = useState('');

  const refresh = useCallback(async () => {
    const res = await api.journalVouchers.list({});
    if (res.ok) setVouchers(res.data);
    else setLookupError('Failed to load journal vouchers: ' + res.error.message);
  }, []);

  useEffect(() => {
    (async () => {
      const [ba, jv] = await Promise.all([api.listBusinessAccounts(), api.journalVouchers.account()]);
      if (ba.ok) setAccounts(ba.data); else setLookupError('Failed to load accounts: ' + ba.error.message);
      if (jv.ok) setJvAccount(jv.data); else setLookupError('Failed to load the JV account: ' + jv.error.message);
    })();
    refresh();
  }, [refresh]);

  // ── entry form ──
  const [mode, setMode] = useState<'new' | 'edit' | 'view'>('new');
  const [jvId, setJvId] = useState<number | null>(null);
  const [status, setStatus] = useState<'CONFIRMED' | 'DRAFT'>('DRAFT');
  const [date, setDate] = useState(today());
  const [baId, setBaId] = useState('');
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [amount, setAmount] = useState<number>(0);
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const isViewMode = mode === 'view';
  const isPosted = status === 'CONFIRMED';

  // JV-02: search + filter on the journal voucher listing.
  const [jvSearch, setJvSearch] = useState('');
  const [jvStatusFilter, setJvStatusFilter] = useState<'all' | 'CONFIRMED' | 'DRAFT'>('all');

  // The JV account itself is excluded — both legs would land on it, which the service rejects too.
  const accountOptions = useMemo(
    () => accounts
      .filter(a => a.ba_id !== jvAccount?.ba_id)
      .map(a => ({ value: String(a.ba_id), label: `${a.name} (${a.code})` })),
    [accounts, jvAccount]
  );
  const accountName = useCallback(
    (id: number) => accounts.find(a => a.ba_id === id)?.name || 'Unknown Account',
    [accounts]
  );

  const filteredVouchers = useMemo(() => {
    return vouchers.filter(v => {
      if (jvStatusFilter !== 'all' && v.status !== jvStatusFilter) return false;
      if (jvSearch.trim()) {
        const q = jvSearch.trim().toLowerCase();
        const accName = (v.ba_name || accountName(v.ba_id)).toLowerCase();
        const matches = accName.includes(q) || (v.reason || '').toLowerCase().includes(q) || (v.remarks || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [vouchers, jvSearch, jvStatusFilter, accountName]);

  const handleNew = () => {
    setMode('new'); setJvId(null); setStatus('DRAFT');
    setDate(today()); setBaId(''); setDirection('CREDIT'); setAmount(0); setReason(''); setRemarks('');
    setErrorMsg('');
  };

  const buildPayload = (): JournalVoucherCreateInput | null => {
    if (!date) { setErrorMsg('Please pick a date.'); return null; }
    if (!baId) { setErrorMsg('Select the account this JV applies to.'); return null; }
    if (amount <= 0) { setErrorMsg('Amount must be greater than 0.'); return null; }
    if (!reason.trim()) { setErrorMsg('A reason is required — a JV without one cannot be explained later.'); return null; }
    return {
      jv_date: date, ba_id: Number(baId), direction, amount,
      reason: reason.trim(), remarks: remarks.trim() || undefined,
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
    flash('Journal Voucher saved — Post it to update both ledgers.');
    setMode('view');
    refresh();
  };

  const handlePost = async () => {
    if (jvId == null) return;
    const res = await api.journalVouchers.post(jvId);
    if (!res.ok) { fail('Failed to post: ' + res.error.message); return; }
    setStatus(res.data.status);
    flash('Journal Voucher posted — both ledgers updated.');
    refresh();
    setBalanceRefreshKey(k => k + 1);
  };

  const handleUnpost = async () => {
    if (jvId == null) return;
    const res = await api.journalVouchers.unpost(jvId);
    if (!res.ok) { fail('Failed to unpost: ' + res.error.message); return; }
    setStatus(res.data.status);
    flash('Journal Voucher unposted.');
    refresh();
    setBalanceRefreshKey(k => k + 1);
  };

  const loadRow = (row: JournalVoucherRow) => {
    setJvId(row.jv_id);
    setStatus(row.status);
    setDate(row.jv_date.slice(0, 10));
    setBaId(String(row.ba_id));
    setDirection(row.direction);
    setAmount(row.amount);
    setReason(row.reason);
    setRemarks(row.remarks || '');
    setErrorMsg('');
    setMode('view');
    setActiveTab('entry');
  };

  // ── JV account ledger ──
  // Stored WITH the refresh key it was fetched for, so "is this stale?" is derived rather than
  // tracked in a second state that has to be set synchronously inside the effect (which would trip
  // react-hooks/set-state-in-effect and briefly show the previous figures after a post).
  const [ledger, setLedger] = useState<{
    key: number; rows: LedgerRow[]; total_debit: number; total_credit: number; closing_balance: number;
  } | null>(null);

  useEffect(() => {
    if (activeTab !== 'ledger' || !jvAccount) return;
    let cancelled = false;
    api.reports.accountLedger({ ba_id: jvAccount.ba_id }).then(res => {
      if (cancelled) return;
      if (res.ok) setLedger({ key: balanceRefreshKey, ...res.data });
      else setLookupError('Failed to load the JV ledger: ' + res.error.message);
    });
    return () => { cancelled = true; };
  }, [activeTab, jvAccount, balanceRefreshKey]);

  const ledgerReady = ledger?.key === balanceRefreshKey ? ledger : null;

  const tabButton = (key: JvTab, label: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(key)}
      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
        activeTab === key ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );

  // Sub-tab switcher — lives in the top header bar next to the page title (AppLayout's
  // headerAction slot), same treatment as Sale Bill/Receipts/Expenses/Cheque/Reports/SalaryRun.
  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      {tabButton('entry', 'Journal Voucher Entry')}
      {tabButton('ledger', 'JV Ledger')}
    </div>
  );

  return (
    <AppLayout pageTitle="Journal Voucher" headerAction={tabBar}>
      <div className="mx-auto" style={{ maxWidth: 1100 }}>

        {lookupError && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">{lookupError}</div>}
        {successMsg && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">{successMsg}</div>}
        {errorMsg && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">{errorMsg}</div>}

        {activeTab === 'entry' && (
          <>
            {/* Toolbar — Save/Edit/Post/Unpost/New JV live in one dedicated bar above the card, same
                shape as the Receipts/Expenses/Sale Bill toolbars. "Save JV" submits the form below
                via the form="" attribute since the button itself sits outside it. */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6 p-4 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }}>
              <div className="flex flex-wrap gap-2">
                {!isViewMode && (
                  <button
                    type="submit"
                    form="jv-entry-form"
                    className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg"
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
                Writes goodwill off an account's balance — an <em>eidi</em> on what a customer owes,
                or a concession a vendor grants you. The other side lands on the{' '}
                <strong>{jvAccount?.name || 'JOURNAL VOUCHER'}</strong> account, so every JV is
                visible in one place on the Ledger tab. This is <strong>not</strong> commission,
                which only exists attached to a receipt.
              </p>

              <form id="jv-entry-form" onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 md:items-start">
                {/* Direction — its own full-width row so Date and the balance panel line up as the
                    first row of the two columns below, same shape as the Credit/Debit switch on the
                    Transfer Cash page. */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Direction</label>
                  <div className="grid grid-cols-2 gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                    <button
                      type="button" disabled={isViewMode} onClick={() => setDirection('CREDIT')}
                      className={`py-2 rounded-md transition-all ${direction === 'CREDIT' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600'}`}
                    >
                      Credit — reduce what they owe you
                    </button>
                    <button
                      type="button" disabled={isViewMode} onClick={() => setDirection('DEBIT')}
                      className={`py-2 rounded-md transition-all ${direction === 'DEBIT' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600'}`}
                    >
                      Debit — reduce what you owe them
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
                    <input type="date" value={date} disabled={isViewMode} onChange={e => setDate(e.target.value)} className="soleria-input font-semibold" />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Account <span className="text-red-500 font-bold">*</span>
                      <span className="text-slate-400 font-normal normal-case ml-1">— any account, not just customers</span>
                    </label>
                    <SearchableSelect options={accountOptions} value={baId} onChange={setBaId} placeholder="Search account..." disabled={isViewMode} />
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Amount (PKR)</label>
                    <input type="number" min={0} value={amount || ''} disabled={isViewMode}
                      onChange={e => setAmount(Math.max(0, parseInt(e.target.value) || 0))}
                      placeholder="Enter amount in Rs..." className="soleria-input font-semibold font-mono" />
                  </div>

                  {/* CREDIT lowers the party's balance, DEBIT raises it — the panel shows which. */}
                  <AccountBalancePanel
                    baId={baId ? Number(baId) : null}
                    refreshKey={balanceRefreshKey}
                    lines={[{ label: 'This voucher', delta: direction === 'CREDIT' ? -amount : amount }]}
                  />

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Reason <span className="text-red-500 font-bold">*</span>
                    </label>
                    <input type="text" value={reason} disabled={isViewMode} onChange={e => setReason(e.target.value)}
                      placeholder="e.g. Eid compensation" className="soleria-input font-semibold" />
                  </div>
                </div>

                {/* Remarks — full-width textarea below both columns, same shape as the Transfer
                    Cash page. */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks</label>
                  <textarea value={remarks} disabled={isViewMode} onChange={e => setRemarks(e.target.value)}
                    placeholder="Optional" className="soleria-input font-semibold" rows={4} style={{ resize: 'none' }} />
                </div>
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
                      placeholder="Search account, reason, remarks..."
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
                      <th className="p-3">Account</th>
                      <th className="p-3">Reason</th>
                      <th className="p-3 text-center">Direction</th>
                      <th className="p-3 text-right">Amount</th>
                      <th className="p-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVouchers.length === 0 ? (
                      <tr><td colSpan={6} className="text-center p-8 text-slate-400">{vouchers.length === 0 ? 'No journal vouchers recorded yet.' : 'No journal vouchers match your search/filter.'}</td></tr>
                    ) : filteredVouchers.map(v => (
                      <tr key={v.jv_id} onClick={() => loadRow(v)} className="border-b hover:bg-slate-50/50 cursor-pointer" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 text-xs font-mono text-slate-600">{formatDate(v.jv_date)}</td>
                        <td className="p-3 font-semibold text-slate-900">{v.ba_name || accountName(v.ba_id)}</td>
                        <td className="p-3 text-xs text-slate-500">{v.reason}</td>
                        <td className="p-3 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${v.direction === 'CREDIT' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>
                            {v.direction}
                          </span>
                        </td>
                        <td className="p-3 text-right font-bold font-mono text-slate-800">{formatCurrency(v.amount)}</td>
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
          </>
        )}

        {activeTab === 'ledger' && (
          <div className="card-white p-6 md:p-8 bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="flex items-center justify-between border-b pb-4 mb-6">
              <div>
                <h2 className="font-lora font-bold text-lg text-slate-900">{jvAccount?.name || 'JOURNAL VOUCHER'}</h2>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{jvAccount?.code}</p>
              </div>
              <div className="text-right">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Given in JVs</span>
                <span className="text-lg font-bold font-mono" style={{ color: 'var(--brand-navy)' }}>
                  {formatCurrency(ledgerReady?.closing_balance || 0)}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Date</th>
                    <th className="p-3">Particulars</th>
                    <th className="p-3 text-right">Debit</th>
                    <th className="p-3 text-right">Credit</th>
                    <th className="p-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {!ledgerReady ? (
                    <tr><td colSpan={5} className="text-center p-8 text-slate-400">Loading…</td></tr>
                  ) : ledgerReady.rows.length === 0 ? (
                    <tr><td colSpan={5} className="text-center p-8 text-slate-400">No journal vouchers posted yet.</td></tr>
                  ) : ledgerReady.rows.map((row, idx) => (
                    <tr key={idx} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 text-xs font-mono text-slate-600">{formatDate(row.date)}</td>
                      <td className="p-3 text-xs text-slate-700">{row.narration}</td>
                      <td className="p-3 text-right font-bold text-emerald-700">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                      <td className="p-3 text-right font-bold text-rose-700">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                      <td className="p-3 text-right font-bold font-mono" style={{ color: balanceColor(row.balance) }}>{formatCurrency(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                {ledgerReady && ledgerReady.rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                      <td colSpan={2} className="p-4 text-right font-lora">TOTAL</td>
                      <td className="p-4 text-right text-emerald-800">{formatCurrency(ledgerReady.total_debit)}</td>
                      <td className="p-4 text-right text-rose-800">{formatCurrency(ledgerReady.total_credit)}</td>
                      <td className="p-4 text-right" style={{ color: balanceColor(ledgerReady.closing_balance) }}>{formatCurrency(ledgerReady.closing_balance)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
