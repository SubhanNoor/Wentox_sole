import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { SaleAnalysisContent } from '@/pages/SaleAnalysisPage';
import { SaleReportContent } from '@/pages/SaleReportPage';
import { VendorReportContent } from '@/pages/VendorReportPage';
import { PaymentTrailContent } from '@/pages/PaymentTrailPage';
import { ReportKhaataContent } from '@/pages/ReportKhaataPage';
import { ReportCashBookContent } from '@/pages/ReportCashBookPage';
import ProductLedgerContent from '@/pages/ProductLedgerContent';
import OverallTrailContent from '@/pages/OverallTrailContent';

type ReportTab =
  | 'sale-analysis' | 'sale-report' | 'vendor' | 'payment-trail'
  | 'account-ledger' | 'business-ledger' | 'cash-book' | 'product-ledger'
  | 'overall-trail';

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'sale-analysis', label: 'Sale Analysis' },
  { key: 'sale-report', label: 'Sale Report' },
  { key: 'vendor', label: 'Vendor Report' },
  { key: 'payment-trail', label: 'Payment Trail' },
  { key: 'account-ledger', label: 'Account Ledger' },
  { key: 'business-ledger', label: 'Business Ledger' },
  { key: 'cash-book', label: 'Cash Book' },
  { key: 'product-ledger', label: 'Product Ledger' },
  { key: 'overall-trail', label: 'Overall Trail' },
];

export default function ReportsHubPage() {
  const { state } = useApp();
  const [activeTab, setActiveTab] = useState<ReportTab>(() => {
    return (state.currentTab as ReportTab) || 'sale-analysis';
  });

  const [tabAnimating, setTabAnimating] = useState(false);

  const switchTab = (next: ReportTab) => {
    if (next === activeTab) return;
    setTabAnimating(true);
    setTimeout(() => {
      setActiveTab(next);
      setTabAnimating(false);
    }, 180);
  };

  useEffect(() => {
    if (state.currentTab && TABS.some(t => t.key === state.currentTab)) {
      setActiveTab(state.currentTab as ReportTab);
    }
  }, [state.currentTab]);

  const activeTabObj = TABS.find(t => t.key === activeTab);

  return (
    <AppLayout pageTitle="Reports Hub" subTabTitle={activeTabObj?.label} subTabId={activeTab}>
      <div className="mx-auto" style={{ maxWidth: 1150 }}>
        {/* Top Bar Tabs - data-no-print */}
        <div className="flex flex-wrap gap-2 mb-6 border-b pb-3" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          {TABS.map(tab => (
            <button
              key={tab.key}
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ page: 'reports', tab: tab.key, label: tab.label }));
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
          {activeTab === 'sale-analysis' && <SaleAnalysisContent />}
          {activeTab === 'sale-report' && <SaleReportContent />}
          {activeTab === 'vendor' && <VendorReportContent />}
          {activeTab === 'payment-trail' && <PaymentTrailContent />}
          {activeTab === 'account-ledger' && <ReportKhaataContent />}
          {activeTab === 'business-ledger' && <ReportKhaataContent scope="all" />}
          {activeTab === 'cash-book' && <ReportCashBookContent />}
          {activeTab === 'product-ledger' && <ProductLedgerContent />}
          {activeTab === 'overall-trail' && <OverallTrailContent />}
        </div>
      </div>
    </AppLayout>
  );
}
