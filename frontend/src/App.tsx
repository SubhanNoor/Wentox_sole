import { useApp } from '@/context/AppContext';
import LoginPage from '@/pages/LoginPage';
import SaleBillPage from '@/pages/SaleBillPage';
import SaleReturnPage from '@/pages/SaleReturnPage';
import ReceiptsPage from '@/pages/ReceiptsPage';

// Setups
import ProductSetupPage from '@/pages/ProductSetupPage';
import CategorySetupPage from '@/pages/CategorySetupPage';
import SubCustomerSetupPage from '@/pages/SubCustomerSetupPage';
import CitySetupPage from '@/pages/CitySetupPage';

// Accounting Setups
import GroupAcSetupPage from '@/pages/GroupAcSetupPage';
import ControlAcSetupPage from '@/pages/ControlAcSetupPage';
import ChartAcSetupPage from '@/pages/ChartAcSetupPage';
import BusinessAcSetupPage from '@/pages/BusinessAcSetupPage';

// Reports
import ReportStockPage from '@/pages/ReportStockPage';
import ReportProductLedgerPage from '@/pages/ReportProductLedgerPage';
import ReportKhaataPage from '@/pages/ReportKhaataPage';
import ReportCashBookPage from '@/pages/ReportCashBookPage';

// Settings
import SettingsPage from '@/pages/SettingsPage';
import './App.css';

export default function App() {
  const { state } = useApp();

  if (!state.isLoggedIn) {
    return <LoginPage />;
  }

  const page = state.currentPage;

  switch (page) {
    case 'sale-bill':
      return <SaleBillPage />;
    case 'sale-return':
      return <SaleReturnPage />;
    case 'find-bill':
      return <SaleBillPage initialTab="find" />;
    case 'weekly-records':
      return <SaleBillPage initialTab="weekly" />;
    case 'monthly-records':
      return <SaleBillPage initialTab="monthly" />;
    case 'overall-records':
      return <SaleBillPage initialTab="overall" />;
    case 'receipts-jamma':
      return <ReceiptsPage />;

    // System Setup
    case 'setup-product':
      return <ProductSetupPage />;
    case 'setup-category':
      return <CategorySetupPage />;
    case 'setup-sub-cust':
      return <SubCustomerSetupPage />;
    case 'setup-city':
      return <CitySetupPage />;

    // Accounting Setup
    case 'setup-group-ac':
      return <GroupAcSetupPage />;
    case 'setup-control-ac':
      return <ControlAcSetupPage />;
    case 'setup-chart-ac':
      return <ChartAcSetupPage />;
    case 'setup-business-ac':
      return <BusinessAcSetupPage />;

    // Reports
    case 'report-stock':
      return <ReportStockPage />;
    case 'report-product-ledger':
      return <ReportProductLedgerPage />;
    case 'report-khaata':
      return <ReportKhaataPage />;
    case 'report-cashbook':
      return <ReportCashBookPage />;

    case 'settings':
      return <SettingsPage />;

    default:
      return <SaleBillPage />;
  }
}
