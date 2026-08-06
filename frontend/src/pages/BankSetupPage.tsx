import { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import * as api from '@/lib/api';
import type { BankAccountRow } from '@/lib/api';
import { Plus, ArrowLeft, Save, Edit2, Ban, RotateCcw, Landmark, Search, AlertTriangle } from 'lucide-react';

export default function BankSetupPage() {
  const { state } = useApp();

  const [tab, setTab] = useState<'list' | 'form'>('list');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [branch, setBranch] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().split('T')[0]);

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [deactivatingBank, setDeactivatingBank] = useState<BankAccountRow | null>(null);
  const [reactivatePrompt, setReactivatePrompt] = useState<{ bank_id: number; name: string; account_no: string | null } | null>(null);

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3000); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const loadBanks = useCallback(async (includeInactive: boolean) => {
    setLoading(true);
    const res = await api.bankAccounts.list(includeInactive);
    if (res.ok) setBanks(res.data);
    else fail('Failed to load bank accounts: ' + res.error.message);
    setLoading(false);
  }, []);

  useEffect(() => { loadBanks(showInactive); }, [loadBanks, showInactive]);

  const addNew = () => {
    setSelectedId(null);
    setName(''); setAccountNo(''); setBranch('');
    setOpeningBalance(''); setOpeningDate(new Date().toISOString().split('T')[0]);
    setErrorMsg('');
    setTab('form');
  };

  const select = (bank: BankAccountRow) => {
    setSelectedId(bank.bank_id);
    setName(bank.name);
    setAccountNo(bank.account_no || '');
    setBranch(bank.branch || '');
    setErrorMsg('');
    setTab('form');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErrorMsg('Bank account name is required.');

    const opening = openingBalance.trim() === '' ? undefined : Number(openingBalance);
    if (opening !== undefined && isNaN(opening)) return setErrorMsg('Opening balance must be a number.');
    if (opening !== undefined && !openingDate) return setErrorMsg('An opening balance needs a date.');

    if (selectedId) {
      const res = await api.bankAccounts.update(selectedId, {
        name: name.trim(),
        account_no: accountNo.trim() || undefined,
        branch: branch.trim() || undefined
      });
      if (!res.ok) return setErrorMsg(res.error.message);
      flash('Bank account updated.');
      setSelectedId(null);
      setTab('list');
      loadBanks(showInactive);
    } else {
      const payload: Parameters<typeof api.bankAccounts.create>[0] = {
        name: name.trim(),
        account_no: accountNo.trim() || undefined,
        branch: branch.trim() || undefined
      };
      if (opening !== undefined) {
        payload.opening_balance = opening;
        payload.opening_date = openingDate;
      }
      const res = await api.bankAccounts.create(payload);
      if (!res.ok) {
        if (res.error.code === 'INACTIVE_DUPLICATE' && res.error.details) {
          setReactivatePrompt(res.error.details as { bank_id: number; name: string; account_no: string | null });
          return;
        }
        return setErrorMsg(res.error.message);
      }
      flash('Bank account added. It can now be selected on payments and receipts.');
      setSelectedId(null);
      setTab('list');
      loadBanks(showInactive);
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivatingBank) return;
    const res = await api.bankAccounts.remove(deactivatingBank.bank_id);
    if (!res.ok) { fail('Failed to deactivate: ' + res.error.message); setDeactivatingBank(null); return; }
    flash('Bank account deactivated.');
    setDeactivatingBank(null);
    loadBanks(showInactive);
  };

  const reactivate = async (bankId: number) => {
    const res = await api.bankAccounts.reactivate(bankId);
    if (!res.ok) return fail('Failed to reactivate: ' + res.error.message);
    flash('Bank account reactivated.');
    loadBanks(showInactive);
  };

  const confirmReactivateFromPrompt = async () => {
    if (!reactivatePrompt) return;
    const res = await api.bankAccounts.reactivate(reactivatePrompt.bank_id);
    setReactivatePrompt(null);
    if (!res.ok) return fail('Failed to reactivate: ' + res.error.message);
    flash('Existing bank account reactivated.');
    setSelectedId(null);
    setTab('list');
    setShowInactive(false);
    loadBanks(false);
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return banks;
    const q = search.toLowerCase();
    return banks.filter(b =>
      b.name.toLowerCase().includes(q) ||
      (b.account_no || '').toLowerCase().includes(q) ||
      (b.branch || '').toLowerCase().includes(q)
    );
  }, [banks, search]);

  // Defense-in-depth: the sidebar already hides this page's nav item for User (UC-03), but this
  // page has no other route to it — guard here too rather than rely solely on the sidebar.
  if (state.currentUserRole === 'User') {
    return (
      <AppLayout pageTitle="Bank Accounts">
        <div className="mx-auto text-center p-12 text-slate-400" style={{ maxWidth: 1100 }}>
          You don't have access to this page.
        </div>
      </AppLayout>
    );
  }

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
              <Landmark size={15} /> Bank Accounts ({banks.length})
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
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 pb-2 cursor-pointer">
                  <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                  Show inactive
                </label>
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
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">A/C Code</th>
                    <th className="p-3">Bank</th>
                    <th className="p-3">Account No.</th>
                    <th className="p-3">Branch</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3 text-center" style={{ width: 90 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-slate-400">Loading...</td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-slate-400">
                        {banks.length === 0
                          ? 'No bank accounts yet. Add one so payments and receipts can name where the money moved.'
                          : 'No accounts match this search.'}
                      </td>
                    </tr>
                  ) : filtered.map(b => (
                    <tr key={b.bank_id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-mono font-semibold text-slate-600">{b.ba_id ?? '—'}</td>
                      <td className="p-3 font-semibold text-slate-900">{b.name}</td>
                      <td className="p-3 font-mono text-slate-600">{b.account_no || <span className="text-slate-300">—</span>}</td>
                      <td className="p-3 text-slate-600">{b.branch || <span className="text-slate-300">—</span>}</td>
                      <td className="p-3 text-center">
                        {b.is_active ? (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>
                        ) : (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">Inactive</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {b.is_active ? (
                            <>
                              <button onClick={() => select(b)} title="Edit" className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800">
                                <Edit2 size={15} />
                              </button>
                              <button onClick={() => setDeactivatingBank(b)} title="Deactivate" className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600">
                                <Ban size={15} />
                              </button>
                            </>
                          ) : (
                            <button onClick={() => reactivate(b.bank_id)} title="Reactivate" className="p-1.5 rounded hover:bg-emerald-50 text-slate-400 hover:text-emerald-600">
                              <RotateCcw size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

              {!selectedId && (
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
                    starts — leave it blank for a genuinely new account. Set only when the account is
                    created; it cannot be changed afterward.
                  </p>
                </div>
              )}

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

        {/* ── Deactivate confirmation ── */}
        {deactivatingBank && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
            <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
              <h3 className="font-lora font-bold text-lg text-slate-800 mb-2 flex items-center gap-2">
                <AlertTriangle size={18} className="text-rose-600" /> Deactivate Bank Account
              </h3>
              <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                <strong>{deactivatingBank.name}</strong> will be hidden from selection on new payments
                and receipts. Its ledger account and history stay intact — this can be undone any time
                with Reactivate.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeactivatingBank(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeactivate}
                  className="px-4 py-2 text-sm rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                >
                  Confirm Deactivate
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Reactivate-instead-of-create prompt ── */}
        {reactivatePrompt && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
            <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
              <h3 className="font-lora font-bold text-lg text-slate-800 mb-2 flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-600" /> Inactive Account Found
              </h3>
              <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                An inactive bank account named <strong>{reactivatePrompt.name}</strong>
                {reactivatePrompt.account_no ? <> (A/C {reactivatePrompt.account_no})</> : null} already
                exists. Reactivate it instead of creating a new one?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setReactivatePrompt(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmReactivateFromPrompt}
                  className="px-4 py-2 text-sm rounded-lg bg-[#111c2a] text-[#B08D57] hover:opacity-90"
                >
                  Reactivate Existing
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
