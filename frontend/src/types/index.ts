export interface City {
  id: string; // Code
  name: string;
}

export interface Store {
  id: string;
  name: string;
}

export interface Adda {
  id: string;
  name: string;
}

export interface Vendor {
  id: string;
  name: string;
}

export interface ProductCategory {
  id: string;
  name: string;
}

export interface Product {
  id: string; // Product Code
  name: string;
  categoryId: string;
  vendorId: string;
  batchNo: number;
  packing: number;
  costPrice: number;
  labour: number;
  proiCost: number;
  soleStich: number;
  pasting: number;
  trim: number;
  finishing: number;
  socksPasting: number;
  dc: number;
  sockStich: number;
  sheet: number;
  stubble: number;
  bottom: number;
  p1: number;
  p2: number;
  na: number;
  stock?: number; // Read-only current stock helper
}

export interface GroupAccount {
  id: string; // Code
  name: string;
  class: 'ASSETS' | 'LIABILITY' | 'INCOME' | 'EXPENSES';
}

export interface ControlAccount {
  id: string; // Code
  name: string;
  groupId: string;
  sorting: number;
}

export interface ChartOfAccount {
  id: string; // Code
  name: string;
  controlId: string;
  linkCode: string;
  status: 'Active' | 'Closed';
}

export interface BusinessAccount {
  id: string; // Code
  name: string;
  controlId: string;
  linkCode: string;
  region: string; // LOCAL etc.
  status: 'Active' | 'Closed';
}

export interface Customer {
  id: string; // Code
  name: string;
  acId: string; // Chart of Account ID
  cityId: string;
}

export interface SubCustomer {
  id: string; // Code
  name: string;
  customerId: string;
}

export interface SaleBillItem {
  id: string;
  productId: string;
  productName: string;
  packing: number;
  cartons: number;
  pairs: number;
  rate: number;
  discountPercent: number;
  discountValue: number;
  value: number;
}

export interface SaleBill {
  id: string; // Auto-generated PK
  date: string;
  storeId: string; // e.g. MAIN STORE LHR
  customerId: string;
  subCustomerId: string | null;
  customAddress?: string;
  mainAcId?: string;
  billNo: string; // manual bill number
  gpNo: string; // GP number
  biltyNo: string; // bilty number
  addaId: string; // Adda code reference
  remarks: string;
  invoiceDiscount: number;
  totalValue: number;
  status: 'Posted' | 'Unposted';
  items: SaleBillItem[];
}

export interface SaleReturnItem {
  id: string;
  productId: string;
  productName: string;
  packing: number;
  cartons: number;
  pairs: number;
  rate: number;
  discountPercent: number;
  discountValue: number;
  value: number;
}

export interface SaleReturn {
  id: string; // Auto-generated PK
  date: string;
  storeId: string; // destination store (TO)
  customerId: string;
  subCustomerId: string | null;
  billNo: string; // manual bill number
  gpNo: string;
  biltyNo: string;
  remarks: string;
  status: 'Posted' | 'Unposted';
  items: SaleReturnItem[];
}

export interface Receipt {
  id: string; // Auto PK
  date: string;
  customerId: string;
  amount: number;
  paymentMode: 'Cash' | 'Cheque' | 'Online';
  details: string; // bank details, cheque no, etc.
  remarks: string;
}

export type NavPage =
  | 'login'
  | 'sale-bill'
  | 'sale-return'
  | 'find-bill'
  | 'weekly-records'
  | 'monthly-records'
  | 'overall-records'
  | 'receipts-jamma'
  | 'setup-product'
  | 'setup-category'
  | 'setup-group-ac'
  | 'setup-control-ac'
  | 'setup-chart-ac'
  | 'setup-business-ac'
  | 'setup-sub-cust'
  | 'setup-city'
  | 'report-stock'
  | 'report-product-ledger'
  | 'report-khaata'
  | 'report-cashbook'
  | 'settings';
