import type { UserRole } from '@/types';

/**
 * Thin wrapper over `window.api.<feature>.<action>(payload)`, exposed by
 * `backend/electron/preload.js`'s `contextBridge` — only present when this app is
 * actually running inside the backend's Electron shell (never in a plain browser
 * tab hitting the Vite dev server directly). Module 9.2.
 */

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { message: string; code: string; details?: unknown } };
export type ApiResult<T> = ApiOk<T> | ApiFail;

// ── Module 2 row/input shapes — field names match database/schema.sql exactly ──

export interface SaleBillItemRow {
  item_id: number;
  variant_id: number;
  cartons: number;
  pairs: number;
  rate: number;
  discount_percent: number;
  discount_value: number;
  value: number;
  line_no: number;
  color?: string;
  article_code?: string;
  article_name?: string;
}

export interface SaleBillItemInput {
  variant_id: number;
  cartons: number;
  rate: number;
  discount_percent: number;
}

export interface SaleBillRow {
  bill_id: number;
  bill_date: string;
  store_id: number | null;
  customer_id: number;
  sub_customer_id: number | null;
  main_ac_id: number | null;
  delivery_type: 'SAME' | 'CUSTOM';
  delivery_address: string | null;
  bill_no: string;
  gp_no: string;
  bilty_no: string;
  adda_id: number;
  remarks: string | null;
  invoice_discount: number;
  total_cartons: number;
  total_pairs: number;
  gross_value: number;
  net_value: number;
  due_date: string | null;
  is_posted: boolean;
  items: SaleBillItemRow[];
}

export interface SaleBillCreateInput {
  customer_id: number;
  sub_customer_id?: number | null;
  main_ac_id?: number | null;
  store_id: number;
  bill_date: string;
  delivery_type?: 'SAME' | 'CUSTOM';
  delivery_address?: string;
  bill_no: string;
  gp_no: string;
  bilty_no: string;
  adda_id: number;
  remarks?: string;
  invoice_discount?: number;
  due_date?: string;
  items: SaleBillItemInput[];
}

export interface SaleBillListFilters {
  customer_id?: number;
  sub_customer_id?: number;
  bill_no?: string;
  date_from?: string;
  date_to?: string;
  range?: 'weekly' | 'monthly' | 'overall';
}

export interface SaleReturnItemRow {
  item_id: number;
  variant_id: number;
  cartons: number;
  pairs: number;
  rate: number;
  discount_percent: number;
  discount_value: number;
  value: number;
  line_no: number;
  color?: string;
  article_code?: string;
  article_name?: string;
}

export interface SaleReturnItemInput {
  variant_id: number;
  cartons: number;
  rate: number;
  discount_percent: number;
}

export interface SaleReturnRow {
  return_id: number;
  return_date: string;
  store_id: number | null;
  customer_id: number;
  sub_customer_id: number | null;
  bill_no: string;
  gp_no: string;
  bilty_no: string;
  adda_id: number;
  remarks: string | null;
  invoice_discount: number;
  total_cartons: number;
  total_pairs: number;
  gross_value: number;
  net_value: number;
  is_posted: boolean;
  items: SaleReturnItemRow[];
}

export interface SaleReturnCreateInput {
  customer_id: number;
  sub_customer_id?: number | null;
  store_id: number;
  return_date: string;
  bill_no: string;
  gp_no: string;
  bilty_no: string;
  adda_id: number;
  remarks?: string;
  invoice_discount?: number;
  items: SaleReturnItemInput[];
}

export interface SaleReturnListFilters {
  customer_id?: number;
  sub_customer_id?: number;
  bill_no?: string;
  date_from?: string;
  date_to?: string;
  range?: 'weekly' | 'monthly' | 'overall';
}

export interface CustomerRow {
  customer_id: number;
  name: string;
  ba_id: number | null;
  region_id: number;
  city_id: number | null;
  address: string | null;
  is_active: boolean;
}

export interface SubCustomerRow {
  sub_customer_id: number;
  name: string;
  region_id: number;
  city_id: number | null;
  address: string | null;
  is_active: boolean;
}

export interface ProductRow {
  article_id: number;
  code: string;
  name: string;
  category_id: number;
  vendor_id: number;
  batch_no: number;
  packing: number;
  sale_price: number;
  is_active: boolean;
}

export interface ProductVariantRow {
  variant_id: number;
  article_id: number;
  color: string;
  packing: number;
}

export interface StoreRow {
  store_id: number;
  name: string;
  is_active: boolean;
}

export interface AddaRow {
  adda_id: number;
  name: string;
  region_id: number;
  city_id: number | null;
  details: string | null;
  is_active: boolean;
}

export interface RegionRow {
  region_id: number;
  name: string;
  is_active: boolean;
}

export interface CityRow {
  city_id: number;
  name: string;
  region_id: number | null;
  region_name?: string;
  is_active: boolean;
}

export interface CustomerCreateInput {
  name: string;
  region_id: number;
  city_id?: number;
  address?: string;
}

export interface SubCustomerCreateInput {
  name: string;
  region_id: number;
  city_id?: number;
  address?: string;
}

// ── Module 3 row/input shapes — field names match database/schema.sql exactly ──

export interface VendorRow {
  vendor_id: number;
  name: string;
  phone: string | null;
  region_id: number | null;
  city_id: number | null;
  ba_id: number | null;
  is_active: boolean;
}

export interface VendorCreateInput {
  name: string;
  phone?: string;
  region_id?: number;
  city_id?: number;
}

export interface PurchaseItemRow {
  item_id: number;
  material_id: number;
  material_name?: string;
  unit: string;
  quantity: number;
  weight: number | null;
  price_per_unit: number;
  total_price: number;
  line_no: number;
}

export interface PurchaseItemInput {
  material_id?: number;
  material_name?: string;
  unit: string;
  quantity: number;
  weight?: number;
  price_per_unit: number;
}

