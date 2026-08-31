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
  gp_no: string | null;
  bilty_no: string | null;
  adda_id: number | null;
  remarks: string | null;
  invoice_discount: number;
  total_cartons: number;
  total_pairs: number;
  gross_value: number;
  net_value: number;
  due_date: string | null;
  is_posted: boolean;
  items: SaleBillItemRow[];
  // Only populated by biltySearch() (its own join) — never by list()/get().
  customer_name?: string;
  sub_customer_name?: string;
  adda_name?: string;
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
  gp_no?: string;
  bilty_no?: string;
  adda_id?: number;
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

/** Every saved-unposted Sale Bill now lives here, not just genuinely incomplete entries — the
 *  real `sale_bills` table strictly never holds an unposted document. Its own key is `draft_id`,
 *  NOT `bill_id` — a distinct row space from SaleBillRow, unrelated ids once confirmed. No
 *  `due_date`/`is_posted` columns exist on the draft table (due_date only applies once a real
 *  bill exists; a draft is never posted by definition). */
export interface DraftSaleBillItemRow {
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

export interface DraftSaleBillRow {
  draft_id: number;
  bill_date: string;
  store_id: number | null;
  customer_id: number;
  sub_customer_id: number | null;
  main_ac_id: number | null;
  delivery_type: 'SAME' | 'CUSTOM';
  delivery_address: string | null;
  bill_no: string | null;
  gp_no: string | null;
  bilty_no: string | null;
  adda_id: number | null;
  remarks: string | null;
  invoice_discount: number;
  total_cartons: number;
  total_pairs: number;
  gross_value: number;
  net_value: number;
  created_by: number | null;
  // Only populated by get()/create()/update() (findById's join) — never by list(). confirm()
  // returns a real SaleBillRow instead (the draft no longer exists once confirmed).
  items?: DraftSaleBillItemRow[];
}

/** confirmAll()'s per-draft result — same shape as PostAllResult but keyed on draft_id, since
 *  that's the id being acted on (the bill_id it becomes only exists once confirm() succeeds). */
export interface ConfirmAllResult {
  posted: { draft_id: number; bill_no: string | null; net_value: number }[];
  failed: { draft_id: number; bill_no: string | null; message: string; code: string }[];
  attempted: number;
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

export interface DraftSaleReturnItemRow {
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

/** Every saved-unposted Sale Return now lives here — same architecture change as
 *  DraftSaleBillRow. Own key is `draft_id`, not `return_id`. No `is_posted` column (a draft is
 *  never posted by definition). */
export interface DraftSaleReturnRow {
  draft_id: number;
  return_date: string;
  store_id: number | null;
  customer_id: number;
  sub_customer_id: number | null;
  bill_no: string | null;
  gp_no: string | null;
  bilty_no: string | null;
  adda_id: number | null;
  remarks: string | null;
  invoice_discount: number;
  total_cartons: number;
  total_pairs: number;
  gross_value: number;
  net_value: number;
  created_by: number | null;
  // Only populated by get()/create()/update() — never by list(). confirm() returns a real
  // SaleReturnRow instead (the draft no longer exists once confirmed).
  items?: DraftSaleReturnItemRow[];
}

export interface CustomerRow {
  customer_id: number;
  name: string;
  ba_id: number | null;
  region_id: number;
  city_id: number | null;
  address: string | null;
  is_active: boolean;
  region_name?: string;
  city_name?: string;
  /** C-01: the linked business account's code — what the screen shows as the customer's code,
   *  in place of the raw customer_id (an IDENTITY value, which legitimately skips). Null only if
   *  the customer somehow has no linked account. */
  account_code?: string | null;
}

export interface SubCustomerRow {
  sub_customer_id: number;
  name: string;
  region_id: number;
  city_id: number | null;
  address: string | null;
  is_active: boolean;
  region_name?: string;
  city_name?: string;
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
  // The 12 manufacturing-stage cost columns (Wage Run's rate snapshot source) — `a.*` in
  // products.repository.js already returns these, just not previously typed here.
  cutting: number;
  edging: number;
  up_stitch: number;
  bending: number;
  stubble_dori: number;
  shape_form: number;
  chipkai: number;
  bottom: number;
  machine: number;
  trimming: number;
  sock_stitch: number;
  finish: number;
  // Only populated by list()/get()'s join — never sent on create/update.
  category_name?: string;
  vendor_name?: string;
  // Only populated by get() (findById()'s extra query) — never by list().
  colors?: ProductVariantRow[];
}

export interface ProductCreateInput {
  name: string;
  category_id: number;
  vendor_id: number;
  packing: number;
  sale_price?: number;
  cutting?: number;
  edging?: number;
  up_stitch?: number;
  bending?: number;
  stubble_dori?: number;
  shape_form?: number;
  chipkai?: number;
  bottom?: number;
  machine?: number;
  trimming?: number;
  sock_stitch?: number;
  finish?: number;
}

// vendor_id is immutable after creation (products.service.js#update() excludes it from the SET
// clause) — code/batch_no are always system-generated, never client-supplied on create or update.
export type ProductUpdateInput = Omit<ProductCreateInput, 'vendor_id'>;

// Multi-article entry (Product Details): one category chosen once, several articles registered
// under it in a single save — see products:createBatch / products.service.js#createBatch.
export type ProductBatchArticleInput = Omit<ProductCreateInput, 'category_id'>;
export interface ProductBatchCreateInput {
  category_id: number;
  articles: ProductBatchArticleInput[];
}
export interface ProductBatchFieldError {
  index: number;
  message: string;
}

export interface ProductVariantRow {
  variant_id: number;
  article_id: number;
  color: string;
  packing: number | null;
  is_active: boolean;
}

export interface StoreRow {
  store_id: number;
  name: string;
  is_active: boolean;
}

export interface StoreCreateInput {
  name: string;
}

export interface AddaRow {
  adda_id: number;
  name: string;
  // Legacy — kept for addas created before AD-01, no longer written by create/update.
  region_id: number | null;
  city_id: number | null;
  details: string | null;
  is_active: boolean;
  region_name?: string;
  city_name?: string;
  // AD-01: the adda's Route — every city it serves.
  route_city_ids: number[];
  route_city_names: string;
}

export interface AddaCreateInput {
  name: string;
  city_ids: number[];
  details?: string;
}

export interface RegionRow {
  region_id: number;
  name: string;
  is_active: boolean;
}

export interface RegionCreateInput {
  name: string;
}

export interface CategoryRow {
  category_id: number;
  name: string;
  is_active: boolean;
}

export interface CategoryCreateInput {
  name: string;
}

export interface CityRow {
  city_id: number;
  name: string;
  region_id: number | null;
  region_name?: string;
  is_active: boolean;
}

export interface CityCreateInput {
  name: string;
  region_id?: number;
}

export interface CustomerCreateInput {
  name: string;
  region_id: number;
  city_id?: number;
  address?: string;
  /** Lives on the linked business account, not on this row. Both or neither (CK_business_accounts_opening). */
  opening_balance?: number;
  opening_date?: string;
}

export interface SubCustomerCreateInput {
  name: string;
  region_id: number;
  city_id?: number;
  address?: string;
}

export type CustomerUpdateInput = CustomerCreateInput;
export type SubCustomerUpdateInput = SubCustomerCreateInput;

// checkName()'s matches are full rows (findAllByName() joins the same way list() does), not a
// slimmed-down shape.
export interface CustomerCheckNameResult {
  status: 'none' | 'active' | 'inactive';
  matches: CustomerRow[];
}

export interface SubCustomerCheckNameResult {
  status: 'none' | 'active' | 'inactive';
  matches: SubCustomerRow[];
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
  /** Manufacturing Product (migration 017) — the single vendor every article belongs to. Hidden
   *  from vendor-facing screens and not editable or deletable. */
  is_system?: boolean;
  region_name?: string;
  city_name?: string;
  /** C-01: the linked business account's code — what the screen shows as the vendor's code, in
   *  place of the raw vendor_id (an IDENTITY value, which legitimately skips). Null only if the
   *  vendor somehow has no linked account. */
  account_code?: string | null;
}

export interface VendorListFilters {
  search?: string;
  includeInactive?: boolean;
  /** The system vendor (Manufacturing Product) is hidden unless a caller asks for it — it is a
   *  bookkeeping device, not a supplier. Only the read-only Product Ledger filter needs it. */
  includeSystem?: boolean;
}

export interface VendorCreateInput {
  name: string;
  phone?: string;
  region_id?: number;
  city_id?: number;
  /** Lives on the linked business account, not on this row. Both or neither (CK_business_accounts_opening). */
  opening_balance?: number;
  opening_date?: string;
}

export type VendorUpdateInput = VendorCreateInput;

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

export interface DraftPurchaseItemRow {
  material_id: number;
  material_name?: string;
  unit: string;
  quantity: number;
  weight: number | null;
  price_per_unit: number;
  total_price: number;
  line_no: number;
}

/** Every saved-unposted Purchase now lives here — same architecture change as DraftSaleBillRow.
 *  Own key is `draft_id`, not `purchase_id`. No `is_posted` column (never posted by definition).
 *  Unlike Sale Bill/Return, a draft purchase has zero stock effect either way (see
 *  draftPurchases.service.js), so there's nothing stock-related to normalize here. */
export interface DraftPurchaseRow {
  draft_id: number;
  purchase_date: string;
  vendor_id: number;
  bill_no: string | null;
  remarks: string | null;
  total_value: number;
  created_by: number | null;
  // Only populated by get()/create()/update() — never by list(). confirm() returns a real
  // PurchaseRow instead.
  items?: DraftPurchaseItemRow[];
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

export interface DraftPurchaseReturnItemRow {
  material_id: number;
  material_name?: string;
  unit: string;
  quantity: number;
  weight: number | null;
  price_per_unit: number;
  total_price: number;
  line_no: number;
}

/** Every saved-unposted Purchase Return now lives here — same architecture change as
 *  DraftPurchaseRow. Own key is `draft_id`, not `return_id`. No `is_posted` column (never posted
 *  by definition). Like draft purchases, a draft purchase return has zero stock effect either way
 *  (see draftPurchaseReturns.service.js), so there's nothing stock-related to normalize here. */
export interface DraftPurchaseReturnRow {
  draft_id: number;
  return_date: string;
  vendor_id: number;
  bill_no: string | null;
  remarks: string | null;
  total_value: number;
  created_by: number | null;
  // Only populated by get()/create()/update() — never by list(). confirm() returns a real
  // PurchaseReturnRow instead.
  items?: DraftPurchaseReturnItemRow[];
}

/** SB-06: a sale bill awaiting posting, for the Post All confirmation list. */
export interface UnpostedBillRow {
  bill_id: number;
  bill_no: string;
  bill_date: string;
  net_value: number;
  customer_id: number | null;
  customer_name: string | null;
}

/** P-03: a purchase awaiting posting, for the Post All confirmation list. */
export interface UnpostedPurchaseRow {
  purchase_id: number;
  bill_no: string | null;
  purchase_date: string;
  total_value: number;
  vendor_name: string | null;
}

/** SB-06/P-03: the outcome of posting a run of documents. Each document posts in its own
 *  transaction, so a partial failure is a SUCCESSFUL result carrying a failure list — `ok: true`
 *  does NOT mean everything posted. Always read `failed`.
 *  `K` names the id field, which differs per document type ('bill_id' / 'purchase_id'). */
export type PostAllResult<K extends string> = {
  posted: ({ bill_no: string | null } & Record<K, number>)[];
  failed: ({ bill_no: string | null; message: string; code: string } & Record<K, number>)[];
  attempted: number;
};

/** PR-01: the price/unit this vendor was last paid for a material on a posted purchase. The unit
 *  travels with the price because a purchase line's unit is self-assigned — "200 kg @ 230" and
 *  "200 meters @ 230" are different purchases, so the price alone is ambiguous. */
export interface LastPurchasedRate {
  price_per_unit: number;
  unit: string;
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

// Direct Settlement (migration 015) — our debtor pays one of our creditors directly. Same
// from/to shape as a Transfer, but the opposite meaning: a transfer moves money between OUR OWN
// accounts and shows on the Cash Book, a settlement moves an obligation between two third parties
// and deliberately touches no cash, bank or cheque account at all.
export interface SettlementRow {
  settlement_id: number;
  settlement_date: string;
  /** Our debtor — they owed us and discharged it by paying our creditor. Credited. */
  from_ba_id: number;
  /** Our creditor — we owed them and they were paid by our debtor. Debited. */
  to_ba_id: number;
  amount: number;
  /** How the two other parties transacted. Information only — it selects no posting target here. */
  payment_mode: 'CASH' | 'CHEQUE' | 'ONLINE' | null;
  cheque_no: string | null;
  cheque_date: string | null;
  remarks: string | null;
  status: 'CONFIRMED' | 'DRAFT';
  from_name?: string;
  to_name?: string;
}

export interface SettlementCreateInput {
  settlement_date: string;
  from_ba_id: number;
  to_ba_id: number;
  amount: number;
  payment_mode?: 'CASH' | 'CHEQUE' | 'ONLINE';
  cheque_no?: string;
  cheque_date?: string;
  remarks?: string;
}

export interface SettlementListFilters {
  ba_id?: number;
  from_ba_id?: number;
  to_ba_id?: number;
  status?: 'CONFIRMED' | 'DRAFT';
  date_from?: string;
  date_to?: string;
}

// Journal Voucher — a real multi-line double-entry journal (legacy "Journal Entry" screen): N
// lines, each against its own account, each a debit OR a credit, that must net to zero. No fixed
// counter-account — every line names a real business account, visible in that account's own ledger.
export interface JournalVoucherLineInput {
  ba_id: number;
  debit: number;
  credit: number;
  /** Per-line note (e.g. "Eid compensation" on one leg, "damaged stock" on another) — distinct
   *  from the header's single Reason, matching the legacy grid's per-row Narration. */
  narration?: string;
}

export interface JournalVoucherLineRow extends JournalVoucherLineInput {
  line_id: number;
  line_no: number;
  ba_name?: string;
  ba_code?: string;
}

export interface JournalVoucherRow {
  jv_id: number;
  jv_date: string;
  /** Manual voucher number (office cross-referencing), matching the legacy Journal Entry
   *  screen's "Number" field — optional, never validated, distinct from jv_id. */
  voucher_no: string | null;
  reason: string;
  remarks: string | null;
  status: 'CONFIRMED' | 'DRAFT';
  /** Only present on get()/create()/update()/post()/unpost() — list() returns the rolled-up
   *  totals below without the per-line detail, to keep the listing query a single aggregate. */
  lines?: JournalVoucherLineRow[];
  line_count: number;
  total_debit: number;
  total_credit: number;
}

export interface JournalVoucherCreateInput {
  jv_date: string;
  voucher_no?: string;
  reason: string;
  remarks?: string;
  lines: JournalVoucherLineInput[];
}

export interface JournalVoucherListFilters {
  ba_id?: number;
  status?: 'CONFIRMED' | 'DRAFT';
  date_from?: string;
  date_to?: string;
  /** Matches the header (reason/number) or any line (account name/code, per-line narration,
   *  debit/credit amount) — a search box doesn't need to know which field it landed in. */
  search?: string;
}

/** A JV still awaiting posting, for the Post All confirmation list. */
export interface UnpostedJournalVoucherRow {
  jv_id: number;
  jv_date: string;
  voucher_no: string | null;
  reason: string;
  total_debit: number;
}

// Stock Voucher — a manual "add stock" document (legacy Journal Entry-style bound-record screen):
// N lines, each a finished-goods variant + cartons/pairs, under one Date/Store/Remarks header.
// Replaces the old inline "+ Add Stock" flow on the Current Stock report, which recorded every
// manual addition AS production — this is its own document type instead, same architecture as
// Journal Voucher (DRAFT by default, status flips to CONFIRMED only on post()).
export interface StockVoucherLineInput {
  variant_id: number;
  cartons: number;
  pairs: number;
}

export interface StockVoucherLineRow extends StockVoucherLineInput {
  line_id: number;
  line_no: number;
  article_id?: number;
  article_code?: string;
  article_name?: string;
  color?: string;
}

export interface StockVoucherRow {
  stock_voucher_id: number;
  voucher_date: string;
  store_id: number | null;
  store_name?: string;
  remarks: string | null;
  status: 'CONFIRMED' | 'DRAFT';
  /** On Account — pure reference field, no default, no ledger effect. Main A/C is never a
   *  separate value: it always mirrors this same account's own name/code (per the user,
   *  2026-08-30), so there is no separate main_ac_name/main_ac_code to read. */
  on_account_ba_id: number | null;
  on_account_name?: string;
  on_account_code?: string;
  /** Only present on get()/create()/update()/post()/unpost() — list() returns the rolled-up
   *  totals below without the per-line detail, to keep the listing query a single aggregate. */
  lines?: StockVoucherLineRow[];
  line_count: number;
  total_cartons: number;
  total_pairs: number;
}

export interface StockVoucherCreateInput {
  voucher_date: string;
  store_id?: number | null;
  remarks?: string;
  on_account_ba_id?: number | null;
  lines: StockVoucherLineInput[];
}

export interface StockVoucherListFilters {
  store_id?: number;
  status?: 'CONFIRMED' | 'DRAFT';
  date_from?: string;
  date_to?: string;
  /** Matches the header (remarks) or any line (article code/name, color) — a search box doesn't
   *  need to know which field it landed in. */
  search?: string;
}

/** A stock voucher still awaiting posting, for the Post All confirmation list. */
export interface UnpostedStockVoucherRow {
  stock_voucher_id: number;
  voucher_date: string;
  remarks: string | null;
  total_pairs: number;
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
  // Any business account — customer, vendor, employee, director, bank (migration 014). customer_id
  // / customer_name are resolved through customers.ba_id and are null when the account isn't a
  // customer's; use them to decide whether customer-only behaviour (commission) applies.
  ba_id: number;
  account_name?: string;
  customer_id: number | null;
  amount: number;
  commission: number;
  payment_mode: 'CASH' | 'ONLINE' | 'CHEQUE';
  details: string | null;
  bank_id: number | null;
  /** Migration 028: an ONLINE entry may name ANY business account instead of a bank. Exactly
   *  one of bank_id / online_ba_id is ever set; rows recorded before 028 use bank_id. */
  online_ba_id: number | null;
  online_ba_name?: string;
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
  /** RJ-03: the voucher this entry belongs to. Every receipt written by the app has one — migration
   *  022 backfilled every pre-existing receipt into a one-line voucher of its own. */
  voucher_id?: number | null;
  /** RJ-03: only populated when read as a voucher line (listLines' join). */
  account_code?: string;
}

/** RJ-03/PN-01: a voucher's derived state. Never stored — posting is per line, so a voucher can
 *  legitimately sit half-posted and a stored column would be a second source of truth. */
export type VoucherStatus = 'UNPOSTED' | 'PARTIAL' | 'POSTED';

/** RJ-03: a receipt voucher — the header plus, when fetched by id, its entry lines and totals. */
export interface ReceiptVoucherRow {
  voucher_id: number;
  voucher_no: number;
  voucher_date: string;
  remarks: string | null;
  status: VoucherStatus;
  total_amount: number;
  total_cash: number;
  total_cheque: number;
  total_online: number;
  /** Present on get(), absent on list(). list() carries line_count/confirmed_lines instead. */
  lines?: ReceiptVoucherLineRow[];
  line_count?: number;
  confirmed_lines?: number;
}

/** RJ-03: one line of a receipt voucher. A voucher's lines live in two tables now — posted ones in
 *  dbo.receipts, unposted ones in dbo.draft_receipts — and listLines unions them, so exactly one of
 *  `receipt_id` / `draft_id` is set per line and names which table (and which id) the per-line
 *  actions must address. `status` is derived from which side it came from, not stored. */
export interface ReceiptVoucherLineRow extends Omit<ReceiptRow, 'receipt_id'> {
  receipt_id: number | null;
  draft_id: number | null;
}

/** PN-01: one line of an expense voucher — same two-table union as ReceiptVoucherLineRow. */
export interface ExpenseVoucherLineRow extends Omit<ExpenseRow, 'expense_id'> {
  expense_id: number | null;
  draft_id: number | null;
}

/** RJ-03/PN-01: the outcome of posting or unposting a whole voucher. Each line acts in its own
 *  transaction, so this is a SUCCESSFUL result that may carry failures — `ok: true` does NOT mean
 *  the whole voucher posted. Always read `failed`. `K` names the line's id field. */
export interface VoucherActionResult<K extends string, V> {
  voucher: V;
  posted?: ({ amount: number } & Record<K, number>)[];
  unposted?: ({ amount: number } & Record<K, number>)[];
  failed: ({ amount: number; account_name?: string; message: string; code: string } & Record<K, number>)[];
  attempted?: number;
}

// dbo.draft_receipts has its own PK (draft_id, not receipt_id) and no status column (existence =
// draft) — a distinct shape from ReceiptRow, not just ReceiptRow with a different id.
export interface DraftReceiptRow {
  draft_id: number;
  receipt_date: string;
  ba_id: number;
  account_name?: string;
  customer_id: number | null;
  amount: number;
  commission: number;
  // All three modes now — migration 024 gave draft_receipts its own cheque columns, so a CHEQUE
  // receipt is draftable like any other. The real dbo.cheques row is created at confirm() time.
  payment_mode: 'CASH' | 'ONLINE' | 'CHEQUE';
  details: string | null;
  bank_id: number | null;
  /** Migration 028: an ONLINE entry may name ANY business account instead of a bank. Exactly
   *  one of bank_id / online_ba_id is ever set; rows recorded before 028 use bank_id. */
  online_ba_id: number | null;
  online_ba_name?: string;
  remarks: string | null;
  customer_name?: string;
  bank_name?: string;
  account_code?: string;
  // Held directly on the draft (no cheques row exists until it is posted), hence no cheque_status.
  cheque_no?: string | null;
  cheque_date?: string | null;
  cheque_received_date?: string | null;
  /** RJ-03: the voucher this draft line belongs to (migration 024). */
  voucher_id?: number | null;
}

export interface ReceiptCreateInput {
  ba_id: number;
  receipt_date: string;
  amount: number;
  commission?: number;
  payment_mode: 'CASH' | 'ONLINE' | 'CHEQUE';
  details?: string;
  bank_id?: number;
  /** Alternative to bank_id for ONLINE (migration 028) — any business account, not just a
   *  bank. Pass one or the other, never both. */
  online_ba_id?: number;
  cheque_no?: string;
  cheque_date?: string;
  cheque_received_date?: string;
  remarks?: string;
}

export interface ReceiptListFilters {
  ba_id?: number;
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
  /**
   * Status of the receipt that brought this cheque in. Every disposal action requires it to be
   * CONFIRMED (cheques.service.js#assertDisposable), so the screen uses this to avoid offering an
   * action that can only fail. Present on list()/get(), absent on rows built from other calls.
   */
  receipt_status?: 'DRAFT' | 'CONFIRMED';
  // The receipt's business account (migration 014). customer_id/customer_name are resolved
  // through customers.ba_id and are absent when the cheque came from a non-customer account.
  ba_id?: number;
  account_name?: string;
  customer_id?: number | null;
  customer_name?: string | null;
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
  /** The date written on the cheque — its due date (see IX_cheques_due). */
  cheque_date?: string;
  cheque_received_date?: string | null;
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
  /** Cash in Hand / Journal Voucher — the posting engine resolves these by their parent's code, so
   *  they cannot be closed. Derived server-side; there is no column for it. */
  is_reserved?: boolean;
  region_name?: string;
  city_name?: string;
}

export interface BusinessAccountCreateInput {
  name: string;
  ac_id: number;
  region_id?: number;
  city_id?: number;
  opening_balance?: number;
  opening_date?: string;
}

// UC-17 multi-account entry — one parent chart account, several accounts, one save. Mirrors
// ProductBatchCreateInput; a failed batch comes back as BATCH_VALIDATION_FAILED with
// details.errors = [{ index, message }] so the form can mark the offending row.
export interface BusinessAccountBatchCreateInput {
  ac_id: number;
  accounts: Array<{
    name: string;
    region_id?: number;
    city_id?: number;
    opening_balance?: number;
    opening_date?: string;
  }>;
}

export interface BusinessAccountUpdateInput {
  name: string;
  region_id?: number;
  city_id?: number;
  /** Editable after creation. A stored input, not a ledger row — changing it rewrites past
   *  balances for this account, which is the point when correcting a migration. */
  opening_balance?: number;
  opening_date?: string;
}

// ── Milestone 8.2/8.3: Account Classes, Group Accounts, Chart of Accounts ──

export interface AccountClassRow {
  class_id: number;
  code: string;
  name: string;
  is_active: boolean;
}

export interface GroupAccountRow {
  group_id: number;
  code: string;
  name: string;
  class_id: number;
  sorting: number | null;
  is_active: boolean;
  class_code?: string;
  class_name?: string;
}

export interface GroupAccountCreateInput {
  name: string;
  class_id: number;
  sorting?: number;
}

export interface GroupAccountUpdateInput {
  name: string;
  sorting?: number;
}

export interface ChartOfAccountRow {
  ac_id: number;
  code: string;
  name: string;
  group_id: number;
  link_code: string | null;
  status: 'ACTIVE' | 'CLOSED';
  is_restricted: boolean;
  group_code?: string;
  group_name?: string;
  class_id?: number;
  class_code?: string;
  class_name?: string;
}

export interface ChartAccountCreateInput {
  name: string;
  group_id: number;
  link_code?: string;
}

export interface ChartAccountUpdateInput {
  name: string;
  link_code?: string;
}

// Mirrors backend/src/constants/reservedAccounts.js — single source of truth is the backend file;
// this list must be kept in sync manually since the Electron renderer can't require() it directly.
export const RESERVED_ACCOUNT_CODES: readonly string[] = [
  '100001', // CUSTOMERS_ACCOUNTS
  '200001', // VENDORS_ACCOUNTS
  '100002', // CASH_IN_HAND
  '100003', // BANK_ACCOUNTS
  '300001', // SALES
  '400001', // PURCHASES
  '400002', // COMMISSION_ALLOWED
  '100004', // CHEQUES_IN_HAND
  '400003', // BUSINESS_RUNNING_EXPENSES
  '400004', // DIRECTORS_DRAWINGS
  '400005', // EMPLOYEES
  '200002', // VENDORS_SUPPLIERS
  '220001', // WORKER_WAGES
  '220002', // SALARIES_PAYABLE
  '410001', // WAGES_EXPENSE
  '410002', // SALARIES_EXPENSE
  '400006', // MISC_ADJUSTMENTS
  '400007', // JOURNAL_VOUCHER
  '200003', // OPENING_BALANCE_EQUITY
  '400008', // DISCOUNTS_CLAIMS_COMMISSIONS
  '400009', // STOCK_TRANSFER
];

// Stock Voucher's fixed On Account/Main A/C (per the user, 2026-08-31): always the seeded STOCK
// TRANSFER business account, never user-picked. Mirrors backend/src/constants/reservedAccounts.js.
export const STOCK_TRANSFER_ACCOUNT_CODE = '400009';

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
  /** Migration 028: an ONLINE entry may name ANY business account instead of a bank. Exactly
   *  one of bank_id / online_ba_id is ever set; rows recorded before 028 use bank_id. */
  online_ba_id: number | null;
  online_ba_name?: string;
  issued_cheque_no: string | null;
  issued_cheque_date: string | null;
  remarks: string | null;
  status: 'CONFIRMED' | 'DRAFT';
  ba_name?: string;
  bank_name?: string;
  // Only populated by get() (findById's join) — never by list().
  cheque_no?: string;
  cheque_status?: ChequeStatus;
  /** PN-01: the voucher this entry belongs to. Every expense written by the app has one — migration
   *  022 backfilled every pre-existing expense into a one-line voucher of its own. */
  voucher_id?: number | null;
  /** PN-01: only populated when read as a voucher line (listLines' join). */
  account_name?: string;
  account_code?: string;
  /** PN-01: voucher-line join — the endorsed cheque (one we received and handed on), named
   *  distinctly from issued_cheque_no (one we wrote) because a line can only ever be one of them. */
  endorsed_cheque_no?: string;
}

/** PN-01: a payment (Naam) voucher — the header plus, when fetched by id, its lines and totals.
 *  total_cheque covers BOTH cheque modes: one we issued and one we endorsed onward. */
export interface ExpenseVoucherRow {
  voucher_id: number;
  voucher_no: number;
  voucher_date: string;
  remarks: string | null;
  status: VoucherStatus;
  total_amount: number;
  total_cash: number;
  total_cheque: number;
  total_online: number;
  /** Present on get(), absent on list(). list() carries line_count/confirmed_lines instead. */
  lines?: ExpenseVoucherLineRow[];
  line_count?: number;
  confirmed_lines?: number;
}

// "Cheque Return" page's issued-cheque list — a cheque WE wrote from our own bank (payment_mode
// CHEQUE_ISSUED), as opposed to ChequeAllocationRow which is a cheque we RECEIVED and endorsed
// onward. Own type (not ExpenseRow) since it carries the issued-cheque-specific status fields
// that a normal expense list/get() response doesn't type.
export type IssuedChequeStatus = 'PENDING' | 'BOUNCED' | 'RETURNED';

export interface IssuedChequeRow {
  expense_id: number;
  expense_date: string;
  ba_id: number;
  amount: number;
  bank_id: number;
  issued_cheque_no: string | null;
  issued_cheque_date: string | null;
  issued_cheque_status: IssuedChequeStatus;
  issued_cheque_bounced_date: string | null;
  issued_cheque_returned_date: string | null;
  issued_cheque_return_reason: string | null;
  details: string | null;
  ba_name?: string;
  bank_name?: string;
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
  /** Alternative to bank_id for ONLINE (migration 028) — any business account, not just a
   *  bank. Pass one or the other, never both. */
  online_ba_id?: number;
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
  /** Migration 028: an ONLINE entry may name ANY business account instead of a bank. Exactly
   *  one of bank_id / online_ba_id is ever set; rows recorded before 028 use bank_id. */
  online_ba_id: number | null;
  online_ba_name?: string;
  issued_cheque_no: string | null;
  issued_cheque_date: string | null;
  remarks: string | null;
  ba_name?: string;
  bank_name?: string;
  account_name?: string;
  account_code?: string;
  endorsed_cheque_no?: string;
  /** PN-01: the voucher this draft line belongs to (migration 024). */
  voucher_id?: number | null;
  /** Set by a confirm() attempt that created a real expense but failed before posting it — the
   *  draft is the only pointer back to it, so edit/delete are blocked while it is set. */
  pending_expense_id?: number | null;
}

// ── Module 4e: Payroll (Employees & Stages, Wage Run, Salary Run) ──

export interface StageRow {
  stage_key: string;
  form_label: string;
  worker_label: string;
  cost_column: string;
  sort_order: number;
  is_active: boolean;
}

export type EmployeeType = 'WORKER' | 'SALARIED';

export interface EmployeeRow {
  employee_id: number;
  name: string;
  phone: string | null;
  city_id: number | null;
  employee_type: EmployeeType;
  monthly_salary: number | null;
  ba_id: number;
  is_active: boolean;
  city_name?: string;
  // Comma-separated stage_keys, populated by list() only — full `stages` below only via get().
  stage_keys?: string | null;
  stages?: { stage_key: string; form_label: string; worker_label: string }[];
}

export interface EmployeeCreateInput {
  name: string;
  phone?: string;
  city_id?: number;
  employee_type: EmployeeType;
  monthly_salary?: number;
  stages?: string[];
  /** Lives on the linked business account, not on this row. Both or neither (CK_business_accounts_opening). */
  opening_balance?: number;
  opening_date?: string;
}

export interface EmployeeListFilters {
  includeInactive?: boolean;
  employee_type?: EmployeeType;
  search?: string;
}

export interface WageRunItemRow {
  item_id: number;
  article_id: number;
  article_code?: string;
  article_name?: string;
  rate: number;
  cartons: number;
  packing: number;
  amount: number;
  line_no: number;
}

export interface WageRunRow {
  wage_run_id: number;
  employee_id: number;
  employee_name?: string;
  stage_key: string;
  stage_label?: string;
  run_date: string;
  total_amount: number;
  status: 'DRAFT' | 'CONFIRMED';
  unposted_at?: string | null;
  unposted_by?: number | null;
  amount_before?: number | null;
  // item_count populated by list() only — full `items` only via get().
  item_count?: number;
  items?: WageRunItemRow[];
}

export interface WageRunCreateInput {
  employee_id: number;
  stage_key: string;
  run_date: string;
  items: { article_id: number; cartons: number; rate?: number }[];
}

export interface WageRunListFilters {
  employee_id?: number;
  stage_key?: string;
  status?: 'DRAFT' | 'CONFIRMED';
  date_from?: string;
  date_to?: string;
}

export interface SalaryRunItemRow {
  item_id: number;
  employee_id: number;
  employee_name?: string;
  employee_ba_id?: number;
  salary_amount: number;
  amount: number;
  remarks: string | null;
}

export interface SalaryRunRow {
  salary_run_id: number;
  period_month: string;
  run_date: string;
  total_amount: number;
  status: 'DRAFT' | 'CONFIRMED';
  unposted_at?: string | null;
  unposted_by?: number | null;
  amount_before?: number | null;
  // item_count populated by list() only — full `items` only via get().
  item_count?: number;
  items?: SalaryRunItemRow[];
}

export interface SalaryRunCreateInput {
  period_month: string;
  overrides?: { employee_id: number; amount?: number; remarks?: string }[];
}

export interface SalaryRunListFilters {
  status?: 'DRAFT' | 'CONFIRMED';
  date_from?: string;
  date_to?: string;
}

// ── Module 5: Reports & Stock ──

export type DateRangeFilters = { date_from?: string; date_to?: string; range?: 'weekly' | 'monthly' | 'overall' };

export interface StockRow {
  variant_id: number;
  color: string;
  article_id: number;
  article_code: string;
  article_name: string;
  category_name: string;
  effective_packing: number;
  total_pairs: number;
  cartons: number;
  extra_pairs: number;
}

export interface VendorStockRow {
  vendor_id: number;
  vendor_name: string;
  material_id: number;
  material_name: string;
  unit: string;
  purchased_qty: number;
  returned_qty: number;
  on_hand: number;
}

export type StockMovementType = 'PRODUCTION' | 'SALE' | 'SALE_RETURN' | 'OPENING' | 'ADJUSTMENT';

export interface StockMovementRow {
  movement_id: number;
  variant_id: number;
  movement_type: StockMovementType;
  qty_pairs: number;
  movement_date: string;
  input_qty: number | null;
  input_unit: 'CARTONS' | 'PAIRS' | null;
  packing: number | null;
  created_by: number | null;
  color: string;
  article_id?: number;
  article_code: string;
  article_name: string;
  category_name: string;
  vendor_name?: string;
}

export interface ProductLedgerRow extends StockMovementRow {
  debit: number;
  credit: number;
}

export interface ProductLedgerResult {
  rows: ProductLedgerRow[];
  total_in: number;
  total_out: number;
  net: number;
}

export interface StockFilters {
  article_id?: number;
  category_id?: number;
}

export interface ProductionFilters extends DateRangeFilters {
  article_id?: number;
  category_id?: number;
  search?: string;
}

export interface ProductLedgerFilters extends DateRangeFilters {
  article_id?: number;
  category_id?: number;
  vendor_id?: number;
  search?: string;
}

export interface LogProductionInput {
  movement_date: string;
  input_qty: number;
  input_unit: 'CARTONS' | 'PAIRS';
  article_id?: number;
  variant_id?: number;
  color?: string;
  packing?: number;
}

export interface StockAdjustInput {
  movement_date: string;
  movement_type: 'OPENING' | 'ADJUSTMENT';
  qty_pairs: number;
  article_id?: number;
  variant_id?: number;
  color?: string;
  packing?: number;
}

export interface ReduceVendorStockInput {
  vendor_id: number;
  material_id: number;
  unit: string;
  qty: number;
  movement_date: string;
}

// Shared "Khaata" row shape — backs account-ledger, business-ledger's detail view, cash-book, and
// overall-search-ledger's drill-down, all via the same reports.service.js#formatLedgerRow().
export interface LedgerRow {
  entry_id: number;
  date: string;
  type: string;
  inv_no: number | null;
  bill_no: string | null;
  narration: string | null;
  cheque_no: string | null;
  cheque_date: string | null;
  cheque_received_date: string | null;
  pairs: number | null;
  debit: number;
  credit: number;
  is_payment_row: boolean;
  balance: number;
}

export interface AccountLedgerResult {
  opening_balance: number;
  rows: LedgerRow[];
  total_debit: number;
  total_credit: number;
  closing_balance: number;
}

export interface AccountLedgerFilters extends DateRangeFilters {
  ba_id?: number;
  ac_id?: number;
}

export interface SaleAnalysisRow {
  customer_id: number;
  customer_name: string;
  region_id: number | null;
  region_name: string | null;
  city_id: number | null;
  city_name: string | null;
  total_sales: number;
  total_returns: number;
  total_payment: number;
  total_commission: number;
  /** Rendered as its own row under the party, never a column — a JV is not a payment. */
  total_jv: number;
}

export interface SaleAnalysisRegionGroup {
  region_id: number | null;
  region_name: string | null;
  customers: SaleAnalysisRow[];
}

export interface SaleReportRow {
  customer_id: number;
  customer_name: string;
  region_id: number | null;
  region_name: string | null;
  city_id: number | null;
  city_name: string | null;
  total_sales: number;
  total_cartons: number;
  commission: number;
  sale_return: number;
  net_sales: number;
  payment: number;
  /** Own row under the party, not a column, and deliberately outside net_sales. */
  total_jv: number;
}

export interface SaleReportRegionGroup {
  region_id: number | null;
  region_name: string | null;
  customers: SaleReportRow[];
}

export interface SaleReportFilters extends DateRangeFilters {
  group_by?: 'region';
}

export interface VendorReportRow {
  vendor_id: number;
  vendor_name: string;
  total_purchase: number;
  total_return: number;
  net_purchase: number;
  payment_paid: number;
  /** Own row under the vendor, not a column. */
  total_jv: number;
}

export interface VendorReportFilters extends DateRangeFilters {
  vendor_id?: number;
}

export interface PaymentTrailBucket {
  key: string;
  label: string;
  total: number;
}

export interface PaymentTrailResult {
  buckets: PaymentTrailBucket[];
  grand_total: number;
}

export interface BusinessLedgerSummaryRow {
  ba_id: number;
  code: string;
  name: string;
  main_account: string;
  city_name: string | null;
  category: 'CUSTOMER' | 'VENDOR' | 'EMPLOYEE' | 'BANK' | 'BUSINESS_ACCOUNT';
  closing_balance: number;
}

export interface BusinessLedgerFilters extends DateRangeFilters {
  ba_id?: number;
  view?: 'summary' | 'detail';
}

export type BusinessLedgerResult = BusinessLedgerSummaryRow[] | ({ account: BusinessLedgerSummaryRow } & AccountLedgerResult);

// UC-37 Cash Book row. The four amount columns are mutually exclusive per row: a cash movement
// fills receipt_cash/payment_cash, a cheque or online one fills receipt_bank/payment_bank. Only
// rows with affects_cash reach the summary figures below — cheque/online lines are shown for
// visibility and total in `totals` alone.
export interface CashBookRow {
  date: string;
  account_name: string;
  remarks: string;
  mode: string;
  cheque_no: string | null;
  receipt_bank: number;
  payment_bank: number;
  receipt_cash: number;
  payment_cash: number;
  affects_cash: boolean;
}

export interface CashBookBankTransferRow {
  date: string;
  from_name: string;
  to_name: string;
  amount: number;
  remarks: string;
}

export interface CashBookChequeDepositRow {
  date: string;
  cheque_no: string | null;
  payer_name: string;
  bank_name: string | null;
  amount: number;
}

export interface CashBookResult {
  opening_cash: number;
  cash_received: number;
  total_cash: number;
  cash_paid: number;
  cash_in_hand: number;
  totals: {
    receipt_bank: number;
    payment_bank: number;
    receipt_cash: number;
    payment_cash: number;
  };
  rows: CashBookRow[];
  // CB-01/CB-03: informational-only — neither is counted in any total above.
  bank_transfers: CashBookBankTransferRow[];
  cheque_deposits: CashBookChequeDepositRow[];
}

// One account's balance right now, for the Receipts/Expenses balance panel. Positive = debit =
// the account owes us (receivable); negative = credit = we owe the account (payable).
export interface AccountBalanceResult {
  ba_id: number;
  as_of: string;
  balance: number;
}

export interface CashBookFilters {
  date?: string;
  month?: string;
}

export interface OverallTrailRow {
  code: string;
  description: string;
  type: string;
  type_label: string;
  ba_id?: number;
  ac_id?: number;
  /**
   * The single collapsed line a USER gets in place of the restricted accounts (UC-03). It stands
   * for several accounts at once, so it carries no ba_id/ac_id and cannot be drilled into.
   */
  is_aggregate?: boolean;
  debit: number;
  credit: number;
  net_balance: number;
}

export interface OverallTrailResult {
  as_of_date: string;
  rows: OverallTrailRow[];
  total_debit: number;
  total_credit: number;
}

export type OverallEntityType = 'CUSTOMER' | 'VENDOR' | 'EMPLOYEE' | 'SUB_CUSTOMER' | 'BUSINESS_ACCOUNT' | 'BANK';

export interface OverallDirectoryRow {
  entity_type: OverallEntityType;
  entity_id: number;
  name: string;
  ba_id: number | null;
  city_name: string | null;
  phone: string | null;
  is_active: boolean;
}

export type OverallSearchLedgerResult = { has_account: false; message: string } | ({ has_account: true } & AccountLedgerResult);

declare global {
  interface Window {
    api?: {
      auth: {
        login: (payload: { username: string; password: string }) => Promise<ApiResult<{ userId: number; username: string; role: 'ADMIN' | 'USER' }>>;
        logout: () => Promise<ApiResult<{ ok: true }>>;
        updateCredentials: (payload: { currentPassword: string; username?: string; newPassword?: string }) => Promise<ApiResult<{ username: string }>>;
        verifyPassword: (payload: { password: string }) => Promise<ApiResult<{ ok: true }>>;
        createUser: (payload: { username: string; password: string; fullName?: string }) => Promise<ApiResult<UserAccountRowFromApi>>;
        listUsers: () => Promise<ApiResult<UserAccountRowFromApi[]>>;
        setUserActive: (payload: { id: number; is_active: boolean }) => Promise<ApiResult<{ ok: true }>>;
        resetPassword: (payload: { id: number; newPassword: string; password: string }) => Promise<ApiResult<{ ok: true }>>;
      };
      systemReset: {
        run: (payload: { password: string }) => Promise<ApiResult<{ ok: true }>>;
      };
      saleBills: {
        create: (payload: SaleBillCreateInput) => Promise<ApiResult<SaleBillRow>>;
        list: (payload?: SaleBillListFilters) => Promise<ApiResult<SaleBillRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<SaleBillRow>>;
        update: (payload: { id: number; password?: string } & Partial<SaleBillCreateInput>) => Promise<ApiResult<SaleBillRow>>;
        post: (payload: { id: number; password?: string }) => Promise<ApiResult<SaleBillRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<SaleBillRow>>;
        unconfirm: (payload: { id: number }) => Promise<ApiResult<DraftSaleBillRow>>;
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
        biltySearch: (payload?: SaleBillListFilters) => Promise<ApiResult<SaleBillRow[]>>;
        updateBilty: (payload: { id: number; bilty_no: string; adda_id: number }) => Promise<ApiResult<SaleBillRow>>;
        lastSoldRate: (payload: { customer_id: number; variant_id: number }) => Promise<ApiResult<number | null>>;
        listUnposted: () => Promise<ApiResult<UnpostedBillRow[]>>;
        postAll: (payload?: { ids?: number[] }) => Promise<ApiResult<PostAllResult<'bill_id'>>>;
      };
      saleReturns: {
        create: (payload: SaleReturnCreateInput) => Promise<ApiResult<SaleReturnRow>>;
        list: (payload?: SaleReturnListFilters) => Promise<ApiResult<SaleReturnRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<SaleReturnRow>>;
        update: (payload: { id: number; password?: string } & Partial<SaleReturnCreateInput>) => Promise<ApiResult<SaleReturnRow>>;
        post: (payload: { id: number; password?: string }) => Promise<ApiResult<SaleReturnRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<SaleReturnRow>>;
        unconfirm: (payload: { id: number }) => Promise<ApiResult<DraftSaleReturnRow>>;
      };
      draftSaleBills: {
        create: (payload: Partial<SaleBillCreateInput>) => Promise<ApiResult<DraftSaleBillRow>>;
        list: (payload?: SaleBillListFilters) => Promise<ApiResult<DraftSaleBillRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<DraftSaleBillRow>>;
        update: (payload: { id: number } & Partial<SaleBillCreateInput>) => Promise<ApiResult<DraftSaleBillRow>>;
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
        confirm: (payload: { id: number }) => Promise<ApiResult<SaleBillRow>>;
        confirmAll: (payload?: { ids?: number[] }) => Promise<ApiResult<ConfirmAllResult>>;
      };
      draftSaleReturns: {
        create: (payload: Partial<SaleReturnCreateInput>) => Promise<ApiResult<DraftSaleReturnRow>>;
        list: (payload?: SaleReturnListFilters) => Promise<ApiResult<DraftSaleReturnRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<DraftSaleReturnRow>>;
        update: (payload: { id: number } & Partial<SaleReturnCreateInput>) => Promise<ApiResult<DraftSaleReturnRow>>;
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
        confirm: (payload: { id: number }) => Promise<ApiResult<SaleReturnRow>>;
        confirmAll: (payload?: { ids?: number[] }) => Promise<ApiResult<ConfirmAllResult>>;
      };
      customers: {
        list: (payload?: { includeInactive?: boolean; region_id?: number; city_id?: number; search?: string }) => Promise<ApiResult<CustomerRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<CustomerRow>>;
        create: (payload: CustomerCreateInput) => Promise<ApiResult<CustomerRow>>;
        update: (payload: { id: number } & CustomerUpdateInput) => Promise<ApiResult<CustomerRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        checkName: (payload: { name: string }) => Promise<ApiResult<CustomerCheckNameResult>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<CustomerRow>>;
      };
      subCustomers: {
        list: (payload?: { includeInactive?: boolean; region_id?: number; city_id?: number; search?: string }) => Promise<ApiResult<SubCustomerRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<SubCustomerRow>>;
        create: (payload: SubCustomerCreateInput) => Promise<ApiResult<SubCustomerRow>>;
        update: (payload: { id: number } & SubCustomerUpdateInput) => Promise<ApiResult<SubCustomerRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        checkName: (payload: { name: string }) => Promise<ApiResult<SubCustomerCheckNameResult>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<SubCustomerRow>>;
      };
      products: {
        list: (payload?: { includeInactive?: boolean; category_id?: number; vendor_id?: number; search?: string }) => Promise<ApiResult<ProductRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<ProductRow>>;
        create: (payload: ProductCreateInput) => Promise<ApiResult<ProductRow>>;
        createBatch: (payload: ProductBatchCreateInput) => Promise<ApiResult<ProductRow[]>>;
        update: (payload: { id: number } & ProductUpdateInput) => Promise<ApiResult<ProductRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<ProductRow>>;
      };
      productColors: {
        listByArticle: (payload: { article_id: number; includeInactive?: boolean }) => Promise<ApiResult<ProductVariantRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<ProductVariantRow>>;
        resolveOrCreate: (payload: { article_id: number; color: string; packing?: number }) => Promise<ApiResult<ProductVariantRow>>;
        update: (payload: { id: number; color: string; packing?: number }) => Promise<ApiResult<ProductVariantRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
      };
      stores: {
        list: (payload?: { includeInactive?: boolean; is_active?: boolean }) => Promise<ApiResult<StoreRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<StoreRow>>;
        create: (payload: StoreCreateInput) => Promise<ApiResult<StoreRow>>;
        update: (payload: { id: number } & StoreCreateInput) => Promise<ApiResult<StoreRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<StoreRow>>;
      };
      addas: {
        list: (payload?: { includeInactive?: boolean; is_active?: boolean; region_id?: number; city_id?: number }) => Promise<ApiResult<AddaRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<AddaRow>>;
        create: (payload: AddaCreateInput) => Promise<ApiResult<AddaRow>>;
        update: (payload: { id: number } & AddaCreateInput) => Promise<ApiResult<AddaRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<AddaRow>>;
      };
      regions: {
        list: (payload?: { includeInactive?: boolean; is_active?: boolean }) => Promise<ApiResult<RegionRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<RegionRow>>;
        create: (payload: RegionCreateInput) => Promise<ApiResult<RegionRow>>;
        update: (payload: { id: number } & RegionCreateInput) => Promise<ApiResult<RegionRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<RegionRow>>;
      };
      cities: {
        list: (payload?: { includeInactive?: boolean; is_active?: boolean; region_id?: number }) => Promise<ApiResult<CityRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<CityRow>>;
        create: (payload: CityCreateInput) => Promise<ApiResult<CityRow>>;
        update: (payload: { id: number } & CityCreateInput) => Promise<ApiResult<CityRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<CityRow>>;
      };
      categories: {
        list: (payload?: { includeInactive?: boolean }) => Promise<ApiResult<CategoryRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<CategoryRow>>;
        create: (payload: CategoryCreateInput) => Promise<ApiResult<CategoryRow>>;
        update: (payload: { id: number } & CategoryCreateInput) => Promise<ApiResult<CategoryRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<CategoryRow>>;
      };
      vendors: {
        list: (payload?: { includeInactive?: boolean; search?: string }) => Promise<ApiResult<VendorRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<VendorRow>>;
        create: (payload: VendorCreateInput) => Promise<ApiResult<VendorRow>>;
        update: (payload: { id: number } & VendorUpdateInput) => Promise<ApiResult<VendorRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<VendorRow>>;
      };
      purchases: {
        create: (payload: PurchaseCreateInput) => Promise<ApiResult<PurchaseRow>>;
        list: (payload?: PurchaseListFilters) => Promise<ApiResult<PurchaseRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<PurchaseRow>>;
        update: (payload: { id: number } & Partial<PurchaseCreateInput>) => Promise<ApiResult<PurchaseRow>>;
        post: (payload: { id: number }) => Promise<ApiResult<PurchaseRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<PurchaseRow>>;
        unconfirm: (payload: { id: number }) => Promise<ApiResult<DraftPurchaseRow>>;
        lastPurchasedRate: (payload: { vendor_id: number; material_name: string }) => Promise<ApiResult<LastPurchasedRate | null>>;
        listUnposted: () => Promise<ApiResult<UnpostedPurchaseRow[]>>;
        postAll: (payload?: { ids?: number[] }) => Promise<ApiResult<PostAllResult<'purchase_id'>>>;
      };
      purchaseReturns: {
        create: (payload: PurchaseReturnCreateInput) => Promise<ApiResult<PurchaseReturnRow>>;
        list: (payload?: PurchaseReturnListFilters) => Promise<ApiResult<PurchaseReturnRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<PurchaseReturnRow>>;
        update: (payload: { id: number } & Partial<PurchaseReturnCreateInput>) => Promise<ApiResult<PurchaseReturnRow>>;
        post: (payload: { id: number }) => Promise<ApiResult<PurchaseReturnRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<PurchaseReturnRow>>;
        unconfirm: (payload: { id: number }) => Promise<ApiResult<DraftPurchaseReturnRow>>;
      };
      draftPurchases: {
        create: (payload: Partial<PurchaseCreateInput>) => Promise<ApiResult<DraftPurchaseRow>>;
        list: (payload?: PurchaseListFilters) => Promise<ApiResult<DraftPurchaseRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<DraftPurchaseRow>>;
        update: (payload: { id: number } & Partial<PurchaseCreateInput>) => Promise<ApiResult<DraftPurchaseRow>>;
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
        confirm: (payload: { id: number }) => Promise<ApiResult<PurchaseRow>>;
        confirmAll: (payload?: { ids?: number[] }) => Promise<ApiResult<ConfirmAllResult>>;
      };
      draftPurchaseReturns: {
        create: (payload: Partial<PurchaseReturnCreateInput>) => Promise<ApiResult<DraftPurchaseReturnRow>>;
        list: (payload?: PurchaseReturnListFilters) => Promise<ApiResult<DraftPurchaseReturnRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<DraftPurchaseReturnRow>>;
        update: (payload: { id: number } & Partial<PurchaseReturnCreateInput>) => Promise<ApiResult<DraftPurchaseReturnRow>>;
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
        confirm: (payload: { id: number }) => Promise<ApiResult<PurchaseReturnRow>>;
        confirmAll: (payload?: { ids?: number[] }) => Promise<ApiResult<ConfirmAllResult>>;
      };
      bankAccounts: {
        list: (payload?: { includeInactive?: boolean }) => Promise<ApiResult<BankAccountRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<BankAccountRow>>;
        create: (payload: BankAccountCreateInput) => Promise<ApiResult<BankAccountRow>>;
        update: (payload: { id: number } & BankAccountUpdateInput) => Promise<ApiResult<BankAccountRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<BankAccountRow>>;
      };
      journalVouchers: {
        list: (payload?: JournalVoucherListFilters) => Promise<ApiResult<JournalVoucherRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<JournalVoucherRow>>;
        create: (payload: JournalVoucherCreateInput) => Promise<ApiResult<JournalVoucherRow>>;
        update: (payload: { id: number } & JournalVoucherCreateInput) => Promise<ApiResult<JournalVoucherRow>>;
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
        post: (payload: { id: number }) => Promise<ApiResult<JournalVoucherRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<JournalVoucherRow>>;
        listUnposted: () => Promise<ApiResult<UnpostedJournalVoucherRow[]>>;
        postAll: (payload?: { ids?: number[] }) => Promise<ApiResult<PostAllResult<'jv_id'>>>;
        counterAccount: () => Promise<ApiResult<BusinessAccountRow>>;
      };
      stockVouchers: {
        list: (payload?: StockVoucherListFilters) => Promise<ApiResult<StockVoucherRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<StockVoucherRow>>;
        create: (payload: StockVoucherCreateInput) => Promise<ApiResult<StockVoucherRow>>;
        update: (payload: { id: number } & StockVoucherCreateInput) => Promise<ApiResult<StockVoucherRow>>;
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
        post: (payload: { id: number }) => Promise<ApiResult<StockVoucherRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<StockVoucherRow>>;
        listUnposted: () => Promise<ApiResult<UnpostedStockVoucherRow[]>>;
        postAll: (payload?: { ids?: number[] }) => Promise<ApiResult<PostAllResult<'stock_voucher_id'>>>;
      };
      settlements: {
        list: (payload?: SettlementListFilters) => Promise<ApiResult<SettlementRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<SettlementRow>>;
        create: (payload: SettlementCreateInput) => Promise<ApiResult<SettlementRow>>;
        update: (payload: { id: number } & SettlementCreateInput) => Promise<ApiResult<SettlementRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        post: (payload: { id: number }) => Promise<ApiResult<SettlementRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<SettlementRow>>;
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
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
        post: (payload: { id: number }) => Promise<ApiResult<ReceiptRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<ReceiptRow>>;
        unconfirm: (payload: { id: number }) => Promise<ApiResult<DraftReceiptRow>>;
      };
      receiptVouchers: {
        list: (payload?: { date_from?: string; date_to?: string; voucher_no?: number }) => Promise<ApiResult<ReceiptVoucherRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<ReceiptVoucherRow>>;
        create: (payload: { voucher_date: string; remarks?: string }) => Promise<ApiResult<ReceiptVoucherRow>>;
        update: (payload: { id: number; voucher_date: string; remarks?: string }) => Promise<ApiResult<ReceiptVoucherRow>>;
        post: (payload: { id: number }) => Promise<ApiResult<VoucherActionResult<'receipt_id', ReceiptVoucherRow>>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<VoucherActionResult<'receipt_id', ReceiptVoucherRow>>>;
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
      };
      draftReceipts: {
        list: (payload?: ReceiptListFilters) => Promise<ApiResult<DraftReceiptRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<DraftReceiptRow>>;
        create: (payload: Partial<ReceiptCreateInput>) => Promise<ApiResult<DraftReceiptRow>>;
        update: (payload: { id: number } & Partial<ReceiptCreateInput>) => Promise<ApiResult<DraftReceiptRow>>;
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
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
        list: (payload?: { ac_id?: number; excludeRestrictedParent?: boolean; excludeClosed?: boolean; includeInactive?: boolean }) => Promise<ApiResult<BusinessAccountRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<BusinessAccountRow>>;
        create: (payload: BusinessAccountCreateInput) => Promise<ApiResult<BusinessAccountRow>>;
        createBatch: (payload: BusinessAccountBatchCreateInput) => Promise<ApiResult<BusinessAccountRow[]>>;
        update: (payload: { id: number } & BusinessAccountUpdateInput) => Promise<ApiResult<BusinessAccountRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<BusinessAccountRow>>;
        getCashAccount: () => Promise<ApiResult<BusinessAccountRow>>;
      };
      accountClasses: {
        list: () => Promise<ApiResult<AccountClassRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<AccountClassRow>>;
      };
      groupAccounts: {
        list: (payload?: { includeInactive?: boolean }) => Promise<ApiResult<GroupAccountRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<GroupAccountRow>>;
        create: (payload: GroupAccountCreateInput) => Promise<ApiResult<GroupAccountRow>>;
        update: (payload: { id: number } & GroupAccountUpdateInput) => Promise<ApiResult<GroupAccountRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<GroupAccountRow>>;
      };
      chartAccounts: {
        list: (payload?: { includeInactive?: boolean; group_id?: number }) => Promise<ApiResult<ChartOfAccountRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<ChartOfAccountRow>>;
        create: (payload: ChartAccountCreateInput) => Promise<ApiResult<ChartOfAccountRow>>;
        update: (payload: { id: number } & ChartAccountUpdateInput) => Promise<ApiResult<ChartOfAccountRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<ChartOfAccountRow>>;
      };
      expenses: {
        list: (payload?: ExpenseListFilters) => Promise<ApiResult<ExpenseRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<ExpenseRow>>;
        create: (payload: ExpenseCreateInput) => Promise<ApiResult<ExpenseRow>>;
        update: (payload: { id: number } & ExpenseCreateInput) => Promise<ApiResult<ExpenseRow>>;
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
        post: (payload: { id: number }) => Promise<ApiResult<ExpenseRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<ExpenseRow>>;
        unconfirm: (payload: { id: number }) => Promise<ApiResult<DraftExpenseRow>>;
        bounceIssuedCheque: (payload: { id: number; bounced_date: string }) => Promise<ApiResult<ExpenseRow>>;
        returnIssuedCheque: (payload: { id: number; returned_date: string; reason?: string }) => Promise<ApiResult<ExpenseRow>>;
        returnableIssuedCheques: (payload?: { date_from?: string; date_to?: string }) => Promise<ApiResult<IssuedChequeRow[]>>;
        issuedCheques: (payload?: { date_from?: string; date_to?: string }) => Promise<ApiResult<IssuedChequeRow[]>>;
      };
      expenseVouchers: {
        list: (payload?: { date_from?: string; date_to?: string; voucher_no?: number }) => Promise<ApiResult<ExpenseVoucherRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<ExpenseVoucherRow>>;
        create: (payload: { voucher_date: string; remarks?: string }) => Promise<ApiResult<ExpenseVoucherRow>>;
        update: (payload: { id: number; voucher_date: string; remarks?: string }) => Promise<ApiResult<ExpenseVoucherRow>>;
        post: (payload: { id: number }) => Promise<ApiResult<VoucherActionResult<'expense_id', ExpenseVoucherRow>>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<VoucherActionResult<'expense_id', ExpenseVoucherRow>>>;
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
      };
      draftExpenses: {
        list: (payload?: ExpenseListFilters) => Promise<ApiResult<DraftExpenseRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<DraftExpenseRow>>;
        create: (payload: Partial<ExpenseCreateInput>) => Promise<ApiResult<DraftExpenseRow>>;
        update: (payload: { id: number } & Partial<ExpenseCreateInput>) => Promise<ApiResult<DraftExpenseRow>>;
        remove: (payload: { id: number; password: string }) => Promise<ApiResult<{ ok: true }>>;
        confirm: (payload: { id: number }) => Promise<ApiResult<ExpenseRow>>;
      };
      zoom: {
        set: (payload: { factor: number }) => Promise<ApiResult<{ factor: number }>>;
        get: () => Promise<ApiResult<{ factor: number }>>;
      };
      updates: {
        // checkError: the lookup itself failed (private repo / draft release / missing
        // latest.yml / connection dropped mid-check) — distinct from "no update available".
        check: () => Promise<ApiResult<{ updateAvailable: boolean; currentVersion?: string; latestVersion?: string; packaged?: boolean; checkError?: string }>>;
        install: () => Promise<ApiResult<{ ok: true }>>;
      };
      backup: {
        // backup.ipc.js's runNow resolves service.sync(), which has no explicit return value —
        // wrap.js yields { ok: true, data: undefined } on success, not a real payload.
        runNow: () => Promise<ApiResult<undefined>>;
        status: () => Promise<ApiResult<{
          lastSyncAt: string | null;
          lastSyncError: string | null;
          configured: boolean;
          externalFolder: string | null;
          externalDriveConnected: boolean;
          lastExternalAt: string | null;
          lastExternalError: string | null;
          lastExternalSizeBytes: number | null;
        }>>;
        // Writes a full .bak straight to the external drive, replacing the previous one. Rejects
        // with a specific code the UI can trust to be readable — EXTERNAL_NOT_CONFIGURED,
        // EXTERNAL_DRIVE_MISSING, EXTERNAL_ACCESS_DENIED, EXTERNAL_DISK_FULL — never 'INTERNAL'.
        runExternal: () => Promise<ApiResult<{ path: string; sizeBytes: number | null }>>;
        // Opens the native folder picker and remembers the choice; { canceled: true } if dismissed.
        chooseExternalFolder: () => Promise<ApiResult<{ canceled: boolean; folder?: string }>>;
      };
      alerts: {
        list: () => Promise<ApiResult<AlertRow[]>>;
        dismiss: (payload: { alert_key: string }) => Promise<ApiResult<{ ok: true }>>;
        refresh: () => Promise<ApiResult<AlertRow[]>>;
      };
      stages: {
        list: () => Promise<ApiResult<StageRow[]>>;
      };
      employees: {
        list: (payload?: EmployeeListFilters) => Promise<ApiResult<EmployeeRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<EmployeeRow>>;
        create: (payload: EmployeeCreateInput) => Promise<ApiResult<EmployeeRow>>;
        update: (payload: { id: number } & EmployeeCreateInput) => Promise<ApiResult<EmployeeRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        reactivate: (payload: { id: number }) => Promise<ApiResult<EmployeeRow>>;
      };
      wageRuns: {
        list: (payload?: WageRunListFilters) => Promise<ApiResult<WageRunRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<WageRunRow>>;
        create: (payload: WageRunCreateInput) => Promise<ApiResult<WageRunRow>>;
        update: (payload: { id: number } & WageRunCreateInput) => Promise<ApiResult<WageRunRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        post: (payload: { id: number }) => Promise<ApiResult<WageRunRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<WageRunRow>>;
        recent: (payload: { employee_id: number; stage_key: string }) => Promise<ApiResult<{ wage_run_id: number; run_date: string; total_amount: number; status: 'DRAFT' | 'CONFIRMED' }[]>>;
      };
      salaryRuns: {
        list: (payload?: SalaryRunListFilters) => Promise<ApiResult<SalaryRunRow[]>>;
        get: (payload: { id: number }) => Promise<ApiResult<SalaryRunRow>>;
        create: (payload: SalaryRunCreateInput) => Promise<ApiResult<SalaryRunRow>>;
        update: (payload: { id: number } & SalaryRunCreateInput) => Promise<ApiResult<SalaryRunRow>>;
        remove: (payload: { id: number }) => Promise<ApiResult<{ ok: true }>>;
        post: (payload: { id: number }) => Promise<ApiResult<SalaryRunRow>>;
        unpost: (payload: { id: number }) => Promise<ApiResult<SalaryRunRow>>;
      };
      // Sub-actions with hyphens in their name bypass camelToKebab() in ipcBridge.ts's Proxy — the
      // property key is used verbatim as the channel suffix, so these must be accessed via bracket
      // notation with the literal hyphenated string, not dot notation (same as cheques above).
      stock: {
        'log-production': (payload: LogProductionInput) => Promise<ApiResult<{ movement_id: number; variant_id: number; qty_pairs: number }>>;
        adjust: (payload: StockAdjustInput) => Promise<ApiResult<{ movement_id: number; variant_id: number; qty_pairs: number }>>;
        movements: (payload: { article_id?: number; variant_id?: number }) => Promise<ApiResult<StockMovementRow[]>>;
        'reduce-vendor-stock': (payload: ReduceVendorStockInput) => Promise<ApiResult<{ movement_id: number }>>;
      };
      reports: {
        stock: (payload?: StockFilters) => Promise<ApiResult<StockRow[]>>;
        production: (payload?: ProductionFilters) => Promise<ApiResult<StockMovementRow[]>>;
        'product-ledger': (payload?: ProductLedgerFilters) => Promise<ApiResult<ProductLedgerResult>>;
        'vendor-stock': () => Promise<ApiResult<VendorStockRow[]>>;
        'sale-analysis': (payload?: SaleReportFilters) => Promise<ApiResult<SaleAnalysisRow[] | SaleAnalysisRegionGroup[]>>;
        'sale-report': (payload?: SaleReportFilters) => Promise<ApiResult<SaleReportRow[] | SaleReportRegionGroup[]>>;
        'vendor-report': (payload?: VendorReportFilters) => Promise<ApiResult<VendorReportRow[]>>;
        'vendor-ledger': (payload: { vendor_id: number } & DateRangeFilters) => Promise<ApiResult<AccountLedgerResult>>;
        'payment-trail': (payload?: DateRangeFilters) => Promise<ApiResult<PaymentTrailResult>>;
        'account-ledger': (payload: AccountLedgerFilters) => Promise<ApiResult<AccountLedgerResult>>;
        'business-ledger': (payload?: BusinessLedgerFilters) => Promise<ApiResult<BusinessLedgerResult>>;
        'account-balance': (payload: { ba_id: number; as_of?: string }) => Promise<ApiResult<AccountBalanceResult>>;
        'cash-book': (payload?: CashBookFilters) => Promise<ApiResult<CashBookResult>>;
        'overall-trail': (payload?: { as_of_date?: string }) => Promise<ApiResult<OverallTrailResult>>;
        'overall-search': (payload?: { search?: string; entity_type?: OverallEntityType }) => Promise<ApiResult<OverallDirectoryRow[]>>;
        'overall-search-ledger': (payload: { entity_type: OverallEntityType; ba_id: number | null } & DateRangeFilters) => Promise<ApiResult<OverallSearchLedgerResult>>;
        'export-pdf': (payload?: { filename?: string; landscape?: boolean }) => Promise<ApiResult<{ canceled: boolean; filePath?: string }>>;
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

export interface AlertRow {
  key: string;
  kind: 'CHEQUE_DUE' | 'PAYMENT_OVERDUE';
  severity: 'overdue' | 'due-soon';
  title: string;
  detail: string | null;
  date: string;
  amount: number;
  target_page: string;
  target_tab: string | null;
}

/**
 * Window zoom (ZoomControl.tsx). Returns the factor the main process actually applied after its own
 * clamp, so a caller storing the result can never drift out of step with the window.
 *
 * Outside Electron there is no bridge and nothing to zoom — resolving NO_BRIDGE keeps the control
 * inert in a plain browser (`npm run dev` without Electron) rather than throwing.
 */
export const zoom = {
  set: (factor: number) => window.api ? window.api.zoom.set({ factor }) : Promise.resolve(NO_BRIDGE),
  get: () => window.api ? window.api.zoom.get() : Promise.resolve(NO_BRIDGE),
};

export const alerts = {
  list: () => window.api ? window.api.alerts.list() : Promise.resolve(NO_BRIDGE),
  dismiss: (alertKey: string) =>
    window.api ? window.api.alerts.dismiss({ alert_key: alertKey }) : Promise.resolve(NO_BRIDGE),
  refresh: () => window.api ? window.api.alerts.refresh() : Promise.resolve(NO_BRIDGE)
};

export interface UserAccountRowFromApi {
  user_id: number;
  username: string;
  full_name: string | null;
  role: 'ADMIN' | 'USER';
  is_active: boolean;
}

export interface UserAccountRow {
  user_id: number;
  username: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
}

function mapUserAccountRow(row: UserAccountRowFromApi): UserAccountRow {
  return { ...row, role: mapRole(row.role) };
}

export async function createUser(payload: { username: string; password: string; fullName?: string }): Promise<ApiResult<UserAccountRow>> {
  if (!window.api) return NO_BRIDGE;
  const result = await window.api.auth.createUser(payload);
  return mapResult(result, mapUserAccountRow);
}

export async function listUsers(): Promise<ApiResult<UserAccountRow[]>> {
  if (!window.api) return NO_BRIDGE;
  const result = await window.api.auth.listUsers();
  return mapResult(result, rows => rows.map(mapUserAccountRow));
}

export async function setUserActive(id: number, isActive: boolean): Promise<ApiResult<{ ok: true }>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.auth.setUserActive({ id, is_active: isActive });
}

export async function resetUserPassword(id: number, newPassword: string, password: string): Promise<ApiResult<{ ok: true }>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.auth.resetPassword({ id, newPassword, password });
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

// Danger-zone "Reset Database" — drops and recreates both the main database and the backup
// mirror, wiping every table and restarting every IDENTITY column at 1, then reseeds the admin
// login + default setup data like a fresh install. Admin-only; the backend re-verifies `password`
// against the calling admin's own login on top of the session role check.
export async function resetDatabase(password: string): Promise<ApiResult<{ ok: true }>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.systemReset.run({ password });
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

// draft_sale_bills has no due_date column (that only applies once a real bill exists) — a
// separate normalizer rather than reusing normalizeBillRow, which requires one.
function normalizeDraftBillRow<T extends { bill_date: string }>(row: T): T {
  return { ...row, bill_date: normalizeDate(row.bill_date) };
}

function normalizeReturnRow<T extends { return_date: string }>(row: T): T {
  return { ...row, return_date: normalizeDate(row.return_date) };
}

// AD-01: the backend rides route_city_ids as a comma-joined string (STRING_AGG, same as every
// other normalize* here patching a raw driver shape into what AddaRow declares) — split into a
// real number[] here so callers never re-parse it.
function normalizeAddaRow(row: AddaRow): AddaRow {
  const raw = row.route_city_ids as unknown as string | null;
  return { ...row, route_city_ids: raw ? raw.split(',').map(Number) : [] };
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
  post: (id: number, password?: string) =>
    window.api ? window.api.saleBills.post({ id, password }).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.saleBills.unpost({ id }).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE),
  // "Unpost" now moves the bill back to draft_sale_bills — the real table strictly never holds an
  // unposted document. Resolves the new DRAFT row, not the same bill still sitting here.
  unconfirm: (id: number) =>
    window.api ? window.api.saleBills.unconfirm({ id }).then(r => mapResult(r, normalizeDraftBillRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number, password: string) =>
    window.api ? window.api.saleBills.remove({ id, password }) : Promise.resolve(NO_BRIDGE),
  biltySearch: (payload?: SaleBillListFilters) =>
    window.api ? window.api.saleBills.biltySearch(payload).then(r => mapResult(r, rows => rows.map(normalizeBillRow))) : Promise.resolve(NO_BRIDGE),
  updateBilty: (id: number, bilty_no: string, adda_id: number) =>
    window.api ? window.api.saleBills.updateBilty({ id, bilty_no, adda_id }).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE),
  lastSoldRate: (customer_id: number, variant_id: number) =>
    window.api ? window.api.saleBills.lastSoldRate({ customer_id, variant_id }) : Promise.resolve(NO_BRIDGE),
  // SB-06: bills awaiting posting, and posting a whole run of them at once.
  listUnposted: () =>
    window.api ? window.api.saleBills.listUnposted() : Promise.resolve(NO_BRIDGE),
  // Omit `ids` to post every unposted bill. Resolving ok does NOT mean everything posted — read
  // `data.failed`.
  postAll: (ids?: number[]) =>
    window.api ? window.api.saleBills.postAll(ids ? { ids } : undefined) : Promise.resolve(NO_BRIDGE)
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
  post: (id: number, password?: string) =>
    window.api ? window.api.saleReturns.post({ id, password }).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.saleReturns.unpost({ id }).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE),
  // "Unpost" now moves the return back to draft_sale_returns — resolves the new DRAFT row.
  unconfirm: (id: number) =>
    window.api ? window.api.saleReturns.unconfirm({ id }).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE)
};

export const draftSaleBills = {
  create: (payload: Partial<SaleBillCreateInput>) =>
    window.api ? window.api.draftSaleBills.create(payload).then(r => mapResult(r, normalizeDraftBillRow)) : Promise.resolve(NO_BRIDGE),
  list: (payload?: SaleBillListFilters) =>
    window.api ? window.api.draftSaleBills.list(payload).then(r => mapResult(r, rows => rows.map(normalizeDraftBillRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.draftSaleBills.get({ id }).then(r => mapResult(r, normalizeDraftBillRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: Partial<SaleBillCreateInput>) =>
    window.api ? window.api.draftSaleBills.update({ id, ...payload }).then(r => mapResult(r, normalizeDraftBillRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number, password: string) =>
    window.api ? window.api.draftSaleBills.remove({ id, password }) : Promise.resolve(NO_BRIDGE),
  confirm: (id: number) =>
    window.api ? window.api.draftSaleBills.confirm({ id }).then(r => mapResult(r, normalizeBillRow)) : Promise.resolve(NO_BRIDGE),
  // Post All — every draft awaiting posting. Resolving ok does NOT mean everything posted — read
  // `data.failed`, same contract as saleBills.postAll().
  confirmAll: (ids?: number[]) =>
    window.api ? window.api.draftSaleBills.confirmAll(ids ? { ids } : undefined) : Promise.resolve(NO_BRIDGE)
};

export const draftSaleReturns = {
  create: (payload: Partial<SaleReturnCreateInput>) =>
    window.api ? window.api.draftSaleReturns.create(payload).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE),
  list: (payload?: SaleReturnListFilters) =>
    window.api ? window.api.draftSaleReturns.list(payload).then(r => mapResult(r, rows => rows.map(normalizeReturnRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.draftSaleReturns.get({ id }).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: Partial<SaleReturnCreateInput>) =>
    window.api ? window.api.draftSaleReturns.update({ id, ...payload }).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number, password: string) =>
    window.api ? window.api.draftSaleReturns.remove({ id, password }) : Promise.resolve(NO_BRIDGE),
  confirm: (id: number) =>
    window.api ? window.api.draftSaleReturns.confirm({ id }).then(r => mapResult(r, normalizeReturnRow)) : Promise.resolve(NO_BRIDGE),
  confirmAll: (ids?: number[]) =>
    window.api ? window.api.draftSaleReturns.confirmAll(ids ? { ids } : undefined) : Promise.resolve(NO_BRIDGE)
};

// ── Read-only lookups Sale Bill/Return's own dropdowns need. Their Setup pages stay on demo
// data for now (a separate future module) — these are just enough to populate real dropdowns. ──

export async function listCustomers(): Promise<ApiResult<CustomerRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.customers.list();
}

export async function listSubCustomers(): Promise<ApiResult<SubCustomerRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.subCustomers.list();
}

export async function listProducts(): Promise<ApiResult<ProductRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.products.list();
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
  return mapResult(await window.api.addas.list({ is_active: true }), rows => rows.map(normalizeAddaRow));
}

export async function listCategories(): Promise<ApiResult<CategoryRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.categories.list();
}

export async function listRegions(): Promise<ApiResult<RegionRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.regions.list({ is_active: true });
}

export async function listCities(): Promise<ApiResult<CityRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.cities.list({ is_active: true });
}

// ── Module 8.1: Cities, Regions, Stores, Transport Addas (full CRUD) ──

export const cities = {
  list: (payload?: { includeInactive?: boolean; region_id?: number }) =>
    window.api ? window.api.cities.list(payload) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.cities.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: CityCreateInput) =>
    window.api ? window.api.cities.create(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: CityCreateInput) =>
    window.api ? window.api.cities.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.cities.remove({ id }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.cities.reactivate({ id }) : Promise.resolve(NO_BRIDGE)
};

export const regions = {
  list: (payload?: { includeInactive?: boolean }) =>
    window.api ? window.api.regions.list(payload) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.regions.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: RegionCreateInput) =>
    window.api ? window.api.regions.create(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: RegionCreateInput) =>
    window.api ? window.api.regions.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.regions.remove({ id }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.regions.reactivate({ id }) : Promise.resolve(NO_BRIDGE)
};

export const stores = {
  list: (payload?: { includeInactive?: boolean }) =>
    window.api ? window.api.stores.list(payload) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.stores.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: StoreCreateInput) =>
    window.api ? window.api.stores.create(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: StoreCreateInput) =>
    window.api ? window.api.stores.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.stores.remove({ id }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.stores.reactivate({ id }) : Promise.resolve(NO_BRIDGE)
};

export const addas = {
  // AD-02: city_id filters to addas whose Route includes that city — "search a route, see every
  // adda serving it".
  list: (payload?: { includeInactive?: boolean; region_id?: number; city_id?: number }) =>
    window.api ? window.api.addas.list(payload).then(r => mapResult(r, rows => rows.map(normalizeAddaRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.addas.get({ id }).then(r => mapResult(r, normalizeAddaRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: AddaCreateInput) =>
    window.api ? window.api.addas.create(payload).then(r => mapResult(r, normalizeAddaRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: AddaCreateInput) =>
    window.api ? window.api.addas.update({ id, ...payload }).then(r => mapResult(r, normalizeAddaRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.addas.remove({ id }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.addas.reactivate({ id }).then(r => mapResult(r, normalizeAddaRow)) : Promise.resolve(NO_BRIDGE)
};

export async function createCustomer(payload: CustomerCreateInput): Promise<ApiResult<CustomerRow>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.customers.create(payload);
}

export async function createSubCustomer(payload: SubCustomerCreateInput): Promise<ApiResult<SubCustomerRow>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.subCustomers.create(payload);
}

// ── Module 7: Customers, Sub-Customers (full CRUD) ──
// Both are on the non-blocking duplicate branch (real people can share a name) — checkName()
// is a pre-flight advisory call before create(), never a block; only update() blocks on an
// exact-name collision with a different row (DUPLICATE_NAME).

export const customers = {
  list: (payload?: { includeInactive?: boolean; region_id?: number; city_id?: number; search?: string }) =>
    window.api ? window.api.customers.list(payload) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.customers.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: CustomerCreateInput) =>
    window.api ? window.api.customers.create(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: CustomerUpdateInput) =>
    window.api ? window.api.customers.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.customers.remove({ id }) : Promise.resolve(NO_BRIDGE),
  checkName: (name: string) =>
    window.api ? window.api.customers.checkName({ name }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.customers.reactivate({ id }) : Promise.resolve(NO_BRIDGE)
};

export const subCustomers = {
  list: (payload?: { includeInactive?: boolean; region_id?: number; city_id?: number; search?: string }) =>
    window.api ? window.api.subCustomers.list(payload) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.subCustomers.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: SubCustomerCreateInput) =>
    window.api ? window.api.subCustomers.create(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: SubCustomerUpdateInput) =>
    window.api ? window.api.subCustomers.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.subCustomers.remove({ id }) : Promise.resolve(NO_BRIDGE),
  checkName: (name: string) =>
    window.api ? window.api.subCustomers.checkName({ name }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.subCustomers.reactivate({ id }) : Promise.resolve(NO_BRIDGE)
};

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
    window.api ? window.api.purchases.unpost({ id }).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE),
  // "Unpost" now moves the purchase back to draft_purchases — resolves the new DRAFT row.
  unconfirm: (id: number) =>
    window.api ? window.api.purchases.unconfirm({ id }).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE),
  // PR-01: what this vendor was last paid for this material on a posted purchase. Keyed on the
  // material name because that is what the line holds before save. Null when there is no prior
  // posted purchase, in which case the caller leaves the line as the user typed it.
  lastPurchasedRate: (vendor_id: number, material_name: string) =>
    window.api ? window.api.purchases.lastPurchasedRate({ vendor_id, material_name }) : Promise.resolve(NO_BRIDGE),
  // P-03: purchases awaiting posting, and posting a whole run of them at once. Resolving ok does
  // NOT mean everything posted — read `data.failed`.
  listUnposted: () =>
    window.api ? window.api.purchases.listUnposted() : Promise.resolve(NO_BRIDGE),
  postAll: (ids?: number[]) =>
    window.api ? window.api.purchases.postAll(ids ? { ids } : undefined) : Promise.resolve(NO_BRIDGE)
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
    window.api ? window.api.purchaseReturns.unpost({ id }).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE),
  unconfirm: (id: number) =>
    window.api ? window.api.purchaseReturns.unconfirm({ id }).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE)
};

export const draftPurchases = {
  create: (payload: Partial<PurchaseCreateInput>) =>
    window.api ? window.api.draftPurchases.create(payload).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE),
  list: (payload?: PurchaseListFilters) =>
    window.api ? window.api.draftPurchases.list(payload).then(r => mapResult(r, rows => rows.map(normalizePurchaseRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.draftPurchases.get({ id }).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: Partial<PurchaseCreateInput>) =>
    window.api ? window.api.draftPurchases.update({ id, ...payload }).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number, password: string) =>
    window.api ? window.api.draftPurchases.remove({ id, password }) : Promise.resolve(NO_BRIDGE),
  confirm: (id: number) =>
    window.api ? window.api.draftPurchases.confirm({ id }).then(r => mapResult(r, normalizePurchaseRow)) : Promise.resolve(NO_BRIDGE),
  confirmAll: (ids?: number[]) =>
    window.api ? window.api.draftPurchases.confirmAll(ids ? { ids } : undefined) : Promise.resolve(NO_BRIDGE)
};

export const draftPurchaseReturns = {
  create: (payload: Partial<PurchaseReturnCreateInput>) =>
    window.api ? window.api.draftPurchaseReturns.create(payload).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE),
  list: (payload?: PurchaseReturnListFilters) =>
    window.api ? window.api.draftPurchaseReturns.list(payload).then(r => mapResult(r, rows => rows.map(normalizePurchaseReturnRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.draftPurchaseReturns.get({ id }).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: Partial<PurchaseReturnCreateInput>) =>
    window.api ? window.api.draftPurchaseReturns.update({ id, ...payload }).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number, password: string) =>
    window.api ? window.api.draftPurchaseReturns.remove({ id, password }) : Promise.resolve(NO_BRIDGE),
  confirm: (id: number) =>
    window.api ? window.api.draftPurchaseReturns.confirm({ id }).then(r => mapResult(r, normalizePurchaseReturnRow)) : Promise.resolve(NO_BRIDGE),
  confirmAll: (ids?: number[]) =>
    window.api ? window.api.draftPurchaseReturns.confirmAll(ids ? { ids } : undefined) : Promise.resolve(NO_BRIDGE)
};

export async function listVendors(filters: VendorListFilters = {}): Promise<ApiResult<VendorRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.vendors.list(filters);
}

export async function createVendor(payload: VendorCreateInput): Promise<ApiResult<VendorRow>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.vendors.create(payload);
}

// ── Module 6: Products, Categories, Vendors (full CRUD) ──

export const products = {
  list: (payload?: { includeInactive?: boolean; category_id?: number; vendor_id?: number; search?: string }) =>
    window.api ? window.api.products.list(payload) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.products.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: ProductCreateInput) =>
    window.api ? window.api.products.create(payload) : Promise.resolve(NO_BRIDGE),
  createBatch: (payload: ProductBatchCreateInput) =>
    window.api ? window.api.products.createBatch(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: ProductUpdateInput) =>
    window.api ? window.api.products.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.products.remove({ id }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.products.reactivate({ id }) : Promise.resolve(NO_BRIDGE)
};

export const productColors = {
  listByArticle: (articleId: number, includeInactive?: boolean) =>
    window.api ? window.api.productColors.listByArticle({ article_id: articleId, includeInactive }) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.productColors.get({ id }) : Promise.resolve(NO_BRIDGE),
  resolveOrCreate: (payload: { article_id: number; color: string; packing?: number }) =>
    window.api ? window.api.productColors.resolveOrCreate(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: { color: string; packing?: number }) =>
    window.api ? window.api.productColors.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.productColors.remove({ id }) : Promise.resolve(NO_BRIDGE)
};

export const categories = {
  list: (payload?: { includeInactive?: boolean }) =>
    window.api ? window.api.categories.list(payload) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.categories.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: CategoryCreateInput) =>
    window.api ? window.api.categories.create(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: CategoryCreateInput) =>
    window.api ? window.api.categories.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.categories.remove({ id }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.categories.reactivate({ id }) : Promise.resolve(NO_BRIDGE)
};

export const vendors = {
  list: (payload?: { includeInactive?: boolean; search?: string }) =>
    window.api ? window.api.vendors.list(payload) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.vendors.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: VendorCreateInput) =>
    window.api ? window.api.vendors.create(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: VendorUpdateInput) =>
    window.api ? window.api.vendors.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.vendors.remove({ id }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.vendors.reactivate({ id }) : Promise.resolve(NO_BRIDGE)
};

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

function normalizeSettlementRow<T extends { settlement_date: string }>(row: T): T {
  return { ...row, settlement_date: normalizeDate(row.settlement_date) };
}

function normalizeJvRow<T extends { jv_date: string }>(row: T): T {
  return { ...row, jv_date: normalizeDate(row.jv_date) };
}

// window.api is keyed by the CAMEL feature name (ipcBridge.ts) — only the wire channel is
// kebab-case, and the bridge derives that itself. Reaching for window.api['journal-vouchers']
// yields undefined, which is a TypeError on the next property access rather than a clean failure.
export const journalVouchers = {
  list: (payload?: JournalVoucherListFilters) =>
    window.api ? window.api.journalVouchers.list(payload).then(r => mapResult(r, rows => rows.map(normalizeJvRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.journalVouchers.get({ id }).then(r => mapResult(r, normalizeJvRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: JournalVoucherCreateInput) =>
    window.api ? window.api.journalVouchers.create(payload).then(r => mapResult(r, normalizeJvRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: JournalVoucherCreateInput) =>
    window.api ? window.api.journalVouchers.update({ id, ...payload }).then(r => mapResult(r, normalizeJvRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number, password: string) =>
    window.api ? window.api.journalVouchers.remove({ id, password }) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.journalVouchers.post({ id }).then(r => mapResult(r, normalizeJvRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.journalVouchers.unpost({ id }).then(r => mapResult(r, normalizeJvRow)) : Promise.resolve(NO_BRIDGE),
  listUnposted: () =>
    window.api ? window.api.journalVouchers.listUnposted() : Promise.resolve(NO_BRIDGE),
  postAll: (ids?: number[]) =>
    window.api ? window.api.journalVouchers.postAll(ids ? { ids } : undefined) : Promise.resolve(NO_BRIDGE),
  counterAccount: () =>
    window.api ? window.api.journalVouchers.counterAccount() : Promise.resolve(NO_BRIDGE),
};

function normalizeStockVoucherRow<T extends { voucher_date: string }>(row: T): T {
  return { ...row, voucher_date: normalizeDate(row.voucher_date) };
}

export const stockVouchers = {
  list: (payload?: StockVoucherListFilters) =>
    window.api ? window.api.stockVouchers.list(payload).then(r => mapResult(r, rows => rows.map(normalizeStockVoucherRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.stockVouchers.get({ id }).then(r => mapResult(r, normalizeStockVoucherRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: StockVoucherCreateInput) =>
    window.api ? window.api.stockVouchers.create(payload).then(r => mapResult(r, normalizeStockVoucherRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: StockVoucherCreateInput) =>
    window.api ? window.api.stockVouchers.update({ id, ...payload }).then(r => mapResult(r, normalizeStockVoucherRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number, password: string) =>
    window.api ? window.api.stockVouchers.remove({ id, password }) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.stockVouchers.post({ id }).then(r => mapResult(r, normalizeStockVoucherRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.stockVouchers.unpost({ id }).then(r => mapResult(r, normalizeStockVoucherRow)) : Promise.resolve(NO_BRIDGE),
  listUnposted: () =>
    window.api ? window.api.stockVouchers.listUnposted() : Promise.resolve(NO_BRIDGE),
  postAll: (ids?: number[]) =>
    window.api ? window.api.stockVouchers.postAll(ids ? { ids } : undefined) : Promise.resolve(NO_BRIDGE),
};

export const settlements = {
  list: (payload?: SettlementListFilters) =>
    window.api ? window.api.settlements.list(payload).then(r => mapResult(r, rows => rows.map(normalizeSettlementRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.settlements.get({ id }).then(r => mapResult(r, normalizeSettlementRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: SettlementCreateInput) =>
    window.api ? window.api.settlements.create(payload).then(r => mapResult(r, normalizeSettlementRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: SettlementCreateInput) =>
    window.api ? window.api.settlements.update({ id, ...payload }).then(r => mapResult(r, normalizeSettlementRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.settlements.remove({ id }) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.settlements.post({ id }).then(r => mapResult(r, normalizeSettlementRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.settlements.unpost({ id }).then(r => mapResult(r, normalizeSettlementRow)) : Promise.resolve(NO_BRIDGE)
};

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
  remove: (id: number, password: string) => window.api ? window.api.receipts.remove({ id, password }) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.receipts.post({ id }).then(r => mapResult(r, normalizeReceiptRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.receipts.unpost({ id }).then(r => mapResult(r, normalizeReceiptRow)) : Promise.resolve(NO_BRIDGE),
  // Moves the posted receipt back into draft_receipts and resolves the NEW draft — the id space
  // changes, so callers must re-point at data.draft_id.
  unconfirm: (id: number) =>
    window.api ? window.api.receipts.unconfirm({ id }).then(r => mapResult(r, normalizeDraftReceiptRow)) : Promise.resolve(NO_BRIDGE)
};

// RJ-03: dates come back from SQL Server as full timestamps; normalise the header's own date and
// every line's, so the page never has to think about which shape it got.
function normalizeVoucher(row: ReceiptVoucherRow): ReceiptVoucherRow {
  return {
    ...row,
    voucher_date: normalizeDate(row.voucher_date),
    lines: row.lines ? row.lines.map(l => ({ ...l, receipt_date: normalizeDate(l.receipt_date) })) : undefined,
  };
}

export const receiptVouchers = {
  list: (payload?: { date_from?: string; date_to?: string; voucher_no?: number }) =>
    window.api ? window.api.receiptVouchers.list(payload).then(r => mapResult(r, rows => rows.map(normalizeVoucher))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.receiptVouchers.get({ id }).then(r => mapResult(r, normalizeVoucher)) : Promise.resolve(NO_BRIDGE),
  create: (payload: { voucher_date: string; remarks?: string }) =>
    window.api ? window.api.receiptVouchers.create(payload).then(r => mapResult(r, normalizeVoucher)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: { voucher_date: string; remarks?: string }) =>
    window.api ? window.api.receiptVouchers.update({ id, ...payload }).then(r => mapResult(r, normalizeVoucher)) : Promise.resolve(NO_BRIDGE),
  // Resolving ok does NOT mean every line posted — read `data.failed`.
  post: (id: number) =>
    window.api ? window.api.receiptVouchers.post({ id }).then(r => mapResult(r, d => ({ ...d, voucher: normalizeVoucher(d.voucher) }))) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.receiptVouchers.unpost({ id }).then(r => mapResult(r, d => ({ ...d, voucher: normalizeVoucher(d.voucher) }))) : Promise.resolve(NO_BRIDGE),
  remove: (id: number, password: string) =>
    window.api ? window.api.receiptVouchers.remove({ id, password }) : Promise.resolve(NO_BRIDGE)
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
  update: (id: number, payload: Partial<ReceiptCreateInput>) =>
    window.api ? window.api.draftReceipts.update({ id, ...payload }).then(r => mapResult(r, normalizeDraftReceiptRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number, password: string) =>
    window.api ? window.api.draftReceipts.remove({ id, password }) : Promise.resolve(NO_BRIDGE),
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

export const businessAccounts = {
  list: (payload?: { ac_id?: number; excludeClosed?: boolean; includeInactive?: boolean }) =>
    window.api ? window.api.businessAccounts.list(payload) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.businessAccounts.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: BusinessAccountCreateInput) =>
    window.api ? window.api.businessAccounts.create(payload) : Promise.resolve(NO_BRIDGE),
  createBatch: (payload: BusinessAccountBatchCreateInput) =>
    window.api ? window.api.businessAccounts.createBatch(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: BusinessAccountUpdateInput) =>
    window.api ? window.api.businessAccounts.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.businessAccounts.remove({ id }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.businessAccounts.reactivate({ id }) : Promise.resolve(NO_BRIDGE),
  getCashAccount: () => window.api ? window.api.businessAccounts.getCashAccount() : Promise.resolve(NO_BRIDGE)
};

// ── Milestone 8.2/8.3: Account Classes, Group Accounts, Chart of Accounts ──

export async function listAccountClasses(): Promise<ApiResult<AccountClassRow[]>> {
  if (!window.api) return NO_BRIDGE;
  return window.api.accountClasses.list();
}

export const groupAccounts = {
  list: (payload?: { includeInactive?: boolean }) =>
    window.api ? window.api.groupAccounts.list(payload) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.groupAccounts.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: GroupAccountCreateInput) =>
    window.api ? window.api.groupAccounts.create(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: GroupAccountUpdateInput) =>
    window.api ? window.api.groupAccounts.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.groupAccounts.remove({ id }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.groupAccounts.reactivate({ id }) : Promise.resolve(NO_BRIDGE)
};

export const chartAccounts = {
  list: (payload?: { includeInactive?: boolean; group_id?: number }) =>
    window.api ? window.api.chartAccounts.list(payload) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.chartAccounts.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: ChartAccountCreateInput) =>
    window.api ? window.api.chartAccounts.create(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: ChartAccountUpdateInput) =>
    window.api ? window.api.chartAccounts.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.chartAccounts.remove({ id }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.chartAccounts.reactivate({ id }) : Promise.resolve(NO_BRIDGE)
};

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

function normalizeIssuedChequeRow(row: IssuedChequeRow): IssuedChequeRow {
  return {
    ...row,
    expense_date: normalizeDate(row.expense_date),
    issued_cheque_date: row.issued_cheque_date != null ? normalizeDate(row.issued_cheque_date) : row.issued_cheque_date,
    issued_cheque_bounced_date: row.issued_cheque_bounced_date != null ? normalizeDate(row.issued_cheque_bounced_date) : row.issued_cheque_bounced_date,
    issued_cheque_returned_date: row.issued_cheque_returned_date != null ? normalizeDate(row.issued_cheque_returned_date) : row.issued_cheque_returned_date,
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
  remove: (id: number, password: string) => window.api ? window.api.expenses.remove({ id, password }) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.expenses.post({ id }).then(r => mapResult(r, normalizeExpenseRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.expenses.unpost({ id }).then(r => mapResult(r, normalizeExpenseRow)) : Promise.resolve(NO_BRIDGE),
  // Moves the posted expense back into draft_expenses and resolves the NEW draft — the id space
  // changes, so callers must re-point at data.draft_id. Refused for CHEQUE_ENDORSED
  // (USE_CHEQUE_REVERSAL) and for a CHEQUE_ISSUED cheque that already bounced/returned, exactly
  // as unpost() is.
  unconfirm: (id: number) =>
    window.api ? window.api.expenses.unconfirm({ id }).then(r => mapResult(r, normalizeDraftExpenseRow)) : Promise.resolve(NO_BRIDGE),
  // "Cheque Return" page's issued-cheque half — a cheque WE wrote from our own bank, as opposed
  // to cheques.endorsedAllocations()/reverseAllocation() which is for a cheque we RECEIVED and
  // endorsed onward. bounceIssuedCheque has no reason field (a bounce is just a bounce); returnIssuedCheque
  // does, since it covers any other reason the cheque is coming back unpaid.
  bounceIssuedCheque: (id: number, payload: { bounced_date: string }) =>
    window.api ? window.api.expenses.bounceIssuedCheque({ id, ...payload }).then(r => mapResult(r, normalizeExpenseRow)) : Promise.resolve(NO_BRIDGE),
  returnIssuedCheque: (id: number, payload: { returned_date: string; reason?: string }) =>
    window.api ? window.api.expenses.returnIssuedCheque({ id, ...payload }).then(r => mapResult(r, normalizeExpenseRow)) : Promise.resolve(NO_BRIDGE),
  returnableIssuedCheques: (payload?: { date_from?: string; date_to?: string }) =>
    window.api ? window.api.expenses.returnableIssuedCheques(payload).then(r => mapResult(r, rows => rows.map(normalizeIssuedChequeRow))) : Promise.resolve(NO_BRIDGE),
  issuedCheques: (payload?: { date_from?: string; date_to?: string }) =>
    window.api ? window.api.expenses.issuedCheques(payload).then(r => mapResult(r, rows => rows.map(normalizeIssuedChequeRow))) : Promise.resolve(NO_BRIDGE)
};

// PN-01: same shape and same caveats as receiptVouchers — post/unpost RESOLVE with a per-line
// breakdown, so `ok: true` does not mean every line acted. Always read `data.failed`.
function normalizeExpenseVoucher(row: ExpenseVoucherRow): ExpenseVoucherRow {
  return {
    ...row,
    voucher_date: normalizeDate(row.voucher_date),
    lines: row.lines ? row.lines.map(l => ({ ...l, expense_date: normalizeDate(l.expense_date) })) : undefined,
  };
}

export const expenseVouchers = {
  list: (payload?: { date_from?: string; date_to?: string; voucher_no?: number }) =>
    window.api ? window.api.expenseVouchers.list(payload).then(r => mapResult(r, rows => rows.map(normalizeExpenseVoucher))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.expenseVouchers.get({ id }).then(r => mapResult(r, normalizeExpenseVoucher)) : Promise.resolve(NO_BRIDGE),
  create: (payload: { voucher_date: string; remarks?: string }) =>
    window.api ? window.api.expenseVouchers.create(payload).then(r => mapResult(r, normalizeExpenseVoucher)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: { voucher_date: string; remarks?: string }) =>
    window.api ? window.api.expenseVouchers.update({ id, ...payload }).then(r => mapResult(r, normalizeExpenseVoucher)) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.expenseVouchers.post({ id }).then(r => mapResult(r, d => ({ ...d, voucher: normalizeExpenseVoucher(d.voucher) }))) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.expenseVouchers.unpost({ id }).then(r => mapResult(r, d => ({ ...d, voucher: normalizeExpenseVoucher(d.voucher) }))) : Promise.resolve(NO_BRIDGE),
  remove: (id: number, password: string) =>
    window.api ? window.api.expenseVouchers.remove({ id, password }) : Promise.resolve(NO_BRIDGE)
};

export const draftExpenses = {
  list: (payload?: ExpenseListFilters) =>
    window.api ? window.api.draftExpenses.list(payload).then(r => mapResult(r, rows => rows.map(normalizeDraftExpenseRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.draftExpenses.get({ id }).then(r => mapResult(r, normalizeDraftExpenseRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: Partial<ExpenseCreateInput>) =>
    window.api ? window.api.draftExpenses.create(payload).then(r => mapResult(r, normalizeDraftExpenseRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: Partial<ExpenseCreateInput>) =>
    window.api ? window.api.draftExpenses.update({ id, ...payload }).then(r => mapResult(r, normalizeDraftExpenseRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number, password: string) =>
    window.api ? window.api.draftExpenses.remove({ id, password }) : Promise.resolve(NO_BRIDGE),
  confirm: (id: number) =>
    window.api ? window.api.draftExpenses.confirm({ id }).then(r => mapResult(r, normalizeExpenseRow)) : Promise.resolve(NO_BRIDGE)
};

// ── Module 4e: Payroll (Employees & Stages, Wage Run, Salary Run) ──

export const stages = {
  list: () => window.api ? window.api.stages.list() : Promise.resolve(NO_BRIDGE)
};

export const employees = {
  list: (payload?: EmployeeListFilters) =>
    window.api ? window.api.employees.list(payload) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.employees.get({ id }) : Promise.resolve(NO_BRIDGE),
  create: (payload: EmployeeCreateInput) =>
    window.api ? window.api.employees.create(payload) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: EmployeeCreateInput) =>
    window.api ? window.api.employees.update({ id, ...payload }) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.employees.remove({ id }) : Promise.resolve(NO_BRIDGE),
  reactivate: (id: number) =>
    window.api ? window.api.employees.reactivate({ id }) : Promise.resolve(NO_BRIDGE)
};

function normalizeWageRunRow(row: WageRunRow): WageRunRow {
  return { ...row, run_date: normalizeDate(row.run_date) };
}

export const wageRuns = {
  list: (payload?: WageRunListFilters) =>
    window.api ? window.api.wageRuns.list(payload).then(r => mapResult(r, rows => rows.map(normalizeWageRunRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.wageRuns.get({ id }).then(r => mapResult(r, normalizeWageRunRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: WageRunCreateInput) =>
    window.api ? window.api.wageRuns.create(payload).then(r => mapResult(r, normalizeWageRunRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: WageRunCreateInput) =>
    window.api ? window.api.wageRuns.update({ id, ...payload }).then(r => mapResult(r, normalizeWageRunRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.wageRuns.remove({ id }) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.wageRuns.post({ id }).then(r => mapResult(r, normalizeWageRunRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.wageRuns.unpost({ id }).then(r => mapResult(r, normalizeWageRunRow)) : Promise.resolve(NO_BRIDGE),
  recent: (employee_id: number, stage_key: string) =>
    window.api ? window.api.wageRuns.recent({ employee_id, stage_key }) : Promise.resolve(NO_BRIDGE)
};

function normalizeSalaryRunRow(row: SalaryRunRow): SalaryRunRow {
  return { ...row, period_month: normalizeDate(row.period_month).slice(0, 7), run_date: normalizeDate(row.run_date) };
}

export const salaryRuns = {
  list: (payload?: SalaryRunListFilters) =>
    window.api ? window.api.salaryRuns.list(payload).then(r => mapResult(r, rows => rows.map(normalizeSalaryRunRow))) : Promise.resolve(NO_BRIDGE),
  get: (id: number) =>
    window.api ? window.api.salaryRuns.get({ id }).then(r => mapResult(r, normalizeSalaryRunRow)) : Promise.resolve(NO_BRIDGE),
  create: (payload: SalaryRunCreateInput) =>
    window.api ? window.api.salaryRuns.create(payload).then(r => mapResult(r, normalizeSalaryRunRow)) : Promise.resolve(NO_BRIDGE),
  update: (id: number, payload: SalaryRunCreateInput) =>
    window.api ? window.api.salaryRuns.update({ id, ...payload }).then(r => mapResult(r, normalizeSalaryRunRow)) : Promise.resolve(NO_BRIDGE),
  remove: (id: number) => window.api ? window.api.salaryRuns.remove({ id }) : Promise.resolve(NO_BRIDGE),
  post: (id: number) =>
    window.api ? window.api.salaryRuns.post({ id }).then(r => mapResult(r, normalizeSalaryRunRow)) : Promise.resolve(NO_BRIDGE),
  unpost: (id: number) =>
    window.api ? window.api.salaryRuns.unpost({ id }).then(r => mapResult(r, normalizeSalaryRunRow)) : Promise.resolve(NO_BRIDGE)
};

// ── Module 5: Reports & Stock ──

export const stock = {
  logProduction: (payload: LogProductionInput) =>
    window.api ? window.api.stock['log-production'](payload) : Promise.resolve(NO_BRIDGE),
  adjust: (payload: StockAdjustInput) =>
    window.api ? window.api.stock.adjust(payload) : Promise.resolve(NO_BRIDGE),
  movements: (payload: { article_id?: number; variant_id?: number }) =>
    window.api ? window.api.stock.movements(payload).then(r => mapResult(r, rows => rows.map(normalizeStockMovementRow))) : Promise.resolve(NO_BRIDGE),
  reduceVendorStock: (payload: ReduceVendorStockInput) =>
    window.api ? window.api.stock['reduce-vendor-stock'](payload) : Promise.resolve(NO_BRIDGE)
};

function normalizeStockMovementRow(row: StockMovementRow): StockMovementRow {
  return { ...row, movement_date: normalizeDate(row.movement_date) };
}

function normalizeProductLedgerResult(result: ProductLedgerResult): ProductLedgerResult {
  return { ...result, rows: result.rows.map(r => ({ ...r, movement_date: normalizeDate(r.movement_date) })) };
}

function normalizeLedgerRow(row: LedgerRow): LedgerRow {
  return {
    ...row,
    date: normalizeDate(row.date),
    cheque_date: row.cheque_date != null ? normalizeDate(row.cheque_date) : row.cheque_date,
    cheque_received_date: row.cheque_received_date != null ? normalizeDate(row.cheque_received_date) : row.cheque_received_date,
  };
}

function normalizeAccountLedgerResult(result: AccountLedgerResult): AccountLedgerResult {
  return { ...result, rows: result.rows.map(normalizeLedgerRow) };
}

function normalizeBusinessLedgerResult(result: BusinessLedgerResult): BusinessLedgerResult {
  if (Array.isArray(result)) return result;
  return { ...result, rows: result.rows.map(normalizeLedgerRow) };
}

// Cash Book rows are their own shape (UC-37's nine printed columns), not LedgerRow — the only date
// they carry is the entry date, so normalizing is a one-field job rather than normalizeLedgerRow's
// three.
function normalizeCashBookResult(result: CashBookResult): CashBookResult {
  return {
    ...result,
    rows: result.rows.map(row => ({ ...row, date: normalizeDate(row.date) })),
    bank_transfers: result.bank_transfers.map(row => ({ ...row, date: normalizeDate(row.date) })),
    cheque_deposits: result.cheque_deposits.map(row => ({ ...row, date: normalizeDate(row.date) })),
  };
}

function normalizeOverallTrailResult(result: OverallTrailResult): OverallTrailResult {
  return { ...result, as_of_date: normalizeDate(result.as_of_date) };
}

function normalizeOverallSearchLedgerResult(result: OverallSearchLedgerResult): OverallSearchLedgerResult {
  if (!result.has_account) return result;
  return { ...result, rows: result.rows.map(normalizeLedgerRow) };
}

export const reports = {
  stock: (payload?: StockFilters) =>
    window.api ? window.api.reports.stock(payload) : Promise.resolve(NO_BRIDGE),
  production: (payload?: ProductionFilters) =>
    window.api ? window.api.reports.production(payload).then(r => mapResult(r, rows => rows.map(normalizeStockMovementRow))) : Promise.resolve(NO_BRIDGE),
  productLedger: (payload?: ProductLedgerFilters) =>
    window.api ? window.api.reports['product-ledger'](payload).then(r => mapResult(r, normalizeProductLedgerResult)) : Promise.resolve(NO_BRIDGE),
  vendorStock: () =>
    window.api ? window.api.reports['vendor-stock']() : Promise.resolve(NO_BRIDGE),
  saleAnalysis: (payload?: SaleReportFilters) =>
    window.api ? window.api.reports['sale-analysis'](payload) : Promise.resolve(NO_BRIDGE),
  saleReport: (payload?: SaleReportFilters) =>
    window.api ? window.api.reports['sale-report'](payload) : Promise.resolve(NO_BRIDGE),
  vendorReport: (payload?: VendorReportFilters) =>
    window.api ? window.api.reports['vendor-report'](payload) : Promise.resolve(NO_BRIDGE),
  vendorLedger: (payload: { vendor_id: number } & DateRangeFilters) =>
    window.api ? window.api.reports['vendor-ledger'](payload).then(r => mapResult(r, normalizeAccountLedgerResult)) : Promise.resolve(NO_BRIDGE),
  paymentTrail: (payload?: DateRangeFilters) =>
    window.api ? window.api.reports['payment-trail'](payload) : Promise.resolve(NO_BRIDGE),
  accountLedger: (payload: AccountLedgerFilters) =>
    window.api ? window.api.reports['account-ledger'](payload).then(r => mapResult(r, normalizeAccountLedgerResult)) : Promise.resolve(NO_BRIDGE),
  businessLedger: (payload?: BusinessLedgerFilters) =>
    window.api ? window.api.reports['business-ledger'](payload).then(r => mapResult(r, normalizeBusinessLedgerResult)) : Promise.resolve(NO_BRIDGE),
  accountBalance: (payload: { ba_id: number; as_of?: string }) =>
    window.api ? window.api.reports['account-balance'](payload) : Promise.resolve(NO_BRIDGE),
  cashBook: (payload?: CashBookFilters) =>
    window.api ? window.api.reports['cash-book'](payload).then(r => mapResult(r, normalizeCashBookResult)) : Promise.resolve(NO_BRIDGE),
  overallTrail: (payload?: { as_of_date?: string }) =>
    window.api ? window.api.reports['overall-trail'](payload).then(r => mapResult(r, normalizeOverallTrailResult)) : Promise.resolve(NO_BRIDGE),
  overallSearch: (payload?: { search?: string; entity_type?: OverallEntityType }) =>
    window.api ? window.api.reports['overall-search'](payload) : Promise.resolve(NO_BRIDGE),
  overallSearchLedger: (payload: { entity_type: OverallEntityType; ba_id: number | null } & DateRangeFilters) =>
    window.api ? window.api.reports['overall-search-ledger'](payload).then(r => mapResult(r, normalizeOverallSearchLedgerResult)) : Promise.resolve(NO_BRIDGE)
};
