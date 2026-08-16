import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp, formatCurrency, balanceColor } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import * as api from '@/lib/api';
import type { BankAccountRow } from '@/lib/api';
import { Plus, Save, Edit2, Ban, RotateCcw, Landmark, Search, AlertTriangle, X } from 'lucide-react';
import DataListTable from '@/components/DataListTable';

export default function BankSetupPage() {
  const { state } = useApp();

  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
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

  // Current balances, keyed by the linked business account. This screen could only ever SET an
  // opening balance — it never showed what the bank actually stands at, which is the first thing
  // anyone opens it to check. One businessLedger summary call covers every bank at once rather than
  // an accountBalance round-trip per row. Restricted to admins by the same guard as everything else
  // under BANK ACCOUNTS, and this page is admin-only anyway.
  const [balances, setBalances] = useState<Record<number, number>>({});

  const loadBanks = useCallback(async (includeInactive: boolean) => {
    setLoading(true);
    const [res, ledgerRes] = await Promise.all([
      api.bankAccounts.list(includeInactive),
      api.reports.businessLedger({ view: 'summary' }),
    ]);
    if (res.ok) setBanks(res.data);
    else fail('Failed to load bank accounts: ' + res.error.message);
    if (ledgerRes.ok && Array.isArray(ledgerRes.data)) {
      setBalances(Object.fromEntries(ledgerRes.data.map(a => [a.ba_id, a.closing_balance])));
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadBanks(showInactive); }, [loadBanks, showInactive]);

  const handleOpenAddModal = () => {
    setSelectedId(null);
    setName(''); setAccountNo(''); setBranch('');
    setOpeningBalance(''); setOpeningDate(new Date().toISOString().split('T')[0]);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (bank: BankAccountRow) => {
    setSelectedId(bank.bank_id);
    setName(bank.name);
    setAccountNo(bank.account_no || '');
    setBranch(bank.branch || '');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedId(null);
    setName(''); setAccountNo(''); setBranch('');
    setOpeningBalance(''); setOpeningDate(new Date().toISOString().split('T')[0]);
    setErrorMsg('');
  };

  // G-06: after a successful create, the window stays open and clears — ready for the next bank
  // account — instead of closing. G-04: openingDate is deliberately NOT reset here; it stays
  // selected for the rest of this window's session and only resets (to today) on handleCloseModal.
  const resetForNextBank = () => {
    setSelectedId(null);
    setName(''); setAccountNo(''); setBranch('');
    setOpeningBalance('');
    setErrorMsg('');
    requestAnimationFrame(() => nameInputRef.current?.focus());
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
      handleCloseModal();
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
      resetForNextBank();
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
    resetForNextBank();
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
        {errorMsg && !isModalOpen && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <div className="px-4 py-2 text-sm font-semibold rounded-lg flex items-center gap-1.5 bg-[#111c2a] text-[#B08D57] shadow-sm">
              <Landmark size={15} /> Bank Accounts ({banks.length})
            </div>
          </div>
          <button onClick={handleOpenAddModal} className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer">
            <Plus size={16} /> Add Bank Account
          </button>
        </div>

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

          <DataListTable<BankAccountRow>
            rows={filtered}
            rowKey={b => b.bank_id}
            onRowClick={b => handleOpenEditModal(b)}
            loading={loading}
            loadingMessage="Loading..."
            emptyMessage={banks.length === 0
              ? 'No bank accounts yet. Add one so payments and receipts can name where the money moved.'
              : 'No accounts match this search.'}
            columns={[
              {
                key: 'code',
                header: 'A/C Code',
                width: '130px',
                render: b => (
                  <span className="font-mono font-semibold text-slate-600 text-xs">{b.ba_id ?? '—'}</span>
                ),
              },
              {
                key: 'name',
                header: 'Bank',
                render: b => <span className="font-semibold text-slate-900">{b.name}</span>,
              },
              {
                key: 'account_no',
                header: 'Account No.',
                render: b => b.account_no
                  ? <span className="font-mono text-slate-600 text-xs">{b.account_no}</span>
                  : <span className="text-slate-300">—</span>,
              },
              {
                key: 'branch',
                header: 'Branch',
                render: b => b.branch
                  ? <span className="text-slate-600">{b.branch}</span>
                  : <span className="text-slate-300">—</span>,
              },
              {
                key: 'balance',
                header: 'Balance',
                width: '150px',
                align: 'right',
                render: b => {
                  // ba_id is nullable on the row type; a bank with no linked ledger account has no
                  // balance to show rather than a misleading zero.
                  const bal = b.ba_id != null ? balances[b.ba_id] : undefined;
                  if (bal === undefined) return <span className="text-slate-300">—</span>;
                  return (
                    <span
                      className="font-mono text-xs font-bold"
                      style={{ color: balanceColor(bal) }}
                    >
                      {formatCurrency(Math.abs(bal))}
                      <span className="ml-1.5 text-[10px] font-semibold uppercase">{bal < 0 ? 'Cr' : 'Dr'}</span>
                    </span>
                  );
                },
              },
              {
                key: 'status',
                header: 'Status',
                width: '110px',
                align: 'center',
                render: b => b.is_active
                  ? <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>
                  : <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">Inactive</span>,
              },
            ]}
            actionsWidth="90px"
            actions={b => (
              b.is_active ? (
                <>
                  <button onClick={() => handleOpenEditModal(b)} title="Edit" className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800">
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
              )
            )}
          />
        </div>

        {/* Add/Edit Bank Account — Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}
            onKeyDown={e => { if (e.key === 'Escape') { (handleCloseModal)(); } }}
            tabIndex={-1}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Landmark size={18} className="text-[#B08D57]" />
                  {selectedId ? `Edit: ${name}` : 'Add Bank Account'}
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

                <p className="text-xs text-slate-500 -mt-1">
                  A ledger account is created automatically under Bank Accounts — no separate setup needed.
                </p>

                <div className="flex flex-col gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Account Name <span className="text-rose-500">*</span>
                    </label>
                    <input ref={nameInputRef} type="text" value={name} onChange={e => setName(e.target.value)}
                      placeholder="e.g. Bank Alfalah A/C - 0124" className="soleria-input w-full font-semibold" autoFocus />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">Account Number</label>
                      <input type="text" value={accountNo} onChange={e => setAccountNo(e.target.value)}
                        placeholder="e.g. 0124-7901-33" className="soleria-input w-full font-mono" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">Branch</label>
                      <input type="text" value={branch} onChange={e => setBranch(e.target.value)}
                        placeholder="e.g. Gulberg, Lahore" className="soleria-input w-full" />
                    </div>
                  </div>
                </div>

                {!selectedId && (
                  <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-3" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b pb-2">
                      Opening Balance
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Amount already in the account</label>
                        <input type="number" value={openingBalance} onChange={e => setOpeningBalance(e.target.value)}
                          placeholder="0" className="soleria-input w-full text-right font-semibold" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">As at</label>
                        <input type="date"
                          value={openingDate} onChange={e => setOpeningDate(e.target.value)}
                          className="soleria-input w-full" />
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      An account opened mid-life already holds money. This is where the running balance
                      starts — leave it blank for a genuinely new account. Set only when the account is
                      created; it cannot be changed afterward.
                    </p>
                  </div>
                )}

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
                    <Save size={14} /> {selectedId ? 'Save Changes' : 'Add Bank Account'}
                  </button>
                </div>
              </form>
            </div>
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