export interface PurchaseRow {
  purchase_id: number;
  purchase_date: string;
  vendor_id: number;
  bill_no: string | null;
  remarks: string | null;
  total_value: number;
  is_posted: boolean;
  items: PurchaseItemRow[];
}

export interface PurchaseCreateInput {
  vendor_id: number;
  purchase_date: string;
  bill_no?: string;
  remarks?: string;
  items: PurchaseItemInput[];
}

export interface PurchaseListFilters {
  vendor_id?: number;
  date_from?: string;
  date_to?: string;
  range?: 'weekly' | 'monthly' | 'overall';
}

export interface PurchaseReturnItemRow {
  item_id: number;
  material_id: number;
  material_name?: string;
  unit: string;
  quantity: number;
  weight: number | null;
  price_per_unit: number;
  total_price: number;
  line_no: number;
}

export interface PurchaseReturnItemInput {
  material_id?: number;
  material_name?: string;
  unit: string;
  quantity: number;
  weight?: number;
  price_per_unit: number;
}

export interface PurchaseReturnRow {
  return_id: number;
  return_date: string;
  vendor_id: number;
  bill_no: string | null;
  remarks: string | null;
  total_value: number;
  is_posted: boolean;
  items: PurchaseReturnItemRow[];
}

export interface PurchaseReturnCreateInput {
  vendor_id: number;
  return_date: string;
  bill_no?: string;
  remarks?: string;
  items: PurchaseReturnItemInput[];
}

export interface PurchaseReturnListFilters {
  vendor_id?: number;
  date_from?: string;
  date_to?: string;
  range?: 'weekly' | 'monthly' | 'overall';
}

// ── Module 4a: Bank Accounts ──

export interface BankAccountRow {
  bank_id: number;
  name: string;
  account_no: string | null;
  branch: string | null;
  ba_id: number | null;
  is_active: boolean;
}

export interface BankAccountCreateInput {
  name: string;
  account_no?: string;
  branch?: string;
  opening_balance?: number;
  opening_date?: string;
}

export interface BankAccountUpdateInput {
  name: string;
  account_no?: string;
  branch?: string;
}

// ── Module 4b: Transfer & Deposit ──

export interface TransferRow {
  transfer_id: number;
  transfer_date: string;
  from_ba_id: number;
  to_ba_id: number;
  amount: number;
  remarks: string | null;
  status: 'CONFIRMED' | 'DRAFT';
  from_name?: string;
  to_name?: string;
}

export interface TransferCreateInput {
  transfer_date: string;
  from_ba_id: number;
  to_ba_id: number;
  amount: number;
  remarks?: string;
}

export interface TransferListFilters {
  from_ba_id?: number;
  to_ba_id?: number;
  date_from?: string;
  date_to?: string;
}

export interface DepositRow {
  deposit_id: number;
  deposit_date: string;
  to_ba_id: number;
  direction: 'CREDIT' | 'DEBIT';
  amount: number;
  source: string;
  remarks: string | null;
  status: 'CONFIRMED' | 'DRAFT';
  to_name?: string;
}

export interface DepositCreateInput {
  deposit_date: string;
  to_ba_id: number;
  direction: 'CREDIT' | 'DEBIT';
  amount: number;
  source: string;
  remarks?: string;
}

export interface DepositListFilters {
  to_ba_id?: number;
  direction?: 'CREDIT' | 'DEBIT';
  date_from?: string;
  date_to?: string;
}

// ── Module 4c: Receipts & Cheques ──

export interface ReceiptRow {
  receipt_id: number;
  receipt_date: string;
  customer_id: number;
  amount: number;
  commission: number;
  payment_mode: 'CASH' | 'ONLINE' | 'CHEQUE';
  details: string | null;
  bank_id: number | null;
  remarks: string | null;
  status: 'CONFIRMED' | 'DRAFT';
  customer_name?: string;
  bank_name?: string;
  // Only populated by get() (findById's join) — never by list().
  cheque_no?: string;
  cheque_date?: string;
  cheque_received_date?: string | null;
  cheque_status?: ChequeStatus;
  cheque_bank_id?: number | null;
}

// dbo.draft_receipts has its own PK (draft_id, not receipt_id) and no status column (existence =
// draft) — a distinct shape from ReceiptRow, not just ReceiptRow with a different id.
export interface DraftReceiptRow {
  draft_id: number;
  receipt_date: string;
  customer_id: number;
  amount: number;
  commission: number;
  payment_mode: 'CASH' | 'ONLINE';
  details: string | null;
  bank_id: number | null;
  remarks: string | null;
  customer_name?: string;
  bank_name?: string;
}

export interface ReceiptCreateInput {
  customer_id: number;
  receipt_date: string;
  amount: number;
  commission?: number;
  payment_mode: 'CASH' | 'ONLINE' | 'CHEQUE';
  details?: string;
  bank_id?: number;
  cheque_no?: string;
  cheque_date?: string;
  cheque_received_date?: string;
  remarks?: string;
}

export interface ReceiptListFilters {
  customer_id?: number;
  payment_mode?: 'CASH' | 'ONLINE' | 'CHEQUE';
  status?: 'CONFIRMED' | 'DRAFT';
  date_from?: string;
  date_to?: string;
  range?: 'weekly' | 'monthly' | 'overall';
}

export type ChequeStatus = 'PENDING' | 'DEPOSITED' | 'ENDORSED' | 'PARTIALLY_ENDORSED' | 'CLEARED' | 'BOUNCED' | 'RETURNED';

export interface ChequeRow {
  cheque_id: number;
  bank_id: number | null;
  receipt_id: number;
  cheque_no: string;
  cheque_date: string;
  cheque_received_date: string | null;
  cheque_status: ChequeStatus;
  bounced_date: string | null;
  returned_date: string | null;
  return_reason: string | null;
  receipt_amount?: number;
  customer_id?: number;
  customer_name?: string;
  bank_name?: string;
}

