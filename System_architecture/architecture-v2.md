# WentoX — Consolidated Architecture & Relational Flow (v2)

> Merges: (a) what is **actually implemented** in the repo today, and (b) what
> `new_features-v1.0.md` requires. Written to be the pre-code sense-check
> before further implementation. Where current code and new-features diverge,
> both are shown explicitly — nothing here is assumed already built unless
> cited.

---

## 0. Current Implementation Status (read this first)

This is the single most important fact for planning: **the backend schema is
ahead of the backend logic, and the frontend is ahead of both, but they are
not connected.**

| Layer | State |
|---|---|
| **Postgres schema** (`backend/src/db/migrations/001_init.sql`) | Fairly complete for setup + sale-side transactions + accounting ledger. **No purchase tables. No vendor-payment table. No role column.** |
| **Backend routes/controllers/services/repositories** | 100% scaffolding. Every route file has zero registered routes; every controller/service/repository exports `{}`. Nothing is callable yet — not even auth/login. |
| **Frontend** | Fully built UI (19 pages) but running entirely on **hardcoded in-memory demo data** in `AppContext.tsx`. No `fetch`/`axios` call to the backend exists anywhere. Frontend and backend are two disconnected codebases right now. |
| **Auth/roles** | Frontend: single hardcoded `admin`/`admin` credential pair, plaintext compare, no roles. Backend: `users` table has no role column; auth endpoints unimplemented. |

Implication for planning: every "new feature" below needs work in **up to
three places** — Postgres schema (often missing entirely), backend
routes/controllers/services/repos (currently empty stubs, need real logic),
and frontend (needs both new UI *and* the wiring to a real API, since it's
currently demo-data-only).

---

## 1. System Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                        WentoX ERP (Electron)                      │
│                                                                   │
│   React Frontend  ◄──── HTTP (not yet wired) ────►  Express API │
│   (demo data only,                                    │           │
│    no API calls yet)                            PostgreSQL       │
│                                                  (local, `pg` lib) │
└───────────────────────────────────────────────────────────────────┘
```

Corrects the old architecture.md: DB is **PostgreSQL**, not SQLite
(`backend/package.json` depends on `pg`; `001_init.sql` uses Postgres-only
syntax — enums, `IDENTITY`, etc.).

---

## 2. Data Entry Pages (INPUT)

| Setup (lookup) pages | Exists today | New/changed per new_features |
|---|---|---|
| Product Category | ✅ `setup-category` | — |
| Products/Articles | ✅ `setup-product` | Redesign to add **color** field at stock-add time (TASK-03) |
| Vendors | ✅ `setup-vendor` (lookup CRUD only) | Stays lookup-only; **purchases** become a separate transaction (TASK-01) |
| Customers | ✅ `demoCustomers` + inline-create from Sale Bill | Full redesign to card-based dedicated page (TASK-08), add **Region** field (TASK-07) |
| Sub Customers | ✅ `setup-sub-cust`, tied to parent `customerId` | **Remove parent link entirely** (TASK-06) — becomes an independent flat list |
| Cities/Regions | ✅ `setup-city` (cities only) | Need a **Regions** concept — currently `region` is just a free-text column on `business_accounts`; new_features implies Customer.region should be a proper lookup (TASK-07) |
| Stores / Addas | ✅ both exist as separate lookup tables/pages | — |
| Group / Control / Chart / Business Accounts | ✅ all four setup pages exist | **Control Accounts removed entirely** (TASK-11) — see §9 |

| Transaction pages | Exists today | New/changed |
|---|---|---|
| Sale Bill | ✅ full page, posts/unposts, mutates `product.stock` client-side | Auto-fill Main A/C from customer, warn if missing (TASK-05) |
| Sale Return | ✅ full page, mirrors Sale Bill | Add dropdown of "products previously bought by this customer" sourced from sale bills, but keep manual entry (TASK-12) |
| **Purchase** | ❌ does not exist — no page, no table, no route | **New page** (TASK-01): vendor, product, unit, weight, price/unit, multi-line — adds to stock on save (TASK-01 UPDATE) |
| Receipts (Jamma) | ✅ `receipts-jamma`, has `details`/`remarks` only | Add **Commission** field (see §7) |
| Payments (Naam) | ❌ no dedicated "pay a vendor/business account" transaction exists — `expenses` table/`ExpensesPage` is the closest analog but is scoped to `business_accounts`, not vendors | Vendor-side payments needed to support Vendor Report (TASK-10/UPDATE) — **this is a real gap**, see §10 |

---

## 3. Core Relational Flow (target state)

```
VENDORS
  │
  ├──► PURCHASE (NEW, TASK-01) ─────────────────────────────┐
  │         │ adds stock (TASK-01 UPDATE)                    │
  │         ▼                                                 │
  │    CURRENT STOCK (redesigned, TASK-03)     VENDOR PAGE / VENDOR REPORT (NEW, TASK-10)
  │         │                                  (Total Purchase, Purchase Return,
  │         ▼                                   Net Purchase, Payment Paid)
  │    PRODUCT LEDGER (TASK-02, inside Stock page)
  │    (Debit/IN = purchase + production, Credit/OUT = sale)
  │
  ├──► PURCHASE RETURN (implied by TASK-10 UPDATE's "Purchase Return" column,
  │     but NO page/flow is defined anywhere in new_features.md — gap, see §10)
  │
  └──► VENDOR PAYMENT (implied by "Payment Paid" in Vendor Report,
        not explicitly a page — likely reuses Payments/Naam concept, gap, see §10)

