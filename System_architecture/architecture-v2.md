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

**RESOLVED (client-confirmed):** Discount and Commission are different
things. Discount is applied at sale time (D%/Invoice Discount) and already
reduces `Total Sales Amount`. Commission is recorded only at payment time in
Receipts and is separate. TASK-18's own table (line 392) describes Commission
using the discount definition, but the doc's own later "COMMISSION —
Clarification" section explicitly overrides this and names TASK-18 directly:
*"Sale Report (TASK-18) — commission column = total commission given during
payments NOT sale discounts"* (line 457). So Sale Report's Commission column
= sum of Commission recorded on Receipts in that date range, not sale-time
discounts. Discounts are not double-counted as a separate report line.

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

1. ~~**Purchase Return has no defined page/flow.**~~ — **RESOLVED**: gets its
   own dedicated page, mirroring Sale Return exactly — own table
   (`purchase_returns`/`purchase_return_items`), reduces stock back down,
   feeds Vendor Report's "Purchase Return" column.
2. ~~**"Payment Paid" to vendors has no defined page.**~~ — **RESOLVED**:
   vendor payments are **Expense entries** where the selected account's
   parent group is "Vendors" — no new transaction page needed, Expenses
   already covers this. Client-confirmed: a vendor is a **single source of
   truth** shared by Purchase and Expense/payment — creating a Vendor in
   Setup must auto-create/link a `business_accounts` row under a "Vendors"
   `group_accounts` group, so `vendors.vendor_id` (used by Purchase) and that
   linked `business_accounts.ba_id` (used by Expenses) resolve to the same
   real-world vendor. Requires: a new `vendors.ba_id` FK (nullable →
   `business_accounts`, backfilled on vendor create), a reserved "Vendors"
   `group_accounts` row, and Vendor Report joining Purchase totals (via
   `vendor_id`) with Expense/payment totals (via the linked `ba_id`) for the
   same vendor. **RESOLVED**: creating a Vendor in Setup auto-creates its
   linked `business_accounts` row under the "Vendors" group — single form,
   no separate account-setup step exposed to the user.
3. ~~**Commission contradiction inside new_features.md itself**~~ — **RESOLVED**:
   Commission = payment-time only (Receipts), separate from sale-time
   Discount. Sale Report's Commission column sums Receipts-side commission,
   not sale-time discounts. See §7.
