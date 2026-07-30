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

// A worker is the same shape as a Vendor: a real-world party that also needs a
// ledger account. Wages will be piece-rate — an article's stage cost (Cutting,
// Edging, …) times the quantity a worker completed — so a worker needs its own
// id for future work rows to reference, not just an anonymous account.
export interface Worker {
  id: string;
  name: string;
  phone?: string;
  cityId?: string;  // the legacy ledger shows City for employee accounts
  baId: string;     // linked Business Account under WORKER WAGES (220001), a LIABILITY
}

export interface ProductCategory {
  id: string;
  name: string;
}

// The 12 manufacturing stages, in the order they appear on the form.
// Single source of truth: the form, the demo data and the Product type all
// derive from this, so adding or renaming a stage is a one-line change.
export const COST_FIELDS = [
  { key: 'cutting',     label: 'Cutting' },
  { key: 'edging',      label: 'Edging' },
  { key: 'upStitch',    label: 'Up Stitch' },
  { key: 'bending',     label: 'Bending' },
  { key: 'stubbleDori', label: 'Stubble / Dori' },
  { key: 'shapeForm',   label: 'Shape Form' },
  { key: 'chipkai',     label: 'Chipkai' },
  { key: 'bottom',      label: 'Bottom' },
  { key: 'machine',     label: 'Machine' },
  { key: 'trimming',    label: 'Trimming' },
  { key: 'sockStitch',  label: 'Sock Stitch' },
  { key: 'finish',      label: 'Finish' },
] as const;

export type CostFieldKey = typeof COST_FIELDS[number]['key'];

/** Per-stage manufacturing costs. Entered by hand and never aggregated. */
export type ProductCosts = Record<CostFieldKey, number>;

export interface Product extends ProductCosts {
  id: string; // Product Code
  name: string;
  color?: string;
  categoryId: string;
  vendorId: string;
  batchNo: number;
  packing: number;
  // The single price on a product — typed in, never computed from the stage
  // costs above. Used wherever the product is sold.
  salePrice: number;
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

// TASK-14: Admin = full access. User = everything except Bank Accounts and
// Director Expenses - Drawings accounts.
export type UserRole = 'Admin' | 'User';

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
  bouncedDate?: string; // date the bounce was recorded — reversing entries are dated here
  remarks: string;
}

// §13 — a received cheque is a pool of value allocated across one or more
// destinations until its unallocated balance reaches zero.
export type ChequeDisposition = 'DEPOSIT' | 'VENDOR_PAYMENT' | 'EXPENSE_PAYMENT';

export interface ChequeAllocation {
  id: string;
  receiptId: string;
  dispositionType: ChequeDisposition;
  targetType: 'VENDOR' | 'BUSINESS_ACCOUNT' | null; // null for DEPOSIT
  targetId: string | null;                          // vendorId or businessAccountId
  amount: number;
  allocationDate: string;
  remarks: string;
  // REVERSED = the sourcing cheque bounced. The row is kept, not deleted:
  // history stays intact and a counter-entry is posted on the bounce date.
  status: 'ACTIVE' | 'REVERSED';
}

// §12 — alerts are derived live from state; only the dismissal is stored.
export interface AlertDismissal {
  alertKey: string;
  dismissedAt: string;
}

export type AlertKind = 'CHEQUE_DUE' | 'PAYMENT_OVERDUE';
export type AlertSeverity = 'overdue' | 'due-soon';

export interface AppAlert {
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  date: string;   // the cheque/due date driving the alert
  amount: number;
  targetPage: string;
  targetTab?: string;
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
  | 'setup-worker'
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
