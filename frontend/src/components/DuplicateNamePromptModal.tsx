import { AlertTriangle, Check, Plus, RotateCcw, X } from 'lucide-react';
import DataListTable from '@/components/DataListTable';

// Mirrors the backend's checkName() result shape (customers/subCustomers/vendors services):
//   { status: 'none' | 'active' | 'inactive', matches: [...] }
// This modal only ever needs to render for 'active' or 'inactive' — callers skip it on 'none'.
export type DuplicateNameStatus = 'active' | 'inactive';

export interface DuplicateNameMatch {
  id: string;
  name: string;
  regionName?: string;
  cityName?: string;
  phone?: string;
}

interface DuplicateNamePromptModalProps {
  isOpen: boolean;
  entityLabel: string; // e.g. "vendor", "customer", "sub-customer"
  status: DuplicateNameStatus;
  matches: DuplicateNameMatch[];
  // Unique-by-nature entities (vendors, regions, cities, stores, products, employees) block
  // creation on an ACTIVE match — this modal is informational only there, no "create anyway".
  // Customers/sub-customers allow it, since real people can share a name.
  allowCreateOnActive: boolean;
  onActivate: (id: string) => void;
  onCreateNew: () => void;
  onCancel: () => void;
}

// NOT YET WIRED to any page's save flow — built as the reusable prompt for the checkName()
// endpoints (customers/subCustomers/vendors). Pages should call <feature>:checkName before create,
// then render this on a non-'none' result instead of calling create() directly.
export default function DuplicateNamePromptModal({
  isOpen,
  entityLabel,
  status,
  matches,
  allowCreateOnActive,
  onActivate,
  onCreateNew,
  onCancel,
}: DuplicateNamePromptModalProps) {
  if (!isOpen) return null;

  const isInactive = status === 'inactive';
  const title = isInactive
    ? `Inactive ${entityLabel} already exists`
    : `${entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1)} already exists`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
      tabIndex={-1}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="bg-[#111c2a] p-5 text-white flex items-center justify-between border-b border-[#B08D57]/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#B08D57]/20 border border-[#B08D57]/40 text-[#B08D57]">
              <AlertTriangle size={22} />
            </div>
            <div>
              <h3 className="font-lora font-bold text-base text-[#B08D57]">{title}</h3>
              <p className="text-xs text-slate-300 font-inter mt-0.5">
                {matches.length} matching {matches.length === 1 ? 'record' : 'records'} found
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          <p className="text-xs font-semibold text-slate-600 mb-4 leading-relaxed">
            {isInactive
              ? `An inactive ${entityLabel} with this name already exists. You can reactivate it instead of creating a new record, or create a new one anyway.`
              : `An active ${entityLabel} with this name already exists.${
                  allowCreateOnActive ? ' You can still create a new one — this is just a heads-up.' : ''
                }`}
          </p>

          <div className="mb-5 max-h-48 overflow-y-auto border rounded-lg" style={{ borderColor: 'var(--border-color)' }}>
            <DataListTable<DuplicateNameMatch>
              rows={matches}
              rowKey={m => m.id}
              emptyMessage="No matching records."
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  render: m => <span className="text-xs font-bold text-slate-800">{m.name}</span>,
                },
                {
                  key: 'details',
                  header: 'Details',
                  render: m => (
                    <span className="text-[11px] text-slate-500 font-medium">
                      {[m.regionName, m.cityName, m.phone].filter(Boolean).join(' · ') || `Code: ${m.id}`}
                    </span>
                  ),
                },
              ]}
              actionsWidth="110px"
              actionsHeader={isInactive ? 'Actions' : ''}
              actions={isInactive ? (m => (
                  <button
                    type="button"
                    onClick={() => onActivate(m.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-all"
                  >
                    <RotateCcw size={12} /> Activate
                  </button>
              )) : undefined}
            />
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all"
            >
              Cancel
            </button>
            {(isInactive || allowCreateOnActive) && (
              <button
                type="button"
                onClick={onCreateNew}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-[#111c2a] bg-[#B08D57] hover:bg-[#111c2a] hover:text-[#B08D57] border border-[#B08D57] rounded-lg transition-all shadow-sm"
              >
                <Plus size={14} /> Create New Anyway
              </button>
            )}
            {!isInactive && !allowCreateOnActive && (
              <button
                type="button"
                onClick={onCancel}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-[#111c2a] bg-[#B08D57] hover:bg-[#111c2a] hover:text-[#B08D57] border border-[#B08D57] rounded-lg transition-all shadow-sm"
              >
                <Check size={14} /> Okay
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
