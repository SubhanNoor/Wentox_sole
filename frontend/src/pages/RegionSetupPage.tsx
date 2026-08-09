import { useState, useMemo, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { Plus, Search, Settings, Save, Edit2, X, Globe } from 'lucide-react';
import DuplicateNamePromptModal, { type DuplicateNameMatch } from '@/components/DuplicateNamePromptModal';
import DataListTable from '@/components/DataListTable';
import { regions as regionsApi, type RegionRow } from '@/lib/api';

export default function RegionSetupPage() {
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [regionSearch, setRegionSearch] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);

  // Duplicate Check Modal state
  const [dupMatch, setDupMatch] = useState<DuplicateNameMatch | null>(null);
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);

  // Form State
  const [regionName, setRegionName] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = useCallback(async () => {
    const res = await regionsApi.list({ includeInactive: true });
    if (res.ok) setRegions(res.data);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleOpenAddModal = () => {
    setSelectedRegionId(null);
    setRegionName('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (region: RegionRow) => {
    setSelectedRegionId(region.region_id);
    setRegionName(region.name);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedRegionId(null);
    setRegionName('');
    setErrorMsg('');
  };

  const handleSaveRegion = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = regionName.trim();
    if (!typed) {
      return setErrorMsg('Region name is required.');
    }

    if (selectedRegionId) {
      const res = await regionsApi.update(selectedRegionId, { name: typed });
      if (!res.ok) {
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('Region details updated successfully.');
      await loadData();
    } else {
      const res = await regionsApi.create({ name: typed });
      if (!res.ok) {
        if (res.error.code === 'INACTIVE_DUPLICATE') {
          const details = res.error.details as { region_id: number; name: string } | undefined;
          setDupMatch(details ? { id: String(details.region_id), name: details.name } : null);
          setIsDupModalOpen(true);
          return;
        }
        return setErrorMsg(res.error.message);
      }
      setSuccessMsg('New region registered successfully.');
      await loadData();
    }

    setTimeout(() => setSuccessMsg(''), 3000);
    handleCloseModal();
  };

  const handleActivateDuplicate = async (id: string) => {
    const res = await regionsApi.reactivate(Number(id));
    if (res.ok) {
      setSuccessMsg('Region reactivated successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
      await loadData();
    }
    setIsDupModalOpen(false);
    setDupMatch(null);
    handleCloseModal();
  };



  const filteredRegions = useMemo(() => {
    const activeRegions = regions.filter(r => r.is_active);
    if (!regionSearch.trim()) return activeRegions;
    const q = regionSearch.toLowerCase();
    return activeRegions.filter(r =>
      r.name.toLowerCase().includes(q) ||
      String(r.region_id).includes(q)
    );
  }, [regions, regionSearch]);

  return (
    <AppLayout pageTitle="Region Setup">
      <div className="mx-auto" style={{ maxWidth: 1400 }}>

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
                <Globe size={20} className="text-[#B08D57]" /> Regions Directory
              </h3>
              <p className="text-xs text-slate-500 font-medium">Search and manage regions used for primary customer identification.</p>
            </div>

            <button
              onClick={handleOpenAddModal}
              className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer shadow-2xs hover:shadow-xs flex-shrink-0"
            >
              <Plus size={16} /> Create Region
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search by code, region name..."
                value={regionSearch}
                onChange={e => setRegionSearch(e.target.value)}
                className="soleria-input w-full py-2 text-xs pr-10 font-semibold"
              />
              <Search className="absolute right-3.5 top-2.5 text-slate-400" size={14} />
            </div>

            <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
              Total: {filteredRegions.length} Regions
            </div>
          </div>
        </div>

        {/* Regions Row List (shared DataListTable template) */}
        <div className="card-white overflow-hidden">
          <DataListTable<RegionRow>
            rows={filteredRegions}
            rowKey={region => region.region_id}
            onRowClick={region => handleOpenEditModal(region)}
            emptyIcon={<Globe size={36} />}
            emptyMessage="No registered regions found matching your search."
            columns={[
              {
                key: 'code',
                header: 'Region Code',
                width: '150px',
                render: region => (
                  <span className="font-mono font-semibold text-slate-600 text-xs">#{region.region_id}</span>
                ),
              },
              {
                key: 'name',
                header: 'Region Name',
                render: region => <span className="font-semibold text-slate-900">{region.name}</span>,
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
            actions={region => (
              <>
                <button
                  onClick={() => handleOpenEditModal(region)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                  title="Edit Region"
                >
                  <Edit2 size={15} />
                </button>
              </>
            )}
          />
        </div>

        {/* Modal Dialogue Box Pop-up */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200" onClick={handleCloseModal}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Settings size={18} className="text-[#B08D57]" />
                  {selectedRegionId ? 'Edit Region Details' : 'Register New Region'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveRegion} className="p-5 flex flex-col gap-4">
                {errorMsg && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{errorMsg}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Region Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={regionName}
                    onChange={e => setRegionName(e.target.value)}
                    placeholder="e.g. LOCAL, SOUTH, NORTH"
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
                    <Save size={14} /> Save Region
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <DuplicateNamePromptModal
          isOpen={isDupModalOpen}
          entityLabel="region"
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
