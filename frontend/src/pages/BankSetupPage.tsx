import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { getAccountBalance, BANK_CHART_ID } from '@/lib/cashbank';
import { Plus, ArrowLeft, Save, Edit2, Trash2, Landmark, Search } from 'lucide-react';
import type { BankAccount } from '@/types';

export default function BankSetupPage() {
  const { state, dispatch } = useApp();

  const [tab, setTab] = useState<'list' | 'form'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [name, setName] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [branch, setBranch] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().split('T')[0]);

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3000); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const addNew = () => {
    setSelectedId(null);
    setName(''); setAccountNo(''); setBranch('');
    setOpeningBalance(''); setOpeningDate(new Date().toISOString().split('T')[0]);
    setErrorMsg('');
    setTab('form');
  };

  const select = (bank: BankAccount) => {
    const ba = state.businessAccounts.find(b => b.id === bank.baId);
    setSelectedId(bank.id);
    setName(bank.name);
    setAccountNo(bank.accountNo || '');
    setBranch(bank.branch || '');
    setOpeningBalance(ba?.openingBalance != null ? String(ba.openingBalance) : '');
    setOpeningDate(ba?.openingDate || new Date().toISOString().split('T')[0]);
    setErrorMsg('');
    setTab('form');
  };

  /**
   * Next business account code under BANK ACCOUNTS (120002), with the FOUR-digit
   * serial. Two digits caps a chart head at 99 children — banks should not
   * inherit the old cash account's numbering.
   */
  const nextAccountCode = () => {
    const existing = state.businessAccounts.filter(a => a.controlId === BANK_CHART_ID);
    const max = existing.reduce((m, a) => {
      const n = parseInt(a.id.substring(BANK_CHART_ID.length), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return `${BANK_CHART_ID}${String(max + 1).padStart(4, '0')}`;
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErrorMsg('Bank account name is required.');

    const opening = openingBalance.trim() === '' ? undefined : Number(openingBalance);
    if (opening !== undefined && isNaN(opening)) return setErrorMsg('Opening balance must be a number.');
    // An opening balance with no date cannot be placed on a timeline, so a
    // ledger could not tell whether it sits before or after the first entry.
    if (opening !== undefined && !openingDate) return setErrorMsg('An opening balance needs a date.');

    if (selectedId) {
      const existing = state.bankAccounts.find(b => b.id === selectedId);
      if (!existing) return;
      dispatch({
        type: 'UPDATE_BANK_ACCOUNT',
        bank: { id: selectedId, name: name.trim(), accountNo: accountNo.trim() || undefined, branch: branch.trim() || undefined, baId: existing.baId }
      });
      const ba = state.businessAccounts.find(b => b.id === existing.baId);
      if (ba) {
        dispatch({
          type: 'UPDATE_BUSINESS_ACCOUNT',
          account: { ...ba, name: name.trim(), openingBalance: opening, openingDate: opening !== undefined ? openingDate : undefined }
        });
      }
      flash('Bank account updated.');
    } else {
      const baId = nextAccountCode();
      dispatch({
        type: 'ADD_BUSINESS_ACCOUNT',
        account: {
          id: baId,
          name: name.trim(),
          controlId: BANK_CHART_ID,
          linkCode: 'A',
          region: 'LOCAL',
          status: 'Active',
          openingBalance: opening,
          openingDate: opening !== undefined ? openingDate : undefined
        }
      });
      dispatch({
        type: 'ADD_BANK_ACCOUNT',
        bank: { id: 'bank_' + Date.now(), name: name.trim(), accountNo: accountNo.trim() || undefined, branch: branch.trim() || undefined, baId }
      });
      flash('Bank account added. It can now be selected on payments and receipts.');
    }

    setSelectedId(null);
    setTab('list');
  };

  const remove = (bank: BankAccount) => {
    // Deleting a bank removes its ledger account, which would orphan every
    // payment routed through it — so block while anything references it.
    const used =
      state.receipts.filter(r => r.bankId === bank.id || r.depositBankId === bank.id).length +
      state.expenses.filter(e => e.bankId === bank.id).length +
      state.transfers.filter(t => t.fromBaId === bank.baId || t.toBaId === bank.baId).length;
    if (used > 0) {
      return fail(`Cannot delete ${bank.name}: ${used} transaction(s) are recorded against it.`);
    }
    if (window.confirm(`Delete ${bank.name}? Its ledger account will be removed too.`)) {
      dispatch({ type: 'DELETE_BANK_ACCOUNT', id: bank.id });
      flash('Bank account deleted.');
      setTab('list');
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return state.bankAccounts;
    const q = search.toLowerCase();
    return state.bankAccounts.filter(b =>
      b.name.toLowerCase().includes(q) ||
      (b.accountNo || '').toLowerCase().includes(q) ||
      (b.branch || '').toLowerCase().includes(q)
    );
  }, [state.bankAccounts, search]);

  const grandTotal = state.bankAccounts.reduce((s, b) => s + getAccountBalance(state, b.baId), 0);

  return (
    <AppLayout pageTitle="Bank Accounts">
      <div className="mx-auto" style={{ maxWidth: 1100 }}>

        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              onClick={() => { setTab('list'); setSelectedId(null); }}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${tab === 'list' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <Landmark size={15} /> Bank Accounts ({state.bankAccounts.length})
            </button>
          </div>
          {tab === 'list' && (
            <button onClick={addNew} className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm">
              <Plus size={16} /> Add Bank Account
            </button>
          )}
        </div>

        {tab === 'list' ? (
          <div className="card-white p-6 md:p-8 bg-white border overflow-visible" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">Our Bank Accounts</h3>
                <p className="text-xs text-slate-500">
                  Each sits under the <strong>Bank Accounts</strong> chart head, so adding one is data — not a schema change.
                </p>
              </div>
              <div className="relative">
                <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search:</span>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Name, account no, branch..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="soleria-input py-2 text-sm pr-9 font-semibold min-w-[220px]"
                  />
                  <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">A/C Code</th>
                    <th className="p-3">Bank</th>
                    <th className="p-3">Account No.</th>
                    <th className="p-3">Branch</th>
                    <th className="p-3 text-right">Opening</th>
                    <th className="p-3 text-right">Balance</th>
                    <th className="p-3 text-center" style={{ width: 90 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center p-8 text-slate-400">
                        {state.bankAccounts.length === 0
                          ? 'No bank accounts yet. Add one so payments and receipts can name where the money moved.'
                          : 'No accounts match this search.'}
                      </td>
                    </tr>
                  ) : filtered.map(b => {
                    const ba = state.businessAccounts.find(x => x.id === b.baId);
                    const bal = getAccountBalance(state, b.baId);
                    return (
                      <tr key={b.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-mono font-semibold text-slate-600">{b.baId}</td>
                        <td className="p-3 font-semibold text-slate-900">{b.name}</td>
                        <td className="p-3 font-mono text-slate-600">{b.accountNo || <span className="text-slate-300">—</span>}</td>
                        <td className="p-3 text-slate-600">{b.branch || <span className="text-slate-300">—</span>}</td>
                        <td className="p-3 text-right text-slate-500 font-mono">
                          {ba?.openingBalance != null ? formatCurrency(ba.openingBalance) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(bal)}</td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button onClick={() => select(b)} title="Edit" className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800">
                              <Edit2 size={15} />
                            </button>
                            <button onClick={() => remove(b)} title="Delete" className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {state.bankAccounts.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 font-bold">
                      <td colSpan={5} className="p-3 pl-4 text-slate-700">Total across all banks</td>
                      <td className="p-3 text-right text-lg text-slate-900">{formatCurrency(grandTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="text-[11px] text-slate-400 mt-4">
              Balance is derived, never stored: opening balance, plus online receipts and cheques
              deposited here, plus transfers in, minus online payments, cheques written on this
              account, and transfers out. A cheque you wrote reduces the balance on the day it was
              written — so this is what you have committed, not what the bank would say today.
            </p>
          </div>
        ) : (
          <div className="card-white p-6 md:p-8 bg-white border overflow-visible" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-start gap-3 border-b pb-4 mb-6">
              <button onClick={() => { setTab('list'); setSelectedId(null); }} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 mt-0.5">
                <ArrowLeft size={18} />
              </button>
              <div>
                <h3 className="font-lora font-semibold text-lg text-slate-800">
                  {selectedId ? `Edit: ${name}` : 'Add Bank Account'}
                </h3>
                <p className="text-xs text-slate-500">
                  A ledger account is created automatically under Bank Accounts — no separate setup needed.
                </p>
              </div>
            </div>

            <form onSubmit={save} className="flex flex-col gap-6 max-w-2xl">
              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
                  <Landmark size={15} className="text-[#B08D57]" /> Bank Details
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Account Name <span className="text-red-500 font-bold">*</span>
                    </label>
                    <input type="text" value={name} onChange={e => setName(e.target.value)}
                      placeholder="e.g. Bank Alfalah A/C - 0124" className="soleria-input font-semibold" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Account Number</label>
                    <input type="text" value={accountNo} onChange={e => setAccountNo(e.target.value)}
                      placeholder="e.g. 0124-7901-33" className="soleria-input font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Branch</label>
                    <input type="text" value={branch} onChange={e => setBranch(e.target.value)}
                      placeholder="e.g. Gulberg, Lahore" className="soleria-input" />
                  </div>
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-3" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b pb-2">
                  Opening Balance
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Amount already in the account</label>
                    <input type="number" value={openingBalance} onChange={e => setOpeningBalance(e.target.value)}
                      placeholder="0" className="soleria-input text-right font-semibold" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">As at</label>
                    <input type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)}
                      className="soleria-input" />
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  An account opened mid-life already holds money. This is where the running balance
                  starts — leave it blank for a genuinely new account.
                </p>
              </div>

              <div className="flex gap-3 justify-end border-t pt-4">
                <button type="button" onClick={() => { setTab('list'); setSelectedId(null); }}
                  className="px-5 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" className="btn-gold flex items-center gap-1.5 px-5 py-2 text-sm">
                  <Save size={16} /> {selectedId ? 'Save Changes' : 'Add Bank Account'}
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