export type ChequeDispositionType = 'DEPOSIT' | 'VENDOR_PAYMENT' | 'EXPENSE_PAYMENT';

export interface ChequeAllocationRow {
  allocation_id: number;
  receipt_id: number;
  disposition_type: ChequeDispositionType;
  target_vendor_id: number | null;
  target_ba_id: number | null;
  expense_id: number | null;
  amount: number;
  allocation_date: string;
  remarks: string | null;
  status: 'ACTIVE' | 'REVERSED';
  vendor_name?: string;
  target_name?: string;
  cheque_id?: number;
  cheque_no?: string;
  cheque_status?: ChequeStatus;
}

// ── Module 4d: Expenses & Business Accounts ──

export interface BusinessAccountRow {
  ba_id: number;
  code: string;
  name: string;
  ac_id: number;
  region_id: number | null;
  city_id: number | null;
  opening_balance: number | null;
  opening_date: string | null;
  status: 'ACTIVE' | 'CLOSED';
  ac_code?: string;
  ac_name?: string;
  is_restricted?: boolean;
  region_name?: string;
  city_name?: string;
}

export type ExpensePaymentMode = 'CASH' | 'ONLINE' | 'CHEQUE_ENDORSED' | 'CHEQUE_ISSUED';

export interface ExpenseRow {
  expense_id: number;
  expense_date: string;
  ba_id: number;
  amount: number;
  payment_mode: ExpensePaymentMode;
  details: string | null;
  cheque_id: number | null;
  bank_id: number | null;
  issued_cheque_no: string | null;
  issued_cheque_date: string | null;
  remarks: string | null;
  status: 'CONFIRMED' | 'DRAFT';
  ba_name?: string;
  bank_name?: string;
  // Only populated by get() (findById's join) — never by list().
  cheque_no?: string;
  cheque_status?: ChequeStatus;
}

export interface ExpenseCreateInput {
  expense_date: string;
  amount: number;
  payment_mode: ExpensePaymentMode;
  vendor_id?: number;
  ba_id?: number;
  details?: string;
  remarks?: string;
  bank_id?: number;
  cheque_id?: number;
  issued_cheque_no?: string;
  issued_cheque_date?: string;
}

export interface ExpenseListFilters {
  ba_id?: number;
  payment_mode?: ExpensePaymentMode;
  status?: 'CONFIRMED' | 'DRAFT';
  date_from?: string;
  date_to?: string;
  range?: 'weekly' | 'monthly' | 'overall';
}

// dbo.draft_expenses has its own PK (draft_id, not expense_id) and no status column — same trap
// already hit and fixed once for draft_receipts, do not reuse ExpenseRow here.
export interface DraftExpenseRow {
  draft_id: number;
  expense_date: string;
  ba_id: number;
  amount: number;
  payment_mode: ExpensePaymentMode;
  details: string | null;
  cheque_id: number | null;
  bank_id: number | null;
  issued_cheque_no: string | null;
  issued_cheque_date: string | null;
  remarks: string | null;
  ba_name?: string;
  bank_name?: string;
}

