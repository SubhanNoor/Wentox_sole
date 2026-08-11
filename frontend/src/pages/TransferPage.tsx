import { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import AccountBalancePanel from '@/components/AccountBalancePanel';
import * as api from '@/lib/api';
import type { BankAccountRow, TransferRow, TransferCreateInput, DepositRow, DepositCreateInput } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  ArrowLeftRight, PiggyBank, Save, AlertTriangle, TrendingUp, TrendingDown, Edit
} from 'lucide-react';

const today = () => new Date().toISOString().split('T')[0];

export default function TransferPage() {
  const { state } = useApp();

  const [mode, setMode] = useState<'transfer' | 'deposit'>('transfer');

  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  // Cash is a business_accounts row, NOT a bank_accounts row, so bankAccounts.list() never returns
  // it. Without this the From/To dropdowns only ever contained banks, which made a cash transfer
  // impossible to select — the whole point of the page. transfers.from_ba_id/to_ba_id reference
  // business_accounts, so cash and banks are equally valid there.
  const [cashAccount, setCashAccount] = useState<{ ba_id: number; name: string } | null>(null);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [deposits, setDeposits] = useState<DepositRow[]>([]);
  const [lookupError, setLookupError] = useState('');

  // Banks only — a DEPOSIT always lands in a bank, so cash is not a valid destination there.
  const bankOptions = useMemo(
    () => banks.filter(b => b.ba_id != null).map(b => ({ value: String(b.ba_id), label: b.name })),
    [banks]
  );
  // Cash + banks, for TRANSFERS, which move money between any two business accounts.
  // Cash first — it's the most common side of a transfer on the shop floor.
  const accountOptions = useMemo(
    () => [
      ...(cashAccount ? [{ value: String(cashAccount.ba_id), label: cashAccount.name }] : []),
      ...bankOptions,
    ],
    [bankOptions, cashAccount]
  );
  const bankName = useCallback((baId: number) => {
    if (cashAccount && cashAccount.ba_id === baId) return cashAccount.name;
    return banks.find(b => b.ba_id === baId)?.name || 'Unknown Account';
  }, [banks, cashAccount]);

  // Bumped by every save/post/delete handler — the balance panels are stale the moment a document
  // moves money. Deliberately NOT bumped inside refreshTransfers/refreshDeposits, which the mount
  // effect also calls: setting state there is a cascading render (react-hooks/set-state-in-effect),
  // and the panels fetch on mount anyway.
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const bumpBalances = () => setBalanceRefreshKey(k => k + 1);

  const refreshTransfers = useCallback(async () => {
    const res = await api.transfers.list({});
    if (res.ok) setTransfers(res.data);
    else setLookupError('Failed to load transfers: ' + res.error.message);
  }, []);

  const refreshDeposits = useCallback(async () => {
    const res = await api.deposits.list({});
    if (res.ok) setDeposits(res.data);
    else setLookupError('Failed to load deposits: ' + res.error.message);
  }, []);

  useEffect(() => {
    (async () => {
      const res = await api.bankAccounts.list();
      if (res.ok) setBanks(res.data);
      else setLookupError('Failed to load bank accounts: ' + res.error.message);
    })();
    (async () => {
      const res = await api.businessAccounts.getCashAccount();
      if (res.ok) setCashAccount(res.data);
      else setLookupError('Failed to load the cash account: ' + res.error.message);
    })();
    refreshTransfers();
    refreshDeposits();
  }, [refreshTransfers, refreshDeposits]);

  // ── Transfer form ──
  const [tMode, setTMode] = useState<'new' | 'edit' | 'view'>('new');
  const [transferId, setTransferId] = useState<number | null>(null);
  const [transferStatus, setTransferStatus] = useState<'CONFIRMED' | 'DRAFT'>('DRAFT');
  const [date, setDate] = useState(today());
  const [fromBaId, setFromBaId] = useState('');
  const [toBaId, setToBaId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [remarks, setRemarks] = useState('');

  const isTransferViewMode = tMode === 'view';
  const isTransferPosted = transferStatus === 'CONFIRMED';

  // ── Deposit form ──
  const [dMode, setDMode] = useState<'new' | 'edit' | 'view'>('new');
  const [depositId, setDepositId] = useState<number | null>(null);
  const [depositStatus, setDepositStatus] = useState<'CONFIRMED' | 'DRAFT'>('DRAFT');
  const [depDirection, setDepDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [depDate, setDepDate] = useState(today());
  const [depToBaId, setDepToBaId] = useState('');
  const [depAmount, setDepAmount] = useState<number>(0);
  const [depSource, setDepSource] = useState('');
  const [depRemarks, setDepRemarks] = useState('');

  const isDepositViewMode = dMode === 'view';
  const isDepositPosted = depositStatus === 'CONFIRMED';

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');


  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  // ── Transfer handlers ──
  const handleNewTransfer = () => {
    setTMode('new');
    setTransferId(null);
    setTransferStatus('DRAFT');
    setDate(today());
    setFromBaId('');
    setToBaId('');
    setAmount(0);
    setRemarks('');
    setErrorMsg('');
  };

  const buildTransferPayload = (): TransferCreateInput | null => {
    if (!date) { setErrorMsg('Pick a date.'); return null; }
    if (!fromBaId) { setErrorMsg('Pick the account the money leaves.'); return null; }
    if (!toBaId) { setErrorMsg('Pick the account the money goes to.'); return null; }
    if (fromBaId === toBaId) { setErrorMsg('Pick two different accounts — moving money to itself does nothing.'); return null; }
    if (amount <= 0) { setErrorMsg('Amount must be greater than 0.'); return null; }

    return {
      transfer_date: date,
      from_ba_id: Number(fromBaId),
      to_ba_id: Number(toBaId),
      amount,
      remarks: remarks.trim() || undefined
    };
  };

  const saveTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildTransferPayload();
    if (!payload) return;

    const result = tMode === 'edit' && transferId != null
      ? await api.transfers.update(transferId, payload)
      : await api.transfers.create(payload);

    if (!result.ok) { fail('Failed to save transfer: ' + result.error.message); return; }

    setTransferId(result.data.transfer_id);
    setTransferStatus(result.data.status);
    setErrorMsg('');
    flash(tMode === 'edit' ? 'Transfer updated.' : 'Transfer recorded as draft.');
    setTMode('view');
    refreshTransfers();
    bumpBalances();
  };

  const loadTransferRow = (row: TransferRow) => {
    setTransferId(row.transfer_id);
    setTransferStatus(row.status);
    setDate(row.transfer_date.slice(0, 10));
    setFromBaId(String(row.from_ba_id));
    setToBaId(String(row.to_ba_id));
    setAmount(row.amount);
    setRemarks(row.remarks || '');
    setErrorMsg('');
    setTMode('view');
  };

  const handlePostTransfer = async () => {
    if (transferId == null) return;
    const res = await api.transfers.post(transferId);
    if (!res.ok) { fail('Failed to post transfer: ' + res.error.message); return; }
    setTransferStatus(res.data.status);
    flash('Transfer posted.');
    refreshTransfers();
    bumpBalances();
  };

  const handleUnpostTransfer = async () => {
    if (transferId == null) return;
    const res = await api.transfers.unpost(transferId);
    if (!res.ok) { fail('Failed to unpost transfer: ' + res.error.message); return; }
    setTransferStatus(res.data.status);
    flash('Transfer unposted.');
    refreshTransfers();
    bumpBalances();
  };



  // ── Deposit handlers ──
  const handleNewDeposit = () => {
    setDMode('new');
    setDepositId(null);
    setDepositStatus('DRAFT');
    setDepDirection('CREDIT');
    setDepDate(today());
    setDepToBaId('');
    setDepAmount(0);
    setDepSource('');
    setDepRemarks('');
    setErrorMsg('');
  };

  const buildDepositPayload = (): DepositCreateInput | null => {
    if (!depDate) { setErrorMsg('Pick a date.'); return null; }
    if (!depToBaId) { setErrorMsg('Pick the account to adjust.'); return null; }
    if (!depSource.trim()) {
      setErrorMsg(`Describe ${depDirection === 'DEBIT' ? 'why this is being deducted' : 'where this money came from'}.`);
      return null;
    }
    if (depAmount <= 0) { setErrorMsg('Amount must be greater than 0.'); return null; }

    return {
      deposit_date: depDate,
      to_ba_id: Number(depToBaId),
      direction: depDirection,
      amount: depAmount,
      source: depSource.trim(),
      remarks: depRemarks.trim() || undefined
    };
  };

  const saveDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildDepositPayload();
    if (!payload) return;

    const result = dMode === 'edit' && depositId != null
      ? await api.deposits.update(depositId, payload)
      : await api.deposits.create(payload);

    if (!result.ok) { fail('Failed to save entry: ' + result.error.message); return; }

    setDepositId(result.data.deposit_id);
    setDepositStatus(result.data.status);
    setErrorMsg('');
    flash(dMode === 'edit' ? 'Entry updated.' : 'Entry recorded as draft.');
    setDMode('view');
    refreshDeposits();
    bumpBalances();
  };

  const loadDepositRow = (row: DepositRow) => {
    setDepositId(row.deposit_id);
    setDepositStatus(row.status);
    setDepDirection(row.direction);
    setDepDate(row.deposit_date.slice(0, 10));
    setDepToBaId(String(row.to_ba_id));
    setDepAmount(row.amount);
    setDepSource(row.source);
    setDepRemarks(row.remarks || '');
    setErrorMsg('');
    setDMode('view');
  };

  const handlePostDeposit = async () => {
    if (depositId == null) return;
    const res = await api.deposits.post(depositId);
    if (!res.ok) { fail('Failed to post entry: ' + res.error.message); return; }
    setDepositStatus(res.data.status);
    flash('Entry posted.');
    refreshDeposits();
    bumpBalances();
  };

  const handleUnpostDeposit = async () => {
    if (depositId == null) return;
    const res = await api.deposits.unpost(depositId);
    if (!res.ok) { fail('Failed to unpost entry: ' + res.error.message); return; }
    setDepositStatus(res.data.status);
    flash('Entry unposted.');
    refreshDeposits();
    bumpBalances();
  };



  const depSourceLabel = depDirection === 'DEBIT' ? 'Reason (e.g. Bank Charges, Correction)' : 'Source (e.g. Owner Capital, Bank Loan)';

  const sortedTransfers = useMemo(
    () => [...transfers].sort((a, b) => b.transfer_date.localeCompare(a.transfer_date)),
    [transfers]
  );

  const sortedDeposits = useMemo(
    () => [...deposits].sort((a, b) => b.deposit_date.localeCompare(a.deposit_date)),
    [deposits]
  );

  // Defense-in-depth: the sidebar already hides this page's nav item for User (UC-03) — this
  // whole screen shows bank transfer/deposit history, exactly the "bank ledger" view User
  // must not see, so it's guarded here too rather than relying solely on the sidebar.
  if (state.currentUserRole === 'User') {
    return (
      <AppLayout pageTitle="Transfer Between Accounts">
        <div className="mx-auto text-center p-12 text-slate-400" style={{ maxWidth: 1000 }}>
          You don't have access to this page.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout pageTitle="Bank Transactions">
      <div className="mx-auto" style={{ maxWidth: 1400 }}>

        {lookupError && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{lookupError}</div>}
        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

        {/* Mode switcher boxed toolbar */}
        <div className="p-4 rounded-xl border mb-6 bg-white shadow-2xs flex flex-wrap items-center justify-between gap-4" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { setMode('transfer'); setErrorMsg(''); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                mode === 'transfer'
                  ? 'bg-[#111c2a] text-[#B08D57] shadow-sm font-bold'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <ArrowLeftRight size={15} /> Transfer Between Accounts
            </button>
            <button
              type="button"
              onClick={() => { setMode('deposit'); setErrorMsg(''); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                mode === 'deposit'
                  ? 'bg-[#111c2a] text-[#B08D57] shadow-sm font-bold'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <PiggyBank size={15} /> Add Amount to Bank
            </button>
          </div>
        </div>

        <div key={mode} className="animate-in fade-in slide-in-from-bottom-3 duration-300">
          {mode === 'transfer' ? (
            <>
            <div className="card-white p-6 md:p-8 bg-white border overflow-visible mb-6" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between border-b pb-3 mb-5">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight size={18} className="text-[#B08D57]" />
                  <div>
                    <h3 className="font-lora font-semibold text-lg text-slate-800">Move Money Between Our Own Bank Accounts</h3>
                    <p className="text-xs text-slate-500">
                      Bank to bank. This is neither income nor an expense — nobody paid us and we paid
                      nobody — so it never appears in those totals.
                    </p>
                  </div>
                </div>
                {tMode === 'view' && (
                  <div className="flex items-center gap-2">
                    {!isTransferPosted && (
                      <button
                        type="button"
                        onClick={() => setTMode('edit')}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] border border-[#B08D57] shadow-sm transition-all flex items-center gap-1.5"
                      >
                        <Edit size={13} /> Edit
                      </button>
                    )}
                    {!isTransferPosted ? (
                      <button
                        type="button"
                        onClick={handlePostTransfer}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
                      >
                        Post
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleUnpostTransfer}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-all"
                      >
                        Unpost
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleNewTransfer}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all"
                    >
                      New Transfer
                    </button>
                  </div>
                )}
              </div>

              {accountOptions.length < 2 ? (
                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>At least two accounts are needed to transfer between. Add an account first.</span>
                </div>
              ) : (
                <form onSubmit={saveTransfer} className="flex flex-col gap-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
                      <input
                        type="date"
            value={date} disabled={isTransferViewMode}
                        onChange={e => setDate(e.target.value)} className="soleria-input"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Amount <span className="text-red-500 font-bold">*</span>
                      </label>
                      <input
                        type="number" min={0}
                        value={amount || ''}
                        disabled={isTransferViewMode}
                        onChange={e => setAmount(Math.max(0, Number(e.target.value) || 0))}
                        placeholder="Enter amount in Rs..."
                        className="soleria-input font-semibold font-mono text-right"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        From <span className="text-red-500 font-bold">*</span>
                      </label>
                      <SearchableSelect
                        options={accountOptions}
                        value={fromBaId}
                        onChange={setFromBaId}
                        placeholder="Money leaves..."
                        disabled={isTransferViewMode}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        To <span className="text-red-500 font-bold">*</span>
                      </label>
                      <SearchableSelect
                        options={accountOptions.filter((o: { value: string; label: string }) => o.value !== fromBaId)}
                        value={toBaId}
                        onChange={setToBaId}
                        placeholder="Money arrives..."
                        disabled={isTransferViewMode}
                      />
                    </div>
                  </div>

                  {/* Both balances, because a transfer is the one screen where you need to know
                      whether the money is actually there before moving it. Signed the way each side
                      is about to move: out of From, into To. */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <AccountBalancePanel
                      baId={fromBaId ? Number(fromBaId) : null}
                      variant="money"
                      refreshKey={balanceRefreshKey}
                      lines={[{ label: 'This transfer out', delta: -amount }]}
                    />
                    <AccountBalancePanel
                      baId={toBaId ? Number(toBaId) : null}
                      variant="money"
                      refreshKey={balanceRefreshKey}
                      lines={[{ label: 'This transfer in', delta: amount }]}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks</label>
                    <input
                      type="text" value={remarks} disabled={isTransferViewMode}
                      onChange={e => setRemarks(e.target.value)}
                      placeholder="e.g. Cash takings banked" className="soleria-input"
                    />
                  </div>

                  {!isTransferViewMode && (
                    <div className="flex justify-end border-t pt-4">
                      <button type="submit" className="btn-gold flex items-center gap-1.5 px-5 py-2 text-sm">
                        <Save size={16} /> {tMode === 'edit' ? 'Update Transfer' : 'Record Transfer'}
                      </button>
                    </div>
                  )}
                </form>
              )}
            </div>

            <div className="card-white p-6 md:p-8 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="font-lora font-semibold text-lg text-slate-800 mb-4">Recent Transfers</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4">Date</th>
                      <th className="p-3">From</th>
                      <th className="p-3">To</th>
                      <th className="p-3">Remarks</th>
                      <th className="p-3 text-right">Amount</th>
                      <th className="p-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTransfers.length === 0 ? (
                      <tr><td colSpan={6} className="text-center p-8 text-slate-400">No transfers yet.</td></tr>
                    ) : sortedTransfers.map(t => (
                      <tr
                        key={t.transfer_id}
                        onClick={() => loadTransferRow(t)}
                        className="border-b hover:bg-slate-50/50 cursor-pointer"
                        style={{ borderColor: 'var(--border-table)' }}
                      >
                        <td className="p-3 pl-4 font-mono text-slate-600">{formatDate(t.transfer_date)}</td>
                        <td className="p-3 font-semibold text-slate-900">{t.from_name || bankName(t.from_ba_id)}</td>
                        <td className="p-3 font-semibold text-slate-900">{t.to_name || bankName(t.to_ba_id)}</td>
                        <td className="p-3 text-slate-600">{t.remarks || <span className="text-slate-300">—</span>}</td>
                        <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(t.amount)}</td>
                        <td className="p-3 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                            t.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {t.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="card-white p-6 md:p-8 bg-white border overflow-visible mb-6" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between border-b pb-3 mb-5">
                <div className="flex items-center gap-2">
                  <PiggyBank size={18} className="text-[#B08D57]" />
                  <div>
                    <h3 className="font-lora font-semibold text-lg text-slate-800">Credit or Debit an Account Manually</h3>
                    <p className="text-xs text-slate-500">
                      Credit: owner capital, a bank loan, an insurance/other refund — money entering from outside.
                      Debit: bank charges, an error correction, or any deduction with no counter-account in the books.
                      Not tied to any customer, so it never touches customer ledgers.
                    </p>
                  </div>
                </div>
                {dMode === 'view' && (
                  <div className="flex items-center gap-2">
                    {!isDepositPosted && (
                      <button
                        type="button"
                        onClick={() => setDMode('edit')}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] border border-[#B08D57] shadow-sm transition-all flex items-center gap-1.5"
                      >
                        <Edit size={13} /> Edit
                      </button>
                    )}
                    {!isDepositPosted ? (
                      <button
                        type="button"
                        onClick={handlePostDeposit}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
                      >
                        Post
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleUnpostDeposit}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-all"
                      >
                        Unpost
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleNewDeposit}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-all"
                    >
                      New Entry
                    </button>
                  </div>
                )}
              </div>

              {bankOptions.length === 0 ? (
                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>No bank account exists yet. Add a bank account first.</span>
                </div>
              ) : (
                <form onSubmit={saveDeposit} className="flex flex-col gap-5">
                  {/* Credit / Debit switch */}
                  <div className="flex bg-slate-100 p-1 rounded-lg text-sm font-semibold w-fit">
                    <button
                      type="button"
                      disabled={isDepositViewMode}
                      onClick={() => setDepDirection('CREDIT')}
                      className={`px-4 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                        depDirection === 'CREDIT' ? 'bg-white shadow text-emerald-700' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <TrendingUp size={14} /> Credit (Add)
                    </button>
                    <button
                      type="button"
                      disabled={isDepositViewMode}
                      onClick={() => setDepDirection('DEBIT')}
                      className={`px-4 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                        depDirection === 'DEBIT' ? 'bg-white shadow text-rose-700' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <TrendingDown size={14} /> Debit (Deduct)
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
                      <input
                        type="date"
            value={depDate} disabled={isDepositViewMode}
                        onChange={e => setDepDate(e.target.value)} className="soleria-input"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Amount <span className="text-red-500 font-bold">*</span>
                      </label>
                      <input
                        type="number" min={0}
                        value={depAmount || ''}
                        disabled={isDepositViewMode}
                        onChange={e => setDepAmount(Math.max(0, Number(e.target.value) || 0))}
                        placeholder="Enter amount in Rs..."
                        className="soleria-input font-semibold font-mono text-right"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Account <span className="text-red-500 font-bold">*</span>
                    </label>
                    <SearchableSelect
                      options={bankOptions}
                      value={depToBaId}
                      onChange={setDepToBaId}
                      placeholder="Choose account..."
                      disabled={isDepositViewMode}
                    />
                  </div>

                  {/* CREDIT puts money IN (see deposits.service.js#post), DEBIT takes it out — so the
                      panel's delta follows the direction toggle, not the raw amount. */}
                  <AccountBalancePanel
                    baId={depToBaId ? Number(depToBaId) : null}
                    variant="money"
                    refreshKey={balanceRefreshKey}
                    lines={[{
                      label: depDirection === 'DEBIT' ? 'This deduction' : 'This deposit',
                      delta: depDirection === 'DEBIT' ? -depAmount : depAmount,
                    }]}
                  />

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      {depSourceLabel} <span className="text-red-500 font-bold">*</span>
                    </label>
                    <input
                      type="text" value={depSource} disabled={isDepositViewMode}
                      onChange={e => setDepSource(e.target.value)}
                      placeholder={depDirection === 'DEBIT' ? 'e.g. Bank Charges, Correction' : 'e.g. Owner Capital, Bank Loan, Insurance Refund'}
                      className="soleria-input"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks</label>
                    <input
                      type="text" value={depRemarks} disabled={isDepositViewMode}
                      onChange={e => setDepRemarks(e.target.value)}
                      placeholder="Optional notes" className="soleria-input"
                    />
                  </div>

                  {!isDepositViewMode && (
                    <div className="flex justify-end border-t pt-4">
                      <button type="submit" className="btn-gold flex items-center gap-1.5 px-5 py-2 text-sm">
                        <Save size={16} /> {dMode === 'edit' ? 'Update Entry' : `Record ${depDirection === 'DEBIT' ? 'Debit' : 'Credit'}`}
                      </button>
                    </div>
                  )}
                </form>
              )}
            </div>

            <div className="card-white p-6 md:p-8 bg-white border" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="font-lora font-semibold text-lg text-slate-800 mb-4">Recent Manual Adjustments</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4">Date</th>
                      <th className="p-3">Account</th>
                      <th className="p-3 text-center">Type</th>
                      <th className="p-3">Source / Reason</th>
                      <th className="p-3">Remarks</th>
                      <th className="p-3 text-right">Amount</th>
                      <th className="p-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDeposits.length === 0 ? (
                      <tr><td colSpan={7} className="text-center p-8 text-slate-400">No manual adjustments recorded yet.</td></tr>
                    ) : sortedDeposits.map(d => (
                      <tr
                        key={d.deposit_id}
                        onClick={() => loadDepositRow(d)}
                        className="border-b hover:bg-slate-50/50 cursor-pointer"
                        style={{ borderColor: 'var(--border-table)' }}
                      >
                        <td className="p-3 pl-4 font-mono text-slate-600">{formatDate(d.deposit_date)}</td>
                        <td className="p-3 font-semibold text-slate-900">{d.to_name || bankName(d.to_ba_id)}</td>
                        <td className="p-3 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                            d.direction === 'DEBIT' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                          }`}>
                            {d.direction}
                          </span>
                        </td>
                        <td className="p-3 font-semibold text-slate-700">{d.source}</td>
                        <td className="p-3 text-slate-600">{d.remarks || <span className="text-slate-300">—</span>}</td>
                        <td className={`p-3 text-right font-bold ${d.direction === 'DEBIT' ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {d.direction === 'DEBIT' ? '−' : '+'}{formatCurrency(d.amount)}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                            d.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {d.status}
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

        {/* ── Delete-DRAFT confirmation ── */}

        </div>

      </div>
    </AppLayout>
  );
}
