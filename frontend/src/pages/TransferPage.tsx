import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { getAccountBalance, getCashAccount, getBankBusinessAccounts, accountLabel } from '@/lib/cashbank';
import { ArrowLeftRight, Save, Trash2, AlertTriangle } from 'lucide-react';
import type { Transfer } from '@/types';

const today = () => new Date().toISOString().split('T')[0];
const newTransferId = () => 'trf_' + Date.now();

export default function TransferPage() {
  const { state, dispatch } = useApp();

  const [date, setDate] = useState(today());
  const [fromBaId, setFromBaId] = useState('');
  const [toBaId, setToBaId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [remarks, setRemarks] = useState('');

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

  const save = (e: React.FormEvent) => {
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

  const remove = (t: Transfer) => {
    if (!window.confirm(`Delete this transfer? ${formatCurrency(t.amount)} will move back to ${accountLabel(state, t.fromBaId)}.`)) return;
    dispatch({ type: 'DELETE_TRANSFER', id: t.id });
    flash('Transfer deleted.');
  };

  const sorted = useMemo(
    () => [...state.transfers].sort((a, b) => b.date.localeCompare(a.date)),
    [state.transfers]
  );

  return (
    <AppLayout pageTitle="Transfer Between Accounts">
      <div className="mx-auto" style={{ maxWidth: 1000 }}>

        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

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
            <form onSubmit={save} className="flex flex-col gap-5">
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
                {sorted.length === 0 ? (
                  <tr><td colSpan={6} className="text-center p-8 text-slate-400">No transfers yet.</td></tr>
                ) : sorted.map(t => (
                  <tr key={t.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4 font-mono text-slate-600">{t.date}</td>
                    <td className="p-3 font-semibold text-slate-900">{accountLabel(state, t.fromBaId)}</td>
                    <td className="p-3 font-semibold text-slate-900">{accountLabel(state, t.toBaId)}</td>
                    <td className="p-3 text-slate-600">{t.remarks || <span className="text-slate-300">—</span>}</td>
                    <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(t.amount)}</td>
                    <td className="p-3 text-center">
                      <button onClick={() => remove(t)} title="Delete" className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600">
                        <Trash2 size={15} />
                      </button>
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