declare global {
  interface Window {
    api?: {
      auth: {
        login: (payload: { username: string; password: string }) => Promise<ApiResult<{ userId: number; username: string; role: 'ADMIN' | 'USER' }>>;
        logout: () => Promise<ApiResult<{ ok: true }>>;
        updateCredentials: (payload: { currentPassword: string; username?: string; newPassword?: string }) => Promise<ApiResult<{ username: string }>>;
        verifyPassword: (payload: { password: string }) => Promise<ApiResult<{ ok: true }>>;
      };
      saleBills: {
        create: (payload: SaleBillCreateInput) => Promise<ApiResult<SaleBillRow>>;
        list: (payload?: SaleBillListFilters) => Promise<ApiResult<SaleBillRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<SaleBillRow>>;
        update: (payload: { id: number; password?: string } & Partial<SaleBillCreateInput>) => Promise<ApiResult<SaleBillRow>>;
        post: (payload: { id: number; password: string }) => Promise<ApiResult<SaleBillRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<SaleBillRow>>;
        biltySearch: (payload?: SaleBillListFilters) => Promise<ApiResult<SaleBillRow[]>>;
        updateBilty: (payload: { id: number; bilty_no: string; adda_id: number }) => Promise<ApiResult<SaleBillRow>>;
      };
      saleReturns: {
        create: (payload: SaleReturnCreateInput) => Promise<ApiResult<SaleReturnRow>>;
        list: (payload?: SaleReturnListFilters) => Promise<ApiResult<SaleReturnRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<SaleReturnRow>>;
        update: (payload: { id: number; password?: string } & Partial<SaleReturnCreateInput>) => Promise<ApiResult<SaleReturnRow>>;
        post: (payload: { id: number; password: string }) => Promise<ApiResult<SaleReturnRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<SaleReturnRow>>;
      };
      draftSaleBills: {
        create: (payload: Partial<SaleBillCreateInput>) => Promise<ApiResult<SaleBillRow>>;
        list: (payload?: SaleBillListFilters) => Promise<ApiResult<SaleBillRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<SaleBillRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        confirm: (payload: { id: number }) => Promise<ApiResult<SaleBillRow>>;
      };
      draftSaleReturns: {
        create: (payload: Partial<SaleReturnCreateInput>) => Promise<ApiResult<SaleReturnRow>>;
        list: (payload?: SaleReturnListFilters) => Promise<ApiResult<SaleReturnRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<SaleReturnRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        confirm: (payload: { id: number }) => Promise<ApiResult<SaleReturnRow>>;
      };
      customers: {
        list: (payload?: { is_active?: boolean }) => Promise<ApiResult<CustomerRow[]>>;
        create: (payload: CustomerCreateInput) => Promise<ApiResult<CustomerRow>>;
      };
      subCustomers: {
        list: (payload?: { is_active?: boolean }) => Promise<ApiResult<SubCustomerRow[]>>;
        create: (payload: SubCustomerCreateInput) => Promise<ApiResult<SubCustomerRow>>;
      };
      products: {
        list: (payload?: { is_active?: boolean }) => Promise<ApiResult<ProductRow[]>>;
      };
      productColors: {
        listByArticle: (payload: { article_id: number }) => Promise<ApiResult<ProductVariantRow[]>>;
      };
      stores: {
        list: (payload?: { is_active?: boolean }) => Promise<ApiResult<StoreRow[]>>;
      };
      addas: {
        list: (payload?: { is_active?: boolean }) => Promise<ApiResult<AddaRow[]>>;
      };
      regions: {
        list: (payload?: { is_active?: boolean }) => Promise<ApiResult<RegionRow[]>>;
      };
      cities: {
        list: (payload?: { is_active?: boolean; region_id?: number }) => Promise<ApiResult<CityRow[]>>;
      };
      vendors: {
        list: (payload?: { includeInactive?: boolean; search?: string }) => Promise<ApiResult<VendorRow[]>>;
        create: (payload: VendorCreateInput) => Promise<ApiResult<VendorRow>>;
      };
      purchases: {
        create: (payload: PurchaseCreateInput) => Promise<ApiResult<PurchaseRow>>;
        list: (payload?: PurchaseListFilters) => Promise<ApiResult<PurchaseRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<PurchaseRow>>;
        update: (payload: { id: number } & Partial<PurchaseCreateInput>) => Promise<ApiResult<PurchaseRow>>;
        post: (payload: { id: number }) => Promise<ApiResult<PurchaseRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<PurchaseRow>>;
      };
      purchaseReturns: {
        create: (payload: PurchaseReturnCreateInput) => Promise<ApiResult<PurchaseReturnRow>>;
        list: (payload?: PurchaseReturnListFilters) => Promise<ApiResult<PurchaseReturnRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<PurchaseReturnRow>>;
        update: (payload: { id: number } & Partial<PurchaseReturnCreateInput>) => Promise<ApiResult<PurchaseReturnRow>>;
        post: (payload: { id: number }) => Promise<ApiResult<PurchaseReturnRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<PurchaseReturnRow>>;
      };
      draftPurchases: {
        create: (payload: Partial<PurchaseCreateInput>) => Promise<ApiResult<PurchaseRow>>;
        list: (payload?: PurchaseListFilters) => Promise<ApiResult<PurchaseRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<PurchaseRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        confirm: (payload: { id: number }) => Promise<ApiResult<PurchaseRow>>;
      };
      draftPurchaseReturns: {
        create: (payload: Partial<PurchaseReturnCreateInput>) => Promise<ApiResult<PurchaseReturnRow>>;
        list: (payload?: PurchaseReturnListFilters) => Promise<ApiResult<PurchaseReturnRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<PurchaseReturnRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        confirm: (payload: { id: number }) => Promise<ApiResult<PurchaseReturnRow>>;
      };
      bankAccounts: {
        list: (payload?: { includeInactive?: boolean }) => Promise<ApiResult<BankAccountRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<BankAccountRow>>;
        create: (payload: BankAccountCreateInput) => Promise<ApiResult<BankAccountRow>>;
        update: (payload: { id: number } & BankAccountUpdateInput) => Promise<ApiResult<BankAccountRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<BankAccountRow>>;
      };
      transfers: {
        list: (payload?: TransferListFilters) => Promise<ApiResult<TransferRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<TransferRow>>;
        create: (payload: TransferCreateInput) => Promise<ApiResult<TransferRow>>;
        update: (payload: { id: number } & TransferCreateInput) => Promise<ApiResult<TransferRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        post: (payload: { id: number }) => Promise<ApiResult<TransferRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<TransferRow>>;
      };
      deposits: {
        list: (payload?: DepositListFilters) => Promise<ApiResult<DepositRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<DepositRow>>;
        create: (payload: DepositCreateInput) => Promise<ApiResult<DepositRow>>;
        update: (payload: { id: number } & DepositCreateInput) => Promise<ApiResult<DepositRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        post: (payload: { id: number }) => Promise<ApiResult<DepositRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<DepositRow>>;
      };
      receipts: {
        list: (payload?: ReceiptListFilters) => Promise<ApiResult<ReceiptRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<ReceiptRow>>;
        create: (payload: ReceiptCreateInput) => Promise<ApiResult<ReceiptRow>>;
        update: (payload: { id: number } & ReceiptCreateInput) => Promise<ApiResult<ReceiptRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        post: (payload: { id: number }) => Promise<ApiResult<ReceiptRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<ReceiptRow>>;
      };
      draftReceipts: {
        list: (payload?: ReceiptListFilters) => Promise<ApiResult<DraftReceiptRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<DraftReceiptRow>>;
        create: (payload: Partial<ReceiptCreateInput>) => Promise<ApiResult<DraftReceiptRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        confirm: (payload: { id: number }) => Promise<ApiResult<ReceiptRow>>;
      };
      // Sub-actions with hyphens in their name (e.g. 'endorse-to-vendor') bypass camelToKebab() in
      // ipcBridge.ts's Proxy — the property key is used verbatim as the channel suffix, so these
      // must be accessed via bracket notation with the literal hyphenated string, not dot notation.
      cheques: {
        list: (payload?: { status?: ChequeStatus; bank_id?: number; date_from?: string; date_to?: string }) => Promise<ApiResult<ChequeRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<ChequeRow>>;
        deposit: (payload: { id: number; amount?: number; bank_id: number; allocation_date: string; remarks?: string }) => Promise<ApiResult<ChequeRow>>;
        'endorse-to-vendor': (payload: { id: number; amount?: number; vendor_id: number; allocation_date: string; remarks?: string }) => Promise<ApiResult<ChequeRow>>;
        'endorse-to-expense': (payload: { id: number; amount?: number; target_ba_id: number; expense_id?: number; allocation_date: string; remarks?: string }) => Promise<ApiResult<ChequeRow>>;
        'mark-cleared': (payload: { id: number }) => Promise<ApiResult<ChequeRow>>;
        bounce: (payload: { id: number; bounced_date: string; remarks?: string }) => Promise<ApiResult<ChequeRow>>;
        'return-to-sender': (payload: { id: number; returned_date: string; reason?: string; remarks?: string }) => Promise<ApiResult<ChequeRow>>;
        'endorsed-allocations': (payload?: { date_from?: string; date_to?: string }) => Promise<ApiResult<ChequeAllocationRow[]>>;
        'reverse-allocation': (payload: { id: number; date: string; remarks?: string }) => Promise<ApiResult<{ ok: true }>>;
        'allocations-for-receipt': (payload: { receipt_id: number }) => Promise<ApiResult<ChequeAllocationRow[]>>;
      };
      businessAccounts: {
        list: (payload?: { ac_id?: number; excludeRestrictedParent?: boolean; excludeClosed?: boolean }) => Promise<ApiResult<BusinessAccountRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<BusinessAccountRow>>;
        create: (payload: { name: string; ac_id: number; region_id?: number; city_id?: number; opening_balance?: number; opening_date?: string }) => Promise<ApiResult<BusinessAccountRow>>;
        update: (payload: { id: number; name: string; region_id?: number; city_id?: number }) => Promise<ApiResult<BusinessAccountRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<BusinessAccountRow>>;
        getCashAccount: () => Promise<ApiResult<BusinessAccountRow>>;
      };
      expenses: {
        list: (payload?: ExpenseListFilters) => Promise<ApiResult<ExpenseRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<ExpenseRow>>;
        create: (payload: ExpenseCreateInput) => Promise<ApiResult<ExpenseRow>>;
        update: (payload: { id: number } & ExpenseCreateInput) => Promise<ApiResult<ExpenseRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        post: (payload: { id: number }) => Promise<ApiResult<ExpenseRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<ExpenseRow>>;
      };
      draftExpenses: {
        list: (payload?: ExpenseListFilters) => Promise<ApiResult<DraftExpenseRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<DraftExpenseRow>>;
        create: (payload: Partial<ExpenseCreateInput>) => Promise<ApiResult<DraftExpenseRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        confirm: (payload: { id: number }) => Promise<ApiResult<ExpenseRow>>;
      };
      updates: {
        check: () => Promise<ApiResult<{ updateAvailable: boolean; currentVersion?: string; latestVersion?: string; packaged?: boolean }>>;
        install: () => Promise<ApiResult<{ ok: true }>>;
      };
    };
  }
}