4. ~~**Commission row polarity**~~ — **RESOLVED**: Commission is a **credit**
   row, same side as the payment — it reduces payable, functioning like a
   discount but applied at payment time instead of sale time. Client wants
   the ledger/receipt display to show **both** figures explicitly: the
   original amount owed (bill amount, unchanged) and the amount owed after
   commission is applied — not just a net balance, so the user can see the
   before/after at a glance (e.g. "Amount Due: 1,020,000 → After Commission:
   1,000,000").
5. ~~**`stock_movements.movement_type` has no PURCHASE value**~~ —
   **RESOLVED**: add both `PURCHASE` and `PURCHASE_RETURN` enum values
   (mirroring `SALE`/`SALE_RETURN`) — one migration, before Purchase/Purchase
   Return pages are built.
6. ~~**Regions as a lookup**~~ — **RESOLVED**: new dedicated `regions` table
   (independent of `cities`). Customer identification hierarchy is
   **Region first, then City** — `customers` needs both `region_id` (FK →
   new `regions`) and `city_id`/city reference, with Region as the primary
   search/grouping key and City secondary (matches the existing Key Rule
   "Customer search: Primary = Region, Secondary = City").
7. ~~**`BiltyUpdatePage.tsx` is fully built but orphaned**~~ — **RESOLVED**:
   still wanted as-is (client-confirmed). Just needs a nav entry added under
   Reports ("Search & Bilty Adda Updation", matching the old architecture.md
   page map) — no rework needed.
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
- **RESOLVED**: no global credit-period setting. Instead, an **optional
  payable due-date field** entered per transaction — `sale_bills.due_date`
  (customer side) and the equivalent on vendor payables (Purchase /
  Expense-as-vendor-payment) — user may leave it blank. If set, it feeds the
  Payment Overdue alert once the date passes; if left blank, that
  bill/purchase never generates a payment-overdue alert (no fallback
  default). Cheque due-date alerts (from `receipts.cheque_date`) are
  unconditional — always generated, not optional, independent of this field.
- New table `alert_dismissals`: `id, alert_key, dismissed_at, dismissed_until`
  — lets a user snooze/dismiss a derived alert without deleting underlying data.

### Backend
- New `GET /api/notifications` endpoint, computed on request (not stored):
  - **Cheque due/overdue**: `receipts` where `payment_mode = 'CHEQUE'` and
    `cheque_status IN ('PENDING','PARTIALLY_ENDORSED')`, `cheque_date` within
    next N days (amber) or already past (red).
  - **Payment overdue**: sale bills / vendor payables where an explicit
    `due_date` was entered and has passed, and the balance is still positive.
    Records with no `due_date` set never appear here.
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
- **RESOLVED (client-confirmed)**: treat it as real cash flow, not an
  off-books transfer. The cheque receipt already counts as a Jamma
  (in-flow) on the day it's received. When later endorsed to a vendor/
  expense, that allocation counts as a Naam (out-flow) in Cash Book **on the
  day of the endorsement** — i.e. both legs hit Cash Book's daily in/out
  totals on their own respective dates, same as if the cheque had been
  deposited and a separate cash/bank payment made to the vendor. No special
  "excluded from totals" treatment — `cheque_allocations` rows feed Cash
  Book's outflow side directly via `disposition_type IN ('VENDOR_PAYMENT',
  'EXPENSE_PAYMENT')`, dated by `allocation_date`.

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
- [ ] ❌ `stock_movements.movement_type` needs `PURCHASE` and
      `PURCHASE_RETURN` values added
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
- [ ] ❌ Sale Report (TASK-18) — Commission column = payment-time Commission
      only, not sale-time discount (gap #3, resolved)
- [ ] ❌ Vendor Report + grouped summary (TASK-10 / TASK-10 UPDATE) — needs
      Purchase + Purchase Return + vendor payments (Expense-as-vendor,
      linked via `vendors.ba_id`) built first
- [ ] ❌ Payment Trail (TASK-17)
- [ ] ❌ Unified tabbed Reports sidebar section (TASK-19)
- [ ] ❌ Export as PDF/Excel everywhere Print exists (TASK-04)
- [ ] ⚠️ `BiltyUpdatePage.tsx` — kept as-is, just needs a nav entry added
      under Reports

### New: Alerts & cheque endorsement (this conversation)
- [ ] ❌ §12 Cheque due / payment overdue alerts — schema (`due_date` on
      sale bills/vendor payables, cheque fields, `alert_dismissals`),
      endpoint, bell UI
- [ ] ❌ §13 Cheque endorsement / pass-through payments — `cheque_allocations`
      table, disposition UI, Cash Book in/out dating, bounced-cheque
      reversal cascade

**All client decisions from §10 are now resolved** (see §10 for details):
Purchase Return has its own page; vendor payments are Expense entries with
vendor auto-linked to a `business_accounts` row; Commission is payment-time
credit shown alongside the original amount owed; stock enum gets
`PURCHASE`/`PURCHASE_RETURN`; Regions is a new table, checked before City;
`BiltyUpdatePage.tsx` is kept; payable due-dates are optional per-transaction
(no global credit period), cheque due-dates always alert; endorsed cheques
post as real Cash Book in/out entries on their respective dates, not
excluded from totals.

---

## 14. Addendum: Vendor Stock sub-page (post-doc note, not part of original spec) — TBD

**Status: TBD** — noted here for later spec/schema/task-numbering, not yet
turned into a formal TASK-xx or built.

New instruction on top of the STOCK section (§9) — kept here rather than
editing §9 directly so the original spec stays untouched:

- When a **Purchase** (TASK-01) is recorded from a vendor, in addition to
  increasing overall `Current Stock`, it must also be reflected under a new
  **Vendor Stock** sub-page.
- **Location**: `STOCK` → `Vendor Stock`, living alongside `Current Stock`
  and `Product Ledger` as a third sub-page inside the existing Stock page
  (same nav level, not a separate top-level section).
- **Purpose**: shows the current stock broken down **per vendor** — i.e.
  for each vendor, what stock currently on hand originated from purchases
  made from that vendor. This is distinct from `Current Stock` (which shows
  total stock per article, no vendor breakdown) and from `Vendor Report`
  under Reports (§9, TASK-10 — which is purchase/payment totals in Rupees,
  not physical stock quantities).
- Data source: derived from `Purchase` line items (vendor + product + qty)
  net of `Purchase Return` and stock consumed since, same underlying
  `stock_movements`-style ledger already planned for Current Stock (§6),
  just filtered/grouped by `vendor_id` instead of aggregated across all
  vendors.

## 15. Addendum: Home page — nearest-date alerts — TBD

**Status: TBD** — noted here for later spec/schema/task-numbering, not yet
turned into a formal TASK-xx or built.

- On the **HOME** page (§9, TASK-13), add an **alerts** section/widget
  surfacing items sorted by **closest/nearest due date first** — e.g. the
  soonest-due cheque or payable, so the most urgent item is always what the
  user sees first on landing.
- This overlaps with — and should reuse the same underlying data as — the
  Cheque Due & Payment Alerts work already planned in §12 (`due_date` on
  sale bills/vendor payables, cheque fields, `alert_dismissals`, bell UI).
  The difference is *where* it's surfaced: §12 is the bell/notification
  mechanism; this is a dedicated "nearest date" alerts view directly on the
  Home landing page itself.

---

## 16. Account Hierarchy Reference (Group → Chart → Business Accounts)

The accounting side of the app is a strict **3-level hierarchy**. Every
level narrows down to something more specific than the one above it, and
every record at one level belongs to exactly one record at the level above.
This section documents what the hierarchy means and exactly what exists in
each level today (frontend demo data, as of this milestone cycle).

### Level 1 — Group Accounts (the broadest classification)

The top of the tree. Just four fixed categories, matching standard
accounting classes. Nothing else can be added here — every Chart of
Account must belong to one of these four.

| ID | Name | Class |
|---|---|---|
| 1000 | ASSETS | ASSETS |
| 2000 | LIABILITY | LIABILITY |
| 3000 | INCOME | INCOME |
| 4000 | EXPENSES | EXPENSES |

### Level 2 — Chart of Accounts (named ledger categories)

Each Chart of Account belongs to exactly one Group Account (via `groupId`).
These are the categories a bookkeeper would recognize — "Customers,"
"Vendors," "Cash in Hand," etc. — but they are not things you transact
against directly; they're a bucket that Business Accounts live inside.

| ID | Name | Parent Group | Notes |
|---|---|---|---|
| 110001 | CUSTOMERS ACCOUNTS | ASSETS | Holds every Customer's linked account |
| 120001 | CASH IN HAND | ASSETS | Physical cash vault(s) |
| 120002 | BANK ALFALAH AC - 0124 | ASSETS | The literal bank account — source for the "Cash at Banks" figure in Payment Trail (§17 report) |
| 210001 | VENDORS ACCOUNTS | LIABILITY | Holds every Vendor's linked account |
| 310001 | WHOLESALE SHOE SALES | INCOME | Sales revenue |
| 410001 | LABOUR WAGES CHARGES | EXPENSES | Maps to Payment Trail's "Employees" row |
| 420001 | UTILITIES & BILLS EXPENSE | EXPENSES | Maps to Payment Trail's "Business Running Expenses" row |
| 440001 | DIRECTORS EXPENSES - DRAWINGS | EXPENSES | **Added this cycle** — nothing existed for this category before, even though TASK-14 (role restrictions) and TASK-17 (Payment Trail) both name it explicitly |

### Level 3 — Business Accounts (the real, transactable entities)

Each Business Account belongs to exactly one Chart of Account (via
`controlId`). This is the bottom of the hierarchy — the actual thing a user
picks when entering a Sale Bill, Receipt, or Expense.

| ID | Name | Parent Chart Account |
|---|---|---|
| 11000101 | Ahmed Footwear (LHR) | CUSTOMERS ACCOUNTS |
| 11000102 | Karachi Boot House (KHI) | CUSTOMERS ACCOUNTS |
| 11000103 | Malik Traders (HYD) | CUSTOMERS ACCOUNTS |
| 11000104 | Mardan Shoe Mart (MRD) | CUSTOMERS ACCOUNTS |
| 12000101 | Lahore Cash Vault | CASH IN HAND |
| 21000101 | Decent Polyurethane A/C | VENDORS ACCOUNTS |
| 21000102 | Lahore Chemical Industries A/C | VENDORS ACCOUNTS |
| 21000103 | Star Sole Materials A/C | VENDORS ACCOUNTS |
| 44000101 | Director's Drawings A/C | DIRECTORS EXPENSES - DRAWINGS — **added this cycle** alongside its parent chart account |

### How Customer / Vendor tie into this

A Customer and a Vendor are not separate data structures floating outside
this hierarchy — each one **is** a Business Account under the hood, linked
by ID:

- **Customer** ↔ Business Account: `Customer.id === BusinessAccount.id`
  (e.g. `Customer` "Ahmed Footwear (LHR)" and `BusinessAccount` id
  `11000101` are the same record, just accessed two different ways).
- **Vendor** ↔ Business Account: `Vendor.baId → BusinessAccount.id` (a
  separate link field, since Vendor and BusinessAccount use different ID
  spaces — `v1`/`v2`/`v3` vs `21000101` etc. — see §10 gap #2 resolution).

So a full roll-up for a single transaction looks like, e.g.:

```
Sale Bill against "Ahmed Footwear (LHR)"
  → Business Account 11000101 "Ahmed Footwear (LHR)"
    → Chart of Account 110001 "CUSTOMERS ACCOUNTS"
      → Group Account 1000 "ASSETS"

Expense paid to "Decent Polyurethane"
  → Vendor v1 → linked Business Account 21000101 "Decent Polyurethane A/C"
    → Chart of Account 210001 "VENDORS ACCOUNTS"
      → Group Account 2000 "LIABILITY"
```

### Known gap: empty categories

Two Chart of Accounts currently have **zero** Business Accounts under them:

- **410001 LABOUR WAGES CHARGES** ("Employees" in Payment Trail)
- **420001 UTILITIES & BILLS EXPENSE** ("Business Running Expenses" in Payment Trail)

Until someone creates at least one Business Account under each (e.g. an
"Office Utilities A/C" under 420001), those two rows in the Payment Trail
report (§17) will always show zero — there's nowhere yet to attach an
Expense entry that would count toward them. This isn't a bug; it's simply
unpopulated setup data, same category of gap that "Directors Expenses -
Drawings" was in before this cycle.
