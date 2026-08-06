import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { getAccountBalance, getCashAccount, getBankBusinessAccounts, accountLabel } from '@/lib/cashbank';
import { ArrowLeftRight, PiggyBank, Save, Trash2, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import type { Transfer, Deposit } from '@/types';

const today = () => new Date().toISOString().split('T')[0];
const newTransferId = () => 'trf_' + Date.now();
const newDepositId = () => 'dep_' + Date.now();

export default function TransferPage() {
  const { state, dispatch } = useApp();

  const [mode, setMode] = useState<'transfer' | 'deposit'>('transfer');

  // ── Transfer form state ──
  const [date, setDate] = useState(today());
  const [fromBaId, setFromBaId] = useState('');
  const [toBaId, setToBaId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [remarks, setRemarks] = useState('');

  // ── Deposit / manual adjustment form state ──
  const [depDirection, setDepDirection] = useState<'credit' | 'debit'>('credit');
  const [depDate, setDepDate] = useState(today());
  const [depToBaId, setDepToBaId] = useState('');
  const [depAmount, setDepAmount] = useState<number>(0);
  const [depSource, setDepSource] = useState('');
  const [depRemarks, setDepRemarks] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };

  // Our own accounts only — cash and banks. A transfer to a customer or vendor
  // is a receipt or a payment, not a transfer.
  const ownAccounts = useMemo(() => {
    const cash = getCashAccount(state);
    const banks = getBankBusinessAccounts(state);
    return [...(cash ? [cash] : []), ...banks];
  }, [state]);

  const options = useMemo(
    () => ownAccounts.map(a => ({ value: a.id, label: a.name })),
    [ownAccounts]
  );

  const fromBalance = fromBaId ? getAccountBalance(state, fromBaId) : 0;

  const saveTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return setErrorMsg('Pick a date.');
    if (!fromBaId) return setErrorMsg('Pick the account the money leaves.');
    if (!toBaId) return setErrorMsg('Pick the account the money goes to.');
    if (fromBaId === toBaId) return setErrorMsg('Pick two different accounts — moving money to itself does nothing.');
    if (amount <= 0) return setErrorMsg('Amount must be greater than 0.');

    const transfer: Transfer = {
      id: newTransferId(),
      date,
      fromBaId,
      toBaId,
      amount,
      remarks: remarks.trim() || undefined
    };
    dispatch({ type: 'ADD_TRANSFER', transfer });
    flash(`${formatCurrency(amount)} moved from ${accountLabel(state, fromBaId)} to ${accountLabel(state, toBaId)}.`);

    setFromBaId(''); setToBaId(''); setAmount(0); setRemarks(''); setErrorMsg('');
  };

  const removeTransfer = (t: Transfer) => {
    if (!window.confirm(`Delete this transfer? ${formatCurrency(t.amount)} will move back to ${accountLabel(state, t.fromBaId)}.`)) return;
    dispatch({ type: 'DELETE_TRANSFER', id: t.id });
    flash('Transfer deleted.');
  };

  const depSourceLabel = depDirection === 'debit' ? 'Reason (e.g. Bank Charges, Correction)' : 'Source (e.g. Owner Capital, Bank Loan)';

  const saveDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!depDate) return setErrorMsg('Pick a date.');
    if (!depToBaId) return setErrorMsg('Pick the account to adjust.');
    if (!depSource.trim()) return setErrorMsg(`Describe ${depDirection === 'debit' ? 'why this is being deducted' : 'where this money came from'}.`);
    if (depAmount <= 0) return setErrorMsg('Amount must be greater than 0.');

    const deposit: Deposit = {
      id: newDepositId(),
      date: depDate,
      toBaId: depToBaId,
      direction: depDirection,
      amount: depAmount,
      source: depSource.trim(),
      remarks: depRemarks.trim() || undefined
    };
    dispatch({ type: 'ADD_DEPOSIT', deposit });
    flash(depDirection === 'debit'
      ? `${formatCurrency(depAmount)} debited from ${accountLabel(state, depToBaId)} (${depSource.trim()}).`
      : `${formatCurrency(depAmount)} credited to ${accountLabel(state, depToBaId)} from ${depSource.trim()}.`);

    setDepToBaId(''); setDepAmount(0); setDepSource(''); setDepRemarks(''); setErrorMsg('');
  };

  const removeDeposit = (d: Deposit) => {
    const verb = d.direction === 'debit' ? 'return to' : 'be removed from';
    if (!window.confirm(`Delete this entry? ${formatCurrency(d.amount)} will ${verb} ${accountLabel(state, d.toBaId)}.`)) return;
    dispatch({ type: 'DELETE_DEPOSIT', id: d.id });
    flash('Entry deleted.');
  };

  const sortedTransfers = useMemo(
    () => [...state.transfers].sort((a, b) => b.date.localeCompare(a.date)),
    [state.transfers]
  );

  const sortedDeposits = useMemo(
    () => [...state.deposits].sort((a, b) => b.date.localeCompare(a.date)),
    [state.deposits]
  );

  // Defense-in-depth: the sidebar already hides this page's nav item for User (UC-03) — this
  // whole screen shows bank balances and transfer history, exactly the "bank ledger" view User
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
      <div className="mx-auto" style={{ maxWidth: 1000 }}>

        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

        {/* Mode switcher */}
        <div className="flex flex-wrap gap-2 mb-6 border-b pb-3" style={{ borderColor: 'var(--border-color)' }}>
          <button
            onClick={() => { setMode('transfer'); setErrorMsg(''); }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              mode === 'transfer'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ArrowLeftRight size={15} /> Transfer Between Accounts
          </button>
          <button
            onClick={() => { setMode('deposit'); setErrorMsg(''); }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              mode === 'deposit'
                ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <PiggyBank size={15} /> Add Amount to Bank
          </button>
        </div>

        {mode === 'transfer' ? (
          <>
            <div className="card-white p-6 md:p-8 bg-white border overflow-visible mb-6" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center gap-2 border-b pb-3 mb-5">
                <ArrowLeftRight size={18} className="text-[#B08D57]" />
                <div>
                  <h3 className="font-lora font-semibold text-lg text-slate-800">Move Money Between Our Own Accounts</h3>
                  <p className="text-xs text-slate-500">
                    Cash banked, bank to bank, or a withdrawal to pay wages. This is neither income nor
                    an expense — nobody paid us and we paid nobody — so it never appears in those totals.
                  </p>
                </div>
              </div>

              {ownAccounts.length < 2 ? (
                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>At least two accounts are needed to transfer between. Add a bank account first.</span>
                </div>
              ) : (
                <form onSubmit={saveTransfer} className="flex flex-col gap-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
                      <input type="date" value={date} onChange={e => setDate(e.target.value)} className="soleria-input" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Amount <span className="text-red-500 font-bold">*</span>
                      </label>
                      <input
                        type="number" min={0}
                        value={amount || ''}
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
                        options={options}
                        value={fromBaId}
                        onChange={setFromBaId}
                        placeholder="Money leaves..."
                      />
                      {fromBaId && (
                        <p className="text-[11px] text-slate-500 mt-1">
                          Currently holds <strong>{formatCurrency(fromBalance)}</strong>
                          {amount > 0 && (
                            <span className={amount > fromBalance ? 'text-amber-700 font-semibold' : ''}>
                              {' '}→ {formatCurrency(fromBalance - amount)} after
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        To <span className="text-red-500 font-bold">*</span>
                      </label>
                      <SearchableSelect
                        options={options.filter(o => o.value !== fromBaId)}
                        value={toBaId}
                        onChange={setToBaId}
                        placeholder="Money arrives..."
                      />
                      {toBaId && (
                        <p className="text-[11px] text-slate-500 mt-1">
                          Currently holds <strong>{formatCurrency(getAccountBalance(state, toBaId))}</strong>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Not blocked: an overdraft or a late-entered receipt can both put an
                      account legitimately below zero. Flagged so it is never silent. */}
                  {fromBaId && amount > fromBalance && (
                    <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>
                        This takes {accountLabel(state, fromBaId)} below zero. Allowed — but check
                        nothing is missing before posting.
                      </span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks</label>
                    <input
                      type="text" value={remarks} onChange={e => setRemarks(e.target.value)}
                      placeholder="e.g. Cash takings banked" className="soleria-input"
                    />
                  </div>

                  <div className="flex justify-end border-t pt-4">
                    <button type="submit" className="btn-gold flex items-center gap-1.5 px-5 py-2 text-sm">
                      <Save size={16} /> Record Transfer
                    </button>
                  </div>
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
                      <th className="p-3 text-center" style={{ width: 60 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTransfers.length === 0 ? (
                      <tr><td colSpan={6} className="text-center p-8 text-slate-400">No transfers yet.</td></tr>
                    ) : sortedTransfers.map(t => (
                      <tr key={t.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-mono text-slate-600">{t.date}</td>
                        <td className="p-3 font-semibold text-slate-900">{accountLabel(state, t.fromBaId)}</td>
                        <td className="p-3 font-semibold text-slate-900">{accountLabel(state, t.toBaId)}</td>
                        <td className="p-3 text-slate-600">{t.remarks || <span className="text-slate-300">—</span>}</td>
                        <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(t.amount)}</td>
                        <td className="p-3 text-center">
                          <button onClick={() => removeTransfer(t)} title="Delete" className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600">
                            <Trash2 size={15} />
                          </button>
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
            {/* Live balances — every own account at a glance */}
            <div className="card-white p-4 bg-white border mb-6 rounded-2xl" style={{ borderColor: 'var(--border-color)' }}>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">Live Balances</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {ownAccounts.map(a => {
                  const bal = getAccountBalance(state, a.id);
                  return (
                    <div
                      key={a.id}
                      className="group relative bg-white p-4 rounded-xl border border-slate-200/80 transition-all duration-300 transform hover:-translate-y-1 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_10px_25px_rgba(176,141,87,0.15)] flex flex-col justify-between"
                    >
                      <span className="block text-xs font-semibold text-slate-500 group-hover:text-[var(--brand-navy)] transition-colors truncate mb-1">
                        {a.name}
                      </span>
                      <span className={`block text-base font-bold font-mono ${bal > 0 ? 'text-emerald-600' : bal < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                        {formatCurrency(bal)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card-white p-6 md:p-8 bg-white border overflow-visible mb-6" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center gap-2 border-b pb-3 mb-5">
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

              {ownAccounts.length === 0 ? (
                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>No cash/bank account exists yet. Add a bank account first.</span>
                </div>
              ) : (
                <form onSubmit={saveDeposit} className="flex flex-col gap-5">
                  {/* Credit / Debit switch */}
                  <div className="flex bg-slate-100 p-1 rounded-lg text-sm font-semibold w-fit">
                    <button
                      type="button"
                      onClick={() => setDepDirection('credit')}
                      className={`px-4 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                        depDirection === 'credit' ? 'bg-white shadow text-emerald-700' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <TrendingUp size={14} /> Credit (Add)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDepDirection('debit')}
                      className={`px-4 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                        depDirection === 'debit' ? 'bg-white shadow text-rose-700' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <TrendingDown size={14} /> Debit (Deduct)
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
                      <input type="date" value={depDate} onChange={e => setDepDate(e.target.value)} className="soleria-input" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Amount <span className="text-red-500 font-bold">*</span>
                      </label>
                      <input
                        type="number" min={0}
                        value={depAmount || ''}
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
                      options={options}
                      value={depToBaId}
                      onChange={setDepToBaId}
                      placeholder="Choose account..."
                    />
                    {depToBaId && (() => {
                      const current = getAccountBalance(state, depToBaId);
                      const after = depDirection === 'debit' ? current - depAmount : current + depAmount;
                      return (
                        <p className="text-[11px] text-slate-500 mt-1">
                          Currently holds <strong>{formatCurrency(current)}</strong>
                          {depAmount > 0 && (
                            <span className={depDirection === 'debit' && after < 0 ? 'text-amber-700 font-semibold' : ''}>
                              {' '}→ {formatCurrency(after)} after
                            </span>
                          )}
                        </p>
                      );
                    })()}
                  </div>

                  {depToBaId && depDirection === 'debit' && depAmount > getAccountBalance(state, depToBaId) && (
                    <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>This takes {accountLabel(state, depToBaId)} below zero. Allowed — but check nothing is missing before posting.</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      {depSourceLabel} <span className="text-red-500 font-bold">*</span>
                    </label>
                    <input
                      type="text" value={depSource} onChange={e => setDepSource(e.target.value)}
                      placeholder={depDirection === 'debit' ? 'e.g. Bank Charges, Correction' : 'e.g. Owner Capital, Bank Loan, Insurance Refund'}
                      className="soleria-input"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks</label>
                    <input
                      type="text" value={depRemarks} onChange={e => setDepRemarks(e.target.value)}
                      placeholder="Optional notes" className="soleria-input"
                    />
                  </div>

                  <div className="flex justify-end border-t pt-4">
                    <button type="submit" className="btn-gold flex items-center gap-1.5 px-5 py-2 text-sm">
                      <Save size={16} /> Record {depDirection === 'debit' ? 'Debit' : 'Credit'}
                    </button>
                  </div>
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
                      <th className="p-3 text-center" style={{ width: 60 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDeposits.length === 0 ? (
                      <tr><td colSpan={7} className="text-center p-8 text-slate-400">No manual adjustments recorded yet.</td></tr>
                    ) : sortedDeposits.map(d => (
                      <tr key={d.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-mono text-slate-600">{d.date}</td>
                        <td className="p-3 font-semibold text-slate-900">{accountLabel(state, d.toBaId)}</td>
                        <td className="p-3 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                            d.direction === 'debit' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                          }`}>
                            {d.direction}
                          </span>
                        </td>
                        <td className="p-3 font-semibold text-slate-700">{d.source}</td>
                        <td className="p-3 text-slate-600">{d.remarks || <span className="text-slate-300">—</span>}</td>
                        <td className={`p-3 text-right font-bold ${d.direction === 'debit' ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {d.direction === 'debit' ? '−' : '+'}{formatCurrency(d.amount)}
                        </td>
                        <td className="p-3 text-center">
                          <button onClick={() => removeDeposit(d)} title="Delete" className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

      </div>
    </AppLayout>
  );
}