const NO_BRIDGE: ApiFail = {
  ok: false,
  error: { message: 'Not running inside the desktop app.', code: 'NO_BRIDGE' }
};

// Backend's role is 'ADMIN'|'USER' (see database/schema.sql's users.role CHECK); the frontend's
// own UserRole stays 'Admin'|'User' everywhere else (nav gating, lib/access.ts, etc) — mapped once
// here at the one real boundary, so nothing else in the app needs to know the wire format.
function mapRole(role: 'ADMIN' | 'USER'): UserRole {
  return role === 'ADMIN' ? 'Admin' : 'User';
}

export async function login(username: string, password: string): Promise<ApiResult<{ username: string; role: UserRole }>> {
  if (!window.api) return NO_BRIDGE;
  const result = await window.api.auth.login({ username, password });
  if (!result.ok) return result;
  return { ok: true, data: { username: result.data.username, role: mapRole(result.data.role) } };
}

export async function logout(): Promise<ApiResult<{ ok: true }>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.auth.logout();
}

export async function updateCredentials(payload: { currentPassword: string; username?: string; newPassword?: string }): Promise<ApiResult<{ username: string }>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.auth.updateCredentials(payload);
}

export async function verifyPassword(password: string): Promise<ApiResult<{ ok: true }>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.auth.verifyPassword({ password });
}

// ── Module 2: Sale Bill & Sale Return ──

// Electron's contextBridge carries values across IPC via structured clone, not JSON — so a SQL
// Server DATE column (mssql driver deserializes it to a JS Date at UTC midnight) arrives in the
// renderer as an actual Date object, not the ISO string every type in this file declares. Every
// consumer (tabs, print layouts, <input type=date>) assumes a string, so it's normalized once here
// at the boundary rather than trusted to every call site. Read with UTC getters — a calendar date
// has no timezone, and local getters would shift it a day depending on the machine's offset.
function normalizeDate(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return v as string;
}

function normalizeBillRow<T extends { bill_date: string; due_date: string | null }>(row: T): T {
  return { ...row, bill_date: normalizeDate(row.bill_date), due_date: row.due_date != null ? normalizeDate(row.due_date) : row.due_date };
}

function normalizeReturnRow<T extends { return_date: string }>(row: T): T {
  return { ...row, return_date: normalizeDate(row.return_date) };
}

function mapResult<T, U>(result: ApiResult<T>, fn: (data: T) => U): ApiResult<U> {
  if (!result.ok) return result;
  return { ok: true, data: fn(result.data) };
}

export const saleBills = {
  create: (payload: SaleBillCreateInput) =>
    window.api ? window.api.saleBills.create(payload).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE),
  list: (payload?: SaleBillListFilters) =>
    window.api ? window.api.saleBills.list(payload).then(r => mapResult(r, rows => rows.map(normalizeBillRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.saleBills.get({ id }).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: Partial<SaleBillCreateInput> & { password?: string }) =>
    window.api ? window.api.saleBills.update({ id, ...payload }).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE),
  post: (id: number, password: string) =>
    window.api ? window.api.saleBills.post({ id, password }).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.saleBills.unpost({ id }).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE),
  biltySearch: (payload?: SaleBillListFilters) =>
    window.api ? window.api.saleBills.biltySearch(payload).then(r => mapResult(r, rows => rows.map(normalizeBillRow))) : Promise.resolve(NO_BRIDGE),
  updateBilty: (id: number, bilty_no: string, adda_id: number) =>
    window.api ? window.api.saleBills.updateBilty({ id, bilty_no, adda_id }).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE)
};

