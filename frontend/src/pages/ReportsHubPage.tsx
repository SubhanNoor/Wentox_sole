import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { SaleAnalysisContent } from '@/pages/SaleAnalysisPage';
import { SaleReportContent } from '@/pages/SaleReportPage';
import { VendorReportContent } from '@/pages/VendorReportPage';
import { PaymentTrailContent } from '@/pages/PaymentTrailPage';
import { ReportKhaataContent } from '@/pages/ReportKhaataPage';
import { ReportCashBookContent } from '@/pages/ReportCashBookPage';
import BusinessLedgerContent from '@/pages/BusinessLedgerContent';
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

// TASK-19: a single dedicated Reports section — top bar acts as tabs to
// switch between report types, each with its own filters below.
export default function ReportsHubPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('sale-analysis');

  return (
    <AppLayout pageTitle="Reports">
      <div className="mx-auto" style={{ maxWidth: 1150 }}>
        {/* Top Bar Tabs - data-no-print */}
        <div className="flex flex-wrap gap-2 mb-6 border-b pb-3" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                activeTab === tab.key
                  ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'sale-analysis' && <SaleAnalysisContent />}
        {activeTab === 'sale-report' && <SaleReportContent />}
        {activeTab === 'vendor' && <VendorReportContent />}
        {activeTab === 'payment-trail' && <PaymentTrailContent />}
        {activeTab === 'account-ledger' && <ReportKhaataContent />}
        {activeTab === 'business-ledger' && <BusinessLedgerContent />}
        {activeTab === 'cash-book' && <ReportCashBookContent />}
        {activeTab === 'product-ledger' && <ProductLedgerContent />}
        {activeTab === 'overall-trail' && <OverallTrailContent />}
      </div>
    </AppLayout>
  );
}