PRODUCTION (already implemented today, ReportStockPage.tsx "Add Stock")
  │
  └──► CURRENT STOCK increases + PRODUCT LEDGER (Debit/IN)
       (this is the ONLY stock-in path that actually works today —
        Purchase does not exist yet)

CUSTOMERS
  │
  ├──► SALE BILL (✅ built) ─────────────────────────────────┐
  │         │ reduces stock (✅ works, client-side only)      │
  │         ▼                                                 │
  │    CURRENT STOCK decreases                                │
  │         │                                                 ▼
  │         ▼                                    ACCOUNT LEDGER (KHAATA)
  │    PRODUCT LEDGER (Credit/OUT)                (Debit row = sale amount) — ✅
  │                                                (computed client-side by
  ├──► SALE RETURN (✅ built) ───────────────────────────────  filtering arrays,
  │         │ restocks (✅ works)                              no real ledger table
  │         ▼                                                 used yet — see §10)
  │    CURRENT STOCK increases                                ▼
  │         ▼                                    ACCOUNT LEDGER
  │    PRODUCT LEDGER (Debit/IN back)             (Credit row = return amount) — ✅
  │
  ├──► RECEIPTS/JAMMA (✅ built, needs Commission field added)
  │         │ fields today: Amount, Payment Mode, Details, Remarks
  │         │ fields needed: + Commission (TASK-19/Commission clarification)
  │         ▼                                                 ▼
  │    CASH BOOK OF THE DAY               ACCOUNT LEDGER (KHAATA)
  │    (⚠️ currently reads ONLY receipts,  (RED row = payment received;
  │     never expenses — see §10)          + separate Commission row, NEW)
  │
BUSINESS ACCOUNTS (expenses entered here, ✅ built)
  │
  ├──► PAYMENT TRAIL (NEW page, TASK-17)
  │    grouped by: Business Running Expenses, Cash at Banks,
  │    Directors Expenses - Drawings, Employees, Vendors-Suppliers
  │
  └──► CASH BOOK OF THE DAY (needs to actually read expenses — gap)