export const saleReturns = {
  create: (payload: SaleReturnCreateInput) =>
    window.api ? window.api.saleReturns.create(payload).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE),
  list: (payload?: SaleReturnListFilters) =>
    window.api ? window.api.saleReturns.list(payload).then(r => mapResult(r, rows => rows.map(normalizeReturnRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.saleReturns.get({ id }).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: Partial<SaleReturnCreateInput> & { password?: string }) =>
    window.api ? window.api.saleReturns.update({ id, ...payload }).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE),
  post: (id: number, password: string) =>
    window.api ? window.api.saleReturns.post({ id, password }).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.saleReturns.unpost({ id }).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE)
};

export const draftSaleBills = {
  create: (payload: Partial<SaleBillCreateInput>) =>
    window.api ? window.api.draftSaleBills.create(payload).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE),
  list: (payload?: SaleBillListFilters) =>
    window.api ? window.api.draftSaleBills.list(payload).then(r => mapResult(r, rows => rows.map(normalizeBillRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.draftSaleBills.get({ id }).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.draftSaleBills.remove({ id }) : Promise.resolve(NO_BRIDGE),
  confirm: (id: number) =>
    window.api ? window.api.draftSaleBills.confirm({ id }).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE)
};

export const draftSaleReturns = {
  create: (payload: Partial<SaleReturnCreateInput>) =>
    window.api ? window.api.draftSaleReturns.create(payload).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE),
  list: (payload?: SaleReturnListFilters) =>
    window.api ? window.api.draftSaleReturns.list(payload).then(r => mapResult(r, rows => rows.map(normalizeReturnRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.draftSaleReturns.get({ id }).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.draftSaleReturns.remove({ id }) : Promise.resolve(NO_BRIDGE),
  confirm: (id: number) =>
    window.api ? window.api.draftSaleReturns.confirm({ id }).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE)
};

// ── Read-only lookups Sale Bill/Return's own dropdowns need. Their Setup pages stay on demo
// data for now (a separate future module) — these are just enough to populate real dropdowns. ──

export async function listCustomers(): Promise<ApiResult<CustomerRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.customers.list({ is_active: true });
}

export async function listSubCustomers(): Promise<ApiResult<SubCustomerRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.subCustomers.list({ is_active: true });
}

export async function listProducts(): Promise<ApiResult<ProductRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.products.list({ is_active: true });
}

export async function listProductVariants(articleId: number): Promise<ApiResult<ProductVariantRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.productColors.listByArticle({ article_id: articleId });
}

export async function listStores(): Promise<ApiResult<StoreRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.stores.list({ is_active: true });
}

export async function listAddas(): Promise<ApiResult<AddaRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.addas.list({ is_active: true });
}

export async function listRegions(): Promise<ApiResult<RegionRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.regions.list({ is_active: true });
}

export async function listCities(): Promise<ApiResult<CityRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.cities.list({ is_active: true });
}

export async function createCustomer(payload: CustomerCreateInput): Promise<ApiResult<CustomerRow>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.customers.create(payload);
}

export async function createSubCustomer(payload: SubCustomerCreateInput): Promise<ApiResult<SubCustomerRow>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.subCustomers.create(payload);
}

// ── Module 3: Purchase & Purchase Return ──
// No password guard on this feature at all (update() hard-blocks once posted instead of a
// reverse-and-reapply-with-password flow) — see backend/PROGRESS.md's Milestone 3 entry.

function normalizePurchaseRow<T extends { purchase_date: string }>(row: T): T {
  return { ...row, purchase_date: normalizeDate(row.purchase_date) };
}

function normalizePurchaseReturnRow<T extends { return_date: string }>(row: T): T {
  return { ...row, return_date: normalizeDate(row.return_date) };
}

export const purchases = {
  create: (payload: PurchaseCreateInput) =>
    window.api ? window.api.purchases.create(payload).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE),
  list: (payload?: PurchaseListFilters) =>
    window.api ? window.api.purchases.list(payload).then(r => mapResult(r, rows => rows.map(normalizePurchaseRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.purchases.get({ id }).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: Partial<PurchaseCreateInput>) =>
    window.api ? window.api.purchases.update({ id, ...payload }).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.purchases.post({ id }).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.purchases.unpost({ id }).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE)
};

export const purchaseReturns = {
  create: (payload: PurchaseReturnCreateInput) =>
    window.api ? window.api.purchaseReturns.create(payload).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE),
  list: (payload?: PurchaseReturnListFilters) =>
    window.api ? window.api.purchaseReturns.list(payload).then(r => mapResult(r, rows => rows.map(normalizePurchaseReturnRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.purchaseReturns.get({ id }).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: Partial<PurchaseReturnCreateInput>) =>
    window.api ? window.api.purchaseReturns.update({ id, ...payload }).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.purchaseReturns.post({ id }).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.purchaseReturns.unpost({ id }).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE)
};

