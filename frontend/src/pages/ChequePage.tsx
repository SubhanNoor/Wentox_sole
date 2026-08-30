import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import ChequesTab from '@/components/ChequesTab';
import { ChequeReturnsContent } from '@/pages/ChequeReturnsContent';
import { ChequeLedgerContent } from '@/pages/ChequeLedgerContent';
import { ChequeInHandContent } from '@/pages/ChequeInHandContent';

type ChequeTab = 'disposal' | 'returns' | 'ledger' | 'in-hand';

// Every tab is open to every role. Disposal used to be hidden from 'User' — inherited from the old
// Receipts "Cheques Disposal" tab — which left a USER able to receive a cheque through Receipts and
// then do nothing with it, while still being allowed to *undo* an endorsement on the Returns tab.
// UC-03 restricts a USER to two account heads (Cash at Banks, Directors Expenses – Drawings) and
// nothing else; that guard lives on the account itself, not on this screen. Confirmed with the
// client 2026-08-11.
const ALL_TABS: { key: ChequeTab; label: string }[] = [
  { key: 'disposal', label: 'Disposal' },
  { key: 'returns', label: 'Returns' },
  { key: 'ledger', label: 'Cheque Ledger' },
  { key: 'in-hand', label: 'Cheque in Hand' },
];

export default function ChequePage() {
  const { state } = useApp();
  const TABS = ALL_TABS;

  const [activeTab, setActiveTab] = useState<ChequeTab>(() => (state.currentTab as ChequeTab) || 'disposal');

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

  // Sub-tab switcher — lives in the top header bar next to the page title (AppLayout's
  // headerAction slot), same treatment as Sale Bill/Sale Return/Receipts/Expenses.
  const tabBar = (
    <div className="flex flex-wrap gap-1.5" data-no-print>
      {TABS.map(tab => (
        <button
          key={tab.key}
          draggable={true}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ page: 'cheque-return', tab: tab.key, label: tab.label }));
          }}
          onClick={() => switchTab(tab.key)}
          title="Drag tab to Quick Access Menu Bar to pin"
          className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all cursor-grab active:cursor-grabbing ${
            activeTab === tab.key
              ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  return (
    <AppLayout pageTitle="Cheque" subTabTitle={activeTabObj?.label} subTabId={activeTab} headerAction={tabBar}>
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        <div className={`transition-all duration-200 ${tabAnimating ? 'opacity-0 translate-y-2' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'}`}>
          {activeTab === 'disposal' && <ChequesTab />}
          {activeTab === 'returns' && <ChequeReturnsContent />}
          {activeTab === 'ledger' && <ChequeLedgerContent />}
          {activeTab === 'in-hand' && <ChequeInHandContent onGoToDisposal={() => switchTab('disposal')} />}
        </div>
      </div>
    </AppLayout>
  );
}