```

---

## 4. Reports (all read-only) — current vs. new

| Report | Status | Source | What it shows |
|---|---|---|---|
| Current Stock | ✅ built (`ReportStockPage.tsx`) | `products.stock`, client-side | Per-article stock, redesign pending (TASK-03) |
| Product Ledger | ⚠️ partially — exists as tabs inside Stock page, no dedicated filters yet | stock movements (client-side only) | Needs date-range + vendor + article/category filters (TASK-02 UPDATE) |
| Account Ledger (Khaata) | ✅ built (`ReportKhaataPage.tsx`) but computed by filtering `saleBills`/`saleReturns`/`receipts` arrays — no persisted ledger rows, no Commission row, no cheque sub-columns | Sale Bills, Sale Returns, Receipts | Needs Inv#/Bill#/cheque-narration columns, Commission row (TASK-16) |
| Cash Book of the Day | ⚠️ built but reads **only `receipts`**, never `expenses` — currently mislabeled as a full cash book | Receipts only today; should be Receipts + Expenses | Needs full redesign (TASK-15): opening cash, Jamma, Naam, cash in hand, per cheque/online/cash breakdown |
| Sale Analysis | ❌ does not exist | Sale Bills + Sale Returns + Receipts | Customer-wise / region-wise sales, returns, payments (TASK-09) |
| Sale Report | ❌ does not exist | Sale Bills + Sale Returns + Receipts | Total sales, cartons, commission, return, net, payment (TASK-18) |
| Vendor Report | ❌ does not exist, nor does its source data (Purchase) | Purchase + Purchase Return + Vendor Payment | Total purchase, purchase return, net purchase, payment paid (TASK-10/UPDATE) |
| Payment Trail | ❌ does not exist | Business Accounts (expenses) | Per-category totals + grand total (TASK-17) |
| Customer Page (cards + ledger) | ⚠️ customer data exists but no dedicated cards page | All of the above | Redesign (TASK-08) |
| Reports Sidebar (tabbed) | ❌ does not exist — reports today are separate nav items, not tabs of one section | — | New unified section with 8 tabs (TASK-19) |

---

## 5. Account Ledger — Row Source Map (target)

```
SALE BILL       → Debit row     (pairs filled, narration = "SAME" or delivery address)
SALE RETURN     → Credit row    (pairs filled, narration = "SAME" or delivery address)
RECEIPT/JAMMA   → RED row       (pairs empty, narration = CASH/CHEQUE/ONLINE text from remarks)
                  + Commission  → separate row, same receipt, CREDIT side
                                  (must be a credit — see worked example in §7;
                                   new_features.md never states polarity explicitly,
                                   this is inferred and should be confirmed with client)
```

Cheque narration splits into 3 sub-columns per TASK-16: **Cheque No**, **Date on
Cheque**, **Cheque Received Date** — none of these exist as columns on
`receipts` today (only `details`/`remarks` free text). Needs schema change.

---

## 6. Stock Flow (target)

```
PURCHASE (NEW — not yet built)         PRODUCTION (✅ already built)
    │                                       │
    ▼                                       ▼
         STOCK INCREASES (+pairs)  ◄────────┘
              │
              ▼
    SALE BILL (✅ built) → STOCK DECREASES (-pairs)
              │
              ▼
    SALE RETURN (✅ built) → STOCK INCREASES BACK (+pairs)

Current Stock Page = live snapshot (today: client-side `product.stock` field;
                      target: derived from `stock_movements` table, which
                      already has the right columns and a PRODUCTION type —
                      just needs a PURCHASE type added and a real query)
Product Ledger     = full IN/OUT history of the above
```

Note: `stock_movements.movement_type` enum today is `OPENING | ADJUSTMENT |
PRODUCTION | SALE | SALE_RETURN` — **no `PURCHASE` value**. Adding the
Purchase page requires either adding a `PURCHASE` enum value or reusing
`ADJUSTMENT`/`PRODUCTION` (schema decision needed before backend work starts).

---

## 7. Commission vs Discount (clarified per new_features.md)

```
SALE BILL
  ├── D% (per-article discount)      ──► reduces sale line value, at sale time
  └── Invoice Discount                ──► reduces total bill value, at sale time
        └── Both = DISCOUNT — already baked into `net_value`, ✅ implemented

RECEIPTS (JAMMA)
  └── Commission field (NEW — not in schema/UI yet)
        ──► sale bill amount stays unchanged
        ──► only reduces what the customer still needs to pay (payable amount)
        └── Worked example (new_features.md):
            Sale Bill  = 1,020,000   (unchanged, already posted)
            Commission =    20,000   (recorded at payment time only)
            Customer pays =  1,000,000
            Balance = 0

            Ledger:
            Debit  (sale)      = 1,020,000
            Credit (commission) =  20,000   ← inferred polarity (see §5)
            Credit (payment)    = 1,000,000
            Balance = 1,020,000 − (20,000 + 1,000,000) = 0  ✓ math checks out