export const draftPurchases = {
  create: (payload: Partial<PurchaseCreateInput>) =>
    window.api ? window.api.draftPurchases.create(payload).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE),
  list: (payload?: PurchaseListFilters) =>
    window.api ? window.api.draftPurchases.list(payload).then(r => mapResult(r, rows => rows.map(normalizePurchaseRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.draftPurchases.get({ id }).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.draftPurchases.remove({ id }) : Promise.resolve(NO_BRIDGE),
  confirm: (id: number) =>
    window.api ? window.api.draftPurchases.confirm({ id }).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE)
};

export const draftPurchaseReturns = {
  create: (payload: Partial<PurchaseReturnCreateInput>) =>
    window.api ? window.api.draftPurchaseReturns.create(payload).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE),
  list: (payload?: PurchaseReturnListFilters) =>
    window.api ? window.api.draftPurchaseReturns.list(payload).then(r => mapResult(r, rows => rows.map(normalizePurchaseReturnRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.draftPurchaseReturns.get({ id }).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.draftPurchaseReturns.remove({ id }) : Promise.resolve(NO_BRIDGE),
  confirm: (id: number) =>
    window.api ? window.api.draftPurchaseReturns.confirm({ id }).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE)
};

export async function listVendors(): Promise<ApiResult<VendorRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.vendors.list({});
}

export async function createVendor(payload: VendorCreateInput): Promise<ApiResult<VendorRow>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.vendors.create(payload);
}

// ── Module 4a: Bank Accounts ──

export const bankAccounts = {
  list: (includeInactive?: boolean) =>
    window.api ? window.api.bankAccounts.list({ includeInactive }) : Promise.resolve(NO_BRIDGE),
  get: (id: number) => window.api ? window.api.bankAccounts.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: BankAccountCreateInput) => window.api ? window.api.bankAccounts.create(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: BankAccountUpdateInput) =>
    window.api ? window.api.bankAccounts.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.bankAccounts.remove({ id }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) => window.api ? window.api.bankAccounts.reactivate({ id }) : Promise.resolve(NO_BRIDGE)
};

// ── Module 4b: Transfer & Deposit ──

function normalizeTransferRow<T extends { transfer_date: string }>(row: T): T {
  return { ...row, transfer_date: normalizeDate(row.transfer_date) };
}

function normalizeDepositRow<T extends { deposit_date: string }>(row: T): T {
  return { ...row, deposit_date: normalizeDate(row.deposit_date) };
}

