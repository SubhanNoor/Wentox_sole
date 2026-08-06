import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { getAccountBalance, BANK_CHART_ID } from '@/lib/cashbank';
import { Plus, Settings, Save, Edit2, Trash2, Landmark, Search, X } from 'lucide-react';
import type { BankAccount } from '@/types';

export default function BankSetupPage() {
  const { state, dispatch } = useApp();

  const [search, setSearch] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [branch, setBranch] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().split('T')[0]);

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3000); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const handleOpenAddModal = () => {
    setSelectedId(null);
    setName('');
    setAccountNo('');
    setBranch('');
    setOpeningBalance('');
    setOpeningDate(new Date().toISOString().split('T')[0]);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (bank: BankAccount) => {
    const ba = state.businessAccounts.find(b => b.id === bank.baId);
    setSelectedId(bank.id);
    setName(bank.name);
    setAccountNo(bank.accountNo || '');
    setBranch(bank.branch || '');
    setOpeningBalance(ba?.openingBalance != null ? String(ba.openingBalance) : '');
    setOpeningDate(ba?.openingDate || new Date().toISOString().split('T')[0]);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedId(null);
    setName('');
    setAccountNo('');
    setBranch('');
    setOpeningBalance('');
    setOpeningDate(new Date().toISOString().split('T')[0]);
    setErrorMsg('');
  };

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
      flash('Bank account updated successfully.');
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
      flash('Bank account added successfully.');
    }

    handleCloseModal();
  };

  const remove = (bank: BankAccount) => {
    const used =
      state.receipts.filter(r => r.bankId === bank.id || r.depositBankId === bank.id).length +
      state.expenses.filter(e => e.bankId === bank.id).length +
      state.transfers.filter(t => t.fromBaId === bank.baId || t.toBaId === bank.baId).length +
      state.deposits.filter(d => d.toBaId === bank.baId).length;
    if (used > 0) {
      return fail(`Cannot delete ${bank.name}: ${used} transaction(s) are recorded against it.`);
    }
    if (window.confirm(`Delete ${bank.name}? Its ledger account will be removed too.`)) {
      dispatch({ type: 'DELETE_BANK_ACCOUNT', id: bank.id });
      flash('Bank account deleted.');
      handleCloseModal();
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

  if (state.currentUserRole === 'User') {
    return (
      <AppLayout pageTitle="Bank Accounts">
        <div className="mx-auto text-center p-12 text-slate-400" style={{ maxWidth: 1200 }}>
          You don't have access to this page.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout pageTitle="Bank Accounts Setup">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>}
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

        {/* Directory Card */}
        <div className="card-white p-6 md:p-8 bg-white border">
          <div className="border-b pb-4 mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                <Landmark size={20} className="text-[#B08D57]" /> Our Bank Accounts Directory
              </h3>
              <p className="text-xs text-slate-500 font-medium">Manage corporate bank accounts, account numbers, and opening balances.</p>
            </div>

            <button
              onClick={handleOpenAddModal}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
            >
              <Plus size={16} /> Add Bank Account
            </button>
          </div>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <input
                type="text"
                placeholder="Search name, account no, branch..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold"
              />
              <Search className="absolute right-3 top-2 text-slate-400" size={14} />
            </div>

            <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
              Total: {filtered.length} Bank Accounts
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">A/C Code</th>
                  <th className="p-3">Bank Name</th>
                  <th className="p-3">Account No.</th>
                  <th className="p-3">Branch</th>
                  <th className="p-3 text-right">Opening Balance</th>
                  <th className="p-3 text-right">Current Balance</th>
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
                    <tr key={b.id} className="border-b hover:bg-slate-50/50 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-mono font-semibold text-slate-600 text-xs">{b.baId}</td>
                      <td className="p-3 font-semibold text-slate-900">{b.name}</td>
                      <td className="p-3 font-mono text-slate-600">{b.accountNo || <span className="text-slate-300">—</span>}</td>
                      <td className="p-3 text-slate-600">{b.branch || <span className="text-slate-300">—</span>}</td>
                      <td className="p-3 text-right text-slate-500 font-mono">
                        {ba?.openingBalance != null ? formatCurrency(ba.openingBalance) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(bal)}</td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenEditModal(b)}
                            title="Edit Bank Account"
                            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => remove(b)}
                            title="Delete Bank Account"
                            className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                          >
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
                  <tr className="bg-slate-900 text-white font-bold text-xs">
                    <td colSpan={5} className="p-3 pl-4 uppercase tracking-wider text-[#B08D57]">Total across all banks</td>
                    <td className="p-3 text-right text-sm text-[#B08D57] font-mono">{formatCurrency(grandTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-[11px] text-slate-400 mt-4">
            Balance is derived from opening balance plus online receipts, deposits, and transfers in, minus payments, written cheques, and transfers out.
          </p>
        </div>

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Settings size={18} className="text-[#B08D57]" />
                  {selectedId ? 'Edit Bank Account' : 'Add Bank Account'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={save} className="p-5 flex flex-col gap-4">
                {errorMsg && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{errorMsg}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Account Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Bank Alfalah A/C - 0124"
                    className="soleria-input w-full font-semibold"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Account Number
                    </label>
                    <input
                      type="text"
                      value={accountNo}
                      onChange={e => setAccountNo(e.target.value)}
                      placeholder="e.g. 0124-7901-33"
                      className="soleria-input w-full font-mono font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Branch
                    </label>
                    <input
                      type="text"
                      value={branch}
                      onChange={e => setBranch(e.target.value)}
                      placeholder="e.g. Gulberg, Lahore"
                      className="soleria-input w-full font-semibold"
                    />
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border flex flex-col gap-3" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b pb-1.5">
                    Opening Balance
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Initial Amount</label>
                      <input
                        type="number"
                        value={openingBalance}
                        onChange={e => setOpeningBalance(e.target.value)}
                        placeholder="0"
                        className="soleria-input w-full text-right font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">As of Date</label>
                      <input
                        type="date"
                        value={openingDate}
                        onChange={e => setOpeningDate(e.target.value)}
                        className="soleria-input w-full font-semibold"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-gold px-5 py-2 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                  >
                    <Save size={14} /> Save Bank Account
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