```

Sale Report's "Commission" column (TASK-18) is explicitly **not** this —
per new_features.md's own note (line 392 vs. line 457), TASK-18's table
calls sale-time discounts "Commission" while the later clarification section
insists Commission = payment-time-only and discount is separate. **This is a
direct contradiction inside new_features.md itself** — flagged for the
client, see §10.

---

## 8. User Access Control (target, TASK-14)

```
┌─────────────────────────────────────────────────────┐
│                    ALL PAGES                        │
│   ADMIN ──────────────────────► Full Access          │
│   USER  ──────────────────────► All pages EXCEPT:    │
│            • Bank Accounts (i.e. "Cash at Banks")    │
│            • Directors Expenses - Drawings           │
└─────────────────────────────────────────────────────┘
```

Requires: a `role` column on `users` (doesn't exist), role-aware auth
middleware (`backend/src/middleware/auth.js` currently only checks JWT
validity, no role check), and frontend nav/route guarding (doesn't exist —
`AppContext` has one flat `settings` credential, no concept of "current
user's role" at all).

---

## 9. Complete Target Page Map

```
WentoX
│
├── HOME (NEW, TASK-13 — landing page with logo, click Home icon to return)
│
├── SETUP
│   ├── Product Category                    ✅
│   ├── Product Detail Info                 ✅ (add color at stock-add, TASK-03)
│   ├── Vendors                             ✅ (lookup only, no purchase link yet)
│   ├── Customers (cards view, TASK-08)     ⚠️ redesign needed
│   ├── Sub Customers (independent, TASK-06)⚠️ remove parent FK
│   ├── Cities / Regions                    ⚠️ regions not modeled as lookup yet
│   ├── Stores                              ✅
│   ├── Addas                               ✅
│   ├── Group Accounts                      ✅
│   ├── ~~Control Accounts~~                ❌ REMOVE (TASK-11)
│   ├── Chart of Accounts                   ✅ (stays)
│   └── Business Accounts                   ✅
│
├── DATA ENTRY
│   ├── Sale Bill                           ✅ (+ auto main-A/C, TASK-05)
│   ├── Sale Return                         ✅ (+ prior-purchase dropdown, TASK-12)
│   ├── Purchase                            ❌ NEW (TASK-01)
│   ├── Receipts (Jamma)                    ✅ (+ Commission field)
│   └── Payments (Naam)                     ❓ undefined — see §10 gap
│
├── STOCK
│   ├── Current Stock (redesign, TASK-03)   ⚠️ table + expandable sub-rows + add dialog
│   └── Product Ledger (filters, TASK-02)   ⚠️ needs date/vendor/article filters
│
└── REPORTS (new unified sidebar section, TASK-19 — tabbed top bar)
    ├── Sale Analysis        ❌ NEW (TASK-09)
    ├── Sale Report          ❌ NEW (TASK-18)
    ├── Vendor Report        ❌ NEW (TASK-10)
    ├── Payment Trail        ❌ NEW (TASK-17)
    ├── Account Ledger       ✅ exists, needs redesign (TASK-16)
    ├── Business Ledger      ✅ exists (as Business Accounts ledger view)
    ├── Cash Book            ⚠️ exists but broken/partial (TASK-15)
    └── Product Ledger       ⚠️ exists, needs filters (TASK-02 UPDATE)
