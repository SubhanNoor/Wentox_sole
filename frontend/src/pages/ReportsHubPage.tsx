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
  | 'overall-trail' | 'vendor-balances' | 'customer-balances';

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
  // Same Overall Trail content, just opened straight into its own Quick Filter pill (Account
  // Reports menu, 2026-08-26) instead of the unfiltered "All Accounts" view.
  { key: 'vendor-balances', label: 'Vendor Balances' },
  { key: 'customer-balances', label: 'Customer Balances' },
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

  // Sub-tab switcher — lives in the top header bar next to the page title (AppLayout's
  // headerAction slot), same treatment as Sale Bill/Sale Return/Receipts/Expenses/Cheque.
  const tabBar = (
    <div className="flex flex-wrap gap-1.5" data-no-print>
      {TABS.map(tab => (
        <button
          key={tab.key}
          draggable={true}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ page: 'reports', tab: tab.key, label: tab.label }));
          }}
          onClick={() => switchTab(tab.key)}
          title="Drag tab to Quick Access Menu Bar to pin"
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-grab active:cursor-grabbing whitespace-nowrap ${
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
    <AppLayout pageTitle="Reports Hub" subTabTitle={activeTabObj?.label} subTabId={activeTab} headerAction={tabBar}>
      <div className="mx-auto" style={{ maxWidth: 1150 }}>
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
          {activeTab === 'vendor-balances' && <OverallTrailContent initialGroup="vendor" />}
          {activeTab === 'customer-balances' && <OverallTrailContent initialGroup="customer" />}
        </div>
      </div>
    </AppLayout>
  );
}
