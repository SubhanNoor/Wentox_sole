export interface City {
  id: string; // Code
  name: string;
}

export interface Region {
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
  phone?: string;
  city?: string;
  regionId?: string;
  baId: string; // linked Business Account under the "Vendors" chart account
}

export interface ProductCategory {
  id: string;
  name: string;
}

export interface Product {
  id: string; // Product Code
  name: string;
  color?: string;
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

export interface ChartOfAccount {
  id: string; // Code
  name: string;
  groupId: string; // parent Group Account
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
  regionId: string; // primary identification, checked before City
  cityId: string;
}

export interface SubCustomer {
  id: string; // Code
  name: string;
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
  dueDate?: string; // optional — blank means no payment-overdue alert for this bill
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
  invoiceDiscount?: number;
  status: 'Posted' | 'Unposted';
  items: SaleReturnItem[];
}

export type ChequeStatus = 'PENDING' | 'DEPOSITED' | 'ENDORSED' | 'PARTIALLY_ENDORSED' | 'CLEARED' | 'BOUNCED';

export interface Receipt {
  id: string; // Auto PK
  date: string;
  customerId: string;
  amount: number;
  commission?: number; // payment-time only, reduces payable — never changes the sale bill
  paymentMode: 'Cash' | 'Cheque' | 'Online';
  details: string; // bank details, online ref, etc.
  chequeNo?: string;
  chequeDate?: string; // date written on the cheque
  chequeReceivedDate?: string; // date physically received
  chequeStatus?: ChequeStatus;
  remarks: string;
}

export interface Expense {
  id: string; // Auto PK
  date: string;
  businessAccountId: string;
  amount: number;
  paymentMode: 'Cash' | 'Cheque' | 'Online';
  details: string;
  remarks: string;
}

export interface PurchaseItem {
  id: string;
  materialName: string; // free text, raw material — not linked to Product
  unit: string; // e.g. Meters, Buckles, KG — dropdown or self-typed
  quantity: number;
  pricePerUnit: number;
  totalPrice: number; // auto = quantity * pricePerUnit
}

export interface Purchase {
  id: string; // Auto-generated PK
  date: string;
  vendorId: string;
  remarks: string;
  items: PurchaseItem[];
  totalValue: number;
}

export interface PurchaseReturnItem {
  id: string;
  materialName: string;
  unit: string;
  quantity: number;
  pricePerUnit: number;
  totalPrice: number;
}

export interface PurchaseReturn {
  id: string; // Auto-generated PK
  date: string;
  vendorId: string;
  remarks: string;
  items: PurchaseReturnItem[];
  totalValue: number;
}

export interface ProductionLog {
  id: string;
  date: string;
  productId: string;
  quantity: number; // total pairs
  qtyValue: number; // input quantity
  unitType: 'cartons' | 'pairs';
  packing: number;
}

export type NavPage =
  | 'login'
  | 'home'
  | 'sale-bill'
  | 'sale-return'
  | 'purchase-entry'
  | 'purchase-return'
  | 'find-bill'
  | 'weekly-records'
  | 'monthly-records'
  | 'overall-records'
  | 'receipts-jamma'
  | 'expenses-entry'
  | 'setup-product'
  | 'setup-category'
  | 'setup-vendor'
  | 'setup-customer'
  | 'setup-group-ac'
  | 'setup-chart-ac'
  | 'setup-business-ac'
  | 'setup-sub-cust'
  | 'setup-city'
  | 'setup-region'
  | 'setup-adda'
  | 'report-stock'
  | 'reports'
  | 'bilty-update'
  | 'settings';
