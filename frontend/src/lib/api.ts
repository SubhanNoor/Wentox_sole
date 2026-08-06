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