export const transfers = {
  list: (payload?: TransferListFilters) =>
    window.api ? window.api.transfers.list(payload).then(r => mapResult(r, rows => rows.map(normalizeTransferRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.transfers.get({ id }).then(r => mapResult(r, normalizeTransferRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: TransferCreateInput) =>
    window.api ? window.api.transfers.create(payload).then(r => mapResult(r, normalizeTransferRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: TransferCreateInput) =>
    window.api ? window.api.transfers.update({ id, ...payload }).then(r => mapResult(r, normalizeTransferRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.transfers.remove({ id }) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.transfers.post({ id }).then(r => mapResult(r, normalizeTransferRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.transfers.unpost({ id }).then(r => mapResult(r, normalizeTransferRow)) : Promise.resolve(NO_BRIDGE)
};

export const deposits = {
  list: (payload?: DepositListFilters) =>
    window.api ? window.api.deposits.list(payload).then(r => mapResult(r, rows => rows.map(normalizeDepositRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.deposits.get({ id }).then(r => mapResult(r, normalizeDepositRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: DepositCreateInput) =>
    window.api ? window.api.deposits.create(payload).then(r => mapResult(r, normalizeDepositRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: DepositCreateInput) =>
    window.api ? window.api.deposits.update({ id, ...payload }).then(r => mapResult(r, normalizeDepositRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.deposits.remove({ id }) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.deposits.post({ id }).then(r => mapResult(r, normalizeDepositRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.deposits.unpost({ id }).then(r => mapResult(r, normalizeDepositRow)) : Promise.resolve(NO_BRIDGE)
};

// ── Module 4c: Receipts & Cheques ──

function normalizeReceiptRow(row: ReceiptRow): ReceiptRow {
  return {
    ...row,
    receipt_date: normalizeDate(row.receipt_date),
    cheque_date: row.cheque_date != null ? normalizeDate(row.cheque_date) : row.cheque_date,
    cheque_received_date: row.cheque_received_date != null ? normalizeDate(row.cheque_received_date) : row.cheque_received_date,
  };
}

function normalizeChequeRow(row: ChequeRow): ChequeRow {
  return {
    ...row,
    cheque_date: normalizeDate(row.cheque_date),
    cheque_received_date: row.cheque_received_date != null ? normalizeDate(row.cheque_received_date) : row.cheque_received_date,
    bounced_date: row.bounced_date != null ? normalizeDate(row.bounced_date) : row.bounced_date,
    returned_date: row.returned_date != null ? normalizeDate(row.returned_date) : row.returned_date,
  };
}

function normalizeAllocationRow(row: ChequeAllocationRow): ChequeAllocationRow {
  return { ...row, allocation_date: normalizeDate(row.allocation_date) };
}

export const receipts = {
  list: (payload?: ReceiptListFilters) =>
    window.api ? window.api.receipts.list(payload).then(r => mapResult(r, rows => rows.map(normalizeReceiptRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.receipts.get({ id }).then(r => mapResult(r, normalizeReceiptRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: ReceiptCreateInput) =>
    window.api ? window.api.receipts.create(payload).then(r => mapResult(r, normalizeReceiptRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: ReceiptCreateInput) =>
    window.api ? window.api.receipts.update({ id, ...payload }).then(r => mapResult(r, normalizeReceiptRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.receipts.remove({ id }) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.receipts.post({ id }).then(r => mapResult(r, normalizeReceiptRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.receipts.unpost({ id }).then(r => mapResult(r, normalizeReceiptRow)) : Promise.resolve(NO_BRIDGE)
};

function normalizeDraftReceiptRow(row: DraftReceiptRow): DraftReceiptRow {
  return { ...row, receipt_date: normalizeDate(row.receipt_date) };
}

export const draftReceipts = {
  list: (payload?: ReceiptListFilters) =>
    window.api ? window.api.draftReceipts.list(payload).then(r => mapResult(r, rows => rows.map(normalizeDraftReceiptRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.draftReceipts.get({ id }).then(r => mapResult(r, normalizeDraftReceiptRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: Partial<ReceiptCreateInput>) =>
    window.api ? window.api.draftReceipts.create(payload).then(r => mapResult(r, normalizeDraftReceiptRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.draftReceipts.remove({ id }) : Promise.resolve(NO_BRIDGE),
  confirm: (id: number) =>
    window.api ? window.api.draftReceipts.confirm({ id }).then(r => mapResult(r, normalizeReceiptRow)) : Promise.resolve(NO_BRIDGE)
};

export const cheques = {
  list: (payload?: { status?: ChequeStatus; bank_id?: number; date_from?: string; date_to?: string }) =>
    window.api ? window.api.cheques.list(payload).then(r => mapResult(r, rows => rows.map(normalizeChequeRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.cheques.get({ id }).then(r => mapResult(r, normalizeChequeRow)) : Promise.resolve(NO_BRIDGE),
  deposit: (id: number, payload: { amount?: number; bank_id: number; allocation_date: string; remarks?: string }) =>
    window.api ? window.api.cheques.deposit({ id, ...payload }).then(r => mapResult(r, normalizeChequeRow)) : Promise.resolve(NO_BRIDGE),
  endorseToVendor: (id: number, payload: { amount?: number; vendor_id: number; allocation_date: string; remarks?: string }) =>
    window.api ? window.api.cheques['endorse-to-vendor']({ id, ...payload }).then(r => mapResult(r, normalizeChequeRow)) : Promise.resolve(NO_BRIDGE),
  endorseToExpense: (id: number, payload: { amount?: number; target_ba_id: number; expense_id?: number; allocation_date: string; remarks?: string }) =>
    window.api ? window.api.cheques['endorse-to-expense']({ id, ...payload }).then(r => mapResult(r, normalizeChequeRow)) : Promise.resolve(NO_BRIDGE),
  markCleared: (id: number) =>
    window.api ? window.api.cheques['mark-cleared']({ id }).then(r => mapResult(r, normalizeChequeRow)) : Promise.resolve(NO_BRIDGE),
  bounce: (id: number, payload: { bounced_date: string; remarks?: string }) =>
    window.api ? window.api.cheques.bounce({ id, ...payload }).then(r => mapResult(r, normalizeChequeRow)) : Promise.resolve(NO_BRIDGE),
  returnToSender: (id: number, payload: { returned_date: string; reason?: string; remarks?: string }) =>
    window.api ? window.api.cheques['return-to-sender']({ id, ...payload }).then(r => mapResult(r, normalizeChequeRow)) : Promise.resolve(NO_BRIDGE),
  endorsedAllocations: (payload?: { date_from?: string; date_to?: string }) =>
    window.api ? window.api.cheques['endorsed-allocations'](payload).then(r => mapResult(r, rows => rows.map(normalizeAllocationRow))) : Promise.resolve(NO_BRIDGE),
  reverseAllocation: (id: number, payload: { date: string; remarks?: string }) =>
    window.api ? window.api.cheques['reverse-allocation']({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  allocationsForReceipt: (receiptId: number) =>
    window.api ? window.api.cheques['allocations-for-receipt']({ receipt_id: receiptId }).then(r => mapResult(r, rows => rows.map(normalizeAllocationRow))) : Promise.resolve(NO_BRIDGE)
};

// ── Module 4d: Expenses & Business Accounts ──

export async function listBusinessAccounts(filters?: { ac_id?: number; excludeClosed?: boolean }): Promise<ApiResult<BusinessAccountRow[]>> {
  if (!window.api) return NO_BRIDGE;
  // excludeRestrictedParent is decided server-side from the session's role, not by the caller.
  return window.api.businessAccounts.list({ excludeClosed: true, ...filters });
}

export async function getCashBusinessAccount(): Promise<ApiResult<BusinessAccountRow>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.businessAccounts.getCashAccount();
}

function normalizeExpenseRow(row: ExpenseRow): ExpenseRow {
  return {
    ...row,
    expense_date: normalizeDate(row.expense_date),
    issued_cheque_date: row.issued_cheque_date != null ? normalizeDate(row.issued_cheque_date) : row.issued_cheque_date,
  };
}

function normalizeDraftExpenseRow(row: DraftExpenseRow): DraftExpenseRow {
  return {
    ...row,
    expense_date: normalizeDate(row.expense_date),
    issued_cheque_date: row.issued_cheque_date != null ? normalizeDate(row.issued_cheque_date) : row.issued_cheque_date,
  };
}

export const expenses = {
  list: (payload?: ExpenseListFilters) =>
    window.api ? window.api.expenses.list(payload).then(r => mapResult(r, rows => rows.map(normalizeExpenseRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.expenses.get({ id }).then(r => mapResult(r, normalizeExpenseRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: ExpenseCreateInput) =>
    window.api ? window.api.expenses.create(payload).then(r => mapResult(r, normalizeExpenseRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: ExpenseCreateInput) =>
    window.api ? window.api.expenses.update({ id, ...payload }).then(r => mapResult(r, normalizeExpenseRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.expenses.remove({ id }) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.expenses.post({ id }).then(r => mapResult(r, normalizeExpenseRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.expenses.unpost({ id }).then(r => mapResult(r, normalizeExpenseRow)) : Promise.resolve(NO_BRIDGE)
};

export const draftExpenses = {
  list: (payload?: ExpenseListFilters) =>
    window.api ? window.api.draftExpenses.list(payload).then(r => mapResult(r, rows => rows.map(normalizeDraftExpenseRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.draftExpenses.get({ id }).then(r => mapResult(r, normalizeDraftExpenseRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: Partial<ExpenseCreateInput>) =>
    window.api ? window.api.draftExpenses.create(payload).then(r => mapResult(r, normalizeDraftExpenseRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.draftExpenses.remove({ id }) : Promise.resolve(NO_BRIDGE),
  confirm: (id: number) =>
    window.api ? window.api.draftExpenses.confirm({ id }).then(r => mapResult(r, normalizeExpenseRow)) : Promise.resolve(NO_BRIDGE)
};
