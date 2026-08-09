import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import ChequesTab from '@/components/ChequesTab';
import { ChequeReturnsContent } from '@/pages/ChequeReturnsContent';
import { ChequeLedgerContent } from '@/pages/ChequeLedgerContent';
import { ChequeInHandContent } from '@/pages/ChequeInHandContent';

type ChequeTab = 'disposal' | 'returns' | 'ledger' | 'in-hand';

const ALL_TABS: { key: ChequeTab; label: string; adminOnly?: boolean }[] = [
  // Disposal was hidden from role 'User' on the old Receipts "Cheques Disposal" tab — kept
  // restricted here too now that it's moved onto a page that isn't itself admin-only.
  { key: 'disposal', label: 'Disposal', adminOnly: true },
  { key: 'returns', label: 'Returns' },
  { key: 'ledger', label: 'Cheque Ledger' },
  { key: 'in-hand', label: 'Cheque in Hand' },
];

export default function ChequePage() {
  const { state } = useApp();
  const isUser = state.currentUserRole === 'User';
  const TABS = ALL_TABS.filter(t => !t.adminOnly || !isUser);

  const [activeTab, setActiveTab] = useState<ChequeTab>(() => {
    const initial = (state.currentTab as ChequeTab) || 'disposal';
    return initial === 'disposal' && isUser ? 'returns' : initial;
  });

  const [tabAnimating, setTabAnimating] = useState(false);

  const switchTab = (next: ChequeTab) => {
    if (next === activeTab) return;
    setTabAnimating(true);
    setTimeout(() => {
      setActiveTab(next);
      setTabAnimating(false);
    }, 180);
  };

  useEffect(() => {
    if (state.currentTab && TABS.some(t => t.key === state.currentTab)) {
      setActiveTab(state.currentTab as ChequeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentTab]);

  const activeTabObj = TABS.find(t => t.key === activeTab);

  return (
    <AppLayout pageTitle="Cheque" subTabTitle={activeTabObj?.label} subTabId={activeTab}>
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        {/* Top Bar Tabs - data-no-print */}
        <div className="flex flex-wrap gap-2 mb-6 border-b pb-3" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          {TABS.map(tab => (
            <button
              key={tab.key}
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ page: 'cheque-return', tab: tab.key, label: tab.label }));
              }}
              onClick={() => switchTab(tab.key)}
              title="Drag tab to Quick Access Menu Bar to pin"
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all cursor-grab active:cursor-grabbing ${
                activeTab === tab.key
                  ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={`transition-all duration-200 ${tabAnimating ? 'opacity-0 translate-y-2' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`}>
          {activeTab === 'disposal' && !isUser && <ChequesTab />}
          {activeTab === 'returns' && <ChequeReturnsContent />}
          {activeTab === 'ledger' && <ChequeLedgerContent />}
          {activeTab === 'in-hand' && <ChequeInHandContent />}
        </div>
      </div>
    </AppLayout>
  );
}
