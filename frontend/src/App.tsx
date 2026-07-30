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

// Accounting Setups
import GroupAcSetupPage from '@/pages/GroupAcSetupPage';
import ChartAcSetupPage from '@/pages/ChartAcSetupPage';
import BusinessAcSetupPage from '@/pages/BusinessAcSetupPage';

// Reports
import ReportStockPage from '@/pages/ReportStockPage';
import ReportsHubPage from '@/pages/ReportsHubPage';
import BiltyUpdatePage from '@/pages/BiltyUpdatePage';

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
    case 'expenses-entry':
      return <ExpensesPage />;
    case 'wage-run':
      return <WageRunPage />;
    case 'salary-run':
      return <SalaryRunPage />;

    // System Setup
    case 'setup-product':
      return <ProductSetupPage />;
    case 'setup-category':
      return <CategorySetupPage />;
    case 'setup-vendor':
      return <VendorSetupPage />;
    case 'setup-employee':
      return <EmployeeSetupPage />;
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

    case 'settings':
      return <SettingsPage />;

    default:
      return <HomePage />;
  }
}