```

---

## 10. Open Gaps / Questions to Resolve Before Coding

These are things new_features.md implies but never fully specifies — worth
settling before writing schema/code:

1. **Purchase Return has no defined page/flow.** Vendor Report (TASK-10
   UPDATE) needs a "Purchase Return" column, but no task defines how a
   purchase return is entered. Needs its own page (mirroring Sale Return) or
   an explicit decision to fold it into Purchase with a signed quantity.
2. **"Payment Paid" to vendors has no defined page.** Same issue — Vendor
   Report needs vendor payment data, but "Payments (Naam)" (TASK task list,
   old architecture.md) was never fleshed out in new_features.md. Is this the
   same `expenses` flow scoped to a vendor's business account, or a new table?
3. **Commission contradiction inside new_features.md itself** (§7 above):
   TASK-18's table defines "Commission" as sale-bill discount (D%/Invoice
   Discount), while the dedicated "COMMISSION — Clarification" section later
   in the same file insists Commission is payment-time-only and explicitly
   NOT a discount. These can't both be true — needs a decision on which
   definition the Sale Report column actually uses.
4. **Commission row polarity** — never stated as debit or credit; only
   inferable from the worked balance example (§5/§7). Confirm explicitly.
5. **`stock_movements.movement_type` has no PURCHASE value** — schema
   migration needed before Purchase page can persist stock-in events.
6. **Regions as a lookup** — TASK-07 wants a Region field/dropdown on
   Customer, but no `regions` table exists; today `region` is a free-text
   column only on `business_accounts`. Decide: new `regions` table, or reuse
   `cities`?
7. **`BiltyUpdatePage.tsx` is fully built but orphaned** (no nav entry, not
   imported anywhere) despite the schema having partial indexes built
   specifically for its query pattern (`bilty_no IS NULL`, `adda_id IS
   NULL`). Likely just needs to be wired into nav — worth confirming it's
   still wanted as-is before building anything new for the same purpose.
8. **Frontend↔backend integration is 0%.** Every new feature discussion
   needs to account for the fact that today's frontend doesn't call the
   backend at all — this isn't purely additive work, it's also the point at
   which the whole app needs its data-fetching layer built for the first
   time.

---

## 11. Key Rules (merged, current + target)

| Rule | Detail | Status |
|---|---|---|
| Sale Bill → Stock | Posting a sale bill reduces stock by pairs | ✅ implemented (client-side) |
| Sale Return → Stock | Posting a return adds pairs back | ✅ implemented (client-side) |
| Production → Stock | Adding production increases stock | ✅ implemented (client-side, via direct `UPDATE_PRODUCT` dispatch in `ReportStockPage.tsx`) |
| Purchase → Stock | Every purchase adds pairs to stock | ❌ not implemented — page doesn't exist |
| Commission → Jamma only | Commission recorded only in Receipts, never in Sale Bill | ❌ not implemented — no field anywhere yet, and contradicted by TASK-18's own table (see gap #3) |
| Ledger balance | Opening Balance + Debits − Credits = Closing Balance | ✅ conceptually followed in `ReportKhaataPage.tsx`'s client-side computation, no persisted ledger table used |
| Red rows | Only payment (Receipt) rows are red in ledger | ✅ implemented conceptually, no visual/schema work confirmed |
| Customer search | Primary = Region, Secondary = City | ❌ Region not modeled as a real field/lookup yet |
| Sub customers | Independent, no parent link | ⚠️ contradicts current schema/frontend (`sub_customers.customer_id NOT NULL`, `SubCustomer.customerId` required) — TASK-06 requires removing this FK |
| User roles | Admin = full access, User = no Bank Accounts / Directors Expenses | ❌ no role column, no access-control logic anywhere |
| Export | Every page with Print also gets PDF + Excel export | ❌ not implemented anywhere yet (TASK-04) |

---

## 12. Cheque Due & Payment Alerts (NEW, planned)

**Purpose**: notify the user of (a) post-dated cheques nearing/past their
maturity date, and (b) customers whose outstanding balance has gone overdue.
Alerts are computed live from existing transactional data — no independent
source of truth beyond a small dismissal table.

### Schema additions required
- `receipts.cheque_no`, `receipts.cheque_date`, `receipts.cheque_received_date`
  (shared with TASK-16's Account Ledger cheque columns — build once, use in
  both places).
- `receipts.cheque_status`: `PENDING | DEPOSITED | ENDORSED | PARTIALLY_ENDORSED
  | CLEARED | BOUNCED` (superset needed once §13's endorsement flow is added).
- Credit-period concept for overdue detection: either a global
  `settings.default_credit_days`, or a per-customer `customers.credit_days`
  column — needs a client decision.
- New table `alert_dismissals`: `id, alert_key, dismissed_at, dismissed_until`
  — lets a user snooze/dismiss a derived alert without deleting underlying data.

### Backend
- New `GET /api/notifications` endpoint, computed on request (not stored):
  - **Cheque due/overdue**: `receipts` where `payment_mode = 'CHEQUE'` and
    `cheque_status IN ('PENDING','PARTIALLY_ENDORSED')`, `cheque_date` within
    next N days (amber) or already past (red).
  - **Payment overdue**: customers with positive outstanding balance whose
    oldest unpaid activity exceeds the credit period.
  - Filters out anything present in (non-expired) `alert_dismissals`.
- Optional (v2): Electron main-process daily job (`node-cron`) firing a native
  OS notification in addition to in-app polling — desktop-app nicety, not
  required for v1.

### Frontend
- Bell icon + badge in `AppLayout` header (system-wide, not inside Reports).
- Poll on load + periodic interval while app is open.
- Dropdown grouped by type/severity; click → navigate to the source record
  (Account Ledger / Receipts entry); dismiss → writes to `alert_dismissals`.

### Dependencies / sequencing
Needs the cheque schema fields above, and needs the ledger/balance
computation to run against real persisted data rather than today's
client-side demo-array filtering (§10 gap #8) — building this before the
backend integration lands would mean re-plumbing it later.

**Status: planning only — not started.**

---

## 13. Cheque Endorsement / Pass-Through Payments (NEW, planned)

**Purpose**: model the real workflow where a cheque received from a customer
is handed over (in full, in part, or with excess) to a vendor/supplier or a
business expense instead of being deposited — one physical cheque satisfying
someone else's payable.

### Core concept
A received cheque is a pool of value that gets **allocated** across one or
more destinations over time (deposit / vendor payment / expense payment)
until its `unallocated balance` reaches zero. This doubles as the missing
vendor-payment transaction identified in §10 gap #2 — a `VENDOR_PAYMENT`
allocation *is* that transaction, just sourced from a cheque instead of cash.

### Schema additions required
- `receipts.cheque_status` extended as in §12 (`PARTIALLY_ENDORSED` matters
  here specifically).
- New table `cheque_allocations`: `allocation_id, receipt_id (FK → receipts),
  disposition_type ENUM('DEPOSIT','VENDOR_PAYMENT','EXPENSE_PAYMENT'),
  target_type ENUM('VENDOR','BUSINESS_ACCOUNT'), target_id, amount,
  allocation_date, remarks, status ENUM('ACTIVE','REVERSED')`.
  App-level constraint: `SUM(amount WHERE status='ACTIVE') per receipt_id
  <= receipts.amount`.

### Matching scenarios (all three must be supported)
- **Exact match** — cheque amount = vendor due → single allocation, vendor
  fully settled, cheque fully allocated.
- **Cheque > vendor due** — allocation settles the vendor; remainder must be
  explicitly assigned somewhere (another vendor, an expense, or deposited)
  — UI must not allow a silently-orphaned remainder.
- **Cheque < vendor due** — allocation reduces (doesn't zero) the vendor's
  payable; vendor ledger still shows a balance to be covered separately.

### Ledger effects
- Customer side unaffected — the receipt/Account Ledger credit stands
  regardless of what happens to the cheque afterward.
- Vendor side: each `VENDOR_PAYMENT` allocation → ledger entry crediting the
  vendor's payable, `source_type='CHEQUE_ALLOCATION'` → feeds Vendor Report's
  "Payment Paid" column.
- Business account side: `EXPENSE_PAYMENT` allocations feed Payment Trail
  the same way.
- Cash Book: endorsed amounts never touch the business's own bank/cash and
  must not inflate cash-in-hand/bank totals, but should still appear as a
  distinct labeled row ("Endorsed — not deposited") for audit purposes —
  needs client confirmation on exact visibility.

### Bounced-cheque cascade (critical edge case)
If a cheque bounces after being endorsed, **both sides must reverse
together**: the customer's receipt reverses (their due goes back up) AND
every `cheque_allocations` row sourced from it flips to `REVERSED` so the
vendor's/expense account's balance also goes back up. A `BOUNCED` receipt
must cascade to its allocations, not just correct the customer ledger.

### Frontend
- "Dispose of Cheque" action from the Receipts (Jamma) page (can happen same
  day or later) → screen listing pending/partially-allocated cheques → choose
  disposition + target + amount (defaults to remaining unallocated balance)
  → save. Shows running "Unallocated balance" until zero.

### Sequencing (build order — each step depends on the last)
1. Cheque schema fields (shared with §12/TASK-16).
2. `cheque_allocations` table + vendor-payment modeling (closes gap #2).
3. Allocation UI + ledger posting logic.
4. Bounced-cheque reversal cascade.
5. Wire §12's cheque-due alerts to treat unallocated-balance cheques as more
   urgent than fully-disposed ones.

**Status: planning only — not started.**

---

## 14. Consolidated TODO Checklist

Legend: ✅ Done · ⚠️ Partial/needs rework · ❌ Not started

### Foundation
- [ ] ⚠️ Frontend↔backend integration (currently 0% — frontend runs on demo
      data only, no API calls exist anywhere)
- [ ] ❌ Backend auth actually implemented (login endpoint, JWT issuance —
      currently all stubs)
- [ ] ❌ `users.role` column + role-aware middleware + frontend role guarding
      (TASK-14)
- [ ] ❌ Backend CRUD wired for every setup entity (all 19 route/controller/
      service/repository files are empty scaffolding)

### Setup pages
- [x] ✅ Product Category, Products, Vendors (lookup), Cities, Stores, Addas,
      Group/Chart/Business Accounts — UI built (frontend demo-data only)
- [ ] ❌ Remove Control Accounts entirely (TASK-11)
- [ ] ❌ Remove Sub Customer → Customer parent FK, add search to dropdown
      (TASK-06) — breaking schema + type change
- [ ] ❌ Add Region field to Customer + region lookup table (TASK-07)
- [ ] ❌ New Customer page — card view + ledger redesign (TASK-08)
- [ ] ❌ Home/landing page (TASK-13)

### Transactions
- [x] ✅ Sale Bill — entry, post/unpost, stock deduction (client-side)
- [ ] ❌ Auto-fill Main A/C on customer select + warning if missing (TASK-05)
- [x] ✅ Sale Return — entry, restock (client-side)
- [ ] ❌ Prior-purchase dropdown on Sale Return, sourced from customer's sale
      bills (TASK-12)
- [ ] ❌ Purchase page (new) — vendor/product/unit/weight/price, multi-line
      (TASK-01)
- [ ] ❌ Purchase → Stock increase on save (TASK-01 UPDATE)
- [ ] ❌ Purchase Return page/flow (undefined in new_features.md — gap #1)
- [x] ✅ Receipts (Jamma) — entry, running balance shown inline
- [ ] ❌ Commission field on Receipts (needs polarity decision, gap #3/#4)
- [ ] ❌ Cheque fields on Receipts: cheque no / cheque date / received date /
      status (shared by TASK-16, §12, §13)
- [x] ✅ Expenses entry (business accounts)
- [ ] ❌ Vendor payment transaction (undefined — gap #2; resolved via
      `cheque_allocations` for cheque-sourced payments, still need a plain
      cash/bank vendor-payment path too)

### Stock
- [x] ✅ Current Stock page (basic), Production stock-in (client-side only,
      via direct dispatch in `ReportStockPage.tsx`)
- [ ] ❌ Current Stock redesign — table + expandable sub-rows + color field
      in add dialog (TASK-03)
- [ ] ❌ `stock_movements.movement_type` needs a `PURCHASE` value added
- [ ] ⚠️ Product Ledger — exists as tabs, needs date/vendor/article/category
      filters (TASK-02 / TASK-02 UPDATE)

### Reports
- [x] ✅ Account Ledger (Khaata) — computed client-side from arrays, no
      persisted ledger table used yet
- [ ] ❌ Account Ledger redesign: Inv#/Bill#, cheque narration sub-columns,
      Commission row (TASK-16)
- [ ] ⚠️ Cash Book — exists but reads receipts only, never expenses; needs
      full redesign with opening cash / Jamma / Naam / cash-in-hand (TASK-15)
- [ ] ❌ Sale Analysis (TASK-09)
- [ ] ❌ Sale Report (TASK-18) — blocked on resolving the Commission
      definition contradiction (gap #3)
- [ ] ❌ Vendor Report + grouped summary (TASK-10 / TASK-10 UPDATE) — blocked
      on Purchase + Purchase Return + vendor payments existing first
- [ ] ❌ Payment Trail (TASK-17)
- [ ] ❌ Unified tabbed Reports sidebar section (TASK-19)
- [ ] ❌ Export as PDF/Excel everywhere Print exists (TASK-04)
- [ ] ⚠️ `BiltyUpdatePage.tsx` — fully built but orphaned, just needs a nav
      entry (confirm still wanted before touching)

### New: Alerts & cheque endorsement (this conversation)
- [ ] ❌ §12 Cheque due / payment overdue alerts — schema, endpoint, bell UI
- [ ] ❌ §13 Cheque endorsement / pass-through payments — `cheque_allocations`
      table, disposition UI, bounced-cheque reversal cascade
- [ ] ❌ Client decisions needed first: credit-period source (global vs.
      per-customer), Cash Book visibility of endorsed cheques, Commission
      polarity and TASK-18 vs. clarification-section contradiction, regions
      table vs. reusing cities
