import { useApp } from '@/context/AppContext';
import LoginPage from '@/pages/LoginPage';
import HomePage from '@/pages/HomePage';
import SaleBillPage from '@/pages/SaleBillPage';
import SaleReturnPage from '@/pages/SaleReturnPage';
import PurchasePage from '@/pages/PurchasePage';
import PurchaseReturnPage from '@/pages/PurchaseReturnPage';
import ReceiptsPage from '@/pages/ReceiptsPage';
import ExpensesPage from '@/pages/ExpensesPage';
import WageRunPage from '@/pages/WageRunPage';
import SalaryRunPage from '@/pages/SalaryRunPage';
import TransferPage from '@/pages/TransferPage';
import JournalVoucherPage from '@/pages/JournalVoucherPage';
import StockVoucherPage from '@/pages/StockVoucherPage';
import ChequePage from '@/pages/ChequePage';
import BankSetupPage from '@/pages/BankSetupPage';

// Setups
import ProductSetupPage from '@/pages/ProductSetupPage';
import CategorySetupPage from '@/pages/CategorySetupPage';
import VendorSetupPage from '@/pages/VendorSetupPage';
import EmployeeSetupPage from '@/pages/EmployeeSetupPage';
import CustomerSetupPage from '@/pages/CustomerSetupPage';
import SubCustomerSetupPage from '@/pages/SubCustomerSetupPage';
import CitySetupPage from '@/pages/CitySetupPage';
import RegionSetupPage from '@/pages/RegionSetupPage';
import AddaSetupPage from '@/pages/AddaSetupPage';
import StoreSetupPage from '@/pages/StoreSetupPage';
import UserManagementPage from '@/pages/UserManagementPage';

// Accounting Setups
import GroupAcSetupPage from '@/pages/GroupAcSetupPage';
import ChartAcSetupPage from '@/pages/ChartAcSetupPage';
import BusinessAcSetupPage from '@/pages/BusinessAcSetupPage';

// Reports
import ReportStockPage from '@/pages/ReportStockPage';
import ReportsHubPage from '@/pages/ReportsHubPage';
import BiltyUpdatePage from '@/pages/BiltyUpdatePage';
import OverallSearchPage from '@/pages/OverallSearchPage';
import SearchCustomerPage from '@/pages/SearchCustomerPage';

// Settings
import SettingsPage from '@/pages/SettingsPage';
import CheckForUpdatesPage from '@/pages/CheckForUpdatesPage';
import './App.css';

export default function App() {
  const { state } = useApp();

  if (!state.isLoggedIn) {
    return <LoginPage />;
  }

  const page = state.currentPage;

  switch (page) {
    case 'home':
      return <HomePage />;
    case 'sale-bill':
      return <SaleBillPage />;
    case 'sale-return':
      return <SaleReturnPage />;
    case 'purchase-entry':
      return <PurchasePage />;
    case 'purchase-return':
      return <PurchaseReturnPage />;
    // Weekly/Monthly/Overall/Find tabs were removed from Sale Bill's own redesign (replaced by
    // the Posted/Unposted browse dropdown + First/Pre./Next/Last right on the bill form) — these
    // routes still exist for old NAVIGATE targets (e.g. cheque due-date alerts) and just land on
    // the same page now.
    case 'find-bill':
    case 'weekly-records':
    case 'monthly-records':
    case 'overall-records':
      return <SaleBillPage />;
    case 'receipts-jamma':
      return <ReceiptsPage />;
    case 'expenses-entry':
      return <ExpensesPage />;
    case 'wage-run':
      return <WageRunPage />;
    case 'salary-run':
      return <SalaryRunPage />;
    case 'transfer':
      return <TransferPage />;
    case 'journal-voucher':
      return <JournalVoucherPage />;
    case 'stock-voucher':
      return <StockVoucherPage />;
    case 'cheque-return':
      return <ChequePage />;

    // System Setup
    case 'setup-product':
      return <ProductSetupPage />;
    case 'setup-category':
      return <CategorySetupPage />;
    case 'setup-vendor':
      return <VendorSetupPage />;
    case 'setup-employee':
      return <EmployeeSetupPage />;
    case 'setup-bank':
      return <BankSetupPage />;
    case 'setup-customer':
      return <CustomerSetupPage />;
    case 'setup-sub-cust':
      return <SubCustomerSetupPage />;
    case 'setup-city':
      return <CitySetupPage />;
    case 'setup-region':
      return <RegionSetupPage />;
    case 'setup-adda':
      return <AddaSetupPage />;
    case 'setup-store':
      return <StoreSetupPage />;
    case 'setup-users':
      return <UserManagementPage />;

    // Accounting Setup
    case 'setup-group-ac':
      return <GroupAcSetupPage />;
    case 'setup-chart-ac':
      return <ChartAcSetupPage />;
    case 'setup-business-ac':
      return <BusinessAcSetupPage />;

    // Reports
    case 'report-stock':
      return <ReportStockPage />;
    case 'reports':
      return <ReportsHubPage />;
    case 'bilty-update':
      return <BiltyUpdatePage />;
    case 'overall-search':
      return <OverallSearchPage />;
    case 'search-customer':
      return <SearchCustomerPage />;

    case 'settings':
      return <SettingsPage />;
    case 'check-updates':
      return <CheckForUpdatesPage />;

    default:
      return <HomePage />;
  }
}
