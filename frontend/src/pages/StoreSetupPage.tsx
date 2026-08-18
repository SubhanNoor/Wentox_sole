import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, Warehouse, X } from 'lucide-react';
import DataListTable from '@/components/DataListTable';
import DuplicateNamePromptModal, { type DuplicateNameMatch } from '@/components/DuplicateNamePromptModal';
import { stores as storesApi, type StoreRow } from '@/lib/api';

export default function StoreSetupPage() {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<DuplicateNameMatch | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Form State
  const [storeName, setStoreName] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = useCallback(async () => {
    const res = await storesApi.list({ includeInactive: true });
    if (res.ok) setStores(res.data);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleOpenAddModal = () => {
    setSelectedStoreId(null);
    setStoreName('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (store: StoreRow) => {
    setSelectedStoreId(store.store_id);
    setStoreName(store.name);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedStoreId(null);
    setStoreName('');
    setErrorMsg('');
  };

  // G-06: after a successful create, the window stays open and clears — ready for the next
  // store — instead of closing.
  const resetForNextStore = () => {
    setSelectedStoreId(null);
    setStoreName('');
    setErrorMsg('');
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  const handleSaveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = storeName.trim();
    if (!typed) return setErrorMsg('Please enter a Store name.');

    if (selectedStoreId) {
      const res = await storesApi.update(selectedStoreId, { name: typed });
      if (!res.ok) {
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('Store details updated successfully.');
      await loadData();
      handleCloseModal();
    } else {
      const res = await storesApi.create({ name: typed });
      if (!res.ok) {
        if (res.error.code === 'INACTIVE_DUPLICATE') {
          const details = res.error.details as { store_id: number; name: string } | undefined;
          setDupMatch(details ? { id: String(details.store_id), name: details.name } : null);
          setIsDupModalOpen(true);
          return;
        }
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('New Store registered successfully.');
      await loadData();
      resetForNextStore();
    }

    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleActivateDuplicate = async (id: string) => {
    const res = await storesApi.reactivate(Number(id));
    if (res.ok) {
      setSuccessMsg('Store reactivated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      await loadData();
    }
    setIsDupModalOpen(false);
    setDupMatch(null);
    resetForNextStore();
  };



  const filteredStores = useMemo(() => {
    const activeStores = stores.filter(s => s.is_active);
    if (!searchQuery.trim()) return activeStores;
    const q = searchQuery.toLowerCase();
    return activeStores.filter(s =>
      s.name.toLowerCase().includes(q) ||
      String(s.store_id).includes(q)
    );
  }, [stores, searchQuery]);

  return (
    <AppLayout pageTitle="Store Setup">
      <div className="mx-auto" style={{ maxWidth: 1750 }}>

        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && !isModalOpen && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        {/* Directory Header Card */}
        <div className="card-white p-6 md:p-8 bg-white border mb-6">
          <div className="border-b pb-4 mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                <Warehouse size={20} className="text-[#B08D57]" /> Stores Directory
              </h3>
              <p className="text-xs text-slate-500 font-medium">Manage warehouse inventory stores and branches.</p>
            </div>

            <button
              onClick={handleOpenAddModal}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
            >
              <Plus size={16} /> Register Store
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search by store name or ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="soleria-input w-full py-2 text-xs pr-10 font-semibold"
              />
              <Search className="absolute right-3.5 top-2.5 text-slate-400" size={14} />
            </div>

            <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
              Total: {filteredStores.length} Stores
            </div>
          </div>
        </div>

        {/* Stores Row List (shared DataListTable template) */}
        <div className="card-white overflow-hidden">
          <DataListTable<StoreRow>
            rows={filteredStores}
            rowKey={store => store.store_id}
            onRowClick={store => handleOpenEditModal(store)}
            emptyIcon={<Warehouse size={36} />}
            emptyMessage="No registered stores found matching your search."
            columns={[
              {
                key: 'code',
                header: 'Store Code',
                width: '150px',
                render: store => (
                  <span className="font-mono font-semibold text-slate-600 text-xs">#{store.store_id}</span>
                ),
              },
              {
                key: 'name',
                header: 'Store Name',
                render: store => <span className="font-semibold text-slate-900">{store.name}</span>,
              },
              {
                key: 'status',
                header: 'Status',
                width: '110px',
                align: 'center',
                render: () => (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border bg-emerald-50 text-emerald-700 border-emerald-200">
                    Active
                  </span>
                ),
              },
            ]}
            actions={store => (
              <>
                <button
                  onClick={() => handleOpenEditModal(store)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                  title="Edit Store"
                >
                  <Edit2 size={15} />
                </button>
              </>
            )}
          />
        </div>

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}
            onKeyDown={e => { if (e.key === 'Escape') { (handleCloseModal)(); } }}
            tabIndex={-1}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Settings size={18} className="text-[#B08D57]" />
                  {selectedStoreId ? 'Edit Store Details' : 'Register New Store'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveStore} className="p-5 flex flex-col gap-4">
                {errorMsg && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{errorMsg}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Store / Branch Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={storeName}
                    onChange={e => setStoreName(e.target.value)}
                    placeholder="e.g. Main Warehouse, Store 2"
                    className="soleria-input w-full font-semibold"
                    autoFocus
                  />
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
                    <Save size={14} /> Save Store
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="store"
          status="inactive"
          matches={dupMatch ? [dupMatch] : []}
          allowCreateOnActive={false}
          onActivate={handleActivateDuplicate}
          onCreateNew={() => {}}
          onCancel={() => {
            setIsDupModalOpen(false);
            setDupMatch(null);
          }}
        />

      </div>
    </AppLayout>
  );
}
