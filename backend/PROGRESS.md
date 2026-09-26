# Wentox Backend — Progress Log

**Current milestone:** All of Milestones 1–8 are backend-complete, and Milestone 9.2 (frontend
integration) is now genuinely complete — every page in `frontend/src/pages/`/`components/` calls the
real backend (`ReportsHubPage.tsx` is the one non-data tab-router shell, not a gap). Milestone 8.2/8.3
(accounting hierarchy — Group/Chart/Business Accounts) backend was already complete; its frontend
wiring plus Module 8.1's (Cities/Regions/Stores/Addas) were the last pages still on demo data and are
now connected too (see dated entries below). Milestone 9.3's packaging/installer/auto-SQL-Server-setup
work is extensive and already fully checked off in `milestone9.md` — only three end-to-end
verification checkboxes remain open there (full continuous flow test, unpost/bounce reversal
double-check, A4 print against real data), each already partially exercised piecemeal across many
individual session entries in this log, just never done as one single continuous pass.
**Status:** SQL Server is up and `wentox_db` migrated + seeded. Milestone 1 code-complete and its migrate/seed scripts verified working end-to-end (including live `auth:login`/`requireSession` checks). Milestone 2: **Modules 2.1 and 2.2 both complete and verified end-to-end** (create/post/unpost, ledger + stock direction, drafts, password re-verification guard, and the `status`-column removal / `due_date` addition). Milestone 3: **Modules 3.1 and 3.2 both complete and verified end-to-end** (create with material auto-registration, post/unpost, drafts with zero vendor-stock effect until confirmed, no password guard). Milestone 6: **Modules 6.1, 6.2, and 6.3 all complete and verified end-to-end** (Product Details/`articles`, Categories, Vendors with auto-linked business account). Milestone 7: **Modules 7.2 and 7.3 complete and verified end-to-end** (Customers mirroring Vendors' auto-linked-account pattern, Sub-Customers as a flat independent CRUD per UC-10, later given a required `region_id` for Sale Bill/Return dropdown filtering); **Module 7.1 moved to Milestone 4 Module 4.5** (it was never actually "blocked," `payroll.md` fully designs it). Milestone 8: **all of 8.1/8.2/8.3 complete, backend AND frontend, verified end-to-end** (see dated entries below for the frontend wiring pass — Regions/Cities/Stores/Addas, Group/Chart/Business Accounts, including the reserved-account delete guard and role-based restricted-account hiding). "Reactivate an inactive duplicate-named row instead of rejecting on create()" — implemented across every built entity — vendors (name+phone key), customers/sub-customers (name-only, never blocks on active match), regions/cities/stores/categories/addas (name-only, blocks on active match, matching their existing DB-level `UNIQUE(name)`), and products (name+vendor_id key). See `System_architecture/soft_delete_and_duplicate_check.md`. A real, first-of-its-kind **admin user-management feature** (create additional `USER`-role logins, deactivate/reactivate, admin password reset) was added on top of the original milestone scope — see dated entry below, since UC-03's role-based access had no way to actually create a second login before this.

Log every completed task here (newest first within its milestone). Format:

```
### YYYY-MM-DD — <Task name> (Milestone X, Module X.Y)
- **What:** what was built/changed
- **How:** approach, key decisions, gotchas
- **Files:** paths touched
```

---

## Cheque deposits: allowed to split across more than one bank

### 2026-09-22 — a single cheque's balance can now be deposited into different banks
- **What:** client request — "Cheq should be allowed to split across multiple banks." Previously
  `cheques.service.js#deposit()` rejected a second deposit allocation that named a different bank
  than the cheque's first one ("This cheque is already tied to a different bank — one cheque is
  never split across banks"), because the bank lived once on `dbo.cheques.bank_id`, set on the
  cheque's first-ever deposit. Now each DEPOSIT allocation carries its own `bank_id`.
- **How:** migration 037 adds `cheque_allocations.bank_id` (+ FK to `bank_accounts`), backfills it
  from each existing allocation's cheque (the only bank it could ever have gone to before this),
  and widens `CK_cheque_allocations_target` to require `bank_id` set iff `disposition_type =
  'DEPOSIT'` — mirroring how `target_vendor_id`/`target_ba_id` already work for the other two
  disposition types. `deposit()`'s same-bank guard is removed; the allocation's own `bank_id` is
  inserted every time. `dbo.cheques.bank_id` itself is kept as a "primary bank" display fallback
  (still set on the first-ever deposit only) but is no longer read by any validation or reversal
  logic. The one place this had to get right: **`reverseCheque()`** (bounce/return) resolved a
  DEPOSIT allocation's bank via `cheque.bank_id` — if left alone, every reversed deposit on a split
  cheque would credit back whichever bank got deposited into FIRST, not the bank that allocation
  actually went to. Fixed to read `allocation.bank_id` instead (available via `reverseAllocations()`,
  which already does `SELECT *`). `reports.repository.js#cashBookChequeDeposits()`'s Cash Book row
  and `listAllocations()` (feeds the Cheques tab's history + `ChequeLedgerContent.tsx`) both updated
  to join the allocation's own bank rather than the cheque's. Frontend: `ChequesTab.tsx`'s allocation
  history now reads "Bank deposit — Meezan Bank" per row instead of a bare "Bank deposit";
  `ChequeLedgerContent.tsx` reads each row's own bank instead of always the cheque's first one.
- **Tested:** `backend/test/cheques.splitDeposit.test.js` — split-deposit succeeds across two banks,
  and (the sharp case) a bounce on a split cheque reverses each deposit against its OWN bank, not
  always the first. Negative-control run confirmed: reverting the `reverseCheque()` fix alone made
  the bounce-reversal test fail with the exact "wrong bank" assertion, restored → passes. Full
  backend suite 21/21. Also live-verified in the running Electron app (Playwright `_electron`):
  deposited a real 150,000 cheque as 90,000 into Meezan Bank then 60,000 into HBL Bank with no
  rejection, and the Cheque Ledger correctly showed two distinct-bank rows instead of one bank
  repeated on both.
- **Files:** `backend/src/db/migrations/037_cheque_allocation_bank_split.sql` (new),
  `backend/src/repositories/cheques.repository.js`, `backend/src/services/cheques.service.js`,
  `backend/src/repositories/reports.repository.js`, `backend/test/cheques.splitDeposit.test.js`
  (new), `frontend/src/lib/api.ts`, `frontend/src/components/ChequesTab.tsx`,
  `frontend/src/pages/ChequeLedgerContent.tsx`.

### 2026-09-22 — INCIDENT: migration 037 broke every cheque deposit for the client the day it shipped
- **What:** hours after v1.6.7 shipped, the client hit "Internal error" on a plain, non-split cheque
  deposit — not the split-bank feature at all, EVERY deposit was broken. Root cause: migration 037's
  new `CK_cheque_allocations_target` constraint was added as trusted (validates existing rows), and
  it required `bank_id IS NOT NULL` for every DEPOSIT allocation. The backfill step that sets
  `bank_id` from each allocation's cheque only fills rows where the cheque's OWN `bank_id` is also
  non-null — real production data had at least one older DEPOSIT allocation whose cheque never had a
  `bank_id` set (root cause of *that* not traced; treat production data as always messier than any
  dev/test DB). That left one row's `bank_id` NULL after backfill, the CHECK-ADD then failed
  validating it, the whole migration transaction rolled back, `cheque_allocations.bank_id` never
  actually got created on the client's DB — while the already-downloaded new app code unconditionally
  wrote `bank_id` into every `INSERT`, so literally every deposit failed with SQL 207 ("Invalid
  column name 'bank_id'"), sanitized to a bare "Internal error" by `wrap.js`. A later-numbered
  migration could NOT have fixed this: `migrate()` throws out of its whole loop on the first failure,
  so 037 failing on every retry would have permanently blocked 038+ from ever running too — the fix
  had to go into 037 itself.
- **Fix:** both `ADD CONSTRAINT` statements in migration 037 (the FK and the CHECK) now use `WITH
  NOCHECK` — the constraint is still created and still fully enforced on every row inserted or
  updated from that point on (confirmed: a fresh invalid INSERT is still rejected), it just doesn't
  retroactively validate rows that existed before the migration ran. Reproduced the exact failure
  first (reverted the test DB to pre-037, manually inserted a DEPOSIT allocation with a NULL-bank_id
  cheque exactly like the suspected production shape, re-ran the unmodified migration, got the
  identical SQL 207 chain), then confirmed the `WITH NOCHECK` version applies cleanly over that same
  broken data while still protecting all new writes. Full suite still 21/21 after.
- **Lesson for future migrations:** any `ADD CONSTRAINT` on a table with real production history
  should default to `WITH NOCHECK` unless there's a specific reason to require the whole table to
  already comply — a dev/test DB's data can never be trusted to represent the shape of years of real
  production data, and a strict constraint add is an all-or-nothing gate that can permanently block
  every later migration behind it, not just fail gracefully.
- **Files:** `backend/src/db/migrations/037_cheque_allocation_bank_split.sql` (edited in place — see
  note above on why a later migration couldn't substitute).

---

## Online-payment counter-party narration + toolbar/New-button consistency pass

### 2026-09-22 — Receipt/Expense ONLINE narration now names the actual counter-party
- **What:** live client-reported bug — a Receipt paid ONLINE straight into a vendor's account
  (`payload.online_ba_id`, migrations 028/029) showed a bare "Bank Transfer" on both the customer's
  and the vendor's ledger, naming neither side. Fixed for both Receipts and Expenses: each ledger
  now reads e.g. `Bank Transfer — to Acme Vendor` / `Bank Transfer — from Acme Customer`.
- **How:** `reports.repository.js` joins `business_accounts` on `online_ba_id` for both receipts
  and expenses and selects the counter-party's name plus the source `ba_id`. `reports.service.js`
  adds `namedOnlineCounterparty()`, applied only when `payment_mode==='ONLINE' && online_ba_id` is
  set — a plain ONLINE payment into a generic bank account (no `online_ba_id`) is unaffected, per
  the pre-existing 2026-09-18 "counter account name is noise" rule, which only holds when the
  counter side really is always the same generic bank. `formatLedgerRow()` now takes `viewedBaId` to
  know which side is being displayed. Verified with a negative-control run (temporarily neutered the
  new helper, confirmed 2 of 3 new tests correctly failed, restored, confirmed all pass) plus a full
  `npm test` run (19/19) before and after.
- **Files:** `backend/src/repositories/reports.repository.js`, `backend/src/services/reports.service.js`,
  `backend/test/reports.onlineCounterparty.test.js` (new), `backend/testlib/cleanup.js` (added
  `expenseId` support).

### 2026-09-22 — Receipts/Expenses row actions unified onto shared `RowActions`
- **What:** Receipts and Expenses pages' inline Edit/Delete row icons replaced with the shared
  `RowActions` component already used elsewhere, per the user's request to consolidate the toolbar
  ecosystem into shared components. Wage Run/Salary Run/Transfer deliberately left out of scope for
  now (user chose to defer those).
- **Files:** `frontend/src/components/RowActions.tsx` (added optional `editDisabledTitle`/
  `deleteDisabledTitle`, backward compatible), `frontend/src/pages/ReceiptsPage.tsx`,
  `frontend/src/pages/ExpensesPage.tsx`.

### 2026-09-22 — New button: Detail-scope now adds a line to the same voucher, not a full reset
- **What:** across all 8 data-entry pages (Sale Bill, Sale Return, Purchase, Purchase Return,
  Journal Voucher, Stock Voucher, Receipts, Expenses): after unposting a voucher, if the edit-scope
  radio is on **Detail** and the user clicks **New**, the app now clears just the entry row and
  refocuses the first entry field on the *same* voucher — no need to click Edit first. **Master**
  scope's New is unchanged (full reset). Confirmed with the user this should be uniform across all 8
  pages the same way.
- **Files:** `frontend/src/pages/{SaleBillPage,SaleReturnPage,PurchasePage,PurchaseReturnPage,
  JournalVoucherPage,StockVoucherPage,ReceiptsPage,ExpensesPage}.tsx` — new branch at the top of each
  page's `handleNew()`/`startNewVoucher()`.

### 2026-09-22 — Two small verified bugs from the "post-Done, buttons should un-grey" audit
- **What:** (1) Receipts: clicking a voucher's row-level Done triggered the browser's native "Please
  fill out this field" popup on the empty re-armed entry strip instead of the app's own flash
  message — `<form id="receipt-entry-form">` was missing `noValidate` that every sibling page's
  equivalent form already has. (2) Settings page showed a hardcoded fake `v1.0.4 (Stable)` badge
  instead of the real installed version, and the auto-update check only ran after a manual button
  click — now runs automatically on opening the Updates tab, and the badge shows "Checking…" until
  the real version resolves, never a fallback fake number.
- **Files:** `frontend/src/pages/ReceiptsPage.tsx` (`noValidate`; also fixed Save/Done toolbar
  buttons staying enabled after a row is deleted — `disabled: isViewMode || deletedPlaceholder !=
  null`), `frontend/src/pages/SettingsPage.tsx`.

---

## Receipts Post/Unpost UI-wiring regression test (Top 8 #4)

### 2026-09-20 — static source check that Post/Unpost are actually wired to a button
- **What:** `frontend/src/pages/ReceiptsPage.wiring.test.ts` — targets the 2026-08-09 bug where
  `receipts:post`/`receipts:unpost` existed correctly on both the backend and `lib/api.ts`, but
  `ReceiptsPage.tsx` never called either — every receipt entered through the UI silently stayed a
  DRAFT forever, invisible to any balance or report, found only via a user reporting a payment that
  never updated a balance. A backend-only test can never catch this class of bug since the backend
  was correct the whole time; the gap was purely "is the button actually wired to anything."
- **Decision:** asked the user how to cover it, same fork as the Journal Voucher test — full
  component-render test (heavy, and `ReceiptsPage.tsx` is another file with the in-progress
  toolbar/`DocumentToolbar`/`RowActions` refactor sitting uncommitted) vs. a lightweight static
  check vs. skip. Chose the lightweight static check.
- **How:** reads `ReceiptsPage.tsx`'s own source via Vite's `?raw` import (not Node's `fs` — keeps
  the test inside the same browser-context tsconfig as the rest of `src/`, no Node type deps
  needed) and asserts three things together: `handlePost`/`handleUnpost` are defined, they call the
  *actual* current API functions (`api.receipts.post`/`api.settlements.post` for post;
  `api.receipts.unconfirm`/`api.settlements.unpost` for unpost — a regular receipt unposts via
  `unconfirm()`, moving it back to a draft, not a plain status-flip `unpost()`, so the test pins the
  real call rather than a guessed generic name), AND that each handler is genuinely referenced as
  `onClick={handlePost}`/`onClick={handleUnpost}` somewhere in the JSX — that last check is what
  actually catches "defined but never wired to a button," the real shape of the 2026-08-09 bug.
- **Verified it's real**: temporarily stripped `onClick={handlePost}` from the Post button
  (reproducing the exact bug), confirmed the test failed, restored the file, confirmed a byte-for-
  byte identical restore (`diff` clean) and all 11 tests (this file + `journalVoucherMath.test.ts`)
  passing again. `tsc -b --noEmit` clean.
- **Files:** `frontend/src/pages/ReceiptsPage.wiring.test.ts` (new)

---

## Sale Bill posting regression suite (Top 8 #2 — highest blast radius)

### 2026-09-20 — create/post/unpost/edit-while-posted regression suite + two harness fixes
- **What:** `backend/test/saleBills.posting.test.js` — 5 tests covering the single most-broken area
  in `PROGRESS.md`'s history: create (reserves stock immediately, no ledger yet), post (writes a
  balanced ledger pair with `pairs` populated on both legs — re-covers the 2026-09-20 bug from a
  full lifecycle angle), unpost (removes the ledger pair, leaves the stock reservation untouched),
  and editing an already-posted bill (reconciles BOTH ledger and stock to the new totals, old rows
  replaced not left alongside the new ones).
- **Fixtures:** `backend/testlib/fixtures.js` — real service calls (region/store/category/product/
  variant-with-real-stock/customer), not mocks or raw INSERTs, so a variant's on-hand stock comes
  from an actual `stock.service.js#logProduction()` PRODUCTION movement the same way a real one
  would. `setupSaleFixtures(t, opts)` centralizes the whole arrange step AND registers cleanup
  against `t` (the TestContext) before anything is created, mutating a tracker object as each piece
  succeeds — see below for why.
- **Two real bugs found and fixed in the test harness itself, before this suite could be trusted:**
  1. Running the whole suite together (not just this file in isolation) hit a genuine race: Node's
     `--test` runs test FILES concurrently by default, and two files simultaneously creating
     business accounts collided on `businessAccounts.repository.js#nextSerial()`'s
     `SELECT MAX(existing_serial)+1` (no locking) — a `UNIQUE KEY` violation on
     `business_accounts.code`. Fixed by adding `--test-concurrency=1` to `npm test`; integration
     tests sharing one live database shouldn't run as separate concurrent processes regardless of
     whether the underlying allocation is race-safe. (Worth its own coverage later — tracked as a
     separate `system_no`-style allocation-race task, since this is the same *shape* of bug in a
     different function.)
  2. `test/helpers/*.js` were being silently picked up and run as their own trivial "passing tests"
     — Node's default test-file discovery includes `**/test/**/*.js` (any `.js` under a directory
     literally named `test`, recursively), which matched the helpers despite them having no `test()`
     calls at all. Fixed by moving them to `backend/testlib/` (a sibling of `test/`, not nested
     inside it) — `testlib` doesn't match the pattern's literal `test` path segment.
  3. Found via the race above: a **fixed-object** `t.after()` (registered only after every fixture
     already succeeded) leaves anything created before a mid-setup throw permanently orphaned — the
     race's own failure left exactly one orphaned region behind, cleaned up manually. Refactored
     both this suite and `businessAccounts.openingBalance.test.js` to register `t.after()` against a
     **mutable tracker object** before creating anything, mutating it as each fixture succeeds.
     Verified directly: ran a throwaway test that calls `setupSaleFixtures()` then immediately
     throws — confirmed every fixture it had created was still cleaned up (Node's test runner runs
     `after` hooks even when the test body itself fails).
- **Verified:** ran the full suite (`businessAccounts.openingBalance.test.js` +
  `saleBills.posting.test.js`, 6 tests) 3× back to back — all pass, zero residual rows in
  `ledger_entries`/`stock_movements`/`sale_bills`/`customers`/`article_colors`/`articles`/
  `product_categories`/`regions` each time (the one persistent `stores` row is the seeded default
  "Main Store", not test residue).
- **Files:** `backend/test/saleBills.posting.test.js` (new), `backend/testlib/fixtures.js` (new,
  moved from `backend/test/helpers/`), `backend/testlib/cleanup.js` (new, moved),
  `backend/test/businessAccounts.openingBalance.test.js`, `backend/package.json`

---

## Cross-page Posted/Unposted reset-on-reopen regression test (Top 8 #6 — G-06)

### 2026-09-20 — one test per page for a bug that was copy-pasted 6 times
- **What:** `frontend/src/pages/postedFilterReset.wiring.test.ts` — 6 tests, one per document page
  (SaleBillPage, SaleReturnPage, PurchasePage, PurchaseReturnPage, JournalVoucherPage,
  StockVoucherPage), targeting G-06 (2026-09-15, logged in `PROGRESS.md` as a "severe bug"):
  opening a new window could show a POSTED document's data while the Posted/Unposted filter still
  defaulted to "Unposted" — the reset-on-reopen check was originally gated on `mode === 'view'`,
  which missed the `mode === 'edit'` case (reachable via an edit-on-a-posted-record flow, e.g.
  SaleBillPage's own bilty/adda-on-a-posted-bill edit). Fixed across all 6 pages by gating on each
  page's own persisted "is this actually a posted record" flag instead of `mode` — since only
  `handleNew()` ever clears that flag, it can never be true while there's genuine unsaved work.
- **Why one test per page, not one shared test**: this was one bug copy-pasted into 6 separate
  `useEffect` blocks, each with its own locally-named flag (`currentBillIsPosted`,
  `currentReturnIsPosted`, `currentIsPosted` ×2, `isPosted` ×2) — a regression in any single page's
  own copy would not be caught by testing another page, so each of the 6 gets its own assertion
  pinned to its actual current flag name (read from the real source, not guessed).
- **How:** static source check via Vite's `?raw` imports (same approach as
  `ReceiptsPage.wiring.test.ts` — these are large, heavily integrated pages, several mid-refactor
  when this was written) asserting the reset callback is gated on `data.length === 0 && <that
  page's actual flag>`, never `mode === 'view'` alone.
- **Verified it's real**: temporarily reverted `SaleBillPage.tsx`'s check back to the original buggy
  `mode === 'view'` form, confirmed the test failed, restored the file (byte-for-byte diff clean),
  confirmed all 17 frontend tests (3 files) pass again. `tsc -b --noEmit` clean.
- **Files:** `frontend/src/pages/postedFilterReset.wiring.test.ts` (new)
- **This closes out all 6 tracked follow-up items from `testing_priority_plan.md`'s Top 8** (Sale
  Bill/Return posting, Cheques disposal, Receipts wiring, Report posted-only filters + a live
  Payment Trail fix, the allocation-race fix, and this cross-page reset test) — 22 tests total
  across backend (`node --test`) and frontend (`vitest`), plus the standalone
  `check-ipc-bridge.js` structural gate wired into every release.

---

## Allocation-race fix: 4 repositories' code generation, a live and easily-reproduced bug (Top 8 #2 revised)

### 2026-09-20 — sp_getapplock serialization for businessAccounts/chartAccounts/groupAccounts/products code allocation
- **What:** this task started as "test the `system_no` allocation race" per the original testing
  plan, but investigation found that risk no longer exists — the document `system_no` columns
  (sale bill/return, purchase/return, journal voucher) already moved to real SQL Server `SEQUENCE`
  objects (migrations 031/035), which are atomic by the engine's own guarantee. The ACTUAL live
  race was elsewhere: `businessAccounts.repository.js`, `chartAccounts.repository.js`,
  `groupAccounts.repository.js`, and `products.repository.js` (`nextCode`/`nextBatchNo`) each
  allocate their own code via a plain "SELECT MAX(existing)+1, then INSERT" with no locking — the
  same shape of bug the document numbers used to have, just never migrated off it.
- **Proved it live before touching anything**: fired 8 concurrent `customersService.create()` calls
  against the same reserved chart account — 6 of 8 failed with a raw `UNIQUE KEY` constraint
  violation, only 2 succeeded. This is easily triggered in the real app: two windows/users creating
  a customer/vendor/product around the same moment.
- **Fix:** added `pool.js#acquireAppLock(transaction, resourceName)` — wraps `sp_getapplock` with
  `@LockOwner = 'Transaction'` (auto-released at commit/rollback, no explicit release needed) —
  and called it at the top of all 4 repositories' serial/code functions, each scoped to the right
  parent key so unrelated concurrent creates never serialize against each other for no reason
  (`business_account_serial:<chartCode>`, `chart_account_serial:<groupCode>`,
  `group_account_serial:<classDigit>`, `article_code` (global), `article_batch_no:<vendorId>`).
  Did NOT convert these to `SEQUENCE` objects like `system_no` — a `SEQUENCE` is a fixed, statically
  named object, a poor fit for codes scoped per parent (per chart code, per class digit, per
  vendor) rather than one fixed counter.
- **Verified thoroughly**: re-ran the exact 8-concurrent-create reproduction post-fix — 8/8
  succeeded, all codes unique — for both business accounts and products. Then proved the fix
  actually matters, not just coincidentally working: temporarily disabled the lock call, reproduced
  the failure again (7/8 failed) via both an ad hoc script AND the checked-in test file directly,
  restored the fix (byte-for-byte diff clean both times), confirmed all 16 tests pass again. Ran the
  full suite 3× back to back with a stable, unchanged baseline in every relevant table (no residue).
- **Files:** `backend/test/allocationRace.test.js` (new, 4 tests — business accounts, products,
  chart accounts, group accounts), `backend/src/db/pool.js` (`acquireAppLock`),
  `backend/src/repositories/businessAccounts.repository.js`,
  `backend/src/repositories/chartAccounts.repository.js`,
  `backend/src/repositories/groupAccounts.repository.js`, `backend/src/repositories/products.repository.js`

---

## Report posted-only filter regression suite + a live Payment Trail bug found and fixed (Top 8 #8)

### 2026-09-20 — Sale Analysis/Vendor Report regression tests + Payment Trail settlements gap fixed
- **What:** `backend/test/reports.postedOnly.test.js` — 3 tests guarding the "forgot the
  posted-only filter" bug class (independently reintroduced 3+ times across Sale Analysis/Sale
  Report/Vendor Report per `PROGRESS.md`'s history): an unposted Sale Bill must not inflate Sale
  Analysis's Total Sales; an unposted Purchase must not inflate Vendor Report's Total Purchase;
  both correctly appear once posted.
- **Live bug found and fixed, not just historical**: while researching this, found that
  `reports.repository.js#paymentTrailRows()` (Payment Trail, UC-34) only ever queried
  `dbo.expenses` — but `settlements.service.js#create()` lets a Direct Settlement's `to_ba_id` be
  ANY business account (vendor, employee wages, expense head, no restriction), which is reachable
  through the standalone Direct Settlement screen right now, not gated behind some not-yet-built
  UI. Since `vendorReportRows()` already correctly folds settlements into a vendor's "Payment
  Paid", this meant **Vendor Report and Payment Trail could already disagree over the exact same
  real settlement today** — confirmed with the user this was worth fixing immediately rather than
  just documenting. Fixed `paymentTrailRows()` to `UNION ALL` expenses and settlements
  (`to_ba_id`) before grouping by chart-account code, mirroring `vendorReportRows()`'s own pattern.
  Added a third test proving a settlement paid straight to a vendor now counts in Payment Trail's
  "Vendors - Suppliers" bucket, and that a DRAFT (unposted) settlement still doesn't.
- **Verified real, not trivial**: for the Payment Trail fix specifically, temporarily reverted
  `paymentTrailRows()` to its old expenses-only query, confirmed the new test failed
  ("0 !== 1500"), restored the fix (byte-for-byte diff clean), confirmed all 12 tests pass.
- **Fixtures/cleanup**: extended `testlib/cleanup.js` with `purchaseId` (+ `vendor_stock_movements`
  cleanup) and `settlementId` cases. Found and fixed a real small leak in the test itself along the
  way: `materialsRepository.resolveOrCreate()` creates a genuinely new `materials` row per unique
  name, and nothing was cleaning those up — added a `materialIds` cleanup case; confirmed zero
  residue across repeated runs afterward.
- **Files:** `backend/test/reports.postedOnly.test.js` (new), `backend/src/repositories/reports.repository.js`
  (`paymentTrailRows()` fix), `backend/testlib/cleanup.js`

---

## Cheques disposal state machine regression suite (Top 8 #3/#4 — most bug-dense module)

### 2026-09-20 — deposit/endorse/bounce/reverseAllocation regression suite
- **What:** `backend/test/cheques.disposal.test.js` — 5 tests covering `cheques.service.js`'s
  disposal state machine, the most bug-dense module in `PROGRESS.md`'s whole history (4 distinct
  real bugs against it). Covers: `deposit()` writes a balanced Dr bank/Cr Cheques In Hand pair and
  marks the cheque DEPOSITED; `endorseToVendor()` writes Dr vendor/Cr Cheques In Hand; `bounce()`
  reverses both the deposit allocation AND the original receipt via new balanced entries (never
  deleting/rewriting), keeps the global trial balance at zero, and never flips the receipt back to
  DRAFT; `reverseAllocation()` undoes one partial endorsement only, freeing the cheque's balance
  back to PENDING without touching the receipt or any other allocation.
- **Fixtures:** extended `testlib/fixtures.js`/`cleanup.js` with `makeVendor()`, `makeBank()`, and
  `setupChequeFixtures(t)` (customer + bank + vendor, same up-front-registered-cleanup shape as
  `setupSaleFixtures`); `cleanupFixtures()` gained a `receiptId` case handling the receipts↔cheques
  circular FK (null out `receipts.cheque_id` before deleting the `cheques` row, matching
  `receipts.service.js#remove()`'s own documented order) plus `vendorId`/`bankId` cases.
- **Verified it's real, not trivially passing**: temporarily removed the `insertLedgerEntries` call
  from `deposit()` (reproducing the exact 2026-08-10 bug this module's own comments describe),
  confirmed the deposit test failed with a clear message ("0 !== 2"), restored the original code,
  confirmed all 9 tests (this suite + the two from before) pass again. Ran the full suite 3× back
  to back with zero residual rows in every relevant table (`ledger_entries`, `stock_movements`,
  `receipts`, `cheques`, `cheque_allocations`, `vendors` beyond the seeded system vendor,
  `bank_accounts`, `customers`, `regions`) each time.
- **Files:** `backend/test/cheques.disposal.test.js` (new), `backend/testlib/fixtures.js`,
  `backend/testlib/cleanup.js`

---

## Backend + frontend test infrastructure, first two regression tests

### 2026-09-20 — Trial-balance invariant test (backend) + Journal Voucher sign-mapping test (frontend)
- **What:** first two real automated tests in the repo (previously zero, on either side), targeting
  the two highest-priority items from `System_architecture/testing_priority_plan.md`'s revised
  Top 8: the Journal Voucher debit/credit sign-inversion bug (#1) and the opening-balance
  double-entry bug (#2/#7 combined into one standing invariant).
- **Backend test infra:** `npm run test:setup` provisions a throwaway `wentox_test` database by
  reusing the app's own idempotent `migrate()`/`seed()` — no separate test schema to maintain.
  `npm test` runs `node --test` (Node's built-in runner, zero new dependency) against it. First
  test: `backend/test/businessAccounts.openingBalance.test.js` — asserts the trial balance
  (`SUM(debit) = SUM(credit)` across all of `ledger_entries`) stays zero after a customer is
  created with a nonzero opening balance, and that the OPENING pair is on the correct side.
  **Verified it's a real test, not a trivial pass**: temporarily removed the counter-entry leg from
  `businessAccounts.repository.js#replaceOpeningEntries()` (reproducing the original 2026-08-10
  bug), confirmed the test failed with a clear message, then restored the original code and
  confirmed it passed again. Also ran 3× back to back with a DB query proving zero residual rows —
  the cleanup itself had a bug first try (deleted the `ba_id`-keyed OPENING leg but not the
  `ac_id`-keyed counter leg, leaving one stray row per run), caught and fixed before it could
  quietly poison later test runs.
- **Frontend test infra:** installed `vitest` (matches the existing Vite toolchain, zero config
  needed), added `frontend/vitest.config.ts` (deliberately separate from `vite.config.ts` — no
  React plugin or jsdom needed for pure-logic tests, keeps `npm test` fast; a future component test
  can add those). `npm test` runs `vitest run`.
- **Journal Voucher sign bug**: the actual 2026-09-15 (`ACC-01`) bug lived in
  `JournalVoucherPage.tsx#handleCommitLine`'s inline sign mapping, which isn't a standalone
  function — asked the user how to cover it (extract to a pure function vs. a full component
  render test vs. skip for now); chose extraction. Added `frontend/src/lib/journalVoucherMath.ts`
  (`amountToDebitCredit`/`debitCreditToAmount`, mirroring the backend's existing
  `journalVouchers.math.js` pattern) and `journalVoucherMath.test.ts` (7 cases, including a
  round-trip property test). Wired into `JournalVoucherPage.tsx` at its two call sites
  (`handleCommitLine`, `loadLineIntoEntry`) as a minimal, behavior-preserving substitution — flagged
  to the user first since that file had unrelated in-progress work (the toolbar/`DocumentToolbar`/
  `RowActions` refactor) sitting uncommitted, last touched ~3 hours earlier; confirmed the two edits
  landed cleanly isolated from that work via a targeted diff review. **Verified it's a real test**
  the same way: temporarily re-inverted the sign mapping (reproducing the original bug), confirmed
  3 of 7 cases failed with clear messages, restored the fix, confirmed all 7 pass again.
  `tsc -b --noEmit` clean after the page edit.
- **Files:** `backend/scripts/setup-test-db.js` (new), `backend/test/businessAccounts.openingBalance.test.js`
  (new), `backend/package.json`; `frontend/vitest.config.ts` (new),
  `frontend/src/lib/journalVoucherMath.ts` (new), `frontend/src/lib/journalVoucherMath.test.ts`
  (new), `frontend/src/pages/JournalVoucherPage.tsx`, `frontend/package.json`

---

## IPC bridge wiring check — structural regression gate

### 2026-09-20 — `check:ipc-bridge` script + dead `accounts:tree` feature removed
- **What:** following `System_architecture/testing_priority_plan.md`'s root-cause analysis (the
  client's repeated post-delivery bugs cluster into a few patterns, the biggest being silent
  frontend/backend wiring gaps — Journal Voucher and Direct Settlement both shipped completely
  broken because they were missing from `frontend/src/lib/ipcBridge.ts`'s `FEATURES` allow-list),
  added a standalone script that makes this exact class of bug impossible to ship silently again.
- **How:** `backend/scripts/check-ipc-bridge.js` scans every `src/ipc/*.ipc.js` for
  `ipcMain.handle('<feature>:<action>', ...)` channel prefixes (multi-line-call-aware), converts
  each to camelCase, and diffs against `ipcBridge.ts`'s `FEATURES` array — failing loudly (exit 1)
  on any backend feature with no frontend entry, and warning (non-fatal) on any `FEATURES` entry
  with no matching backend channel. Wired into `npm run dist:win`/`release:win` as the very first
  step, so a release now fails in seconds, before spending build minutes, if this regresses. Added
  as `npm run check:ipc-bridge` for standalone/local use too.
- **First run immediately found a real gap**: `accounts:tree` (Milestone 8's read-only Class→Group→
  Chart→Business hierarchy view) was registered on the backend but never added to `FEATURES` —
  confirmed harmless (not an active bug) because `ChartAcSetupPage.tsx` never actually calls it; it
  composes the same hierarchy client-side from separate `chartAccounts`/`groupAccounts`/
  `businessAccounts` list calls instead. Per the user's decision, deleted the dead feature entirely
  rather than wire up something with zero callers: removed `accounts.ipc.js`,
  `accountsTree.service.js`, `accountsTree.repository.js`, and its registration in
  `src/ipc/index.js`. Confirmed no other reference anywhere in `backend/src` or `frontend/src`.
- **Verified:** `npm run check:ipc-bridge` passes clean (48/48 backend feature prefixes present);
  `node -c` clean on `src/ipc/index.js`.
- **CI:** added `.github/workflows/ipc-bridge-check.yml` (mirrors `nsis-lint.yml`'s pattern — plain
  Node, no deps, runs in seconds) triggered on push to `main`/PRs touching `backend/src/ipc/**` or
  `frontend/src/lib/ipcBridge.ts`, and wired as a second gate job (alongside `nsis-lint`) in
  `release.yml` before the Windows build runs. Verified both workflow YAML files parse and the
  script runs correctly invoked from the repo root, matching how CI calls it.
- **Files:** `backend/scripts/check-ipc-bridge.js` (new), `backend/package.json`,
  `backend/src/ipc/index.js`, `.github/workflows/ipc-bridge-check.yml` (new),
  `.github/workflows/release.yml`; deleted `backend/src/ipc/accounts.ipc.js`,
  `backend/src/services/accountsTree.service.js`, `backend/src/repositories/accountsTree.repository.js`

---

## Search & Bilty Adda Updation — Bill No. editing added

### 2026-09-20 — Manual Bill No. now editable from the same screen as Bilty No./Adda (UC-20)
- **What:** the user asked that "Search & Bilty Adda Updation" (`BiltyUpdatePage.tsx`) also let the
  manual Bill No. be edited/corrected post-save, alongside the existing Bilty No./Adda fields.
- **How:** extended the existing non-financial `updateBiltyInfo` path (allowed on POSTED bills, no
  password guard, never touches ledger/stock) rather than routing through the full financial
  `update()`. Two decisions confirmed with the user first: no new uniqueness check on `bill_no`
  (none exists today anywhere for sale bills, front or back end — adding one only here would be
  inconsistent) and no password guard on posted bills (kept consistent with Bilty No./Adda's
  existing no-password treatment on this same screen). `bill_no` is `NOT NULL` in schema, unlike the
  other two fields, so `updateBiltyInfo()` gained a real validation check it never had before.
  "Selected Bill No." input changed from `readOnly disabled` to a normal editable input
  (disabled only until a row is selected); the row-select auto-focus target moved from the Bilty No.
  input to this one, since it's now the first editable field again.
- **Verified:** live round-trip against the dev DB — updated bill #1's `bill_no`, confirmed the
  change, reverted it back, and confirmed the new empty-`bill_no` validation throws
  `bill_no is required`. `tsc -b` clean on frontend; `node -c` clean on all three backend files.
- **Files:** `backend/src/repositories/saleBills.repository.js`,
  `backend/src/services/saleBills.service.js`, `backend/src/ipc/saleBills.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/BiltyUpdatePage.tsx`

---

## Customer Khaata Ledger — "Pairs" column was blank for Sale Bill / Sale Return rows

### 2026-09-20 — Sale Bill/Return ledger postings never set `ledger_entries.pairs` (Milestone 2, Module 2.1/2.2)
- **What:** the Customer Khaata Ledger's "Pairs" column (already fully built end-to-end: `KhaataRow`
  type, on-screen table, print preview, Excel export) always rendered "-" for Sale Bill and Sale
  Return rows. Purchase/Purchase Return rows were unaffected — those get their pairs display from
  expanded `purchase_items` JSON client-side, a different path.
- **How:** root cause was in the write path, not the read/display path — `ledger_entries.pairs` is a
  real column the repository already selects and inserts (`pairs: { type: sql.Int, value: row.pairs
  ?? null }`), but nothing calling `insertLedgerEntries()` for `SALE_BILL`/`SALE_RETURN` ever passed
  a `pairs` value, so it was always written as `NULL`. Fixed by threading a `pairs` number through
  every ledger-posting call site: `saleBills.service.js#writeLedger()` gained a `pairs` param (its
  callers `update()`/`post()` pass `totals.totalPairs`/`bill.total_pairs`); both
  `saleBills.service.js#postLedgerAndStock()` and `saleReturns.service.js#postLedgerAndStock()` now
  compute `items.reduce((sum, item) => sum + item.pairs, 0)` locally, since every caller of those two
  (including the draft-confirm flows in `draftSaleBills.service.js`/`draftSaleReturns.service.js`)
  already passes an `items`/`lines` array with a `.pairs` field per line. No schema, repository, or
  frontend changes needed — the column and UI already existed correctly.
- **Backfill:** the user asked for historical rows to show pairs too, so migration
  `036_backfill_sale_ledger_pairs.sql` was added — an idempotent `UPDATE ... WHERE pairs IS NULL`
  copying `sale_bills.total_pairs`/`sale_returns.total_pairs` onto both ledger legs of each
  already-posted document. Applied via `npm run migrate` and verified: 54/54 existing SALE_BILL
  ledger rows backfilled (no SALE_RETURN rows existed yet in this database), spot-checked against
  the source bills' `total_pairs` and matched exactly.
- **Files:** `backend/src/services/saleBills.service.js`, `backend/src/services/saleReturns.service.js`,
  `backend/src/db/migrations/036_backfill_sale_ledger_pairs.sql`

---

## Stock Voucher — new document type, replacing the old inline "+ Add Stock" flow (new capability, not in the original milestone scope)

### 2026-08-26 — Stock Voucher: full backend + frontend, same architecture as Journal Voucher
- **What:** a new manual "add stock" document (legacy Journal Entry-style bound-record screen, per
  the user): N lines, each a finished-goods article/color + cartons/pairs, under one Date/Store/
  Remarks header. Replaces the old inline "+ Add Stock" flow on the Current Stock report
  (`ReportStockPage.tsx`), which called `stock:log-production` and recorded every manual addition
  AS production — this is its own document type instead, same architecture as Journal Voucher: one
  table, DRAFT by default, status flips to CONFIRMED only on `post()`.
- **Schema:** new `dbo.stock_vouchers`/`dbo.stock_voucher_lines`, folded directly into
  `database/schema.sql` (no separate numbered migration — the database isn't live with this yet)
  and noted in `System_architecture/database_schema_v4.3.md`'s "folded directly" amendments block.
  `post()` writes one `dbo.stock_movements` row per line (`movement_type='ADJUSTMENT'`, already
  unconstrained-sign — no `CK_stock_movements_type` change needed; `source_type='STOCK_VOUCHER'`,
  `source_id=stock_voucher_id`); `unpost()` deletes those same rows by source_type+source_id, same
  lookup convention `SALE_BILL`/`SALE_RETURN` movements already use. Store is header-only/
  informational, confirmed with the user — `stock_movements` has no `store_id` column and stays
  store-agnostic.
- **Backend:** `stockVouchers.repository.js`/`.service.js`/`.ipc.js`, mirroring
  `journalVouchers.*` layer-for-layer (list/get/create/update/remove/post/unpost/listUnposted/
  postAll, DRAFT-only edit/delete, password-gated remove). Registered in `ipc/index.js` and added
  to `frontend/src/lib/ipcBridge.ts`'s `FEATURES` allow-list.
- **Frontend:** new `StockVoucherPage.tsx` — same icon toolbar (New/Delete/Edit/Done, First/Prev/
  Next/Last, Print/Find, Un Post/Post), Posted/Unposted browse dropdown, Pending Posting sidebar,
  auto system Number preview, and Post/Post-All-resets-to-a-fresh-blank-form convention as
  `JournalVoucherPage.tsx`. Entry strip: Article Code (typable + `SearchModal`) → Product Name
  (auto) → Color (typable + `SearchModal`, with a "+ Add New Color..." sentinel that resolves-or-
  creates the `article_colors` row on the fly, same capability the old "+ Add Stock" flow had) →
  Cartons (typed) → Pairs (auto-computed from packing, disabled). Enter on Cartons commits the line
  and refocuses Article Code for the next one. Removed the old "+ Add Stock" button/column and its
  modal from `ReportStockPage.tsx`'s Current Stock tab entirely (the `logProduction`-based flow) —
  the unrelated Material Stock "reduce" flow (`stock.reduceVendorStock`) was left untouched.
- **Navigation:** added `'stock-voucher'` to `NavPage` (`types/index.ts`), routed in `App.tsx`, and
  listed in `lib/menu.ts` under `2.DATA ENTRY` as `2.24` (no legacy number — fresh addition).
- Full project `npx tsc -b`/`vite build` and `node -c` on every touched backend file pass clean.
- **Files:** `database/schema.sql`, `System_architecture/database_schema_v4.3.md`,
  `backend/src/repositories/stockVouchers.repository.js`,
  `backend/src/services/stockVouchers.service.js`, `backend/src/ipc/stockVouchers.ipc.js`,
  `backend/src/ipc/index.js`, `frontend/src/lib/ipcBridge.ts`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/StockVoucherPage.tsx`, `frontend/src/pages/ReportStockPage.tsx`,
  `frontend/src/types/index.ts`, `frontend/src/App.tsx`, `frontend/src/lib/menu.ts`

## Navigation

### 2026-08-18 — Dropdowns: focus and type, Enter selects and moves on
- **What:** every dropdown in the app used to need a click to open before you could search it, and
  Enter parked the cursor back on the same field. Now focusing a dropdown and simply typing starts the
  search, and Enter takes the match and moves to the next field. 14 native `<select>`s were also
  converted so they behave the same way; 12 deliberately were not.
- **Two things found while reading the code, both of which shaped the fix:**
  1. **The portal defeats the existing Enter rule.** The dropdown panel renders into `document.body`,
     so from its search box `target.closest('form')` is null and AppLayout's app-wide G-01 handler
     ("Enter moves to the next field") returns before it can move anything. That is *why* Enter only
     ever closed the panel. The component has to advance focus itself.
  2. **Not every dropdown was a `SearchableSelect`** — 64 were, but 26 native `<select>`s also
     existed, split between real entry fields and small filters.
- **How:** `lib/fieldNav.ts` now holds the one definition of "the fields of this form" and "move to
  the next one". That logic was private to `AppLayout`; the dropdown needs the identical notion, and a
  second copy inside the component is exactly how the two would have drifted apart later. AppLayout
  was refactored onto it (it had the selector string duplicated twice internally, too).
  `lib/keyboard.ts` holds `isTypeAheadKey` — "is this the user typing, or a control key?". Extracted
  rather than inlined because it is three subtle guards, it is unit-testable on its own, and the
  native-select work needs the same predicate. `key.length === 1` separates printable characters from
  named keys (Tab/Enter/Escape/F1/Shift all report multi-character names); the modifier check keeps
  application shortcuts alive — **without it a focused dropdown would swallow Alt+V and search for
  "v" instead of opening Print Preview (G-09)**.
  In `SearchableSelect`: a printable key on the focused trigger opens the panel and **seeds the search
  with that character**, so the keystroke that opened it is not lost — otherwise the user ends up one
  letter short of what they typed. Space opens with an empty search rather than searching for " ",
  since it is also the conventional open-a-select key. Enter commits and advances; **a mouse click
  commits without advancing**, because a mouse user did not ask to be moved on. Focus is restored to
  the trigger before advancing, both because that is the right resting place if there is no next
  field and because `focusNextField` locates the next field relative to the trigger — it cannot work
  from the search box, which has no enclosing form.
- **Native selects — converted (14):** store on Sale Bill and Sale Return, customer on Sale Return,
  account class on Group Accounts, the region+city pairs in all four quick-add modals (sub-customer
  ×2, customer, vendor), the copy-from-prior-purchase picker on Purchase Return, and the colour picker
  on Current Stock's add-stock modal. The last two were outside the line originally drawn and were
  pulled in on a second look: both are variable-length data-entry lists, which is precisely where
  type-to-search earns its keep.
- **Native selects — left alone (12), on purpose:** filters (cheque status, JV status, adda), the four
  draft loaders, and tiny fixed lists — Cartons/Pairs, SAME/Custom delivery, cheque disposition, and
  the two unit presets. Turning a two-option control into a searchable panel makes it worse, not
  better. Dependent filtering was preserved everywhere: picking a region still narrows its city list.
- **Files:** `frontend/src/lib/fieldNav.ts` (new), `frontend/src/lib/keyboard.ts` (new),
  `frontend/src/components/SearchableSelect.tsx`, `frontend/src/components/AppLayout.tsx`,
  `frontend/src/pages/{SaleBillPage,SaleReturnPage,PurchasePage,PurchaseReturnPage,GroupAcSetupPage,ReportStockPage}.tsx`
- **Verified:** `tsc -b` clean, `npm run build` clean, ESLint at the project baseline (102 before and
  after). `isTypeAheadKey`/`isBlankOpenKey` were esbuild-bundled and **unit-tested against 37
  assertions**: letters, digits, punctuation and accented characters begin a search; 21 named keys fall
  through; Alt+V, Ctrl+C, Ctrl+V and Cmd+A are ignored while Shift+K still types a capital. Counted
  mechanically: SearchableSelect instances 64 → 78, native selects 26 → 12, and each remaining one was
  listed and checked against the keep-it list.
- **Not verified:** the feel of it in the running app — no way to click an Electron window from here.
  `focusNextField` is a verbatim extraction of the logic already powering G-01, so it is not new code,
  but the type-to-search path itself has only been reasoned about and unit-tested at the predicate
  level. Worth checking: that the first typed character reliably lands in the search box, and that
  Enter lands on the field you expect on a line-item grid.
- **Also:** ST-01 (multi-store stock) was planned and approved, then parked when this task arrived.
  Nothing was built, so there is nothing to unwind — the plan stands in this log's own history.


### 2026-08-18 — Reclaiming the sidebar's space: wider list pages, last card grids to rows
- **What:** two follow-ups to removing the sidebar, so the pages actually grow into the ~256px it was
  taking. (1) The wide page-width cap goes from 1400 to 1750. (2) The last six card grids become row
  tables.
- **Why these two and not a redesign:** the question asked was whether to switch cards from vertical
  to horizontal. Checking the tree answered it differently: **19 pages already use row tables**
  (`DataListTable`), and only 6 components still used the 3-column card grid — precisely the Sale Bill
  and Sale Return Weekly/Monthly/Overall tabs. The Receipts and Expenses equivalents had already been
  converted, because the client asked for exactly this in **RJ-05** ("change the display from cards to
  rows — consistent with other pages in the app"). So this is not a new design direction, it is
  finishing one the client already chose on the six screens RJ-05 did not reach. Inventing a third
  "horizontal card" idiom would have left the app in three states instead of one.
- **Width:** 28 occurrences of `maxWidth: 1400` → `1750`. That number was chosen when a 256px sidebar
  was eating the left of the screen; with it gone a 1400 cap left ~260px of dead margin each side at
  1920px. **Deliberately NOT applied to the 1000/1100/1150/1200/1250 caps** (29 more occurrences):
  those are on forms, and a form field stretched to 1750px is harder to read, not easier — the eye
  loses the line. Only the wide list/table tier moved.
- **Cards → rows:** the six tabs now use the same table shape as the already-converted
  `WeeklyReceiptsTab`, so all records screens read alike. A row is ~40px against a 190px card
  three-across, so roughly four times as many customers fit without scrolling. The conversion also
  **recovered data the cards were discarding**: every one of these tabs already computed
  `totalCartons`, `totalPairs` and `totalValue` per customer and displayed none of them — the card had
  room only for a bill count. The row shows all three. Customer code now renders `account_code`
  (C-01) rather than the raw IDENTITY, matching the setup screens.
  Each file kept its own empty-state wording ("No Monthly Records Found", "No Weekly Returns Found",
  …) and its own collection name — the Sale tabs group `data.bills`, the Return tabs `data.returns` —
  rather than being flattened to one generic string.
- **Files:** 28 files for the width change; `frontend/src/components/{Weekly,Monthly,Overall}Tab.tsx`
  and `{Weekly,Monthly,Overall}ReturnTab.tsx` for the conversion
- **Verified:** `tsc -b` clean, `npm run build` clean, ESLint at exactly the project baseline (102
  problems before and after). Counted mechanically: 0 occurrences of `maxWidth: 1400` remain and 28 of
  `1750`; the form-tier caps are untouched at their original counts; **0 card grids remain** in
  `src/pages` or `src/components`. Each converted tab reports a 6-column header row and a matching
  `colSpan={6}` empty state.
- **Not verified:** appearance in the running app. Worth an eye on `TransferPage` in particular — it is
  the one page in the 1400 tier whose wrapper holds a form as well as a list, so it is the most likely
  place a widened container looks stretched.

### 2026-08-18 — Sidebar replaced by the legacy-style menu bar (`ref-pics/`)
- **What:** the left sidebar is gone. Navigation is now five hover menus across the top —
  **1.SETUP · 2.DATA ENTRY · 3.ACCOUNT REPORTS · 4.STOCK REPORTS · 5.SALE REPORTS** — sitting
  directly above the Quick Menu row, reproducing the client's previous software (photographed in
  `ref-pics/`). Pages get the full window width back.
- **Decisions taken with the user:** legacy names AND legacy numbering (`1.1 GROUP ACCOUNTS`,
  `3.16 CASH BOOK SUMMARY`); legacy items this app has no page for are left out rather than shown
  greyed; the sidebar is removed outright and dropdown items become the drag source for pinning.
- **How, and what the numbering means:** the numbers keep their original gaps. The old menu already
  skipped (2.1, 2.3, 2.4, 2.13 — no 2.2), and omitting unbuilt items adds more. That is deliberate:
  staff navigate by "3.16" the way they navigate by name, so a renumbered-but-tidy menu would be
  worse than a gappy faithful one. Pages this app has that the old menu never listed are appended
  inside the matching group with fresh numbers (1.11+, 2.14+, 3.23+) so none collides with a number
  somebody already knows.
  Menu data lives in `frontend/src/lib/menu.ts`, not in the component — exporting `MENU_GROUPS`
  alongside the component tripped `react-refresh/only-export-components`, and `lib/` is already where
  this codebase keeps non-component modules.
  Hover behaviour: opening is immediate, closing is delayed ~180ms so the diagonal pointer path from
  a menu button into its own dropdown doesn't cross dead space and shut it. Click toggles too (hover
  alone is unusable on a touch screen), and both Escape and an outside click close.
  Role filtering is applied inside `MenuBar`, and separators left leading/trailing/doubled by that
  filter are collapsed — otherwise hiding an admin-only item strands a rule at the foot of the menu.
- **Two things that had to move, or they would have been lost with the sidebar:**
  1. **Log out.** The user chip carrying Settings and Log out lived in the sidebar footer. It is now
     in the header, same popup and same two actions. Deleting the sidebar without moving it would
     have removed the only way to log out.
  2. **Pinning.** The Quick Menu was populated by dragging a sidebar nav item onto it. Dropdown items
     are now the drag source, carrying the same `{page, tab, label}` payload, so pinning still works;
     the "+ Pin Page to Bar" button was already independent and is untouched.
- **Also removed as dead:** `toggleSidebar`, the sidebar open/hidden state, the module-level nav
  scroll-position memo, the `.app-sidebar*` CSS rules, and the `wento_sidebar_hidden` localStorage
  writes in `AppContext`'s LOGIN_SUCCESS/LOGOUT (nothing reads that key any more).
- **Files:** `frontend/src/lib/menu.ts` (new), `frontend/src/components/MenuBar.tsx` (new),
  `frontend/src/components/AppLayout.tsx`, `frontend/src/context/AppContext.tsx`,
  `frontend/src/index.css`
- **Verified:** `tsc -b` clean, `npm run build` clean, ESLint back to exactly the project baseline
  (102 problems before and after; both new files are lint-clean). **Coverage checked mechanically
  rather than by eye:** the set of `page:` targets in the old sidebar was diffed against the new menu
  — 32 pages each, **zero orphaned**, so nothing the sidebar could reach became unreachable. The menu
  was then rendered from its real data for both roles: admin-only items (1.14 Bank Accounts,
  1.17 Manage Users, 2.20 Transfer) correctly vanish for a `User`, with no stray separators left.
- **Not verified:** appearance and hover feel in the running app — no way to click an Electron window
  from here. Worth checking: that the dropdown sits correctly over page content, that the ~180ms
  close delay feels right, and that the menu bar doesn't crowd the Quick Menu on a 1366px laptop.
- **Open questions flagged to the user:** 1.2 CONTROL ACCOUNTS is mapped to this app's Chart of
  Accounts page (`database_schema_v4.3.md` records `ac_id` as "was control_id", so chart accounts ARE
  the control level; `project_overview.md` says otherwise — the schema was followed). Legacy 1.3 MAIN
  ACCOUNTS, 2.13 DAY BOOK ENTRY and 5.4 CUSTOMER WISE SALES ANALYSIS are omitted — see `lib/menu.ts`
  for the reason at each site.

## Change requests — `System_architecture/changes-15-08-26.md`

### 2026-08-17 — SB-01: make a silent failure name itself (Change request SB-01)
- **What:** "Save and Post did nothing on one laptop", with no error shown and nothing in any log.
  This does **not** fix that laptop — the cause is still unknown and unreproduced. It makes the class
  of failure that matches the symptom impossible to miss next time.
- **Why this and not a fix:** every failure the API *reports* was already surfaced in the page's
  banner, so a reported error cannot be the explanation. What was NOT covered is a failure that
  **throws**: a rejected promise inside the click handler, or a `TypeError` from reading a property of
  an undefined `window.api.<feature>` — the exact trap `backend/CLAUDE.md` warns about, where a
  channel added without its feature name in `ipcBridge.ts`'s FEATURES array throws instead of
  returning a failed ApiResult. Either unwinds the handler silently, leaving the button genuinely
  looking dead. `ErrorBoundary` (added earlier for CH-02) cannot catch these — it only catches errors
  thrown while rendering.
- **How:** two layers. `main.tsx` registers `unhandledrejection` and `error` listeners that log with
  a `[Wentox]` prefix and show the error on screen in a dismissible banner, asking for a screenshot.
  Built with plain DOM rather than React state deliberately: it has to survive a React tree that is
  already in trouble and must not depend on any component being mounted. Second layer:
  `handleSaveAndPost` on `SaleBillPage` is wrapped in its own try/catch so that specific button also
  reports locally — the body moved to `saveAndPost()` and the handler is now the guard.
- **Files:** `frontend/src/main.tsx`, `frontend/src/pages/SaleBillPage.tsx`
- **Verified:** the diagnostic was extracted and exercised against a DOM stub, since a *broken*
  diagnostic is worse than none. Confirmed: it renders for the exact SB-01 shape (a TypeError from an
  undefined `window.api.saleBills`) and reports it as `TypeError: Cannot read properties of undefined
  (reading 'post')`; an error message containing markup goes through `textContent`, never `innerHTML`,
  so it cannot inject; repeated reports replace rather than stack; the dismiss button is wired.
  **The test found a real weakness and it was fixed:** a non-Error rejection (a plain object, which is
  exactly what a rejected ApiResult looks like) rendered as the useless `"[object Object]"`. It now
  JSON-serialises objects, falling back to `[object Object]` only for circular ones — verified both.
  `tsc -b`, `npm run build` and ESLint all clean, lint identical to baseline (102 problems before and
  after, whole `src` tree).
- **Still open:** SB-01 is recorded as diagnosed-but-unresolved, not done. Closing it needs the actual
  laptop: reproduce the click, and the banner will name the cause.

### 2026-08-17 — RJ-03 / PN-01: the voucher screens (Change requests RJ-03, PN-01)
- **What:** `ReceiptsPage.tsx` and `ExpensesPage.tsx` now drive the voucher model built in the entry
  above. Fill the entry row → **Done** commits it as a line and re-arms the form with the cursor back
  in the first field → repeat → **Post Voucher** posts the lot. A grid of committed lines sits under
  the form with the client's own columns (A/C Code, Account Description, Narration, Cheque No, Type,
  Rs.) and a footer of Total Cash / Cheque / Online plus the voucher total.
- **Scope decided with the user:** only the entry form was rebuilt. The Weekly/Monthly/Overall record
  tabs, the RJ-02 balance tooltip, cheque handling and the RJ-06 password-gated delete all stay as
  they were, and the record lists still show **individual lines**, not grouped vouchers — a voucher is
  an entry convenience; the ledger and every report still read per-receipt.
- **How, and the decisions inside it:**
  **The voucher is created lazily, on the first Done** — not when the page opens. `voucher_no` is the
  client's "C.Book No", allocated MAX+1, so creating one eagerly would burn a number every time
  somebody merely opened the screen and walked away.
  **Date and Remarks are head-level**, matching the client's screen — one Date for the whole voucher.
  Editing either goes through `receipt-vouchers:update`, which carries the change down onto every
  line in the same transaction; both fields lock as soon as anything is posted, because the backend
  refuses the edit then (POSTED_LOCK) and offering the field would be a lie. Remarks persist on blur,
  not per keystroke.
  **Done ≠ Post.** Done is the client's word for committing a line; the line is created DRAFT and has
  no effect on any balance until the voucher is posted. The submit button says so.
  **The cursor is put back explicitly.** The app-wide G-01 auto-focus fires when a form mounts, but
  this form never unmounts between lines — so Done re-focuses the first entry field itself, finding
  it via `button[data-field-nav]`, the same hook G-01's own field walker uses (no ref forwarding
  needed through SearchableSelect).
  **The post-result panel is never auto-hidden**, unlike the ordinary success banner: a voucher can
  post 8 of 10 lines and the two that failed are the entire point of the message.
  **Per-line Edit/Delete are unposted-only** — the backend rejects both on a posted line, so showing
  the buttons would only manufacture an error.
  **Opening a receipt/expense from the records list now opens its whole voucher**, so its sibling
  entries, the totals and Post/Un Post are all on screen — otherwise the user is looking at one line
  of a document with no way to reach the rest of it.
- **Two regressions caught and fixed while doing this:**
  1. An **endorsement is not a voucher line** — it lives in `dbo.settlements`, has no cash/bank leg
     and no `voucher_id`. Replacing the Receipts header's Post/Unpost with voucher-level buttons
     would have left endorsements with no way to post at all. They keep their own badge and their own
     Post/Unpost, shown only when `docKind === 'SETTLEMENT'`.
  2. `ExpensesPage`'s now-dead per-expense `handlePost`/`handleUnpost` also called
     `refreshCheques()`. A CHEQUE_ENDORSED line's allocation against a received cheque changes when
     it posts, so deleting them as-is would have left the endorsement picker offering value that was
     already spent. That refresh moved into the voucher handlers before the dead code went.
- **Files:** `frontend/src/pages/ReceiptsPage.tsx`, `frontend/src/pages/ExpensesPage.tsx`,
  `frontend/src/lib/api.ts` (`ReceiptVoucherRow`, `ExpenseVoucherRow`, `VoucherStatus`,
  `VoucherActionResult`, `voucher_id`/`account_code` on the row types, both bridge blocks and both
  `receiptVouchers`/`expenseVouchers` export objects with date normalisation)
- **Verified:** `tsc -b` clean, `npm run build` clean, and ESLint **identical to baseline across the
  whole `src` tree** — 102 problems before, 102 after (nothing added; the pre-existing ones are
  untouched). Two behaviours that looked risky were checked live against `wentox_db` rather than
  reasoned about: editing a line through `receipts.update` / `expenses.update` **keeps its
  `voucher_id`** (the repositories' `updateHeader` deliberately doesn't touch the column, so a line
  cannot be moved between vouchers by an edit), and `account_code` is populated on voucher lines so
  the grid's A/C Code column is not blank. Both passed; test rows deleted afterwards.
- **Not verified:** the screens have not been driven in the running app — no way to click an Electron
  window from this environment. Everything statically checkable passes and every backend call the
  pages make is individually proven against the live database, but the rendering and the
  Done→Done→Post rhythm need a real run. Specifically worth checking: that the cursor genuinely lands
  back in the account picker after Done, and that the head Date/Remarks lock at the right moment.

### 2026-08-17 — RJ-03 / PN-01: receipt & payment vouchers — database and backend (Change requests RJ-03, PN-01)
- **What:** receipts and expenses were standalone documents, each posted on its own. They are now
  **entry lines under a voucher**: one header (date, C.Book No, remarks) over many lines, each line
  naming its own account, posted with a single action. Backend and schema only — the screens come
  next.
- **Client's actual requirement** (confirmed from a photo of their previous software plus an explicit
  clarification): a day's takings are entered at the END of the day and they are **not one
  customer's** — "records maybe for different customer". So this is a header with **any party per
  row**, not a per-customer grouping. Fill an entry, press Done, it drops into a grid, cursor
  returns ready for the next; Post posts the lot; Un Post reverses. Footer totals per Cash / Cheque
  / Online.
- **How:** migration `022_receipt_and_expense_vouchers.sql` adds `dbo.receipt_vouchers` and
  `dbo.expense_vouchers` plus a `voucher_id` on `receipts`/`expenses`. Three decisions worth
  recording:
  **1. Status is derived, never stored.** Posting is per line (each line keeps its own transaction,
  so one that cannot post never rolls back the lines that already did — the client's explicit
  choice), which means a voucher can legitimately sit half-posted. A stored header status would be a
  second source of truth that is wrong the moment that happens. `deriveStatus()` reads it off the
  lines: none confirmed → UNPOSTED, all → POSTED, otherwise → PARTIAL. An **empty** voucher reads
  UNPOSTED, not POSTED — "every line is confirmed" is vacuously true of no lines.
  **2. The per-line date stays.** The ledger, Cash Book and every report read `receipt_date` /
  `expense_date`; dropping it was out of scope. `syncLineDates()` writes the header's date down onto
  its lines in the same transaction, so the two cannot disagree.
  **3. Every existing row was backfilled into a one-line voucher of its own.** Not left NULL — that
  would mean a permanent "voucher_id IS NULL means legacy" branch in every query. Each pre-existing
  receipt genuinely WAS its own document, so a one-line voucher is the honest representation. The
  backfill uses an INSERT-only `MERGE ... ON 1=0` with `OUTPUT inserted.voucher_id, src.receipt_id`
  to map new headers back to their lines — IDENTITY order is not guaranteed to match insertion
  order, so pairing them by id sequence would have been a silent corruption risk.
  Header edits and deletes are blocked once anything on the voucher is posted (`POSTED_LOCK`): a
  posted line has `ledger_entries` stamped with its date, so moving the header would leave the
  ledger disagreeing with the document. The FK on `voucher_id` is deliberately **not** ON DELETE
  CASCADE — a cascade would silently delete posted lines and strand their ledger rows.
  `expenseVouchers.*` is a separate file rather than a shared generic voucher service: expenses
  carry four payment modes (two unrelated cheque mechanics) and `expenses.service#post` takes a
  `userId` that `receipts.service#post` does not, so a shared abstraction would branch on document
  type in every method. Both cheque modes total together as `total_cheque` on the footer.
- **Files:** `backend/src/db/migrations/022_receipt_and_expense_vouchers.sql`,
  `backend/src/repositories/{receiptVouchers,expenseVouchers}.repository.js`,
  `backend/src/services/{receiptVouchers,expenseVouchers}.service.js`,
  `backend/src/ipc/{receiptVouchers,expenseVouchers}.ipc.js`, `backend/src/ipc/index.js`,
  `backend/src/repositories/{receipts,expenses}.repository.js` (voucher_id on insert),
  `backend/src/services/{receipts,expenses}.service.js` (voucher_id in buildFields),
  `frontend/src/lib/ipcBridge.ts` (`receiptVouchers`, `expenseVouchers` added to FEATURES),
  `System_architecture/database_schema_v4.3.md`
- **Verified:** migration applied live to `wentox_db` — 8 receipts → 8 vouchers numbered 1–8 in date
  order, 4 expenses → 4 vouchers, **zero** rows left without a voucher, **zero** line/header date
  mismatches, total receipt amount unchanged at 210,500. Then both services driven end to end
  against the live database, reproducing the client's own screen: a voucher with three lines of
  65,000 / 37,000 / 10,000 across **two different accounts**, totalling 112,000 cash — the same
  figures as their photo. Confirmed: empty voucher reads UNPOSTED; post wrote 6 ledger entries and
  the voucher read POSTED; header edit and delete both blocked with POSTED_LOCK while posted; unpost
  removed all 6 ledger entries and returned to UNPOSTED; posting 1 of 3 lines read **PARTIAL**;
  header date edit propagated to all three lines; list() returned the derived status and per-mode
  totals. Same sequence passed for payment vouchers. Every test row was deleted afterwards — the
  database is back to its pre-test counts (8 receipts, 4 expenses, 0 orphans).
- **Not done yet:** the screens. `ReceiptsPage.tsx` and `ExpensesPage.tsx` still drive the old
  one-receipt-per-posting flow and do not call these channels at all, so nothing is user-visible
  yet. RJ-03/PN-01 stay open until those are rebuilt.

### 2026-08-17 — SB-06 / P-03: post a whole run of documents at once (Change requests SB-06, P-03)
- **What:** every bill and every purchase had to be posted individually. Both screens now carry a
  "Pending Posting" panel listing what is saved but not yet in the ledger, with one Post All action
  and a per-document result.
- **How:** `listUnposted()` on both repositories defines unposted as the **absence of ledger
  entries** — the same definition `isPosted()` already uses; there is no status column on
  `sale_bills` to read instead (it was removed, see `database_schema_v4.3.md`). Ordered oldest
  first so a run lands in the ledger in the order it was typed. These select only the display
  fields the panel needs, not `SELECT *` — nothing here renders a document.
  `postAll(ids)` loops those (or an explicit id list) and calls the existing per-document `post()`.
  Two properties matter and are commented at the call site:
  **Each document keeps its own transaction.** Per the user's explicit choice, one document that
  can't post must not roll back the ones that already did. So `postAll` **resolves** with
  `{ posted, failed, attempted }` rather than throwing on first failure — unlike
  `products`/`businessAccounts` `createBatch`, which reject the whole batch. `ok: true` therefore
  does NOT mean everything posted; callers must read `failed`. Both the IPC comment and the
  `PostAllResult` type say so, because this is exactly the kind of contract that gets misread.
  **The loop is sequential, deliberately.** Two unposted bills can each pass the SB-03 stock check
  alone yet not together; `postLedgerAndStock()` reads `pairsOnHand()` live, so posting one after
  another is precisely what makes the second correctly fail with a specific INSUFFICIENT_STOCK
  message. `Promise.all` here would let both read the same pre-sale stock and oversell. Left an
  explicit "do not turn this into a Promise.all" note.
  A document already posted by someone else is skipped rather than reported as a failure — the
  user's intent ("get these posted") is satisfied either way. Non-`ApiError` failures are logged
  with their stack but reported generically, since the batch summary is the only place the user
  sees them.
  Frontend: the result panel is **not** auto-hidden on a timer like the ordinary success banner —
  a run can post 18 of 20, and the two that failed are the entire point of the message, so it stays
  until dismissed. Both mount effects fold the new list into the page's existing one rather than
  adding a second `useEffect`, which keeps the lint count at baseline.
- **Files:** `backend/src/repositories/{saleBills,purchases}.repository.js`,
  `backend/src/services/{saleBills,purchases}.service.js`,
  `backend/src/ipc/{saleBills,purchases}.ipc.js` (`:listUnposted`, `:postAll`),
  `frontend/src/lib/api.ts` (`UnpostedBillRow`, `UnpostedPurchaseRow`, `PostAllResult`, bindings),
  `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/PurchasePage.tsx`
- **Verified:** `tsc -b` clean, `npm run build` clean, ESLint at baseline (12 on these two files
  before and after). Executed live against `wentox_db`: `listUnposted()` returned the 2 genuinely
  unposted bills and 1 unposted purchase with correct customer/vendor names and totals, and
  `postAll([999999])` on both services returned
  `{posted:[], failed:[{... "Sale bill not found", code:"NOT_FOUND"}], attempted:1}` — a bad id
  lands in `failed` rather than throwing the batch out.
- **Not verified:** the partial-success path itself — "some post, some fail" — has not been driven,
  because exercising it means posting the user's real unposted bills into their ledger, which was
  not done without asking. Also unverified: the panel rendering and the Post All button, same
  Electron-clicking limitation as SB-05.

### 2026-08-17 — SB-05 / P-02: ready for the next document after posting (Change requests SB-05, P-02)
- **What:** posting a sale bill or a purchase left the finished document on screen, so entering a
  run of twenty bills meant twenty trips through the New button. A document completed in this run
  now clears itself back to a blank form, ready to type the next one.
- **How:** the reset reuses each page's existing `handleNew()` rather than repeating its field
  list, so "a blank bill" stays defined in one place; `readyForNextBill()` / `readyForNextPurchase()`
  then put the working **date** back, because `handleNew()` snaps to today and a run entered for an
  earlier date would otherwise reset on every single document. Bill numbers are already regenerated
  by `handleNew()`, satisfying SB-05's "each bill gets its own number". The cursor lands in the
  first field on its own — the app-wide G-01 auto-focus rule fires when the form remounts, so
  nothing page-specific was needed.
  The non-obvious part is **when** to reset. "After posting" is too broad: opening a bill from the
  Find tab and posting it there would wipe a screen the user deliberately navigated to. Both pages
  now carry a `createdInThisRun` ref — set only when `create()` succeeds (never on an edit of an
  existing document), cleared by `handleNew()` and by loading any existing row — and the reset is
  gated on it. Sale Bill's save-and-post path and its standalone Post button both honour it;
  Purchase has no combined action, so its Post button is the completion moment there.
  A save that succeeds but whose **post** fails deliberately does not reset: the document exists and
  must stay on screen so the user can see which one failed and retry. Success messages now name the
  document ("Bill 34871 saved & posted. Ready for the next one.") because once the form empties, the
  clearing is otherwise the only evidence anything was saved.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/PurchasePage.tsx`
- **Verified:** `tsc -b` clean, `npm run build` clean, and ESLint unchanged against baseline — 9
  errors before, the same 9 after (all pre-existing, including the `handleNew`-before-declaration
  one already recorded in `System_architecture/TODO.md` §4.2).
- **Not verified:** the behaviour itself has not been driven in the running app — this is frontend
  state, and there is no way to click an Electron window from this environment. Needs a click-through:
  enter a bill → Save & Post → confirm the form clears, keeps the date, has a new bill number, and
  the cursor is in the first field; then open a bill from Find, post it, and confirm it does NOT clear.
- **Known consequence:** the just-posted bill is no longer on screen to print. It stays reachable
  from the Find tab, but if printing immediately after posting is part of the daily routine, this
  ordering needs revisiting (print-then-clear, or a "print last bill" action).

### 2026-08-16 — PR-01: Purchase Return prefills the price actually paid (Change request PR-01)
- **What:** a purchase return priced its lines off whatever the user typed, so it could credit the
  vendor at a price that was never paid. It now prefills each line from this vendor's last POSTED
  purchase of that material — the counterpart of SR-01, which already did this for Sale Return.
- **How:** mirrored SR-01's implementation rather than inventing a second approach —
  `purchases.repository#lastPurchasedRate` is `saleBills.repository#lastSoldRate` with the sale
  tables swapped for the purchase ones, same `EXISTS(ledger_entries)` posted-only rule, same
  `ORDER BY date DESC, id DESC`.
  Two deliberate differences from SR-01. **Keyed on material NAME, not id:** the Purchase/Purchase
  Return screens hold free text and only resolve to a `material_id` at save time via
  `materials.repository#resolveOrCreate`, so an id-keyed lookup had nothing to pass. Matching is a
  plain `=` on `m.name`, leaning on the same case-insensitive collation `resolveOrCreate` already
  leans on. It is strictly read-only — it never registers a material, so typing an unknown name
  returns null instead of quietly creating a `materials` row. **Returns the unit with the price:**
  a purchase line's unit is self-assigned, so "200 kg @ 230" and "200 meters @ 230" are different
  purchases and a price without its unit is ambiguous.
  Frontend fires on **blur** of the material name, not on change — mid-typing, the name matches
  nothing. A `resolvedNames` ref records the name each row was last priced from, so re-blurring an
  untouched field never overwrites a price the user has since edited by hand, while genuinely
  changing the material does refill. The ref is cleared when the vendor changes (same material,
  different last-paid price), and **pre-seeded** on both load paths — copy-from-purchase and
  open-existing-return — because those lines already carry the source document's own rates, which
  beat "last posted purchase" when the two differ. A fetched unit outside `UNIT_PRESETS` also flips
  that row's unit control to free-text, or the select would snap the line back to a preset.
- **Files:** `backend/src/repositories/purchases.repository.js`,
  `backend/src/services/purchases.service.js`, `backend/src/ipc/purchases.ipc.js`
  (`purchases:lastPurchasedRate`), `frontend/src/lib/api.ts` (`LastPurchasedRate`, bridge binding),
  `frontend/src/pages/PurchaseReturnPage.tsx`
- **Verified:** `tsc -b` clean; executed live against `wentox_db` — exact name returned
  `{ price_per_unit: 12, unit: 'Buckles' }`, a lowercased name returned the same row (collation),
  a wrong vendor and an unknown material both returned null, the service's blank-name and
  no-vendor guards short-circuited before SQL, and **an unposted purchase's price did not leak**
  (a draft line at 688 returned null).
- **Not exercised:** the most-recent-wins ordering — this database has only one posted purchase per
  material, and proving it would have meant writing extra purchases into the user's data. The
  ORDER BY is verbatim from the already-proven `lastSoldRate`.
- **Not wired:** `purchases:lastPurchasedRate` is a new channel on an existing feature, so
  `ipcBridge.ts`'s `FEATURES` array needed no change (`purchases` is already listed).

### 2026-08-16 — C-01: show the account code, not the IDENTITY value (Change request C-01)
- **What:** Vendor and Customer setup screens showed the raw `vendor_id`/`customer_id` as the
  party's "ID". Those are `IDENTITY` values and they skip, which the client reported as a bug
  ("only one vendor exists but the system generated ID = 2"). Both screens now show the linked
  business account's `code` instead, relabelled Vendor Code / Customer Code.
- **How:** there was no defect to fix — the skipping is expected behaviour, and confirmed live on
  `wentox_db`: vendor_ids run 1, 2, 3, **1003** while their account codes run 2000010001–…0004
  with no gap at all. The 1000 jump is SQL Server's identity cache losing its reserved block on an
  unclean shutdown; a rolled-back create burns a value the same way, and `vendors.create()` wraps
  the vendor and its business account in one transaction, so any failure there consumes an id.
  Soft-deleted rows hold theirs permanently too. The account code has none of these properties —
  it's allocated `MAX(serial under parent) + 1` by `businessAccounts.service.js` and is already the
  number printed on the ledger and the voucher for that same party, so the screens now agree with
  the accounts.
  `list()`/`findById()` in both repositories gained a `LEFT JOIN dbo.business_accounts ba ON
  ba.ba_id = <t>.ba_id` and select `ba.code AS account_code` — LEFT, not INNER, so a party with no
  linked account still lists (renders as `—`) rather than vanishing from the screen. Both search
  filters now match `ba.code` alongside the name, and the two client-side search boxes match
  `account_code` **as well as** the old raw id, so anyone who has memorised the old number can
  still type it. Display-only: no migration, no renumbering, no data touched.
- **Files:** `backend/src/repositories/vendors.repository.js`,
  `backend/src/repositories/customers.repository.js`, `frontend/src/lib/api.ts`
  (`VendorRow.account_code`, `CustomerRow.account_code`),
  `frontend/src/pages/VendorSetupPage.tsx` (list column, search, detail panel),
  `frontend/src/pages/CustomerSetupPage.tsx` (list column, search, ledger header, printed statement)
- **Verified:** `tsc -b` clean; both repositories executed live against `wentox_db` — 4 vendors and
  6 customers all returned a populated `account_code`, `findById` carried it, and searching by a
  full account code returned exactly the one matching row on both entities.

## Backing the database up to an external drive

### 2026-08-13 — External-drive backup, and a staging path the mirror could never have written on Windows (Milestone 9, follow-up)
- **What:** a second backup target — a full `.bak` written straight onto a USB/external drive from
  Settings → Backup. This is the first copy that survives the PC itself: the main database and the
  live mirror both sit on the same disk, on the same SQL Server instance, so a dead disk took both.
  **One file, always overwritten, manual only** — decided explicitly with the user. The drive is not
  expected to be plugged in most of the time, so nothing here runs on a timer, and there is no dated
  history (so a mistake noticed a week later is still unrecoverable — stated, accepted, not solved).
- **How:** SQL Server writes to the drive directly (`BACKUP DATABASE ... TO DISK` with
  `INIT, FORMAT, CHECKSUM`) rather than the app backing up locally and copying the file across —
  one ~400MB write instead of two, and no staging folder that both the SQL Server service account
  and the logged-in user must be able to write. `RESTORE VERIFYONLY` runs immediately after, so
  success means the file **on the drive** was read back and is complete, not merely that a write
  returned no error. No `WITH COMPRESSION`: unavailable in SQL Server Express, and including it
  fails the statement outright.
- **The error messages are the feature.** `ipc/wrap.js` flattens anything that isn't an `ApiError`
  into `"Internal error"`, which for this is useless — "Operating system error 5 (Access is denied)"
  is the whole diagnosis. Known failures are mapped to their own codes
  (`EXTERNAL_NOT_CONFIGURED`, `EXTERNAL_DRIVE_MISSING`, `EXTERNAL_ACCESS_DENIED`,
  `EXTERNAL_DISK_FULL`) and everything else keeps the raw SQL Server text. **Gotcha found by
  testing, not by reading:** a failed `BACKUP` raises *two* errors — the real cause, then
  "BACKUP DATABASE is terminating abnormally." mssql puts the cause in `err.precedingErrors` and the
  useless one in `err.message`, so the first implementation reported the useless one and the
  access-denied case fell through to the generic branch. The folder's existence is checked with
  `fs.existsSync` *before* starting, so an unplugged drive fails instantly rather than after minutes.
- **Separate latent bug, fixed in the same pass:** `runSyncNow()` staged the mirror's `.bak` through
  `os.tmpdir()`. On Windows that is the *user's* `%TEMP%`, and SQL Server Express is installed here
  with no `/SQLSVCACCOUNT` (`build/setup-sqlserver.ps1:168`), so it runs as the virtual account
  `NT Service\MSSQLSERVER` — which has no rights there. **The existing mirror backup would almost
  certainly have failed on the client's machine**, and could not have been caught in this sandbox
  because SQL Server runs in a container and writes to its own `/tmp`. It now stages inside the
  mirror's own folder, which SQL Server demonstrably can write: the mirror's `.mdf`/`.ldf` live
  there. Still unproven on real Windows — see below.
- **`RESTORE-INSTRUCTIONS.txt`** is written next to the `.bak`, containing the actual
  `RESTORE FILELISTONLY` / `RESTORE DATABASE ... WITH MOVE` commands for that exact file. The drive
  has to explain itself: whoever holds it in an emergency may have neither this app nor this repo.
- **Verified:** 17/17 on a purpose-built functional run — the `.bak` lands on the drive,
  `VERIFYONLY` passes, and it **restores into a scratch database with all six checked tables
  matching** (`sale_bills` 61, `sale_bill_items` 65, `ledger_entries` 695, `customers` 96,
  `cheques` 52, `users` 2). All three failure paths produce their own readable message and never
  `"Internal error"`; two simultaneous presses share one run. The mirror was re-tested after the
  staging change and still syncs exactly. Full suite 113/113 on a database built from nothing,
  IPC audit clean (267 channels), `tsc` clean, lint unchanged at the 88/10 baseline, production
  build clean.
- **Still to do on Windows:** the permission question is only genuinely answered there — plug in a
  real drive, run it, unplug and re-run for the "drive not found" message, and restore the `.bak` on
  a different PC. That same run is what finally confirms the mirror too.
- **Files:** `backend/src/services/backup.service.js`, `backend/src/ipc/backup.ipc.js`,
  `backend/src/config/appConfig.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/SettingsPage.tsx`

---

## QA pass over the whole app, and the cheque-deposit hole it found

### 2026-08-10 — Full-app QA run; deposited cheques never reached the bank (Milestone 9, verification)
- **What:** a structured QA sweep of the entire app, then a fix for the one material defect it
  surfaced. Three static audits (renderer→bridge→handler surface: 260 call sites, 0 gaps;
  ipc→service method references: 261, 0 missing; every nav page routed: 31/31) plus a 14-phase live
  run against a database built from nothing — auth/roles, masters, structural guards, stock,
  purchases + returns, sale bills + returns (including editing a POSTED bill), receipts, expenses,
  endorsements, transfers, deposits, payroll, JV, the full cheque lifecycle, all 16 reports, alerts,
  backup, and per-document double-entry integrity. **113 checks, 0 failures** after the fix.
- **The defect — a deposited cheque moved nothing.** `cheques.service.js#deposit()` deliberately
  wrote no ledger row, deferring to `cash_and_bank.md` §10's derived-balance helper
  (`balance(bank) = ... + Σ cheque DEPOSITs where the cheque's bank_id = B`). **That helper was
  never built** — every balance the app shows reads `ledger_entries`, and nothing anywhere derives a
  balance from `cheque_allocations`. So banking a cheque (even marking it CLEARED) never credited
  the bank and never drained CHEQUES IN HAND. Evidence from the QA database: bank 222,800 with an
  8,000 CLEARED cheque missing, CHEQUES IN HAND still holding that same 8,000. Both errors are equal
  and opposite, which is exactly why the trial balance stayed at zero and never flagged it — and why
  it survived the earlier full-flow check, which asserted on the trial balance.
- **How fixed:** `deposit()` now writes Dr bank BA / Cr CHEQUES IN HAND like every other money
  movement — the same pair `reports.repository.js#cashBookNonCashRows` already documented a deposit
  as being. Chose this over building the §10 derivation helper: one mechanism for all money
  movements beats a second, parallel one that only cheque deposits use and that every future report
  would have to remember to call. `reverseCheque()` gained the matching branch, so a cheque that
  bounces *after* being banked now pulls the money back out of the bank (a DEPOSITED cheque is not
  terminal, so this path is reachable); its other side is the bank on the cheque itself, since
  `cheque_allocations` has no bank column. `markCleared()` stays a pure status flip — the money
  moved at deposit time.
- **Migration 019** backfills the missing pair for deposits made before the fix. ACTIVE allocations
  only: a REVERSED one wrote nothing and was reversed against nothing, so its two errors already
  cancel and inserting one side now would *create* an imbalance. Both legs go in one `CROSS APPLY`
  statement so a half-written pair is impossible, and `NOT EXISTS` on `allocation_id` makes re-runs
  a no-op. Verified on `wentox_demo`: Meezan Bank 232,000 → 292,000, CHEQUES IN HAND 297,000 →
  237,000, ledger still nets to zero with no unbalanced document.
- **Gotcha caught in testing:** the first version of 019 `THROW`-ed when CHEQUES IN HAND was absent.
  Migrations run *before* seeds, so that aborted `npm run migrate` on every brand-new database. It
  is now a guarded no-op — no chart account means no cheques, so there is nothing to backfill.
- **Second gotcha, spotted by the user:** 019 tagged its narration `(backfilled by migration 019)`,
  which is not an internal note — `ledger_entries.narration` renders verbatim in the Narration column
  of the account and cheque ledgers the client reads. A backfilled deposit is the *same business
  event* as a live one, so the wording now matches `deposit()`'s byte for byte, and which code path
  wrote the row is left to `schema_migrations.applied_at` where it belongs. The six rows already
  written locally were stripped with a one-off UPDATE. **Note this edits an already-applied
  migration**, against the standing rule — justified only because 019 is uncommitted and unreleased
  and had run on exactly two local databases (scratch QA and `wentox_demo`), both corrected here. Had
  it shipped, the fix would have had to be migration 020 doing that UPDATE.
- **Still open, reported not fixed:** (1) read-side role guard — `reports:account-ledger`,
  `:account-balance` and `:business-ledger` only `requireSession()`, so a USER can read restricted
  accounts (Bank, Directors Drawings) that the write side correctly blocks, and no frontend filters
  on `is_restricted`; (2) `products.service.js#createBatch` 404s on a `vendor_id` it then overwrites
  with the system vendor; (3) `direction: 'CREDIT'` means opposite ledger sides on Deposits vs
  Journal Vouchers; (4) `accountBalance` cuts off at today while `accountLedger` does not, so the two
  disagree on a future-dated document.
- **Not a defect:** cheque disposal actions are ADMIN-only by design, on screen (`ChequePage`'s
  Disposal tab) *and* in the API (`requireRole('ADMIN')` on all six channels). A `User` sees the
  cheque on the read-only "Cheque in Hand" tab with no actions and no explanation of why — a
  discoverability gap, not a permissions bug.
- **Files:** `backend/src/services/cheques.service.js`,
  `backend/src/db/migrations/019_backfill_cheque_deposit_ledger.sql`

### 2026-08-12 — PDF-backed print preview: built, could not be made reliable, reverted
- **Goal:** the preview showed one continuous sheet that just grew taller, with no page boundaries,
  so it could never show where page 2 began. Client asked for real A4 pages. Approach chosen with
  them: render the window through Chromium's own print engine (`webContents.printToPDF`) and show
  that PDF, making the preview literally the print output.
- **It worked in every isolated test and failed in the real app.** Standalone Electron harnesses
  produced correct multi-page A4 PDFs every time — including one reproducing the modal's exact DOM
  against the app's real compiled CSS. In the running app the same call returned a **blank document:
  three A4 pages of correct height with zero text**, ~2KB instead of ~103KB. Not a hang (350ms), not
  a missing channel (it logged), not the report being absent (the DOM measured 4,304 characters and
  2,260px of laid-out report at capture time).
- **Ruled out, each by measurement rather than reasoning:** the entrance animation (identical output
  captured at 30/150/600ms); `overflow` on the wrapper (3 pages, 120 rows either way); the app DOM's
  size (`content-visibility` on `#root` made no difference to blankness); webfonts
  (`document.fonts.ready` did not help); print-media emulation before capturing; settle delays up to
  two seconds. The same window printed a correct 103KB PDF when driven from the main process a few
  seconds later, which is what makes it a timing/context problem inside the print engine rather than
  a document problem.
- **Two real bugs were found and fixed along the way**, and they stay fixed: the preview state
  survived a close, so reopening pointed the iframe at a **revoked blob URL** (`ERR_FILE_NOT_FOUND`)
  while the report sat off-screen — the fresh capture was then taken of an off-screen document; and
  `[data-no-print]` was being **overridden** by a later `.report-modal-scroll-wrapper` rule of equal
  specificity, so the preview pane was never actually excluded from printing.
- **Reverted** to the HTML preview. Kept: the `items-start` fix (without it the sheet is pinned to
  one page and long reports spill onto the backdrop), the explicit `@page size: A4`, and every
  page-level print fix from the audit. The printed output was correct the whole time — this only
  ever affected what the preview showed.
- **If it is picked up again**, the promising direction is rendering the PDF in a **dedicated
  offscreen window** containing only the report: every isolated harness did exactly that and never
  failed. The obstacle is getting the app's CSS and asset URLs into that window (Vite injects styles
  as JS in dev, so there is no stylesheet to link).
- **Files:** `frontend/src/components/reports/ReportPrintPreviewModal.tsx`,
  `frontend/src/index.css`; `backend/src/ipc/print.ipc.js` added then removed.

### 2026-08-12 — Print audit across all 18 reports; grand total was repeating on every page
- **Why:** user reported "some issue when data expands to two pages". Audited every printable
  report rather than the one that prompted it — 18 reports, all going through
  `ReportPrintPreviewModal`.
- **The defect: `<tfoot>` repeats on every printed page.** That is what
  `display: table-footer-group` means in paged media, and `index.css` set it for every
  `.excel-print-table`. Right for a running footer, wrong for what this app actually puts in one —
  a grand total. On a two-page Cash Book, "Totals : …" printed at the foot of page 1 *and* page 2,
  and the page-1 figure is not the total of page 1, on a document someone reconciles by hand.
  **Affected the Cash Book and Bilty & Adda Updation** — the only two reports whose print table uses
  a real `<tfoot>`; every other one already puts its total in `<tbody>` as the last row. Fixed
  globally with `display: table-row-group`, since both have `<tfoot>` after `<tbody>` in DOM order
  and no report here ever wants a repeating footer. The `<thead>` rule is the opposite case and
  stays: column headings **must** repeat or page 2 is unlabelled numbers.
- **`@page` now names the paper, not just the orientation** — `size: A4 portrait|landscape`. Without
  a size the print dialog's default wins (Letter on US-configured Windows), silently reflowing a
  report whose own toolbar says "A4 (210mm × 297mm)" and moving every page break.
- **Audited and found sound:** headers repeat on page 2 (every table inside a print preview carries
  `.excel-print-table` — checked by walking each `renderPrintable*` body); rows never split
  mid-row; the table itself is free to break; `#root` is hidden so only the modal portal prints;
  the preview's `transform: scale()` is reset for print, which the CSS itself flags as
  "CRITICAL: transform scale breaks multi-page breaking"; no `overflow`, `max-height` or fixed
  height anywhere inside a print body that could clip page 2.
- **Sign-off block kept whole (done).** `components/reports/ReportFooter.tsx` exists but is **dead
  code — nothing imports it**, so all 19 reports carry hand-rolled copies of the strip (three ruled
  signature lines + the company/printed-at bar). The wrapper markup is byte-identical across every
  file, which made a scripted edit safe: `className="report-signoff"` added to **18 signature rows
  and 21 printed-at bars across 19 files**, plus one print rule giving them `break-inside: avoid`.
  Proven rather than assumed — a straddle had to be hunted for, because a page break falls inside
  the block only within a ~24px window, and stepping by whole table rows kept skipping it. Scanning
  filler height by 8px found it: at 940px the block **split, TOPMARK landing on page 1 and the
  signature labels on page 2**; with the class, both move to page 2 together.
- **Letterhead logo halved.** Note it is in the report *header*, not the footer. It was 160–180px
  across 20 reports — 180px is 47.6mm at 96dpi, about 17% of A4's 281mm usable height gone before a
  single row of data. Now a consistent 90px (~24mm), a normal letterhead.
- **Left alone:** `ReportFooter.tsx` is still unused. It is worth either adopting or deleting, but
  its wording differs from the copies in use ("Checked By" vs "Audited By", "WENTOX SOLE ERP System
  Report" vs "WENTOX FOOTWEAR DISTRIBUTION"), so switching to it would change what prints.
- **The one the user actually saw: the preview sheet stopped at one page.** Screenshot showed the
  last rows, the subtotal and the GRAND TOTAL rendering *outside* the white paper, on the dark
  backdrop. Cause is one missing flex property, not print CSS: the scroll wrapper is a row-direction
  `flex` with no `align-items`, so it defaults to **stretch**, which gives the sheet a DEFINITE
  height instead of letting `minHeight: 297mm` grow with content. Measured in headless Chrome —
  sheet **1123px (exactly one A4 page)** against **3186px** of content, so ~2000px hung off the
  bottom. Adding `items-start` restores height:auto; sheet measures 3186px, nothing spills. Print
  output was unaffected (the print rules already reset display/height), but the preview looked like
  a broken document, which is how it was reported.
- **Both print fixes verified on real PDFs**, not by reasoning — Chrome `--print-to-pdf` over a
  reduction of the same markup and CSS:
  | tfoot display | pages | "GRAND TOTAL" prints on | column headers on |
  |---|---|---|---|
  | `table-footer-group` (before) | 2 | **pages 1 and 2** | pages 1, 2 |
  | `table-row-group` (after) | 2 | page 2 only | pages 1, 2 |
  `pdfinfo` also confirms **594.96 × 841.92 pts = A4**, so the new explicit `size: A4` takes effect
  and headers still repeat, which was the thing not to break.
- **Files:** `frontend/src/index.css`, `frontend/src/components/reports/ReportPrintPreviewModal.tsx`

### 2026-08-12 — Zoom in / out for the whole app
- **What:** a zoom control in the header of every page — `−` / percentage / `+`, with the percentage
  acting as reset-to-100% — plus Ctrl `+` / Ctrl `−` / Ctrl `0`. The level is remembered per machine
  and a fresh install starts at **90%**. Asked for because the app renders too large on the client's
  Windows box: Electron honours the OS display scaling (commonly 125% on Windows) and this UI is
  built in fixed pixels, so less fits on screen than should.
- **Native zoom, not CSS.** `webContents.setZoomFactor()` via a new `zoom:` channel, not a CSS
  transform or the CSS `zoom` property. The app shell is `h-screen` + `overflow-hidden`; CSS zoom
  scales content while `100vh` carries on measuring the *unzoomed* viewport, so the shell would grow
  past the window and clip its own bottom edge. Native zoom leaves every layout calculation alone.
- **The default menu had to go.** Electron's built-in menu carries `zoomIn`/`zoomOut`/`resetZoom` on
  those exact accelerators. Left in place, one keypress fires both it and our handler: the window
  moves two steps while the on-screen percentage moves one, and the label stops describing the
  window. `main.js#buildMenu()` now installs a menu keeping Edit (Ctrl+C/V in inputs), Reload,
  **Toggle DevTools** and Fullscreen, minus the zoom roles. The alternative — main sending zoom
  changes back to the renderer — would have meant adding a listener to `preload.js`, the one thing
  that file deliberately does not do.
- **No `requireSession()` on `zoom:`,** unlike every other channel, and commented as deliberate: the
  login screen has to be zoomable, and it is by definition reached before a session exists.
- **One definition of the level.** `lib/zoom.ts` holds the ladder, the storage key, the 90% default
  and `readStoredZoom()`; `main.tsx` re-applies it after `installApiBridge()` and **before** the
  first render, because Electron's zoom factor does not survive a restart — without that, every
  launch opens at 100% and visibly resizes a moment later. The main process returns the factor it
  actually applied after its clamp, and that is what gets stored, so the label can never drift from
  the window.
- **Verified:** clamp holds (3 → 1.5, 0.1 → 0.5); the ladder keeps 90% and 100% as exact stops and
  snaps stray values onto it (0.87 → 0.9, 1.4 → 1.5); the renderer→bridge→handler audit passes at
  262 call sites with `zoom` present in `FEATURES`; all 44 IPC modules still required *and* called;
  `tsc -b`, lint and the production build clean; suite 113/113. **Not visually verified** — that
  needs the app running, and the print-at-non-100%-zoom check needs the Windows box.
- **Files:** `backend/src/ipc/zoom.ipc.js` (new), `backend/src/ipc/index.js`,
  `backend/electron/main.js`, `frontend/src/lib/zoom.ts` (new),
  `frontend/src/components/ZoomControl.tsx` (new), `frontend/src/components/AppLayout.tsx`,
  `frontend/src/lib/{api,ipcBridge}.ts`, `frontend/src/main.tsx`

### 2026-08-12 — The remaining QA lows, cleared in one pass
- **post()/unpost() now re-check the restricted-account rule.** The guard only ran on create/update,
  so an ADMIN could leave a draft against a bank or Directors account and a USER could post it —
  demonstrated live before the fix. Added to **transfers, deposits, receipts, expenses, journal
  vouchers and settlements**, not just the two it was found on, since a partial fix leaves the same
  hole open elsewhere. `draftExpenses.confirm()` carries the session through too. Verified: a USER
  posting an admin-made cash→bank transfer, bank deposit and Directors JV is refused on all three,
  ADMIN unaffected.
- **`products.createBatch` no longer 404s on a `vendor_id` it discards.** The loop validated the
  caller's vendor and then overwrote every row with the system vendor anyway, so a batch failed
  outright whenever the form's vendor list had not loaded and it fell back to `?? 0` — a check that
  could only ever reject valid input. The in-batch duplicate key now uses the vendor the rows are
  actually written with.
- **Balances and ledgers now agree.** `accountBalance` defaulted its cutoff to today while
  `accountLedger` applied none, so an entry dated ahead of today appeared on the statement but not
  in the balance panel beside it — two numbers for one account, both called "balance".
  `netBalance`/`businessAccountBalancesAsOf` take an OPTIONAL cutoff now; absent means the whole
  book. Verified with an entry dated 2027-01-15: balance −4,019, ledger closing −4,019.
- **The Disposal screen stops offering actions that cannot succeed.** `cheques.repository.list()`
  now carries `receipt_status`, so a cheque whose receipt is still DRAFT shows a "Receipt not
  posted" tag instead of a Dispose button that always came back "This receipt is not posted yet".
- **Bank Accounts shows what each bank actually holds.** The screen could only ever set an opening
  balance. One `businessLedger({view:'summary'})` call fills a Balance column for every row rather
  than a round-trip per bank.
- **Cheque in Hand gained a way out, not duplicated actions.** A per-row "Dispose →" button switches
  to the Disposal tab (`ChequePage` passes `switchTab`). The tab stays read-only — the machinery
  belongs on one screen — but landing here with a cheque and no route to acting on it was the
  complaint that started all of this. **Also fixed while in there:** its TOTAL IN HAND used
  `colSpan={5}`, which covered the In Hand column itself and put the figure under **Status**. Same
  family as yesterday's Cheque Ledger bug, and one my cell-count sweep could not catch — the count
  was right, the placement was not.
- **Not done, by instruction:** the CREDIT/DEBIT naming clash between Deposits and Journal Vouchers.
- **Files:** `backend/src/services/{transfers,deposits,receipts,expenses,journalVouchers,settlements,draftExpenses,products,reports}.service.js`,
  `backend/src/repositories/{reports,cheques}.repository.js`,
  `backend/src/ipc/{transfers,deposits,receipts,expenses,journalVouchers,settlements,draftExpenses}.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/components/ChequesTab.tsx`,
  `frontend/src/pages/{ChequeInHandContent,ChequePage,BankSetupPage}.tsx`

### 2026-08-12 — Cheque Ledger total row was a column short
- **What:** the Cheque Ledger's on-screen total row had **8 cells against 9 headers**
  (`colSpan={6}` where it needed 7), so every figure sat one column to the left of where it
  belonged — the gold total under **Bank**, the received/issued split under **Amount**, spilling
  toward Reversed. Reported from a screenshot.
- **How fixed:** `colSpan={7}` + amount + one empty cell = 9. The received/issued split moved
  alongside the label and was spelled out ("Received … · Issued …" rather than "R: … / I: …") —
  Reversed is a badge column barely wider than the word and cannot hold two figures. The print
  table's cell count was already right but had the same cramming, so it got the same treatment and
  now matches the screen.
- **Then swept the whole app for the same class of bug:** a script comparing header count against
  total-row cells across every table, 42 total rows. One more real mismatch — `ChequesTab`'s printed
  report was one cell short (the Status column had no footer), fixed the same way. The other eight
  flags were artifacts of the scan, verified by hand and dismissed: grouped `<th colSpan={2}>`
  headers (OverallTrail), a computed `colSpan={3 + colors.length}` (ReportStock), and conditional
  columns behind `{showDate && <th/>}` (Cash Book) — none of which a regex can count.
- **Note for next time:** `tsc` cannot see this and neither can lint. A cell-count check is worth
  running whenever a table's columns change — this is the second time a miscounted row has shipped.
- **Files:** `frontend/src/pages/ChequeLedgerContent.tsx`, `frontend/src/components/ChequesTab.tsx`

### 2026-08-12 — Two QA mediums: bill-number sort, and deposited cheques vanishing
- **Bill numbers sorted as text.** `BiltyUpdatePage`'s "Sort by Bill No" used a bare
  `localeCompare`, so `BILL-10` came before `BILL-2` and `BILL-9` — wrong for any customer past
  their ninth bill. Now passes `{ numeric: true, sensitivity: 'base' }`, the same options
  `ChartAcSetupPage` and `BusinessAcSetupPage` already use for account codes. Verified:
  `BILL-2, BILL-9, BILL-10, BILL-21, BILL-100`.
- **A deposited cheque disappeared from the Disposal tab.** The status filter defaults to "open",
  which meant PENDING/PARTIALLY_ENDORSED only — so the moment a cheque was fully deposited its row
  dropped out of the default view. Since **Mark Cleared renders only on a DEPOSITED row**, the
  button became unreachable unless the operator knew to switch the filter by hand. Banking a cheque
  does not settle it: the bank has not confirmed it, and clearing is the next thing someone must do
  to it. `OPEN_STATUSES` now includes DEPOSITED and the option reads "Open (not yet cleared)".
  Verified against a live DEPOSITED cheque — hidden under the old rule, shown under the new, with
  Mark Cleared on the row. `unallocatedFor` returns 0 for a fully deposited cheque, so Dispose stays
  hidden on it and the Unallocated total is unchanged.
- **Left alone deliberately:** the "Cheque in Hand" tab still lists PENDING/PARTIALLY_ENDORSED only.
  That tab answers "what is physically still with us", and a banked cheque is not.
- **Files:** `frontend/src/pages/BiltyUpdatePage.tsx`, `frontend/src/components/ChequesTab.tsx`

### 2026-08-11 — UC-03 closed on the read side, and on Transfers/Deposits
- **What:** the two remaining holes in the USER rule, both closed by the same mechanism the write
  side already used. (1) **Reports.** `payment-trail` was the only report channel that received the
  session, so a USER could pull the balance and full ledger of any bank or Directors account through
  the Reports Hub. `account-ledger`, `account-balance`, `business-ledger`, `overall-trail` and
  `overall-search-ledger` now take it. (2) **Transfers and Deposits.** Neither service called
  `assertAccessible` at all — the pages are hidden from a USER, but the channels accepted anything,
  and every account these two documents touch is a bank.
- **How:** two helpers in `reports.service.js`. `assertReadable({ba_id, ac_id}, session)` rejects a
  restricted account by id — it takes `ac_id` too, because `reports:account-ledger` accepts either
  and BANK ACCOUNTS / Directors Drawings are themselves chart accounts a USER could name directly.
  `visibleTo(session, rows)` drops restricted rows from a list rather than throwing, because asking
  for "every account" is a legitimate request that should simply return fewer rows. Both follow
  `assertAccessible`'s existing contract: **no session means an internal caller** (vendorLedger, the
  Cash Book) and is unfiltered — only a request that arrived with a session is judged.
  `businessAccountsWithCategory()` gained `ca.is_restricted` to make the filtering possible.
- **Verified by role** on a database built from nothing — USER: bank ledger ❌, bank balance ❌,
  Directors ledger ❌, BANK ACCOUNTS by `ac_id` ❌, a customer's ledger ✅; business ledger lists 10
  accounts to a USER vs 12 to an ADMIN, with zero restricted rows among them; transfer to a bank ❌,
  deposit into a bank ❌; ADMIN unaffected on all of them. Full suite 113/113.
- **The Overall Trail collapses rather than filters** (client's choice, 2026-08-11). Plain filtering
  left the trial balance 230,800 out — and that gap *was* the restricted total, so it hid nothing
  while breaking the report. A USER now gets one line, "Restricted accounts (administrator only)",
  carrying their combined net: 15 rows either way, debit 315,250 = credit 315,250, difference 0 for
  both roles, with `QA Bank` named only for the ADMIN. The row has no `ba_id`/`ac_id` and a new
  `is_aggregate` flag; `OverallTrailContent` keys its drill-down off that flag, so the row renders
  un-clickable instead of asking the backend for a ledger with neither id. **Caveat worth
  remembering:** with only ONE restricted account carrying a balance the aggregate equals that
  account's balance — the collapse hides which accounts and how they split, not the total.
- **Files:** `backend/src/services/reports.service.js`, `backend/src/repositories/reports.repository.js`,
  `backend/src/ipc/reports.ipc.js`, `backend/src/services/transfers.service.js`,
  `backend/src/services/deposits.service.js`, `backend/src/ipc/transfers.ipc.js`,
  `backend/src/ipc/deposits.ipc.js`

### 2026-08-11 — Cheque disposal un-restricted; the USER rule stated plainly
- **What:** removed `requireRole('ADMIN')` from all six cheque disposal channels and the `adminOnly`
  flag from the Cheque page's Disposal tab, then covered the same ground properly with the
  account-level guard.
- **Why it was wrong:** traced with `git log -S`. The on-screen restriction originated in Subhan's
  old Receipts "Cheques Disposal" tab (`73bbb2ce`, 4 Aug), carried across to the new Cheque page
  (`c8125838`), and I then hardened it into the API (`3c6cadf4`) citing UC-03 point 3 — "the API
  enforces the same rule server-side". The flaw: UC-03's restriction list is *only* Cash at Banks and
  Directors Expenses – Drawings, and the doc explicitly says the restriction is about visibility,
  "not the ability to record a bank or director's-drawings transaction". I enforced an inherited UI
  behaviour instead of the specified rule. It showed: a USER could receive a cheque and then do
  nothing with it, yet could still `reverse-allocation` — undo an endorsement they were barred from
  making. **Client confirmed 2026-08-11: a USER is restricted to those two heads and everything
  under them; everything else is open.**
- **The guard that replaces it:** opening the channels exposed two accounts a USER must not reach —
  `deposit`'s bank (every bank is under the restricted head) and `endorse-to-expense`'s
  `target_ba_id` (could be Directors Drawings). All three targeting actions now take the session and
  call `assertAccessible`, the same account-level guard receipts/expenses/settlements/JV use.
  `bounce`/`return-to-sender` stay unguarded on purpose: their target was fixed at disposal time, and
  blocking a USER from recording a bounce would recreate the dead end.
- **Verified by role** on a database built from nothing — USER: endorse to vendor ✅, endorse to an
  expense head ✅, deposit into a bank ❌, endorse to Directors ❌; ADMIN: both ✅. Ledger nets to
  zero; full suite still 113/113.
- **Consequence worth flagging:** a USER can no longer bank a cheque at all, since every bank is
  restricted. That follows from the rule as stated rather than contradicting it, but it is the one
  outcome the client may not have pictured.
- **Files:** `backend/src/ipc/cheques.ipc.js`, `backend/src/services/cheques.service.js`,
  `frontend/src/pages/ChequePage.tsx`, `System_architecture/use_cases.md`

### 2026-08-10 — Bank balances made visible: directory column + Transfer page panels
- **What:** two places to read a balance that previously had none. (1) The Business Ledger
  directory (Reports Hub → Business Ledger) gained a **Balance** column — `businessLedger({view:
  'summary'})` had always returned `closing_balance` on every row and the table simply never
  rendered it, so reading a bank or cash balance meant opening one statement at a time. (2) The
  **Transfer page** now shows both sides' balances as you pick them, and the Deposit form shows its
  target's — the one screen where you need to know the money is actually there before moving it.
- **How:** `AccountBalancePanel` gained a `variant` prop (`'party'` default | `'money'`). Its
  Receivable/Payable wording is right for Receipts/Expenses but reads as nonsense on a bank
  ("Receivable 349,000"), so `'money'` says In Hand / Overdrawn / Empty instead. Same sign
  convention either way — positive is a debit balance — only the words change; Receipts and Expenses
  are untouched. The directory column uses **Dr/Cr** rather than either wording, because that list
  mixes customers, vendors, employees, banks and expense heads in one table, and the statement's own
  columns already say Dr/Cr.
- **Gotcha:** the first version bumped the panels' `refreshKey` inside `refreshTransfers`/
  `refreshDeposits`, which the mount effect also calls — that turned a clean call into a
  `react-hooks/set-state-in-effect` error. Moved to the six save/post/delete handlers instead
  (`bumpBalances()`); the panels fetch on mount by themselves anyway. Changed files add **zero** new
  lint problems over baseline (TransferPage 1 and ReportKhaataPage 1 were both pre-existing,
  verified by linting the stashed originals).
- **Data correction:** two cheques deposited into Meezan (12,000 + 45,000) by an app instance still
  running the pre-fix `deposit()` had left no ledger rows. Migration 019 had already run, and it is
  a one-shot, so it did not pick them up — cleared its `schema_migrations` row and re-ran the
  (idempotent) backfill. Meezan Bank 292,000 → **349,000**, CHEQUES IN HAND 237,000 → 180,000,
  ledger nets to zero, no unbalanced document. Worth knowing for the rollout: the one-shot is
  correct for the upgrade path (install the new build → 019 backfills what exists → `deposit()`
  writes its own rows from then on), but any deposit made by an OLD instance after 019 has run needs
  the same manual re-run.
- **Files:** `frontend/src/components/AccountBalancePanel.tsx`, `frontend/src/pages/TransferPage.tsx`,
  `frontend/src/pages/ReportKhaataPage.tsx`

---

## Account setup — batch entry, and the two structural accounts protected

### 2026-08-10 — Going-live prep: dozens of accounts to create, safely
- **Framing established before building.** The user's real database `wentox` was found to be
  **already clean** — 17 chart accounts, 1 business account, zero customers/vendors/ledger rows. All
  demo data is confined to `wentox_demo`. And the system is **already generic**: nothing is
  hardcoded per account except the reserved *codes*, which the engine resolves by code, never by
  name or id. So the work was not "make it generic" — it was **volume** and **safety**.
- **Piece 1 — batch entry.** `businessAccounts.service#createBatch({ ac_id, accounts })`, mirroring
  `products.service#createBatch` rather than inventing a second pattern: every row validated before
  any is written, failures returned as `{ index, message }`, serials drawn per row **inside** the
  transaction so codes stay contiguous and concurrent batches cannot collide on
  `UQ_business_accounts_code`. Opening balances flow through the existing `syncOpeningEntries`, so a
  batched account posts its `OPENING` pair like any other. New `business-accounts:createBatch`
  channel; `businessAccounts` was already in `ipcBridge.ts`'s FEATURES — **verified rather than
  assumed**, since a missing entry there is what silently broke `settlements` earlier.
- **Piece 2 — protect the structural accounts.** `remove()` previously only blocked *party-linked*
  accounts, so **Cash in Hand and Journal Voucher could both be closed** — verified by query, both
  reported `NOT protected`. Closing Cash breaks every transfer and the Cash Book; closing the JV
  account breaks Journal Voucher posting. Now refused, and flagged `is_reserved` for a **System**
  badge on the setup screen.
- **A bug my own verification caught, worth recording.** The first guard compared the *parent chart
  account's* code against the full reserved set — which flagged **all 41 accounts**, because every
  business account sits under a reserved head (CUSTOMERS ACCOUNTS, Directors Drawings, …). That
  would have frozen the entire chart. Narrowed to `STRUCTURAL_ACCOUNT_HEADS` = the two heads that
  hold exactly ONE seeded account and are resolved by `ac_id` (`getCashAccount`, `getJvAccount`).
  Re-verified: 2 flagged, ordinary heads still closable, party accounts still handled by their own
  guard. **Being under a reserved head is not the same as being structural.**
- **A second, pre-existing bug found on the way:** `ApiError.badRequest(message, code)` accepted no
  `details` argument, so the `{ errors: [{ index, message }] }` that **`products.service#createBatch`
  has always passed** was silently discarded — a failed product batch could only ever say "one or
  more rows are invalid" with no way to mark the row. `ipc/wrap.js` was already forwarding
  `err.details`; only the factory dropped it. Added the parameter, matching `conflict()`. Fixes the
  products batch as a side effect.
- **Verified** on `wentox_demo`: an invalid row rejected the whole batch with both offending indices
  and wrote nothing (41 accounts before and after); a valid batch of 5 produced contiguous codes
  `4000030004`–`0008`; the two rows carrying opening balances each got 2 `OPENING` ledger rows with
  the trial balance still at difference **0**; a `USER` batching under Directors Drawings was
  refused; Cash and JV refused closure while an ordinary expense head still closed.
  `tsc -b` clean, `BusinessAcSetupPage` lint count identical to baseline (1).
- **Files:** `backend/src/errors/ApiError.js`,
  `backend/src/repositories/businessAccounts.repository.js`,
  `backend/src/services/businessAccounts.service.js`,
  `backend/src/ipc/businessAccounts.ipc.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/BusinessAcSetupPage.tsx`

---

## Opening balances are now real ledger entries (double-entry closed)

### 2026-08-10 — The one place the books did not balance
- **The hole:** `business_accounts.opening_balance` was a stored number that `netBalance()` added
  into an account's balance with **no counter-entry anywhere**. Every other document in the system
  posts two legs; an opening balance posted one. Proved before building: with none set, the trial
  balance was 2,357,736.60 on both sides; one 100,000 opening balance on a single customer threw it
  out by **exactly 100,000**, while `ledger_entries` itself still netted to zero — it never saw the
  opening balance at all.
- **Why it had become urgent:** opening balances were made enterable on five screens earlier the
  same day, and 2,000+ legacy accounts are due to be imported carrying balances. Zero existed in the
  database, so this was the cheapest possible moment — nothing to backfill.
- **Fix:** new reserved chart account **OPENING BALANCE EQUITY** (`200003`, under LIABILITY — there
  is no EQUITY class and what the business owes its owners is the closest fit). Setting an opening
  balance now writes a real `source_type='OPENING'` pair dated `opening_date`: positive → Dr account
  / Cr equity, negative → the reverse. **The schema anticipated exactly this** — `'OPENING'` was
  already in `CK_ledger_entries_src` and `ledger_entries`' own comment described these rows. It was
  designed and never built, so **no migration was needed at all**.
- **`opening_balance` stays the INPUT; the rows are DERIVED** and replaced whole on every change —
  delete-then-insert rather than update, because an opening balance can be cleared (no rows) or flip
  sign (the legs swap accounts), both of which an UPDATE would have to special-case.
- **Two places had to stop adding the stored column**, or it would double-count against its own
  rows: `netBalance()` (both ba_id branches) and `businessAccountBalancesAsOf()` (the trial balance).
- **Self-healing by design.** `syncOpeningEntries()` runs in its own transaction because party
  creation commits the business account inside a transaction it cannot join — so a failure could
  leave the stored input without its rows. `db/seeds/opening-balances.js` re-syncs every account on
  startup, which is both the backfill for pre-existing values and a standing repair. All four party
  creates (vendor/customer/employee/bank) sync after their commit, so a new account does not have to
  wait for a restart.
- **Verified:** the same 100,000 opening balance that previously broke the trial balance now leaves
  it at **2,457,736.60 / 2,457,736.60, difference 0**, with `ledger_entries` still netting to zero.
  Flipping to −40,000 kept it balanced; clearing removed both rows and returned the trial balance to
  its starting figures exactly. The account's own Khaata now opens with an "Opening Balance" row
  (Dr 50,000, dated 31-Dec-2025) and the equity account mirrors the total at −50,000. Cash Book,
  Sale Report, Vendor Report and Business Ledger all unchanged.
- **Still open from the same discussion, neither required for this fix:** routing the 13
  ledger-writing repositories through one guard that refuses unbalanced pairs, and surfacing a
  debits-vs-credits check in the app.
- **Files:** `backend/src/constants/reservedAccounts.js`,
  `backend/src/repositories/businessAccounts.repository.js`,
  `backend/src/services/businessAccounts.service.js`,
  `backend/src/services/{vendors,customers,employees,bankAccounts}.service.js`,
  `backend/src/repositories/reports.repository.js`,
  `backend/src/db/seeds/opening-balances.js` (new), `backend/src/db/seeds/run.js`

---

## Cheque screens — one standard column order everywhere

### 2026-08-10 — Six cheque tables, five different orders, now one
- **What was asked:** wherever cheque detail is shown, lead with
  **Received Date · Party Name · Cheque No · Due Date · Amount · rest**.
- **Survey first:** six tables across four screens, in five different orders — Disposal summary
  (print) and detail (screen), Cheque in Hand, Cheque Ledger (print + screen), Cheque Returns.
- **"Due date" = `cheques.cheque_date`, and that is evidenced, not assumed:** the index over it is
  named `IX_cheques_due` and commented "§12 cheque-due alerts". The alerts already treat the date
  written on the cheque as when it falls due; the screens were calling the same column "Cheque Date"
  and "Date on Cheque". Relabelled to **Due Date** so the UI agrees with the behaviour.
- **Two places the standard does not fit as written, both raised before building:**
  1. **Issued cheques** (ones we wrote, from `expenses`) have no received date and no receiving
     party — their party is who we *paid*. User chose an equivalent layout rather than blank
     columns: **Issue Date · Paid To · Cheque No · Due Date · Amount**.
  2. **Cheque Ledger is an event log**, not a cheque list — its date column is the *event* date and
     deliberately differs per row. It keeps that as the leading date and gains Due Date as its own
     column, so the field order still reads the same left-to-right.
- **One backend addition:** `cheque_allocations` rows carried no cheque date, so the Returns table
  had no Due Date to show for an endorsed cheque. Added `ch.cheque_date` / `ch.cheque_received_date`
  to that query.
- **A bug caught by reading rather than by tooling:** reordering the on-screen Cheque Ledger left a
  duplicate `{r.party}` cell after Event, so the row had 10 cells against 9 headers — every column
  from Bank rightward would have rendered one place off. `tsc` cannot see this (JSX cell counts are
  not typed) and it produces no error, just silently wrong columns. Wrote a header-vs-cell counter
  across all six tables afterwards; all now match (9/9, 9/9, 6/6, 7/7, 7/7).
- **Also updated the Disposal Excel export** to the same order — it had its own hardcoded header
  list that would otherwise have disagreed with the screen it exports.
- **Verified:** `tsc -b` clean; ChequesTab 0 lint errors, the other three carry 1 each — all the
  pre-existing `react-hooks/set-state-in-effect` on their mount loaders, none introduced here (the
  changes are JSX reordering only).
- **Note:** a `git stash` used for a lint baseline comparison was interrupted by a command timeout
  before its `pop`, leaving the work stashed. Recovered intact with `git stash pop`. Avoid
  stash-based baselines inside a single timed command.
- **Files:** `backend/src/repositories/cheques.repository.js`, `frontend/src/lib/api.ts`,
  `frontend/src/components/ChequesTab.tsx`,
  `frontend/src/pages/{ChequeInHandContent,ChequeLedgerContent,ChequeReturnsContent}.tsx`

---

## Products — one system vendor, "Manufacturing Product" (migration 017)

### 2026-08-10 — The product form's vendor field locked to a single system vendor
- **What was asked:** the vendor input on Add New Product "doesn't have any work here", so point it
  permanently at a Manufacturing Product account that cannot be changed.
- **Two corrections established before building, both confirmed with the user:**
  1. **It could not be a business account.** `articles.vendor_id` is `NOT NULL` with an FK to
     `dbo.vendors`, so the row has to be a **vendor**; creating one auto-creates its business
     account under VENDORS ACCOUNTS, which gives the account for free.
  2. **The field is not decorative.** It scopes batch numbering (`batch_no = MAX + 1` per vendor,
     protected by `UQ_articles_vendor_batch`) and the duplicate-name rule (name + vendor). Both
     simply become global now, which is arguably better — two vendors could previously each hold a
     "P-101".
- **The blocker, and why it dissolved:** moving the 5 existing articles onto one vendor violates
  `UNIQUE (vendor_id, batch_no)` — three shared batch 1 and two shared batch 2, legal only because
  they sat under different vendors. Renumbering meant rewriting numbers the schema calls
  "immutable". Traced `batch_no` end to end first: **never typed, never edited, never rendered on
  any screen, and read by nothing except its own MAX + 1.** The user confirmed batch numbers mean
  nothing outside the app, so renumbering is invisible. That turned a blocking decision into a
  non-issue — worth the twenty minutes it took to check rather than warning about a promise nothing
  depended on.
- **How it was done:** migration 017 adds `vendors.is_system` with a **filtered unique index**
  (`WHERE is_system = 1`), so at most one can ever exist. A flag, not a name match — `dbo.vendors`
  has no code column and deliberately no `UNIQUE(name)`, so matching on the string would break the
  moment anyone added a second "Manufacturing Product". The row itself is seeded in
  `db/seeds/manufacturing-vendor.js`, not the migration, because it needs the VENDORS ACCOUNTS
  chart account and reserved accounts are seeded *after* migrations run.
- **The move is one statement** — `UPDATE … SET vendor_id = @mfg, batch_no = ROW_NUMBER() OVER
  (ORDER BY article_id)`. Setting the vendor first and renumbering second would trip the unique
  constraint mid-flight. Idempotent: re-running matches nothing.
- **The lock is server-side.** `products.service.js#create()` and the batch-create path both ignore
  whatever `vendor_id` arrives and resolve the system vendor themselves, so a disabled input is not
  the only guard. `vendors.service` now refuses to rename or deactivate the system row — either
  would silently break product creation.
- **Hidden where it would invite a wrong entry** (user's choice): excluded by default from the
  Purchase / Purchase Return vendor dropdowns, Vendor Report, the Expenses "who to pay" picker,
  Vendor Setup and the Cheques tab. Two callers pass `includeSystem: true` — the product form, and
  Product Ledger's read-only "Company (Vendor)" filter, which the user chose to keep and which
  would otherwise be unable to select the only vendor that has any products. `ReportStockPage` keeps
  the default: its vendor list is the Vendor Stock tab (raw materials from real suppliers), and you
  do not buy materials from your own factory.
- **Verified:** all 5 articles moved and renumbered 1–5; re-running the seed moved nothing; a
  product created while deliberately naming a real vendor stored as **Manufacturing Product**;
  renaming and deleting the system vendor were both blocked; `vendors.list()` returns 3 vendors by
  default and 4 with `includeSystem`. `tsc -b` clean, both changed pages' lint counts identical to
  baseline (1 and 1).
- **Files:** `backend/src/db/migrations/017_manufacturing_product_vendor.sql` (new),
  `backend/src/db/seeds/manufacturing-vendor.js` (new), `backend/src/db/seeds/run.js`,
  `backend/src/repositories/vendors.repository.js`,
  `backend/src/services/{vendors,products}.service.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/{ProductSetupPage,ProductLedgerContent}.tsx`

---

## Opening balances — settable on every account-opening screen, and editable

### 2026-08-10 — Was create-only on two screens and editable on none
- **What was actually wrong** (narrower and wider than "we can't edit it"):
  - **Business Account** and **Bank** screens already asked for an opening balance on create.
  - On the Business Account screen the fields were wrapped in `{!selectedId && …}` — **hidden
    entirely when editing**, and `businessAccounts.service#update()` only ever passed
    `name`/`region_id`/`city_id` to the repository, whose UPDATE didn't mention the opening columns
    at all. So there was no route to change one after creation, on any screen.
  - **Vendor, Customer and Employee** never asked, despite each auto-creating a business account —
    which matters now that 2,000+ legacy accounts are coming over with balances attached.
- **Fix:** `repository.update()` now writes the pair; `updateOpening()` added for the party screens,
  which own name/region/city on their own row and must not have them overwritten. The paired
  both-or-neither check moved into a shared `validateOpeningPair()` used by create, update and all
  four party services, so every screen rejects a half-filled pair identically. Vendor, Customer and
  Employee forward the pair into `createUnderChartCode`'s extra, exactly as `bankAccounts.service`
  always has.
- **A data-loss trap caught before it shipped.** The party pages cannot *show* the current opening
  balance on edit — it lives on the linked business account and none of those three repositories
  join it. An untouched edit form would therefore have sent blanks and **wiped the opening balance
  on every unrelated rename**. `setOpening()` now applies only when the caller actually supplied one
  of the keys. Consequence, stated rather than papered over: party screens can **set and change** an
  opening balance but not clear it; the Business Account screen (which does load the stored values)
  remains the place to view, change or clear one.
- **`OpeningBalanceFields.tsx`** shared by all four screens so the wording, the both-or-neither hint
  and the warning cannot drift between copies. When editing an existing account it warns plainly
  that this **rewrites past balances and reports** with no reversing entry — because
  `opening_balance` is a stored input `netBalance()` adds in, not a ledger row — and points at a
  Journal Voucher for anything that actually happened. Per the user's choice, no role gate.
- **Verified** end to end: vendor created with 25,000 opening → balance 25,000; changed via the
  vendor screen → 40,000; changed via the Business Account screen (the path that previously had no
  effect) → 12,345; cleared → 0; a rename carrying no opening keys left 7,000 **untouched**; an
  unpaired balance was rejected; and an opening dated 2027 correctly counted as 0 today. `tsc -b`
  clean; all four pages' lint counts identical to baseline (1/1/2/1) and the new component 0.
- **Files:** `backend/src/repositories/businessAccounts.repository.js`,
  `backend/src/services/{businessAccounts,vendors,customers,employees,bankAccounts}.service.js`,
  `frontend/src/components/OpeningBalanceFields.tsx` (new), `frontend/src/lib/api.ts`,
  `frontend/src/pages/{BusinessAcSetupPage,VendorSetupPage,CustomerSetupPage,EmployeeSetupPage}.tsx`

---

## Bridge allow-list — `settlements` and `journalVouchers` were never registered

### 2026-08-10 — window.api.<feature> undefined; symptom surfaced as an empty dropdown
- **Reported as** "when I select account in JV it says no matching option". The account fetch was
  fine. `frontend/src/lib/ipcBridge.ts` keeps an explicit `FEATURES` allow-list and neither new
  feature was in it, so `window.api.journalVouchers` was **undefined** and the call threw a
  TypeError rather than returning a failed ApiResult. On the JV page that aborted the whole loader
  (`Promise.all([listBusinessAccounts(), journalVouchers.account()])`), so `setAccounts` never ran
  and the dropdown had zero options.
- **`settlements` was missing too** — so the Receipts "Endorse" option shipped in `6c07a777` was
  broken in exactly the same way, and reported as working. Backend verification ran against the
  services directly, which never touches the bridge, so the gap was invisible to it. **Lesson:
  service-level verification does not prove a feature reaches the screen.**
- **Also keyed wrongly:** `window.api['journal-vouchers']`. The bridge keys by the CAMEL feature
  name and derives the kebab wire channel itself, so that lookup would have stayed undefined even
  once registered.
- **Root cause of the miss:** `backend/CLAUDE.md`'s "adding a feature" checklist said to add the
  name to `electron/preload.js`'s `FEATURES` array. That array does not exist there — preload has
  exposed a single `__ipcInvoke` primitive since the contextBridge/Proxy fix, and the real list is
  in `ipcBridge.ts`. The checklist has been corrected, with a note on the failure mode, and
  `ipcBridge.ts` now says why the allow-list fails loudly-but-elsewhere.
- **Files:** `frontend/src/lib/ipcBridge.ts`, `frontend/src/lib/api.ts`, `backend/CLAUDE.md`

---

## Journal Voucher (UC-40, migration 016)

### 2026-08-10 — Goodwill written off a party's balance, with its own account and ledger
- **What:** a customer with an outstanding payable asks for an *eidi* — a concession on what they
  owe. Not a payment, not a discount on the sale: compensation granted afterwards. The amount comes
  off their balance and the cost lands on a dedicated **JOURNAL VOUCHER** account. Any business
  account can be named, not just customers. New page under Transactions with two tabs: entry, and
  the JV account's own ledger.
- **Two things it is deliberately NOT, both flagged to the user before building:**
  - **Not commission.** `receipts.commission` (§7) only exists attached to a receipt and only for a
    customer. A JV stands alone.
  - **Not a Deposit.** `dbo.deposits` (Module 4b) is structurally almost identical — a one-sided
    CREDIT/DEBIT adjustment against the *Miscellaneous Adjustments* chart account. The user chose to
    keep both rather than merge: a JV counters against a real **business account**, so "what have we
    given away in JVs" is an openable ledger instead of a figure buried in a mixed head.
- **Posts as** (both legs `ba_id`, `source_type='JOURNAL_VOUCHER'`): CREDIT → Dr JV BA / Cr party
  BA (what they owe us falls); DEBIT → the reverse (what we owe them falls). Both directions were
  the user's call — with any account selectable, the reverse case arrives eventually and adding it
  later would be a migration.
- **The JV account is a business account, not just a chart head** — that is what makes the ledger
  openable, since `ledger_entries` needs a `ba_id` to point at. Seeded like Cash is;
  `ensureCashBusinessAccount` was generalised to `ensureNamedBusinessAccount` and the cash-specific
  duplicate removed, so both reserved single-account heads share one helper.
- **Reports, per the user's explicit wording** ("shouldn't have a separate column — a separate row
  record that JV of this amount was applied"): Sale Report and Vendor Report gain a **row beneath
  the party**, shown only when non-zero, never a column and never folded into Payment Received or
  Net Sales. A JV reduces what is owed but is not money collected; folding it in would make
  collections read higher than the cash actually taken.
- **Guards:** `reason` is NOT NULL and rejected when blank — an unexplained write-off against a
  party balance is exactly the entry that gets questioned later. A JV against the JV account itself
  is blocked (both legs would land on one account). `assertAccessible` applies, so a USER cannot
  raise a JV against a restricted account.
- **Verified end to end** on `wentox_demo` with Ahmed Footwear: a 3,000 CREDIT moved the party
  **−3,000** and the JV account **+3,000**, the report row read 3,000 while **Payment Received
  stayed 134,500 unchanged**, both ledgers carried the reason ("Journal Voucher #1 — Eid
  compensation" / "JV #1 to Ahmed Footwear — Eid compensation"), the Cash Book showed nothing, a
  DEBIT of 500 moved the balance the other way, self-JV and blank-reason were both rejected, and
  unpost + delete restored both balances exactly. `tsc -b` clean; the two report pages' lint counts
  are identical to baseline (1 and 2), and the new page carries one — the `set-state-in-effect`
  pattern every page here shares, after the avoidable second instance was refactored out.
- **Files:** `backend/src/db/migrations/016_journal_vouchers.sql` (new),
  `backend/src/repositories/journalVouchers.repository.js` (new),
  `backend/src/services/journalVouchers.service.js` (new),
  `backend/src/ipc/journalVouchers.ipc.js` (new), `backend/src/ipc/index.js`,
  `backend/src/constants/reservedAccounts.js`, `backend/src/db/seeds/run.js`,
  `backend/src/services/businessAccounts.service.js`,
  `backend/src/repositories/reports.repository.js`, `backend/src/services/reports.service.js`,
  `frontend/src/pages/JournalVoucherPage.tsx` (new), `frontend/src/lib/api.ts`,
  `frontend/src/pages/{SaleReportPage,VendorReportPage}.tsx`, `frontend/src/App.tsx`,
  `frontend/src/components/AppLayout.tsx`, `frontend/src/types/index.ts`,
  `System_architecture/{use_cases.md,database_schema_v4.3.md}`

---

## UC-03 — server-side role enforcement (was UI-only)

### 2026-08-10 — Restricted accounts guarded on the account, not the channel
- **The gap:** every cheque and expense IPC channel called `requireSession()` and nothing more.
  `requireRole` existed but only `backup` and `auth` used it. So role restriction was enforced
  *entirely by hiding things on screen* — exactly what UC-03 point 3 warns against ("hiding a nav
  item is never the only guard").
- **The request was "add requireRole to cheque and expense channels"; that alone would have been
  both too much and too little,** and the user agreed to the split after it was laid out:
  - **Too much** — 13 of those 22 channels are ordinary expense entry. Locking them stops a `USER`
    recording any expense, contradicting UC-03's own written decision that "Receipts/Expenses entry
    remain intentionally unrestricted for `User` — the restriction is about *visibility*".
  - **Too little** — the actual exposure is the **account**, not the channel. A `USER` blocked from
    `expenses:create` would simply have reached a Directors-Drawings account through
    `receipts:create` or `settlements:create`, neither of which is a "cheque or expense" channel.
- **Two pieces, both done:**
  1. **`requireRole('ADMIN')` on the six cheque disposal channels** (`deposit`,
     `endorse-to-vendor`, `endorse-to-expense`, `mark-cleared`, `bounce`, `return-to-sender`) — the
     ones the Cheque page already treats as admin-only, so nothing that works today stops working.
     Deliberately NOT the Returns actions (`reverse-allocation`, `bounceIssuedCheque`,
     `returnIssuedCheque`): a `USER` can do those today and could before the Cheque page existed —
     verified against `c8125838^` rather than assumed — so locking them would remove behaviour
     rather than close a gap.
  2. **`businessAccounts.service.js#assertAccessible(baId, session)`** — UC-03 point 4's 403.
     Called by expenses (on the resolved target), receipts, and settlements (**both** sides) on
     create and update. The guard lives on the account, so a new document type cannot forget it by
     picking a different channel name.
- **`session` omitted = trusted internal caller** (seeds, scripts). Those run as the machine, not a
  person; the ipc layer always has a real session and always passes it, which is where untrusted
  input actually arrives. Without this the demo seed would have started failing.
- **Verified with a real USER session against `USMAN BHATTI`** (under Directors Expenses - Drawings):
  `expenses.create`, `receipts.create` and `settlements.create` (as payee) **all blocked** with
  "This account is restricted to administrators"; the same USER against `Aslam Cutter` **allowed**;
  ADMIN against the restricted account **allowed**; a no-session internal call **allowed**. All
  services still load and list (expenses 13, receipts 16), cash book and alerts unchanged.
- **Docs:** UC-03's rework note said "server-side enforcement does not exist at all yet" — replaced
  with what is now actually enforced, including what is deliberately still open and why.
- **Files:** `backend/src/ipc/cheques.ipc.js`, `backend/src/ipc/{expenses,receipts,settlements}.ipc.js`,
  `backend/src/services/businessAccounts.service.js`,
  `backend/src/services/{expenses,receipts,settlements}.service.js`,
  `System_architecture/use_cases.md`

---

## Cross-cutting — "today" was UTC everywhere; now local, and defined once

### 2026-08-10 — `src/utils/dates.js`; eight copies of a UTC date formatter replaced
- **What:** `new Date().toISOString().slice(0, 10)` had been copy-pasted into eight files as the
  definition of "today". `toISOString()` converts to UTC first, so in PKT (UTC+5) the server's
  "today" is still **yesterday between 19:00 and midnight local**. Every business date in WentoX is
  a local one — the pickers emit local dates, a business day is a local day — so this was simply
  wrong, for five hours a day, in eight places.
- **It was not cosmetic.** Found via Direct Settlement: a settlement dated today moved **no balance
  at all**, because `accountBalance()`'s `up_to_date` cutoff excluded it. Same cutoff made the
  Receipts/Expenses balance panel read stale every evening and opened the Cash Book a day behind.
- **A second, worse instance found during this sweep:** `cashBook()`'s month range was built as
  `new Date(y, m-1, 1).toISOString()`. That Date is LOCAL midnight, so converting to UTC shifted
  **both ends back a day** — "August" was really **31-Jul → 30-Aug**, silently including the
  previous month's last day and dropping the selected month's. Confirmed directly:
  `2026-07-31 -> 2026-08-30` before, `2026-08-01 -> 2026-08-31` after.
- **Fix:** new `src/utils/dates.js` — `toISODate()` (formats from local `getFullYear/getMonth/
  getDate` parts, no timezone conversion at all), `todayISO()`, `daysFromNowISO()`. One definition,
  imported everywhere, so a ninth copy cannot drift.
- **Changed:** the six document services' `resolveDateRange` (`saleBills`, `saleReturns`,
  `purchases`, `purchaseReturns`, `receipts`, `expenses` — Weekly/Monthly tabs), `reports.service`'s
  own `resolveDateRange` **and** its cash-book month range, and `alerts.service`'s
  `todayISO`/`cutoffISO`/`toISODate` — the last of which shifted **when a cheque-due alert fires**,
  not merely which rows a list showed.
- **Deliberately left alone: `salaryRuns.service.js`.** Its `period_month` normalisation is UTC on
  purpose and self-consistent (`Date.UTC` in, `getUTC*` out); changing it would be churn, not a fix.
- **`backend/CLAUDE.md` updated** — `src/utils/` is a new folder and the layer list is meant to be
  the truth about the structure.
- **Verified:** every changed service smoke-tested across weekly/monthly/overall
  (saleBills 2/2/14, saleReturns 0/0/3, purchases 0/0/6, purchaseReturns 0/0/2, receipts 5/6/16,
  expenses 4/4/13); `alerts.refreshAlerts()` returned 4 alerts; the August cash book now spans
  01–31 Aug and its summary reconciles (42,500 + 18,500 − 26,768 = 34,232).
- **Files:** `backend/src/utils/dates.js` (new), `backend/src/services/{saleBills,saleReturns,
  purchases,purchaseReturns,receipts,expenses,reports,alerts}.service.js`, `backend/CLAUDE.md`

---

## Direct Settlement — endorse a payment from the Receipts screen (UC-39, migration 015)

### 2026-08-09 — Debtor pays our creditor directly; no cash, bank or cheque involved
- **What:** on Receipts (Jamma), ticking **"Endorse this payment to another account"** reveals a
  *Pay To* picker. Saving writes a `settlements` row instead of a `receipts` row: the payer settles
  their debt by paying one of OUR creditors directly. Both obligations shrink and **no money passes
  through cash, bank or the cheque drawer**. Distinct from cheque endorsement (UC-27), which needs a
  physical cheque already in CHEQUES IN HAND — this needs no instrument at all.
- **Built as a standalone page first, then moved.** The user's follow-up was explicit: no new page,
  put it on Receipts. The page was deleted (`DirectSettlementPage.tsx`, its route, its NavPage entry
  and its sidebar item all removed); the service/repository/IPC layer survived unchanged, which is
  the payoff for having kept the document type separate from its UI.
- **Posts as** Dr `to_ba_id` (our creditor) / Cr `from_ba_id` (our debtor), `source_type='SETTLEMENT'`.
  **Both legs carry `ba_id` and neither carries `ac_id`.** With no chart account on either side there
  is nowhere for it to reach CASH IN HAND, a bank or CHEQUES IN HAND — the isolation is structural,
  not a rule every report must remember.
- **New table rather than reusing `dbo.transfers`,** which has the identical shape. Transfers means
  "money between OUR OWN accounts" and its schema note says "USED BY: every cash/bank balance (both
  sides); Cash Book"; `cash_and_bank.md` §10's balance formula includes transfers by definition.
  Overloading it would mean auditing every consumer of `source_type='TRANSFER'`. A separate table
  keeps "every TRANSFER is cash" true.
- **`payment_mode`/`cheque_no`/`cheque_date` are INFORMATION only** (user's choice over hiding the
  fields). They record how the *other two parties* transacted and select no posting target, since no
  mode can make a settlement touch our accounts. `CK_settlements_cheque` rejects a cheque number on
  a non-cheque mode rather than storing a contradiction. The ONLINE bank picker is hidden while
  endorsing — no bank of ours receives anything — and so is Commission.
- **Counts as payment in both party reports** (user's choice): Sale Analysis / Sale Report "Payment
  Received" via `from_ba_id`, Vendor Report "Payment Paid" via `to_ba_id`. The debt really was
  settled, so omitting it would leave a squared-up party looking permanently outstanding.
- **Two bugs caught while building:**
  1. The settlements subquery in `saleAggregateByCustomer()` was first written as
     `receiptWhere.replace('receipt_date', 'settlement_date')`. `String.replace` with a string
     argument swaps only the FIRST occurrence, so the `date_to` half kept pointing at a column
     `settlements` does not have — fine with no date filter, broken the moment a range was picked.
     Now built from its own column name.
  2. **`todayISO()` returned the UTC date, not the local one.** In PKT (UTC+5) that means between
     19:00 and midnight local, the server's "today" is still YESTERDAY. A settlement dated today
     moved no balance at all, because `accountBalance()`'s `up_to_date` cutoff excluded it — the
     balance panel read stale for five hours every evening, and the Cash Book opened on the previous
     day. Every business date here is a local one (the pickers emit local dates, a business day is a
     local day), so `reports.service.js#todayISO()` now formats from local parts with no timezone
     conversion. **The same UTC pattern exists in seven other services'
     `resolveDateRange` helpers** — those only affect the weekly/monthly filter convenience, not a
     balance, so they are flagged rather than changed.
- **Verified end to end** on `wentox_demo`: a 5,000 CHEQUE endorsement (Ahmed Footwear →
  Al-Madina Rubber) dated **local today** moved customer **−5,000** and vendor **+5,000**, left
  **Cash In Hand unchanged**, wrote explicit narrations on both ledgers ("Settled directly to
  Al-Madina Rubber" / "Settled directly by Ahmed Footwear"), showed nothing on the Cash Book, and
  unpost + delete restored both balances exactly. A cheque number on a CASH settlement was rejected.
  Migration 015 was extended in place rather than adding a 016, since it had not been pushed —
  the table was dropped, its `schema_migrations` row deleted, and the migration re-applied clean.
  `tsc -b` clean; ReceiptsPage's lint count unchanged from its pre-existing baseline.
- **Files:** `backend/src/db/migrations/015_direct_settlements.sql` (new),
  `backend/src/repositories/settlements.repository.js` (new),
  `backend/src/services/settlements.service.js` (new), `backend/src/ipc/settlements.ipc.js` (new),
  `backend/src/ipc/index.js`, `backend/src/repositories/reports.repository.js`,
  `backend/src/services/reports.service.js`, `frontend/src/pages/ReceiptsPage.tsx`,
  `frontend/src/lib/api.ts`, `System_architecture/database_schema_v4.3.md`,
  `System_architecture/use_cases.md`

---

## Cash Book — cheque endorsements were missing from the outflow columns

### 2026-08-09 — `cheque_allocations` added as a third Cash Book source; stale doc note corrected
- **Cause was a bad assumption, not a bad design.** `use_cases.md` UC-37 carried a note saying
  cheque allocations "do not exist yet"; that was taken at face value while building the Cash Book,
  so `cashBookNonCashRows()` read only `receipts` and `expenses`. Cheque endorsement has in fact
  been built for some time — eleven `cheques:` IPC channels (`endorse-to-vendor`,
  `endorse-to-expense`, `reverse-allocation`, …), UC-27 marked ✅, and live `cheque_allocations`
  rows in the demo data. **Lesson already on record and not applied: design docs are historical
  intent, not current state — check the code.**
- **Symptom:** a VENDOR_PAYMENT endorsement never appeared anywhere on the Cash Book. Verified
  before the fix — allocation #3 (20,000, dated 2026-08-01) produced a completely empty report for
  that date, despite UC-37 explicitly requiring "an endorsed cheque posts as an outflow on its
  allocation date". EXPENSE_PAYMENT endorsements were fine by accident: they carry an `expense_id`,
  so their `expenses` row (`payment_mode='CHEQUE_ENDORSED'`) was already being picked up.
- **Fix:** third UNION branch over `cheque_allocations`, filling Payments Cheq./Online and naming
  the target vendor. **VENDOR_PAYMENT + ACTIVE only** — the other two dispositions are excluded
  because including them would double-count, which is the whole reason this needed care rather than
  a blanket join:
  - `EXPENSE_PAYMENT` → already present via its `expenses` row (see above).
  - `DEPOSIT` → an internal asset move (Dr bank / Cr CHEQUES IN HAND), not new money; the receipt
    that brought the cheque in already appears as a Receipts Cheq./Online row on its own date.
  - `REVERSED` → the bounce/return cascade already put the money back.
- **Verified** on `wentox_demo` across all three allocation rows: 01-Aug now shows
  `Al-Madina Rubber | CHEQUE 91002233 | Payments Cheq./Online 20,000` with `cash_in_hand` unchanged
  at 42,500 (view-only, as required); 08-Jul (allocation #2, REVERSED) and 23-Jun (allocation #1,
  DEPOSIT) both correctly still show nothing; the August month view shows the endorsement exactly
  once, no duplication.
- **Docs:** UC-37's note rewritten to describe what actually runs, including why the two
  dispositions are excluded, with an explicit dated correction of the false "does not exist yet"
  claim so the next reader does not repeat it.
- **Files:** `backend/src/repositories/reports.repository.js`,
  `backend/src/services/reports.service.js`, `System_architecture/use_cases.md`

---

## Receipts (Jamma) — Post/Unpost buttons were missing entirely

### 2026-08-09 — Every receipt entered through the UI was stranded as an invisible DRAFT
- **Found via a user report** ("I paid Aslam Cutter 2000 but its balance doesn't update"). The
  entry turned out to be on the wrong screen — recorded as Jamma (money received) rather than Naam —
  but chasing it exposed a much bigger, pre-existing bug behind it.
- **The bug:** `receipts.service.create()` always inserts `status='DRAFT'` and only `post()` writes
  `ledger_entries`. `receipts:post` / `receipts:unpost` exist on the backend **and** are declared in
  `frontend/src/lib/api.ts` — but `ReceiptsPage.tsx` never called either one. Confirmed pre-existing
  with `git show HEAD:...ReceiptsPage.tsx` → zero `receipts.post`/`unpost` calls. So **every receipt
  ever entered through that screen sat as a DRAFT forever and never reached the ledger, any balance,
  or any report.** The 13 receipts in the demo dataset look fine only because
  `dev-sample-data.js` calls `receiptsService.post()` directly in code, bypassing the UI.
  The page's one "Confirm" button belongs to the separate `draft_receipts` table — a different
  feature that happens to share the word.
- **Fix:** Post / Unpost buttons mirroring `ExpensesPage#handlePost/handleUnpost` (the user chose
  this over auto-posting on save, keeping the two money screens consistent). Edit is now hidden once
  posted, matching Expenses. `CHEQUE_IN_USE` from unpost surfaces in the banner rather than the
  button being hidden — same choice ExpensesPage already made for its own reversal guard.
- **Also made the state visible**, since an unposted receipt looked identical to a posted one: the
  form header now shows an amber "Not Posted" badge (tooltip: "Saved but not yet in the ledger")
  instead of showing nothing at all when unposted. Fixed the receipts list's stale "Customer" column
  header → "Account", left over from migration 014.
- **Data cleanup:** deleted the user's two duplicate 2,000 DRAFT receipts (#1004, #1005) against
  Aslam Cutter at their request. Neither had posted, so nothing needed reversing; his balance is
  unchanged at 1,032 (9,000 Dr from expense #9 less 7,968 Cr from wage run #1). The real payment
  will be entered by the user as an Expense.
- **Files:** `frontend/src/pages/ReceiptsPage.tsx`

---

## Receipts / Expenses — account balance shown on selection

### 2026-08-09 — "Balance before → after" panel on both money-entry screens
- **What:** Picking an account on Receipts (Jamma) or Expenses (Naam) now shows its balance, the
  effect of the entry being typed, and the balance that will result — live, before saving. This is
  UC-25 steps 1 and 4 ("the current outstanding balance is shown inline" / "the screen shows BOTH
  figures explicitly"), which were specified but never built.
- **New `reports:account-balance`** → `reports.service.accountBalance({ ba_id })` →
  `repository.netBalance()`. Deliberately **not** `accountLedger()`: that fetches every ledger row
  just to derive a closing balance, which is far too much work to put behind a dropdown's onChange.
  `netBalance()` sums in SQL **and** adds `business_accounts.opening_balance`, which a plain
  `ledger_entries` sum would miss for an account whose history predates WentoX.
- **Signs run opposite on the two screens**, which is the whole reason the panel takes signed
  `lines` from its caller rather than computing them itself: a receipt **credits** the selected
  account (`−amount`, `−commission`), an expense **debits** it (`+amount`). Commission's line is
  suppressed for non-customer accounts, matching where the field itself is hidden.
- **Shared `AccountBalancePanel.tsx`** so the two screens cannot drift. Labels are Receivable /
  Payable / Settled on the absolute value rather than Dr/Cr — the ledger reports already carry the
  accounting vocabulary; this screen is read by people thinking in who-owes-whom.
- **Two correctness details:** an in-flight request is cancelled when the account changes, and the
  fetched value is stored *with* its `ba_id` so switching accounts derives back to "loading" instead
  of briefly showing the previous account's balance. The second also keeps the component free of
  `react-hooks/set-state-in-effect`, which a synchronous reset inside the effect would have tripped.
  A `refreshKey` bumped after every post/unpost/confirm stops the figure going stale.
- **Verified** against `wentox_demo`: `accountBalance()` matched `accountLedger().closing_balance`
  plus `opening_balance` for four accounts across both signs (customers positive/Receivable,
  vendors negative/Payable). Then posted a 5,000 + 500 commission receipt against a vendor account —
  actual post-save balance `-162,650` equalled the panel's predicted `before − amount − commission`
  exactly; unpost + delete restored `-157,150`. `tsc -b` clean, new component lints clean, and the
  two pages' pre-existing lint counts are unchanged.
- **Files:** `frontend/src/components/AccountBalancePanel.tsx` (new),
  `backend/src/services/reports.service.js`, `backend/src/ipc/reports.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/ReceiptsPage.tsx`,
  `frontend/src/pages/ExpensesPage.tsx`, `System_architecture/use_cases.md`

---

## Receipts (Jamma) — any business account, not just customers

### 2026-08-09 — `receipts.customer_id` → `receipts.ba_id` (migration 014)
- **What:** Jamma could only ever name a **customer**, because `dbo.receipts.customer_id` was
  `NOT NULL` with an FK to `dbo.customers`. Money coming back from a director, an employee, a
  vendor or a bank had nowhere to go. Replaced `customer_id` with `ba_id` on `dbo.receipts` **and**
  `dbo.draft_receipts`, so Jamma now works exactly like Naam has all along.
- **The Naam side needed no change at all.** `ExpensesPage` already builds its picker from
  `listBusinessAccounts()`, which filters nothing beyond hiding restricted-parent accounts from the
  USER role. Only Receipts was restricted, and the restriction was in the schema, not the UI.
- **No information lost, and one useful side effect.** `customers.ba_id` has a UNIQUE filtered
  index, so "which customer paid this" is still answerable via `JOIN customers c ON c.ba_id =
  r.ba_id` — and that join *automatically excludes* non-customer receipts, which is why
  `saleAggregateByCustomer()` (Sale Analysis / Sale Report "Payment Received") stays correct after
  being re-grouped from `customer_id` to `ba_id`. Money from a director can never inflate a
  customer's payment total.
- **Migration aborts rather than degrades.** `customers.ba_id` is nullable (TASK-05's "add customer
  account first"), so the backfill can leave a row behind. 014 `THROW`s with an actionable message
  instead of silently keeping the column nullable. Verified zero such rows before running it.
- **Posting got simpler:** `postWithinTransaction()` no longer resolves a customer to find a ba_id —
  it credits `receipt.ba_id` directly, and the old `NO_CUSTOMER_ACCOUNT` guard is gone, since
  `ba_id` is a NOT NULL FK. `cheques.service.js`'s bounce/return reversal likewise credits
  `receipt.ba_id`. Both files dropped their now-unused `customers.service` import.
- **Wider blast radius than expected** — every query joining `receipts → customers` had to move to
  `receipts → business_accounts` with an optional customers hop: `cheques.repository` (2 queries),
  `alerts.repository#chequeDueRows` (the cheque-due alert detail now names the account),
  `reports.repository#ledgerRows` (`rc_customer_name` → `rc_account_name`) and `cashBookNonCashRows`.
  Frontend: the three Weekly/Monthly/Overall Receipts tabs grouped their cards by `customer_id` and
  now group by `ba_id`; `ChequesTab` labels fall back to `account_name`.
- **Commission is now customer-only.** It is payment-time trade discount to a customer (§7) and has
  no meaning on money from a director or a bank, so the field is hidden — and stripped from the
  payload — unless the selected account belongs to a customer.
- **Verified end to end** against `wentox_demo`: migration applied, `customer_id` gone, all 13
  seeded receipts backfilled and still resolving to their customers. Then created + posted a 7,500
  CASH receipt against **USMAN BHATTI** (an imported directors account, definitively not a
  customer): ledger wrote Dr CASH IN HAND / Cr USMAN BHATTI, it appeared in the Cash Book under its
  own name, and Sale Analysis `total_payment` was **395,500 before and after** — unchanged, as
  required. Unpost + delete then cleaned it back out. `tsc -b` clean; eslint problem count identical
  to the pre-change baseline (3 pre-existing `set-state-in-effect` errors).
- **Docs now behind:** `database_schema_v4.3.md` and `use_cases.md` still describe
  `receipts.customer_id`. Not updated in this pass.
- **Files:** `backend/src/db/migrations/014_receipts_any_business_account.sql` (new),
  `backend/src/repositories/{receipts,draftReceipts,cheques,alerts,reports}.repository.js`,
  `backend/src/services/{receipts,draftReceipts,cheques,alerts,reports}.service.js`,
  `backend/src/db/seeds/dev-sample-data.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/ReceiptsPage.tsx`,
  `frontend/src/components/{Weekly,Monthly,Overall}ReceiptsTab.tsx`,
  `frontend/src/components/ChequesTab.tsx`

---

## UC-37 Cash Book — columns and summary reworked to the client's layout

### 2026-08-09 — Cash Book gains cheque/online columns; summary moved to the end
- **What:** The client supplied a photo of their old system's cash book. Adopted its *content* —
  nine columns (S# / Account Name / Remarks / Type / Cheque No / Receipts Cheq.-Online / Payments
  Cheq.-Online / Receipts Cash / Payments Cash), a Totals row across the four amount columns, and
  the five-line cash summary (Opening Cash / Cash Received (Jamma) / Total Cash / Cash Paid (Naam) /
  Cash In Hand) **moved from the top of the page to the end**, on screen and in print. The running
  **Balance** column is gone — the reference has none.
- **Explicitly NOT adopted: the legacy report's visual style.** A first pass rebuilt the page in the
  old system's look (red title, blue headers, dense hairline grid, bare numbers) and the user
  rejected it — the app's own design language stays, only the layout of the content changes. If a
  future reference photo arrives, copy what the columns *say*, not how they look.
- **The real problem was not styling.** `cashBook()` read *only* the CASH IN HAND ledger, so the two
  Cheq./Online columns could never have held anything: a CHEQUE receipt posts to CHEQUES IN HAND and
  an ONLINE one to the receiving bank. Added `repository.cashBookNonCashRows()`, which reads the
  **source documents** (`receipts`/`expenses` with `payment_mode <> 'CASH'`, CONFIRMED only) rather
  than the ledger. The two sets are disjoint by construction, so there is no double-count risk.
  Per the user's requirement, those rows are **view-only**: they fill their own two columns and the
  Totals strip and are excluded from opening/received/paid/in-hand entirely — the summary box stays
  strictly "what the cash drawer did".
- **Account Name is the counterparty, never "Cash".** New `cashBookAccountName()` resolves per
  `source_type`: expense → `expenses.ba_id`'s name (covers expense heads, workers, employees, the
  imported directors accounts), receipt → customer, transfer → whichever side isn't cash (the bank
  rows on the reference), wage run → employee. `ledgerRows()` gained three columns for this
  (`ex.payment_mode`, `ex.issued_cheque_no`, and a join to `employees` for the wage-run name); every
  other caller ignores them.
- **Gotcha found against real data:** using `formatLedgerRow()`'s narration for the Remarks column
  printed the Account Name twice, because that helper falls back to the paying account's own name.
  Split out `cashBookRemarks()`, which takes only the document's typed-in remarks and falls back to
  the payment type ("CASH"), matching the reference. Bounce/return reversal narrations still win.
- **Two deliberate departures**, both the user's call: the By Date / By Month toggle stays (month
  view adds a Date column the single-day reference has no use for), and the print keeps its existing
  Wentox letterhead, signature block and footer rather than the reference's old-vendor branding.
  Print preview switched to landscape — nine columns do not fit A4 portrait.
- **Verified:** `tsc -b` clean; ran `cashBook()` against `wentox_demo` for `2026-08-04` and
  `2026-08` — a 35,000 cheque receipt showed in Receipts Cheq./Online with Opening and Cash In Hand
  both unchanged at 42,500, and the month view reconciled (42,500 + 16,500 − 25,800 = 33,200).
  Pre-existing `react-hooks/set-state-in-effect` lint error on `useEffect(() => { load(); })` left
  alone — it predates this change and `PaymentTrailPage`/`ProductLedgerContent` share it.
- **Files:** `backend/src/repositories/reports.repository.js`,
  `backend/src/services/reports.service.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/ReportCashBookPage.tsx`

---

## Data import — legacy KHAATA business accounts

### 2026-08-09 — First batch of the client's old business-accounts ledger imported as seed data
- **What:** The client sent a screenshot of their previous system's "BUSINESS ACCOUNTS LEDGER
  (KHAATA)" screen. Transcribed the 19 visible accounts into a new idempotent seed module and wired
  it into `npm run seed`: 2 under `Employees` (`400005`) and 17 under `Directors Expenses -
  Drawings` (`400004`), all city Lahore. Applied to `wentox_demo` only, per the user's choice —
  `wentox` was deliberately left alone.
- **How:** New `src/db/seeds/legacy-accounts.js` exporting `seedLegacyAccounts(pool)`, called from
  `run.js` after the reserved chart accounts exist (it hangs rows off them, and throws loudly if a
  parent code is missing rather than importing under the wrong head).
  - **Idempotency key is `legacy_code`, not `name`.** `schema.sql` defines that column for exactly
    this ("old system's number; import reconciliation only"), and keying on it means renaming an
    imported account inside WentoX won't cause the next `seed` run to insert a duplicate.
  - New `code` follows §3.2 like everything else — parent chart code + 4-digit serial, recomputed
    per insert (`MAX(RIGHT(code,4)) + 1`) so a partially-completed import resumes instead of
    colliding on `UQ_business_accounts_code`. The Directors serials therefore start at `0002`:
    `4000040001` was already taken by `seed:dev`'s demo data.
  - Raw parameterised SQL on `run.js`'s pool rather than `businessAccounts.repository.insert()` —
    that repository doesn't carry `legacy_code`, and widening it for an import-only path wasn't
    worth it.
  - Ensures `Punjab`/`Lahore` first (`run.js` seeds no geography); spelling matches
    `dev-sample-data.js` so the demo DB ends up with one Lahore, not two.
- **Two things to keep in mind:** (1) the screenshot is a *partial* view — its first legacy code is
  `...2218`, so ~2,200 accounts sit above it; later batches just append to `LEGACY_ACCOUNTS`.
  (2) `Directors Expenses - Drawings` is seeded `is_restricted = 1`, so those 17 accounts are
  invisible to the `USER` role by design (TASK-14) — only the 2 Employees rows show for both roles.
- **Verified:** `npm run seed` reported 19 imported; a join back through `chart_of_accounts` +
  `cities` confirmed every row's parent and city; a second `npm run seed` inserted nothing.
- **Files:** `backend/src/db/seeds/legacy-accounts.js` (new), `backend/src/db/seeds/run.js`

---

## Dev tooling — `seed:dev` extended into a full demo dataset (and a real finding about opening balances)

### 2026-08-09 — `wentox_demo` database: ~3 months of posted transactions so every report can be verified
- **What:** Reports and flows couldn't be checked because there was nothing to look at — `wentox`
  held 1 region, 1 store, 1 sub-customer and **zero transactions**, so every report (which all read
  `ledger_entries`) rendered empty regardless of whether it worked. `seed:dev` already existed but
  only created **master data**; it made no bills, receipts, expenses, purchases, cheques or payroll.
  Extended `dev-sample-data.js` from 153 → ~640 lines with a transactions phase and deliberate edge
  states.
- **Target is a throwaway database, not the working one.** `DB_NAME=wentox_demo` is all that's
  needed — `src/config/index.js` already reads `process.env.DB_NAME` and `src/db/migrate.js`
  already creates a missing database, so **no `.env` edit is required**:
  `DB_NAME=wentox_demo npm run migrate && … run seed && … run seed:dev && … run electron:dev`.
  Drop the prefix to go back to `wentox`, which was confirmed untouched (row counts identical
  before and after).
- **How:** everything goes through the **real service layer**, never raw SQL, so linked business
  accounts, generated codes and every validation rule fire as they do through the UI. Master data
  keeps the existing idempotent `ensure()`; the transaction phase is guarded by a `sale_bills`
  sentinel, since re-running would double the books. All dates are fixed offsets from today
  (`daysAgo(n)`) — no randomness, so runs are reproducible and totals are hand-checkable.
- **Contents:** 3 regions/cities, 3 vendors, 5 products (with the 12 stage-cost columns populated —
  a Wage Run snapshots its rate from those, so zero-cost products would produce worthless runs),
  6 customers, 2 banks, 4 employees, expense heads under BUSINESS RUNNING EXPENSES and DIRECTORS
  DRAWINGS; then 14 sale bills, 3 sale returns, 6 purchases, 2 purchase returns, 9 receipts (several
  **with commission**), 4 cheques covering all four dispositions, 10 expenses, 3 transfers, 3 wage
  runs, 1 salary run, plus drafts, a CLOSED account and a soft-deleted customer.
- **A real finding, not a seed bug — `business_accounts.opening_balance` has no contra entry.**
  The first cut gave each bank a 500,000 opening balance, and Overall Trail then came out
  **unbalanced by exactly 1,000,000** (debit 2,272,436.60 vs credit 1,272,436.60). `opening_balance`
  is a stored INPUT that `businessAccountBalancesAsOf()` adds to the ledger sum, but nothing ever
  writes a matching contra row — this schema has no Opening Balance Equity account. **Any non-zero
  opening balance therefore breaks the trial balance by that amount.** PROGRESS.md's earlier claim
  that Overall Trail "genuinely balances" was verified when no opening balances existed, so this had
  never been exercised. Worked around in the seed by funding both banks with a real **Deposit**
  (`Dr bank / Cr MISC ADJUSTMENTS`, code 400006) — a balanced posting, and exactly what the deposits
  feature was built for. **The underlying gap is still open** and should be a decision: either add a
  contra account for opening balances, or accept that Overall Trail can't balance once they're used.
- **Second gap found the same way:** Payment Trail's **Employees** bucket read 0 even with payroll
  posted, because a wage/salary *run* only accrues the liability — paying it out is a separate
  Expense against the employee's own business account. Added two staff payments; the bucket now
  reads 54,000. ("Cash at Banks" stays 0 by design — expenses are never posted *against* a bank
  account, banks are the funding side.)
- **Verified:** raw SQL confirms the whole ledger balances — 129 rows, **debit = credit =
  3,684,246.60, diff 0.00**. Every report returns data through the service layer, and again through
  the real UI over CDP: Sale Analysis 5 rows (Region grouping gives KPK/Punjab/Sindh), Sale Report
  (Overall row arithmetic checks out: 556,423.60 − 4,100 commission − 20,280 returns = 532,043.60
  net), Vendor Report 3, Payment Trail 5 buckets, Account Ledger 6, Business Ledger 19, Cash Book 2,
  Product Ledger 22, Overall Trail 32 accounts and **BALANCED**. The bounce cascade was checked at
  row level: cheque 55120744 → BOUNCED, its VENDOR_PAYMENT allocation → REVERSED, both reversal
  ledger pairs written (30k allocation + 50k receipt), and the *other* cheque's allocations left
  ACTIVE. All 4 cheque states present (CLEARED / BOUNCED / PENDING / PARTIALLY_ENDORSED). 3 alerts
  generate and show on the bell. Zero console errors.
- **One usability fix during verification:** Cash Book opens on *today*, so with nothing dated today
  it rendered empty and looked broken. Added a same-day cash receipt and expense.
- **Files:** `backend/src/db/seeds/dev-sample-data.js` (extended).

---

## Cross-cutting (frontend) — Setup directories: card grid → shared row template

### 2026-08-09 — Last 4 card lists converted; no card-style list remains anywhere in the app
- **What:** Per instruction ("do that one as well and any other left now do them also"), a
  whole-codebase scan for card-style lists (any `.map()` rendering bordered/rounded `<div>`s, plus
  any `lg:grid-cols-3` whose children come from a map) found four remaining, all now converted:
  1. `ReportKhaataPage.tsx` — the Accounts Directory customer picker (avatar cards → Code · Account
     Name · Main Account · City · *View Statement*). Its subtitle copy said "Select an account
     **card**"; updated to "row".
  2. `GroupAcSetupPage.tsx` — the drill-down modal's *Registered Chart Accounts* list.
  3. `ChartAcSetupPage.tsx` — the drill-down modal's *Linked Sub-Ledgers / Business Accounts* list.
  4. `DuplicateNamePromptModal.tsx` — the matched-records list inside the duplicate-name prompt.
     `actionsHeader` is blanked and `actions` omitted entirely on an *active* match, since the
     Activate button only exists for the inactive case.
- **A re-scan now reports zero card-style lists in `pages/` and `components/`.** Three `.map()`
  grids remain and are correctly untouched because they are **not** record lists:
  `ReportHeader.tsx` (print metadata key/value grid), `EmployeeSetupPage` (the trades checkbox
  picker inside the form), `ProductSetupPage` (the 12 manufacturing cost fields).
  `BiltyUpdatePage.tsx`'s `lg:grid-cols-3` is a form layout.
- **Verified live** over CDP: Khaata's Account Ledger tab renders the directory as a table with the
  right headers and no card grid (0 rows — there are no customers in this DB, so it shows the
  in-table empty state); the Group Accounts drill-down modal shows its 4 child chart accounts as
  Code · Chart Account · Status; the Chart Accounts drill-down shows its 1 linked business account
  (`#1000020001`) the same way. Console clean apart from the stock CSP dev warning. `npx tsc -b` clean.
- **NOT live-verified — `DuplicateNamePromptModal`.** Triggering it needs a duplicate-name save,
  and the Sub Customer form's required Region field is a custom `SearchableSelect` that did not
  respond to synthetic clicks over CDP after two attempts; I stopped rather than keep forcing it.
  Confirmed no data was written (sub-customer count unchanged at 1 throughout). The modal
  type-checks and is structurally the same table used by 17 other call sites, but its *rendered*
  output has not been seen. Worth a manual look the next time a duplicate name is entered.
- **Files:** `frontend/src/pages/ReportKhaataPage.tsx`, `frontend/src/pages/GroupAcSetupPage.tsx`,
  `frontend/src/pages/ChartAcSetupPage.tsx`, `frontend/src/components/DuplicateNamePromptModal.tsx`.

### 2026-08-09 — Final 6 pages onto the template; template gained expand + footer support; a real React 19 warning found and fixed
- **What:** Per instruction ("do those five as well and the overall search page as well"), the five
  pages already on hand-rolled tables plus Overall Search were migrated: **Sub Customer, Category,
  Product, Employee, User Management, Overall Search**. **16 pages now share `DataListTable`** and
  no card grid remains in any list on any page.
- **Two additive template capabilities, both driven by a page that genuinely needed them:**
  - **Expandable rows** (`renderExpanded` / `isExpanded` / `onToggleExpand`) — Categories toggles a
    row open to show that category's products in a nested table. Adding a leading chevron column
    was the only way to keep that feature; the page still owns the expansion state. Confirmed with
    the user before building rather than silently dropping the drill-down.
  - **`footer`** — Employees has a `<tfoot>` "Total Outstanding" row. The page supplies the whole
    `<tr>` so it controls its own colSpans. Rendered only when there are rows.
  - Employees also proved the columns array can be built conditionally: it swaps a *Registered
    Trades* column for *Fixed Monthly Salary* depending on the Workers/Salaried tab.
- **A real bug found by live verification, not by `tsc`:** the first cut of expandable rows wrapped
  each row in `<Fragment key={…}>`. React 19 then logged
  `Invalid prop 'code-path' supplied to React.Fragment` **once per rendered row, on every page with
  data** — because this project's dev-only Vite plugin `kimi-plugin-inspect-react` (`inspectAttr()`
  in `frontend/vite.config.ts`) stamps a `code-path` attribute onto every JSX element for
  click-to-source, and `Fragment` accepts only `key`/`children`. Fixed by dropping the Fragment
  entirely: the row map is now a **`flatMap` returning sibling `<tr>` elements** with their own
  keys, which needs no wrapper. Verified the warning is gone from all 16 pages. Worth knowing: this
  is latent wherever `<Fragment>` is used — `ReportStockPage`, `ChequesTab`, `SaleReportPage`,
  `OverallTrailContent` and `SaleAnalysisPage` all still trip it, pre-existing and untouched here.
  It is dev-server-only and cannot reach a production build.
- **One page deliberately left alone:** `ReportKhaataPage.tsx` still renders its customer picker as
  a card grid (`lg:grid-cols-3`, with initial-letter avatars). It was not in scope and was not
  mentioned — flagging it as the last remaining card list in the app.
  (`BiltyUpdatePage.tsx`'s `lg:grid-cols-3` is a *form* layout, not a list — correctly untouched.)
- **Verified live** over CDP after a hard reload: all 16 pages render 0 card grids and exactly 1
  table, 29 real data rows across them, correct headers everywhere, and **zero console
  errors/warnings**. Categories' expand was proven end-to-end by creating a throwaway category
  through the real API, confirming the chevron cell, expanding it (nested "no products" panel
  appeared), collapsing it again, then removing it — it is soft-deleted (`is_active=0`, this app has
  no hard delete for categories) so it no longer appears in the UI. `npx tsc -b` clean.
- **Files:** `frontend/src/components/DataListTable.tsx`,
  `frontend/src/pages/{SubCustomer,Category,Product,Employee}SetupPage.tsx`,
  `frontend/src/pages/UserManagementPage.tsx`, `frontend/src/pages/OverallSearchPage.tsx`.

### 2026-08-09 — All 10 pages converted (follow-up to the entry below, same day)
- **What:** The remaining 9 pages were converted onto the same `DataListTable` template in one pass,
  per explicit instruction ("do the remaining pages"): **Group Ac, Business Ac, Region, City, Store,
  Adda, Vendor, Customer, Bank**. Zero `lg:grid-cols-3` card grids remain in any `*SetupPage.tsx`.
- **How:** Same rule everywhere — each page's columns are exactly what its card already showed, so
  nothing was invented; row click keeps whatever that page opened before. `ArrowRight` dropped from
  the 6 pages where it only fed the card's footer arrow.

  | Page | Columns | Row click opens |
  |---|---|---|
  | Group Ac | Code · Name · Account Class · Sorting | child chart-accounts drill-down |
  | Chart Ac | Code(+RESERVED) · Name · Group · Link Code · Status | sub-ledgers drill-down |
  | Business Ac | Code · Name · Control A/C · Region · Status | edit modal |
  | Region | Code · Name · Status | edit modal |
  | City | Code · Name · Region · Status | edit modal |
  | Store | Code · Name · Status | edit modal |
  | Adda | Code · Name · Region · City · Details | edit modal |
  | Vendor | ID · Name · Phone · Region · City · Articles | purchase history |
  | Customer | ID · Name · Region · City · Address | product ledger |
  | Bank | A/C Code · Bank · Account No. · Branch · Status | edit view |

- **One deliberate behaviour change, flagged:** `BankSetupPage.tsx` was **already** a hand-rolled
  table, not cards (an earlier grid-class grep matched its *form* layout, not its list). It was in
  the approved page list, so it moved onto the shared template for consistency — same columns, same
  look. Its rows are now **clickable → `select(b)`**, which they were not before; on an inactive
  bank that reaches the edit view by a route the row previously did not offer (the row only exposed
  Reactivate). Harmless and trivially revertable, but it is new behaviour rather than a like-for-like
  port. `SubCustomer`, `Category`, `Product`, `Employee` and `UserManagement` were left alone —
  already tables, and outside the approved list.
- **Verified live** via the CDP-driven Electron instance, sweeping all 10 pages: every page renders
  exactly 1 table, 0 card grids, with the correct headers listed above. Data-bearing pages showed
  real rows (Chart 17, Group 4, Business 1, Store 1); the 6 empty tables (Region, City, Adda,
  Vendor, Customer, Bank — all 0 rows in this DB) correctly showed the in-table empty state with
  headers still visible. Interactions re-checked per page: Group Ac row click → the group's
  drill-down, and its **Edit button opened the edit modal without also firing the row click**;
  Business Ac and Store row clicks → edit modals pre-filled with the right record. **Zero console
  errors or exceptions across the whole sweep** (Electron's stock dev-mode CSP warning filtered out).
  `npx tsc -b` clean.
- **Files:** `frontend/src/pages/{GroupAc,BusinessAc,Region,City,Store,Adda,Vendor,Customer,Bank}SetupPage.tsx`.

### 2026-08-09 — New `DataListTable` row template; Chart of Accounts converted first, verified live
- **What:** Every non-transactional setup screen rendered its records as a 3-across card grid
  (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`, ~190px tiles) — 10 pages do this: Region, City,
  Store, Adda, Group Ac, Chart Ac, Business Ac, Customer, Vendor, Bank. Cards fit only 7–9 records
  per screen, are hard to scan/compare, and were already inconsistent with the 5 setup pages that
  use tables (Sub Customer, Category, Product, Employee, User Management). Per client instruction
  these become **row-wise lists, with the row itself clickable to open whatever detail that page
  already opened**, and the row design is a **template defined once and reused**, not per-page
  markup. This entry builds the template and converts the first page; the other 9 follow one at a
  time.
- **How:**
  - New `frontend/src/components/DataListTable.tsx` — generic over the row type, no domain
    knowledge. Page supplies `columns` (`{key, header, render, align?, width?, cellClassName?}`),
    `rows`, `rowKey`, optional `onRowClick`, and an optional `actions(row)` render-prop.
    Markup/classes are **lifted verbatim from the table already in `SubCustomerSetupPage.tsx`** —
    the established house style, deliberately not a new one. Two behaviours those tables lack were
    added: the whole row is clickable (plus `role="button"`/`tabIndex=0`/Enter-Space, and a gold
    focus ring), and loading/empty states render as a `<td colSpan>` **inside** the table so the
    header row stays visible instead of being replaced by a card.
  - The actions cell is wrapped in `<div onClick={e => e.stopPropagation()}>` — the same guard the
    cards used — so Edit/Delete never also fire the row click. This is the one genuinely new failure
    mode the card→row move introduces, and it is the thing most worth re-checking on each page as
    the rollout proceeds.
  - `ChartAcSetupPage.tsx`: only the card-grid block was replaced. Columns are Chart Code (mono,
    with the gold RESERVED marker beneath), Account Name, Group Account, Link Code, Status
    (unchanged emerald/rose pill), Actions (unchanged Edit + the same
    `status === 'CLOSED' ? Reactivate : Delete` branch, keeping `disabled={isReserved}`). Row click
    → `setViewingChartId(c.ac_id)`, exactly what the card did. Data loading, filtering, search, the
    sort toggle, the header card, and both modals are untouched — this is a presentation swap.
    Dropped the now-unused `ArrowRight` import.
- **Verified live** via a second Electron instance on `--remote-debugging-port=9222` (driven over
  CDP; the already-running `electron:dev` window was left alone): logged in as `admin`, opened
  Chart of Accounts — all 17 seeded accounts render as rows, 0 card grids remain, all 6 headers
  correct, RESERVED marker present. Row click opened the Sub-Ledgers drill-down for the right
  account and closed cleanly; **Edit opened the edit modal pre-filled and did NOT also open the
  drill-down** (confirming the stopPropagation guard); Delete on a reserved account is genuinely
  `disabled`, with the right tooltip; Sort by Name reordered alphabetically and Sort by Code
  restored; search `WAGES` → 2 rows; a nonsense search showed the empty state **with the table
  header still visible**; clearing search restored 17. Enter on a focused row opened the
  drill-down. Console clean apart from Electron's stock dev-mode CSP warning (pre-existing,
  unrelated). `npx tsc -b` clean.
- **Not verified live, and why:** the **Delete-enabled** and **Reactivate** branches were not
  exercised — all 17 seeded chart accounts are in `RESERVED_ACCOUNT_CODES` (17 codes, 17 rows) and
  all are `ACTIVE`, so neither branch is reachable with current data. Proving them needs a
  throwaway chart account, and `chartAccounts.remove()` is a soft close (no hard delete), so the
  test row would persist. Both branches reuse the card's exact handlers/conditions inside the same
  guarded actions cell that Edit was proven in.
- **Still pending:** the other 9 card pages — Group Ac, Business Ac, Region, City, Store, Adda,
  Vendor, Customer, Bank. Customer and Vendor open a detail/ledger drill-down rather than the edit
  modal; each page keeps whatever it opens today.
- **Files:** `frontend/src/components/DataListTable.tsx` (new),
  `frontend/src/pages/ChartAcSetupPage.tsx`.

---

## Milestone 9, Module 9.2 — Admin: Manage Users (new capability, not in the original milestone scope)

### 2026-08-08 — Admin can create, list, deactivate/reactivate additional logins, and reset any user's password
- **What:** UC-03's role-based access control was fully built (`chart_of_accounts.is_restricted`
  hides Cash at Banks/Directors Drawings from `USER`-role sessions) but there was no way to actually
  *create* a second, limited-access login — only the single seeded `admin` account ever existed, and
  `auth.service.js` only supported `login`/`updateCredentials` (self-service, requires the caller's
  own current password)/`verifyPassword`. Added: `auth:createUser` (admin-only, always creates
  `role: 'USER'` — the frontend can never create another admin), `auth:listUsers`,
  `auth:setUserActive` (deactivate/reactivate — this app's only "delete" for a user, matching the
  soft-delete convention used everywhere else), and `auth:resetPassword` (admin sets ANOTHER user's
  password directly, unlike `updateCredentials` which needs the target's own current password).
  `session.js#requireRole('ADMIN')` existed but had zero real call-sites anywhere in the codebase
  before this — these four channels are its first actual use.
- **How:** Two footguns guarded against in `setUserActive()`: an admin can't deactivate their own
  account (`session.userId === targetUserId` check), and can't deactivate the last active admin
  (`repository.countActiveAdmins()` check) — both would otherwise lock everyone out with no way to
  undo it. New frontend page `UserManagementPage.tsx` (`setup-users` NavPage, admin-only sidebar
  entry under System Setup) — create-user form, live account list with role/active badges, per-row
  deactivate/reactivate and a "Reset Password" modal. Also found and fixed while wiring this:
  `ipcBridge.ts`'s `FEATURES` array was missing `'alerts'` and `'updates'` entirely — same class of
  bug as an earlier missing `'accountClasses'` entry — both channels would have silently resolved
  `window.api.alerts`/`window.api.updates` as `undefined`.
- **Follow-up, same session:** per explicit request, `SettingsPage.tsx` is now role-gated —
  non-admins only ever see the "Check for Updates" tab (the footer popup link itself now reads
  "Check for Updates" instead of "Settings & Updates" for a `USER` session); the credentials/password
  tab and its pill-tab selector are hidden outright, not just defaulted away, so there's no path to
  them for a non-admin.
- **Verified live** via a real Electron instance (CDP): created a `worker1` USER account, confirmed a
  real bcrypt-hashed row in `dbo.users`; duplicate username correctly blocked (`USERNAME_TAKEN`);
  logged in as `worker1` and confirmed `createUser`/`listUsers` are both rejected
  ("Requires ADMIN role"), confirmed the sidebar hides every `adminOnly` item for that role, and
  confirmed `SettingsPage.tsx` shows only "Check for Updates" with no way to reach the credentials
  form; deactivated `worker1` → login correctly rejected → reactivated → login works again → admin
  reset `worker1`'s password → confirmed the new password actually logs in; confirmed the
  self-deactivate button is genuinely disabled (not just hidden) on the admin's own row.
- **Files:** `backend/src/repositories/auth.repository.js`, `backend/src/services/auth.service.js`,
  `backend/src/ipc/auth.ipc.js`, `frontend/src/lib/ipcBridge.ts`, `frontend/src/lib/api.ts`,
  `frontend/src/types/index.ts`, `frontend/src/components/AppLayout.tsx`,
  `frontend/src/pages/UserManagementPage.tsx` (new), `frontend/src/pages/SettingsPage.tsx`,
  `frontend/src/App.tsx`.

## Milestone 8, Modules 8.1/8.2/8.3 — System Setup + Accounting Setup frontend wiring

### 2026-08-07 — Connected Cities/Regions/Stores/Addas and Group/Chart/Business Accounts to real `window.api` — verified live
- **What:** The last System Setup pages still on demo `AppContext` data — `CitySetupPage.tsx`,
  `RegionSetupPage.tsx`, `StoreSetupPage.tsx`, `AddaSetupPage.tsx`, `GroupAcSetupPage.tsx`,
  `ChartAcSetupPage.tsx`, `BusinessAcSetupPage.tsx` — rewired onto the real backend (all of which was
  already built and complete per Module 8.1/8.2/8.3's backend entries above). Cities/Regions/
  Stores/Addas follow the blocking-duplicate pattern (case-insensitive name match, active blocks,
  inactive offers reactivate) already used by vendors/categories/products. Addas' region/city
  required-vs-optional was inverted in the old demo page (region optional, city required) —
  corrected to match the real backend (`region_id` NOT NULL, `city_id` nullable). Group/Chart/
  Business Accounts' manual code-entry fields were dropped — codes are server-generated
  (`<classDigit><serial>` → `<groupCode><serial>` → `<chartCode><serial>`) and now shown read-only.
  `ChartAcSetupPage.tsx` disables the delete action outright for any of the 16 reserved codes
  (`reservedAccounts.js`), rather than only surfacing the backend's `RESERVED_ACCOUNT` error after
  the fact. `BusinessAcSetupPage.tsx`'s stale `controlId === '110001'` → demo `ADD_CUSTOMER` side
  effect was dropped (real customer creation already links its own account server-side).
  `ipcBridge.ts`'s `FEATURES` array was missing `'accountClasses'` — fixed.
- **Verified live:** created a City/Region/Store/Adda (region required, city optional now); active
  duplicate blocked inline; inactive duplicate → reactivate-offer modal worked; deleting an
  Adda referenced by a real sale bill correctly blocked with `ADDA_IN_USE`. Created a Group Account
  under a class (code `1001`), a Chart Account under it (`100101`), a Business Account under that
  (`1001010001`) — full code-generation chain confirmed; creating a business account under the real
  `CUSTOMERS_ACCOUNTS` code did NOT also create a demo customer (confirms the dropped side effect);
  deleting a reserved chart account blocked both in the UI (disabled) and by the backend
  (`RESERVED_ACCOUNT`); deleting a Group Account with chart-account children blocked
  (`GROUP_IN_USE`). Logged in as a `USER`-role session and confirmed Bank Accounts/Directors
  Drawings are absent from Business/Chart Accounts lists — the real, pre-existing `is_restricted`
  hiding, exercised end-to-end for the first time with an actual second account (see the Manage
  Users entry above).
- **Files:** `frontend/src/lib/api.ts`, `frontend/src/lib/ipcBridge.ts`,
  `frontend/src/pages/{City,Region,Store,Adda}SetupPage.tsx`,
  `frontend/src/pages/{GroupAc,ChartAc,BusinessAc}SetupPage.tsx`.

## Milestone 9, Module 9.1 — Alerts: real-backend Home card, manual + timed refresh (follow-up)

### 2026-08-08 — Alerts moved off demo data onto the real backend; auto-popup sidebar replaced with an inline Home card
- **What:** The alerts panel (right-side auto-popup on Home) and bell dropdown were computing alerts
  client-side from frozen `AppContext` demo arrays — never actually wired to the real, already-built
  `alerts:list`/`alerts:dismiss` backend (Module 9.1, above). Per explicit request: removed the
  auto-popup sidebar entirely (deleted `NotificationSidePanel.tsx`); new `HomeAlertsCard.tsx` renders
  inline on the Home page (bottom half, centered) instead, using real `alerts:list`/`alerts:dismiss`.
  Card-level "Close" is a new session-scoped `homeAlertsCardClosed` flag in `AppContext` (resets on
  every `LOGIN_SUCCESS`) — deliberately NOT the real backend dismiss, which is permanent and would
  never satisfy "shown again next login"; per-row dismiss (the small X) IS the real, permanent
  `alerts:dismiss` call, matching what that endpoint was actually built for. Bell dropdown
  (`NotificationBell.tsx`) also switched to the same real data source, and no longer special-cases
  Home (previously toggled the now-deleted side panel there; now behaves identically everywhere).
- **Follow-up in the same session — refresh was stale and then slow:** `refreshAlerts()` (the job
  that populates `dbo.generated_alerts`, which `alerts:list` just reads) ran once at Electron
  startup only — a cheque/bill newly entering the 7-day window mid-session wouldn't show until an app
  restart. Widened to also re-run every 15 minutes (`electron/main.js`), plus a new on-demand
  `alerts:refresh` channel and a manual refresh button (bell dropdown — always reachable even with
  zero current alerts — and the Home card). Found the refresh itself was doing a SELECT-then-INSERT/
  UPDATE per alert, sequentially, one at a time (2 DB round trips × N alerts, never parallelized) —
  replaced with a single `MERGE` per alert (`alerts.repository.js#mergeGeneratedAlert`, one round
  trip) run in parallel via `Promise.all` instead of a `for await` loop; `alerts:refresh` now also
  returns the fresh list directly rather than making the renderer do a second round trip after.
  Measured: a real refresh went from what was effectively N sequential round trips down to ~90ms.
- **Verified live:** confirmed no auto-popup on Home; card shows real alert data (cross-checked
  against a raw `alerts:list()` call); clicking a row navigates correctly using the backend's own
  `target_page`/`target_tab`; card stays hidden across navigation once closed, reappears after
  logout→login; per-row dismiss is permanent (confirmed gone from a fresh `alerts:list()` call);
  simulated the exact "just added a cheque, not showing yet" scenario by clearing
  `generated_alerts` mid-session — bell dropdown correctly said "Nothing needs attention," clicking
  Refresh made the cheque appear instantly, no restart needed.
- **Files:** `backend/electron/main.js`, `backend/src/ipc/alerts.ipc.js`,
  `backend/src/repositories/alerts.repository.js`, `backend/src/services/alerts.service.js`,
  `frontend/src/lib/ipcBridge.ts`, `frontend/src/lib/api.ts`, `frontend/src/context/AppContext.tsx`,
  `frontend/src/components/AppLayout.tsx`, `frontend/src/components/NotificationBell.tsx`,
  `frontend/src/components/HomeAlertsCard.tsx` (new), `frontend/src/pages/HomePage.tsx`; deleted
  `frontend/src/components/NotificationSidePanel.tsx`.

## Milestone 5, Module 5.2 — Reports: two bug fixes found via a full click-through sweep

### 2026-08-08 — `sale-bills:biltySearch`/`updateBilty` channel-name mismatch; Add Quantity input UX
- **What:** A systematic click-through of every sidebar page (checking for console errors/blank
  renders, since this app has no React error boundaries) found the "Search & Bilty Adda Updation"
  page completely broken — `sale-bills:bilty-search`/`sale-bills:update-bilty` were registered
  kebab-case on the backend, but the frontend calls them via `window.api.saleBills.biltySearch(...)`/
  `.updateBilty(...)` (camelCase — the IPC bridge Proxy passes the action segment through with no
  case conversion, confirmed against `auth.ipc.js`'s own documented convention). Renamed both
  channels to camelCase. Separately, in `ReportStockPage.tsx`'s "Add Stock / Log Production" modal,
  the "Add Quantity" field defaulted to `1` with no `onFocus` select and an `onChange` that forced
  the value back to a minimum of 1 on every keystroke — typing "20" over the default produced "120"
  since the "1" was never selectable/clearable. Fixed with `onFocus={e => e.target.select()}`, an
  `onChange` that allows the field to go genuinely empty while typing, and an `onBlur` that clamps
  back to 1 only if left empty.
- **Verified live:** direct `window.api.saleBills.biltySearch({})` call returns real bill rows post-fix
  (previously threw "No handler registered"); simulated the exact select-then-type interaction for
  the quantity field and confirmed the result is `20`, not `120`.
- **Files:** `backend/src/ipc/saleBills.ipc.js`, `frontend/src/pages/ReportStockPage.tsx`.

## Milestone 5, Module 5.2 — Reports: Overall Trail per-account print preview (all 6 categories)

### 2026-08-08 — "Show Print Preview" added to the account drill-down, previously only on the summary view
- **What:** `OverallTrailContent.tsx` has two views — a trial-balance summary (which already had a
  working print preview) and a per-account drill-down ledger (Customer/Vendor/Bank/Employee/Chart
  Account/Business Account — reached by clicking any account row). The drill-down had no print
  preview at all, for any category. Since the drill-down view has zero per-category branching
  (`loadLedger()` makes one identical `accountLedger({ba_id, ac_id, ...})` call regardless of which
  category the account came from — the backend resolves whichever id applies), one shared addition
  covers all six categories at once: new `renderPrintableLedger()` (ported from
  `ReportKhaataPage.tsx`'s already-working "select account → print its ledger" pattern), a second
  `ReportPrintPreviewModal` instance, and a new Excel-export handler.
- **Verified live:** drilled into a Customer, a Vendor, and a Chart Account (the latter using `ac_id`
  instead of `ba_id`, confirming the shared renderer handles both id types) — each showed the correct
  account header, real ledger rows, opening/closing balance, and Excel export worked.
- **Files:** `frontend/src/pages/OverallTrailContent.tsx`.

## Milestone 7 — System Setup frontend wiring (Customers, Sub-Customers)

### 2026-08-07 — Connected Customer/Sub-Customer Setup pages to real `window.api` — verified live
- **What:** `CustomerSetupPage.tsx`, `SubCustomerSetupPage.tsx` rewired off the demo `AppContext`
  reducer onto real `customers`/`subCustomers` IPC calls — full CRUD including the real
  `checkName()` pre-flight channel, which neither page had wired to anything before (both already
  had `DuplicateNamePromptModal` built and rendered against demo data, just never touching the real
  backend). `lib/api.ts` gained `CustomerUpdateInput`/`SubCustomerUpdateInput`,
  `CustomerCheckNameResult`/`SubCustomerCheckNameResult`, and full `window.api` typings/wrapper
  objects for both (previously only `list`/`create` were typed).
- **How:**
  - Confirmed from code (not assumed): customers/sub-customers are the **non-blocking duplicate
    branch** — `create()` never checks for an active-name collision at all; the real flow is a
    `checkName({name})` pre-flight call before `create()` (`'none'` → create directly; `'active'` →
    advisory only, `DuplicateNamePromptModal`'s `allowCreateOnActive: true` fits exactly; `'inactive'`
    → reactivate-or-create-new). Only `update()` blocks on an exact-name collision with a different
    row (`DUPLICATE_NAME`). This is the opposite of every entity connected so far (vendors/
    categories/products/employees/bank accounts all block on active match).
  - Relaxed the frontend's `city_id`-required validation to match the backend (only `region_id` is
    required, `city_id` is nullable) on both pages.
  - Customer's delete guard (hard-blocked if referenced by demo sale bills/returns/receipts) dropped
    in favor of a plain confirm dialog — real `remove()` is unconditional soft delete, same
    precedent as every prior module.
  - Customer's manual `ADD_BUSINESS_ACCOUNT` dispatch dropped — `customers:create` already creates
    and links the account server-side in its own transaction.
  - Customer's "Product Ledger" drill-down (previously hand-built per-article rows from demo sale
    bills/returns) replaced with a direct reuse of `reports.accountLedger({ba_id})` — the exact same
    channel/wrapper `ReportKhaataPage.tsx` (Module 5) already uses — no new backend work, and the
    real result is richer (running balance, receipts/commission/bounce rows too, not just sale
    bills/returns).
  - Live-verified via Electron + CDP: created a customer with the **same name as an existing active
    customer** and confirmed it was NOT blocked — the advisory modal appeared ("You can still create
    a new one — this is just a heads-up"), "Create New Anyway" succeeded, and both rows coexist
    active in `dbo.customers` with separate `ba_id`s under the real `CUSTOMERS_ACCOUNTS` chart code
    (`100001`) — this is the key behavioral difference from every other connected module, confirmed
    working correctly; renaming a customer to another customer's exact name via edit was correctly
    blocked with `DUPLICATE_NAME`; soft-delete → re-create with the same name → `checkName` returned
    `'inactive'` → reactivate offer worked, for both customers and sub-customers; the Product Ledger
    drill-down rendered real Sale Bill/Receipt rows with correct running balance (28,200 → 13,200 →
    7,200) for a seeded customer with real history. No console errors across the full run.
- **Files:** `frontend/src/lib/api.ts`, `frontend/src/pages/CustomerSetupPage.tsx`,
  `frontend/src/pages/SubCustomerSetupPage.tsx`.

## Milestone 6 — System Setup frontend wiring (Products, Categories, Vendors)

### 2026-08-07 — Connected Product/Category/Vendor Setup pages to real `window.api` — verified live
- **What:** `ProductSetupPage.tsx`, `CategorySetupPage.tsx`, `VendorSetupPage.tsx` rewired off the
  demo `AppContext` reducer onto real `products`/`productColors`/`categories`/`vendors` IPC calls —
  full CRUD, not just the read-only `list()` lookups these three already had from earlier modules.
  `lib/api.ts` gained `ProductCreateInput`/`ProductUpdateInput` (vendor_id immutable on update, per
  the service), `productColors` wrapper, `CategoryCreateInput`, `VendorUpdateInput`, and full
  `window.api` typings/wrapper objects for all four.
- **How:**
  - User-confirmed decision: Product colors stay a single field on the form (today's UX) — resolved/
    created behind the scenes via `product-colors:resolveOrCreate` rather than building a
    multi-variant list UI.
  - Duplicate-name handling follows the same ad hoc reactivate-offer pattern as every other
    connected module (`BankSetupPage.tsx`/`EmployeeSetupPage.tsx`), not the built-but-unwired
    `DuplicateNamePromptModal.tsx` — that component expects a `checkName()` pre-check endpoint these
    three modules don't have, and its "Create New Anyway" action has no real backend affordance for
    an inactive match here (a retry just throws the same error again).
  - Delete guards dropped the demo's hard "used in a sale bill/purchase" blocking checks — the real
    `remove()` for all three is a plain soft delete with no such check — replaced with a plain
    confirm dialog, same precedent as Employees.
  - Vendor's manual `ADD_BUSINESS_ACCOUNT` dispatch + `getNextVendorAccountCode()` computation
    dropped entirely — `vendors:create` already creates and links the account server-side.
    Vendor's free-text city field replaced with real `region_id`/`city_id` dropdowns.
  - Category's "Associated Products" count/drill-down and Vendor's purchase-history drill-down both
    now read off the real `products`/`purchases` lists (`purchases:list()` is header-only — no
    `items` — so the drill-down shows date/bill_no/remarks/status/total_value, not a materials
    breakdown; matches the same list-lacks-detail gotcha every prior module has hit).
  - Live-verified via Electron + CDP: created a category, a vendor (with real region/city), and a
    product under them (server-generated `code`/`batch_no` confirmed: `P-104`, `batch_no=4`); the
    vendor's linked business account landed under the real `VENDORS_ACCOUNTS` reserved chart code
    (`200001`, not `210001` as originally assumed in planning — corrected against the actual
    `reservedAccounts.js` constant); the product's color field correctly created a real
    `article_colors` row via `resolveOrCreate`; duplicate-name (active) blocked with the right
    message for all three; soft-delete → re-create → `INACTIVE_DUPLICATE` reactivate offer worked
    for all three; editing a product's sale price persisted while its `vendor_id` stayed immutable
    (edit form shows it read-only, "(fixed after creation)"). No console errors across the full run.
- **Files:** `frontend/src/lib/api.ts`, `frontend/src/pages/ProductSetupPage.tsx`,
  `frontend/src/pages/CategorySetupPage.tsx`, `frontend/src/pages/VendorSetupPage.tsx`.

## Milestone 5 — Reports frontend wiring (Current Stock, Reports Hub's 9 sub-reports, Bilty/Adda Updation, Overall Searching)

### 2026-08-07 — Connected all of Milestone 5's frontend to real `window.api` — wire-only pass, not live-verified
- **What:** `ReportStockPage.tsx` (all 7 tabs), the 9 Reports Hub sub-report components
  (`SaleAnalysisPage`, `SaleReportPage`, `VendorReportPage`, `PaymentTrailPage`,
  `ReportKhaataPage`, `BusinessLedgerContent`, `ReportCashBookPage`, `ProductLedgerContent`,
  `OverallTrailContent`), `BiltyUpdatePage.tsx`, and `OverallSearchPage.tsx` all rewired off the
  demo `AppContext` reducer onto real `reports`/`stock`/`saleBills` IPC calls. `lib/api.ts` gained
  `stock`/`reports` wrapper objects plus every row/result type for the ~15 report channels, a
  `CategoryRow`/`listCategories()` (Milestone 6 backend, previously unwired), and a `ProductRow`
  widening to include the 12 cost columns (already returned by `a.*`, just not typed).
- **How:**
  - Per explicit instruction, **this pass has no live Electron/CDP verification** — only
    `npx tsc -b` (clean) and direct SQL-level checks against `wentox_db` for the one backend
    change. Flagging this explicitly: none of Milestone 5's ~15 report views have been exercised
    against real data end-to-end the way every prior module was.
  - Real semantic simplifications made where the demo's shape had no backend equivalent: Cash
    Book dropped its Cheque/Online columns (the real `reports:cash-book` is CASH_IN_HAND-only by
    design, per its own code comment); Business Ledger's summary view shows `closing_balance`
    instead of a Debit/Credit split (the backend computes a point-in-time balance, not a
    period activity split, for the summary — only `view: 'detail'` has real Debit/Credit rows);
    Overall Trail dropped the `subcustomer` filter pill (sub-customers have no `ba_id` and never
    appear in `reports:overall-trail`, confirmed by the service's own code comment) and gained a
    `bank` one (the real `entity_type`/`category` enums distinguish `BANK` from generic
    `BUSINESS_ACCOUNT`, which the demo data model never did).
  - Material Stock Adjustment modal (`ReportStockPage.tsx`) dropped the Add-material direction —
    only `stock:reduce-vendor-stock` (consume) is real; user-approved decision from planning.
  - Every "opening balance" and "running balance" figure across Vendor Report, Khaata, Business
    Ledger, Overall Trail, and Overall Search now comes directly from the backend's own
    `accountLedger()`/`netBalance()` computation (`business_accounts.opening_balance` + ledger sum
    to date) instead of being derived client-side from raw demo arrays — these were never
    equivalent, so this is a full replacement, not a like-for-like port.
- **Files:** `backend/src/repositories/reports.repository.js` (see the widening entry above),
  `frontend/src/lib/api.ts`, `frontend/src/pages/ReportStockPage.tsx`,
  `frontend/src/pages/SaleAnalysisPage.tsx`, `frontend/src/pages/SaleReportPage.tsx`,
  `frontend/src/pages/VendorReportPage.tsx`, `frontend/src/pages/PaymentTrailPage.tsx`,
  `frontend/src/pages/ReportKhaataPage.tsx`, `frontend/src/pages/BusinessLedgerContent.tsx`,
  `frontend/src/pages/ReportCashBookPage.tsx`, `frontend/src/pages/ProductLedgerContent.tsx`,
  `frontend/src/pages/OverallTrailContent.tsx`, `frontend/src/pages/BiltyUpdatePage.tsx`,
  `frontend/src/pages/OverallSearchPage.tsx`.

## Milestone 5, Module 5.1 — Vendor Stock breakdown widening for frontend wiring

### 2026-08-07 — Widened `reports:vendor-stock` with purchased/returned breakdown
- **What:** `reports.repository.js#vendorStock()` now returns `purchased_qty`/`returned_qty`
  alongside the existing `on_hand`, needed to preserve the frontend Current Stock page's existing
  Material Stock breakdown view (rather than simplifying the UI to net-only, per explicit user
  decision). No schema change — `dbo.vendor_stock_movements.movement_type` was already a real,
  CHECK-constrained discriminator (`PURCHASE`/`PURCHASE_RETURN`/`CONSUMPTION`/`ADJUSTMENT`) with
  sign-constrained `qty`, conditional aggregation was all that was needed.
- **How:** Also dropped the existing `HAVING SUM(vsm.qty) <> 0` — it would hide a material that
  was purchased and later fully consumed (on_hand = 0 but real purchased/returned history exists),
  which the breakdown view needs to show. Verified live: query executes cleanly against
  `wentox_db`.
- **Files:** `backend/src/repositories/reports.repository.js`.

## Milestone 4, Modules 4.5/4.6/4.7 — Payroll frontend wiring (Employees & Stages, Wage Run, Salary Run)

### 2026-08-07 — Connected all three Payroll pages to real `window.api` — Milestone 4 frontend now fully complete
- **What:** `EmployeeSetupPage.tsx`, `WageRunPage.tsx`, `SalaryRunPage.tsx` rewired off the demo
  `AppContext` reducer onto real `employees`/`stages`/`wageRuns`/`salaryRuns` IPC calls — the last
  remaining frontend gap in Milestone 4. `frontend/src/lib/api.ts` gained `StageRow`/`EmployeeRow`/
  `WageRunRow`/`WageRunItemRow`/`SalaryRunRow`/`SalaryRunItemRow` types and matching wrapper
  objects (`stages`, `employees`, `wageRuns`, `salaryRuns`), plus a `ProductRow` widening to
  include the 12 manufacturing-stage cost columns (`a.*` in `products.repository.js` already
  returned them — the typed wrapper just hadn't caught up).
- **How:**
  - Dropped the frontend's free-text "Register Custom Trade" escape hatch — the real `stages`
    table is a closed, seeded set of 12, and `employees.service.js#validate()` rejects any
    unknown `stage_key`. The trade grid now sources from `stages:list()` directly.
  - Dropped the 100%-frontend business-account-code computation
    (`getNextAccountCode`/`ADD_BUSINESS_ACCOUNT`) — `employees:create()` already creates the
    linked `business_accounts` row server-side in its own transaction.
  - Duplicate-name (`DUPLICATE_NAME`/`INACTIVE_DUPLICATE`) handling added to
    `EmployeeSetupPage.tsx`, same reactivate-offer pattern as `BankSetupPage.tsx`/`vendors`.
  - `lib/payroll.ts`'s `accruedUpto`/`paidUpto`/`getEmployeeBalance`/`getRunBalanceBlock` used to
    read `state.wageRuns`/`state.salaryRuns`/`state.expenses` directly — since (matching every
    other connected module) `AppContext`'s demo arrays stay untouched and real data lives in each
    page's own local state, these were rewritten to take explicit arrays as parameters instead.
    Since `salaryRuns:list()` carries no line items (only the new `item_count`), a salaried
    employee's accrual across multiple runs required flattening each CONFIRMED run's `items` via
    `salaryRuns.get(id)` once on `EmployeeSetupPage` mount — small, bounded by run count (roughly
    one per month), not per employee.
  - **Found and fixed a real bug during live verification, not introduced by this change but
    exposed by it**: the stage-picker dropdown on `WageRunPage.tsx` called `useState`/`useRef`/
    `useEffect` inside an IIFE that only executed once a selected worker had ≥1 registered trade —
    a Rules-of-Hooks violation (conditionally-called hooks) that had been sitting in the demo code
    unnoticed because nothing had exercised that exact state transition before. Selecting a worker
    with a trade threw "Rendered more hooks than during the previous render" and blanked the whole
    page (no error boundary). Fixed by hoisting the hooks to the component's top level,
    unconditional.
  - Live-verified via Electron + CDP (Node `WebSocket`, same technique as every prior module):
    worker with 0 trades rejected; worker with 1 real trade created, linked BA under `220001`
    confirmed; salaried employee created, linked BA under `220002` confirmed; duplicate name+phone
    against an active employee correctly rejected with no crash; Wage Run — worker/stage picker
    correctly restricted to the real registered trade, article pick correctly snapshotted
    rate/packing, 20×5×12=1200 computed correctly, post → `Dr WAGES EXPENSE(410001) 1200 /
    Cr worker.ba_id 1200` confirmed in `ledger_entries`, unpost → ledger rows removed + audit
    columns set, edit-and-repost round-tripped correctly; Salary Run — roster built from the real
    salaried employee, override to 55000 with remarks posted → `Dr SALARIES EXPENSE(410002) 55000
    / Cr employee.ba_id 55000` confirmed, `salary_run_items` snapshot correct
    (`salary_amount=60000`, `amount=55000`); a second CONFIRMED run for the same month correctly
    shown as already-posted with Post disabled; Employees directory's Current Balance column
    verified correct for both the worker (Rs 1,200 accrued, nothing paid) and the salaried
    employee (Rs 55,000 accrued from the posted run).
- **Files:** `frontend/src/lib/api.ts`, `frontend/src/lib/payroll.ts`,
  `frontend/src/pages/EmployeeSetupPage.tsx`, `frontend/src/pages/WageRunPage.tsx`,
  `frontend/src/pages/SalaryRunPage.tsx`.

## Milestone 4, Modules 4.5/4.6/4.7 — Payroll `list()` widenings for frontend wiring

### 2026-08-07 — Widened `employees`/`wageRuns`/`salaryRuns` list() to close the list-lacks-detail gap
- **What:** Three small, additive `list()` widenings needed to start wiring the Payroll frontend
  (Employees & Stages, Wage Run, Salary Run) to real data — the same "list rows lack detail"
  gotcha every prior connected module has hit. No new tables/columns, no service changes, no
  migration.
- **How:** `employees.repository.js#list()` gained a correlated `STRING_AGG(ws.stage_key, ',')
  WITHIN GROUP (ORDER BY s.sort_order)` subquery over `worker_stages`↔`stages`, returned as
  `stage_keys` — lets the Employees directory show a worker's trades, and lets the Wage Run
  screen restrict its stage picker to the selected worker's trades, both off the list alone (no
  N+1 `get()` per row/selection). `wageRuns.repository.js#list()` and
  `salaryRuns.repository.js#list()` each gained a scalar `item_count` subquery (`COUNT(*)` over
  `wage_run_items`/`salary_run_items`) so their History tables can show line/employee counts
  without fetching full `items` per row. Verified live against `wentox_db` (currently 0 rows in
  all three tables, but the STRING_AGG/subquery syntax executes cleanly).
- **Files:** `backend/src/repositories/employees.repository.js`,
  `backend/src/repositories/wageRuns.repository.js`,
  `backend/src/repositories/salaryRuns.repository.js`.

## Milestone 4 — new `businessAccounts:list` (read-only)

### 2026-08-07 — New `businessAccounts:list` channel (+ a bug fixed same-day)
- **What:** Added a read-only listing endpoint for "any business account" — needed by two pickers
  that hit the same gap during frontend wiring: Expenses' non-vendor payment target (Office Rent,
  Utilities, an employee — `expenses.service.js#resolveTarget()` already accepted a raw `ba_id` for
  this, just had nothing to list from) and Cheques' EXPENSE_PAYMENT disposition (disabled in the
  frontend during Module 4c for the same reason). `businessAccounts.ipc.js` was previously an empty
  stub (`create`/`update`/`remove`/`get`/`list` all commented out as `TODO(milestone)`).
  `create`/`update`/`remove`/`get` remain unregistered — no UI needs direct business-account CRUD
  yet (accounts are still only ever created via a party's own setup flow — vendor, customer,
  bank account).
- **How:** `businessAccounts.repository.js#list(filters)` — joins `chart_of_accounts` for
  `chart_code`/`chart_name` (so a picker can show/filter by parent head, e.g. "under Vendors
  Accounts" vs "under Business Running Expenses"), filterable by `ac_id?`/`status?` (default
  `ACTIVE`)/`search?`. Thin passthrough in `businessAccounts.service.js#list()`, registered as the
  wire channel `business-accounts:list` (kebab-case — `window.api.businessAccounts.list()` on the
  frontend, per `ipcBridge.ts`'s `camelToKebab()` convention every other feature already follows).
- **Bug found during live verification**: the channel was initially registered as
  `businessAccounts:list` (camelCase, matching the JS file/service name instead of the wire
  convention) — every other `*.ipc.js` file in this codebase registers kebab-case
  (`sub-customers:list`, `bank-accounts:list`, etc), and `ipcBridge.ts`'s Proxy always calls the
  kebab form. Caught immediately by a live "No handler registered for 'business-accounts:list'"
  error the moment the Expenses page tried to use it; fixed to `business-accounts:list`.
- **Files:** `backend/src/repositories/businessAccounts.repository.js`,
  `backend/src/services/businessAccounts.service.js`, `backend/src/ipc/businessAccounts.ipc.js`.
- **Verified:** live end-to-end via the real Electron app as part of the Expenses frontend wiring
  pass (see Module 4.2 log).

---

## Milestone 4, Module 4.1 — Receipts/Cheques (bug fix)

### 2026-08-07 — `receipts:get` was missing `cheque_received_date`
- **What:** `receipts.repository.js#findById()`'s join to `dbo.cheques` selected `cheque_no`/
  `cheque_date`/`cheque_status`/`bank_id` but omitted `cheque_received_date` — a real column,
  genuinely missing from the SELECT list (not a design choice). Found while wiring the frontend's
  Receipts edit flow: reopening a CHEQUE receipt for edit always came back with the received-date
  field blank.
- **How:** One-line fix — added `ch.cheque_received_date` to the SELECT.
- **Files:** `backend/src/repositories/receipts.repository.js`.
- **Verified:** module loads cleanly; live verification happens as part of the frontend wiring pass.

---

## Milestone 4, Module 4.1 — Receipts/Cheques (allocation-history addendum)

### 2026-08-06 — New `cheques:allocations-for-receipt` channel
- **What:** Added a read-only channel exposing the full allocation history (all disposition types,
  including DEPOSIT and REVERSED rows) for one cheque's receipt — needed by the Cheques tab's
  per-cheque history view during frontend wiring. `cheques:endorsed-allocations` was already built
  but deliberately excludes DEPOSIT/REVERSED (it's the narrower "Cheque Return" undo-picker), so it
  couldn't serve this purpose.
- **How:** `repository.listAllocations(receiptId)` already existed (used internally elsewhere) but
  had no IPC channel — just wired it through a thin `cheques.service.js#listAllocationsForReceipt()`
  passthrough. No schema/migration change, no new logic.
- **Files:** `backend/src/services/cheques.service.js`, `backend/src/ipc/cheques.ipc.js`.
- **Verified:** both files load cleanly (`node -e "require(...)"`); live end-to-end verification
  happens as part of the frontend wiring pass for this module.

---

## Milestone 4, Module 4.4 — Transfer (Deposit addendum)

### 2026-08-06 — New "Deposit" feature (one-sided manual account adjustment)
- **What:** Added a `deposits` feature alongside `transfers` — a one-sided manual credit/debit
  adjustment to a single business account (owner capital, bank fees, etc), requested during
  frontend wiring of the Transfer module since the frontend's demo `TransferPage.tsx` has a
  "Deposit" mode with no prior backend equivalent at all.
- **How:** Mirrors `transfers.*` almost exactly (create as DRAFT, `update`/`remove` blocked once
  CONFIRMED via `POSTED_LOCK`, `post`/`unpost` toggling ledger rows + status, no password guard),
  but one side of the double-entry is a fixed reserved chart account (`MISC_ADJUSTMENTS`, code
  `400006`, new entry in `reservedAccounts.js` + seeded in `db/seeds/run.js`) instead of a second
  `ba_id` — same pattern Purchases already uses for `PURCHASES`. `direction='CREDIT'` → Dr `to_ba_id`
  / Cr `MISC_ADJUSTMENTS`; `direction='DEBIT'` → Dr `MISC_ADJUSTMENTS` / Cr `to_ba_id`,
  `source_type='DEPOSIT'`. New table `dbo.deposits` (mirrors `dbo.transfers`' shape minus the second
  account) added via a temporary migration (`010_deposits.sql`), applied + verified against
  `wentox_db`, then folded directly into `database/schema.sql` and the migration file deleted — same
  cycle used for this project's other schema changes. `CK_ledger_entries_src` widened to allow
  `'DEPOSIT'` as a `source_type` (also via the same migration, folded in place in schema.sql).
- **Files:** `database/schema.sql` (new `dbo.deposits` table + widened `CK_ledger_entries_src`),
  `backend/src/repositories/deposits.repository.js`, `backend/src/services/deposits.service.js`,
  `backend/src/ipc/deposits.ipc.js`, `backend/src/ipc/index.js` (registered), `backend/src/constants/reservedAccounts.js`
  (+`MISC_ADJUSTMENTS`), `backend/src/db/seeds/run.js` (+seeded the new chart account),
  `frontend/src/lib/ipcBridge.ts` (+`deposits` to `FEATURES`).
- **Verified:** ran the migration + seed against the live dev DB — confirmed `dbo.deposits` exists,
  `MISC_ADJUSTMENTS` (code `400006`) seeded at `ac_id=17`, and `CK_ledger_entries_src` now permits
  `'DEPOSIT'`. Live end-to-end CREDIT/DEBIT posting verification happens as part of the frontend
  wiring pass for this module (see Module 9.2 log once that lands).

---
## Milestone 9, Module 9.1 — follow-up: alerts computed by a startup job, persisted, not live

### 2026-08-05 — New `generated_alerts` table; a real (if minimal) "cron job"
- **What:** User wanted alerts computed by a job that runs when the app starts, not recomputed
  live on every `alerts:list` call. New `dbo.generated_alerts` table (migration
  `011_generated_alerts.sql`, folded into `database/schema.sql` directly too, matching how
  migration 010 was handled). `alerts.service.js#refreshAlerts()` is the job body: same
  cheque-due/sale-bill-due queries `list()` used to run live, now upserted into `generated_alerts`
  by `alert_key`, with a cleanup pass (`deleteGeneratedNotIn`) removing any stored row no longer in
  the fresh set. `list()` now just reads that table — cheap, no recomputation — and derives
  `severity` live from `alert_date` vs today at read time (deliberately not stored, so display
  can't go stale between job runs even though the job itself doesn't repeat).
- **Trigger, per explicit choice (asked directly, user picked "startup only, no repeat" over
  hourly/15-minute options):** `electron/main.js#app.whenReady()` calls `refreshAlerts()` once,
  right after `registerIpcHandlers()`, not awaited (so a slow/unreachable DB doesn't delay the
  window opening) and wrapped in `.catch()` (so a failure logs instead of crashing startup). No
  `setInterval`, no scheduler library — "once per app launch" is the entire mechanism.
- **Known trade-off, accepted not fixed:** since the job never repeats, a cheque/bill that newly
  enters the 7-day window during a long-running session won't appear until the app is restarted.
  This was the explicit choice offered and picked, not an oversight.
- **Files:** `backend/src/db/migrations/011_generated_alerts.sql`, `database/schema.sql`,
  `System_architecture/database_schema_v4.3.md`, `backend/src/repositories/alerts.repository.js`,
  `backend/src/services/alerts.service.js`, `backend/electron/main.js`.

## Migration 010's columns folded into `database/schema.sql` directly

### 2026-08-05 — `database/schema.sql`'s own `dbo.expenses` now carries the issued-cheque reversal columns
- **What:** Per explicit instruction, `010_expenses_issued_cheque_reversal.sql`'s columns
  (`issued_cheque_status`/`issued_cheque_bounced_date`/`issued_cheque_returned_date`/
  `issued_cheque_return_reason`), its three CHECK constraints, and its filtered index are now also
  baked directly into `database/schema.sql`'s `dbo.expenses` table — not just the migration file
  and `database_schema_v4.3.md`. Matches the existing precedent already in this file for
  `sale_bills.due_date` (added post-v4.3 the same way, flagged "POST-v4.3: re-added").
  `dbo.draft_expenses` was deliberately NOT touched — a draft is never posted, so it can't have a
  bounced/returned status to track.
- **Still needed on a live/already-applied database:** `schema.sql` only describes a *fresh*
  database — an existing `wentox_db` still needs migration `010_expenses_issued_cheque_reversal.sql`
  run against it to actually gain these columns; editing `schema.sql` doesn't retroactively alter a
  database that was already created from an earlier copy of this file.
- **Files:** `database/schema.sql` only.

### 2026-08-05 — Simplified per explicit instruction: no schema change needed
- **What:** Removed the "Disposition" column entirely. Every row — endorsed-to-vendor/expense
  (`ALLOCATION`), cheque-we-wrote (`ISSUED`), and deposited-awaiting-clearance (`DEPOSITED`) — now
  shows the exact same two buttons: **Return** and **Mark Cleared**. What each button actually does
  underneath is still routed by the row's real `kind` internally (never shown) — an `ALLOCATION`
  Return still reverses one allocation, an `ISSUED` Return still reverses the expense's ledger
  entry, a `DEPOSITED` Return now means "the bank bounced/rejected it" (reverses the *original
  receipt*), and a `DEPOSITED` Mark Cleared is still the real `MARK_CHEQUE_CLEARED` dispatch.
- **Key decision, resolved via two clarifying rounds:** "Mark Cleared" on an `ALLOCATION`/`ISSUED`
  row has **no equivalent backend concept** — once a cheque is endorsed or issued, the money
  already moved, so there's nothing pending to "clear" (unlike a deposited cheque, which has a real
  `CLEARED` status waiting on bank confirmation). Explicitly chosen as a **local-only dismissal**
  (a `dismissedKeys` Set in component state) rather than inventing a new schema status for this —
  **no migration, no schema change**. Only `DEPOSITED`'s Mark Cleared writes real state.
- **Files:** `frontend/src/pages/ChequeReturnPage.tsx` only — no backend files touched.

## Milestone 9, Module 9.3 — follow-up: Check for Updates gets its own page; deposited cheques get both actions

### 2026-08-05 — Two corrections after user review of the running app
- **Check for Updates moved to its own page.** It was a card inside `SettingsPage.tsx`; user said
  "make proper page." New `CheckForUpdatesPage.tsx`, own `NavPage` value (`check-updates`), own
  sidebar entry under System Setup (admin-only), routed in `App.tsx`. `SettingsPage.tsx` reverted
  back to just the admin-credentials form — nothing else changed about the update-check logic
  itself, only where it lives.
- **Cheque Return's `DEPOSITED` row now shows BOTH "Return" and "Mark Cleared."** Originally built
  with "Mark Cleared" only; user pointed out a deposited cheque has two real, mutually exclusive
  outcomes — the bank clears it, or the bank bounces/rejects it — so both need to be offered,
  matching how `ChequesTab.tsx` already shows multiple coexisting actions per cheque. "Return" on a
  `DEPOSITED` row now opens the same confirm modal as the other two row kinds, with its own
  copy describing a bank bounce (reverses the *original receipt*, restoring the customer's due —
  the same whole-cheque reversal `cheques.service.js#bounce()`/`#returnToSender()` do on the real
  backend, distinct from `ALLOCATION`'s narrower single-allocation reversal). "Mark Cleared" is
  unchanged (still a real dispatch, not a preview).
- **Files:** `frontend/src/pages/CheckForUpdatesPage.tsx` (new), `frontend/src/pages/SettingsPage.tsx`
  (reverted), `frontend/src/App.tsx`, `frontend/src/components/AppLayout.tsx`,
  `frontend/src/types/index.ts`, `frontend/src/pages/ChequeReturnPage.tsx`.

## Milestone 9, Module 9.3 — Check for Updates; Cheque Return — Mark Cleared follow-up

### 2026-08-05 — electron-updater wired (check/install), first real window.api page; Cheque Return gained a Mark Cleared row
- **What (Check for Updates):** New `electron-updater` dependency. `src/services/updates.service.js`
  (no repository — nothing here touches SQL): `check()` probes internet via a HEAD request to
  `api.github.com` specifically (not a generic host), then calls `autoUpdater.checkForUpdates()`
  (fed via `setFeedURL({provider:'github', owner:'SubhanNoor', repo:'Wentox_sole'})`, not an
  electron-builder-generated `app-update.yml`, since packaging isn't set up yet). Two distinct
  failure points per explicit instruction: no internet AT ALL upfront throws `ApiError`
  (`NO_INTERNET`, shown to the user); a connection dropping *during* the actual update lookup
  (having passed the internet check) is caught internally and reported as "no update," never
  surfaced as an error. `install()` downloads and calls `quitAndInstall()` once the user confirms.
  `updates:check`/`updates:install` IPC channels. `SettingsPage.tsx` (frontend) gained a real
  "Check for Updates" card calling `window.api.updates.check()`/`.install()` — the first page in
  this entire frontend to call the real backend instead of `AppContext` demo data (there's no
  meaningful demo version of an internet/update check to fake). New `frontend/src/types/
  electron-api.d.ts` ambient type for `window.api` (didn't exist at all before this).
- **Also found while scoping this**: `npm run electron:dev` (Vite + Electron concurrently) was
  already present in `package.json` — nothing to build there, milestone9.md checkbox just hadn't
  been ticked. `electron-builder` packaging config intentionally deferred — nothing meaningful to
  package while the frontend still runs on demo data (Module 9.2).
- **What (Cheque Return — Mark Cleared):** User pointed out a gap on the "Cheque Return" page: a
  deposited cheque that's actually cleared by the bank has no reason to keep sitting on that page
  (nothing left to return), but its ledger entry must stay untouched. Added a third row kind,
  `DEPOSITED`, sourced from `state.receipts` where `chequeStatus === 'DEPOSITED'`. "Mark Cleared"
  dispatches the real `MARK_CHEQUE_CLEARED` reducer action (already used correctly by
  `ChequesTab.tsx`) rather than a preview message — the one deliberate exception to this page's
  "not connected" scaffolding, since there's no reason to fake an action that already works. The
  row disappears from the list on its own once `chequeStatus` flips to `'CLEARED'`, no extra
  removal logic needed.
- **Debugger pass, twice** (Check for Updates backend, then the frontend `SettingsPage.tsx`
  addition + the `ChequeReturnPage.tsx` `DEPOSITED` row together) — both clean, no bugs found.
  Checked: `checkInternet()`'s promise-settlement paths, the internet-check-vs-mid-check failure
  boundary, `install()`'s double-reject safety, IPC/`FEATURES` registration, and that a `DEPOSITED`
  row can never reach the Return-confirmation modal's `ALLOCATION`/`ISSUED`-only ternary.
- **Not live-verified this session** — no SQL Server or packaged Electron build available in this
  sandbox; the update-check flow additionally can't be meaningfully tested at all until
  `electron-builder` packaging exists.
- **Files:** `backend/package.json`, `backend/src/services/updates.service.js`,
  `backend/src/ipc/updates.ipc.js`, `backend/src/ipc/index.js`, `backend/electron/preload.js`,
  `frontend/src/pages/SettingsPage.tsx`, `frontend/src/types/electron-api.d.ts`,
  `frontend/src/pages/ChequeReturnPage.tsx`.

## Milestone 9, Module 9.1 — Alerts

### 2026-08-05 — Cheque-due AND sale-bill-due-date alerts, both wired up
- **What:** `alerts:list`/`alerts:dismiss`. User explicitly asked for both a cheque-date alert and a
  sale-bill due-date alert, 7 days out, dismissible — overriding milestone9.md's original "payment-
  overdue alert dropped in v4.3, cheque-due only" plan. Turned out to need no schema change at all:
  `database/schema.sql` already had `sale_bills.due_date` and `alert_dismissals` re-added, with a
  comment on the latter literally saying "this alert isn't wired up yet" — `database_schema_v4.3.md`
  had the same column already in its own CREATE TABLE block, just stale surrounding prose from
  before that restoration. Only the code (`alerts.repository/service/ipc.js`) was actually missing.
- **How:** `chequeDueRows()` reuses `IX_cheques_due`'s exact filter (`cheque_status IN ('PENDING',
  'PARTIALLY_ENDORSED')`); `saleBillDueRows()` only considers POSTED bills (derived via a
  `ledger_entries` existence check, matching how "posted" is derived everywhere else — `sale_bills`
  has no status column of its own). Both are unconditional — no "balance still positive" check —
  since that would need a per-bill payment link this schema doesn't have (receipts are customer-
  level, never tied to a specific bill); matches what was actually asked for, not UC-05's original,
  now-stale wording. `alert_key` = `CHEQUE_DUE:<cheque_id>` / `PAYMENT_OVERDUE:<bill_id>`; dismiss
  is permanent (`dismissed_until` stays `NULL`) and idempotent.
- **Not live-verified this session** — no SQL Server reachable in this sandbox.
- **Files:** `src/repositories/alerts.repository.js`, `src/services/alerts.service.js`,
  `src/ipc/alerts.ipc.js`, `src/ipc/index.js`, `electron/preload.js`,
  `System_architecture/database_schema_v4.3.md` (prose reconciliation only, no schema change).

## Milestone 8, Modules 8.2 & 8.3 — Account Classes, Group/Chart/Business Accounts CRUD, Accounts Tree

### 2026-08-05 — Built the last unbuilt system-setup layer (UC-15/16/17), found and fixed one real IPC bug before it shipped
- **What:** `accountClasses` (read-only lookup), `groupAccounts` (full CRUD), `chartAccounts` (full
  CRUD), `businessAccounts` (filled in `list()`/`update()`/`remove()`/`reactivate()` on top of the
  existing `createUnderChartCode()`/`getById()`/`getCashAccount()`), and a new `accounts:tree`
  cross-entity read. Full detail in `milestones/milestone8.md` Modules 8.2/8.3.
- **Key decisions:** `groupAccounts` code = `<classDigit><3-digit serial>` (new class→digit
  mapping, since `account_classes.code` is text); `chartAccounts` code = `<group.code><2-digit
  serial>`, matching the majority of already-seeded reserved codes (4 payroll codes are pre-existing
  outliers, flagged not fixed). Neither `chart_of_accounts` nor `business_accounts` has a hard
  delete — both "remove" to `status = 'CLOSED'` (their only soft-delete column), blocked outright
  for reserved chart codes and for any business account already owned by a vendor/customer/
  employee/bank. `is_restricted` chart accounts (and business accounts under them) hidden from
  non-ADMIN sessions across `list()`/`get()`/the tree, reusing `reports.service.js#paymentTrail()`'s
  existing `session.role === 'ADMIN'` pattern (TASK-14) rather than inventing a new one.
- **Bug found and fixed before this was ever run**: every new multi-word-feature `.ipc.js` file
  (`businessAccounts`, `chartAccounts`, `groupAccounts`, `accountClasses`) registered camelCase
  channel prefixes (`businessAccounts:list`), but `preload.js`'s `camelToKebab()` only ever computes
  a kebab-case prefix from the `FEATURES` array (`business-accounts`) — every one of those channels,
  including `businessAccounts:getCashAccount` from the earlier Cash/Transfer fix this same day,
  would have been unreachable from the renderer. Fixed across all four files to match
  `bankAccounts.ipc.js`/`subCustomers.ipc.js`'s existing convention.
- **Debugger pass found one more real bug**: `businessAccounts.service.js#create()`'s `validate()`
  only checked `name`/`ac_id` — `dbo.business_accounts`'s `CK_business_accounts_opening` requires
  `opening_balance`/`opening_date` together or neither, so a payload with only one of the two would
  have hit a raw SQL CHECK-constraint violation, which isn't an `ApiError` and so gets swallowed by
  `ipc/wrap.js` into an opaque `INTERNAL` error with no indication which field was wrong. Fixed with
  an explicit both-or-neither check in `validate()`, matching `CK_receipts_cheque`-style guards
  elsewhere in this codebase that exist specifically to keep a DB constraint violation from ever
  reaching the wire unexplained.
- **Not live-verified this session** — no SQL Server reachable in this sandbox; no schema change
  needed (the four tables already exist), but every new channel still needs a real CRUD pass
  against `wentox_db` before this is "done" the way the rest of this log has been.
- **Files:** `src/repositories/{accountClasses,groupAccounts,chartAccounts,businessAccounts,
  accountsTree}.repository.js`, `src/services/{accountClasses,groupAccounts,chartAccounts,
  businessAccounts,accountsTree}.service.js`, `src/ipc/{accountClasses,groupAccounts,chartAccounts,
  businessAccounts,accounts}.ipc.js`, `src/ipc/index.js`, `electron/preload.js`.

## Milestone 4, Module 4.4 — Transfer — follow-up: cash had no business account, so cash↔bank transfers were impossible

### 2026-08-05 — Seeded a Cash business account; Cash Book now reads both dimensions cash posts across
- **What:** Auditing milestones 1–7 for anything still missing (excluding frontend wiring) surfaced
  a real gap: `dbo.transfers.from_ba_id`/`to_ba_id` are FKs to `business_accounts` only, but
  `src/db/seeds/run.js` never created a `business_accounts` row for `CASH_IN_HAND` — only banks got
  one. So a cash↔bank transfer was impossible to create at all, even though
  `database/schema.sql`'s own comment on `business_accounts.opening_balance` says "cash needs one,
  every bank needs one," and `cash_and_bank.md` §9 (decisions 4/5) requires exactly this (a single
  Petty Cash account, opening balance on `business_accounts`) — §7 calls bank→cash "likely the most
  common [transfer] of all" (wage withdrawals).
- **How:** `ensureCashBusinessAccount()` added to `src/db/seeds/run.js` — idempotent, same
  `code = chartCode + '0001'` composition every other reserved-account row uses, runs right after
  the `CASH_IN_HAND` chart account is ensured, backfills on a re-seed of an already-live DB.
  `businessAccountsRepository.findByAcId()` + `businessAccountsService.getCashAccount()` resolve it
  by chart code (matching every other reserved-account lookup pattern in this codebase, e.g.
  `chartAccountsRepository.findByCode`), rather than a hardcoded id. New
  `businessAccounts:getCashAccount` IPC channel for a future Transfer screen's "Cash" option.
  Fixed the report-side consequence at the same time: `reports.service.js#cashBook()` was reading
  only `ledger_entries WHERE ac_id = CASH_IN_HAND's ac_id` — since a cash-side transfer posts via
  the new Cash `ba_id` instead (same as every other transfer party), that query would have silently
  missed it. `reports.repository.js#ledgerRows()`/`#netBalance()` gained an OR-condition path for
  when BOTH `ba_id` and `ac_id` are passed together (only `cashBook()` does this; every other
  caller still passes exactly one, unchanged) — matches rows from either dimension. Opening balance
  for the combined query still only comes from the `business_accounts` side (chart accounts have no
  `opening_balance` column).
- **Known trade-off, not fixed:** Overall Trail will now show cash as two separate rows whenever a
  cash-side transfer exists — one Chart-of-Account row for `CASH_IN_HAND` (from CASH
  receipts/expenses, unchanged), one business-account row for the new Cash account (from transfers
  only). Each is individually correct; nothing is double-counted or lost, it's just split across
  two lines instead of one. Fully unifying it would mean switching CASH receipts/expenses to post
  via the Cash `ba_id` too (matching how banks work — ONLINE/CHEQUE_ISSUED never post to a chart
  account directly) — a larger, riskier change touching `receipts.service.js`/`expenses.service.js`
  and out of scope for this fix.
- **Not verified live this session** — no SQL Server reachable in this sandbox. Needs `npm run
  seed` (backfills the Cash business account on the existing `wentox_db`) + a live cash↔bank
  transfer create/post + Cash Book check, on a machine with the DB running, before this is
  considered done the way every other entry in this log has been.
- **Files:** `src/db/seeds/run.js`, `src/repositories/businessAccounts.repository.js`,
  `src/services/businessAccounts.service.js`, `src/ipc/businessAccounts.ipc.js`,
  `src/repositories/reports.repository.js`, `src/services/reports.service.js`.

## Milestone 4, Module 4.2 — Expenses / Kharch — follow-up: Cheque Return for issued cheques

### 2026-08-05 — Bounce/return for CHEQUE_ISSUED expenses (a cheque WE wrote, not just endorsed ones)
- **What:** The existing "Cheque Return" page (2026-08-04 entry below) only covered undoing one
  endorsement of a customer's cheque we'd passed on (`cheques.service.js#reverseAllocation`). User
  pointed out the gap: a cheque **we** write to pay a vendor (`CHEQUE_ISSUED` expense) can also
  bounce, and had no reversal path at all — deliberately, by the original schema design
  (deduct-on-write, no pending state, no `cheques` row). Added `expenses.service.js#bounceIssuedCheque()`
  / `#returnIssuedCheque()`, the mirror image of `cheques.service.js#reverseCheque()` but for an
  `expenses` row instead of `cheques`/`receipts` rows.
- **How:** New columns directly on `expenses` — `issued_cheque_status` (`PENDING`/`BOUNCED`/
  `RETURNED`), `issued_cheque_bounced_date`, `issued_cheque_returned_date`,
  `issued_cheque_return_reason` — same shape as `cheques`' own bounce/return columns, kept here
  instead since a cheque we write still isn't a `cheques` row. `reverseIssuedCheque()` (shared by
  both actions) requires the expense to be `CHEQUE_ISSUED`, `CONFIRMED`, and still `PENDING`, then
  writes the opposite ledger pair (`Dr bank ba_id / Cr expense.ba_id` — undoing the original
  `Dr ba_id / Cr bank_id`) dated the bounce/return date, and flips the status — nothing deleted or
  rewritten, same reverse-never-delete rule as every other bounce/return flow. New
  `listReturnableIssuedCheques()` (CONFIRMED, `CHEQUE_ISSUED`, `PENDING`) feeds the same "Cheque
  Return" page as the existing endorsed-allocations list, per explicit user request — one page, one
  merged row set, with the "From" column showing our bank's name instead of a customer's name for
  these rows. New IPC channels `expenses:bounceIssuedCheque` / `expenses:returnIssuedCheque` /
  `expenses:returnableIssuedCheques` (camelCase action names, matching the documented
  `productColors.ipc.js` convention — `cheques.ipc.js`'s kebab-case actions predate that
  convention and were left as-is, not touched here). Frontend: `ChequeReturnPage.tsx` (still
  NOT CONNECTED demo scaffolding, same as the rest of the frontend) now merges endorsed-allocation
  rows and issued-cheque rows into one table; `Expense` type gained the matching
  `issuedChequeStatus`/`issuedChequeBouncedDate`/`issuedChequeReturnedDate`/`issuedChequeReturnReason`
  fields.
- **Files:** `System_architecture/database_schema_v4.3.md`,
  `backend/src/db/migrations/010_expenses_issued_cheque_reversal.sql`,
  `backend/src/repositories/expenses.repository.js`, `backend/src/services/expenses.service.js`,
  `backend/src/ipc/expenses.ipc.js`, `frontend/src/types/index.ts`,
  `frontend/src/pages/ChequeReturnPage.tsx`.

## Milestone 5, Module 5.2 — Reports — Milestone 5 now fully complete

### 2026-08-04 — All 11 reports built in one pass (9 originally-deferred + 2 new user-requested), backed directly by `ledger_entries`
- **What:** Every report in the sidebar's Reports Hub, plus a new "Overall Trail" (a full trial
  balance across every account) and a new "Overall Searching" directory (type a name, get back
  the matching customer/vendor/employee/sub-customer/business account, backed by a SQL VIEW per
  explicit user request so it auto-reflects source-table changes with no app-side merge code).
  Both new reports came from the user attaching screenshots of an already-built demo frontend page
  (`OverallTrailContent.tsx`, `OverallSearchPage.tsx`) and asking for the real backend behind it.
- **Core design decision:** rather than recomputing balances from source documents the way the
  demo frontend does (client-side, filtering arrays), everything here reads `dbo.ledger_entries`
  directly — the single double-entry journal every CONFIRMED document already posts to. This is
  what `database_schema_v4.3.md`'s own comments on `ledger_entries`/`chart_of_accounts` describe as
  the intended query shape ("Trial Balance report (GROUP BY ac_id/ba_id, SUM(debit), SUM(credit))"),
  and it means the Overall Trail's grand total genuinely balances (verified live: total debit ==
  total credit across every account) rather than being an approximation.
- **Shared building block:** `reports.repository.js#ledgerRows()` — one query per account (ba_id
  or ac_id) that LEFT JOINs `ledger_entries` back to whichever source doc produced each row based
  on `source_type` (sale_bills, sale_returns, receipts→cheques, expenses→business_accounts,
  wage_runs, salary_runs, transfers→business_accounts). Backs 4 of the 11 reports: Account Ledger
  (Khaata), Business Ledger's detail view, Overall Trail's drill-down, and Overall Search's
  drill-down. `netBalance()`/`businessAccountBalancesAsOf()`/`chartAccountBalancesAsOf()` compute
  balance-as-of-a-date the same way everywhere: `business_accounts.opening_balance` (a stored
  INPUT, if `opening_date` is on/before the date) + every ledger row up to that date — chart
  accounts have no opening_balance column, so they skip straight to the ledger sum.
- **A real bug caught during live testing, not by the debugger:** the first version of
  `formatLedgerRow()` always preferred `receipts.remarks` over `ledger_entries.narration` for
  `RECEIPT`-sourced rows — correct for a normal receipt (UC-35's own spec: narration = the
  receipt's free text), but WRONG for a bounce/return reversal, which deliberately reuses
  `source_type='RECEIPT'` on the same `receipt_id` (reverse-never-erase, §6.1) with its own
  narration like `"BOUNCED reversal of receipt #18"`. Found by manually inspecting real leftover
  test data from an earlier session's bounce test — the reversal row was silently showing the
  original receipt's remarks instead of "BOUNCED reversal...". Fixed with a targeted check
  (`/reversal/i` in the ledger row's own narration wins over the receipt's remarks).
- **Two chart-account mapping judgment calls, made from the actual posting code rather than the
  reserved-code names alone** (documented inline in `reports.repository.js#paymentTrailRows()`):
  Payment Trail's "Vendors – Suppliers" bucket maps to `VENDORS_ACCOUNTS` (200001 — where
  `vendors.service.js` actually creates a vendor's `ba_id`), not the separately-reserved but
  never-used `VENDORS_SUPPLIERS` (200002); "Employees" maps to `WORKER_WAGES`+`SALARIES_PAYABLE`
  (220001/220002 — where `employees.service.js` actually creates an employee's `ba_id`), not the
  unused `EMPLOYEES` (400005). A generic "create a business account directly under an arbitrary
  chart account" feature (`businessAccounts.ipc.js`) is still an unbuilt TODO stub, so
  `BUSINESS_RUNNING_EXPENSES`/`DIRECTORS_DRAWINGS` buckets will correctly show 0 until that's built
  — not a report bug, a real current-data gap.
- **`reports:payment-trail` restricted-bucket filtering (UC-34):** `BANK_ACCOUNTS`/
  `DIRECTORS_DRAWINGS` are `is_restricted` in `chart_of_accounts` (seeded, TASK-14/§8) but nothing
  in the backend enforced that restriction anywhere before now — `paymentTrail()` hides those two
  buckets entirely for non-ADMIN sessions and excludes them from `grand_total`, the first place
  `is_restricted` is actually read outside the seed script.
- **UC-30 Vendor Stock is the one write inside "Reports":** `reports:vendor-stock` (read, listing
  on-hand material per vendor) stays in the `reports` module per the milestone's own naming, but
  the write side (UC-30 step 2, "this much material has been used") went into `stock.service.js`
  as `stock:reduce-vendor-stock` instead — Reports is otherwise strictly read-only, and this is the
  one documented exception, so it lives with the rest of the stock-writing surface. Rejects a
  reduction that would take on-hand negative (`INSUFFICIENT_STOCK`), verified live.
- **`dbo.vw_overall_directory` (migration 008):** `UNION ALL`s customers/vendors/employees/
  sub_customers/business_accounts. The business_accounts branch excludes rows already owned by a
  customer/vendor/employee (`NOT EXISTS` against each), so only "generic" accounts (banks, expense
  heads) show up under their own name — verified live that the directory's row count matches
  `customers + vendors + employees + sub_customers + (business_accounts not claimed by any of
  those)` with no double-listing. Sub-customers carry no `ba_id` (delivery-address-only party,
  never financially responsible for a bill) so they always search-match by name but their
  drill-down returns `{ has_account: false, message: "..." }` instead of a fabricated balance.
- **Verified live against `wentox_db`:** every one of the 11 report functions run end-to-end
  through the service layer (bypassing IPC, same as prior milestones' smoke tests) — Overall
  Trail's grand total debit/credit balances exactly; the reversal-narration fix confirmed against
  real leftover bounce-test data; vendor-stock reduce accepted a valid reduction and correctly
  rejected an over-reduction; payment-trail correctly hides the 2 restricted buckets for a `USER`
  role and includes them for `ADMIN`; business-ledger summary (all accounts, one balance query
  each via `businessAccountBalancesAsOf()`, not N+1) and detail (one account's full ledger) both
  checked; overall-search directory counts matched expectations with no double-listing.
- **Debugger review:** clean overall — SQL injection, N+1s, date-range boundaries, restricted-
  bucket leakage, and IPC session guards all checked and confirmed sound. One PLAUSIBLE finding:
  `vw_overall_directory` (migration 008) excluded rows already claimed by customers/vendors/
  employees from its generic branch but had no exclusion — or own branch — for `bank_accounts`, so
  a bank account would show up mislabeled as generic `BUSINESS_ACCOUNT` in Overall Search instead
  of `BANK`, inconsistent with `businessAccountsWithCategory()`'s 5-way categorization already used
  by Overall Trail. Unobservable in the live DB at review time (no bank accounts existed yet) but
  would surface as soon as one was created. Fixed via `009_overall_directory_bank_branch.sql`
  (adds the `BANK` branch, sourced through `bank_accounts.ba_id` → `business_accounts.city_id`
  since `bank_accounts` has no `city_id` of its own), re-verified live post-migration.
- **Files:** `reports.repository.js`/`reports.service.js`/`reports.ipc.js` (all heavily
  rewritten), `stock.repository.js`/`stock.service.js`/`stock.ipc.js` (vendor-stock
  read+write added), `materials.repository.js` (added `findById`), migrations
  `008_overall_directory_view.sql` and `009_overall_directory_bank_branch.sql`.
- **Not done:** frontend wiring (both `OverallTrailContent.tsx`/`OverallSearchPage.tsx` and the
  other 8 report tabs already exist on the demo frontend, untouched this pass, still running on
  demo in-memory data per the session's established "don't connect it" pattern).

---

## Milestone 4, Module 4.2 — Expenses / Kharch — Milestone 4 now fully complete

### 2026-08-04 — expenses/draftExpenses built, plus a user-requested "Cheque Return" feature, 5 real bugs found and fixed across 3 debugger rounds
- **What:** The last piece of Milestone 4. `expenses` (CASH/ONLINE/CHEQUE_ISSUED/CHEQUE_ENDORSED),
  `draftExpenses`, and — beyond the original checklist, at explicit user request — a "Cheque
  Return" capability to undo one specific cheque endorsement without touching the rest of the
  cheque or the underlying receipt.
- **The core design decision, reached through back-and-forth with the user before coding:**
  `CHEQUE_ENDORSED` (paying a vendor/expense with a cheque already sitting in Cheques in Hand) is
  the *exact same real-world action* as Module 4.1's Cheques-page endorsement — so rather than
  building a second, parallel ledger-writing mechanism, `expenses.service.js#post()` for this mode
  delegates entirely to `cheques.service.js#endorseToExpense()` (already debugged clean). Only one
  ledger trail per cheque disposal ever exists, regardless of which screen triggered it, and the
  existing bounce/return-to-sender reversal (already built) handles it correctly with zero new
  reversal code. The user specifically corrected a wrong assumption mid-discussion — that endorsing
  a cheque protects it from later bouncing — with the design doc's own flagship example (bounce
  *after* full endorsement, reversing both sides); that correction is what led directly to the
  "reuse the same function" design instead of a bespoke one.
  - CASH/ONLINE/CHEQUE_ISSUED post normally (`Dr ba_id / Cr <cash/bank>`, own `EXPENSE`-sourced
    ledger rows). CHEQUE_ISSUED debits the same bank ONLINE would — deduct-on-write, the day the
    cheque is written, no separate `cheques` row (that table is for cheques *received*).
  - `unpost()` is deliberately BLOCKED for `CHEQUE_ENDORSED` (`USE_CHEQUE_REVERSAL`) — undoing a
    cheque disposition only ever happens through the cheque's own reversal mechanisms.
- **User-requested addition — "Cheque Return":** undo ONE `VENDOR_PAYMENT`/`EXPENSE_PAYMENT`
  allocation (e.g. a vendor hands the cheque back) without touching the cheque's other allocations
  or the receipt — narrower than `bounce()`/`returnToSender()` (which reverse *every* active
  allocation on a receipt). New `cheques.service.js#reverseAllocation()` — rejects a `DEPOSIT`
  (excluded on purpose, a different action), an already-`REVERSED` allocation, or a terminal
  cheque; writes one reversing ledger pair; recomputes cheque status back toward `PENDING`/
  `PARTIALLY_ENDORSED` (the mirror image of the existing forward-direction `recomputeStatus()`).
  New `listEndorsedAllocations()` + `cheques:endorsed-allocations`/`cheques:reverse-allocation` IPC
  channels.
- **Four real bugs found and fixed this pass:**
  1. `expenses.payment_mode`/`draft_expenses.payment_mode` were `VARCHAR(10)` — too narrow for
     `CHEQUE_ENDORSED` (15 chars) / `CHEQUE_ISSUED` (13 chars), sized for the old single-word modes.
     Widened via migration `005_expenses_payment_mode_width.sql` to `VARCHAR(20)` — but the FIRST
     fix attempt only widened the DB column and missed that `expenses.repository.js`/
     `draftExpenses.repository.js` ALSO declare the mssql parameter type width explicitly
     (`sql.VarChar(10)`), which Tedious enforces independent of the actual column width. Caught by
     a raw TDS protocol error on the very first CHEQUE_ISSUED test; had to fix both the column AND
     every `sql.VarChar(10)` parameter declaration referencing it.
  2. `draft_expenses` had drifted out of parity with `expenses` (documented as a "field-for-field
     mirror," but still only allowed the pre-split `'CHEQUE'` value and had no
     `issued_cheque_no`/`issued_cheque_date` columns at all). Fixed via migration
     `004_draft_expenses_parity.sql` — added the two columns, updated the mode CHECK to the 4-value
     set, added a `CK_draft_expenses_payment` mirroring `CK_expenses_payment`'s exact per-mode
     shape rules. Also synced the parallel, even-more-stale copy of this table (and `expenses`
     itself) in `database_schema_v4.3.md`, which still showed the pre-`cash_and_bank.md`-redesign
     shape entirely (plain `'CHEQUE'`, no split, no issued-cheque columns) — a pre-existing
     documentation drift from before this session, not something introduced now.
  3. **HIGH** — `post()` on a `CHEQUE_ENDORSED` expense called `endorseToExpense()` (its own
     committing transaction — real money movement) then flipped the expense's own `status` in a
     SEPARATE transaction. A failure in that second step after the first had committed would leave
     the expense stuck `DRAFT` with the cheque already genuinely disposed of; retrying `post()`
     would call `endorseToExpense()` a second time, silently double-allocating the cheque, and
     `draftExpenses.confirm()`'s compensating-delete safety net would then delete the expense row
     outright, orphaning the real allocation. Fixed via migration
     `006_cheque_allocations_expense_link_and_receipt_unique.sql`, adding a nullable
     `cheque_allocations.expense_id` back-reference — `post()` now checks
     `findAllocationByExpenseId()` before calling `endorseToExpense()` again, making it safely
     idempotent on retry; `draftExpenses.confirm()`'s catch block does the same check before
     deciding whether the compensating delete is safe. Found by the debugger (not by the extensive
     happy-path manual testing, which structurally can't hit a failure in that exact window) —
     re-verified live by explicitly simulating the failure: calling `endorseToExpense()` directly
     without the status flip (as if the process crashed there), then confirming a real
     `post()` retry detected the existing allocation, created no duplicate, and completed correctly
     — total allocated amount confirmed unchanged, not doubled.
  4. LOW — `dbo.cheques.receipt_id` had no DB-level uniqueness, only an app-level invariant (a
     cheque row is only ever inserted once, in the same transaction as its receipt). Added
     `UNIQUE INDEX UQ_cheques_receipt` in the same migration as fix 3, as defense in depth.
  5. Also caught and fixed, unrelated to the above: neither `receipts.service.js#list()` nor
     `expenses.service.js#list()` actually had the "Weekly/Monthly/Overall" `resolveDateRange()`
     convenience despite an earlier progress-log entry claiming receipts already did — both were
     thin `repository.list(filters)` pass-throughs with no shorthand resolution. Added to both,
     matching the `saleBills.service.js`/`purchases.service.js` convention exactly.
- **Frontend:** built `frontend/src/pages/ChequeReturnPage.tsx` — the "Endorsed Cheques" list +
  return-confirmation dialog UI, styled consistently with the existing (pre-existing, already
  demo-wired) `ChequesTab.tsx`. Per explicit instruction, **NOT connected** — "Confirm Return" does
  not dispatch against `AppContext`'s demo reducer (no such action exists there) and does not call
  the real backend; it shows a preview-only message and closes. Not added to navigation/routing.
- **Verified live** against `wentox_db`, extensively: CASH/ONLINE-to-vendor/CHEQUE_ISSUED all
  posted with correct ledger pairs (exact `ac_id`/`ba_id`/debit/credit checked); CHEQUE_ENDORSED
  against a freshly-received-and-posted cheque resulted in zero `EXPENSE`-sourced ledger rows and
  exactly the correct `CHEQUE_ALLOCATION`-sourced pair, cheque correctly `PARTIALLY_ENDORSED`;
  unpost blocked (`USE_CHEQUE_REVERSAL`); `reverseAllocation()` correctly freed the cheque back to
  `PENDING`, wrote the correct 2-row reversal, left the linked expense's status untouched
  (`CONFIRMED`, never touched — same philosophy as a bounced receipt); double-reverse rejected; the
  freed cheque was re-endorsed for its full amount (confirming the balance really was restored) and
  successfully bounced afterward; draft CRUD + confirm for all 4 modes; the compensating-delete
  safety net verified with a genuine failure (bad bank account, no allocation ever created —
  correctly deleted). Full regression pass of the whole Module 4.1+4.2 suite re-ran clean after
  every one of the 3 fix rounds. All test data cleaned up after.
- **Debugger review round 2** (verifying round 1's HIGH fix) found a further gap:
  `draftExpenses.confirm()` still minted a brand-new `expenses` row on EVERY call — so `post()`'s
  new per-`expense_id` idempotency check (from round 1's fix) would never find a PRIOR attempt's
  allocation, since a fresh `confirm()` retry always produces a fresh `expense_id`. This is the
  realistic recovery path a real user takes (retrying via the Drafts UI after a failed confirm)
  rather than a direct `expenses:post` retry, so it reopened the same double-disposal risk one
  layer up. **Fix**: added `draft_expenses.pending_expense_id` (migration
  `007_draft_expenses_pending_expense.sql`) — set on the draft right after `create()` succeeds but
  BEFORE `post()` is attempted, so ANY later `confirm()` call on that draft resumes against the
  SAME `expense_id` instead of minting another one. `confirm()`'s catch no longer deletes the
  expense at all for `CHEQUE_ENDORSED` (the old existence-check was superseded — resuming is now
  always possible via `pending_expense_id`, whether or not an allocation was actually created
  yet). Added a matching guard on `remove()`: deleting a draft with an unresolved
  `pending_expense_id` is now blocked (`PENDING_EXPENSE_UNRESOLVED`) — it would otherwise orphan a
  real stuck expense with no way back to it. Re-verified live by directly simulating the exact
  scenario (manually replicating `confirm()`'s first phase getting stuck — real expense created,
  `pending_expense_id` set, real allocation created via `endorseToExpense()`, status-flip
  deliberately skipped — then calling the real `confirm()` again on the same draft): correctly
  skipped `create()`, resumed against the same `expense_id`, completed via the idempotent `post()`,
  exactly 1 expense and 1 allocation existed throughout, draft deleted only on success.
- **Debugger review round 3** (verifying round 2's fix): clean — confirmed every throw point inside
  `post()`'s `CHEQUE_ENDORSED` branch is correctly covered by `pending_expense_id` resuming (not
  just the one specific failure point that was manually tested), confirmed the FK/guard/IPC-layer
  plumbing is all correct, and flagged one accepted residual risk (a narrower race between
  `create()`'s commit and `setPendingExpenseId()`'s commit — strictly less harmful than the
  original bug since nothing gets `post()`ed from that state, matches the same single-admin-
  desktop-app threat model already accepted elsewhere in this codebase for a similar TOCTOU, e.g.
  `milestones/milestone7.md`'s customer-duplicate-name check). One LOW finding: deleting a stuck
  expense directly (via the Expenses screen, not the Drafts UI) would hit the new
  `FK_draft_expenses_pending_expense` constraint with an opaque `INTERNAL` error, since raw SQL
  errors aren't `ApiError`s. **Fixed**: added `draftExpensesRepository.findByPendingExpenseId()`
  and a matching guard on `expenses.service.js#remove()` — throws a clear
  `PENDING_DRAFT_UNRESOLVED` pointing at the specific stuck draft instead. Re-verified live:
  direct-delete of a stuck expense correctly rejected with the clear message; resolving via
  `confirm()` retry still works cleanly afterward. Full regression pass (all three test scripts —
  the main Module 4.1+4.2 suite, the idempotent-`post()` simulation, and the `confirm()`-resume
  simulation) re-ran clean with zero failures. This closes out Module 4.2 — no further debugger
  rounds needed.
- **Not done:** frontend not wired to real data (see above — matches every other module so far).
- **Files:** `src/repositories/expenses.repository.js` (new), `src/services/expenses.service.js`
  (new), `src/ipc/expenses.ipc.js` (filled in from TODO stub); `src/repositories/
  draftExpenses.repository.js` (new), `src/services/draftExpenses.service.js` (new),
  `src/ipc/draftExpenses.ipc.js` (new); `src/repositories/cheques.repository.js`/
  `src/services/cheques.service.js`/`src/ipc/cheques.ipc.js` (extended — `findAllocationById`,
  `listEndorsedAllocations`, `reverseOneAllocation`/`reverseAllocation`,
  `findAllocationByExpenseId`, `insertAllocation`'s new `expense_id` param); `src/services/
  receipts.service.js` (added the missing `resolveDateRange()`); `src/ipc/index.js` (registered
  `draftExpenses`); `electron/preload.js` (FEATURES); `src/db/migrations/
  004_draft_expenses_parity.sql`, `005_expenses_payment_mode_width.sql`,
  `006_cheque_allocations_expense_link_and_receipt_unique.sql`,
  `007_draft_expenses_pending_expense.sql` (all new, all applied); `database/schema.sql`,
  `System_architecture/database_schema_v4.3.md` (all four migrations' end-states folded in, plus
  the pre-existing `expenses`/`draft_expenses` doc drift fixed);
  `frontend/src/pages/ChequeReturnPage.tsx` (new, unconnected); `backend/milestones/milestone4.md`
  (checkboxes — Module 4.2 now fully checked off, Milestone 4 complete).

## Milestone 4, Module 4.1 — Receipts / Jamma & Cheque Disposal

### 2026-08-04 — receipts/cheques/draftReceipts built, extensively live-verified; two real schema bugs found and fixed
- **What:** The largest, most interlocking module built this session: `receipts` (CASH/ONLINE/CHEQUE,
  commission tracking), `cheques` (the received-cheque disposal lifecycle: deposit/endorse-to-
  vendor/endorse-to-expense/mark-cleared/bounce), and `draftReceipts`. Plus a user-requested
  addition beyond the original checklist: a "returned to sender" cheque disposition, distinct from
  a bank bounce.
- **How — Receipts:**
  - Always created `DRAFT` explicitly (same discipline as transfers/wage_runs/salary_runs — never
    relies on the column's own `DEFAULT('CONFIRMED')`).
  - `resolveDebitSide(payment_mode, bank_id)` centralizes which account a receipt debits: CASH →
    `CASH_IN_HAND` chart account (`ac_id`), ONLINE → the **specific bank's own linked
    `business_accounts.ba_id`** (not the generic `BANK_ACCOUNTS` chart code — Module 4.3 built
    earlier this session specifically gives each bank its own account for this reason), CHEQUE →
    `CHEQUES_IN_HAND` chart account. This same function is reused by the bounce/return reversal
    logic, so a reversal always lands back on the exact account the original posting used.
  - Commission > 0 writes a wholly separate `Dr COMMISSION_ALLOWED / Cr customer BA` ledger pair —
    the underlying sale bill is never retroactively touched (`database_schema_v4.3.md` §7).
  - A CHEQUE-mode receipt auto-creates its linked `cheques` row (status `PENDING`) in the SAME
    transaction as the receipt insert — the schema's own circular-FK note (`cheques.receipt_id` /
    `receipts.cheque_id` reference each other) describes a 3-step dance: insert receipt with
    `cheque_id` NULL, insert the cheque, link back. `update()`/`remove()` on a DRAFT receipt that
    switches out of CHEQUE mode (or is deleted outright) correctly unlinks before deleting the
    orphaned cheque row, in that order (breaking the FK the same way it was built).
- **How — Cheques:**
  - Once the underlying receipt is `CONFIRMED`, a cheque can be disposed of three ways, split across
    multiple partial actions: **DEPOSIT** (no ledger entry at all — the customer was already
    credited at receipt-post time; depositing only relocates the money to a specific bank for
    balance-tracking, per `cash_and_bank.md` §10's derived-balance formula; enforced that one cheque
    is never deposited into two different banks), **VENDOR_PAYMENT**/**EXPENSE_PAYMENT** (both DO
    write `Dr target BA / Cr CHEQUES_IN_HAND` — handing a cheque to someone else actually moves
    money out, unlike a deposit into your own bank). `recomputeStatus()` derives
    `DEPOSITED`/`ENDORSED`/`PARTIALLY_ENDORSED` from the remaining un-allocated balance after each
    action, computed via a transaction-aware sum (see bug #1 below). `markCleared()` is a
    `DEPOSITED`-only pure status flip, no ledger effect.
  - **User-requested addition**: `RETURNED` — a new cheque status distinct from `BOUNCED`, same
    reverse-never-delete mechanics, own `returned_date`/`return_reason` columns, for a reason that
    isn't a bank bounce (e.g. a due-date issue). Added via migration `002_cheques_returned_status.sql`.
  - `reverseCheque()` — one shared function for both BOUNCE and RETURN: reverses every `ACTIVE`
    `cheque_allocations` row for the receipt (flips to `REVERSED`, writes an opposite ledger pair),
    then reverses the receipt's own ledger effect (only if it was `CONFIRMED`) using the same
    `resolveDebitSide()` logic posting used — all dated the bounce/return date, all new rows,
    nothing deleted (`database_schema_v4.3.md` §6.1).
- **Two real bugs found and fixed mid-session, both caught by live testing, not just review:**
  1. **`recomputeStatus()` read stale data.** It calls `sumActiveAllocations()` right after inserting
     a new allocation in the same transaction — but the original `sumActiveAllocations()` used the
     plain connection pool (a different DB connection than the transaction), which cannot see an
     uncommitted insert from another connection. Added a transaction-aware
     `sumActiveAllocationsInTransaction()` variant and switched `recomputeStatus()` to use it. Caught
     by re-deriving the logic during implementation, before the first live test run.
  2. **Reversing a DEPOSIT allocation crashed.** `reverseCheque()` originally tried to write a
     reversal ledger pair for EVERY reversed allocation — but `DEPOSIT` allocations never had a
     ledger entry to begin with (that's the whole point of the deposit-has-no-ledger-effect design),
     so the attempted reversal row had neither `ac_id` nor `ba_id` set, violating
     `CK_ledger_entries_one`. This one WAS only caught by the first live test run (bouncing a cheque
     that had both a partial deposit and a vendor endorsement on it) — fixed by skipping `DEPOSIT`
     allocations in the reversal loop (their status still flips to `REVERSED` via
     `reverseAllocations()`, just no ledger write), re-verified live.
  3. **Found and fixed a genuine schema bug, not just an app bug**: `CK_receipts_cheque` as
     originally written (`payment_mode='CHEQUE' AND cheque_id IS NOT NULL`) is literally impossible
     to satisfy given the schema's own documented two-step insert plan — SQL Server checks `CHECK`
     constraints per-statement, not deferred to commit, so step 1 (`insert receipts with cheque_id
     NULL`) would always violate it immediately. This surfaced as a real `CK_receipts_cheque`
     violation on the very first CHEQUE-receipt test. Relaxed via migration
     `003_receipts_cheque_check_relax.sql` to `(payment_mode <> 'CHEQUE' AND cheque_id IS NULL) OR
     (payment_mode = 'CHEQUE')` — still catches a non-cheque receipt ever carrying a `cheque_id`
     (the bug class actually worth a DB-level guard), while allowing the transient NULL the insert
     plan requires. The "every CHEQUE receipt eventually gets a real `cheque_id`" guarantee now
     lives at the application layer (`receipts.service.js#create()` always does both inserts in one
     `withTransaction`). Both `database_schema_v4.3.md` and `database/schema.sql` updated to match.
- **How — draftReceipts:** CASH/ONLINE only — `dbo.draft_receipts` carries a `cheque_id` FK for
  shape-symmetry with `dbo.receipts` but has no `cheque_no`/`cheque_date` columns of its own, so a
  genuinely useful draft CHEQUE receipt isn't representable; rejected with a message pointing at
  `receipts:create` instead. `confirm()` = create the real receipt + post it, as two sequential
  transactions (not one shared transaction like `draftPurchases.confirm()`) — acceptable since a
  receipt has no line items to keep atomic alongside posting, unlike a purchase.
- **Verified live** against `wentox_db`, extensively (two full runs, the first caught bug #3 above):
  CASH receipt posted with correct ledger pair; ONLINE + commission posted with correct 4 rows
  (exact `ac_id`/`ba_id`/debit/credit checked on each); CHEQUE receipt created `PENDING`;
  deposit-before-posting rejected (`RECEIPT_NOT_POSTED`); partial deposit (12000/20000) →
  `PARTIALLY_ENDORSED`, zero new ledger rows; cross-bank deposit rejected; remaining balance
  endorsed to a vendor → `ENDORSED`, exactly 2 correct ledger rows; separate cheque fully deposited
  → `DEPOSITED` → `markCleared()` → `CLEARED`; double-clear rejected (`NOT_DEPOSITED`); bouncing the
  partially-deposited-then-fully-endorsed cheque correctly reversed BOTH allocations to `REVERSED`,
  wrote exactly ONE reversal ledger pair (vendor endorsement only, confirming bug #2's fix), and
  reversed the receipt's original 2 rows with 2 new rows dated the bounce date, landing on the exact
  same accounts, debit/credit swapped, originals completely unchanged; double-bounce rejected
  (`CHEQUE_TERMINAL`); unposting a receipt with an already-disposed cheque rejected
  (`CHEQUE_IN_USE`); return-to-sender on a fresh cheque correctly stored a reason and reversed
  correctly; draft receipt CRUD, CHEQUE-mode draft rejection, `confirm()`, and
  update-while-DRAFT/blocked-while-CONFIRMED all verified. All test data cleaned up after.
- **Debugger review:** found 2 issues (thorough pass given this module's size). **Moderate**:
  `draftReceipts.confirm()` ran `create()`+`post()` as two separate transactions — a failure in
  `post()` after `create()` had committed left an orphaned DRAFT receipt AND the draft itself
  intact, so retrying `confirm()` would call `create()` again and produce a duplicate real receipt.
  Fixed by refactoring `receipts.service.js` into transaction-scoped building blocks
  (`insertReceipt()`, `postWithinTransaction()`) that both `create()`/`post()` and
  `draftReceipts.confirm()` now share, so confirm is genuinely one atomic transaction. Re-verified
  live with a forced mid-transaction failure (a customer with `ba_id` temporarily nulled): 0
  orphaned receipts, draft still present and safely retryable, exactly 1 receipt (not 2) after
  fixing the cause and retrying. **Minor**: `cheques.service.js#reverseCheque()`'s commission-
  reversal branch was missing the same `if (!commissionAccount) throw ...` guard every other
  reserved-account lookup in this module has — added for consistency (low real-world risk, seeding
  guarantees the row exists, but would've thrown an opaque error instead of the clear diagnostic
  used everywhere else).
- **Not done:** no frontend page for Receipts/Cheques exists yet.
- **Files:** `src/repositories/receipts.repository.js` (new), `src/services/receipts.service.js`
  (new), `src/ipc/receipts.ipc.js` (filled in from TODO stub); `src/repositories/cheques.repository.js`
  (new), `src/services/cheques.service.js` (new), `src/ipc/cheques.ipc.js` (new);
  `src/repositories/draftReceipts.repository.js` (new), `src/services/draftReceipts.service.js`
  (new), `src/ipc/draftReceipts.ipc.js` (new); `src/ipc/index.js` (registered both new features);
  `electron/preload.js` (FEATURES); `src/db/migrations/002_cheques_returned_status.sql`,
  `src/db/migrations/003_receipts_cheque_check_relax.sql` (both new, applied); `database/schema.sql`,
  `System_architecture/database_schema_v4.3.md` (both migrations' end-states folded in);
  `backend/milestones/milestone4.md` (checkboxes).

## Milestone 5, Modules 5.1 & 5.3 — Current Stock/Production, Search & Bilty/Adda Updation

### 2026-08-04 — stock/reports/bilty-search built, live-verified; Module 5.2 (Reports) deliberately skipped
- **What:** Two of Milestone 5's three modules, per explicit instruction to skip 5.2 (Reports) for
  later. No schema changes — `dbo.stock_movements`/`dbo.article_colors` already existed; Module
  5.3 extends the existing `saleBills` module rather than creating a new one.
- **How:**
  - **5.1 (`stock`, `reports:stock`/`reports:production`):** stock is tracked per VARIANT
    (article+color), not per article — `stock:log-production` resolves/auto-creates the variant via
    `productColorsService.resolveOrCreate()` (UC-28, pre-existing helper from an earlier
    milestone), then normalizes an operator-typed CARTONS or PAIRS quantity into `qty_pairs` using
    the variant's effective packing (`COALESCE(article_colors.packing, articles.packing)`),
    snapshotting that packing onto the row regardless of which unit was typed. `stock:adjust`
    handles OPENING/ADJUSTMENT (signed qty, no packing/input_qty/input_unit — those are
    PRODUCTION-only columns per the schema's own comments); a zero `qty_pairs` is rejected as a
    friendly 400 even though the DB itself doesn't forbid it. `reports:stock` (Current Stock tab)
    is a thin pass-through to `stock.service.js#currentStock()` rather than a separate
    implementation — kept as its own channel per the milestone's naming. `reports:production`
    filters to PRODUCTION-only movements with the same daily/weekly/monthly/overall date-range
    convention as `saleBills.service.js`/`purchases.service.js`.
  - **5.3 (`sale-bills:bilty-search`/`sale-bills:update-bilty`):** `updateBiltyInfo()` touches only
    `bilty_no`/`adda_id` — never `ledger_entries`/`stock_movements`/any other header field — so
    unlike the full `update()` (which reverses+reapplies ledger/stock when editing an
    already-posted bill) it doesn't check or care about posted status at all, matching "allowed on
    POSTED bills; non-financial." `biltySearch()` reuses the same filter shape as the pre-existing
    `list()` but joins in customer/sub-customer/adda display names for the search screen.
- **Verified live** against `wentox_db`: production logged in CARTONS against a brand-new color
  auto-created the variant and normalized correctly (5×12=60 pairs); a second production log in
  PAIRS against the same color resolved to the SAME variant, not a duplicate; an ADJUSTMENT of -3
  recorded; movement history returned all 3 rows; current stock correctly showed 65 total pairs →
  5 cartons + 5 extra pairs; production report with a date range correctly excluded the ADJUSTMENT;
  invalid `input_unit` and zero-`qty_pairs` adjustment both rejected. Bilty: search by customer_id
  and by bill_no both returned correct joined rows; `update-bilty` changed `bilty_no`/`adda_id`
  while `is_posted` was confirmed unchanged before/after; missing `bilty_no` rejected; original
  value restored after the test. All test rows cleaned up after.
- **Debugger review:** clean, no bugs found (packing fallback, sign-constraint safety, `GROUP BY`
  correctness, cross-service conventions, `updateBiltyInfo()` genuinely ledger/stock-free — all
  confirmed). Noted one pre-existing quirk, not a regression: `resolveDateRange()`'s `'daily'`
  range value isn't explicitly handled anywhere in the codebase (falls through to no date filter)
  — true of the original `saleBills.service.js` version this was copied from too.
- **Not done:** Module 5.2 (Reports — 9 more
  `reports:*` channels: product-ledger, vendor-stock, sale-analysis, sale-report, vendor-report,
  payment-trail, account-ledger, business-ledger, cash-book) deliberately not started, per explicit
  instruction to leave it for later. No frontend page for Current Stock/Production or Search &
  Bilty Updation exists yet.
- **Files:** `src/repositories/stock.repository.js`, `src/services/stock.service.js`,
  `src/ipc/stock.ipc.js` (all replaced empty/TODO stubs); `src/repositories/reports.repository.js`,
  `src/services/reports.service.js`, `src/ipc/reports.ipc.js` (same — only `stock`/`production`
  built, the rest of Module 5.2 left as empty exports); `src/repositories/saleBills.repository.js`,
  `src/services/saleBills.service.js`, `src/ipc/saleBills.ipc.js` (extended, not rewritten — new
  `biltySearch`/`updateBiltyInfo` functions and two new IPC handlers appended);
  `backend/milestones/milestone5.md` (checkboxes).

## Milestone 4, Module 4.7 — Salary Run

### 2026-08-04 — salaryRuns CRUD + post/unpost built, live-verified, debugged clean
- **What:** One run per calendar month, covering every ACTIVE salaried employee automatically —
  unlike Wage Run, the caller never enumerates lines, only supplies optional per-employee
  `overrides`. No schema changes — `dbo.salary_runs`/`dbo.salary_run_items` already existed.
- **How:**
  - `buildLines()` is server-authoritative: queries `employeesRepository.list({employee_type:
    'SALARIED'})` fresh every time (create AND update), builds one line per active employee.
    `salary_amount` is always a fresh snapshot of `employees.monthly_salary`, never trusted from
    any override; `amount` defaults to `salary_amount` unless an override for that `employee_id`
    supplies one — matching payroll.md §11's two-column design (snapshot vs. what was credited)
    exactly. Unlike `wage_run_items.amount`, `salary_run_items.amount`/`salary_amount` are plain
    columns, not DB-computed — nothing to derive, both written explicitly.
  - `normalizeMonth()` truncates whatever date the caller sends down to that month's 1st
    (UTC-safe), matching `CK_salary_runs_month`, so the caller never has to get the day right.
  - One CONFIRMED run per month enforced twice: `assertMonthNotConfirmed()` at both `create()` time
    and again at `post()` time (a DRAFT built before a sibling DRAFT for the same month got
    confirmed first would otherwise slip through the create()-time check alone), backstopped by the
    DB's own filtered `UQ_salary_runs_month` (CONFIRMED-only — DRAFTs for the same month are
    unconstrained by design, "a correction can be built alongside").
  - Post writes 1 debit (SALARIES EXPENSE, `410002`, the run's total) + N credit rows, one per
    line, against each employee's own `ba_id` for their own (possibly overridden) `amount` — not a
    single Dr/Cr pair like Wage Run or Transfer.
  - Lifecycle otherwise mirrors Wage Run exactly: always created DRAFT explicitly; update()/
    remove() blocked while CONFIRMED; update() rebuilds the roster fresh (delete-then-reinsert,
    never patched); unpost is audited the same way (`unposted_at`/`unposted_by`/`amount_before`,
    cleared back to `NULL` on every re-post).
  - Mid-session fix: initially had no guard against creating a run when zero active salaried
    employees exist — caught while re-checking the milestone's own verify checklist line ("create a
    run for a month with no active salaried employees → empty/rejected appropriately"), which
    hadn't actually been tested yet. Added a clean `ApiError.badRequest` in both `create()` and
    `update()`, re-verified live before the debugger pass.
  - Registered `ipc/salaryRuns.ipc.js` in `src/ipc/index.js`; added `'salaryRuns'` to
    `electron/preload.js`'s `FEATURES` array.
- **Verified live** against `wentox_db` (two throwaway SALARIED employees, salaries 50000/40000,
  any other pre-existing active salaried employees temporarily deactivated so the test roster was
  exact): create with no overrides → both included, total=90000; second DRAFT for same month
  allowed; update with a deduction override (emp2 → amount=35000, remarks) → total=85000,
  `salary_amount` stayed 40000 on that line; post → ledger confirmed as exactly 1 debit
  (85000) + 2 credits (35000, 50000) against the right `ba_id`s; second run for the now-confirmed
  month rejected (`MONTH_ALREADY_CONFIRMED` with the existing run's id); double-post blocked;
  update-while-posted blocked; unpost → `amount_before`=85000, ledger rows removed, month usable
  again afterward; remove-while-draft succeeded; empty-roster create correctly rejected. All test
  rows cleaned up after. Debugger review: clean, no bugs found — also independently confirmed the
  `update()`-skips-month-recheck design is safe, since `post()` always re-checks regardless.
- **Not done:** no frontend page for Salary Run exists yet.
- **Files:** `src/repositories/salaryRuns.repository.js` (new), `src/services/salaryRuns.service.js`
  (new), `src/ipc/salaryRuns.ipc.js` (new), `src/ipc/index.js` (registered), `electron/preload.js`
  (FEATURES), `backend/milestones/milestone4.md` (checkboxes).

**Milestone 4 status:** Modules 4.3–4.7 are now all code-complete and debugged clean across this
session. Modules 4.1 (Receipts) and 4.2 (Expenses) remain unbuilt (empty stub files) — Milestone 4
is not finished until those are done too, even though the harder/newer payroll and cash-and-bank
scope (4.3-4.7) is now ahead of the originally-planned 4.1/4.2.

## Milestone 4, Module 4.6 — Wage Run

### 2026-08-04 — wageRuns CRUD + post/unpost built, live-verified with real arithmetic
- **What:** One settlement = one worker + one stage + many article lines, reading `dbo.articles`'
  12 stage-cost columns (write-only until now) and writing `ledger_entries` only — no stock
  movement. No schema changes — `dbo.wage_runs`/`dbo.wage_run_items` already existed and were
  already applied.
- **How:**
  - `validateEmployeeStage()` fetches the worker via `employeesService.getById()` and checks the
    requested `stage_key` is actually one of that worker's trades before anything else runs — this
    is the real enforcement of "the stage list on create must filter to the chosen worker's trades
    only" (the frontend filters visually, this is where it's actually guaranteed); the composite FK
    `(employee_id, employee_type)` pinned to `'WORKER'` backstops it at the DB level regardless.
  - `resolveLines()` snapshots `rate`/`packing` from the article's CURRENT figures at the moment a
    line is (re-)added, using `src/constants/stages.js`'s stage_key→cost_column map (built in
    Module 4.5) to know which of the 12 columns to read. `rate` can be overridden by a
    caller-supplied value (operator can type over the auto-filled rate, per payroll.md §7);
    `packing` never can — always `article.packing`, ignoring anything the caller supplies for it.
  - `buildTotal()` computes `total_amount` in JS using the exact same formula
    (`rate * cartons * packing`) as `wage_run_items.amount`'s DB-side `PERSISTED` computed column,
    confirmed matching exactly in the live test (1200 for 5×20×12, 2400 for 10×20×12) — no drift.
  - Lifecycle mirrors transfers/purchases: always created `DRAFT` explicitly; `update()`/`remove()`
    blocked while `CONFIRMED` (unpost first); `update()` always deletes-then-reinserts items rather
    than patching, matching payroll.md §8's "an edit is a fresh statement of what happened."
  - Post: `Dr WAGES EXPENSE (410001) / Cr worker.ba_id`, `source_type='WAGE_RUN'`.
  - Unpost is audited (payroll.md §8): `unposted_at`/`unposted_by`/`amount_before` are set on every
    unpost. Note: `CK_wage_runs_unpost` at the DB level only actually requires `unposted_at IS NOT
    NULL` when any of the three are set — not true all-or-nothing, despite the milestone checklist's
    original "enforces all-or-nothing" phrasing (checked schema.sql directly to confirm). The
    service sets all three together regardless, which is the intended behavior either way.
    `markPosted()` clears all three back to `NULL` on every post, so a stale audit trail from an
    earlier unpost cycle never lingers on a run that's since been reposted.
  - No duplicate-settlement guard, by design (payroll.md §5) — `recentRuns()`/`wage-runs:recent`
    returns that worker's last 3 runs for the selected stage (any status) instead.
  - Registered `ipc/wageRuns.ipc.js` in `src/ipc/index.js`; added `'wageRuns'` to
    `electron/preload.js`'s `FEATURES` array.
- **Verified live** against `wentox_db` (throwaway WORKER with a 'cutting' trade, throwaway article
  with cutting rate=20/packing=12): stage-not-in-worker's-trades rejected; create with 5 cartons →
  `total_amount=1200`, correct rate/cartons/packing snapshot on the item; `recentRuns` returned 1
  row; post → `CONFIRMED` with correct Dr(ac_id)/Cr(ba_id) ledger pair; double-post blocked
  (`ALREADY_POSTED`); update-while-posted blocked (`POSTED_LOCK`); unpost → `DRAFT`,
  `unposted_by`/`amount_before`/`unposted_at` all correctly set, ledger rows removed; edit-while-
  draft re-snapshotted with 10 cartons → `total_amount=2400`; remove-while-draft succeeded. All
  test rows cleaned up after.
- **Not done:** debugger review still running as of this entry. No frontend page for Wage Run
  exists yet. The full `getEmployeeBalance()` helper from payroll.md §6 (BAQAYA/BANAM/NET BALANCE)
  was deliberately NOT built here — it needs Expenses (payments) data, which doesn't exist yet;
  revisit when Expenses is built or this becomes a reports concern.
- **Files:** `src/repositories/wageRuns.repository.js` (new), `src/services/wageRuns.service.js`
  (new), `src/ipc/wageRuns.ipc.js` (new), `src/ipc/index.js` (registered), `electron/preload.js`
  (FEATURES), `backend/milestones/milestone4.md` (checkboxes).

## Milestone 4, Module 4.5 — Employees, Stages & Worker Trades

### 2026-08-04 — employees/stages CRUD built, live-verified against payroll.md's exact checklist
- **What:** `employees` (WORKER/SALARIED, one table per payroll.md §2) and `stages` (read-only, the
  12 manufacturing stages). No schema changes — `dbo.employees`/`dbo.stages`/`dbo.worker_stages`
  already existed and were already applied.
- **How:**
  - New `src/constants/stages.js` — single source of truth for the 12 stages' seed data (stage_key/
    form_label/worker_label/cost_column, sort_order = array index+1), seeded into `dbo.stages` by
    `src/db/seeds/run.js`. Frontend's `COST_FIELDS` (`types/index.ts`) is the only other copy —
    different runtime, left alone, not a third duplicate of the same data.
  - 4 new reserved chart-account codes added to `reservedAccounts.js` and seeded: `WORKER_WAGES`
    (`220001`), `SALARIES_PAYABLE` (`220002`) — both LIABILITY, since baqaya/net-balance is a debt,
    not an expense, per payroll.md §3 — and `WAGES_EXPENSE` (`410001`)/`SALARIES_EXPENSE`
    (`410002`), both EXPENSES, for Module 4.6/4.7's posting later.
  - `employees.service.js:validate(payload, employeeType)` takes the type as an explicit param
    rather than reading `payload.employee_type` internally — this is what lets `update()` validate
    against the row's real, existing type instead of trusting whatever the payload claims.
  - `employee_type` immutability (payroll.md §7): `update()` rejects outright
    (`payload.employee_type !== existing.employee_type` → `TYPE_IMMUTABLE`, 400) before anything
    else runs; every type-dependent field afterward (`monthly_salary`, whether trades apply) is
    derived from `existing.employee_type`, never the payload — so omitting `employee_type` from an
    update call can't accidentally slip a type change through a gap in the explicit check.
  - `create()` auto-links a `business_accounts` row under the correct head via
    `createUnderChartCode` (same transaction-safety pattern as vendors/customers/bankAccounts); a
    WORKER's trades are written via `replaceTrades()` (delete-all-then-reinsert) inside the same
    transaction.
  - Mid-session fix: `employees.repository.js:update()` was originally a plain non-transactional
    `query()` call (copy-pasted from the vendors reference pattern before this module's specific
    need became clear) — changed to accept a `transaction` param so it commits/rolls back together
    with `replaceTrades()` in `update()`'s single `withTransaction` block, catching a would-be gap
    before it was ever run live.
  - Duplicate-name handling: same reactivate-instead-of-reject pattern as vendors (name+phone key),
    built in from day one.
  - Registered `ipc/employees.ipc.js`/`ipc/stages.ipc.js` in `src/ipc/index.js`; added
    `'employees'`/`'stages'` to `electron/preload.js`'s `FEATURES` array.
- **Verified live** against `wentox_db`, matching payroll.md's/milestone4.md's exact verify
  checklist: 0-trade worker rejected; invalid `stage_key` rejected; worker with 1 trade created →
  linked BA confirmed under chart code `220001`; salaried employee with no salary rejected →
  linked BA confirmed under `220002`; `employee_type` change on update rejected; worker's trade set
  successfully replaced (remove one, add another) via `update()`; active-duplicate rejected;
  soft-delete → inactive-duplicate correctly flagged with reactivate `details`; `reactivate()`
  restores `is_active`. All test rows cleaned up after.
- **Debugger review:** clean, no critical/high-severity bugs (monthly_salary correctness,
  replaceTrades() WORKER-only gating, TYPE_IMMUTABLE bypass check, transaction safety, IPC/preload
  wiring, stages read-only-ness, SQL injection — all confirmed correct). One low-severity gap
  found and fixed same-pass: `validate()` didn't dedupe `payload.stages`, so a duplicate
  `stage_key` (e.g. `['cutting','cutting']`) would hit `PK_worker_stages` and surface a raw SQL
  error instead of a clean 400 — added a `Set` size check, re-verified live.
- **Not done:** no frontend page for Employees exists yet (same gap as everywhere else). Module
  4.6/4.7 (Wage Run/Salary Run posting, which is what actually reads the trades/salary this module
  writes) not started.
- **Files:** `src/constants/stages.js` (new), `src/constants/reservedAccounts.js` (4 new codes),
  `src/db/seeds/run.js` (seed logic), `src/repositories/employees.repository.js` (new),
  `src/services/employees.service.js` (new), `src/ipc/employees.ipc.js` (new),
  `src/repositories/stages.repository.js` (new), `src/services/stages.service.js` (new),
  `src/ipc/stages.ipc.js` (new), `src/ipc/index.js` (registered both), `electron/preload.js`
  (FEATURES), `backend/milestones/milestone4.md` (checkboxes).

## Milestone 4, Module 4.4 — Transfer

### 2026-08-04 — transfers CRUD + post/unpost built, live-verified
- **What:** `transfers` — moves money between two of WentoX's own `business_accounts` rows (cash↔
  bank, bank↔bank). No schema changes needed — `dbo.transfers` and `TRANSFER` in
  `CK_ledger_entries_src` already existed in `database/schema.sql`.
- **How:**
  - `dbo.transfers` has a real stored `status` column (`DRAFT`/`CONFIRMED`), unlike sale_bills/
    purchases which derive "posted" from `ledger_entries` existence — so this module's `isPosted`
    equivalent is just reading `status` directly, not a derived query. `create()` explicitly inserts
    `'DRAFT'` regardless of the column's `DEFAULT ('CONFIRMED')` — only `post()` moves it to
    `CONFIRMED` and writes the ledger pair; `unpost()` deletes the ledger pair and reverts to
    `DRAFT`. Same create-as-DRAFT-then-post shape as `purchases.service.js`.
  - Post writes exactly one ledger pair per transfer: `Dr to_ba_id` / `Cr from_ba_id`,
    `source_type='TRANSFER'` (`cash_and_bank.md` §7) — verified live the debit lands on the
    destination and credit on the source, not swapped.
  - `from_ba_id === to_ba_id` validated in the service (`ApiError.badRequest`, clean 400) ahead of
    the DB's own `CK_transfers_distinct`, which still backstops it.
  - `update()`/`remove()` blocked while `status === 'CONFIRMED'` (unpost first) — same rule as
    `purchases.service.js:update()`. `remove()` is a hard `DELETE`, not soft-delete — `transfers` is
    a transaction table, and schema.sql's own top-of-file convention note says soft-delete
    (`is_active`) is for lookup/setup tables only, transactions "live in DRAFT or get edited."
    (`dbo.transfers` has no `is_active` column at all, confirming this.)
  - Added `businessAccountsService.getById()` (didn't exist — only `createUnderChartCode`/
    `renameLinked` were exported) so `transfers.service.js` validates `from_ba_id`/`to_ba_id`
    actually exist (404s otherwise) through the proper service layer instead of reaching into
    `businessAccounts.repository.js` directly from another feature.
  - Registered `ipc/transfers.ipc.js` in `src/ipc/index.js`; added `'transfers'` to
    `electron/preload.js`'s `FEATURES` array.
- **Verified live** against `wentox_db`: create → DRAFT; same-account rejected; post → `CONFIRMED`
  with correct Dr/Cr ledger pair; double-post blocked (`ALREADY_POSTED`); update-while-posted
  blocked (`POSTED_LOCK`); unpost → ledger rows gone, back to `DRAFT`; remove works while `DRAFT`.
  Two throwaway bank accounts (via `bankAccounts.service.js`) stood in for the two sides; all test
  rows cleaned up after. Debugger review: clean, no bugs found.
- **Not done:** report-level exclusion of `TRANSFER` from Cash Book/income/expense totals
  (`cash_and_bank.md` §11 item 13) — no reports exist at all yet (Milestone 5). No frontend screen.
- **Files:** `src/repositories/transfers.repository.js` (new), `src/services/transfers.service.js`
  (new), `src/ipc/transfers.ipc.js` (new), `src/ipc/index.js` (registered), `electron/preload.js`
  (FEATURES), `src/services/businessAccounts.service.js` (added `getById`),
  `backend/milestones/milestone4.md` (checkboxes).

## Milestone 4, Module 4.3 — Bank Accounts

### 2026-08-04 — bankAccounts CRUD built (repository/service/ipc), reactivate pattern from day one
- **What:** First code for Module 4.3. `bankAccounts` party pattern, same shape as vendors/customers
  — own `bank_id` PK plus a linked `business_accounts` row under the reserved BANK ACCOUNTS chart
  account, both writes in one transaction.
- **How:**
  - Schema: added `account_no`/`branch` columns to `dbo.bank_accounts` (the table only had `name`
    before this — milestone spec calls for name/account_no/branch/opening_balance/opening_date, but
    opening_balance/opening_date deliberately live on the linked `business_accounts` row instead,
    per `cash_and_bank.md` §3's explicit reasoning, not on `bank_accounts` itself). Dropped the
    table's `UNIQUE(name)` constraint — two bank accounts can share a bank name with a different
    account_no (e.g. two "Meezan Bank" accounts), so uniqueness is name+account_no, service-layer
    only, same shape as vendors' name+phone.
  - `CODES.CASH_AT_BANKS` renamed to `CODES.BANK_ACCOUNTS` — this reserved chart account (code
    `100003`) already existed and was already seeded, just under its stale pre-correction name
    "Cash at Banks"; `cash_and_bank.md` §11 item 6 explicitly calls for this rename. Seed name
    corrected to `'BANK ACCOUNTS'` in `src/db/seeds/run.js`. Note: `ensureChartAccount()` in that
    seed script is insert-only (no-op if the code already exists), so this rename only takes effect
    on a fresh `npm run seed` — not an issue right now since `database/schema.sql` hasn't been
    applied to a real DB in this environment yet, but flag it if this is ever run against a DB that
    was seeded before this change.
  - Built the reactivate-instead-of-reject duplicate pattern (see the Cross-cutting section below)
    into `create()`/`update()` from the start, rather than needing a later retrofit like every other
    entity did: name+account_no key, ACTIVE match blocks (`DUPLICATE_NAME`), INACTIVE match throws
    `INACTIVE_DUPLICATE` with `details`, new `bank-accounts:reactivate` IPC channel.
  - Registered `ipc/bankAccounts.ipc.js` in `src/ipc/index.js`; added `'bankAccounts'` to
    `electron/preload.js`'s `FEATURES` array — it was missing, so the channel wouldn't have been
    reachable from the renderer even once the handler existed.
- **Not done:** not run against a live `wentox_db` yet (code untested end-to-end — no migrate/seed/
  manual IPC call verification this pass). No frontend page for Bank Accounts exists at all yet
  (same "backend real, frontend still on demo data" state as every other entity).
- **Files:** `database_schema_v4.3.md`, `database/schema.sql` (bank_accounts columns/constraint);
  `src/constants/reservedAccounts.js`, `src/db/seeds/run.js` (rename); `src/repositories/
  bankAccounts.repository.js` (new), `src/services/bankAccounts.service.js` (filled in from empty
  stub), `src/ipc/bankAccounts.ipc.js` (new), `src/ipc/index.js` (registered); `electron/
  preload.js` (added to FEATURES); `backend/milestones/milestone4.md` (checkboxes).

## Cross-cutting — Reactivate-instead-of-reject duplicate handling

### 2026-08-04 — Rolled out to every built entity (vendors, customers, sub-customers, regions, cities, stores, categories, addas, products)
- **What:** Replaced flat "reject on any name match" duplicate checks with reactivate-aware ones,
  everywhere that entity actually has CRUD code today. Two branches (see
  `System_architecture/soft_delete_and_duplicate_check.md` for full reasoning):
  - **Unique-by-nature** (vendors, regions, cities, stores, categories, addas, products) — ACTIVE
    match still blocks `create()` (`DUPLICATE_NAME`, 409); INACTIVE match now throws
    `INACTIVE_DUPLICATE` with the existing row's id/name in `ApiError`'s new `details` field
    (threaded through `wrap.js`), and a new `<feature>:reactivate` channel flips it back to active.
    Vendors and products key on name+phone / name+vendor_id (a second field, since those two can
    legitimately repeat a name); regions/cities/stores/categories/addas key on name alone, matching
    their existing DB-level `UNIQUE(name)` constraints, which were left in place.
  - **Non-blocking** (customers, sub-customers) — real people share names, so an ACTIVE match never
    blocks `create()`. New `checkName(name)` fn + `<feature>:checkName` channel the frontend is
    expected to call *before* `create()`, returning `{status:'none'|'active'|'inactive', matches:[]}`;
    only `'inactive'` needs a decision (reactivate one of the matches, or create new anyway).
  - **Products** had no duplicate-name check of any kind before this — added key = name+vendor_id.
  - Dropped two stray DB-level `UNIQUE(name)` constraints that would have silently overridden the
    non-blocking branch: `vendors.name`, `sub_customers.name` (`customers.name` never had one).
  - **Not done:** bank accounts and employees — both are still empty stub files (Milestone 4, no
    CRUD written yet), so there's nothing to attach this pattern to there.
- **Frontend:** Built `frontend/src/components/DuplicateNamePromptModal.tsx`, a reusable prompt
  covering both branches (`allowCreateOnActive` toggles which). **Not wired into any page** —
  every setup page for these entities (`RegionSetupPage.tsx`, `CitySetupPage.tsx`,
  `StoreSetupPage.tsx`, `CategorySetupPage.tsx`, `AddaSetupPage.tsx`, `VendorSetupPage.tsx`,
  `ProductSetupPage.tsx`, `CustomerSetupPage.tsx`, `SubCustomerSetupPage.tsx`) still runs on the
  old in-memory `useReducer` demo state (`AppContext.tsx`), not real `window.api` IPC calls —
  wiring the modal in for real means switching each page off demo data first, which hasn't been
  done.
- **Files:** `errors/ApiError.js`, `ipc/wrap.js`; `repositories/{vendors,customers,subCustomers,
  regions,cities,stores,categories,addas,products}.repository.js`; `services/` (same list);
  `ipc/{vendors,customers,subCustomers,regions,cities,stores,categories,addas,products}.ipc.js`;
  `database_schema_v4.3.md`/`database/schema.sql` (dropped the two stray constraints, plus earlier
  in this session: dropped `customers.phone`/`sub_customers.phone`, `vendors.address`);
  `frontend/src/components/DuplicateNamePromptModal.tsx` (new, unwired).

## Milestone 4 — planning only (no code yet)

### 2026-08-19 — Found and planned: Bank Accounts, Transfer, Payroll (Employees/Wage/Salary Run)
- **What:** User pointed out the frontend sidebar has screens (Employees/Workers, Bank Accounts,
  Transfer, Wage Run, Salary Run) with no corresponding milestone module — screenshots showed the
  live UI for Bank Accounts and the Transactions sidebar section listing Wage Run/Salary Run/
  Transfer. Investigated and found these are NOT actually undefined: `database/schema.sql` already
  has complete, applied tables for all of them (`bank_accounts`, `cheques`, `transfers`,
  `employees`, `stages`, `worker_stages`, `wage_runs`/`wage_run_items`, `salary_runs`/
  `salary_run_items`), and two dedicated, thorough design docs exist —
  `System_architecture/cash_and_bank.md` (Bank Accounts, cheque routing, Transfer) and
  `System_architecture/payroll.md` (Employees, Wage Run, Salary Run) — neither of which had been
  folded into `database_schema_v4.3.md`/`use_cases.md` or referenced by any milestone file. This is
  exactly why Milestone 7's Module 7.1 ("Workers — blocked, no definition exists") was wrong: that
  check only looked in the two files that don't cover this scope.
- **How:** No code was written this pass — purely planning/documentation, per explicit user
  instruction to add these to the milestones and update the schema doc before continuing backend
  work (session was about to clear context). `backend/milestones/milestone4.md` rewritten: renamed
  from "Receipts (Jamma) & Expenses (Kharch)" to "Receipts, Expenses, Bank Accounts, Transfer,
  Payroll," keeping the original Modules 4.1/4.2 verbatim and adding four new modules — **4.3 Bank
  Accounts** (party pattern, same `createUnderChartCode` helper as Vendors/Customers, under chart
  code `120002`), **4.4 Transfer** (debit `to_ba_id`/credit `from_ba_id`, must be excluded from
  income/expense report totals), **4.5 Employees** (moved from Milestone 7 Module 7.1 — type-first
  form, Worker requires ≥1 trade, Salaried requires `monthly_salary`, `employee_type` immutable
  after creation, auto-links a BA under `220001`/`220002` depending on type), **4.6 Wage Run**
  (reads `dbo.articles`' stage-cost columns but only writes `ledger_entries`; `rate`/`packing`
  snapshotted per line; deliberately has no duplicate-settlement guard — the frontend instead shows
  the worker's last 3 runs for the chosen stage; unpost is audited via `unposted_at`/
  `unposted_by`/`amount_before`, not silent), **4.7 Salary Run** (one run per calendar month,
  every active salaried employee pre-filled and editable per-line, one credit line per employee on
  post, blocked from a second CONFIRMED run in the same month by `UQ_salary_runs_month`).
  `backend/milestones/milestone7.md`'s Module 7.1 replaced with a pointer to Milestone 4 Module
  4.5, explaining why the old "blocked" note was wrong. `System_architecture/database_schema_v4.3.md`
  got a new top-of-file note listing exactly which tables it doesn't describe and pointing at
  `cash_and_bank.md`/`payroll.md` as the actual source of truth for them, so this gap can't recur
  the same way — matches the existing "Post-v4.3 amendments" pointer-note pattern already used
  there rather than copying hundreds of lines of DDL that already live correctly elsewhere.
- **Not done / still open:** none of Modules 4.3–4.7 have any code yet — repository/service/ipc
  files for `bankAccounts`, `transfers`, `employees`, `stages`, `wageRuns`, `salaryRuns` are all
  still TODO stubs or don't exist. Reserved chart-account codes referenced by the new docs
  (`120002` BANK ACCOUNTS, `220001` WORKER WAGES, `220002` SALARIES PAYABLE, `410001` WAGES
  EXPENSE, `410002` SALARIES EXPENSE) are NOT yet in `backend/src/constants/reservedAccounts.js`
  or seeded in `backend/src/db/seeds/run.js` — check both before starting Module 4.3 or 4.5, since
  `createUnderChartCode` will 404 without them. `cash_and_bank.md` §11 also lists several *schema*
  changes beyond just adding the new tables (e.g. splitting `expenses.payment_mode` into
  `CHEQUE_ENDORSED`/`CHEQUE_ISSUED`, adding `issued_cheque_no`/`issued_cheque_date` to `expenses`,
  relaxing `CK_cheque_allocations_target`) — re-read that doc's §11 in full before building Module
  4.1's cheque-deposit-bank piece or Module 4.2, since some of those may already be applied in
  `schema.sql` and some may not be (not independently re-verified this pass — check column-by-column
  against the live `expenses`/`cheque_allocations` tables before assuming either way).
- **Files:** `backend/milestones/milestone4.md`, `backend/milestones/milestone7.md`,
  `System_architecture/database_schema_v4.3.md`

## Milestone 6 — System Setup: Product Details, Categories, Vendors (follow-up)

### 2026-08-18 — articles.batch_no: free-text → system-generated, scoped per vendor
- **What:** Per explicit client instruction ("Ali has his own batch number, Abdullah has his own"),
  `batch_no` on Product Details stopped being a free-typed field and became a system-generated
  integer with its own sequence per vendor — the same "each vendor has an independent counter"
  shape already established for `businessAccounts`' §3.2 serials, just scoped to `articles`
  instead of `business_accounts`.
- **How:** Confirmed the exact rules with the user before touching anything (global vs. per-vendor
  scope, unique + immutable vs. editable) since this was a real schema change, not just app logic.
  Schema: `articles.batch_no` `VARCHAR(50) NULL` → `INT NOT NULL`; `articles.vendor_id` promoted
  from nullable to `NOT NULL` (a batch number can't be generated without a vendor to scope it to —
  the user confirmed this consequence explicitly rather than leaving vendor optional and batch_no
  null in that case). New `UQ_articles_vendor_batch UNIQUE (vendor_id, batch_no)`.
  `products.repository.js` gained `nextBatchNo(vendorId)` (`MAX(batch_no) + 1 WHERE vendor_id =
  @vendorId`, starting at 1); `insert()` now requires both `vendor_id`/`batch_no` as `sql.Int`
  (previously `batch_no` was typed `sql.VarChar(50)`); `update()` excludes both from its `SET`
  clause entirely — immutable after creation, since changing the vendor later would orphan the
  article's batch number from the sequence it actually came from. `products.service.js:create()`
  gained `validateVendor()` (400 if missing) and a `vendorsService.getById()` call (404 if the
  vendor doesn't exist) before generating the batch number, so a bad `vendor_id` never burns a
  sequence slot on a request that was going to fail anyway.
  Schema change went through the usual path: a temporary numbered migration, applied to
  `wentox_db`, then folded directly into `database/schema.sql` and the migration file deleted — a
  fresh `schema.sql`-only import needs nothing else.
- **Debugger review caught a real bug before it shipped:** the migration's first draft backfilled
  every pre-existing row's new `batch_no` column to a flat `1`, rather than a real per-vendor
  sequence — harmless against `wentox_db` today (only one pre-existing article, from earlier test
  fixtures), but would have hard-failed the new unique constraint (or produced wrong numbers) on
  any database with more than one existing article under the same vendor. Fixed using `ROW_NUMBER()
  OVER (PARTITION BY vendor_id ORDER BY article_id)` instead, and re-verified against a seeded
  4-article, 2-vendor, 1-null-vendor scenario in a disposable scratch database — Vendor A's two
  articles correctly got `batch_no` 1 and 2, Vendor B's one article independently got 1, and the
  previously-vendorless article was backfilled to a vendor and got the next number in that vendor's
  sequence.
- **Verified:** live against `wentox_db` — missing `vendor_id` on create rejected; two products
  created under the same vendor got sequential `batch_no` values continuing from the existing
  fixture; an update attempt that tried to change `vendor_id` and other fields left `vendor_id`/
  `batch_no` completely unchanged while every other field updated normally. Also re-verified the
  from-scratch `schema.sql`-only import path against a second disposable scratch database, matching
  `wentox_db`'s column types/constraints exactly.
- **Files:** `database/schema.sql`, `backend/src/repositories/products.repository.js`,
  `backend/src/services/products.service.js`, `backend/milestones/milestone6.md`

## Milestone 8 — System Setup: City Creation & Accounts Hierarchy

### 2026-08-17 — Module 8.1 complete: regions, cities, stores, addas
- **What:** Confirmed exact scope with the user before building (same module-by-module check-in
  discipline as Milestone 7): flat CRUD for Regions/Cities/Stores, Addas with a UC-14 delete-guard
  plus a new required `region_id` column. Two doc mismatches caught and deliberately NOT followed
  before writing any code: (1) UC-11/UC-12 mention an "auto code" step for cities/regions, but the
  applied schema has no `code` column on either table — confirmed with the user this is stale
  wording, built as plain name-only (+ optional `region_id` on cities) CRUD instead; (2) a
  "reactivate an inactive duplicate-named row instead of rejecting" idea was raised mid-session,
  explicitly parked/flagged rather than built into any entity, old or new.
  - **Regions** (`regions.*`): plain CRUD. `regions.ipc.js` didn't exist at all, and `regions` was
    missing from both `src/ipc/index.js` and `electron/preload.js`'s `FEATURES` array — all three
    gaps fixed as part of this module (not a pre-existing bug elsewhere, just never wired up).
  - **Cities** (`cities.*`): CRUD, `region_id` optional per UC-11 ("optionally attach it to a
    region"), list/get join region name for display.
  - **Stores** (`stores.*`): plain CRUD.
  - **Addas** (`addas.*`): CRUD plus UC-14's delete-guard — `remove()` checks `isReferenced()`
    (`sale_bills`, `sale_returns`, `draft_sale_bills`, `draft_sale_returns`, all by `adda_id`)
    before soft-deleting; if referenced, throws `409 ADDA_IN_USE` and makes no change at all,
    rather than silently soft-deleting. Also gained a new required `region_id` (see schema change
    below) — `list()` supports an optional `region_id` filter for a future region-scoped adda
    dropdown, mirroring `sub_customers`.
  - **Schema change:** `addas.region_id INT NOT NULL` added, FK'd to `regions`, per explicit
    client instruction — same rationale/pattern as `sub_customers.region_id` from the prior
    session. One pre-existing "Test Adda" fixture row (created during earlier Sale Bill/Return
    verification) had a `NULL` city and no region at all — backfilled to a real region via the
    migration before the `NOT NULL` constraint was applied, so the `ALTER COLUMN` wouldn't fail
    against existing data. Folded directly into `database/schema.sql` afterward (temporary
    migration file applied, verified live, then deleted), same pattern as every prior schema
    change this project. `use_cases.md` UC-14 and `database_schema_v4.3.md` updated to match.
- **Verified:** debugger-subagent review (column names against schema.sql, `isReferenced()`'s four
  table/column checks, guard-before-soft-delete ordering, correct optional-vs-required `region_id`
  split between Cities/Addas, duplicate-name-excludes-own-row pattern, no hard deletes, IPC action
  casing, migration step ordering against existing data, `regions` actually wired into both
  registration points) came back clean. Then live against `wentox_db`: Regions/Cities/Stores CRUD
  with duplicate rejection and soft-delete; Addas — missing `region_id` rejected, create/update,
  an unreferenced adda soft-deletes successfully, and the pre-existing genuinely-referenced
  "Test Adda" row (used by real sale bills/returns from earlier verification runs) correctly
  blocked deletion with `ADDA_IN_USE`. Also re-verified the from-scratch `schema.sql`-only import
  path against a disposable scratch database — `addas.region_id` `NOT NULL`, matching `wentox_db`
  exactly.
- **Files:** `backend/src/{repositories,services,ipc}/regions.*` (new `ipc` file),
  `backend/src/{repositories,services,ipc}/cities.*`,
  `backend/src/{repositories,services,ipc}/stores.*`,
  `backend/src/{repositories,services,ipc}/addas.*`, `backend/src/ipc/index.js`,
  `backend/electron/preload.js`, `database/schema.sql`,
  `System_architecture/database_schema_v4.3.md`, `System_architecture/use_cases.md`,
  `backend/milestones/milestone8.md`

## Milestone 7 — System Setup: Workers, Customers, Sub-Customers

### 2026-08-16 — Added region_id/city_id to sub_customers (schema change, per client instruction)
- **What:** Sale Bill/Sale Return's "deliver to" sub-customer dropdown needs to narrow to the
  selected customer's region — sub_customers previously had no region/city at all. Confirmed the
  exact requirements with the user first (region_id required, city_id optional/informational;
  filter matches region only, not city) before touching schema or code.
- **How:** `region_id INT NOT NULL` + `city_id INT NULL` (both FK'd to `regions`/`cities`) added to
  `dbo.sub_customers`, folded directly into `database/schema.sql` (table was empty in `wentox_db`,
  so the `NOT NULL` add needed no backfill — applied via a temporary migration first, verified
  live, then folded in and the migration deleted, same pattern as every other schema change this
  project). `subCustomers.repository.js`'s `list()` gained a `region_id` filter (unfiltered still
  returns everyone — this is opt-in narrowing, not a hard restriction), `findById()`/`list()` now
  join `regions` (INNER, required) and `cities` (LEFT, optional) for display names, `insert()`/
  `update()` carry the new columns through. `subCustomers.service.js`'s `validate()` now requires
  `region_id`. Also corrected two docs that were now stale: `use_cases.md`'s UC-10, which
  explicitly said the dropdown lists "every sub-customer... not a filtered subset" (struck
  through, replaced with the new region-match behavior), and `database_schema_v4.3.md`'s
  `sub_customers` CREATE TABLE block + a new "Post-v4.3 amendment" note.
- **Verified:** live against `wentox_db` — missing `region_id` rejected; created two sub-customers
  in different regions; `list({ region_id: lahoreId })` correctly included the matching one and
  excluded the other; unfiltered `list()` still returned both. Also re-verified the from-scratch
  `schema.sql`-only import path against a disposable scratch database (`sub_customers.region_id`
  `NOT NULL`, `city_id` nullable, matching the live database exactly).
- **Files:** `database/schema.sql`, `System_architecture/database_schema_v4.3.md`,
  `System_architecture/use_cases.md`, `backend/src/repositories/subCustomers.repository.js`,
  `backend/src/services/subCustomers.service.js`, `backend/milestones/milestone7.md`

### 2026-08-15 — Modules 7.2 & 7.3 complete: customers, subCustomers
- **What:** Built module-by-module with a functionality check-in before each, per explicit
  direction this session (confirm scope/approach first, then implement — not the whole milestone
  in one pass).
  - **Customers** (`customers.*`, Module 7.2, UC-09): confirmed as an exact mirror of Module 6.3's
    Vendors before building — same CRUD shape, same auto-linked-`business_accounts`-on-create
    pattern (reusing `businessAccountsService.createUnderChartCode` under CUSTOMERS ACCOUNTS this
    time), same rename-syncs-the-account behavior, same transaction-safe `create()` from the
    start (no repeat of the Vendors orphan-row bug — a debugger review confirmed this). One real
    schema difference correctly handled: `region_id` is required (`NOT NULL` on `dbo.customers`,
    unlike vendors' nullable `region_id`), validated accordingly. Debugger review flagged one
    low-risk informational note: `customers.name` has no DB-level `UNIQUE` constraint (unlike
    `vendors.name`'s `UQ_vendors_name`) — duplicate protection is service-layer-only, accepted as
    low risk in this single-admin-session desktop app, not schema-patched.
  - **Sub-Customers** (`subCustomers.*`, Module 7.3, UC-10): milestone7.md's checklist said
    sub-customers "must belong to a customer" — checked this against the actual schema (no
    `customer_id` column on `dbo.sub_customers`) and UC-10's explicit text ("Sub-customers are
    independent. They have no parent customer... the parent-customer link still exists and must
    be *removed*") and confirmed with the user that the milestone doc's line was stale before
    building. Built as a flat CRUD instead: `name`/`phone`/`address`/`is_active` only, no
    region/city, no linked business account. The Sale Bill inline "+ Add Sub-Customer" flow uses
    the same `sub-customers:create` channel as the standalone screen (no parent to scope under, so
    no separate customer-scoped channel needed, correcting milestone7.md's other stale line).
- **How:** Both modules follow the same list/get/create/update/remove IPC shape as every other
  Milestone 6/7 module. `milestone7.md` updated in place to strike the two stale lines with a
  note explaining what was actually built and why.
- **Verified:** debugger-subagent review on each module separately (Customers: confirmed
  transaction safety, correct `region_id` requirement, correct `CODES.CUSTOMERS_ACCOUNTS` usage,
  correct JOIN directions; Sub-Customers: confirmed no parent-link anywhere, correct IPC channel
  casing) — both clean. Then live against `wentox_db` for each before moving to the next: Customers
  (missing region rejected → create with linked account `100001XXXX` → duplicate rejected → update
  renames both → soft-delete, account stays `ACTIVE`); Sub-Customers (create → duplicate rejected →
  update → list/soft-delete).
- **Files:** `backend/src/{repositories,services,ipc}/customers.*`,
  `backend/src/{repositories,services,ipc}/subCustomers.*`, `backend/milestones/milestone7.md`

## Milestone 6 — System Setup: Product Details, Categories, Vendors

### 2026-08-14 — Modules 6.1, 6.2, 6.3 complete: products, categories, vendors
- **What:** Pulled forward ahead of Milestone 4 (see status line above) so Sale Bill/Return/
  Purchase/Return have real dropdown data to test against instead of hardcoded fixture IDs. Built
  module-by-module, checking in and live-verifying after each before moving to the next, per
  explicit direction partway through this session.
  - **Categories** (`categories.*`): plain CRUD, duplicate-name rejected, soft delete via `is_active`.
  - **Products** (`products.*`, queries `dbo.articles` — see milestone6.md's naming note):
    CRUD with the full 12-column manufacturing cost breakdown; `code` (e.g. `P-101`) is
    system-generated on create, never typed — `nextCode()` takes
    `MAX(TRY_CAST(SUBSTRING(code,3,30) AS INT))` over `code LIKE 'P-%'` and adds 1, starting at 101.
    `create()`/`update()` validate `category_id` exists via `categoriesService.getById` first, for a
    clean 404 instead of a raw FK-violation.
  - **Product Colors** (`productColors.*`, queries `dbo.article_colors`): per UC-07, colors are
    *not* created from the Product Details form — `resolveOrCreate(article_id, color, packing)` is
    what the Current Stock "Add" dialog (UC-28, Milestone 5) will call later; case-insensitive
    dedup on `(article_id, color)`, backed by `UQ_article_colors_acolor`.
  - **Vendors** (`vendors.*`): full CRUD; `create()` auto-creates a linked `business_accounts` row
    under the reserved VENDORS ACCOUNTS chart account (§3.2 composition: parent 6-digit chart code
    + 4-digit zero-padded serial, `serial = MAX(existing under that parent) + 1`) and links it via
    `vendors.ba_id` — the user never sees a separate account-setup step (UC-08). Renaming a vendor
    renames the linked account too.
  - New reusable helper: `businessAccountsService.createUnderChartCode(transaction, chartCode,
    name, extra)` — the §3.2 code-generation logic pulled out so Customers/Sub-Customers
    (Milestone 7) can call the identical pattern under CUSTOMERS ACCOUNTS instead of
    reimplementing it.
- **How:** A debugger-subagent review of the Vendors module caught a real bug before it shipped:
  the first version created the `business_accounts` row and the `vendors` row as two separate,
  non-transactional `query()` calls — if the vendor insert failed after the account insert
  succeeded, the account row would be permanently orphaned (a ledger account with no vendor
  pointing at it, visible in Chart of Accounts listings with no way to clean it up from the UI).
  Fixed by threading a `transaction` parameter through `businessAccounts.repository.js`
  (`nextSerial`, `insert`) and `vendors.repository.js` (`insert`), and wrapping both calls in one
  `withTransaction` block in `vendors.service.js:create()` — same pattern every other multi-write
  service in this codebase already follows.
  Also fixed, while auditing for the same bug class: `auth.ipc.js`'s `auth:update-credentials`/
  `auth:verify-password` channels were kebab-case on the action segment, but
  `electron/preload.js`'s `window.api` Proxy only kebab-cases the *feature* prefix, not the action
  — it passes the JS property access straight through unmodified. A future
  `window.api.auth.verifyPassword(...)` call would have silently mismatched. Renamed to
  `auth:updateCredentials`/`auth:verifyPassword`. New `productColors.ipc.js` channels
  (`listByArticle`, `resolveOrCreate`) were written camelCase from the start to avoid the same trap.
- **Verified:** debugger-subagent review on both the Products/Categories/ProductColors batch and
  the Vendors batch (separately) came back clean after the transaction fix; then live against
  `wentox_db` for each module before moving to the next: category → product (auto-code, rejects
  unknown category) → second product (incremented code) → update → two color variants (including
  a different-case duplicate resolving to the same variant) → soft-delete variant → soft-delete
  product; vendor create (linked business account `200001XXXX`) → duplicate name rejected → update
  (renames both) → list/soft-delete (linked account stays `ACTIVE`) → structural check confirming
  no orphaned `business_accounts` row.
- **Files:** `backend/src/{repositories,services,ipc}/categories.*`,
  `backend/src/{repositories,services,ipc}/products.*`,
  `backend/src/{repositories,services,ipc}/productColors.*` (new `ipc` file),
  `backend/src/{repositories,services,ipc}/vendors.*`,
  `backend/src/{repositories,services}/businessAccounts.*`, `backend/src/ipc/index.js`,
  `backend/src/ipc/auth.ipc.js`, `backend/electron/preload.js`,
  `backend/milestones/milestone6.md`

## Milestone 3 — Purchase & Purchase Return

### 2026-08-13 — Modules 3.1 & 3.2 complete: purchases, purchaseReturns, both draft mirrors
- **What:** Full Purchase (UC-23) and Purchase Return (UC-24) backend, same shape as Sale
  Bill/Return but with real differences settled via a short round of clarifying questions before
  building: (1) no password guard anywhere — there's no edit-a-posted-purchase UI flow, so
  `update()` just blocks entirely once posted (`POSTED_LOCK`), never reverses+reapplies ledger;
  (2) `draft_purchases`/`draft_purchase_returns` are their own tables (not a status value), per
  client instruction; (3) unlike `draft_sale_bills`, saving/deleting a draft purchase has **zero**
  effect on `vendor_stock_movements` — nothing physically arrives before a purchase is recorded.
  New: `materials.repository.js` (`resolveOrCreate` — case-insensitive material lookup-or-register,
  transactional), `purchaseMath.js` (shared line/total math, no packing/discount concept — just
  `quantity × price_per_unit`), `purchases`/`purchaseReturns`/`draftPurchases`/
  `draftPurchaseReturns` (ipc/service/repository each), `vendors.service.js`/
  `vendors.repository.js` gained the same minimal `getById`/`findById` pattern
  `customers.service.js` already has (full CRUD still deferred to Milestone 7).
- **How:** Posting (schema §7): Purchase → debit PURCHASES chart account / credit vendor BA,
  positive `PURCHASE` vendor_stock_movements row per line. Purchase Return → reverse — debit
  vendor BA / credit PURCHASES, negative `PURCHASE_RETURN` row (return items are stored positive
  per `CK_purchase_return_items_qty`, negated only when building the vendor-stock movement).
  Purchases never touch `stock_movements` (finished-goods/pairs) — only `vendor_stock_movements`
  (material units), per UC-23's explicit note. Schema changes (drop `status` from both tables, add
  the four draft tables) went through the usual path: a temporary numbered migration, applied and
  verified live, then folded directly into `database/schema.sql` and the migration file deleted —
  a fresh `schema.sql`-only import needs nothing else (verified against a disposable scratch
  database, `wentox_db` unaffected/no-op on re-migrate).
- **Verified:** `debugger`-pattern subagent review (posting signs, transaction scoping — material
  resolution happens inside the same transaction as the line it belongs to, not a separate
  connection — export/usage consistency, draft-confirm asymmetry vs. Sale Bill) came back clean.
  Then live against `wentox_db`: create with a brand-new material name → auto-registered in
  `dbo.materials`; a second purchase using a different-case spelling of the same name resolved to
  the identical `material_id` (case-insensitive collation); post → correct ledger direction +
  positive vendor-stock row; double-post rejected; update-while-posted rejected
  (`POSTED_LOCK`, not a reverse+reapply); unpost removes the rows; Purchase Return posted the exact
  reverse (debit vendor BA / credit PURCHASES, negative vendor-stock row); draft create/delete
  confirmed zero net vendor-stock movement; draft confirm (both Purchase and Purchase Return)
  posted exactly once and deleted the draft row.
- **Files:** `backend/src/repositories/materials.repository.js`,
  `backend/src/services/purchaseMath.js`,
  `backend/src/repositories/vendors.repository.js`, `backend/src/services/vendors.service.js`,
  `backend/src/{ipc,services,repositories}/{purchases,draftPurchases,purchaseReturns,draftPurchaseReturns}.*`,
  `backend/src/ipc/index.js`, `backend/electron/preload.js`, `database/schema.sql`,
  `System_architecture/database_schema_v4.3.md`, `backend/milestones/milestone3.md`

## Milestone 2 — Sale Bill & Sale Return

### 2026-08-07 — Folded the status-drop/due_date migrations directly into database/schema.sql
- **What:** Per explicit client instruction ("only run schema.sql on import"), consolidated the two
  migrations from the entry below (`001_sale_bills_due_date.sql`, `002_drop_sale_status.sql`)
  directly into `database/schema.sql`'s `sale_bills`/`sale_returns` `CREATE TABLE` blocks, then
  deleted both migration files and the now-empty `src/db/migrations/` directory. This is a
  deliberate one-time exception to the project's usual "never edit an applied schema file" rule
  (see `backend/CLAUDE.md`) — done only because consolidating is exactly what was asked for.
- **How:** `sale_bills` now declares `due_date DATE NULL` directly (no `status` column);
  `sale_returns` declares neither. Also updated the `alert_dismissals` block comment, which used to
  say `due_date` "was removed from sale_bills/purchases" — now notes it's back on `sale_bills` (not
  `purchases`) for the pending notification feature, though the alert itself isn't wired up yet.
  `database_schema_v4.3.md`'s CREATE TABLE blocks for both tables were updated to match (the doc's
  blocks are meant to mirror the actual applied schema), and its top-of-file amendments note was
  reworded from "applied via migrations" to "folded directly into schema.sql."
  For the already-migrated `wentox_db`, this is a no-op — `migrate.js` tracks applied files by
  basename in `schema_migrations`, so it never re-runs `schema.sql`, and the two migration files it
  already ran are simply gone from disk now (their effect is already permanently in that database).
- **Verified:** created a disposable scratch database (`wentox_schema_scratch_test`) on the same SQL
  Server instance, applied `schema.sql` alone (no migrations directory, none exist anymore),
  confirmed `sale_bills` has `due_date` and no `status`, confirmed `sale_returns` has no `status`,
  then dropped the scratch database — `wentox_db` was never touched by this verification.
- **Files:** `database/schema.sql`, `System_architecture/database_schema_v4.3.md`; removed
  `backend/src/db/migrations/001_sale_bills_due_date.sql`,
  `backend/src/db/migrations/002_drop_sale_status.sql`, and the (now-empty) `migrations/` dir.

### 2026-08-07 — Dropped `status` from sale_bills/sale_returns; re-added `sale_bills.due_date`
- **What:** Two schema amendments beyond the applied `database/schema.sql` (both via new files
  under `src/db/migrations/`, per the project's "never edit an applied schema file" rule):
  1. `001_sale_bills_due_date.sql` — `ALTER TABLE sale_bills ADD due_date DATE NULL`. Reverses
     v4.3's deliberate removal of this column, per explicit client instruction, ahead of a planned
     payment-overdue notification feature (details pending). Wired through
     `saleBills.repository.js` (`insert`, `updateHeader`) and `saleBills.service.js`
     (`buildBillFields`). Not added to `sale_returns` (schema note: "a return is not a payable").
  2. `002_drop_sale_status.sql` — drops `status` (+ its `DF_*`/`CK_*` constraints) from both
     `sale_bills` and `sale_returns`, per client confirmation that the column never actually
     changed value given the frontend's real button set: Confirm creates+posts atomically, and
     editing an already-posted document reverses+reapplies its ledger inside `update()` itself
     (from an earlier session), so a real row is never left visibly "unposted" in between.
- **How:** Both repositories gained `isPosted(id)` — `SELECT CASE WHEN EXISTS (... ledger_entries
  WHERE source_type=... AND source_id=@id) THEN 1 ELSE 0 END` — and `findById` now attaches the
  result as `is_posted` on every returned row. `create()` no longer sets any status field.
  `update()`/`post()`/`unpost()` in both services branch on `existing.is_posted` /`bill.is_posted`
  instead of a stored string; `setStatus` removed from both repositories entirely.
  `draftSaleBills.service.js`/`draftSaleReturns.service.js`'s `confirm()` no longer builds a
  `status: 'CONFIRMED'` field when assembling the row to insert (posting happens right after via
  `postLedgerAndStock`, which is what makes it "posted" now). The two ipc handlers
  (`sale-bills:update`, `sale-returns:update`) that gate the password check on "is this document
  currently posted" now read `existing.is_posted` instead of `existing.status === 'CONFIRMED'`.
  `database_schema_v4.3.md` got a "Post-v4.3 live amendments" note up top rather than rewritten
  CREATE TABLE blocks, since the doc's blocks are meant to match the *original* applied
  `schema.sql`, not the migrations layered on top.
- **Verified:** live against `wentox_db` — confirmed zero `status` columns remain on either table;
  full bill lifecycle (create → `is_posted=false` → post → `is_posted=true` → double-post rejected
  → edit-while-posted, ledger/stock correctly reversed+reapplied at new totals → unpost →
  `is_posted=false` → double-unpost rejected); same lifecycle on sale return; draft-return
  `confirm()` still produces a correctly-posted return with no `status` field involved anywhere.
- **Files:** `backend/src/db/migrations/001_sale_bills_due_date.sql`,
  `backend/src/db/migrations/002_drop_sale_status.sql`,
  `backend/src/repositories/{saleBills,saleReturns}.repository.js`,
  `backend/src/services/{saleBills,saleReturns,draftSaleBills,draftSaleReturns}.service.js`,
  `backend/src/ipc/{saleBills,saleReturns}.ipc.js`,
  `System_architecture/database_schema_v4.3.md`

### 2026-07-31 — Module 2.1 complete: sale-bills:list/get/update/post/unpost
- **What:** Finished every remaining `milestone2.md` Module 2.1 checkbox. `saleBills.repository.js`
  gained `deleteItems`, `updateHeader`, `setStatus`, `deleteLedgerAndStock`, `list(filters)`.
  `saleBills.service.js` gained `list` (with a `resolveDateRange` helper — `weekly`/`monthly`/
  `overall` convenience on top of explicit `date_from`/`date_to`, explicit always wins), `update`
  (blocked unless `status = 'DRAFT'`, i.e. unposted — reuses the exact same totals math as `create`
  via two new extracted helpers, `resolveLinesAndTotals`/`buildBillFields`, so the two don't drift),
  `post` (reuses the existing `postLedgerAndStock` built earlier for `draftSaleBills.confirm`, then
  sets `status = 'CONFIRMED'`; blocked if already posted), `unpost` (deletes the bill's
  `ledger_entries`/`stock_movements` rows and sets `status = 'DRAFT'`; blocked if not posted).
  `saleBills.ipc.js` wired `sale-bills:list/get/update/post/unpost`.
- **How:** Verified the full lifecycle with a stubbed-dependency `node -e` test: create → update
  while DRAFT (succeeds, totals recompute) → post (ledger + stock rows written, status flips) →
  update while CONFIRMED (blocked) → double-post (blocked) → unpost (ledger/stock rows removed,
  status flips back) → double-unpost (blocked) → list with a weekly range (correct date window). A
  separate subagent debug review (briefed from `.claude/agents/debugger.md`) checked the parts that
  test wouldn't catch — `deleteLedgerAndStock`'s WHERE clause can't touch a different bill's rows or
  a `SALE_RETURN`'s rows, `updateHeader` updates every column `insert` sets except `status`/
  `created_by` (correctly immutable outside `setStatus`), no invalid status string is ever written,
  and every multi-write path is inside one `withTransaction` call. No bugs found.
- **Files:** `backend/src/repositories/saleBills.repository.js`, `backend/src/services/saleBills.service.js`,
  `backend/src/ipc/saleBills.ipc.js`
- **Module 2.1 is now fully complete.** Next: Module 2.2 (Sale Return) — same shape, mirrored
  direction. No live SQL Server yet — everything here is logic-verified, not DB-verified.

### 2026-07-30 — Module 2.1 (partial): sale-bills:create + debug pass
- **What:** Implemented the first `milestone2.md` checklist item: `saleBills.repository.js`
  (`getVariantPackings`, `insert`, `insertItems`, `findById`), `saleBills.service.js` (`create` —
  validation, server-computed pairs/discounts/totals, one `withTransaction`), `saleBills.ipc.js`
  (`sale-bills:create` behind `requireSession()`).
- **How:** A separate subagent review (briefed from `.claude/agents/debugger.md`, not done inline)
  found and I fixed 4 real bugs: (1) **critical** — the repository joined against `dbo.products`/
  `product_id`, which doesn't exist; `database/schema.sql` (the real, authoritative schema — more
  current than `System_architecture/database_schema_v4.3.md`, which still describes the old
  `products` shape) actually has `dbo.articles`/`article_id`, with a completely different cost
  breakdown (12 real manufacturing-stage columns + `sale_price`, not `cost_price`/`labour`/etc.) —
  every `sale-bills:create` call would have failed at the first query; (2) `discount_percent`
  defaulted to `0` one line too late in `buildLine`, so omitting it produced `NaN` through the whole
  totals chain; (3) missing validation for the schema's `CK_sale_bills_custdlv` (sub_customer_id
  required unless `delivery_type = 'SAME'`); (4) missing validation that `cartons > 0` per line
  (schema's `CK_sale_bill_items_pairs` requires `pairs > 0`, and `pairs = cartons × packing`).
  Verified all 4 fixes with stubbed-dependency `node -e` tests (module-cache injection to avoid
  needing `mssql`/a live DB) — confirmed correct totals math and that all three validation cases now
  throw before reaching the transaction.
- **Files:** `backend/src/repositories/saleBills.repository.js`, `backend/src/services/saleBills.service.js`,
  `backend/src/ipc/saleBills.ipc.js`, `backend/electron/preload.js` (kebab-case channel name fix —
  `window.api.saleBills.list()` now correctly calls `sale-bills:list`, not `saleBills:list`)
- **Resolved:** `products` vs `articles` naming — decided to keep the feature/screen name
  `products` (matches the frontend sidebar and `use_cases.md`), with its SQL querying the real
  `dbo.articles` table underneath, same pattern as `saleBills.repository.js`. No renaming needed;
  noted in `milestone6.md`'s Module 6.1.
- **Pending:** `sale-bills:list`, `sale-bills:get`, update, post/unpost, and Module 2.2 (Sale
  Return) are not started. No live SQL Server yet — everything here is logic-verified, not
  DB-verified.

### 2026-07-30 — Module 2.1: draftSaleBills (create/list/get/remove/confirm) + shared posting logic
- **What:** Implemented the second `milestone2.md` checklist item (schema §5.6.1). New:
  `draftSaleBills.repository.js` (own `getVariantPackings`/`insertStockMovements` copies, plus
  `insertDraft`/`insertDraftItems`/`findById`/`list`/`deleteDraft`), `draftSaleBills.service.js`
  (`create` — deducts stock via a negative `ADJUSTMENT` movement on save; `remove` — restores via a
  positive one, never deleting the original per the schema's reverse-never-erase pattern; `confirm`
  — per the user's actual workflow (draft now, finish and confirm later that same session), this
  behaves as **create + post in one step**, not a separate later post), `draftSaleBills.ipc.js`
  (`draft-sale-bills:create/list/get/remove/confirm`). Extracted shared pairs/discount/totals math
  and item/header validation out of `saleBills.service.js` into a new `saleBillMath.js` (both
  features need the identical formula). Added minimal `chartAccounts.repository.js` (`findByCode`)
  and `customers.repository.js`/`service.js` (`findById`/`getById`) — just enough for posting to
  resolve the `SALES` account and a customer's `ba_id`, full CRUD for both is Milestone 7/8. Added
  `src/constants/reservedAccounts.js` (shared codes between `seeds/run.js` and posting logic).
  `saleBills.service.js` gained `postLedgerAndStock`/`insertConfirmed`/`getById` exports so
  `draftSaleBills.confirm()` reuses the exact same posting path a normal bill uses.
- **How:** Confirming a draft first inserts a *positive* reversing `ADJUSTMENT` stock movement
  (canceling the draft's original deduction), then inserts the real `sale_bills` row with
  `status = 'CONFIRMED'` directly, then runs the normal post (ledger entries + negative `SALE`
  stock movement), then deletes the draft — net stock effect over the full lifecycle is exactly one
  deduction, same as a bill that was never a draft. Verified this arithmetic directly with stubbed
  `node -e` tests tracing every stock-movement row's sign and source. A separate subagent debug
  review (briefed from `.claude/agents/debugger.md`) found one real bug: `confirm()` checked
  `bill_no`/`gp_no`/`bilty_no`/`adda_id` but not the schema's `CK_sale_bills_custdlv` rule
  (`sub_customer_id` required unless `delivery_type = 'SAME'`) — `draft_sale_bills` has no such
  constraint so a draft could reach `confirm()` in a state the real `sale_bills` table would reject,
  surfacing as an opaque `INTERNAL` error. Fixed by extracting `validateDeliveryCustomer()` into
  `saleBillMath.js` and calling it from both `saleBills.service.js` and `draftSaleBills.confirm()`.
  A second, lower-severity finding (inconsistent `Error` vs `ApiError` for the "SALES account
  missing" case) was deliberately left as-is: that case is a setup/seed problem, not a normal-user
  error, and `wrap.js` only `console.error`s non-`ApiError` throws — converting it would have
  silenced a real misconfiguration instead of surfacing it. Verified the fix with three cases
  (`SAME` delivery, `CUSTOM` with no sub-customer, `CUSTOM` with one) — all behave correctly.
- **Files:** `backend/src/repositories/draftSaleBills.repository.js`,
  `backend/src/services/draftSaleBills.service.js`, `backend/src/ipc/draftSaleBills.ipc.js`,
  `backend/src/services/saleBillMath.js` (new), `backend/src/services/saleBills.service.js`,
  `backend/src/repositories/saleBills.repository.js`, `backend/src/repositories/chartAccounts.repository.js` (new),
  `backend/src/repositories/customers.repository.js`, `backend/src/services/customers.service.js`,
  `backend/src/constants/reservedAccounts.js` (new), `backend/src/db/seeds/run.js`,
  `backend/src/ipc/index.js`, `backend/electron/preload.js`

### 2026-07-30 — Second debug pass on wrap.js: unexpected errors weren't actually sanitized
- **What:** A follow-up review (run as a genuinely separate subagent this time, briefed with
  `.claude/agents/debugger.md`, not done inline) found that the previous `wrap.js` fix only *logged*
  non-`ApiError` failures — it didn't actually replace their `message`/`code` before returning. A
  raw `mssql`/Tedious driver error (e.g. connection failure) would still leak its real `.code`
  (`ESOCKET`, `ETIMEOUT`, `ELOGIN`, ...) and message (which can contain host/port/driver internals)
  straight to the renderer, contradicting the documented "sanitized to `INTERNAL`" contract.
- **How:** Restructured the `catch` block to branch explicitly: `ApiError` → pass through its real
  `message`/`code`; anything else → `console.error` the full error, then always return the fixed
  `{ message: 'Internal error', code: 'INTERNAL' }` pair, no fallback to `err.message`/`err.code`.
  Verified with a `node -e` harness simulating a real driver error shape (`ESOCKET` + a message
  containing an IP and port): confirmed it now returns the sanitized shape while still logging the
  real error to console.
- **Files:** `backend/src/ipc/wrap.js`
- **Also this session:** updated `.claude/settings.json` to add a `PostToolUse` hook (fires the
  debugger review after every `Write`/`Edit`, not just once at `Stop`) matching the pattern from
  another project, and pointed both hooks at reading `.claude/agents/debugger.md` fresh each run
  instead of a hardcoded paraphrase of it.

### 2026-07-30 — Debug pass on Module 1.3: wrap.js error-serialization bug
- **What:** Debugger-persona review (`.claude/agents/debugger.md`, run inline since the Stop hook's
  `agent`-type mechanism means acting as that persona directly on the diff, not invoking a separate
  subagent) of the Module 1.3 auth code found two real bugs, both in `src/ipc/wrap.js`, not in the
  auth logic itself: (1) `wrap.js` was throwing a `new Error()` with `.code` attached back across
  `ipcMain.handle` — but Electron only preserves a thrown error's `.message` crossing into the
  renderer's rejected promise, silently dropping custom properties, so every `ApiError`'s `.code`
  (`UNAUTHORIZED`, `USERNAME_TAKEN`, etc.) was being lost in transit, contradicting the documented
  `{ message, code }` contract. (2) unexpected non-`ApiError` failures (real bugs, not business
  errors) were sanitized to `code: 'INTERNAL'` with no logging anywhere, making them undebuggable.
- **How:** Rewrote `wrap.js` to **resolve always** instead of throwing — `{ ok: true, data }` on
  success, `{ ok: false, error: { message, code } }` on failure — which sidesteps Electron's
  property-stripping entirely rather than working around it, and added `console.error(err)` for any
  caught error that isn't an `ApiError` instance. Verified both paths directly (a plain `node -e`
  harness calling `wrap()` with a success case, a thrown `ApiError.unauthorized`, and a thrown
  `TypeError`): the `ApiError` case now correctly surfaces `code: 'UNAUTHORIZED'`, and the
  `TypeError` case printed to console before resolving as `code: 'INTERNAL'`.
- **Files:** `backend/src/ipc/wrap.js`, `backend/CLAUDE.md`, `backend/plan.md`,
  `backend/src/ipc/README.md`, `backend/src/errors/README.md`
- **Note for Milestone 9:** `frontend/src/lib/api.ts` must check `.ok` on every `window.api.x.y()`
  call — it never rejects/throws anymore, it always resolves.

### 2026-07-30 — Transport switch: Express/HTTP → Electron IPC
- **What:** Client wants a real desktop app, not something reachable like a local website, so the
  renderer↔backend transport changed from Express REST-over-localhost to Electron IPC — no HTTP
  server, no port, no JWT/bearer token. Removed `src/app.js`, `src/server.js`, `src/routes/`,
  `src/controllers/`, `src/middleware/{auth,errorHandler}.js`, and the dead `controlAccounts`
  feature (already gone from schema v4.3). Added `src/ipc/` (one `<feature>.ipc.js` per feature,
  replacing `routes.js`+`controller.js`; `index.js` central registrar; `session.js` — in-memory
  `{ userId, username, role }`, `requireSession()`/`requireRole()`; `wrap.js` — normalizes thrown
  `ApiError`s into a plain `{ message, code }`). `electron/main.js` now registers IPC handlers
  before opening the window; `electron/preload.js` exposes `window.api.<feature>.<action>(payload)`
  via a generic `Proxy`-based `contextBridge`, not just an API base URL. `package.json` dropped
  `express`/`cors`/`jsonwebtoken`; `config/index.js` dropped `port`/`jwtSecret`/`jwtExpiry` (DB
  connection only); `.env`/`.env.example` trimmed to just the `DB_*` vars.
- **How:** Renderer and backend logic share one OS process tree in this architecture, so there's no
  network boundary to protect with a token — "logged in" is just state held in `session.js`, same
  idea as the old JWT middleware but without a token to verify. `ipc/<feature>.ipc.js` collapses
  `routes`+`controllers` into one file since there's no URL routing or req/res object to separate.
  Milestone docs (`milestone1.md`, `milestone5–9.md`, `README.md`) converted from HTTP-shorthand
  endpoints (`GET /api/x`) to IPC channel names (`x:list`) via a documented mechanical mapping, so
  existing task detail didn't need a line-by-line rewrite.
- **Files:** `backend/package.json`, `backend/electron/{main.js,preload.js,README.md}`,
  `backend/src/ipc/**`, `backend/src/config/{index.js,README.md}`, `backend/src/middleware/{validate.js,README.md}`,
  `backend/src/{README.md,errors/README.md,services/README.md,repositories/README.md}`,
  `backend/.env`, `backend/.env.example`, `backend/CLAUDE.md`, `backend/plan.md`,
  `backend/milestones/{milestone1,milestone5,milestone7,milestone8,milestone9,README}.md`
- **Pending:** Module 1.3 (Auth) itself is still TODO stubs — `auth:login`/`logout`/`update-credentials`
  not yet implemented.

## Milestone 1 — Foundation & Auth

### 2026-07-30 — Module 1.3: Auth over IPC (login/logout/update-credentials)
- **What:** Implemented `auth.repository.js` (`findByUsername`, `findById`, `usernameTaken`,
  `updateCredentials`), `auth.service.js` (`login` — bcrypt compare, returns `{user_id, username,
  role}`; `updateCredentials` — verifies `currentPassword`, allows changing username and/or
  password together, checks the new username isn't taken via `UQ_users_name` before writing, hashes
  a new password with bcrypt if provided), and `auth.ipc.js` (`auth:login` calls the service then
  `session.login(user)`; `auth:logout` calls `session.logout()`; `auth:update-credentials` calls
  `session.requireSession()` first, then the service).
- **How:** Kept `auth.service.js` free of any IPC/session import — it just verifies credentials and
  returns data, so it stays testable without Electron; `session.login()`/`session.requireSession()`
  are only ever called from the `ipc` layer, matching the layering rule in `CLAUDE.md`.
- **Files:** `backend/src/repositories/auth.repository.js`, `backend/src/services/auth.service.js`,
  `backend/src/ipc/auth.ipc.js`, `backend/milestones/milestone1.md`
- **Pending:** end-to-end verification blocked on `npm install` (package.json's `mssql` swap isn't
  installed yet) and a live SQL Server instance to seed against.

### 2026-07-11 — Backend scaffolding & planning docs
- **What:** Rewrote `System_architecture/database_schema.md` (v3: 21 relations, enums, ledger +
  stock-movement design, full DDL). Created milestones 1–5, CLAUDE.md, this file, layered-modular
  folder structure with minimal boilerplate (Express skeleton, pg pool, config, migration runner
  placeholders), and `.claude/settings.json` wiring the pre-edit-approval and debugger hooks.
- **How:** Schema gaps (users, expenses, stock, ledger) closed per use cases UC-01…UC-20; posting
  semantics documented in the schema doc's Design Decisions.
- **Files:** `System_architecture/database_schema.md`, `backend/*`

### 2026-07-11 — Layer stubs in every module + errors folder
- **What:** Added `routes.js / controller.js / service.js / repository.js` stubs to all 16 modules;
  split `accounts` into `groups / controls / chart / business` submodules with an aggregating
  `accounts/routes.js`; added `src/errors/ApiError.js` (used by services + errorHandler).
- **How:** Each stub encodes its layer's rule (controllers: no SQL/logic; repositories: parameterized
  SQL only; services: ApiError + withTransaction). All files pass `node --check`.
- **Files:** `backend/src/{routes,controllers,services,repositories}/**`, `backend/src/errors/ApiError.js`

### 2026-07-11 — Schema v3.1 for updated use cases (UC-08 production, UC-21 addas)
- **What:** Use cases v2.1 changed UC-08 to "Manage Stock & Production Logs" and added UC-21
  (Transport Addas with delete protection). Schema updated: `PRODUCTION` added to
  `stock_movement_type`; `stock_movements` gained `input_qty`, `input_unit` (CARTONS/PAIRS) and
  `packing` snapshot so PRODUCTION rows double as the production log; `vendors` gained
  `phone`/`city`; `products` gained `color` (matching new frontend types).
- **How:** No new table needed — production logs are PRODUCTION stock movements filtered by date.
  Adda delete protection comes from the existing FK (RESTRICT) + a 409 guard in the service
  (Milestone 2.3). Milestones 2/4/5 and routes README updated accordingly.
- **Files:** `System_architecture/database_schema.md`, `backend/src/db/migrations/001_init.sql`,
  `backend/milestones/milestone{2,4,5}.md`, `backend/src/routes/README.md`

### 2026-07-30 — Milestones restructured to follow frontend sidebar order
- **What:** Replaced milestones 1–5 (layer-first: Foundation, Setup CRUD, Accounts, Transactions,
  Reports) with milestones 1–9, where 2–8 follow the frontend sidebar's own screen order (Sale
  Bill → Sale Return → Purchase → Purchase Return → Receipts → Expenses → Current
  Stock/Reports/Search → System Setup → Accounts Hierarchy), 2–3 screens per milestone.
- **How:** All original task detail (posting rules, v4.3 notes, UC references) carried over
  unchanged — only the grouping/order changed. `Workers` (sidebar item with no schema/use-case
  entry) flagged as blocked in Milestone 7 rather than inventing fields for it.
- **Files:** `backend/milestones/milestone{1..9}.md`, `backend/milestones/README.md`,
  `backend/CLAUDE.md`, `backend/plan.md`

### 2026-07-30 — src/ scaffolding pass (later superseded — see next entry)
- **What:** Scaffolded controller/service/repository/routes stubs for every feature missing from
  the layered folder tree (regions, accountClasses, productColors, purchases, purchaseReturns,
  drafts, bankAccounts, cheques, alerts); removed stale `controlAccounts.*` (dropped in v4.3);
  fixed a stale Postgres-style (`$1, $2`) comment in repository file templates to describe `mssql`
  named params instead.
- **How:** Matched the existing TODO-stub style; `routes/index.js` remounted everything grouped by
  milestone. User reverted this specific pass afterward (kept the milestone doc updates) — the
  repo's real base state for Milestone 1 work is the original pre-scaffold stubs.
- **Files:** `backend/src/{controllers,services,repositories,routes}/**`

### 2026-07-30 — Module 1.1 & 1.2: engine switch to MS SQL Server
- **What:** Swapped the backend off Postgres (`pg`) onto MS SQL Server (`mssql`/Tedious), per
  `plan.md` Step 2. `package.json` dependency swap; `.env.example` + `config/index.js` rewritten
  around a `db` connection object (server/port/database/user/password/options) instead of
  `DATABASE_URL`; `pool.js` rewritten around `mssql.ConnectionPool` (`query()` + `withTransaction()`
  wrapping an `mssql` `Transaction`); `migrate.js` rewritten to apply T-SQL batches split on `GO`,
  tracked in `dbo.schema_migrations`; seed script (`src/db/seeds/run.js`) added — admin user,
  account classes/groups, reserved chart accounts (CUSTOMERS/VENDORS ACCOUNTS, CASH IN HAND, SALES,
  PURCHASES, COMMISSION ALLOWED, CHEQUES IN HAND, Payment Trail heads), default store, idempotent.
- **How:** Schema source of truth is `database/schema.sql` (repo root, T-SQL generated from
  `database_schema_v4.3.md`, 39 tables) — the user maintains this file directly, not a
  `src/db/migrations/001_init.sql` copy. `migrate.js` applies `database/schema.sql` first, then any
  later numbered files under `src/db/migrations/`, tracked by basename so both share one
  `schema_migrations` ledger. The old Postgres migration and its planned `001_init.sql` replacement
  were both removed, not archived, once `database/schema.sql` became the actual source of truth.
- **Files:** `backend/package.json`, `backend/.env.example`, `backend/.env`,
  `backend/src/config/{index.js,README.md}`, `backend/src/db/{pool.js,migrate.js,README.md}`,
  `backend/src/db/seeds/run.js`, `backend/src/db/migrations/README.md` (removed),
  `backend/CLAUDE.md`, `backend/milestones/milestone1.md`
- **Pending:** no SQL Server instance set up yet — migration/seed scripts are unverified end-to-end.

## Milestone 2 — Sale Bill & Sale Return

### Module 2.1 — Sale Bill (UC-18, UC-19)
- **What:** `saleBills`/`draftSaleBills` (ipc/service/repository) — create with items, server-side
  totals, list with weekly/monthly/overall/date-range + customer filters, get, update
  (UNPOSTED-only), post/unpost (ledger + stock, one transaction), and the confirm-as-create+post
  draft flow.
- **Files:** `backend/src/{ipc,services,repositories}/{saleBills,draftSaleBills}.*`,
  `backend/src/services/saleBillMath.js`
- **Verified:** stubbed-dependency review only — no live SQL Server yet.

### Module 2.2 — Sale Return (UC-21, UC-22)
- **What:** `saleReturns`/`draftSaleReturns` (ipc/service/repository) — mirror of Module 2.1, with
  the schema's reversed semantics: no `main_ac_id`/`delivery_type`/`delivery_address` (not columns
  on `sale_returns`); post debits SALES / credits customer BA with positive `SALE_RETURN` stock
  movements (reverse of sale bill posting); draft-save restores stock (positive `ADJUSTMENT`),
  draft-delete deducts it back out (negative `ADJUSTMENT`) — reverse of draft sale bills.
- **New cross-cutting requirement (password re-verification), final design:** the frontend's edit
  icon never unposts anything on open — it just opens the form on a still-`CONFIRMED` row. Only
  pressing Confirm/Save actually writes anything, so `update(id, payload)` itself now branches on
  the row's *existing* status: `DRAFT` → plain header/item replace, no ledger involved, no
  password. `CONFIRMED` → the same call also deletes the old `ledger_entries`/`stock_movements`
  rows and reposts fresh ones against the new totals, all inside one `withTransaction` — the
  unpost→edit→repost cycle collapsed into a single atomic step so `status` never visibly leaves
  `CONFIRMED`. The password is required only for that `CONFIRMED` branch: the ipc handler fetches
  the existing row via `service.getById` first, and calls `authService.verifyPassword` only if
  `status === 'CONFIRMED'`, before calling `service.update`. `post()` (the initial Confirm/Save on
  a still-DRAFT row) always requires the password. `unpost()` was reverted to a plain standalone
  action with no password guard — it's no longer part of the edit flow.
  Added `auth.service.js:verifyPassword(userId, password)` + `auth:verify-password` IPC channel
  (re-checks the session user's password without touching session state, distinct from login/
  updateCredentials) to back this. Scoped to Sale Bill/Sale Return for now; same pattern extends
  to Purchase/Receipts/Expenses when those milestones come up.
- **Files:** `backend/src/{ipc,services,repositories}/{saleReturns,draftSaleReturns}.*`,
  `backend/src/services/saleReturnMath.js`, `backend/src/services/auth.service.js`,
  `backend/src/ipc/auth.ipc.js`, `backend/src/services/saleBills.service.js`,
  `backend/src/ipc/saleBills.ipc.js`, `backend/src/ipc/index.js`, `backend/electron/preload.js`
- **Verified:** static review + `debugger` subagent pass, then live end-to-end against a real SQL
  Server (`wentox_db`, migrated + seeded): sale bill post → debit customer BA / credit SALES,
  negative `SALE` stock movement; sale return post → debit SALES / credit customer BA, positive
  `SALE_RETURN` stock movement (confirmed reverse of the bill); unpost removes ledger + stock rows
  on both; draft-return create restores stock (+12 pairs), delete deducts it back out (net 0);
  draft-return confirm reverses the restoration and posts exactly one `SALE_RETURN` movement,
  deletes the draft row; `authService.verifyPassword` rejects a wrong password and accepts the
  right one. Re-verified again after the update()-redesign: editing a CONFIRMED bill (cartons 2→5)
  produced exactly 2 ledger rows and 1 stock row reflecting the new total, `status` stayed
  `CONFIRMED` throughout; editing a DRAFT bill produced 0 ledger rows, `status` stayed `DRAFT`.
- **Pending:** frontend wiring for the password prompt on save/confirm when editing a posted
  document.

## Milestone 3 — Purchase & Purchase Return
_Not started._

## Milestone 4 — Receipts (Jamma) & Expenses (Kharch)
_Not started._

## Milestone 5 — Current Stock, Reports & Search/Bilty-Adda Updation
_Not started._

## Milestone 6 — System Setup: Products, Categories, Vendors
_Not started._

## Milestone 7 — System Setup: Workers, Customers, Sub-Customers
_Not started._
- Removed `phone` column from `customers` and `sub_customers` in `database_schema_v4.3.md` and
  `database/schema.sql` (schema.sql not yet applied, edited directly rather than via migration).
  Dropped `phone` param/column from `customers.repository.js` and `subCustomers.repository.js`
  insert/update queries. No service-layer or vendor changes — vendors keep `phone`.
- Implemented the non-blocking duplicate-name flow for customers and sub-customers (name-only key,
  case-insensitive — neither table carries phone). `create()` no longer rejects same-name ACTIVE
  rows at all (real people share names); it just creates. New `checkName(name)` service fn +
  `<feature>:checkName` IPC channel returns `{status:'none'|'active'|'inactive', matches:[...]}` —
  frontend is expected to call it before create() and show its own prompt, using `'inactive'`'s
  matches to offer per-row reactivate. New `reactivate(id)` fn + `<feature>:reactivate` channel
  flips a row back to active. Also dropped the stray `UQ_sub_customers_name UNIQUE(name)` DB
  constraint (customers never had one) — it would have hard-blocked legitimate same-name
  sub-customers regardless of the app-level check.
- Built (not wired) `frontend/src/components/DuplicateNamePromptModal.tsx` — reusable modal for the
  checkName() result: informational-only on an active match for customers/sub-customers-style
  entities (`allowCreateOnActive`), blocking-with-activate-option on an inactive match either way.
  Not yet imported into `CustomerSetupPage.tsx`/`SubCustomerSetupPage.tsx` or any save flow —
  scaffolding only, per explicit "don't connect it yet" instruction. Note: those pages currently
  run on the old in-memory `useReducer` demo state (`AppContext.tsx`), not real IPC calls to the
  backend at all yet — wiring this up for real also means switching those pages off demo data.

## Milestone 6 — System Setup: Products, Categories, Vendors
- Removed `address` column from `vendors` in `database_schema_v4.3.md` and `database/schema.sql`
  (edited directly, not yet applied). Dropped `address` param/column from
  `vendors.repository.js` insert/update queries. `vendors.phone` untouched.
- Added duplicate handling for `vendors.create()`/`update()` keyed on **name + phone together**
  (not name alone — corrected after review, since two real vendors can share a business name):
  case-insensitive name + NULL-safe exact phone match. Active match blocks (`DUPLICATE_NAME`),
  inactive match throws `INACTIVE_DUPLICATE` with the existing row's id/name/phone in a new
  `ApiError.details` field (threaded through `wrap.js`), and a new `vendors:reactivate`
  channel/service fn lets the frontend flip that row back to active instead of creating a
  duplicate. Also dropped the stray `UNIQUE(name)` DB constraint on `vendors.name` in
  `database_schema_v4.3.md`/`database/schema.sql` — it would have silently blocked legitimate
  same-name vendors regardless of the app-level check. Reference implementation for the same
  pattern on regions/cities/stores/products/employees, and a variant (non-blocking active match,
  list-of-matches on inactive match) for customers/sub-customers — write-up in
  `System_architecture/soft_delete_and_duplicate_check.md`.

## Milestone 8 — System Setup: Cities & Accounts Hierarchy
_Stale note — this was true when first written; superseded by the entries near the top of this log
(backend and frontend both complete for all of 8.1/8.2/8.3, verified live)._

## Milestone 9 — Alerts, Frontend Integration & Electron
- Module 9.1 (Alerts) and most of 9.3 (Electron main/preload, dev script, update-check page) were
  already done in an earlier session but never reflected here — this entry had gone stale. Module
  9.2 (frontend wired to real `window.api` calls, off `AppContext` demo data) confirmed complete
  by explicit user confirmation this session — not independently re-verified line-by-line here.
- **New scope: live backup database.** A second SQL Server database, kept in sync via native
  `BACKUP DATABASE`/`RESTORE DATABASE` (not row-by-row dual writes — avoids `IDENTITY` id drift
  between the two DBs) rather than a live queryable mirror written to on every insert.
  `backend/src/services/backup.service.js` — `sync()`/`syncIfDirty()`, an in-flight-promise guard
  so a manual click during an auto-sync just awaits the same run. `pool.js#withTransaction()` now
  sets a dirty flag on commit; a 10-minute timer in `electron/main.js` calls `syncIfDirty()`,
  skipping the (expensive) BACKUP/RESTORE entirely when nothing changed. Failures are caught/
  logged, never block or roll back the main write. `backup:runNow`/`backup:status` IPC (admin-
  only) + a "Backup Database" card on `SettingsPage.tsx` (Backup Now button, last-sync display).
  Install-time: `build/installer.nsh` adds one custom NSIS page (main install path stays fixed,
  per explicit requirement) asking for the backup folder, writes it to
  `%APPDATA%\Wentox\backup-config.json`; `src/config/appConfig.js` reads it at runtime via
  `app.getPath('userData')` (`app.setName('Wentox')` added to `main.js` so that path resolves
  correctly — package.json's own `name` is the npm package `wentox-backend`, not this).
  electron-builder config added to `package.json` (`build` block, NSIS target, `extraResources`
  copying `frontend/dist` in since the packaged app can't rely on the monorepo's relative
  `../../frontend` layout) — new `npm run dist:win` script.
- **Not yet live-verified** — no SQL Server reachable in this sandbox, and `electron-builder --win`
  needs an actual Windows build to confirm the NSIS script and packaged app end-to-end. Next real
  step: run `npm run dist:win` on a Windows machine (or CI), install it, and confirm the backup
  page appears, the config file lands correctly, and Backup Now actually produces a synced
  `wentox_backup` database.
- **Files:** `backend/src/services/backup.service.js`, `backend/src/ipc/backup.ipc.js`,
  `backend/src/config/appConfig.js`, `backend/src/config/index.js`, `backend/src/db/pool.js`,
  `backend/src/ipc/index.js`, `backend/electron/main.js`, `backend/build/installer.nsh`,
  `backend/package.json`, `frontend/src/pages/SettingsPage.tsx`,
  `frontend/src/lib/ipcBridge.ts`, `frontend/src/types/electron-api.d.ts`

## Sale Bill — stock reserved at save, not at post
- **Behavior change (explicit user decision):** saving a sale bill (the existing "Save Bill"
  button — no separate "New Bill" button added, kept as one action) now deducts stock immediately,
  the same reserve-on-save model `draftSaleBills.service.js` already used, instead of waiting
  until `post()`. The ledger (`ledger_entries`) still only gets written at `post()`/`postAll()`,
  and only removed at `unpost()` — stock no longer moves on post/unpost at all, since it's already
  reserved from the moment the bill is saved and stays reserved for as long as the bill exists.
- `saleBills.service.js`: `create()` now inserts a negative ADJUSTMENT `stock_movements` row per
  item (via new `assertStockAvailable()`/`saleStockMovements()` helpers, mirroring
  `draftSaleBills.service.js`). `update()` unconditionally reconciles stock (release old lines,
  reserve new ones) via a new `assertStockAvailableForEdit()` that nets out the bill's own
  existing reservation before checking against `pairsOnHand()` — otherwise editing a bill's own
  quantities without changing the total would look like a false oversell. `post()`/`update()`'s
  posted branch now call a new ledger-only `writeLedger()` (split out of `postLedgerAndStock`,
  which stays intact for `draftSaleBills.confirm()` — that flow still writes ledger+stock together
  in one step). `unpost()` only deletes ledger entries now, never stock.
- `saleBills.repository.js`: `deleteLedgerAndStock()` split into `deleteLedgerEntries()` +
  `deleteStockMovements()`.
- No frontend changes needed — `SaleBillPage.tsx`'s existing "Save Bill" button (edit mode) and
  the "Post All" button already implement exactly this save-unposted-then-post-later flow; the
  stock timing was the only thing that needed to move.
- **Not yet live-verified** — no SQL Server reachable in this sandbox; run through create → edit
  quantities → Post All → unpost on a real DB to confirm stock lands correctly at each step.
- **Files:** `backend/src/services/saleBills.service.js`, `backend/src/repositories/saleBills.repository.js`

## Sale Bill — Pending Posting moved to a vertical sidebar, grouped by customer
- **UI change (explicit user request):** the "Pending Posting" panel moved out of the main
  content flow into a persistent left-side vertical rail (`SaleBillPage.tsx`), shown across all
  sub-tabs, not only the billing form. Bills are grouped by customer (click a customer to expand/
  collapse their bills) instead of one flat list. Clicking a bill loads it into the form via the
  existing password-gated edit path (`handleEditSpecificBill`, fetching the full row with
  `api.saleBills.get` since `listUnposted` only returns summary fields). Each bill row also has
  its own small "Post" button (`handlePostOneUnposted`) to post just that one without leaving the
  sidebar; "Post All" is unchanged.
- `listUnposted()` (`saleBills.repository.js`) now also selects `sb.customer_id` so bills can be
  grouped reliably instead of only by name string; `UnpostedBillRow` (`frontend/src/lib/api.ts`)
  gained the matching `customer_id` field.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/lib/api.ts`,
  `backend/src/repositories/saleBills.repository.js`

## Sale Bill — Pending Posting: corrected to leave the main card untouched, flat list
- **Follow-up correction (explicit user feedback):** the previous change had shrunk/shifted the
  main Sale Bill card to make room for the sidebar via flexbox, and grouped unposted bills by
  customer — both undone. The main card (`mx-auto`, `maxWidth: 1200`) is back to its original,
  unmodified layout. "Pending Posting" instead sits `position: absolute` in the unused left
  margin (`hidden xl:block absolute left-0 top-0 w-64`, inside a `relative` wrapper around the
  whole page body) so it never affects the card's own width or centering. Customer grouping
  removed — back to one flat list of every unposted bill (bill_no, customer name, date, value),
  each row still click-to-edit and carrying its own individual Post button; "Post All" unchanged.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`

## Sale Bill — Pending Posting: fixed overlap with the main card
- **Bug fix (user-reported, with screenshot):** the absolute-positioned left-margin placement from
  the prior entry overlapped the main card at normal window widths — it assumed more spare margin
  existed than actually did. Replaced with a real flex layout: the Pending Posting list is a flex
  sibling with a fixed `w-64` column (`hidden lg:block`, sticky), and the card's wrapper
  (`mx-auto`, `maxWidth: 1200`, unchanged otherwise) is `flex-1 min-w-0` so it centers within
  whatever space remains next to that column — guaranteed no overlap at any width, at the cost of
  the card recentering slightly left of full-page-center when the sidebar is showing.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`

## Sale Bill — Pending Posting: card left genuinely untouched
- **Follow-up correction (user-reported, with screenshot):** the flex-sibling fix removed the
  overlap but visibly narrowed/shifted the card (it centered within the remaining flex space
  instead of its original position). Replaced with: the Pending Posting list now lives INSIDE the
  same `mx-auto`/`maxWidth: 1200` wrapper as the card (that wrapper now also carries `relative`),
  positioned `absolute` and anchored via `right: calc(100% + 24px)` to that wrapper's own left
  edge — not to the viewport, not to a guessed margin. Being `absolute`, it's out of flow, so it
  cannot affect the card's width or position at all; wherever the card's real edge lands, the list
  sits just outside it. Shown only from the `2xl` breakpoint up (≥1536px viewport), since below
  that there generally isn't ~280px of real margin for it to land in without spilling past the
  window edge.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`

## Sale Bill — compacted form to fit one screen (no scroll to reach Save/Post)
- **UI request:** the form's vertical stack (toolbar → header fields → customer/delivery boxes →
  item table → remarks/calculations) ran well past typical window height, so posting a bill
  always required scrolling. Tightened spacing throughout `SaleBillPage.tsx` rather than removing
  any field:
  - Toolbar and card outer padding trimmed (`p-4`→`p-3`, `p-6 md:p-8`→`p-4 md:p-5`).
  - Header fields grid, Customer Information box, Delivery & Logistics box: `gap-4/6`→`gap-2/3`,
    `mb-6 pb-6`→`mb-3 pb-3`, box padding `p-4`→`p-3`.
  - Item table cell padding `p-3`→`p-2` throughout (header + body cells).
  - Remarks/Due Date/Calculations: was a tall stacked column (120px textarea + due date + helper
    line, `mt-6 pt-4` gap) next to a `min-h-[160px]` calculations box. Now Remarks and Payment Due
    Date sit side-by-side (2-col sub-grid) with a 2-row textarea (`minHeight: 52px`), shortened
    helper text, and the calculations box padding/line-gaps tightened — no `min-h` floor left, it
    sizes to content.
  - Banners (error/success/stock-limit) and the Drafts panel: padding/margins trimmed to match
    (`py-3`→`py-2.5`, `mb-4`→`mb-3`, etc.)
  - No fields removed or hidden — same data, tighter spacing.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`

## Sale Return — same form compaction as Sale Bill
- Applied the identical spacing tightening from the Sale Bill pass to `SaleReturnPage.tsx`'s main
  card: toolbar/drafts-panel/banner padding-margins, card outer padding (`p-6 md:p-8`→`p-4 md:p-5`),
  header fields grid, Customer Information / Dispatch Logistics box padding+gaps, item table cell
  padding (`p-3`→`p-2`), Add Item Row button margin, and the Remarks/Calculations row (textarea
  4 rows→2 rows with no forced growth, calculations box `min-h-[160px]` floor removed).
  Sale Return has no due-date field, so there was nothing to move under Remarks here — the rest of
  the compaction is otherwise a direct match.
- **Files:** `frontend/src/pages/SaleReturnPage.tsx`

## Sale Return — Saved Drafts moved to a left-side vertical list (same pattern as Sale Bill)
- **User request:** move the "Saved Drafts" panel the same way SaleBillPage's Pending Posting
  panel was moved — off the main flow, onto the left. Replaced the horizontal
  select+"Confirm Draft (Post)"+"Delete Selected Draft" bar with a flat vertical list, positioned
  identically to SaleBillPage's sidebar: `absolute`, anchored via `right: calc(100% + 24px)` to
  the card wrapper's own left edge (not the viewport), `hidden 2xl:block` so it only shows when
  there's realistically enough margin, living inside the same `mx-auto`/`maxWidth: 1200` wrapper
  (now also `relative`) so it can never affect the card's own width/position.
- Each row (bill_no, customer name, date) is click-to-load (`handleOpenDraftRow`) plus its own
  small Post (`handleConfirmDraftRow`) / Delete (`handleDeleteDraftRow`) buttons — self-contained
  per row instead of the old single-selection + two buttons acting on `selectedDraftId`. The old
  `handleConfirmDraft` (select-driven) was removed as dead code once nothing referenced it.
- **Files:** `frontend/src/pages/SaleReturnPage.tsx`

## Sale Bill / Sale Return — further compaction, icon action buttons, Sale Return Post All
1. **Further compaction (both pages):** an additional tightening pass on top of the earlier one —
   card outer padding `p-4 md:p-5`→`p-3 md:p-4`, toolbar `p-3 mb-3`→`p-2.5 mb-2`, header fields
   grid and Customer/Dispatch section outer grid `gap-3 mb-3 pb-3`→`gap-2 mb-2 pb-2`, the two info
   boxes `p-3`→`p-2.5` with tighter internal gaps, item table cell padding `p-2`→`p-1.5`
   throughout, Add Item Row margin `mb-3`→`mb-2`, Remarks/Calculations row `gap-3 mt-3 pt-3`→
   `gap-2 mt-2 pt-2`. Also caught `SaleReturnPage.tsx`'s item table wrapper, which still had the
   original `mb-6` — missed in the first compaction pass.
2. **Draft/pending-list row actions → icon buttons, horizontal:** replaced the text "Post"/"Del"
   buttons in both SaleBillPage's Pending Posting list and SaleReturnPage's Saved Drafts list with
   small icon-only buttons (`CheckCircle2` for post, `Trash2` for delete) laid out in a horizontal
   row (`flex flex-row gap-1`) instead of stacked/full-width text buttons.
3. **Sale Return: added a "Post All" button** for drafts. There's no backend batch-post endpoint
   for sale returns the way `saleBills.postAll()` exists for bills (a draft return already IS the
   unposted state — there's no separate "saved but unposted" return the way a saved bill is), so
   `handlePostAllDrafts` confirms every draft sequentially client-side through the same
   `draftSaleReturns.confirm()` a single row's Post button uses, sequential (not `Promise.all`)
   for the same one-failure-shouldn't-block-the-rest reasoning as `saleBills.postAll()`, reporting
   posted/failed counts the same way.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`

## Sale Return — fixed Transport Adda wrapping + wasted space beside Customer box
- **Bug fix:** "Delivery Agent (if any)" was `col-span-2` (full width), pushing Transport Adda
  onto its own third row instead of sitting beside Delivery Agent the way SaleBillPage pairs its
  Delivery field with Transport Adda. That extra row made the Dispatch Logistics box taller than
  the Customer Information box beside it in the same grid row — since grid items stretch to match
  by default, the shorter Customer box visibly had empty space below Customer Code. Removed the
  `col-span-2`, so Delivery Agent and Transport Adda now share row 1 (GP No./Bilty No. stay row
  2) — 2 rows total, matching Customer Information's height, no more empty space.
- **Files:** `frontend/src/pages/SaleReturnPage.tsx`

## Sale Bill — Delete button on a specific unposted bill (password-gated)
- **New capability:** the Pending Posting sidebar's row icons gained a Delete (trash icon) next
  to Post. Backend: `saleBills.service.js#remove()` — throws if the bill is posted (must unpost
  first, same restriction pattern used elsewhere), otherwise releases the stock `create()`
  reserved at save time (`deleteStockMovements`), deletes the items, then the bill row, all in one
  transaction. New repository `deleteBill()`. New IPC channel `sale-bills:remove` — password
  verified server-side (`authService.verifyPassword`) unconditionally before calling the service,
  same guard level as editing an already-posted bill, since deleting has no reverse-never-erase
  trail. Frontend: `api.saleBills.remove(id, password)`; the sidebar's Delete button reuses the
  existing `PasswordPromptModal` flow via a new `delete_unposted_bill` password-action branch — on
  success, refreshes the Pending Posting list and stock, and resets the form if the bill just
  deleted was the one open on screen.
- **Files:** `backend/src/services/saleBills.service.js`,
  `backend/src/repositories/saleBills.repository.js`, `backend/src/ipc/saleBills.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/SaleBillPage.tsx`

## Sale Bill / Sale Return — item table scrolls internally past 3 rows
- **UI request:** adding item rows was growing the card indefinitely (and re-triggering the
  scroll problem task 1 fixed). The item table wrapper is now `overflow-y-auto` with
  `maxHeight: 230px` (~header + 3 rows) instead of `overflow-visible` with no cap — the 4th row
  onward scrolls inside the table instead of growing the card. The header row (`<th>`s) is
  `sticky top-0` within that scroll box so column labels stay visible past row 3.
  `SearchableSelect`'s own dropdown already renders through a `position: fixed` React portal (not
  a descendant of the scroll box in the DOM), so it isn't clipped by the new `overflow-y: auto`
  even when opened on a row near the bottom edge — confirmed by reading its source before making
  this change, since clipping a dropdown menu would have been a real regression otherwise.
- **Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`

## Sale Bill / Sale Return — new item rows insert at the top, not the bottom
- **UI request:** "+ Add Item Row" (and its keyboard equivalent — Shift+Enter/Ctrl+Enter/'.'+Enter
  from the last field of any row) now prepends the new row instead of appending it, on both pages.
  Pairs with the recent 2-row scroll cap on the item table: the newest article is the one the user
  is about to type into, so it should be the one visible without scrolling down past everything
  already entered. The keyboard shortcut's focus target changed from `items.length` (old last
  index) to a fixed `0` (new row is always the top row now).
- **Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`

## Purchase Page — Recorded Purchases moved to its own tab, Save button moved up, 10-row scroll cap
- **UI request:** three changes to `PurchasePage.tsx`, bringing it in line with the Sale Bill /
  Sale Return pattern:
  1. **Recorded Purchases → its own tab.** Was an always-rendered card below the live entry form
     (every purchase ever recorded, no filter, pushing the page well past one screen). Added a
     `tabBar` (New Purchase / Recorded Purchases) in `AppLayout`'s `headerAction` slot, matching
     SaleBillPage's tab switcher placement. The records tab has a From/To date-range filter
     (`recordsDateFrom`/`recordsDateTo`, either end optional — blank means unbounded) via a new
     `filteredPurchases` memo; clicking a row loads it and switches back to the entry tab in view
     mode, same as the other pages' record tabs.
  2. **Save/Update Purchase button moved up** into the toolbar row at the top of the form
     (alongside Edit/Post/Unpost/New Purchase), instead of sitting below the entire item table —
     matching SaleBillPage/SaleReturnPage, where the primary action doesn't require scrolling past
     the item table to reach. "Cancel Edit" moved with it; "Add Line Item" stayed where it was,
     next to the table.
  3. **Item table capped to ~10 rows**, `overflow-y-auto` + `maxHeight: 620px` with a `sticky`
     header, same pattern as the other pages' item tables (SaleBill/SaleReturn cap at ~2 rows;
     this one's taller since a purchase routinely lists more distinct materials than a sale bill
     lists articles). Purchase's own item fields are plain `<input>`/native `<select>` rather than
     `SearchableSelect`, so there's no dropdown-portal clipping concern here.
- **Files:** `frontend/src/pages/PurchasePage.tsx`

## Purchase Return Page — same treatment as PurchasePage
- Applied the identical set of changes made to `PurchasePage.tsx` to `PurchaseReturnPage.tsx`:
  1. Recorded Purchase Returns moved to its own tab (`tabBar` in `AppLayout`'s `headerAction`),
     off the always-rendered inline card. Date-range filter defaults to the last three months
     (`getThreeMonthsAgoDate()` to `getTodayDate()`) via a new `filteredReturns` memo, both ends
     editable/clearable. Clicking a row loads it and switches back to the entry tab.
  2. Save/Update Return button moved up into the top toolbar row (with Edit/Post/Unpost/New
     Return), instead of below the item table. "Cancel Edit" moved with it; "Add Line Item" stayed
     by the table.
  3. Item table capped to ~8 rows (`overflow-y-auto`, `maxHeight: 500px`) with a `sticky` header,
     same as PurchasePage. No unposted/Pending-Posting concept exists on this page (returns post/
     unpost individually, no batch), so nothing else needed moving.
- **Files:** `frontend/src/pages/PurchaseReturnPage.tsx`

## Receipts Page — Recorded Receipts now shows unposted only
- **UI request:** "Recorded Receipts" was mixing CONFIRMED (posted) and DRAFT (unposted) rows
  together. `sortedReceipts` now filters to `status !== 'CONFIRMED'` before sorting; the endorsed
  settlements appended into the same table (a separate `settlements` list, joined visually via the
  Type column) get the identical filter via a new `unpostedSettlements` memo. Empty-state check
  and copy updated to account for both lists together ("No unposted receipts."), and the section
  heading now reads "Recorded Receipts — Unposted".
- **Files:** `frontend/src/pages/ReceiptsPage.tsx`

## Receipts Page — Enter-walk reaches Payment Mode; Endorse checkbox gets the Shift+Enter chord
- **Bug 1 — Enter-walk skipped Payment Mode entirely:** the Cash/Cheque/Online buttons were plain
  `button[type="button"]` with no `data-field-nav` — AppLayout's G-01 Enter-walk only recognizes
  `input`/`select`/`textarea`/`button[data-field-nav]`, so the group was invisible to it and Enter
  jumped straight from Remarks to the Endorse checkbox, skipping Payment Mode. Fixed with a
  roving-stop pattern: only the currently SELECTED button carries `data-field-nav` (`PAYMENT_MODES`/
  `PAYMENT_MODE_LABELS` + `paymentModeRefs`), so the group is exactly one stop, landing on whichever
  mode is active. Left/Right now cycles the selection and moves focus with it
  (`handlePaymentModeKeyDown`, `stopPropagation`'d so AppLayout's own Left/Right field-walk doesn't
  also fire), giving keyboard users a way to actually change the mode.
- **Bug 2 — Endorse checkbox's Enter behavior made explicit:** adopted the same
  Shift+Enter/Ctrl+Enter/'.'+Enter convention already used elsewhere (SaleBillPage/
  SaleReturnPage/PurchasePage's "add a row") — on the checkbox, that chord checks Endorse and
  focuses straight into the newly-revealed Pay To field (`handleEndorseCheckboxKeyDown`, new
  `endorseToWrapRef` + `focusFirstField`). Plain Enter is left completely untouched, so G-01's
  existing handler runs exactly as it already does everywhere else: walk to the next field, or —
  if the checkbox is the last field currently on screen — submit (save the receipt unposted).
- **Files:** `frontend/src/pages/ReceiptsPage.tsx`

## Expenses Page — same Enter-walk fix as Receipts
- **Bug fix (mirrors ReceiptsPage):** Payment Mode here is a 4-way button toggle (Cash/Cheque
  Endorsed/Cheque Issued/Online), same plain `button[type="button"]` issue — invisible to
  AppLayout's G-01 Enter-walk (`input`/`select`/`textarea`/`button[data-field-nav]` only), so Enter
  skipped straight past it. Same roving-stop fix: only the selected button carries
  `data-field-nav` (`PAYMENT_MODES`/`PAYMENT_MODE_LABELS` + `paymentModeRefs`), Left/Right cycles
  the selection and moves focus with it (`handlePaymentModeKeyDown`, `stopPropagation`'d). Reused
  the existing `selectPaymentMode()` helper (already resets mode-dependent fields) rather than
  calling `setPaymentMode` directly.
  No Endorse-checkbox equivalent exists on this page — Cheque Endorsed is just one of the four
  button modes, already reachable once the roving-stop fix landed — so there was nothing else to
  change here.
- **Files:** `frontend/src/pages/ExpensesPage.tsx`

## Fixed: Enter on the last field did nothing on Receipts/Expenses/Journal Voucher/Transfer/
## User Management — submit button lookup didn't account for form="<id>" association
- **Root cause:** these pages put the primary action button in a toolbar row ABOVE the card,
  outside the `<form>` element, associated via the HTML `form="<id>"` attribute instead of being
  nested inside it. Both `AppLayout.tsx`'s G-01 Enter handler and `lib/fieldNav.ts`'s
  `focusNextField()` (used by SearchableSelect/add-row flows) found the submit button via
  `form.querySelector('button[type="submit"]')` — which only walks DOM descendants and has no
  concept of the `form` attribute association — so on every one of these pages, pressing Enter on
  the last field silently did nothing. Reported directly by the user on Receipts (the Endorse
  checkbox specifically, but the bug affects the whole form on all five pages equally, not
  anything specific to that field).
- **Fix:** new shared `findSubmitButton(form)` in `lib/fieldNav.ts` — scans
  `document.querySelectorAll('button[type="submit"]:not(:disabled)')` and filters by
  `btn.form === form`. `HTMLButtonElement.form` is the browser's own resolved association,
  correct for both a nested button and one linked via the attribute, so this works uniformly
  without the caller needing to know which shape a given page uses. Both `AppLayout.tsx`'s inline
  Enter-handler logic and `focusNextField()` now call it instead of duplicating (and
  independently getting wrong) the same `querySelector` lookup.
- **Files:** `frontend/src/lib/fieldNav.ts`, `frontend/src/components/AppLayout.tsx`

## Expenses Page — Recorded Expenses now shows unposted only
- **UI request (mirrors ReceiptsPage):** "Recorded Expenses" was mixing CONFIRMED (posted) and
  DRAFT (unposted) rows. `sortedExpenses` now filters to `status !== 'CONFIRMED'` before sorting.
  Empty-state copy updated ("No unposted expenses.") and the section heading now reads "Recorded
  Expenses — Unposted".
- **Files:** `frontend/src/pages/ExpensesPage.tsx`

## Journal Voucher — added Number field (matches legacy Journal Entry screen)
- **User request:** match the old system's Journal Entry screen's fields, scoped down after
  confirming with the user to just the missing field rather than rebuilding JV as a full
  multi-line general journal (the old screen's A/C Code/Debit/Credit grid across N accounts is a
  fundamentally different tool than today's simplified 2-leg "one account vs the fixed JOURNAL
  VOUCHER clearing account" design — that would need a new `journal_voucher_lines` table and
  balance-to-zero posting logic; user chose to keep the current model).
- Added `voucher_no NVARCHAR(30) NULL` via new migration `023_journal_vouchers_number.sql`
  (schema.sql is already-applied, per convention never edited directly). Optional, unvalidated,
  same treatment as `sale_bills.gp_no`/`bilty_no` — a manual office cross-reference number,
  distinct from `jv_id`.
  Threaded through `journalVouchers.repository.js` (insert/update), `journalVouchers.service.js`'s
  `buildFields()`, `JournalVoucherRow`/`JournalVoucherCreateInput` in `lib/api.ts`, and
  `JournalVoucherPage.tsx` (new `voucherNo` state, form field next to Date, list table column,
  included in the JV search filter).
- **Not yet live-verified** — no SQL Server reachable in this sandbox; run `npm run migrate` on a
  real DB to confirm the column lands and create/update/list round-trip it correctly.
- **Files:** `backend/src/db/migrations/023_journal_vouchers_number.sql`,
  `backend/src/repositories/journalVouchers.repository.js`,
  `backend/src/services/journalVouchers.service.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/JournalVoucherPage.tsx`

## Journal Voucher — removed Remarks field (Reason covers it)
- Removed the Remarks textarea and its `remarks` state from `JournalVoucherPage.tsx`'s entry form
  — Reason (required) is enough, per explicit user decision. Dropped from `handleNew`,
  `buildPayload` (no longer sent — the field stays optional server-side, so omitting it is a valid
  payload), `loadRow`, and the JV search filter; search placeholder updated to mention Number
  instead of remarks. Backend (`journal_vouchers.remarks` column, service/repository support)
  left untouched — harmless unused capability, no migration needed to remove a nullable column
  nothing writes to anymore.
- **Files:** `frontend/src/pages/JournalVoucherPage.tsx`

## Fixed: unposted Purchase/Sale Bill amounts leaking into Vendor/Sale reports
- **Bug reported by user:** an unposted purchase showed up in "the ledger" (specifically, its
  amount was already counted in the Vendor Report's Total Purchase, before Post ever wrote
  anything to `ledger_entries`). Audited every aggregation query in
  `reports.repository.js` for the same class of bug — reading straight from a document table
  (`sale_bills`/`sale_returns`/`purchases`/`purchase_returns`, none of which carry a stored status
  column; "posted" is derived from `ledger_entries` existing for the row) without gating on
  that — and found two:
  - `vendorReportRows()` (Vendor Report, UC-33): `total_purchase` (from `purchases`) and
    `total_return` (from `purchase_returns`) had NO posted-only filter, while every other bucket in
    the same query (expenses, cheque allocations, settlements, JVs) already correctly filtered to
    CONFIRMED/ACTIVE. Fixed by adding
    `EXISTS (SELECT 1 FROM ledger_entries WHERE source_type = 'PURCHASE'/'PURCHASE_RETURN' AND
    source_id = ...)` to both subqueries, same idiom already used in
    `purchases.repository.js#lastPurchasedRate`.
  - `saleAggregateByCustomer()` (Sale Analysis & Sale Report, UC-31/32): same bug, same fix —
    `total_sales` (`sale_bills`)/`total_returns` (`sale_returns`) now gated on the equivalent
    `SALE_BILL`/`SALE_RETURN` EXISTS check, matching how the receipts/settlements/JVs buckets in
    that same query already worked.
  - Everything else in the file checked clean: `ledgerRows`/`netBalance`/
    `businessAccountBalancesAsOf`/`chartAccountBalancesAsOf`/`chartAccountsWithActivity`/
    `cashBookRows` all read strictly from `ledger_entries` (inherently posted-only); `paymentTrailRows`/
    `cashBookNonCashRows`/`cashBookBankTransfers`/`cashBookChequeDeposits` already filter to
    CONFIRMED/ACTIVE. `productionLog`/`productLedger`/`vendorStock` read `stock_movements`/
    `vendor_stock_movements`, which fill at SAVE time by design (the reserve-on-save stock model
    covered earlier in this log) — not a bug, a different, already-agreed-on rule.
  - Also checked `alerts.repository.js` (already correctly EXISTS-gated) and `addas.repository.js`
    (a delete-reference COUNT, not a balance figure — doesn't need the filter).
  - Frontend (`VendorReportPage.tsx`, `SaleReportPage.tsx`, `SaleAnalysisPage.tsx`) only consumes
    these backend totals directly, no separate client-side aggregation — fixing the two queries
    fixes every screen that shows them.
- **Not yet live-verified** — no SQL Server reachable in this sandbox; create an unposted purchase
  and confirm it no longer moves the Vendor Report's Total Purchase/balance until actually Posted,
  same for an unposted Sale Bill against Sale Analysis/Sale Report.
- **Files:** `backend/src/repositories/reports.repository.js`

## Product Setup (multi-article "Add Article" batch) — Shift+Enter/'.'+Enter adds a new article row
- **UI request:** plain Enter on the last field of the batch already submits the whole "Add
  Article(s)" form via G-01 (correct, left untouched). Added the same
  Shift+Enter/Ctrl+Enter/'.'+Enter chord convention used on SaleBillPage/SaleReturnPage/
  PurchasePage's item rows: from the last field of ANY article row (not only the last one), it
  appends a new blank article at the end and focuses into it, instead of submitting/walking past.
- `ProductArticleForm.tsx` gained an optional `onLastFieldKeyDown` prop, wired onto its actual last
  field (the final cost-breakdown input) — omitted by the single-product edit form's usage, which
  has no "add another" concept. `ProductSetupPage.tsx` added `articleRowRefs` (one per row wrapper
  div, used with the existing `focusFirstField()` helper the same way SaleBillPage's
  `articleCellRefs` works) and `handleArticleLastFieldKeyDown`, passed to every row in the batch.
- **Files:** `frontend/src/components/ProductArticleForm.tsx`, `frontend/src/pages/ProductSetupPage.tsx`

## Fixed: Vendor purchase-history modal showed unposted purchases
- **Bug reported by user:** VendorSetupPage's per-vendor "purchase history" drill-down (click a
  vendor card → modal listing that vendor's purchases) showed unposted purchases alongside posted
  ones — a purchase that hasn't happened yet (no ledger effect) read as a real recorded one.
- Root cause: `purchases.repository.js#list()` was a plain `SELECT *`, never computing
  `is_posted` at all (only `get()`/`create()`/`update()`/`post()`/`unpost()` did, via a separate
  `isPosted()` query) — despite `PurchaseRow.is_posted` being a required, non-optional field in the
  frontend type, so every `list()` caller was silently getting `undefined` there. Added the same
  `EXISTS (SELECT 1 FROM ledger_entries WHERE source_type = 'PURCHASE' ...)` computed column used
  elsewhere, so `list()` now genuinely matches its own declared type.
  `VendorSetupPage.tsx#openPurchaseHistory` now filters to `p.is_posted` before displaying.
- **Files:** `backend/src/repositories/purchases.repository.js`, `frontend/src/pages/VendorSetupPage.tsx`

## Fixed (thorough pass): Recorded Purchases / Recorded Purchase Returns showed unposted rows
- **Same bug class as the VendorSetupPage fix, applied everywhere else it appeared.** Both
  `PurchasePage.tsx`'s "Recorded Purchases" tab and `PurchaseReturnPage.tsx`'s "Recorded Purchase
  Returns" tab were built on `purchases.repository.js`/`purchaseReturns.repository.js#list()`,
  which — same root cause as before — never computed `is_posted` (plain `SELECT *`), so there was
  nothing for the frontend to filter on even after the vendor-modal fix landed.
  - `purchaseReturns.repository.js#list()`: added the identical
    `EXISTS (SELECT 1 FROM ledger_entries WHERE source_type = 'PURCHASE_RETURN' ...)` computed
    `is_posted` column `purchases.repository.js#list()` already got in the previous fix.
  - `PurchasePage.tsx`'s `sortedPurchases` and `PurchaseReturnPage.tsx`'s `sortedReturns` (the
    memos feeding their respective "Recorded ..." tabs) now filter to `.is_posted` before sorting.
    An unposted purchase/return is still reachable exactly where it always was — the Pending
    Posting panel (Purchase) or the entry form directly (Return) — this only removes it from the
    posted-history list, same split already applied to Sale Bill/Sale Return/Receipts/Expenses.
- **Files:** `backend/src/repositories/purchaseReturns.repository.js`,
  `frontend/src/pages/PurchasePage.tsx`, `frontend/src/pages/PurchaseReturnPage.tsx`

## MAJOR ARCHITECTURE CHANGE — Sale Bill: unposted documents now live in the draft table
- **User-approved plan:** "Save" no longer inserts an unposted row into `sale_bills` — it now
  inserts into `draft_sale_bills`, the same table that used to be reserved for genuinely
  incomplete entries. `sale_bills` now strictly NEVER holds an unposted document. "Post" moves the
  row draft → real (writes ledger, deletes the draft — this is what `draftSaleBills.confirm()`
  already did for incomplete drafts; it's now the ONLY posting path). "Unpost" is the new reverse:
  moves the row real → draft again (new `saleBills.service.js#unconfirm()`), rather than the old
  behavior of just clearing the bill's ledger entries and leaving it sitting in `sale_bills`.
  Scoped to **Sale Bill only** for this pass, per explicit user choice — Sale Return, Purchase,
  Purchase Return, Receipts, Expenses are UNCHANGED (still today's "real row, no ledger yet" model)
  and Journal Voucher has no draft table to move this pattern to yet.
- **Backend:**
  - `draftSaleBills.repository.js`: added `updateDraftHeader()`/`deleteDraftItems()` (editing a
    draft's header/items — previously only insert/find/delete existed).
  - `draftSaleBills.service.js`: added `update(draftId, payload)` — stock reconciled
    unconditionally (release old lines' reservation via a positive reversing ADJUSTMENT — never
    delete the original row, matching the reverse-never-erase pattern `remove()`/`confirm()`
    already use — then reserve the new lines), netting out the draft's own existing reservation
    before checking availability (mirrors `saleBills.service.js`'s own edit-reconciliation logic).
    Added `confirmAll(ids, userId)` — Post All for drafts, same `{posted, failed, attempted}`
    contract as `saleBills.service.js#postAll()`, sequential for the same live-stock-read reason.
  - `saleBills.service.js`: added `unconfirm(id)` — the reverse of `draftSaleBills.confirm()`.
    Deletes the bill's ledger entries, releases its `SALE_BILL` stock reservation, inserts a new
    `draft_sale_bills` row (+ items + a fresh `DRAFT_SALE_BILL` reservation) from the bill's own
    data, then deletes the real bill + its items. Requires `draftSaleBills.repository` directly
    (not its service) to avoid a circular require, since `draftSaleBills.service.js` already
    requires `saleBills.service.js` the other way for `confirm()`.
  - New IPC channels: `draft-sale-bills:update`, `draft-sale-bills:confirmAll`,
    `sale-bills:unconfirm`. `draft-sale-bills:remove` now requires a password (verified
    server-side) — deleting any saved-unposted bill is destructive with no undo trail, so it gets
    the same guard editing an already-posted bill does; this used to have no password since it was
    only ever a genuinely-incomplete entry before.
  - `sale-bills:create`/`:post`/`:unpost`/`:remove`/`:listUnposted`/`:postAll` and their service
    functions are left in place but are now DEAD CODE for the Sale Bill flow — nothing in the
    frontend calls them anymore. Not deleted, to keep the change reversible/lower-risk; a future
    cleanup pass could remove them once this is confirmed working end-to-end.
- **Frontend (`SaleBillPage.tsx`):** the old two-separate-concepts UI ("Saved Drafts" panel +
  select-a-draft dropdown, and "Pending Posting" sidebar reading real unposted rows) collapsed
  into ONE — the Pending Posting sidebar now reads `draftSaleBills.list()` directly, since there's
  no longer a meaningful distinction between "incomplete" and "complete but unposted." The old
  Saved Drafts panel/dropdown/Confirm/Delete buttons and `handleConfirmDraft` were removed
  entirely. `executeSave()` branches on a new `isEditingPostedBill` flag
  (`mode === 'edit' && currentBillIsPosted`): that one case still goes through
  `saleBills.update()` (an already-posted bill can still be edited in place, unaffected by this
  change); every other save — a brand-new bill, or editing a still-unposted one — goes through
  `draftSaleBills.create()`/`.update()`. Only editing an ALREADY-POSTED bill is password-gated now
  (opening/editing a draft from the sidebar needs no password, same as drafts always worked).
  `billId` now means either a `bill_id` or a `draft_id` depending on `currentBillIsPosted` — every
  handler that posts/unposts/deletes updates it to the new id space after a successful call, since
  posting/unposting genuinely changes which row (and which table) the document lives in.
- **Known gaps, explicitly flagged:**
  - **No SQL Server reachable in this sandbox — none of this has been live-verified.** Before
    trusting it: create a new bill (confirm it lands in `draft_sale_bills`, stock reserved), edit
    it as a draft, Post it (confirm it lands in `sale_bills` with ledger entries, draft gone),
    Unpost it (confirm it's back in `draft_sale_bills` under a new id, ledger gone), delete a
    draft (password prompt, stock released), and run Post All across a few drafts.
  - **Pre-existing data migration**: if a real deployment already has unposted rows sitting in
    `sale_bills` from before this change, they will NOT automatically move to `draft_sale_bills` —
    this only governs new saves going forward. A one-time migration script would be needed to
    backfill any such rows if this ships against a database that already has some.
- **Files:** `backend/src/repositories/draftSaleBills.repository.js`,
  `backend/src/services/draftSaleBills.service.js`, `backend/src/services/saleBills.service.js`,
  `backend/src/ipc/draftSaleBills.ipc.js`, `backend/src/ipc/saleBills.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/SaleBillPage.tsx`
- **Live-verified by the user** after restarting the Electron app end-to-end (create → post →
  confirm — this was also the run that surfaced the `draft-sale-bills:confirmAll` "no handler"
  error, which turned out to be a stale running process, not a code bug; a full quit+restart of
  `npm start` fixed it since the main process needs to re-execute the new backend code).

## Draft/Real Table Architecture — Sale Return (rollout, module 2 of 6)

- Same "draft table until posted, real table only ever posted, unpost moves it back to draft"
  architecture as Sale Bill, applied to Sale Return.
- **Backend:**
  - `saleReturns.repository.js`: split the old combined `deleteLedgerAndStock` into
    `deleteLedgerEntries(transaction, returnId)` and `deleteReturn(transaction, returnId)` (kept
    the combined helper too, for backward compat with existing callers).
  - `draftSaleReturns.repository.js`: added `updateDraftHeader`, `deleteDraftItems` (against
    `dbo.draft_sale_return_items`).
  - `draftSaleReturns.service.js`: added `update(draftId, payload)` — stock reconciliation with
    signs flipped vs Sale Bill, since a return RESTORES stock rather than reserving it (so there's
    no oversell check needed: restoring stock can't drive it negative) — and `confirmAll(ids,
    userId)`.
  - `saleReturns.service.js`: added `unconfirm(id)`, mirroring `saleBills.service.js#unconfirm()`
    with signs flipped (releases a negative ADJUSTMENT on `SALE_RETURN`, restores a positive one
    on `DRAFT_SALE_RETURN`). Requires `draftSaleReturns.repository.js` directly, same
    circular-require avoidance as Sale Bill.
  - Confirmed Sale Return's `postLedgerAndStock` has no stock-availability check at that position
    (unlike Sale Bill's), so the deadlock bug fixed there does not apply here — no
    `pairsOnHandTx`-style fix was needed.
  - New IPC channels: `sale-returns:unconfirm`; `draft-sale-returns.ipc.js` rewritten with
    `create`/`list`/`get`/password-gated `remove`/`update`/`confirm`/`confirmAll`.
- **Frontend (`SaleReturnPage.tsx`):** same collapse-into-one-sidebar treatment as Sale Bill —
  `drafts` state now reads real `DraftSaleReturnRow[]`, `isEditingPostedReturn` flag branches
  `executeSave`, Post/Unpost/Delete rewired to the new draft-table-backed channels, "Post All" now
  calls the real `draftSaleReturns.confirmAll()` instead of a client-side sequential loop.
- Full project `npx tsc -b --force` confirmed clean after these changes.
- **Files:** `backend/src/repositories/saleReturns.repository.js`,
  `backend/src/repositories/draftSaleReturns.repository.js`,
  `backend/src/services/draftSaleReturns.service.js`, `backend/src/services/saleReturns.service.js`,
  `backend/src/ipc/draftSaleReturns.ipc.js`, `backend/src/ipc/saleReturns.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/SaleReturnPage.tsx`

## Draft/Real Table Architecture — Purchase (rollout, module 3 of 6)

- Same architecture applied to Purchase. Key simplification found here: a draft purchase has
  **zero stock effect** (nothing physically arrives before a purchase is recorded — the existing
  code already said so), and `purchases.service.js#update()` already unconditionally blocked
  editing a posted purchase in place (`POSTED_LOCK`) — so unlike Sale Bill/Return there's no
  `isEditingPosted` branching needed on the frontend: `mode === 'edit'` always means editing a
  draft now.
- **Backend:**
  - `purchases.repository.js`: added `deletePurchase(transaction, purchaseId)`.
  - `draftPurchases.repository.js`: added `updateDraftHeader`, `deleteDraftItems` (against
    `dbo.draft_purchase_items`).
  - `draftPurchases.service.js`: added `update(draftId, payload)` (simple — no stock
    reconciliation needed) and `confirmAll(ids, userId)`.
  - `purchases.service.js`: added `unconfirm(id)` — reverses via the existing
    `deleteLedgerAndStock` (removes both ledger entries and vendor_stock_movements in one call,
    since there's no reservation to hand off), rebuilds a draft from the purchase's own fields via
    `draftPurchasesRepository.insertDraft`/`insertDraftItems`, then deletes the real row. Requires
    `draftPurchasesRepository` directly, same circular-require avoidance as the other modules.
    Confirmed no deadlock risk (`purchases.service.js` has no `pairsOnHand` calls anywhere).
  - New IPC channel: `purchases:unconfirm`; `draftPurchases.ipc.js` rewritten with password-gated
    `remove`, new `update`, `confirmAll`.
  - All backend files syntax-checked clean via `node -c`.
- **Frontend (`PurchasePage.tsx`):** same collapse-into-one-sidebar treatment. `unpostedPurchases`
  now reads real `DraftPurchaseRow[]` via `draftPurchases.list()`; `handleSave` always uses
  `draftPurchases.create()`/`.update()`; `handlePost`/`handlePostAll` call
  `draftPurchases.confirm()`/`confirmAll()`; `handleUnpost` calls `purchases.unconfirm()`. Added
  `loadDraftIntoForm`, `handleOpenUnposted`, `handlePostOneUnposted`, and a password-gated delete
  flow (`handleDeleteUnposted` + `PasswordPromptModal`, mirroring the other modules' guard on
  deleting a saved-unposted document). The Pending Posting panel's row list is now interactive
  (click to open, inline Post/Delete icon buttons) and resolves the vendor name locally via
  `vendors.find(...)` since `DraftPurchaseRow` carries no `vendor_name` field.
- Full project `npx tsc -b --force` confirmed clean after these changes.
- **Files:** `backend/src/repositories/purchases.repository.js`,
  `backend/src/repositories/draftPurchases.repository.js`,
  `backend/src/services/draftPurchases.service.js`, `backend/src/services/purchases.service.js`,
  `backend/src/ipc/draftPurchases.ipc.js`, `backend/src/ipc/purchases.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/PurchasePage.tsx`
- **Not yet live-verified** — needs the same create→post→unpost→delete→Post-All run-through the
  user did for Sale Bill before trusting it.

## Draft/Real Table Architecture — Receipts & Expenses (rollout, modules 5 and 6)

Completes the rollout. The instruction was explicit: **relocate where an unposted row lives, change
no logic** — every cheque / online / endorsement / bounce / voucher rule behaves exactly as before.

- **Migration `024_draft_receipts_expenses_full_parity.sql`** — the draft tables were missing the
  columns needed to hold *any* unposted receipt/expense, which is the real reason these two modules
  had been created straight into the real table under a `status` column in the first place:
  - `draft_receipts.cheque_no / cheque_date / cheque_received_date` — a CHEQUE receipt could not be
    drafted before, because `cheques.receipt_id` is NOT NULL so the cheques row cannot exist until
    the receipt does. The draft now holds the cheque's details as plain columns and the real
    `dbo.cheques` row is still created at confirm time by the SAME
    `receipts.service#insertReceipt()` code as always — so the cheque is born PENDING at post time
    and every downstream deposit/endorse/bounce path sees precisely what it saw before.
  - `draft_receipts.voucher_id`, `draft_expenses.voucher_id` — receipts/expenses gained `voucher_id`
    in migration 022 but the draft tables did not, so a draft could not belong to the voucher it was
    entered on.
  - All added columns are nullable; nothing is dropped or rewritten, and no data migration runs.
- **Vouchers (RJ-03 / PN-01) — the significant structural piece.** A voucher's lines now live in two
  tables: posted ones in the real table, unposted ones in the draft table. `listLines()` UNIONs both
  halves into the single list the screen always rendered, so nothing upstream had to learn there are
  two tables:
  - `status` is *derived* from which side a row came from ('CONFIRMED' for real, 'DRAFT' for draft),
    so `deriveStatus()`'s UNPOSTED/PARTIAL/POSTED judgement is unchanged, as is the decision (from
    migration 022) not to store a voucher status at all.
  - each line carries exactly one of `receipt_id`/`draft_id` (resp. `expense_id`/`draft_id`), naming
    which table it is in and which id the per-line actions address.
  - the aggregate `list()` query now counts a UNION of both tables — counting only the posted half
    would report a fully-unposted voucher as having zero lines, which `deriveStatus` would then read
    as POSTED-of-zero rather than UNPOSTED.
  - voucher `post()` walks the draft lines through `draftX.confirm()`, `unpost()` walks the real
    lines through `X.unconfirm()`; the per-line-transaction isolation and the partial-success
    `{ posted, failed, attempted }` contract are untouched.
  - `update()` (header date) now syncs the draft half's line dates too; `remove()` deletes draft
    lines as well as real ones.
  - **Entry order is preserved across a post/unpost round-trip**: `confirm()`/`unconfirm()` carry
    `created_at` across, and `listLines` orders the two halves together by it. Without this a line
    would jump to the bottom of its voucher the moment it posted.
- **`receipts.service#unconfirm()` / `expenses.service#unconfirm()`** — the reverse of the matching
  `confirm()`. Every guard the existing `unpost()` applied still applies, unchanged and for the same
  reasons:
  - Receipts: a CHEQUE receipt whose cheque has moved past PENDING is still refused
    (`CHEQUE_IN_USE`). Because that guard *guarantees* the cheque is still PENDING (never deposited,
    endorsed or allocated), the cheques row can safely be dropped and its details carried back onto
    the draft — exactly what `remove()` already did for an unposted cheque receipt, and the precise
    reverse of what `confirm()` does on the way in.
  - Expenses: `CHEQUE_ENDORSED` is still refused outright (`USE_CHEQUE_REVERSAL` — its ledger effect
    belongs to a `cheque_allocations` row, and the only correct way to undo a disposition is the
    cheque's own bounce/return flow), and a `CHEQUE_ISSUED` cheque that already bounced/returned is
    still refused (`ISSUED_CHEQUE_TERMINAL`). **No endorsement logic was touched.**
  - `draftExpenses`' `pending_expense_id` stuck-confirm recovery is untouched, and the new
    `draftExpenses.update()` is blocked while it is set, for the same reason `remove()` already was.
- **Security guards moved with the create path.** UC-03 point 4 (`assertAccessible`) now also runs in
  `draftReceipts.create/update` and `draftExpenses.create/update`, because that is where a new
  receipt/expense is actually created now — leaving it only on the real table's `create()` would
  have silently dropped the check. `draft-receipts:remove` / `draft-expenses:remove` also gained the
  password guard that `receipts:remove` / `expenses:remove` already had, since they now hold every
  unposted document rather than a throwaway scratch entry.
- **Frontend (`ReceiptsPage.tsx`, `ExpensesPage.tsx`):**
  - voucher lines are saved via `draftX.create/update`; a new `entryIsDraft` flag says which id
    space the entry row's id is in.
  - the "Recorded Receipts"/"Recorded Expenses" tables were already unposted-only, and unposted rows
    now live in the draft tables — so they read `drafts` instead of filtering the real list (which,
    by the new invariant, would always filter down to empty). Clicking a row opens it for editing in
    place, and opens the voucher it belongs to, exactly as before.
  - the old "Saved Drafts / N incomplete cached" banner is now "Pending Posting / N unposted"; a
    loaded draft is edited **in place** rather than copied into a real row and the original deleted,
    so the duplicate-then-delete dance is gone.
  - `loadReceiptRow`/`loadExpenseRow` were removed as unreachable — their only caller was the
    unposted-only records list, which now goes through `loadDraft`.
- Full project `npx tsc -b --force` clean; all touched backend files pass `node -c` and the whole
  service graph loads without circular-require breakage.
- **Files:** `backend/src/db/migrations/024_draft_receipts_expenses_full_parity.sql`,
  `backend/src/repositories/{draftReceipts,receipts,receiptVouchers,draftExpenses,expenses,expenseVouchers}.repository.js`,
  `backend/src/services/{receipts,draftReceipts,receiptVouchers,expenses,draftExpenses,expenseVouchers}.service.js`,
  `backend/src/ipc/{receipts,draftReceipts,receiptVouchers,expenses,draftExpenses}.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/{ReceiptsPage,ExpensesPage}.tsx`
- **Run `npm run migrate` before starting the app** — migration 024 must be applied or every
  receipt/expense write will fail on the missing columns.
- **Live-verified against the real SQL Server** (`npm run migrate` applied 024 cleanly), with a
  23-case integration script exercising every module's full draft→post→unpost round-trip directly
  through the service layer. All 23 passed, including the priority checks:
  - Sale Bill / Sale Return / Purchase / Purchase Return: draft → confirm → unconfirm → confirmAll →
    unconfirm → delete, with direct SQL assertions that the real table has zero rows for a
    not-yet-posted id and the draft row is gone the instant it's posted.
  - Receipt CASH / ONLINE: full round-trip. Receipt CHEQUE: draft → confirm creates the cheques row
    PENDING → unconfirm while PENDING moves it cleanly back to draft with cheque_no/cheque_date
    intact → re-confirm → deposit → confirm unconfirm is refused (CHEQUE_IN_USE) → bounce it →
    confirm unconfirm is STILL refused (extends correctly to a terminal BOUNCED status, not just
    "disposed of somehow").
  - Expense CASH, CHEQUE_ISSUED (round-trip while PENDING), CHEQUE_ISSUED-then-bounced (unconfirm
    refused with ISSUED_CHEQUE_TERMINAL), CHEQUE_ENDORSED (unconfirm always refused with
    USE_CHEQUE_REVERSAL, confirming no endorsement logic changed).
  - Receipt Voucher and Expense Voucher: create a voucher, add two draft lines, confirm entry order
    is preserved, Post All, confirm both lines are CONFIRMED and STILL in original entry order
    (created_at carried across confirm), Unpost All, confirm both are back to DRAFT in the same
    order, delete the voucher.
  - All test rows (and the deliberately-left posted/bounced ones used to prove a guard) were
    cleaned up afterward via direct SQL in dependency order; a final sweep confirmed zero residue.
- **Pre-existing rows:** any receipt/expense already sitting in the real table with `status='DRAFT'`
  from before this change stays there — it is not migrated into the draft tables. Such a row will no
  longer appear in this screen's unposted list (which now reads the draft tables). The voucher grid
  still renders it, and the `line.draft_id == null` branches in the delete/edit paths were kept
  deliberately so it stays actionable. A one-time backfill script would be needed to move them.

## Draft/Real Table Architecture — rollout stopped at 4 modules (SUPERSEDED)

> Superseded by the section above — the user subsequently asked for Receipts and Expenses to be done
> too, with the constraint that no logic change. Kept for the reasoning it records.


- Investigated Receipts next and found it's not a blank slate like the first 4: it already has its
  own draft-table split (`draft_receipts` + `draftReceipts.service.js#confirm()`, built in an
  earlier session), but only for CASH/ONLINE — CHEQUE-mode receipts deliberately stay in the real
  `receipts` table under a `status='DRAFT'` column, since `draft_receipts` has no
  `cheque_no`/`cheque_date` columns to hold a draft cheque. Receipts also carries RJ-03
  voucher/settlement/endorsement logic layered on top of `status`, which none of the first 4
  modules had to account for. Expenses almost certainly mirrors this same shape
  (`draftExpenses.service.js` exists too, not yet inspected in detail).
  - Presented this to the user with three options (extend architecture to Receipts/Expenses same
    as the first 4, extend CASH/ONLINE-only via an `unconfirm`, or a full redesign covering
    CHEQUE/vouchers/settlements too) — user chose to **stop the rollout at 4 modules** and leave
    Receipts/Expenses on their existing DRAFT/CONFIRMED status design, since it already
    distinguishes posted from unposted (just via a column instead of a separate table) and
    touching the voucher/settlement/endorsement code paths carries materially more risk than the
    first 4 modules did.
- **Rollout scope as it now stands, final:** Sale Bill, Sale Return, Purchase, Purchase Return —
  all 4 on the full draft-table architecture (draft table until posted, real table strictly only
  posted, unpost moves the row back to draft). Receipts/Expenses intentionally excluded per the
  above.

## Draft/Real Table Architecture — Purchase Return (rollout, module 4 of 6)

- Same architecture as Purchase, applied to Purchase Return — the two modules already mirrored
  each other closely (draft purchase returns also have zero stock effect, and
  `purchaseReturns.service.js#update()` already unconditionally blocked editing a posted return in
  place), so no new design decisions were needed here.
- **Backend:**
  - `purchaseReturns.repository.js`: added `deleteReturn(transaction, returnId)`.
  - `draftPurchaseReturns.repository.js`: added `updateDraftHeader`, `deleteDraftItems` (against
    `dbo.draft_purchase_return_items`).
  - `draftPurchaseReturns.service.js`: added `update(draftId, payload)` (no stock reconciliation)
    and `confirmAll(ids, userId)`.
  - `purchaseReturns.service.js`: added `unconfirm(id)` — reverses via `deleteLedgerAndStock`,
    rebuilds a draft via `draftPurchaseReturnsRepository.insertDraft`/`insertDraftItems`, then
    deletes the real row via the new `deleteReturn`. Requires `draftPurchaseReturnsRepository`
    directly, same circular-require avoidance as the other modules.
  - New IPC channel: `purchase-returns:unconfirm`; `draftPurchaseReturns.ipc.js` rewritten with
    password-gated `remove`, new `update`, `confirmAll`.
  - All backend files syntax-checked clean via `node -c`.
- **Frontend (`PurchaseReturnPage.tsx`):** added the same Pending Posting panel as PurchasePage
  (this page previously had none at all — every return saved straight to the real table with no
  batching UI). `handleSave`/`handlePost`/`handleUnpost` rewired to the draft-table-backed
  channels; added `loadDraftIntoForm`, `handleOpenUnposted`, `handlePostOneUnposted`,
  `handlePostAll`, and a password-gated `handleDeleteUnposted` + `PasswordPromptModal`, all
  mirroring PurchasePage.tsx. The page's existing PR-01 features (copy-from-prior-purchase,
  last-purchased-rate lookup on blur) were preserved unchanged.
- Full project `npx tsc -b --force` confirmed clean after these changes.
- **Files:** `backend/src/repositories/purchaseReturns.repository.js`,
  `backend/src/repositories/draftPurchaseReturns.repository.js`,
  `backend/src/services/draftPurchaseReturns.service.js`,
  `backend/src/services/purchaseReturns.service.js`,
  `backend/src/ipc/draftPurchaseReturns.ipc.js`, `backend/src/ipc/purchaseReturns.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/PurchaseReturnPage.tsx`
- **Not yet live-verified** — needs the same create→post→unpost→delete→Post-All run-through the
  user did for Sale Bill before trusting it.
## Journal Voucher — full multi-line double-entry rebuild
- **User request:** the client's legacy "Journal Entry" screen reference pictures (`ref-pics/batch2/
  journal voucher.jpeg`, `jv2.0.jpeg`) confirmed it was never the simplified 2-leg tool the earlier
  entry above scoped down to — `jv2.0.jpeg` shows a live example with two different accounts each
  carrying their own debit/credit (`FINE SHOES - SADIQ ABAD` credited 5,300, `DISCOUNTS, CLAIMS, &
  COMMISSIONS` debited 5,300, Net Total 0). User explicitly chose the full rebuild this time: a real
  multi-line double-entry journal, no fixed counter-account, plan approved before coding per this
  file's workflow rule. Toolbar/visual design stays consistent with the rest of the app (no legacy
  icon/color replication) — user's explicit call. Per-line optional Narration added (distinct from
  the header's single Reason) — also user's explicit call this round, not a reversal of the earlier
  Remarks-removal decision above (that was header-level; this is per-line).
- **Migration `024_journal_voucher_lines.sql`:** new `dbo.journal_voucher_lines` (line_id, jv_id FK
  CASCADE, line_no, ba_id, debit, credit, narration), constraints mirroring `ledger_entries`
  (single-sided per line, non-negative, non-zero). Backfills every existing `journal_vouchers` row
  into two lines (the party leg + the old fixed JOURNAL VOUCHER account leg) before dropping the
  now-superseded `ba_id`/`direction`/`amount` header columns and their constraints — no historical
  data silently dropped. Guarded with an `IF NOT EXISTS`/`RAISERROR` on the reserved JOURNAL VOUCHER
  business account before the second backfill INSERT, so a missing seed fails loudly instead of
  silently backfilling an unbalanced single-leg row.
- **New `journalVouchers.math.js`** (mirrors `purchaseMath.js`): `buildLines`/`validateBalance`
  (≥2 lines, `SUM(debit) === SUM(credit)` compared in paisa to avoid float drift)/`buildTotals`.
- **`journalVouchers.repository.js`** rewritten: header CRUD no longer touches
  `ba_id/direction/amount`; added `insertLines`/`getLines`/`deleteLines` (update = delete-all-then-
  reinsert, same as `purchase_items`); `insertLedgerEntries` now loops one `ledger_entries` row per
  line instead of a fixed 2-row pair; `list()`/`findById()` roll up `line_count`/`total_debit`/
  `total_credit` per voucher via `CROSS APPLY` (always exactly one row per header, so it can't drop
  a voucher with zero lines — not reachable anyway since create/update always insert header+lines
  in one transaction). Removed `getJvAccount()`.
- **`journalVouchers.service.js`** rewritten: `resolveLines()` validates + checks
  `businessAccountsService.getById`/`assertAccessible` per line (not just one account); `post()`
  re-validates balance defensively before writing ledger entries; `create`/`update`/`post`/`unpost`
  all `withTransaction`. Removed the fixed-counter-account lookup entirely.
- **`journalVouchers.ipc.js`:** removed the `account` channel (no more fixed counter-account to
  look up for a "JV Ledger" screen).
- **`reports.repository.js`:** `customerReportRows`/`vendorReportRows`'s JV subqueries rewritten
  from `SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END)` grouped by
  `journal_vouchers.ba_id` to `SUM(jvl.credit - jvl.debit)` grouped by `journal_voucher_lines.ba_id`,
  joined back to `journal_vouchers` (aliased `h`) for the existing date/status `jvWhere` filter —
  same "what does this party's JVs net to" semantics, now correct across N lines instead of 1.
- **`frontend/src/lib/api.ts`:** `JournalVoucherRow`/`JournalVoucherCreateInput` replaced with
  `lines: JournalVoucherLineInput[]` (`ba_id, debit, credit, narration?`) instead of flat
  `ba_id/direction/amount`; `JournalVoucherRow.lines` is optional since `list()` only returns
  rolled-up totals, not per-line detail — `get()` is what carries the full lines array. Removed the
  `account()` wrapper.
- **`JournalVoucherPage.tsx`** rebuilt: dropped the Direction toggle, single `SearchableSelect`
  account field, and `AccountBalancePanel` single-account preview; added a line-items grid (account
  `SearchableSelect` + Debit + Credit + Narration per row, typing into one of Debit/Credit clears
  the other — single-sided per line, matching `ledger_entries`), a `+ Add Line` button, a per-row
  remove button (floor of 2 lines), and a Net Total footer (Total Debit/Total Credit/Difference,
  with an inline "out of balance by X" warning). Save is disabled until ≥2 lines, every line has an
  account and exactly one of debit/credit > 0, and totals balance to zero — mirrors the
  service-side rule. Removed the JV Ledger sub-tab entirely: it only ever showed the fixed JOURNAL
  VOUCHER account's ledger, which no longer exists as a forced counter-party — each line's ledger
  effect is visible on its own real account via the existing account Ledger screen. "Recorded
  Journal Vouchers" columns changed from Account/Direction/Amount (single-valued, no longer
  possible) to Lines (count) / Total. Row click now fetches the full voucher via `get()` to hydrate
  `lines`, since the listing query only carries rolled-up totals.
- **Debugger review pass:** ran a full read-through of every changed/new file plus a cross-codebase
  grep for lingering references to the old single-line shape — no functional bugs found. Two
  non-blocking hardening items were still worth doing and are folded into the changes above: the
  migration's `IF NOT EXISTS` guard, and a `?? 0` defensive fallback on `formatCurrency(v.total_debit)`
  in the listing table (unreachable today since a voucher always has ≥2 lines by the time it's
  listed, but cheap to guard).
- **Not yet live-verified** — no SQL Server reachable in this sandbox; `npm run migrate` on a real
  DB is needed to confirm the backfill and the new table land correctly, and the app needs a manual
  create → save-blocked-when-unbalanced → post → unpost → edit-lines pass.
- **Files:** `backend/src/db/migrations/024_journal_voucher_lines.sql` (new),
  `backend/src/services/journalVouchers.math.js` (new),
  `backend/src/repositories/journalVouchers.repository.js`,
  `backend/src/services/journalVouchers.service.js`, `backend/src/ipc/journalVouchers.ipc.js`,
  `backend/src/repositories/reports.repository.js`, `backend/src/services/businessAccounts.service.js`
  (comment only), `frontend/src/lib/api.ts`, `frontend/src/pages/JournalVoucherPage.tsx`

## Journal Voucher — compact single-screen layout (follow-up to the multi-line rebuild above)
- **User request:** the multi-line rebuild above matched the legacy grid's column layout, but not
  the broader compact-page redesign already applied to `PurchasePage.tsx`/`SaleBillPage.tsx` — a
  single-screen density (no scrolling the whole page to reach the line-item grid or the toolbar).
  User pointed this out directly after reviewing the first pass.
- Copied the exact pattern from `PurchasePage.tsx` (that page was read directly since its compact
  redesign was still uncommitted in the working tree, not yet on `origin/main` that this worktree
  branched from):
  - Toolbar (New/Save/Cancel Edit/Edit/Post/Unpost) is now a standalone compact row above the
    card — every button always renders, only `disabled` toggles per `mode`/`isPosted`/`isValid`,
    instead of whole groups mounting/unmounting.
  - The entry `<form>` IS the card, height pinned to `window.innerHeight - top - 32` (recomputed
    on resize and whenever the banners above it change), laid out `flex flex-col` so the
    line-items table (`flex-1 min-h-0 overflow-y-auto`, sticky `<thead>`) grows into whatever
    space is left — the outer app window never scrolls, only the grid does.
  - "Recorded Journal Vouchers" moved out of the entry page's inline flow into its own tab
    (`activeTab: 'entry' | 'records'`, same tab bar shape as Purchase/SaleBill's `headerAction`
    slot) instead of always rendering below the live entry form.
  - Dropped the descriptive `<p>` paragraph under the card header — the compact pattern doesn't
    carry one on Purchase/SaleBill either.
- `react-hooks/set-state-in-effect` fires on the accounts-load effect (`refresh()` called inside
  a mount `useEffect`) — pre-existing pattern, confirmed by running the same lint rule against
  `SaleBillPage.tsx`, which trips the identical warning. Not a regression, left as-is for
  consistency with the rest of the app.
- **Files:** `frontend/src/pages/JournalVoucherPage.tsx`

## Journal Voucher — pending-posting batch feature + JV Ledger search by any detail
- **User feedback after reviewing the compact layout:** (1) JV was missing the "enter a run of
  records first, post them all in one action" feature every other document type has (P-03 on
  Purchase, SB-06 on Sale Bill) — pointed out directly, not something this rebuild had considered.
  (2) The listing tab (renamed **JV Ledger** to match the actual feature name the user meant, not
  "Recorded Journal Vouchers") needs to find a JV "from any detail" — previously only matched
  `reason`/`voucher_no`.
- **`journalVouchers.repository.js`:** `list()`'s `search` filter now matches the header
  (`reason`/`voucher_no`) OR `EXISTS` against any line — joined `business_accounts` for
  name/code, plus per-line `narration`/`debit`/`credit` (cast to text for a `LIKE` match) — so a
  search box finds a JV regardless of which field the term actually landed in. New
  `listUnposted()`: every JV still `status = 'DRAFT'`, oldest first — reads straight off the
  status column (unlike `purchases.repository.js`'s version, which derives "unposted" from
  `ledger_entries` not existing, since purchases dropped their own status column and JV didn't).
- **`journalVouchers.service.js`:** new `listUnposted()` (passthrough) and `postAll(ids, userId,
  session)` — mirrors `purchases.service.js#postAll` exactly: each JV posts in its own
  transaction via the existing `post()`, so one failure never rolls back the ones that already
  posted; `ALREADY_POSTED` is swallowed as "met the user's intent," not reported as a failure.
- **`journalVouchers.ipc.js`:** added `journal-vouchers:listUnposted`/`journal-vouchers:postAll`
  channels, same shape as `purchases:listUnposted`/`purchases:postAll`.
- **Frontend:** `lib/api.ts` gained `UnpostedJournalVoucherRow`, `JournalVoucherListFilters.search`,
  and `journalVouchers.listUnposted()`/`postAll()`. `JournalVoucherPage.tsx` gained the same
  "Pending Posting" `<aside>` sidebar (2xl+ only, pinned outside the card's left edge) with a
  Post All button and a dismissible per-run result summary, copied from `PurchasePage.tsx`'s
  exact markup. The JV Ledger tab's search input is now debounced (250ms) and sent to the backend
  as `filters.search` instead of filtering the already-fetched page client-side — needed since the
  new search reaches into per-line data the listing query doesn't otherwise fetch to the client.
- **Files:** `backend/src/repositories/journalVouchers.repository.js`,
  `backend/src/services/journalVouchers.service.js`, `backend/src/ipc/journalVouchers.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/JournalVoucherPage.tsx`

## Journal Voucher — password-gated delete for unposted JVs, brought to parity with the rest of the site
- **User request:** every other transaction page (Sale Bill, Sale Return, Purchase, Purchase
  Return) has a password-gated Delete button on its Pending Posting sidebar for an unposted
  document — Journal Voucher never got one when its own sidebar was added (previous entry above),
  and its `remove()` channel had no password guard at all (unlike every other module's
  `X:remove`).
- **`journalVouchers.ipc.js`:** `journal-vouchers:remove` now calls
  `authService.verifyPassword(session.userId, payload.password)` before `service.remove()` — same
  guard shape as `sale-bills:remove`/`purchases:remove`/etc. `service.remove()` itself already
  correctly blocked deleting a posted JV (`POSTED_LOCK`), so no service-layer change was needed.
- **Frontend:** `lib/api.ts`'s `journalVouchers.remove` gained a required `password` parameter.
  `JournalVoucherPage.tsx`'s Pending Posting sidebar rows were previously inert (no click handler,
  no per-row actions at all) — brought up to the same interactive pattern `PurchasePage.tsx` uses:
  clicking a row now opens it into the form (`handleOpenUnposted`), plus inline Post
  (`handlePostOneUnposted`, mirrors `handlePostOneUnposted` on Purchase) and password-gated Delete
  (`handleDeleteUnposted` + `PasswordPromptModal`) icon buttons per row.
- Full project `npx tsc -b --force` and `node -c` on the touched backend file both pass clean.
- **Files:** `backend/src/ipc/journalVouchers.ipc.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/JournalVoucherPage.tsx`

## Settings — Danger Zone: admin-only "Reset Database" (new capability, not in the original milestone scope)
- **User request (2026-08-26):** a critical, admin-only settings action that wipes both the main
  database and its backup, resetting every primary key back to 1, gated by asking for the admin's
  password twice before running.
- **Approach — drop & recreate, not per-table TRUNCATE:** with ~40 FK-linked tables, TRUNCATE in
  dependency order plus `DBCC CHECKIDENT RESEED` per table would be fragile and easy to get wrong
  as the schema grows. `DROP DATABASE` + re-running `migrate.js`'s own schema/migration apply +
  `seeds/run.js`'s own seed is what the app already does on a truly fresh install, so reusing it
  guarantees every `IDENTITY(1,1)` restarts at 1 and the result matches "a fresh install" exactly,
  by construction rather than by hand-maintained per-table logic.
- **`db/pool.js`:** added `closePool()` — closes and forgets the app's own singleton pool so the
  next `getPool()` call reconnects fresh; needed before `DROP DATABASE` can get exclusive access
  (an open pooled connection would otherwise block `ALTER DATABASE ... SET SINGLE_USER`).
- **`services/systemReset.service.js`** (new, no repository file — this is server-admin DDL, same
  shape as `backup.service.js`, not app-table CRUD): `resetDatabase(userId, password)` — (1)
  re-verifies the password via `authService.verifyPassword` (the ipc layer already required an
  ADMIN session; this is the destructive action's own explicit "prove it's you" gate), (2)
  `closePool()`, (3) connects to `master` and drops the backup-mirror DB then the main DB (each
  wrapped in `SET SINGLE_USER WITH ROLLBACK IMMEDIATE` first, exactly like `backup.service.js`
  already does to the mirror before a `RESTORE`), (4) best-effort deletes the mirror's leftover
  `.mdf`/`.ldf` files and, if an external backup folder is configured, its `.bak` +
  `RESTORE-INSTRUCTIONS.txt` (SQL Server doesn't delete physical files on `DROP DATABASE`), (5)
  calls `migrate()` then `seed()` (both already exported as reusable functions, not just CLI
  scripts) to rebuild the main database from scratch — admin/user logins, reserved chart accounts,
  default store, etc., (6) if a backup folder is configured, calls `backupService.sync()` to
  recreate the mirror database and take a first (now-empty) backup at the same configured path —
  "remounted at the same path," mirroring what `ensureInitialBackup()` already does on a fresh
  install's first startup.
- **`ipc/systemReset.ipc.js`** (new) + registered in `ipc/index.js`: single channel
  `system-reset:run`, `requireRole('ADMIN')` then `service.resetDatabase(...)`, then
  `session.logout()` — the session's own user row no longer exists post-wipe (fresh `IDENTITY`
  rows), so the session is force-cleared rather than left stale.
- **Frontend:** `lib/ipcBridge.ts`'s `FEATURES` gained `'systemReset'`; `lib/api.ts` gained the
  `window.api.systemReset` declare-global block and a `resetDatabase(password)` export, next to
  the existing `verifyPassword()` helper it reuses for the first of the two prompts.
  `SettingsPage.tsx` gained a new admin-only "Danger Zone" tab (`SettingsTab` extended with
  `'danger'`): a red-bordered card explaining the action, whose button opens a two-step modal flow
  — step 1 re-enters the password (checked via the existing `auth:verifyPassword`), step 2
  re-enters it again as final confirmation and calls `resetDatabase()`; on success a brief "Reset
  Complete" modal shows before `dispatch({ type: 'LOGOUT' })` returns to the login screen.
- Full project `npx tsc -b` and `npm run build` both pass clean; `node -c` on every touched
  backend file passes clean.
- **Files:** `backend/src/db/pool.js`, `backend/src/services/systemReset.service.js` (new),
  `backend/src/ipc/systemReset.ipc.js` (new), `backend/src/ipc/index.js`,
  `frontend/src/lib/ipcBridge.ts`, `frontend/src/lib/api.ts`, `frontend/src/pages/SettingsPage.tsx`

## Multi-window support — open any page in a separate, independently-usable window
- **User request:** clicking a nav item currently navigates the *same* window; the ask was to open
  pages in a second (or third...) OS window so more than one page can be open and usable at once.
  Assessed first (effort estimate, no code) — the user then asked to go ahead, with a reminder that
  live cross-window sync is an explicitly deferred follow-up, not part of this change.
- **Why this was tractable:** each Electron `BrowserWindow` is its own renderer process — a second
  window loading the same bundle gets its own independent `AppProvider`/reducer for free, no
  routing library needed. And `session.js` already holds login as one value shared by the *whole*
  process (not per-window), so a second window doesn't need its own login.
- **`backend/electron/windowManager.js`** (new): `createAppWindow(page, tab)` — the exact
  dev/packaged/unpackaged-prod `BrowserWindow`/`loadURL`/`loadFile` logic `main.js`'s old
  `createWindow()` had, now parameterized and shared so opening an *additional* window uses
  identical logic to the first. `page`/`tab` become a `?page=&tab=` query string (`loadFile`'s own
  `query` option for the packaged/unpackaged-prod cases; hand-built via `URL`/`searchParams` for
  the dev-server case, since `loadFile`'s `query` option doesn't apply to `loadURL`).
- **`backend/electron/main.js`**: `createWindow()` now just calls `createAppWindow()` — the
  `BrowserWindow` construction/loading logic itself moved to `windowManager.js`. `path` import
  dropped (no longer used here).
- **New `backend/src/ipc/windows.ipc.js`** + registered in `src/ipc/index.js`: `windows:open`
  (`requireSession()` first — only an already-logged-in operator can spawn more windows) calls
  `createAppWindow(payload.page, payload.tab)`.
- **`backend/src/ipc/auth.ipc.js`**: new `auth:currentSession` — no `requireSession()` guard
  (mirrors `zoom:set`'s reasoning: this is exactly how something with no session yet finds out
  there ISN'T one) — returns `session.current()` (`null` is a normal answer, not a failure).
- **Frontend `lib/api.ts`**: `currentSession()` (mirrors `login()`'s role-mapping) and
  `openWindow(page, tab?)`. New `windows` feature added to `ipcBridge.ts`'s `FEATURES` array —
  missing that step (per this file's own layered-architecture note) would have made
  `window.api.windows` `undefined` and failed with an opaque TypeError on first call.
- **`AppContext.tsx`**: new `RESTORE_SESSION` action + reducer case (same shape as
  `LOGIN_SUCCESS` but lands on `action.payload.page`/`.tab` instead of always Home) and a
  mount-once effect in `AppProvider` that reads `?page=`/`&tab=` off `window.location.search`,
  calls `currentSession()`, and dispatches `RESTORE_SESSION` if one exists — skipping straight
  past the freshly-opened window's own Login screen. A window with no existing session (the
  normal first-ever launch) falls through to Login exactly as before; nothing changed there.
- **UI triggers** — two, both discoverable without needing to be told about the other:
  - Ctrl/Cmd+Click a Quick Menu shortcut or a `MenuBar` dropdown item opens it in a new window
    instead of navigating in place (same convention as a browser tab). `MenuBar.tsx` gained a new
    `onOpenWindow` prop alongside its existing `onNavigate`, wired from `AppLayout.tsx`.
  - A small `ExternalLink` icon, hover-revealed (`group`/`group-hover:opacity-100`) on each Quick
    Menu shortcut chip in `AppLayout.tsx`, for anyone who wouldn't think to Ctrl/Cmd+Click.
- **Explicitly deferred, per the user:** live sync across windows. Two windows are two independent
  copies of app state — posting something in one won't auto-refresh an already-open list in the
  other. No push/broadcast mechanism (`ipcRenderer` events main → all renderers) exists yet; this
  is flagged as a known follow-up, not solved here.
- `npx tsc -b` and `npm run lint` (frontend) both pass on every touched file — the only lint hits
  are pre-existing `react-refresh/only-export-components` errors already present in
  `AppContext.tsx` before this change (confirmed via `git stash`), unrelated to this work.
  `node --check` passes on every touched/new backend file (`main.js`'s own `app`/`BrowserWindow`
  top-level calls make it unrunnable outside a real Electron process, same as before this change —
  not a regression).
- **Not yet live-verified** — no way to launch the actual Electron app from this sandbox; needs a
  manual pass: Ctrl+Click a shortcut/menu item (or its new external-link icon) and confirm a second
  window opens already logged in, landing on the right page, with the first window still usable.
- **Files:** `backend/electron/windowManager.js` (new), `backend/electron/main.js`,
  `backend/src/ipc/windows.ipc.js` (new), `backend/src/ipc/index.js`, `backend/src/ipc/auth.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/lib/ipcBridge.ts`, `frontend/src/context/AppContext.tsx`,
  `frontend/src/components/AppLayout.tsx`, `frontend/src/components/MenuBar.tsx`

## Multi-window support — corrected to a lightweight child window (follow-up)
- **User correction:** the first pass opened a second window with the FULL app shell (header,
  MenuBar, Quick Menu bar) just landed on a different page — not what was wanted. The ask was a
  window showing ONLY that page's own content, matching the legacy app's per-document floating
  windows (`ref-pics/batch2` — "JOURNAL ENTRY" as its own small window with just its own toolbar
  and fields, no main app nav repeated inside it).
- **`windowManager.js`**: `createAppWindow(page, tab, { child })` — `child: true` (only ever passed
  by `windows:open`, never the app's own first/main window) adds `child=1` to the query string and
  sizes the window smaller (1000×720 vs 1280×800) by default, still freely resizable.
- **`windows.ipc.js`**: now calls `createAppWindow(page, tab, { child: true })`.
- **`AppLayout.tsx`**: new module-level `IS_CHILD_WINDOW` (`?child=1` in `location.search`, read
  once — safe since this app has no client-side routing, so a window's own URL never changes
  after creation). When set, the header/`<MenuBar>`/Quick Menu bar block is skipped entirely; a
  much thinner strip (just `pageTitle` + the page's own `headerAction`, e.g. Journal Voucher's
  "New Journal Voucher"/"JV Ledger" switcher) replaces it — that switcher is the page's OWN
  content, not app-wide chrome, so it still needs to work in a child window even with everything
  else gone. `<main>{children}</main>` renders unconditionally either way.
- `npx tsc -b` and `npm run lint` (frontend) both pass clean on `AppLayout.tsx`; `node --check`
  passes on the touched backend files.
- **Not yet live-verified**, same caveat as above — needs a real Electron launch to confirm a
  child window actually renders just the page (no header/nav) and its own tab switcher still works.
- **Files:** `backend/electron/windowManager.js`, `backend/src/ipc/windows.ipc.js`,
  `frontend/src/components/AppLayout.tsx`

## Multi-window support — every bar/menu item opens a window directly (2nd follow-up)
- **User request:** widen scope to every report (`3.ACCOUNT REPORTS`/`4.STOCK REPORTS`/
  `5.SALE REPORTS` — same `{ page: 'reports', tab }` shape every other menu item already uses, so
  this needed no new code, just the click behavior change below to apply to them too) and drop the
  Ctrl/Cmd+Click requirement entirely — a plain click on ANY Quick Menu shortcut or MenuBar item
  should open its new (child) window directly, no modifier key, no separate button.
- **`AppLayout.tsx`**: Quick Menu shortcut chips' `onClick` now calls `api.openWindow(s.page,
  s.tab)` unconditionally — the Ctrl/Cmd-key branch and the separate hover-revealed `ExternalLink`
  icon button (both from the previous pass) are gone; a plain click IS "open in new window" now,
  so neither was still needed. Import of `ExternalLink` removed (now unused).
- **`MenuBar.tsx`**: same simplification — `onNavigate` prop removed entirely (nothing calls it
  anymore, only `onOpenWindow` remains) and the item `onClick` unconditionally calls
  `onOpenWindow(item.page, item.tab)`. `title` copy updated to say "Opens in a new window" instead
  of describing a modifier-key shortcut that no longer exists.
- **`AppLayout.tsx`**'s `<MenuBar>` call site: dropped the now-removed `onNavigate` prop.
- The in-place `navigate()` function itself is untouched and still used by the header's Home
  button — this change only affects the two "launch a document" surfaces (Quick Menu, MenuBar),
  not all navigation in the app.
- `npx tsc -b` and `npm run lint` both pass clean on both touched files.
- **Not yet live-verified**, same caveat as the two entries above.
- **Files:** `frontend/src/components/AppLayout.tsx`, `frontend/src/components/MenuBar.tsx`

## Wage Run — Stage keyboard nav fix + Article converted to SearchModal
- **User report:** after picking a Worker by keyboard, the Stage picker's Enter/Arrow keys did
  nothing once it was open, and its highlight color was too light to see. Also asked for Article
  to use "a modal popup instead of dropdown like in rest of the app."
- **Root cause (Stage):** the Stage picker was a bespoke `createPortal` dropdown with NO keyboard
  handling at all on its option buttons or the panel itself — only mouse clicks worked. Its own
  outside-click listener, position-tracking state, and portal panel are all removed; replaced with
  `SearchModal` (`@/components/SearchModal`), the same component already used for Vendor/Customer/
  Article pickers elsewhere (`SaleBillPage.tsx`, `PurchasePage.tsx`, etc.) — it already handles
  Up/Down/Enter/Escape correctly and already had its own highlight-color fix (see its own comment:
  "darkened from a barely-visible pale cream — flagged directly by the user"). Removed
  `isStageOpen`/`stagePos`/`stagePanelRef`/`openStageDropdown`/the mousedown-listener effect;
  `stageRef` kept (still used to focus the trigger after picking a Worker). `createPortal` (react-
  dom) and the `Check` icon are no longer used anywhere in the file — both imports dropped.
- **Article**: same conversion — the per-row `SearchableSelect` dropdown replaced with a plain
  trigger button (`data-field-nav="true"`, so it stays in the same Enter/Tab field-walk
  `SearchableSelect`'s own trigger participated in) + a `SearchModal` per row, gated by one shared
  `openArticleModalKey` (only one row's modal can be open at a time). `pickProduct`/`focusArticle`
  needed no changes — the container ref and `button[data-field-nav]` lookup `focusArticle` already
  used still resolve to the new trigger button.
- Worker's own field (`SearchableSelect`) was untouched — the user's report was specifically about
  Stage, not Worker, and `SearchableSelect` already has working keyboard nav.
- `npx tsc -b` and `npm run lint` pass clean; the 3 remaining lint hits (`set-state-in-effect` ×2,
  a `useMemo` exhaustive-deps warning) are pre-existing, confirmed via `git diff` — none touch
  lines this change added.
- **Not yet live-verified** — needs a real run-through: pick a Worker, Tab/Enter into Stage, use
  Arrow keys + Enter to pick one (confirm the highlight is now clearly visible), then open an
  Article's modal the same way and confirm it also selects correctly and returns focus to Rate.
- **Files:** `frontend/src/pages/WageRunPage.tsx`

## Wage Run — Worker also converted to SearchModal + compact single-screen layout
- **User request:** convert Worker (still a `SearchableSelect` dropdown) to the same `SearchModal`
  popup as Stage/Article, and make the page's overall layout compact like the rest of the app.
- **Worker → SearchModal**: same conversion pattern as Stage/Article — a plain trigger button
  (`data-field-nav="true"`, so the Date field's existing Enter-key handler — which looks up
  `button[data-field-nav]` inside `workerContainerRef` — still finds it) + a `SearchModal`. Picking
  a worker still resets Stage/Items and focuses the Stage trigger, same as before.
  `SearchableSelect` import removed — no longer used anywhere in this file.
- **Compact layout**: this page still had the OLDER shape (three separate `card-white` sections —
  Header/Lines/Balance — stacked, whole page scrolling) that Purchase/SaleBill/JournalVoucherPage
  were already converted away from. Merged all three into ONE `<form>` that IS the entry card,
  height pinned to the remaining viewport space (`entryCardRef`/`entryCardHeight`, identical
  measurement effect to those three pages), laid out `flex flex-col`: header fields and the
  Articles-header row stay `shrink-0`, the Articles table becomes `flex-1 min-h-0 overflow-y-auto`
  with a sticky `<thead>`, and the Balance block (still conditional on `employeeId`) sits below it
  as a `shrink-0 border-t` footer section inside the same card instead of its own separate card.
  The outer app window no longer scrolls past three cards — only the Articles table scrolls
  internally, exactly like the three already-converted pages.
- The `entryCardHeight` effect had to be placed AFTER `errorMsg`/`successMsg` are declared (both
  are in its dependency array) — an earlier draft placed it right after `switchTab`, before those
  `const`s, which would have thrown "Cannot access before initialization" on every render. Caught
  before it shipped.
- `npx tsc -b` and `npm run lint` both pass clean; the same 3 pre-existing lint hits as the
  previous entry (confirmed unrelated).
- **Not yet live-verified** — needs a real check that the page now fits one screen with only the
  Articles table scrolling, and that Worker's modal keyboard nav/selection works end to end.
- **Files:** `frontend/src/pages/WageRunPage.tsx`

## Reports Hub — Vendor/Customer Balances text brought up to the app's bolder convention
- **User report:** Payment Trail, Customer Balances, and Vendor Balances "text is old" — pointed to
  the Reports Hub's other tabs as the reference for the bolder, clearer style to match.
- **Investigation, not a guess:** compared all the Reports Hub tab components directly.
  `PaymentTrailPage.tsx` and `ReportKhaataPage.tsx` (Account Ledger/Business Ledger tabs) already
  use the target convention — `text-sm` table body with `font-bold` (often colored) debit/credit/
  balance cells, `text-xs font-semibold uppercase` headers. `OverallTrailContent.tsx` — the ONE
  component that actually powers both "Vendor Balances" and "Customer Balances" (via an
  `initialGroup` prop) plus "Overall Trail" itself — was the real outlier: `text-xs`/`text-[11px]`/
  `text-[10.5px]` throughout, with plain (non-bold) debit/credit numbers. Payment Trail's own table
  already matched the target convention and needed no changes.
- **`OverallTrailContent.tsx` — both on-screen tables** (the main "Business Accounts Balances
  Details" table and the account drill-down ledger table) brought up to `text-sm`/`text-xs`-header
  to match: base table text bumped from `text-xs` to `text-sm`; every micro-sized class
  (`text-[11px]`, `text-[10.5px]`) replaced with `text-xs`; debit/credit values gained `font-bold`
  (previously plain weight even though colored); the account description cell gained
  `font-semibold` (aggregate/italic rows explicitly kept `font-normal` so they still read as
  distinct from real accounts). Print-preview export layouts (the `renderPrintableDocument`/
  `renderPrintableLedger` functions, separate inline-styled paper output) were deliberately left
  untouched — a different medium/context, not what was on screen when this was reported.
- `npx tsc -b` and `npm run lint` both pass clean; the 2 remaining lint hits are the same
  pre-existing `set-state-in-effect` pattern seen elsewhere in this codebase, confirmed unrelated
  (both are data-loading effects, not touched by this change).
- **Not yet live-verified** — needs a look at the actual Vendor Balances/Customer Balances/Overall
  Trail tabs to confirm the table now reads clearly bolder, matching Payment Trail/Account Ledger.
- **Files:** `frontend/src/pages/OverallTrailContent.tsx`

## Grand Total bar — credit total was unreadable on its own dark navy background
- **User report, with screenshot:** on Vendor Balances (and the same component's Customer
  Balances/Overall Trail), the dark navy "Grand Total" bar's numbers weren't readable; asked for
  white "in the whole app."
- **Searched the whole app first, not just this one screenshot** — grepped every page/component
  for the dark-navy-background-on-a-real-content-row pattern (`bg-[var(--brand-navy)]`,
  `bg-[#111c2a]`, `bg-slate-900` as a solid fill, not the many `bg-slate-900/40` modal backdrops)
  plus every on-screen "Grand Total" row specifically (Sale Analysis, Vendor Report, Purchase,
  Purchase Return, Payment Trail, Wage Run's `Figure` component). Every other one already sits on
  a LIGHT background (`bg-slate-50`) with dark text, which is already readable — no changes needed
  there. `OverallTrailContent.tsx`'s Grand Total row was the only one on a dark navy background,
  and the only one with a contrast bug: its credit cell explicitly overrode the row's own
  `text-white` with `text-rose-700` (dark red) — dark-on-dark, unreadable. `WageRunPage.tsx`'s
  `Figure` component already uses `text-white` correctly on its own dark ("Net Balance") variant.
- **Fix:** removed the `text-rose-700` override on that one cell, leaving it to inherit the row's
  `text-white` (matching the debit cell right next to it, which was already correct).
- `npx tsc -b` and `npm run lint` both pass clean; same 2 pre-existing lint hits as the previous
  entry, confirmed unrelated.
- **Not yet live-verified** — needs a look at Vendor Balances/Customer Balances/Overall Trail to
  confirm the Grand Total row's credit figure is now clearly readable in white.
- **Files:** `frontend/src/pages/OverallTrailContent.tsx`

## Correction: it was the BAR's background that should change, not the number's color
- **User correction:** the previous fix (recoloring the credit total to white) missed the actual
  ask — the credit number should stay red; it's the dark navy BAR itself that should become
  white/light, everywhere this pattern exists in the app.
- Reverted the text-color change and instead changed the row's own background from
  `bg-[var(--brand-navy)]`/`text-white` to the light `bg-slate-50` style already used by every
  other "Grand Total" row in the app (Sale Analysis, Vendor Report) — dark navy label
  (`font-lora`, `var(--brand-navy)`), dark debit figure, RED credit figure (`text-rose-700`,
  unchanged from before either of these two fixes), all on a light background instead of navy.
  Border colors adjusted from `border-slate-600`/`border-slate-800` (dark-bg values) to
  `border-slate-200`/`border-slate-300` (light-bg values) to match.
- Confirmed via the earlier "whole app" grep (previous entry) that this row was the only dark-navy
  content bar in the app to begin with — this correction only touches that same one spot.
- `npx tsc -b` passes clean.
- **Not yet live-verified** — needs a look at Vendor Balances/Customer Balances/Overall Trail to
  confirm the Grand Total bar is now light with a red (not white) credit figure.
- **Files:** `frontend/src/pages/OverallTrailContent.tsx`

## Same dark-bar fix extended to data-entry pages
- **User request:** apply the same navy-bar-to-light fix "in all data entry pages."
- **Searched every data-entry page first** (Sale Bill, Sale Return, Purchase, Purchase Return,
  Receipts, Expenses, Transfer, Journal Voucher, Cheque, Wage Run, Salary Run, Stock Voucher) for
  every `bg-[#111c2a]`/`bg-[var(--brand-navy)]`/solid `bg-slate-900` occurrence. The overwhelming
  majority are active-tab pills and buttons (gold-on-navy, `text-[#B08D57]` — already good
  contrast, not a "total bar," left untouched). The ONE genuine total/balance bar with a dark navy
  fill in any data-entry page was `WageRunPage.tsx`'s `Figure` component's `highlight` variant
  (used for the "Net Balance" figure) — structurally the same pattern as the Reports Hub bug, even
  though this one's white text was already readable.
- **Fix:** `Figure`'s `highlight` branch changed from `bg-[#111c2a] border-[#111c2a]` +
  `text-[#B08D57]`/`text-white` to a light `bg-amber-50 border-amber-300` card with
  `text-amber-800` label and `text-slate-900` value — matching the light-bar convention now used
  for the Reports Hub Grand Total row, instead of a dark fill.
- Checked `AccountBalancePanel.tsx`, `SalaryRunPage.tsx`, and every other data-entry page
  specifically for a second instance — none found.
- `npx tsc -b` and `npm run lint` pass clean; same 3 pre-existing lint hits as WageRunPage's
  earlier entries, confirmed unrelated.
- **Not yet live-verified** — needs a look at Wage Run's Net Balance figure to confirm it now
  reads as a light amber card instead of a dark navy one.
- **Files:** `frontend/src/pages/WageRunPage.tsx`

## Found the REAL source: an inline-style dark bar the earlier greps missed entirely
- **User report, with screenshots:** the dark bar is still there on Sale Bill, Sale Return,
  Receipts, Expenses, and Stock Voucher.
- **Root cause:** every earlier "whole app" search grepped for Tailwind arbitrary-value classes
  (`bg-[#111c2a]`, `bg-[var(--brand-navy)]`). This bar isn't a Tailwind class at all — it's a plain
  inline `style={{ background: '#111c2a', ... }}` on the final totals field (Sale Bill/Sale
  Return's "Rs.", Receipts/Expenses' "Total Amount", Stock Voucher's second total field, Journal
  Voucher's balanced "Net Total") — invisible to a class-name grep, which is exactly why it slipped
  through every prior pass despite those pages being checked.
- **Found by grepping for the literal string** `background: '#111c2a'` instead of a Tailwind
  pattern — turned up in exactly 6 files: `ReceiptsPage.tsx`, `ExpensesPage.tsx`,
  `SaleReturnPage.tsx`, `SaleBillPage.tsx`, `StockVoucherPage.tsx`, and `JournalVoucherPage.tsx`
  (this last one wasn't in the user's list but has the identical pattern — fixed for consistency).
- **Fix, same in all six:** background changed from `#111c2a` (navy) to `#fdf6ec` (a light cream,
  matching the app's existing amber/gold-highlight family — e.g. `ReportKhaataPage.tsx`'s opening-
  balance row) and border from `#334155` to `#e7d5b8` to match. Text color kept as `var(--brand-
  gold)` where it already was (gold-on-light is an established accent elsewhere in the app — the
  Overall Trial Balance heading, other Grand Total rows); `StockVoucherPage.tsx`'s field used plain
  white text (which would have vanished on a light background) and was switched to the same gold.
  `JournalVoucherPage.tsx`'s out-of-balance red warning state (white on saturated red) was left
  alone — that one was never unreadable, only its balanced/navy state was.
- `npx tsc -b` passes clean on all six files. `npm run lint` also passes clean on five of them;
  `StockVoucherPage.tsx` has 37 pre-existing React Compiler/memoization lint errors (confirmed via
  `git diff` — this change only touched 6 lines, none of the flagged ones).
- **Not yet live-verified** — needs a look at all six pages to confirm the final total field is now
  a light cream bar with gold text instead of dark navy.
- **Files:** `frontend/src/pages/ReceiptsPage.tsx`, `frontend/src/pages/ExpensesPage.tsx`,
  `frontend/src/pages/SaleReturnPage.tsx`, `frontend/src/pages/SaleBillPage.tsx`,
  `frontend/src/pages/StockVoucherPage.tsx`, `frontend/src/pages/JournalVoucherPage.tsx`

## Correction: white, not cream
- **User correction:** the cream (`#fdf6ec`) from the previous fix wasn't what was meant — plain
  white, on the same six fields.
- Changed `background: '#fdf6ec'` → `'#ffffff'` and `borderColor: '#e7d5b8'` →
  `'var(--border-color)'` (the same border variable every other plain input on these pages already
  uses) across the same six occurrences. Text stays `var(--brand-gold)`, unchanged.
- **Did NOT touch** `OverallTrailContent.tsx`'s own `#fdf6ec` (line 272, an opening-balance row
  inside `renderPrintableLedger()`'s print-preview output) — that one predates this whole fix
  entirely and is a different, unrelated element; confirmed by checking its context before editing
  anything, not just search-and-replacing every match of the color.
- `npx tsc -b` passes clean on all six files.
- **Not yet live-verified** — needs a look at all six pages to confirm the total field is now a
  plain white bar with gold text.
- **Files:** `frontend/src/pages/ReceiptsPage.tsx`, `frontend/src/pages/ExpensesPage.tsx`,
  `frontend/src/pages/SaleReturnPage.tsx`, `frontend/src/pages/SaleBillPage.tsx`,
  `frontend/src/pages/StockVoucherPage.tsx`, `frontend/src/pages/JournalVoucherPage.tsx`

## Multi-window support — closing the main window now closes every child window too
- **User request:** child windows (opened via Ctrl/Cmd+Click or the shortcut icon,
  `windows:open`/`createAppWindow`) had no real relationship to the main window — closing the main
  window left every child window still open.
- **`backend/electron/windowManager.js`**: added a module-level `mainWindow` reference, set
  whenever `createAppWindow()` is called with `child` false (the app's own startup window from
  `main.js`, and again if it's reopened via the macOS dock `activate` handler). Every window opened
  WITH `child: true` now gets `parent: mainWindow` in its `BrowserWindow` constructor options
  (guarded by `!mainWindow.isDestroyed()`, in case the main window was somehow already gone).
  Electron's own native parent/child window lifecycle is what then closes every child
  automatically when its parent closes — nothing hand-rolled (no manual window-tracking array or
  `close` event listener needed); this is the documented behavior of the `parent` `BrowserWindow`
  option.
- A child window opened FROM another child window still becomes a child of the one true
  `mainWindow`, not of whichever window it was triggered from — `windows:open`'s handler doesn't
  know or care which window sent the request, it only ever reads the tracked `mainWindow`.
- `node --check` passes clean on the touched file (can't run the actual Electron app from this
  sandbox to verify the native close-cascade).
- **Not yet live-verified** — needs a real check: open 2-3 child windows, close the main window,
  confirm every child window closes with it.
- **Files:** `backend/electron/windowManager.js`

## Removed the system-generated article code ("P-101" etc.) everywhere it was shown
- **User request:** the auto-generated article code (`dbo.articles.code`, `nextCode()` = `P-<n>`)
  is gone from every screen it appeared on — Current Stock report's CODE column (the user's
  screenshot), Product Setup, and every article picker across the app.
- **Real dependency fixed first, before any UI removal:** four repositories returned only
  `a.code AS article_code` (not `article_id`) for a saved bill/return's line items, so the frontend
  re-resolved each line's product by string-matching `product.code === item.article_code`.
  Removing the code from display without this would have silently broken re-opening an existing
  Sale Bill/Sale Return for editing. Added `a.article_id,` to the items SELECT in
  `saleBills.repository.js` (`findById`), `saleReturns.repository.js`,
  `draftSaleBills.repository.js`, `draftSaleReturns.repository.js` — `a` was already joined, so
  this is a pure additive column. `node --check` passes on all four.
- Frontend matching switched from `p.code === it.article_code` to
  `p.article_id === it.article_id` in `SaleBillPage.tsx` (2x), `SaleReturnPage.tsx` (3x),
  `FindTab.tsx`, `FindReturnTab.tsx`; the `it.article_name || it.article_code || 'Article'` label
  fallback in the same files drops the code branch (`it.article_name || 'Article'`).
- `frontend/src/lib/api.ts`: added `article_id?: number` to `SaleBillItemRow`,
  `DraftSaleBillItemRow`, `SaleReturnItemRow`, `DraftSaleReturnItemRow`.
- `ReportStockPage.tsx` turned out to repeat the same CODE column across ~7 separate table
  renderings (multiple print-preview variants for current/ledger/production tabs plus their
  on-screen equivalents) — removed the column/cell and re-keyed every list `key={...}`/sort
  comparator off `articleId`/`commonName` instead of `code` in all of them, adjusted every
  `colSpan` accordingly, and dropped `code`/`article_code` from the three Excel export branches.
- `ProductSetupPage.tsx`: renamed `selectedProductCode` state to `selectedProductName` (now set
  from `prod.name`, used to build the "Editing {x}" / view-mode page title instead of the code);
  removed the read-only Code form field and its `nextCodePreview` computation entirely (kept
  `nextBatchNoPreview`, unaffected); dropped `code` from the product directory's client-side search
  filter and its placeholder text; dropped the CODE column from both the "articles under this
  category" staged table and the product directory `DataListTable` (column-config entry removed),
  adjusting `colSpan`s.
- Picker labels changed from `` `${p.code} — ${p.name}` `` to plain `p.name` in `SaleBillPage.tsx`,
  `SaleReturnPage.tsx`, `WageRunPage.tsx`, `FindTab.tsx`, `StockVoucherPage.tsx` (two separate
  pickers there). `StockVoucherPage.tsx` also carried a whole extra "Article Code" column in its
  committed-lines grid, backed by an `articleCode` field on the `UiLine`/`EntryLine` shapes — that
  field and column were removed entirely (not just hidden), along with the now-unused `product`
  lookup in `handleCommitLine` that only existed to populate it.
- **Not touched, deliberately:** `business_accounts.code` (10-digit ledger account codes, e.g. in
  `StockVoucherPage.tsx`'s on-account picker) — a structurally different, load-bearing concept, not
  the article code this task was about. The backend `dbo.articles.code` column, its `NOT NULL
  UNIQUE` constraint, and `nextCode()` itself are unchanged — insert-time uniqueness still relies
  on it, it's simply never displayed or matched against from the frontend anymore.
- `npx tsc -b` passes clean on the full frontend after every file in this task.
- **Not yet live-verified** — needs a look at Current Stock report, Product Setup, and each article
  picker (Sale Bill, Sale Return, Stock Voucher, Wage Run, Find/Find Return tabs) to confirm the
  code is gone and nothing renders blank where it used to be; also needs re-opening an existing
  Sale Bill/Sale Return for edit to confirm the `article_id`-based line match works correctly.
- **Files:** `backend/src/repositories/saleBills.repository.js`,
  `backend/src/repositories/saleReturns.repository.js`,
  `backend/src/repositories/draftSaleBills.repository.js`,
  `backend/src/repositories/draftSaleReturns.repository.js`, `frontend/src/lib/api.ts`,
  `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`,
  `frontend/src/pages/ReportStockPage.tsx`, `frontend/src/pages/ProductSetupPage.tsx`,
  `frontend/src/pages/StockVoucherPage.tsx`, `frontend/src/pages/WageRunPage.tsx`,
  `frontend/src/components/FindTab.tsx`, `frontend/src/components/FindReturnTab.tsx`

## Fix: child windows' minimize/maximize buttons weren't working
- **User report:** every child window opened via the multi-window feature had non-functional
  minimize and maximize (zoom) buttons.
- **Root cause:** `createAppWindow()` gave every child window `parent: mainWindow`, which was the
  mechanism for "closing the main window closes all children" (2026-09-03 entry above). Electron
  treats a `BrowserWindow` with `parent` set as an OS-attached child window, and on macOS this
  disables the window's own minimize/zoom controls — they're expected to follow the parent instead
  of acting independently.
- **Fix, in `backend/electron/windowManager.js`:** removed `parent: ...` entirely from the
  `BrowserWindow` constructor options. Replaced the close-cascade with manual tracking instead: a
  module-level `childWindows` Set, added to on every `child: true` window and pruned via its own
  `closed` listener; the main (non-child) window's `closed` listener now iterates that Set and
  closes every still-open child itself. Same end-user behavior (main window closing takes every
  child with it), but windows are no longer OS-parented, so minimize/zoom work normally on all of
  them.
- `node --check` passes on the touched file.
- **Not yet live-verified** — needs a real check: open a couple of child windows, confirm their
  minimize/maximize buttons now work, then close the main window and confirm children still close
  with it.
- **Files:** `backend/electron/windowManager.js`

## "Show Print Preview" opens a new window everywhere, instead of an in-page overlay
- **User request:** every report/ledger page's "Show Print Preview" button used to toggle a local
  full-screen modal (`ReportPrintPreviewModal`). Clicking it should instead open a brand-new
  Electron window — styled like the app's other "open in new window" child windows — landing
  straight on the same filtered report. Example given: opening "Business Ledger" as a second
  window, then clicking Print Preview inside it opens a third window the same way.
- **Root problem:** the existing multi-window mechanism (`windows:open`) only ever carried
  `page`/`tab` in the new window's URL — no page's filter/selection state (dates, search text,
  selected customer/vendor/account, active tab, drill-down id, etc.) traveled with it, so a fresh
  window had no way to reproduce what was on screen.
- **Generic infra added first:**
  - `backend/electron/windowManager.js`: `createAppWindow(page, tab, { child, params })` now spreads
    an optional `params` map into the query object alongside `page`/`tab`/`child` — pure passthrough,
    no schema. The existing dev-URL `searchParams` loop and prod `loadFile(..., { query })` already
    handled arbitrary extra keys with no further change.
  - `backend/src/ipc/windows.ipc.js`: `windows:open` forwards `payload?.params` through.
  - `frontend/src/lib/api.ts`: `openWindow(page, tab, params?)` gained the optional third argument.
  - New `frontend/src/lib/windowParams.ts`: `getWindowParam(key)`, `isChildWindow()`,
    `shouldAutoPreview()` — the read side, used once on mount by every page below.
- **Per-page pattern** (same shape 17 times, across 15 files): each filter's `useState` initializer
  now reads `getWindowParam('key') ?? <old default>`; the "Show Print Preview" button's `onClick`
  now calls `openWindow(page, tab, { ...currentFilterValues, autoPreview: '1' })` instead of
  `setIsPreviewOpen(true)`; a new effect opens the preview automatically once the resulting window's
  own data fetch has resolved (tracked via a `hasLoadedOnce` flag set in the load function's own
  `finally`/end, since `loading` itself starts `false` and would fire the effect immediately if
  watched alone). Where the print target is a drill-down record (an account, vendor, customer,
  cheque, or "person" entity) rather than plain filters, the id is carried instead and the record is
  re-selected from the freshly-loaded list once it arrives (matched by `ba_id`/`ac_id`, vendor id,
  customer id, or entity id + entity type, per page).
- Two pages needed one extra wire-up beyond the pattern: `SaleBillPage.tsx` and `SaleReturnPage.tsx`
  read their own `activeTab` local state from `getWindowParam('tab')` on mount (previously always
  defaulted to `'bill'`/`'return'`), since that's what lets a window opened at `tab: 'find'` (from
  `FindTab`/`FindReturnTab`'s own Show Print Preview) actually land on the Find tab instead of the
  default one.
- Touched: `ReportStockPage.tsx`, `OverallTrailContent.tsx` (two independent preview triggers —
  grouped balances and the per-account ledger drill-down), `PaymentTrailPage.tsx`,
  `ReportCashBookPage.tsx`, `VendorReportPage.tsx`, `ReportKhaataPage.tsx` (the user's own "Business
  Ledger"/"Customer Khaata" example), `SaleAnalysisPage.tsx`, `SaleReportPage.tsx`,
  `OverallSearchPage.tsx`, `CustomerSetupPage.tsx`, `BiltyUpdatePage.tsx`, `SearchCustomerPage.tsx`,
  `ChequeLedgerContent.tsx`, `ProductLedgerContent.tsx`, `ChequesTab.tsx`, `FindTab.tsx`,
  `FindReturnTab.tsx` — 17 triggers total, every one confirmed present via a final sweep for
  `onClick={() => setIsPreviewOpen(true)}` returning zero matches app-wide.
- `npx tsc -b` run after every single file's edits (not just once at the end) — clean throughout.
- **Not yet live-verified** — needs a real check: set non-default filters on a few of these pages,
  click Show Print Preview, confirm a new (child-styled) window opens showing the same filtered
  report immediately rather than one reset to defaults.
- **Files:** `backend/electron/windowManager.js`, `backend/src/ipc/windows.ipc.js`,
  `frontend/src/lib/api.ts`, `frontend/src/lib/windowParams.ts` (new), `frontend/src/pages/ReportStockPage.tsx`,
  `frontend/src/pages/OverallTrailContent.tsx`, `frontend/src/pages/PaymentTrailPage.tsx`,
  `frontend/src/pages/ReportCashBookPage.tsx`, `frontend/src/pages/VendorReportPage.tsx`,
  `frontend/src/pages/ReportKhaataPage.tsx`, `frontend/src/pages/SaleAnalysisPage.tsx`,
  `frontend/src/pages/SaleReportPage.tsx`, `frontend/src/pages/OverallSearchPage.tsx`,
  `frontend/src/pages/CustomerSetupPage.tsx`, `frontend/src/pages/BiltyUpdatePage.tsx`,
  `frontend/src/pages/SearchCustomerPage.tsx`, `frontend/src/pages/ChequeLedgerContent.tsx`,
  `frontend/src/pages/ProductLedgerContent.tsx`, `frontend/src/components/ChequesTab.tsx`,
  `frontend/src/components/FindTab.tsx`, `frontend/src/components/FindReturnTab.tsx`,
  `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`

## One stable System No. per document, from draft through posted
- **User request:** "no change that entirely no matter if the bill is posted or unposted the
  system no will be genrated in order everything" — Sale Bill's System No. changed the moment a
  draft was posted (it switched from `draft_sale_bills.draft_id` to `sale_bills.bill_id`, two
  separate `IDENTITY(1,1)` counters). The user wants one number, assigned once at creation, that
  never changes for that document's life — and confirmed (2026-09-05) this should apply to every
  document type with the same architecture: Sale Bill, Sale Return, Purchase, Purchase Return.
- **Root cause, same shape across all four:** posting deletes the draft row and INSERTs a
  brand-new row into the real table, which assigns a fresh id from that table's own independent
  counter — unrelated to the draft's own id.
- **Scope correction made mid-implementation:** Receipts (Payments) and Expenses have the exact
  same draft/real table split (`draft_receipts`/`receipts`, `draft_expenses`/`expenses`), so they
  were initially included too — until checking the frontend showed the number those pages actually
  display and search by is `receipt_vouchers.voucher_no` / `expense_vouchers.voucher_no` (migration
  022), assigned once at voucher creation and **already** never touched by posting/unposting an
  individual line. The user's ask was already satisfied there. Backend changes made for Receipts
  were reverted (`git checkout` back to committed state) once this was confirmed, rather than
  adding an unused, parallel `system_no` with no user-visible effect.
- **Schema** (`031_document_system_numbers.sql`): adds `system_no INT NOT NULL` to both tables of
  each of the four pairs, backfills every existing row (draft + real, unioned and numbered by
  `ROW_NUMBER() OVER (ORDER BY created_at, id)` — best-effort for old posted documents, since a
  posted row's original draft-creation moment no longer exists once posted; the user explicitly
  accepted this one-time renumbering), then creates one `SEQUENCE` per type
  (`seq_sale_bill_no`/`seq_sale_return_no`/`seq_purchase_no`/`seq_purchase_return_no`) starting
  right after the highest backfilled number. IF NOT EXISTS-guarded throughout, matching
  021/022/025/028/030.
- **Backend wiring, same three points per type:**
  - `draftXRepository`'s insert: `system_no` column added, value `NEXT VALUE FOR` the type's
    sequence — a new draft always gets a fresh number.
  - `draftXService.js#confirm()`: the object built from the draft and passed into
    `insertConfirmed()` gains `system_no: draft.system_no` — carried forward, never regenerated.
  - `XRepository`'s insert (the real table, shared by `insertConfirmed` and the direct/legacy
    `create()` path): `system_no` column added via `ISNULL(@systemNo, NEXT VALUE FOR ...)` — an
    explicit value (from confirm) is used as-is, a missing one (direct create) falls back to a
    fresh number.
  - **Caught while implementing** (not in the original plan): `unconfirm()` — unposting a real
    document back into a draft — builds a fresh draft object and calls the SAME `insertDraft`/
    `insert` repository function as a brand-new draft. Without carrying `system_no` through there
    too, unposting a document would silently hand it a new number, defeating the whole point. Fixed
    in all four types' `unconfirm()` (`saleBills.service.js`, `saleReturns.service.js`,
    `purchases.service.js`, `purchaseReturns.service.js`) by adding `system_no: <doc>.system_no` to
    the rebuilt draft object, and switching each `draftXRepository`'s insert from an unconditional
    `NEXT VALUE FOR` to the same `ISNULL(@systemNo, NEXT VALUE FOR ...)` pattern so it accepts an
    explicit carry-over value.
  - `saleBills.repository.js#biltySearch()`'s numeric-or-manual-number search switched its numeric
    branch from matching `bill_id` to matching `system_no` — that's the number a user actually
    searches by now.
- **Frontend, same pattern per type** (`SaleBillPage.tsx`, `SaleReturnPage.tsx`,
  `PurchasePage.tsx`, `PurchaseReturnPage.tsx`): added a `system_no: number` field to each
  Row/DraftRow TypeScript interface in `api.ts`; the "System No." preview shown before saving
  switched from `MAX(draft_id)+1` to `MAX(system_no across loaded unposted+posted lists)+1`; added
  a new `currentSystemNo` persisted-field state (parallel to the existing `billId`/`returnId`/etc.
  identity-tracking state, which keeps its original job of driving every API call) set alongside
  every place the page loads/creates/posts/unposts a record, and swapped every "System No." display
  location (the read-only field, page headers, print titles, password-prompt text, Excel exports,
  duplicate-bill-no warnings) from the raw id to this new state. Also updated every directory/search
  page that showed or searched by the raw id as "the number" —
  `BiltyUpdatePage.tsx`/`SearchCustomerPage.tsx`/`FindTab.tsx`/`FindReturnTab.tsx` and the
  `OverallTab`/`MonthlyTab`/`WeeklyTab` (+ Return equivalents) family — to use `system_no` instead.
  React `key=` props and every direct API call by id were deliberately left on the real
  `draft_id`/`bill_id`/etc. — only the user-facing label and search field changed.
- `node --check` passes on every touched backend file; `npx tsc -b` passes clean on the frontend
  after every single file's edits (not just once at the end).
- **Fix found and applied 2026-09-07**: the migration failed on first real run —
  `Invalid object name 'numbered'`. Each of the four backfill blocks defined one CTE
  (`WITH ordered AS (...), numbered AS (...)`) and then referenced `numbered` from TWO separate
  `UPDATE` statements — but a CTE in SQL Server is only in scope for the single statement
  immediately following it, so the second `UPDATE` in each block couldn't see it. `migrate()`
  caught the error, logged it, and rolled back the transaction (per its per-file try/catch in
  `electron/main.js`), so the app kept running normally on the old schema — which is why every
  bill showed the `#1 (pending)` fallback (no row anywhere had a `system_no` yet, so
  `nextSystemNoPreview()`'s max-of-nothing was always 0+1). Fixed by replacing each CTE pair with a
  `#temp` table (`#numbered_sb`/`#numbered_sr`/`#numbered_pur`/`#numbered_pret`), which stays in
  scope for the whole batch — both `UPDATE`s per type now share one numbering pass correctly.
  Verified live: ran `migrate()` directly against `wentox_db` — `applied
  031_document_system_numbers.sql`, all 4 sequences created (`seq_sale_bill_no`,
  `seq_sale_return_no`, `seq_purchase_no`, `seq_purchase_return_no`), and the sanity query
  (count vs. distinct-count vs. min/max) came back clean for every type: Sale Bill 24/24 (1–24),
  Sale Return 3/3 (1–3), Purchase 8/8 (1–8), Purchase Return 1/1 (1–1) — no duplicates, no gaps.
- **Still to do**: the manual per-type check — create a draft, note its System No., post it,
  confirm the number is identical before and after; create a second draft and confirm its number
  is exactly one higher regardless of whether the first was posted in between; unpost a document
  and confirm its number survives that round trip too.
- **Files:** `backend/src/db/migrations/031_document_system_numbers.sql` (new),
  `backend/src/repositories/draftSaleBills.repository.js`, `backend/src/services/draftSaleBills.service.js`,
  `backend/src/repositories/saleBills.repository.js`, `backend/src/services/saleBills.service.js`,
  `backend/src/repositories/draftSaleReturns.repository.js`, `backend/src/services/draftSaleReturns.service.js`,
  `backend/src/repositories/saleReturns.repository.js`, `backend/src/services/saleReturns.service.js`,
  `backend/src/repositories/draftPurchases.repository.js`, `backend/src/services/draftPurchases.service.js`,
  `backend/src/repositories/purchases.repository.js`, `backend/src/services/purchases.service.js`,
  `backend/src/repositories/draftPurchaseReturns.repository.js`, `backend/src/services/draftPurchaseReturns.service.js`,
  `backend/src/repositories/purchaseReturns.repository.js`, `backend/src/services/purchaseReturns.service.js`,
  `frontend/src/lib/api.ts`, `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`,
  `frontend/src/pages/PurchasePage.tsx`, `frontend/src/pages/PurchaseReturnPage.tsx`,
  `frontend/src/pages/BiltyUpdatePage.tsx`, `frontend/src/pages/SearchCustomerPage.tsx`,
  `frontend/src/components/FindTab.tsx`, `frontend/src/components/FindReturnTab.tsx`,
  `frontend/src/components/OverallTab.tsx`, `frontend/src/components/MonthlyTab.tsx`,
  `frontend/src/components/WeeklyTab.tsx`, `frontend/src/components/OverallReturnTab.tsx`,
  `frontend/src/components/MonthlyReturnTab.tsx`, `frontend/src/components/WeeklyReturnTab.tsx`

## First/Prev/Next/Last browsing now walks documents in System No. order, not date order

Follow-up, reported by the user 2026-09-07: "not in order... after 11 comes 24". The `navPostedList`/
`navUnpostedList` arrays that back First/Prev/Next/Last on Sale Bill/Sale Return/Purchase/Purchase
Return were built from the shared `list()` repository call's own `ORDER BY bill_date DESC, bill_id
DESC` (`.reverse()`d for oldest-first) — correct for the date-driven report views that also call the
same endpoint (Weekly/Monthly/Overall/Find), wrong for record-by-record browsing once System No. was
meant to be the stable, creation-order identity. A document entered with a backdated `bill_date`
sorted next to whatever else shared that date, so browsing could jump straight from system_no 11 to
24 even though nothing was actually out of order — verified live: bill_id 3022 (system_no 24, created
2026-09-05) carries `bill_date` 2026-08-20, the same date as bill_id 2008 (system_no 11).

Fixed by sorting each nav list by `system_no` directly in the frontend, independent of whatever order
the underlying list arrived in — a pure frontend change, the shared backend `list()` endpoint and its
date ordering are untouched (still correct for the report views). Also updated the analogous
"jump to most recently posted/saved" logic in each page's Posted/Unposted dropdown handler to use the
same `system_no` ordering instead of `.reverse()`.

**Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`,
`frontend/src/pages/PurchasePage.tsx`, `frontend/src/pages/PurchaseReturnPage.tsx`.
`npx tsc -b` passes clean.

## `ISNULL(@systemNo, NEXT VALUE FOR ...)` — SQL Server rejects it outright, every new save failed

Reported by the user 2026-09-07: "Failed to save bill: Internal error" (Sale Bill Save/Done, Detail
mode). `wrap.js` sanitizes any non-`ApiError` failure to that generic message before it reaches the
renderer, so the real cause was only in the backend console. Reproduced by calling
`draftSaleBills.service.create()` directly against the live `wentox_db`:

    RequestError: NEXT VALUE FOR function cannot be used within CASE, CHOOSE, COALESCE, IIF,
    ISNULL and NULLIF.

Every one of the 8 repository inserts wired for `system_no` (all four document types, draft + real
table each) used exactly this pattern — `ISNULL(@systemNo, NEXT VALUE FOR dbo.seq_x_no)` — to let one
INSERT serve both "assign a fresh number" (param NULL) and "use this carried-over number" (param
supplied) callers. SQL Server refuses the statement outright the moment `NEXT VALUE FOR` sits inside
`ISNULL`/`COALESCE`/`CASE`/`IIF`/`NULLIF` — this isn't a typo, it's a hard restriction, so **every**
save/confirm/unconfirm across all four types was broken, not just Sale Bill. `node --check` can't
catch it (valid JS calling a SQL string SQL Server itself refuses) — only actually running an insert
surfaces it, which is what caught it here.

Fixed by resolving the value in JS before the INSERT instead of inside the SQL: added
`nextSequenceValue(transaction, sequenceName)` to `src/db/pool.js` (runs `SELECT NEXT VALUE FOR
<sequenceName> AS n` against the in-flight transaction), and each of the 8 repository inserts now
does `const systemNo = doc.system_no ?? await nextSequenceValue(transaction, 'dbo.seq_x_no');` then
binds `@systemNo` as a plain parameter — no `ISNULL` in the SQL at all.

**Verified live**, not just `node --check`: called `draftSaleBills.service.create()` directly against
`wentox_db` — succeeded, produced `draft_id 2014` / `system_no 25` (matching the `#25 (pending)`
preview the user's own screen was already showing). Cleaned up afterward via
`draftSaleBills.service.remove()` (restores the stock the test draft had deducted) — confirmed the
row is gone.

**Files:** `backend/src/db/pool.js` (new `nextSequenceValue` export),
`backend/src/repositories/draftSaleBills.repository.js`, `backend/src/repositories/saleBills.repository.js`,
`backend/src/repositories/draftSaleReturns.repository.js`, `backend/src/repositories/saleReturns.repository.js`,
`backend/src/repositories/draftPurchases.repository.js`, `backend/src/repositories/purchases.repository.js`,
`backend/src/repositories/draftPurchaseReturns.repository.js`, `backend/src/repositories/purchaseReturns.repository.js`.
`node --check` passes on all 9 touched files.

## Deleted documents' System No. is now reclaimed for the next new one

Follow-up, requested by the user 2026-09-07 after noticing #25's gap (from the earlier live test):
if a document is deleted, its number should go back into the pool rather than being retired forever.
Confirmed scope with the user first: applies to ANY deletion (a plain unposted draft, or a document
that was posted then unposted then deleted — though in practice these are the same code path, since
the app never allows deleting a still-posted document; unposting always comes first), and the user
explicitly accepted the trade-off this requires: reused numbers are no longer strictly chronological
(delete #25, then a later new document can become #25 again even though it's actually the newest).

A `SEQUENCE` (migration 031's mechanism) can't support this — it never gives a value back once
issued, which is exactly what made it safe against two saves at once. Reusing a deleted number means
finding the smallest currently-unused number instead, which is a read-then-use pattern: two saves at
the same instant could otherwise compute the same gap and collide. Added `nextGapSystemNo()` to
`src/db/pool.js`: it takes an exclusive `sp_getapplock` scoped to the current transaction (one lock
resource per document type, e.g. `'seq_sale_bill_no'` — reused as a lock name even though the actual
SEQUENCE objects are no longer used for assignment) so only one save per document type can compute a
gap at a time, then finds `MIN(n)` over `1..(current max + 1)` that isn't already used by either the
draft or real table. Swapped into all 8 repository inserts in place of the `nextSequenceValue()` calls
added for the previous fix — same `doc.system_no ?? <resolve a new one>` shape, just resolving via
the gap search instead. No change needed to any delete path: since the search always reads the
tables' live state, a freed number is picked up automatically on the very next save.

**Verified live** against `wentox_db`: created a real draft — got `system_no 25` (correctly reclaimed,
matching the gap from the earlier test). Deleted it via `draftSaleBills.service.remove()`. Created
another — got `25` again, confirming it's genuinely reusable, not a one-time fluke. Deleted that one
too. Final state checked directly: 25 rows across `draft_sale_bills`/`sale_bills`, 25 distinct, no
duplicates, only `25` itself missing (expected — that's the number my last cleanup just freed; `26`
is the user's real bill).

The `SEQUENCE` objects from migration 031 are left in the schema, unused — harmless, but nothing
calls `nextSequenceValue()` anymore.

**Files:** `backend/src/db/pool.js` (new `nextGapSystemNo` export),
`backend/src/repositories/draftSaleBills.repository.js`, `backend/src/repositories/saleBills.repository.js`,
`backend/src/repositories/draftSaleReturns.repository.js`, `backend/src/repositories/saleReturns.repository.js`,
`backend/src/repositories/draftPurchases.repository.js`, `backend/src/repositories/purchases.repository.js`,
`backend/src/repositories/draftPurchaseReturns.repository.js`, `backend/src/repositories/purchaseReturns.repository.js`.
`node --check` passes on all 9 touched files.

## Reverted number reuse; deleted System No.s are now shown as an actual "Deleted" stop instead

The user reconsidered the previous fix (reused numbers, gaps eliminated) after seeing the reassignment
trade-off explained in detail — decided the trade-off wasn't worth it: a reused number could later be
handed to a completely unrelated document, which is worse than a permanent gap. New instruction:
revert to the plain, never-reused `SEQUENCE` (gaps kept forever), but when First/Prev/Next/Last would
otherwise silently jump over a deleted number's gap, make it an actual stop showing "#N — Deleted".

**Reverted**: all 8 repository inserts switched back from `nextGapSystemNo()` to `nextSequenceValue()`
(the `ISNULL`-fix version from earlier). `nextGapSystemNo()` and its `sp_getapplock`/gap-search SQL
were deleted from `src/db/pool.js` entirely — nothing needs it anymore. Checked the SEQUENCE's live
`current_value` for all 4 types against their live `MAX(system_no)` before reverting, to rule out a
collision from the numbers already issued via gap-filling during the one iteration it was live —
all 4 were safely consistent, no manual correction needed.

**New**: migration `032_deleted_document_numbers.sql` adds `dbo.deleted_document_numbers`
(`doc_type`, `system_no`, `deleted_by`, `deleted_at` — PK on `(doc_type, system_no)`). Each of the
4 `draftX.service.js#remove()` functions now records the draft's own `system_no` into this table in
the SAME transaction as the delete (via new `deletedDocumentNumbers.repository.js`'s `record()`) —
this is the ONLY delete path per type (the app never allows deleting a still-posted document;
unposting always comes first), so this one call site per type is exhaustive. Each service also
exports `listDeletedNumbers()`, wired to a new `<feature>:list-deleted-numbers` ipc channel (no
`FEATURES` array change needed — all 4 features were already registered).

**Frontend**: `lib/utils.ts` gained `mergeWithDeleted()` — merges a sorted document array with the
type's full deleted-number log into one System-No.-ordered array of `{kind:'doc', row}` /
`{kind:'deleted', system_no}` entries (the deleted log isn't split by posted/unposted — a deletion
always happens to a draft row, so there's no reliable posted/unposted split to filter it by; the same
marker can legitimately appear in both browse lists). All four pages' `navPostedList`/`navUnpostedList`
now run through it. `goToNavIndex` shows a new `DeletedDocumentOverlay` component (absolutely
positioned over the existing form card, so none of the large existing form JSX needed restructuring)
instead of loading a document when it lands on a `'deleted'` entry. Since a placeholder has no
`billId`/`returnId`/`purchaseId` to find itself by, added a `navIndexOverride` state (set by
`goToNavIndex`, cleared by an effect on the page's own id field) so Prev/Next can keep stepping on
from a placeholder instead of the derived index falling back to -1 and restarting from the beginning.
Each page's delete-password-success handler also now calls the new `refreshDeletedNumbers()` so a
just-deleted number's placeholder appears immediately, no reload needed.

**Verified live** against `wentox_db`: created a Sale Bill draft (got `system_no 29`), deleted it,
confirmed `deleted_document_numbers` now has a `SALE_BILL`/`29` row, created another draft and
confirmed it got `30` — NOT `29` — proving the gap is genuinely kept, not reused. Cleaned up both
test drafts and the two test log rows afterward.

**Files:** `backend/src/db/migrations/032_deleted_document_numbers.sql` (new),
`backend/src/repositories/deletedDocumentNumbers.repository.js` (new), `backend/src/db/pool.js`,
`backend/src/repositories/draftSaleBills.repository.js`, `backend/src/repositories/saleBills.repository.js`,
`backend/src/repositories/draftSaleReturns.repository.js`, `backend/src/repositories/saleReturns.repository.js`,
`backend/src/repositories/draftPurchases.repository.js`, `backend/src/repositories/purchases.repository.js`,
`backend/src/repositories/draftPurchaseReturns.repository.js`, `backend/src/repositories/purchaseReturns.repository.js`,
`backend/src/services/draftSaleBills.service.js`, `backend/src/services/draftSaleReturns.service.js`,
`backend/src/services/draftPurchases.service.js`, `backend/src/services/draftPurchaseReturns.service.js`,
`backend/src/ipc/draftSaleBills.ipc.js`, `backend/src/ipc/draftSaleReturns.ipc.js`,
`backend/src/ipc/draftPurchases.ipc.js`, `backend/src/ipc/draftPurchaseReturns.ipc.js`,
`frontend/src/lib/api.ts` (new `DeletedNumberRow` + `listDeletedNumbers` per type),
`frontend/src/lib/utils.ts` (new `mergeWithDeleted`/`NavEntry`),
`frontend/src/components/DeletedDocumentOverlay.tsx` (new),
`frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`,
`frontend/src/pages/PurchasePage.tsx`, `frontend/src/pages/PurchaseReturnPage.tsx`.
`node --check` passes on all touched backend files; `npx tsc -b` passes clean.

**Fix, 2026-09-07**: user hit `No handler registered for 'draft-sale-bills:listDeletedNumbers'`
immediately on the Sale Bill screen. Cause: `frontend/src/lib/ipcBridge.ts`'s auto-bridge only
kebab-cases the FEATURE prefix (`draftSaleBills` → `draft-sale-bills`) — the action name is used
exactly as accessed, unconverted (confirmed against the existing `confirmAll` channel, which is
registered as `draft-sale-bills:confirmAll`, not `-confirm-all`). The 4 new ipc handlers were
registered as `<feature>:list-deleted-numbers` (wrongly kebab-cased) while the frontend called
`.listDeletedNumbers()`, i.e. `<feature>:listDeletedNumbers` — a mismatch on every one of the 4
document types, not just Sale Bill. Fixed by renaming all 4 channel registrations to camelCase to
match. `node --check` passes on all 4 `ipc/draftX.ipc.js` files.

## Extended deleted-number tracking to Receipt/Payment vouchers too

Requested by the user, 2026-09-07 ("do the same for purchase and purchase return receipt and
payments also"). First checked whether Purchase/Purchase Return needed the same historical-gap
backfill Sale Bill got — they didn't: their `system_no` sequences and data have zero gaps (I never
ran test saves against those two types), so nothing to backfill there; the deleted-number
tracking itself was already live for all four types.

Receipts/Payments needed real new work: they use a completely different numbering mechanism —
`receipt_vouchers.voucher_no`/`expense_vouchers.voucher_no` is `SELECT ISNULL(MAX(voucher_no),0)+1`
(`receiptVouchers.repository.js#nextVoucherNo`), not a `SEQUENCE` — so unlike Sale Bill/Purchase, a
deleted voucher's number was ALREADY being reused before this (deleting the highest-numbered
voucher lowers `MAX`, so the next `create()` picks up the same number). Asked the user explicitly
whether to also switch this to a never-reused sequence to match the other four types — they said no,
keep the reuse behavior, just log deletions so a gap can still show as "Deleted" while it exists.
Also confirmed scope: only WHOLE-voucher deletion (`receiptVouchers.service.js#remove()`/
`expenseVouchers.service.js#remove()`) touches `voucher_no` — deleting one line out of a multi-line
voucher (`draftReceipts.service.js#remove()`, etc.) never does, so only those two functions needed
the `deletedNumbersRepository.record(...)` call, same trio pattern as the other four types
(`record()` in `remove()`, a `listDeletedNumbers()` export, an ipc channel).

**New wrinkle vs. the other four types**: since reuse stays intact, a "deleted" voucher_no can later
belong to a genuinely live voucher again — a stale log row would then make that live voucher ALSO
show as a deleted placeholder when browsing. Added `deletedDocumentNumbers.repository.js#unrecord()`
and call it from both `create()` functions right after `nextVoucherNo()` resolves a number, clearing
any stale log row for that number in the same transaction as the insert. No schema change needed —
`deleted_document_numbers.doc_type` has no `CHECK` constraint, so `'RECEIPT_VOUCHER'`/
`'EXPENSE_VOUCHER'` are just two more values in the same table from migration 032.

**Frontend**: `ReceiptsPage.tsx`/`ExpensesPage.tsx` already had First/Prev/Next/Last browsing
(`navPostedVouchers`/`navUnpostedVouchers`, sorted by `voucher_date` then `voucher_no`), used for
more than just navigation (Post All's loop, the dropdown's counts) — so rather than touch those,
added SEPARATE `navPostedList`/`navUnpostedList` built via `mergeWithDeleted()` (mapping
`voucher_no` to the `system_no` key it expects) purely for `navList`/`navIndex`/`goToNavIndex`. Since
`mergeWithDeleted` re-sorts everything by its numeric key regardless of input order, the existing
date-based sort on the real-only arrays didn't need to change at all — a smaller, safer change than
it first looked. Same `navIndexOverride`/placeholder-clearing-on-id-change pattern as the other four
pages; `DeletedDocumentOverlay` placed over each page's single "Entry Form Card" (which also holds
the System Voucher No. field), the one container both pages already use for the whole voucher view.

**Verified live** against `wentox_db` for both voucher types: created a voucher, deleted it,
confirmed it appears in `deleted_document_numbers`; created a second voucher and confirmed it
reused the SAME voucher_no (intended reuse behavior, unlike the other four types) AND that doing so
correctly cleared the stale deleted-log row via `unrecord()`. Cleaned up all test vouchers/log rows
afterward.

**Files:** `backend/src/repositories/deletedDocumentNumbers.repository.js` (new `unrecord`),
`backend/src/services/receiptVouchers.service.js`, `backend/src/ipc/receiptVouchers.ipc.js`,
`backend/src/services/expenseVouchers.service.js`, `backend/src/ipc/expenseVouchers.ipc.js`,
`frontend/src/lib/api.ts` (new `listDeletedNumbers` on both voucher features),
`frontend/src/pages/ReceiptsPage.tsx`, `frontend/src/pages/ExpensesPage.tsx`.
`node --check` passes on all touched backend files; `npx tsc -b` passes clean.

## Payments' Done button no longer resets to a blank voucher

Reported by the user 2026-09-07: "when i enter a entry and click done button then it disappears i
have to go to unposted and navigate to it then post it." Traced to `ExpensesPage.tsx#handleDoneButton`
calling `startNewVoucher()` unconditionally after committing the entry — this was itself a prior,
deliberate request (2026-08-30, per the removed comment), not a bug, but the user now finds the
resulting round-trip (Unposted → find it → Post) more hassle than it's worth.

Checked `ReceiptsPage.tsx` (the mirrored page) first, since the two are built as a matched pair
throughout this codebase — it does NOT reset after Done; it stays on the just-saved voucher and only
clears to a fresh one after a successful Post. So Payments had drifted from Receipts' own pattern,
not the other way around. Fixed by removing the `startNewVoucher()` call from `handleDoneButton` —
it now does the same commit-then-`clearEntryRow()` as Enter (`handleEntrySubmit`) and as editing an
existing line, staying on the voucher with Post immediately available in the toolbar. Updated the
now-stale comments/tooltip that described the old "starts a new one" behavior. New/blank voucher is
still reachable via the toolbar's New button, unaffected.

**Files:** `frontend/src/pages/ExpensesPage.tsx`. `npx tsc -b` passes clean.

## Removed the "(pending)" suffix from every System No./C.Book No./Voucher No. preview field

Requested by the user, 2026-09-07. Grepped every page for `(pending)` and found 7 occurrences: 6 were
the System/C.Book/Voucher No. preview shown before saving (`SaleBillPage.tsx`, `SaleReturnPage.tsx`,
`PurchasePage.tsx`, `PurchaseReturnPage.tsx`, `ExpensesPage.tsx`'s "System Voucher No. (C.Book No)",
`JournalVoucherPage.tsx`) — all fixed, now showing just `#N`. The 7th, `ProductSetupPage.tsx`'s
"Batch No." preview, is a different kind of field (a product batch number, not a document System
No.) — left as-is rather than assumed into scope; flagged to the user for a decision.

**Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`,
`frontend/src/pages/PurchasePage.tsx`, `frontend/src/pages/PurchaseReturnPage.tsx`,
`frontend/src/pages/ExpensesPage.tsx`, `frontend/src/pages/JournalVoucherPage.tsx`.
`npx tsc -b` passes clean.

Follow-up: user asked for the 7th (`ProductSetupPage.tsx` Batch No.) too — removed. `grep -rn
"(pending)"` across `pages/`/`components/` now returns nothing anywhere in the app.
`frontend/src/pages/ProductSetupPage.tsx`. `npx tsc -b` passes clean.

## New windows cascade instead of appearing to minimize the previous one

Reported by the user, 2026-09-07, with a reference screenshot of the legacy app's own floating
document windows (several overlapping, all visible, none minimized): opening a page that spawns a
new window (windows:open) made the previous window disappear as if minimized — not simply sit
behind the new one.

Searched the whole repo for `.minimize(`/`show: false` — nothing calls either, in this codebase or
anywhere reachable from window creation. Root cause is more mundane: `createAppWindow()`
(`electron/windowManager.js`) never set an explicit `x`/`y`, so Electron placed every new
`BrowserWindow` at roughly the same default spot — a second window lands almost exactly on top of
the first with nothing peeking out from behind it, which looks identical to the first having been
minimized even though it's still a normal, restored window sitting right there in the taskbar.

Fixed with `nextCascadePosition()`: each new window offsets 32px further down-right than the last
(counting `childWindows.size` + the main window), reading the actual work-area bounds from
`screen.getPrimaryDisplay()` and wrapping back to the top-left once a cascade would run off-screen.
Matches the reference screenshot's stacked-but-all-visible look. Could not verify visually in this
sandbox (no display) — syntax-checked only; ask the user to confirm after restarting the app.

**Files:** `backend/electron/windowManager.js`. `node --check` passes.

**Follow-up, same session**: the cascade fix above wasn't it — the user clarified the window still
shows as the ACTIVE taskbar entry (not a real minimize) but stops rendering entirely the instant it
loses focus to ANY other window, even a click completely unrelated to opening a new one. That
symptom shape (active-but-invisible, triggered broadly by any focus loss) is a known Chromium-on-
Windows GPU compositor bug on certain graphics drivers — a hardware-accelerated window failing to
repaint after losing focus. Standard mitigation: `app.disableHardwareAcceleration()`, added to
`electron/main.js` before `app.whenReady()` (alongside `app.setName()`/the `lang` switch, which have
the same ordering requirement). Not verifiable in this sandbox (no display, no Windows machine) —
flagged to the user as the standard fix for this exact symptom shape, pending their confirmation.

**Files:** `backend/electron/main.js`. `node --check` passes.

## Fixed: action buttons stayed live for the stale record while a "Deleted" placeholder was showing

The user asked for a general check of action-button logic across every page — while explaining it, I
self-caught a real bug in my own earlier "Deleted" placeholder work: `deletedPlaceholder` is set when
First/Prev/Next/Last lands on a deleted number, and `DeletedDocumentOverlay` covers the form, but no
toolbar button's `disabled` condition ever checked it. `mode`/`billId`/`voucher` etc. were left exactly
as they were from whatever record was loaded BEFORE navigating to the placeholder — so Edit/Delete/
Save/Done/Post/Un Post/Print/PDF/Excel could all still be enabled, reflecting that stale hidden
record. Clicking one would have silently acted on it, not on anything related to the placeholder,
with no visual cue why (the overlay makes it look like nothing is loaded at all).

Fixed by adding a `deletedPlaceholder != null` guard to every record-scoped button's `disabled`
condition (or, for the conditionally-*rendered* Done/Update button on the two voucher pages, to its
render condition instead) across all 6 pages that have the feature: `SaleBillPage.tsx`,
`SaleReturnPage.tsx`, `PurchasePage.tsx`, `PurchaseReturnPage.tsx`, `ReceiptsPage.tsx`,
`ExpensesPage.tsx`. Left untouched: New, First/Prev/Next/Last, Find, Exit, Post All — these don't act
on "the current record" so the placeholder doesn't affect them. Confirmed the overlay itself has no
`pointer-events: none`, so the underlying entry-strip inputs were already correctly unclickable
underneath it (only the toolbar, rendered outside the overlaid card, needed this fix).

Also launched a broader Explore-agent audit (read-only) of every data-entry page's button logic —
result pending.

**Files:** `frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`,
`frontend/src/pages/PurchasePage.tsx`, `frontend/src/pages/PurchaseReturnPage.tsx`,
`frontend/src/pages/ReceiptsPage.tsx`, `frontend/src/pages/ExpensesPage.tsx`.
`npx tsc -b` passes clean.

**Audit results, same session**: the background Explore agent found 2 more instances of the exact
same `deletedPlaceholder` gap, both fixed:
- `PurchasePage.tsx`/`PurchaseReturnPage.tsx`'s line-item Delete button (`deleteSelectedArticle`)
  only checked `isViewMode`/`editingUid` — missed since it's a different button shape (deletes a
  selected article row, not the whole document) than the ones patched earlier.
- `ReceiptsPage.tsx`'s endorsement Post/Unpost buttons (docKind === 'SETTLEMENT') had NO disabled
  check at all — a conditionally-rendered block the earlier pass didn't touch. Fixed by adding
  `deletedPlaceholder == null` to its render condition, same as the Done/Update button pattern.

The agent also flagged several PRE-EXISTING cross-page inconsistencies unrelated to this session's
System No. work — reported to the user, not changed without confirmation:
- Purchase/Purchase Return's Delete button only removes a line item, never the whole unposted
  document (the Pending Posting panel it used to route through was removed 2026-09-03) — Sale
  Bill/Sale Return's Delete is dual-purpose (whole-document when nothing's selected).
- Purchase/Purchase Return have no Print/Find/PDF/Excel toolbar buttons at all (Sale Bill/Sale
  Return do).
- JournalVoucherPage.tsx/StockVoucherPage.tsx still gate Un Post on `browseFilter === 'posted'` —
  every other page removed that exact gate as backwards once the dropdown started genuinely
  filtering (2026-09-04-era comment on the other 6 pages).
- JournalVoucherPage.tsx/StockVoucherPage.tsx's First/Prev/Next/Last only ever browse the POSTED
  list (`canBrowse = browseFilter === 'posted' && ...`) — switching to "Unposted" disables all four
  nav buttons entirely, unlike every other page where the list swaps with the dropdown. These two
  pages don't have `deletedPlaceholder`/`mergeWithDeleted` either — they never received several
  upgrades the other six pages got.
- Purchase/Purchase Return's First/Last are tied to `canNavPrevious`/`canNavNext` (disabled right at
  the boundary) rather than `canBrowse` (list non-empty) like Sale Bill/Sale Return — a minor,
  probably harmless behavioral divergence at the first/last record.

**Files (this fix batch):** `frontend/src/pages/PurchasePage.tsx`,
`frontend/src/pages/PurchaseReturnPage.tsx`, `frontend/src/pages/ReceiptsPage.tsx`.
`npx tsc -b` passes clean.

## Fixed the remaining flagged inconsistencies (user: "fix them")

Four straightforward fixes plus one real feature build, all per the audit's list.

**Straightforward fixes:**
- **Purchase/Purchase Return Delete restored to dual-purpose**: the whole-document delete
  infrastructure (`isPasswordModalOpen`/`pendingDeleteDraftId`/`handleDeletePasswordSuccess`)
  already existed in both files but had zero callers — orphaned when the old Pending Posting panel
  that used to trigger it was removed 2026-09-03, silently leaving no way to delete a whole unposted
  purchase/return. Added `handleDeleteCurrentPurchase()`/`handleDeleteCurrentReturn()` and made
  `deleteSelectedArticle` dual-purpose (row-delete when one's selected, whole-document delete when
  not), matching Sale Bill/Sale Return's own Delete button exactly.
- **Purchase/Purchase Return First/Last** now use a `canBrowse` (list non-empty) check instead of
  the Prev/Next boundary check, matching Sale Bill/Sale Return.
- **Journal Voucher/Stock Voucher Un Post** no longer requires `browseFilter === 'posted'` — removed
  that gate (title updated to match the wording used everywhere else this gate was already removed).
- **Journal Voucher/Stock Voucher First/Prev/Next/Last** now browse whichever list the dropdown
  selects (added a `navUnpostedList`, made `navList`/`navIndex` dropdown-aware) instead of always
  being locked to the Posted list — switching to "Unposted" no longer disables all four nav buttons.
  Both pages' `loadJv()`/`loadSv()` already load either posted or unposted rows uniformly by id (a
  single table with a status column, not a draft/real split), so no new loader was needed.

**Feature build — Print/Find/PDF/Excel added to Purchase and Purchase Return**, confirmed with the
user first since this meant writing new code with no existing pattern on these two pages to copy
(unlike the fixes above). Mirrors Sale Bill's own implementation exactly, adapted to Purchase's
fields (vendor instead of customer, raw-material lines — material/unit/quantity/price — instead of
article/carton/pairs/discount):
- **Find**: a toolbar button opening a modal that searches already-loaded posted+unposted lists by
  System No., manual bill no., or vendor name, jumping straight to the picked record.
- **Print/PDF**: share one `ReportPrintPreviewModal`, rendering a purchase/return invoice (logo
  header, an info grid, an items table, a totals row, a signature footer) built from the page's own
  live form state — same shape as `SaleBillPage.tsx`'s `renderBillPrintable()`.
- **Excel**: exports the current item list via the existing `exportRowsToExcel()` helper.

All new toolbar buttons correctly include the `deletedPlaceholder != null` guard from the earlier
fix batch.

**Files:** `frontend/src/pages/PurchasePage.tsx`, `frontend/src/pages/PurchaseReturnPage.tsx`,
`frontend/src/pages/JournalVoucherPage.tsx`, `frontend/src/pages/StockVoucherPage.tsx`.
`npx tsc -b` passes clean.

## changes-14-09-26.md: JV-03 (reason optional) and RP-02 (amount required)

First two items from the client's 2026-09-14 batch (`System_architecture/changes-14-09-26.md`) —
picked as the smallest fully self-contained ones needing no further client input, per the user.

**JV-03 — Journal Voucher reason is now optional**, was required:
- New migration `033_journal_voucher_reason_optional.sql`: `journal_vouchers.reason` was
  `NVARCHAR(200) NOT NULL` since migration 016 — dropped to nullable.
- `journalVouchers.service.js`: removed the `validateHeader()` guard that rejected an empty reason,
  and `buildHeaderFields()` now stores `null` instead of an empty/whitespace string.
- `journalVouchers.repository.js#insertLedgerEntries()`: the per-line ledger narration fell back to
  `line.narration || reason` — with reason now genuinely absent, this could have posted narration
  literally reading `"Journal Voucher #123 — undefined"`. Fixed to omit the reason/narration segment
  entirely when neither is present, falling back to just `"Journal Voucher #123"`.
- Frontend: removed the required-asterisk marker and the `buildPayload()`/`isValid` guards on
  `reason`; `JournalVoucherRow`/`UnpostedJournalVoucherRow.reason` typed `string | null`; the
  toolbar Find's search guarded against a null reason (`(v.reason || '')`); `loadJv()` normalizes a
  null reason to `''` before it reaches the persisted string field.
- **Verified live** against `wentox_db`: ran the migration, created a real JV with no reason via
  `journalVouchers.service.create()` — succeeded, confirmed `reason` stored as real SQL `NULL` (not
  the string `"null"`). Cleaned up the test JV afterward.

**RP-02 — Amount is now marked required on Receipts, and confirmed/fixed on Payments too**:
- Both pages already blocked saving with a zero/blank amount (`buildPayload()`'s own `amount <= 0`
  check) — that part was never actually broken. What was missing was the visible required marker
  (red asterisk), which the Amount field had never had on either page, unlike every other required
  field. Added it to both, matching the app's existing convention.
- The doc's acceptance criteria also wants the keyboard **focus trap** on an empty required field —
  that's a separate, not-yet-built shared-layer item (G-02) from the same batch; this field will
  inherit it automatically once G-02 lands, same as every other required field in the app.

**Files:** `backend/src/db/migrations/033_journal_voucher_reason_optional.sql` (new),
`backend/src/services/journalVouchers.service.js`, `backend/src/repositories/journalVouchers.repository.js`,
`frontend/src/lib/api.ts`, `frontend/src/pages/JournalVoucherPage.tsx`,
`frontend/src/pages/ReceiptsPage.tsx`, `frontend/src/pages/ExpensesPage.tsx`.
`node --check` passes; `npx tsc -b` passes clean.

## changes-14-09-26.md: G-09 (account search must not match parent accounts)

Root cause: every business-account picker's `label` bakes in the account's PARENT chart account
name for display context — e.g. `"DIRECTOR EXPENSE (552000010) — EXPENSE"` — and both shared
picker components (`SearchModal.tsx`, `SearchableSelect.tsx`) filter on the whole `label` string.
So typing the parent's name ("expense") matched every account under it, not just accounts whose OWN
name contains it — exactly the client's `DIRECTOR EXPENSE` vs `EXPENSE` example.

Fixed in the shared layer, once, per the item's own instruction: added an optional `searchText`
field to both components' option types — when supplied, filtering matches against it instead of
`label`/`sublabel`, so a caller can keep the parent name in the visible label while excluding it
from what's searched. Defaults to the old behavior (`label`+`sublabel`, or `label` alone for
`SearchableSelect`) when omitted, so every other picker in the app is unaffected.

Then found and fixed all 7 concrete business-account pickers building a parent-name-including label
(`grep -rln ac_name` across `pages/`/`components/`, filtered to `label:` construction sites):
`JournalVoucherPage.tsx` (1), `ExpensesPage.tsx` (2 — one for online-payment accounts, one missed by
the first grep since its label spanned multiple lines), `ReceiptsPage.tsx` (3 — the main account
picker, the online-settlement bank/account picker, and the endorsement "Pay To" picker),
`TransferPage.tsx` (1), `ChequesTab.tsx` (1). Each now supplies `searchText` as just the account's
own name+code (ReceiptsPage's main picker also keeps region/city in `searchText` — that's location
metadata on the account itself, not a parent in the chart-of-accounts hierarchy the client's rule is
about).

Audited and confirmed already clean (no fix needed): `ChartAcSetupPage.tsx`'s group-account pickers
and `GroupAcSetupPage.tsx`'s class picker (labels are already just the picked entity's own
name+code, no parent baked in); the Overall Search page's backend query
(`reports.repository.js#overallDirectory` / `vw_overall_directory`, migration 008) selects a
business account's bare `ba.name`, no parent join in either the view or the `WHERE ... LIKE`.

**Verified** with a standalone simulation of the exact client example (`DIRECTOR EXPENSE` and
`OFFICE RENT`, both under a chart account named `EXPENSE`): searching `"expense"` against the fixed
filter logic returns exactly `DIRECTOR EXPENSE` — `OFFICE RENT` (same parent, unrelated own name) is
correctly excluded, matching the item's stated acceptance criterion precisely.

**Files:** `frontend/src/components/SearchModal.tsx`, `frontend/src/components/SearchableSelect.tsx`,
`frontend/src/pages/JournalVoucherPage.tsx`, `frontend/src/pages/ExpensesPage.tsx`,
`frontend/src/pages/ReceiptsPage.tsx`, `frontend/src/pages/TransferPage.tsx`,
`frontend/src/components/ChequesTab.tsx`. `npx tsc -b` passes clean.

## changes-14-09-26.md: BA-02 (compacting half) — Search & Update Bilty Adda density

Frontend-only, no behaviour change, per the item's own scope (the wider redesign half stays
blocked on the client's walkthrough). Brought `BiltyUpdatePage.tsx` in line with SaleBillPage/
ReceiptsPage's density:
- Both cards: `p-5` → `p-3`, outer grid `gap-6 mb-6` → `gap-3 mb-3`.
- Every input switched from plain `.soleria-input` (some with an inline `py-1.5` override) to
  `.soleria-input-compact` — the same denser variant (`0.25rem/0.5rem` padding, `0.8125rem` font
  vs. `0.5rem/0.75rem`/`0.875rem`) Sale Bill/Receipts use throughout.
- Every label restyled to the same `text-[10px] uppercase tracking-wide text-slate-500` convention
  those pages use, down from a mix of `text-xs`/`text-[11px]` with heavier weight/color.
  Section headers `text-lg` → `text-base`, their icons `18` → `16`.
  Status/success/error banners and the results toolbar's margin tightened a step to match.
- Left untouched: the invoices table itself (`p-3` cells, already tighter than other list tables
  like `FindTab.tsx`'s `p-3.5` — not part of the "extra spacing" the client described) and the
  print-preview document (a separate, already-compact print template).

**Files:** `frontend/src/pages/BiltyUpdatePage.tsx`. `npx tsc -b` passes clean.

## changes-14-09-26.md: G-07 (Escape closes every popup) — full app-wide audit

**Root cause / design**: the app had no single mechanism for this — some modals had an
`onKeyDown={e => e.key==='Escape' && onClose()}` on their own wrapper div (works only while focus
is inside that div — silently breaks the moment a modal opens without moving focus into it, or
focus is later tabbed/clicked out while still open), one portaled modal (`ReportPrintPreviewModal`)
had the same pattern despite portals making "is the focused element inside this DOM subtree" even
less reliable, and 21 bespoke inline modals across 13 pages had no Escape handling at all.

**Built once, in the shared layer** (per the item's own instruction): `frontend/src/hooks/
useEscapeToClose.ts` — one `window`-level `keydown` listener backed by a module-level stack of
close-callbacks. Every open dialog pushes its own `onClose` in mount order; Escape pops and calls
only the LAST one. This makes "topmost only, one layer per press" automatic regardless of DOM
nesting or portaling, and removes the focus-dependency entirely — the actual bug class found.

**Migrated the 5 shared components** to it: `ConfirmModal.tsx`, `PasswordPromptModal.tsx`,
`SearchModal.tsx`, `DuplicateNamePromptModal.tsx` (not yet wired to any save flow, but fixed for
when it is), `reports/ReportPrintPreviewModal.tsx`.

**Found and fixed 21 real gaps** — bespoke inline modals with ZERO Escape handling, via
`comm -23 <(grep -rl "fixed inset-0") <(grep -rl "Escape")` across every page/component:
- Find/Add-New modals: `SaleBillPage.tsx` (Find Bill, Add Sub-Customer, Add Customer),
  `SaleReturnPage.tsx` (Find Return, Add Sub-Customer), `PurchasePage.tsx` (Add Vendor, Find
  Purchase), `PurchaseReturnPage.tsx` (Find Return), `ReceiptsPage.tsx` (Find Voucher),
  `ExpensesPage.tsx` (Find Voucher), `JournalVoucherPage.tsx` (Find JV), `StockVoucherPage.tsx`
  (Find Stock Voucher).
- `ChequesTab.tsx` (dispose/bounce/return-to-sender dialogs — 3), `ChequeReturnsContent.tsx`
  (return-endorsement, bounce/return-issued dialogs — 2).
- `ReportStockPage.tsx` (full color report, material stock adjustment — 2).
- `SalaryRunPage.tsx`/`WageRunPage.tsx` (per-run breakdown view — 1 each).
- `SettingsPage.tsx` (Reset Database's 2-password confirmation flow — matched each step's own
  Cancel button exactly, including step 2 staying open while `resetBusy`, same as its disabled
  Cancel button).

Each fix follows the same shape: extract the modal's existing Cancel/X handler into a named
function (if it wasn't already one), call `useEscapeToClose(isOpen, thatFunction)`, and point the
Cancel/X button at the same function — so Escape can never diverge from the button's own behavior,
including any reset/cleanup side effects. This is also why no special "unsaved work" handling was
needed: Escape always routes through the exact function the Cancel button already calls.

**Batch-migrated 13 Setup pages'** already-working-but-focus-fragile pattern (`Store`/`Adda`/
`Employee`/`ChartAc`/`Bank`/`Region`/`City`/`Category`/`GroupAc`/`SubCustomer`/`Vendor`/
`BusinessAc`/`Customer`SetupPage — all shared the identical `isModalOpen`/`handleCloseModal`
naming, verified first, then processed with one script) to the shared hook, for consistency and to
remove the focus-dependency there too.

**Final verification**: `comm -23` sweep (this time also matching `backdrop-blur`/overlay-color
classes, not just `fixed inset-0`, to catch anything phrased differently) across `pages/` and
`components/` for Escape/`useEscapeToClose` coverage — zero gaps remain outside
`components/ui/{dialog,alert-dialog,sheet,drawer}.tsx`, confirmed unused/unimported shadcn
boilerplate (not reachable from the live app).

**Files:** `frontend/src/hooks/useEscapeToClose.ts` (new), `frontend/src/components/ConfirmModal.tsx`,
`frontend/src/components/PasswordPromptModal.tsx`, `frontend/src/components/SearchModal.tsx`,
`frontend/src/components/DuplicateNamePromptModal.tsx`,
`frontend/src/components/reports/ReportPrintPreviewModal.tsx`,
`frontend/src/components/ChequesTab.tsx`, `frontend/src/pages/ChequeReturnsContent.tsx`,
`frontend/src/pages/ReportStockPage.tsx`, `frontend/src/pages/SalaryRunPage.tsx`,
`frontend/src/pages/WageRunPage.tsx`, `frontend/src/pages/SettingsPage.tsx`,
`frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/SaleReturnPage.tsx`,
`frontend/src/pages/PurchasePage.tsx`, `frontend/src/pages/PurchaseReturnPage.tsx`,
`frontend/src/pages/ReceiptsPage.tsx`, `frontend/src/pages/ExpensesPage.tsx`,
`frontend/src/pages/JournalVoucherPage.tsx`, `frontend/src/pages/StockVoucherPage.tsx`,
`frontend/src/pages/StoreSetupPage.tsx`, `frontend/src/pages/AddaSetupPage.tsx`,
`frontend/src/pages/EmployeeSetupPage.tsx`, `frontend/src/pages/ChartAcSetupPage.tsx`,
`frontend/src/pages/BankSetupPage.tsx`, `frontend/src/pages/RegionSetupPage.tsx`,
`frontend/src/pages/CitySetupPage.tsx`, `frontend/src/pages/CategorySetupPage.tsx`,
`frontend/src/pages/GroupAcSetupPage.tsx`, `frontend/src/pages/SubCustomerSetupPage.tsx`,
`frontend/src/pages/VendorSetupPage.tsx`, `frontend/src/pages/BusinessAcSetupPage.tsx`,
`frontend/src/pages/CustomerSetupPage.tsx`. `npx tsc -b` passes clean throughout.

## 2026-09-15 — changes-14-09-26.md: JV-01 (system-generated sequential voucher number)

**What:** the Journal Voucher's "Number" field becomes truly system-generated and stable, same
convention as Sale Bill/Purchase/etc.'s own System No. — instead of a manual free-text field
(migration `023_journal_vouchers_number.sql`, never actually used by any live JV) or the frontend's
own workaround of previewing `jv_id` (the internal identity) as if it were the document number.

**Backend:** new migration `034_journal_voucher_system_number.sql` creates
`dbo.seq_journal_voucher_no` and backfills all 5 existing JVs' `voucher_no` (all previously `NULL`)
to 1–5 in creation order (`created_at, jv_id`), then starts the sequence at 6. `voucher_no` stays
`NVARCHAR(30)` (per the client's own instruction — "the column stays, only how it's filled
changes"), now holding the sequence value as a string.
`journalVouchers.repository.js#insert()` resolves a fresh value via the shared
`nextSequenceValue(transaction, 'dbo.seq_journal_voucher_no')` helper (already used by
`draftSaleBills`/`draftPurchases`/etc.) rather than accepting `jv.voucher_no` from the caller — a
client-supplied number is no longer possible even in principle. `updateHeader()` no longer writes
`voucher_no` at all, so it's genuinely fixed for the document's whole life once assigned.
`remove()` was previously a bare non-transactional `DELETE` — changed to accept a `transaction` and
run inside one, alongside a new call to `deletedDocumentNumbers.repository.js#record()` under
doc_type `'JOURNAL_VOUCHER'` (mirrors `draftSaleBills.service.js#remove()` exactly), so a deleted
JV's number is retired for good and logged, never silently reused. `journalVouchers.service.js`'s
`remove()` now takes a `userId` (for the deleted-number log) — its one caller,
`journal-vouchers:remove` in the ipc layer, was updated to pass `session.userId`.
`buildHeaderFields()` no longer reads `voucher_no` from the payload at all.

**Frontend:** `JournalVoucherCreateInput.voucher_no` removed from `frontend/src/lib/api.ts` (never
sent by the page anyway, but the type allowed it). `JournalVoucherPage.tsx` gained a new persisted
`voucherNo` state (parallel to `jvId`/`status`/`mode`) set from `result.data.voucher_no` on
save and `jv.voucher_no` on load, `null`ed on New — the entry form's "Number" field and its preview
(`nextJvNoPreview`, now `MAX(voucher_no)+1` instead of `MAX(jv_id)+1`) both read this instead of
`jv_id`. The toolbar's Find modal's search predicate and its results list also switched from
matching/displaying `jv_id` to `voucher_no` (the record-list table underneath already displayed
`voucher_no` correctly — only the entry-form field and Find were still on `jv_id`).

**Verified live:** ran the migration against `wentox_db` — confirmed the 5 existing rows became
`voucher_no` '1'..'5' and the sequence's `current_value` is 6. Called `journalVouchers.service.js`
directly: created two real JVs (got voucher_no '6' and '7' on jv_id 1006/1007), deleted both,
confirmed both numbers landed in `deleted_document_numbers` with doc_type `'JOURNAL_VOUCHER'`, then
deleted those test rows. `node --check` on every touched backend file; `npx tsc -b` and a full
`npx tsc -b --force` rebuild both pass clean.

**Files:** `backend/src/db/migrations/034_journal_voucher_system_number.sql` (new),
`backend/src/repositories/journalVouchers.repository.js`,
`backend/src/services/journalVouchers.service.js`, `backend/src/ipc/journalVouchers.ipc.js`,
`frontend/src/lib/api.ts`, `frontend/src/pages/JournalVoucherPage.tsx`.

## 2026-09-15 — changes-14-09-26.md: JV-04 (row deletion in the detail grid — bug found & fixed)

**What:** the client reported the JV detail grid's row deletion "does not work." Per the doc's own
instruction, found the actual cause in `JournalVoucherPage.tsx` before adding anything, rather than
layering a new delete UI over a broken one.

**Root cause:** `handleRowClick(idx)` called `setMode('edit')` whenever the page was in view mode
and a grid row was clicked — with no check on `isPosted`. The toolbar's own Edit button already
guards against this (`disabled={!isViewMode || jvId == null || isPosted}`), but the row click
bypassed it entirely. So clicking any row on a POSTED journal voucher silently flipped the whole
page into edit mode; that in turn made both the toolbar's Delete button
(`disabled={editingIndex != null ? isViewMode : ...}`, now `false`) and the Save button
(`disabled={isViewMode || !isValid}`, now reachable) actionable. A user could select a row and
press Delete — it visually disappeared from the grid, looking like it worked — but pressing Save
always failed, because `journalVouchers.service.js#update()` rejects any edit on a `CONFIRMED`
voucher with `ApiError.conflict('Unpost the Journal Voucher before editing', 'POSTED_LOCK')`. The
deletion was never actually persisted — exactly the reported symptom.

**Fix:** `handleRowClick` now checks `isPosted` before entering edit mode, matching the Edit
button's own guard exactly — a row click on a posted voucher is now a no-op (same as clicking
Edit itself would be).

**Also added** (second half of JV-04's ask): a delete icon (`Trash2`, 14px, rose, matching
Receipts'/Expenses' own per-row delete icon styling) at the front of every detail grid row,
`onClick` calling `removeLine(idx)` directly with `e.stopPropagation()` so it doesn't also trigger
the row's own select-for-edit handler. Enabled only when `!isViewMode && !isPosted &&
!detailLocked` — the same rule already applied to the entry strip's own fields — so a posted
voucher's rows are never actionable via the icon either, closing the same gap from the other
direction. This also gives a direct one-click delete, replacing the previous indirect
"click row to select it, then click the toolbar's Delete button" as the only way to remove a line.
Totals/Net Total already recompute automatically (`totals` is a `useMemo` keyed on `lines`), so no
change was needed there.

**Not done — deferred, blocked on the client:** the row-pointer reposition after a delete (part of
G-05) is not implemented — no such pointer/gutter exists anywhere in the app yet. G-05 is grouped
with G-04/G-06 in the doc's own Sequencing, pending the client's walkthrough on G-04, so this part
of JV-04's acceptance criteria stays open until that group is picked up.

**Verified:** `npx tsc -b --force` full rebuild passes clean. The bug and fix were confirmed by
tracing the exact state transitions (`mode`/`isViewMode`/`isPosted` → button `disabled` props →
`handleSave`'s call into `journalVouchers.service.js#update()`'s `POSTED_LOCK` guard) rather than
by a live click-through, since reproducing it live would require posting a real JV first.

**Files:** `frontend/src/pages/JournalVoucherPage.tsx`.

## 2026-09-15 — changes-14-09-26.md: BA-01 (print a bill from the Bilty Adda row)

**What:** the Search & Update Bilty Adda page (`BiltyUpdatePage.tsx`) previously had no way to
print an individual sale bill's invoice at all — only a "Show Print Preview" of the whole filtered
directory as a report, and a select icon that loads a row into the bilty/adda-update form. The
client wants to print a bill straight from its row, without navigating to the Sale Bill page.

**Approach — one shared template, per the doc's own explicit warning against a divergent one:**
extracted `SaleBillPage.tsx`'s former `renderBillPrintable()` function (the invoice markup it
built inline from its own live form state) into a new standalone component,
`frontend/src/components/reports/SaleBillPrintable.tsx`. The component takes one plain object,
`SaleBillPrintModel` (also exported from the same file, along with `SaleBillPrintItem`) — every
value it needs already resolved to a primitive (names, not ids; a items array of plain numbers/
strings) — so it has zero dependency on which page or state shape produced those values.
`SaleBillPage.tsx`'s `renderBillPrintable()` now just builds that model from its own component
state (unchanged behaviour — still correct for an unsaved bill, since it's built from the live
form fields, not a fetched row) and renders `<SaleBillPrintable model={model} />`. This removed
`SaleBillPage.tsx`'s now-unused `wentoxLogo` import and its now-unused `formatDate` import (both
moved into the shared component, which imports them itself).

**`BiltyUpdatePage.tsx`:** added a `Printer` icon next to the existing row-select (`Edit2`) icon in
the Action column. Its handler (`handlePrintBill`) fetches the full bill via `api.saleBills.get()`
— the page's own `invoices` list (from `saleBills.biltySearch()`) carries the joined
`customer_name`/`sub_customer_name`/`adda_name` but never `items` or a store name, so those two
sources are combined: names from the already-loaded list row, everything else (items, totals,
dates, delivery info) from the fresh full fetch. A new `stores` list is loaded on mount (via the
already-existing `api.listStores()`) purely to resolve `store_id` → name, mirroring exactly how
`SaleBillPage.tsx` itself does it. This page only ever lists POSTED bills (bilty/adda updates are
UC-07's own POSTED-only rule), so `api.saleBills.get()` is always correct — no draft-table path
needed. The result opens in the same `ReportPrintPreviewModal` (`orientation="portrait"`, matching
`SaleBillPage`'s own single-bill preview) already used elsewhere on this page for the directory
report, so the print/PDF-export/zoom chrome is identical too.

**Deliberately not changed:** the row's own click behavior (selecting it into the bilty/adda-update
form) — BA-01's own note says the row-click semantics for this page are still pending the client's
BA-02 walkthrough (G-08 changes what a row click means elsewhere), so the print action is a
separate icon, not a reinterpretation of the row click.

**Verified live:** ran `saleBills.service.js#biltySearch()` and `#getById()` directly against
`wentox_db` on a real posted bill and confirmed every field the model construction assumes is
present with the expected shape — `article_name`, `color`, `cartons`, `pairs`, `rate`,
`discount_percent`, `discount_value`, `value` on each item, and `total_cartons`, `total_pairs`,
`gross_value`, `net_value` on the bill itself. `npx tsc -b --force` full rebuild passes clean.

**Files:** `frontend/src/components/reports/SaleBillPrintable.tsx` (new),
`frontend/src/pages/SaleBillPage.tsx`, `frontend/src/pages/BiltyUpdatePage.tsx`.

## 2026-09-15 — changes-14-09-26.md: LED-01 (purchase ledger — one row per item)

**What:** a purchase voucher with several item lines collapsed into one summed row in the ledger.
The client wants one row per purchased item, grouped under its voucher, with the voucher total
still visible and the ledger's running balance unaffected — display only.

**Confirmed the posting model doesn't need to change first:** `purchases.service.js
#postLedgerAndStock()` already writes exactly one ledger row per side per purchase (debit
PURCHASES chart account, credit the vendor's business account), with a combined, comma-joined
narration across all items (`buildPurchaseNarration()`). The item detail already lives in
`purchase_items`, joinable by `purchase_id` — so this stayed entirely a reporting/display change,
per the item's own explicit instruction not to restructure posting without checking first.

**Backend:** `reports.repository.js#ledgerRows()` — the one query behind `accountLedger()`, which
in turn backs Account Ledger, Business Ledger, AND `vendorLedger()` (Vendor Report's own ledger
drill-down) — gained one new correlated subquery column, `pur_items_json`:
```sql
(
  SELECT pi.material_id, m.name AS material_name, pi.unit, pi.quantity, pi.price_per_unit, pi.total_price
  FROM dbo.purchase_items pi JOIN dbo.materials m ON m.material_id = pi.material_id
  WHERE le.source_type = 'PURCHASE' AND pi.purchase_id = le.source_id
  ORDER BY pi.line_no FOR JSON PATH
) AS pur_items_json
```
Deliberately a correlated `FOR JSON PATH` subquery, not a direct `LEFT JOIN dbo.purchase_items` —
a direct join would multiply one ledger row into N (one per item), which would double/triple-count
that row's debit/credit in every caller's running-balance loop (`accountLedger()`'s
`running += row.debit - row.credit`). The subquery keeps `ledgerRows()` returning exactly one row
per `ledger_entries` row, with the item lines riding along as a nested JSON array instead. The
`WHERE le.source_type = 'PURCHASE'` guard lives *inside* the correlation (not just as an outer
filter) because `source_id` is only ever a `purchase_id` when `source_type = 'PURCHASE'` — for
every other source type it's some unrelated table's own PK, and without the inner guard a
non-purchase row could spuriously pick up an unrelated `purchase_items` row that happens to share
that numeric id. Also added a `LEFT JOIN dbo.purchases pur ... LEFT JOIN dbo.vendors pur_v` (both
guarded the same way) purely to surface the vendor's name and the purchase's own manual bill
number for the row's own display.

`reports.service.js#formatLedgerRow()`: the `'PURCHASE'` case now sets `bill_no` from
`pur_bill_no` and rewrites `narration` to `"Purchase — <vendor name>"`. A new `purchase_items`
field is computed once, parsed from the JSON column — an array of
`{material_name, unit, quantity, price_per_unit, total_price}` for a Purchase row, `undefined` for
every other row type (so the frontend can tell "not a purchase" apart from "a purchase with zero
lines," though that shouldn't occur in practice).

**Frontend:** `LedgerRow` (`frontend/src/lib/api.ts`) gained the optional `purchase_items` field
(new `LedgerPurchaseItem` interface). `ReportKhaataPage.tsx` — chosen as the one surface to change
first because it already has a Narration column with room for item detail (Account Ledger /
Business Ledger are the app's own general-purpose ledger views) — its `runningKhaata` builder now
expands a Purchase row carrying items into: a header row (voucher date/type/inv#/bill#/vendor
narration, no debit/credit/balance shown), one row per item (`  MATERIAL — qty unit @ rate =
amount`, italic, no balance shown), and a trailing "Voucher Total" row carrying the real
debit/credit/balance. A new `KhaataRow.showBalance` flag (default true) hides the Balance cell on
the header/item rows so the column still reads as exactly one balance change per voucher, not N;
`isSubRow` lightens/indents the item and total rows. Both the on-screen table and the
print-preview table (they already shared one `runningKhaata` array) render the expansion
identically, and the Excel export inherits it for free the same way.

**Not touched, by scope choice:** `VendorReportPage.tsx`'s own separate vendor-ledger table (a
different, narrower rendering with no narration column at all today) was left as-is — if the
client's "purchase ledger" specifically meant that view rather than Account/Business Ledger, it
needs a follow-up to add a detail column there too. Sale, Sale Return and Purchase Return rows are
untouched, matching the item's own explicit scope note.

**Verified live** against `wentox_db`: called `reportsService.accountLedger()` directly for a
single-item purchase (₨2,500 — PU Sheet Roll) and a genuine two-item purchase (`pcs` ₨15,600 +
`pws` ₨145,440 = ₨161,040), confirmed the JSON parses into the correct `purchase_items` array in
both cases and that the ledger row's own `credit` exactly equals the item total sum in the
multi-item case. `node --check` on every touched backend file; `npx tsc -b --force` full rebuild
passes clean.

**Files:** `backend/src/repositories/reports.repository.js`,
`backend/src/services/reports.service.js`, `frontend/src/lib/api.ts`,
`frontend/src/pages/ReportKhaataPage.tsx`.

## 2026-09-15 (correction, same day) — LED-01 was also missing from Vendor Balances / Business Account ledger

**What happened:** the client screenshotted Vendor Balances and the Business Account ledger still
showing the old combined narration ("90 Meters jh @ 80, 65 Meters kl @ 90" as one line) after the
LED-01 fix above. Those two views turned out to be a completely different component from the one
just fixed — `OverallTrailContent.tsx` (backs Reports Hub's "Vendor Balances"/"Customer Balances"
tabs and Overall Trail's own Business Account quick-filter pill), not `ReportKhaataPage.tsx`
("Account Ledger"/"Business Ledger" tabs). `OverallTrailContent.tsx` calls
`api.reports.accountLedger()` directly and had its own two `ledger.rows.map(...)` calls (one for
its print table, one for its on-screen table) that never went through `ReportKhaataPage.tsx`'s
`runningKhaata` expansion — so the backend fix (verified correct) never reached this surface.

**Fix:** added the identical expansion logic as a new `expandedLedgerRows` memo in
`OverallTrailContent.tsx` (new `DisplayLedgerRow` type: `key/date/type/ref/narration/debit/
credit/balance/showBalance/isSubRow`), replacing both `ledger.rows.map(...)` call sites (print
table and on-screen table) and the ledger Excel export (`handleExportExcelLedger`) with it. Same
header-row/item-rows/trailing-total-row shape as `ReportKhaataPage.tsx`'s own version.

**Verified live** against the exact voucher from the client's screenshot: `reportsService
.accountLedger({ ba_id: 1 })`'s entry #9003 returns `purchase_items: [{material_name: 'jh', ...},
{material_name: 'kl', ...}]` with `credit: 13050` and `balance: -868450` — matching the
screenshot's ₨13,050 and ₨868,450 exactly, confirming the backend was already correct and this was
purely the second frontend surface having been missed. `npx tsc -b --force` passes clean.

**Files:** `frontend/src/pages/OverallTrailContent.tsx`.

## 2026-09-15 (second correction, same day) — LED-01's exact row shape per the client

**What the client wanted, stated precisely:** a single-item purchase renders exactly as it always
did — the plain, unsplit row, no change at all. Only a purchase with more than one item groups,
and even then as compactly as possible: for N items, exactly N+1 rows (N item rows, no separate
header row, plus 1 trailing total row). All rows compact (no extra vertical padding/spacing), and
narration text plain black, not gray/italic.

**Backend:** reverted `reports.service.js`'s `'PURCHASE'` case back to doing nothing beyond
`type = 'Purchase'` — no narration/bill_no override. Reverted `reports.repository.js`'s
`ledgerRows()` to drop the now-unused `LEFT JOIN dbo.purchases pur` / `LEFT JOIN dbo.vendors pur_v`
and their two SELECT columns (`pur_bill_no`, `pur_vendor_name`) added in the first correction — a
single-item purchase's narration is once again the plain, original combined string
(`buildPurchaseNarration()`'s output) untouched. The `pur_items_json` correlated subquery (and the
service's `purchase_items` parsing) stayed exactly as-is — that data was already correct, only the
narration/bill_no override needed undoing.

**Frontend:** in both `ReportKhaataPage.tsx`'s `runningKhaata` and `OverallTrailContent.tsx`'s
`expandedLedgerRows`, changed the trigger condition from `purchase_items.length > 0` to `> 1`, and
removed the separate header row entirely — the first item row now itself carries the voucher's
date/type/inv#/bill#(/ref), narrating only that one item; every subsequent item row is blank in
those columns; the trailing total row (unchanged) still alone carries the real debit/credit/
balance. Net result for a 2-item purchase: exactly 3 rows (was 4 in the first correction's
header+2-items+total shape). Styling: item/total rows now use tight vertical padding (`py-1`
on-screen, `2px 6px` in print, versus `py-3`/`5px 6px` for a normal row) instead of a lighter
background + italic + gray narration — narration text is now plain black
(`text-slate-900`/`color: '#000000'`) on every row, matching a normal row's own narration color.

**Verified live** once more: entry #6497 (single item, "leather") — narration is back to
`"900 Meters leather @ 870"`, exactly its pre-LED-01 form; entry #9003 (two items, "jh"/"kl") — the
`purchase_items` array, `credit` (₨13,050), and `balance` (-₨868,450) are unchanged from the first
correction, confirming only the display/narration logic moved, not the underlying data. `node
--check` on both touched backend files; `npx tsc -b --force` full rebuild passes clean.

**Files:** `backend/src/repositories/reports.repository.js`,
`backend/src/services/reports.service.js`, `frontend/src/pages/ReportKhaataPage.tsx`,
`frontend/src/pages/OverallTrailContent.tsx`.

## 2026-09-15 — changes-14-09-26.md: G-03 (autofocus audit — first input focused on every page open)

**What:** `changes-15-08-26.md`'s G-01 established the app-wide rule that a page's first input
gets focused on open; this item is the audit pass confirming it actually holds everywhere,
including sub-panes that mount inside a parent page rather than being routed pages of their own.

**Method:** dispatched a fork agent to statically audit all 47 files in `frontend/src/pages/*.tsx`
for a working mount-time focus mechanism (grep for `firstFieldRef`/`autoFocus`/`.focus()` and any
other ref-based focus pattern). It reported 25 PASS, 16 FAIL, 4 OUT OF SCOPE. Reviewed every FAIL
myself before fixing anything, since the audit was grep-only and could both over- and under-report:

- Discovered `AppLayout.tsx` already has a generic, app-wide G-01 fallback
  (`focusFirstField(document)`, called on mount and again via a `MutationObserver`) that focuses
  the first `FIELD_SELECTOR`-matching element inside the page's first `<form>` — but ONLY if the
  page has a `<form>` at all. Checked every reported FAIL for a `<form>`: 12 of the 16 have none
  at all (so the generic fallback genuinely does nothing for them — confirmed real fails), and 2
  (`TransferPage.tsx`, `ChequeReturnsContent.tsx`) do have one, but every sibling data-entry page
  that also has a `<form>` (SaleBillPage, PurchasePage, JournalVoucherPage, etc.) deliberately adds
  its own explicit `firstFieldRef` on top rather than trusting the generic fallback alone — so
  fixed those the same way for consistency, not left as "maybe it already works."
- Caught two over-reports the grep-only audit couldn't tell apart from real fails:
  `SaleAnalysisPage.tsx` and `SaleReportPage.tsx` both default to an `'overall'` view with zero
  real inputs (only mode-toggle `<button>`s, not fields) — the `SearchableSelect` the audit found
  is only reachable after switching to the non-default "By Month" view, so these are genuinely OUT
  OF SCOPE per the item's own "read-only pages with no input" carve-out, reclassified rather than
  patched with an irrelevant fix.
- Also caught one under-report: `WageRunPage.tsx` had been marked PASS by the audit ("a working
  focus mechanism exists") because it has several `.focus()` calls — but none of them fire on
  mount; they're all row-to-row Enter-key navigation inside the entry grid. Its sibling,
  `SalaryRunPage.tsx`, is structurally identical and WAS correctly flagged FAIL — the asymmetry
  itself was the tell. Fixed both.

**Fixes (15 files):** each got the established `firstFieldRef` pattern — a `useRef` on the page's
first real field plus `useEffect(() => { requestAnimationFrame(() => ref.current?.focus()); },
[...])` — except `SearchCustomerPage.tsx`, whose first field is a `SearchableSelect` (no plain
`<input>` to ref), which instead got that component's own `autoFocus` prop. That prop already
existed in `SearchableSelect.tsx` (built specifically for this, per its own header comment) but had
never actually been used anywhere in the codebase until now.

Three sub-panes that mount fresh on every `ChequePage` tab switch (`ChequeInHandContent.tsx`,
`ChequeLedgerContent.tsx`, `ChequeReturnsContent.tsx`) needed only a plain mount-only effect — a
remount already happens on every tab switch since these are conditionally rendered
(`activeTab === 'x' && <Content />`), not hidden/shown, so "focus on mount" already covers "focus
on tab switch" for free. `ProductLedgerContent.tsx`/`ReportCashBookPage.tsx` (Reports Hub tabs) are
the same shape. Three drill-down list pages (`OverallTrailContent.tsx`, `ReportKhaataPage.tsx`,
`VendorReportPage.tsx`) needed the effect gated on their own "is an account/vendor currently
selected" state, so returning from a drill-down back to the list re-focuses the search box too, not
just the very first mount.

**Verification:** `npx tsc -b --force` passes clean; ran `npx eslint` scoped to all 15 touched
files and confirmed none of the newly-added ref/effect lines produced any new warning or error —
the pre-existing repo-wide `react-hooks/set-state-in-effect` warnings that show up in a full `npm
run lint` are unrelated pre-existing findings across the whole codebase, not something this item
introduced or is responsible for fixing. Not verified via an actual browser click-through — noted
as a limitation rather than claimed.

**Files:** `frontend/src/pages/BiltyUpdatePage.tsx`, `frontend/src/pages/TransferPage.tsx`,
`frontend/src/pages/ChequeInHandContent.tsx`, `frontend/src/pages/ChequeLedgerContent.tsx`,
`frontend/src/pages/ChequeReturnsContent.tsx`, `frontend/src/pages/OverallSearchPage.tsx`,
`frontend/src/pages/OverallTrailContent.tsx`, `frontend/src/pages/PaymentTrailPage.tsx`,
`frontend/src/pages/ProductLedgerContent.tsx`, `frontend/src/pages/ReportCashBookPage.tsx`,
`frontend/src/pages/ReportKhaataPage.tsx`, `frontend/src/pages/SalaryRunPage.tsx`,
`frontend/src/pages/WageRunPage.tsx`, `frontend/src/pages/SearchCustomerPage.tsx`,
`frontend/src/pages/VendorReportPage.tsx`.

## 2026-09-15 — changes-14-09-26.md: G-01 (negative balances in parentheses — audit, no fix needed)

**What:** the client's own framing was explicit — "this item is an audit, not a new rule."
`formatCurrency()` already wraps a negative value in parentheses (G-05, `changes-15-08-26.md`); the
ask was to find every ledger surface printing a balance WITHOUT going through it.

**Audited every named surface** from the item's own list: `ChequeLedgerContent.tsx`,
`ChequeInHandContent.tsx`, `ChequeReturnsContent.tsx`, `ProductLedgerContent.tsx`,
`OverallTrailContent.tsx`, `ReportKhaataPage.tsx`, `ReportCashBookPage.tsx`, `ReportStockPage.tsx`,
`PaymentTrailPage.tsx`, `VendorReportPage.tsx`, `SaleReportPage.tsx`, `SaleAnalysisPage.tsx`, and
the business/chart/control/group account ledgers (all the same `ReportKhaataPage` component,
filtered by `ba_id` vs `ac_id` — not separate pages, already covered). Grepped each for
`.toLocaleString()` and `Math.abs()` — the two ways a balance typically bypasses
`formatCurrency()` — and traced every hit:

- `ReportStockPage.tsx`/`ProductLedgerContent.tsx`'s `.toLocaleString()` calls are all on stock
  quantities (pairs/cartons) — never-negative physical counts, not a signed ledger balance. Out of
  this item's own scope by its own wording.
- `AccountBalancePanel.tsx`'s per-line delta uses a manual `+`/`−` prefix with
  `formatCurrency(Math.abs(delta))` — a deliberate, different convention for a signed *change*
  amount, not a *balance* (its actual Current/After balance figures pass the signed value straight
  through `formatCurrency()` already, correctly). Also not in the item's own surface list.
- `VendorReportPage.tsx`'s "Journal Voucher applied" row similarly uses
  `formatCurrency(Math.abs(row.total_jv))` — a magnitude next to explanatory text, not a running
  balance.
- Excel exports (`ReportKhaataPage`/`OverallTrailContent`'s `handleExportExcel*`) push the raw
  numeric balance, not a `formatCurrency()` string — confirmed this is the consistent, deliberate,
  app-wide convention (`exportRowsToExcel`'s own signature takes `number` specifically so `xlsx`
  writes a real numeric cell Excel can sum/format) and not a gap "print and export output counts"
  was pointing at — turning it into a parenthesized string would break the numeric cell Excel
  export exists to provide. The PDF export path reuses the exact same print HTML as the Print
  button (`lib/export.ts`'s own comment), so it's automatically covered by the print template
  already being correct — no separate check needed there.

**Result: no code changes.** Every genuine balance column, on screen and in its print template,
already routes through `formatCurrency()` — G-05 was applied consistently everywhere this item's
surface list points at. Documented the audit itself (what was checked, and why each near-miss
wasn't actually a violation) in `changes-14-09-26.md` rather than leaving the item's completion
unexplained.

**Verification method:** static code audit (grep across every named file), not a live click-through
with a real negative balance on screen — same caveat as G-03 above.

## 2026-09-15 — changes-14-09-26.md: ACC-02 (Delete action on every account page)

**What:** add a guarded Delete to Business Accounts, Chart of Accounts, Group Accounts, and Bank
Accounts — blocked if the account carries transactions or is a system-default, following the
existing soft-delete convention, no second deletion mechanism.

**Starting point:** all four services already had a working `remove()`/`reactivate()` pair
(soft-close via `status='CLOSED'`/`is_active=0`) from earlier milestone work —
`BankSetupPage.tsx` even had a fully wired frontend "Deactivate" flow already. So this was mostly
about closing specific gaps, not building the feature from scratch:

1. **Missing guard — "carries transactions"** — none of the four `remove()` functions checked
   ledger activity at all before closing an account. Added `hasLedgerActivity()`:
   - `businessAccounts.repository.js`: `EXISTS(SELECT 1 FROM ledger_entries WHERE ba_id=@baId)`.
   - `chartAccounts.repository.js`: same, keyed on `ac_id`.
   - `bankAccounts.repository.js`: a bank account never posts `ledger_entries` against its own
     `bank_id` — every payment/receipt/transfer through it posts against its *linked*
     `business_accounts.ba_id` instead (`bank_accounts.ba_id`) — so this one joins through that
     link. Also added `findLinkedOpeningBalance()` for the same reason.
   - Plus a direct non-zero `opening_balance` check on `businessAccounts`/`bankAccounts` (an
     opening balance is itself a posted OPENING ledger row, so `hasLedgerActivity` alone would
     already catch it in practice, but checking the stored value directly is the more literal
     statement of the doc's own wording, "any opening balance other than zero").
   - `groupAccounts` needed nothing here — groups never receive `ledger_entries` directly, only
     the chart accounts filed under them do.
2. **Missing guard — "child accounts"** — `groupAccounts.service.js#remove()` already had this
   (`isReferenced()`: any chart account filed under the group, active or closed, unconditional).
   `chartAccounts.service.js#remove()` did not have the equivalent one level down — added
   `chartAccounts.repository.js#hasChildren()` (any business account filed under it, same
   unconditional shape) and wired it in.
3. **"System-default account" guard — already complete, verified rather than assumed.**
   `chartAccounts.service.js`'s `RESERVED_CODES = new Set(Object.values(CODES))` already covers
   every reserved code, including `CHEQUES_IN_HAND` (the doc's own named example — "Cheques in
   hand" turns out to be a *chart* account, not a business account: `db/seeds/run.js` creates its
   chart-of-accounts row but never seeds a `business_accounts` row beneath it, unlike
   `CASH_IN_HAND`/`JOURNAL_VOUCHER`). `businessAccounts.service.js`'s narrower
   `STRUCTURAL_ACCOUNT_HEADS` (just those same two codes) is correspondingly correct — no other
   reserved code has a business account that could collide with it.
4. **No frontend Delete UI at all** on `BusinessAcSetupPage.tsx`/`ChartAcSetupPage.tsx`/
   `GroupAcSetupPage.tsx` — each got a `Trash2` button (disabled + tooltipped when the row is
   reserved/system) beside the existing Edit/Reactivate buttons, backed by a shared `ConfirmModal`
   (already Escape-closing per this session's earlier G-07 work) naming the account.
   `GroupAcSetupPage.tsx` had a second, independent gap: its list was unconditionally filtered to
   `is_active` client-side, so a deactivated group could never even be *seen* again, let alone
   reactivated — added a Status badge column and a Reactivate button there too, matching the other
   three pages, so Delete has a real way back.
5. **`BankSetupPage.tsx`'s existing Deactivate and reactivate-prompt dialogs weren't closing on
   Escape** — neither matches the `isModalOpen`/`handleCloseModal` naming the original G-07 batch
   script searched for (different state names: `deactivatingBank`/`reactivatePrompt`), so both were
   silently missed by that sweep. Wired `useEscapeToClose` onto both — this item's own note
   explicitly calls for it ("The dialog closes on Escape (G-07)"), so it's this item's fix to make,
   not a separate follow-up.

**Verified live** against `wentox_db`:
- `businessAccounts.service.js#remove()`: "shazaib" (ledger activity, zero opening balance) →
  refused with the transactions message; "fareed shoes" (non-zero opening balance) → refused with
  that message.
- `chartAccounts.service.js#remove()`: created a fresh chart account + a business account under
  it — chart account refused while the child existed (`CHART_ACCOUNT_HAS_CHILDREN`); removed the
  business account (succeeded cleanly); chart account then removed cleanly too.
- `bankAccounts.service.js#remove()`: "Meezan Bank" (₨50,000 opening balance on its linked
  account) → refused; a freshly created, unused bank account → removed cleanly.

`node --check` on every touched backend file; `npx tsc -b --force` full rebuild passes clean.

**Files:** `backend/src/repositories/businessAccounts.repository.js`,
`backend/src/services/businessAccounts.service.js`,
`backend/src/repositories/chartAccounts.repository.js`,
`backend/src/services/chartAccounts.service.js`,
`backend/src/repositories/bankAccounts.repository.js`,
`backend/src/services/bankAccounts.service.js`,
`frontend/src/pages/BusinessAcSetupPage.tsx`, `frontend/src/pages/ChartAcSetupPage.tsx`,
`frontend/src/pages/GroupAcSetupPage.tsx`, `frontend/src/pages/BankSetupPage.tsx`.

## 2026-09-15 — changes-14-09-26.md: ACC-01 (one sign rule, verified everywhere)

**What:** the client's one authoritative rule — every account, everywhere a signed amount is
entered: +ve → DEBIT (NAAM), -ve → CREDIT (JAMMA); for BANK/CASH specifically that maps onto
money in/out. Confirmed 2026-09-14, overriding any earlier convention wherever code disagreed.
Deliverable was explicitly a verification matrix, not just a fix — "verification is the
deliverable, not just the code change."

**Method:** traced every posting path listed in the item — opening balances, transfers, deposits,
receipts, expenses/payments, cheque flows (deposit/endorse/bounce/return), direct settlements, and
journal vouchers — down to the actual `debit`/`credit` values passed into each
`ledger_entries` INSERT, reading the real service/repository code rather than assuming from
naming. Specifically watched for a "double flip" (sign negated once in the service layer, negated
again in the repository) per the item's own warning that this is the dangerous case ("reads as
correct in one screen and inverts in the ledger").

**Result: one violation, in one place.** Every entry point except the Journal Voucher's own entry
strip was already correct — transfers/receipts/expenses/cheques/settlements are all
fixed-direction transactions (never a user-typed signed amount deciding Dr/Cr), and the one place
that IS an explicit direction choice (Transfer's Deposit tab) uses a CREDIT/DEBIT toggle button,
not a signed number, so there's no sign-mapping logic there to get wrong. No double-flip pattern
exists anywhere.

`JournalVoucherPage.tsx`'s entry strip — a single signed Amount field standing in for separate
Debit/Credit boxes — had the mapping backwards: `handleCommitLine` sent a **positive** amount to
**credit** and negative to **debit**, the exact inverse of the rule. This wasn't an accidental bug;
it matched a real 2026-08-26 instruction ("if it is positive... we are doing credit") that this
item's 2026-09-14 confirmation explicitly supersedes. Fixed:
- `handleCommitLine`: `debit: entry.amount > 0 ? entry.amount : 0, credit: entry.amount < 0 ?
  Math.abs(entry.amount) : 0` (was the inverse).
- `loadLineIntoEntry` (the read path reconstructing a signed Amount when re-opening a saved line
  for edit): `amount: row.debit > 0 ? row.debit : -row.credit` (was the inverse) — had to flip in
  lockstep with the write path or editing an existing line would silently re-invert it back.
- The now-stale header comment describing the old convention, the Amount field's placeholder
  ("+credit / -debit" → "+debit / -credit"), and the validation error's wording.
- `journalVouchers.math.js` (the shared debit/credit sum + balance-check layer) needed no change —
  confirmed it's a pure pass-through with no sign logic of its own, so it was never the source of
  the bug and isn't affected by the fix.

**Verified live** against `wentox_db`, reproducing the acceptance criterion's own spot-check
exactly: posted a real JV crediting Meezan Bank ₨5,000 (what typing `-5000` now correctly produces)
against a counter account. Balance ₨50,550 → ₨45,550, delta exactly -₨5,000. Unposted and deleted
the test JV, balance restored to ₨50,550. The parentheses-display half of the acceptance criterion
was already covered by G-01 (done earlier this session). `npx tsc -b --force` full rebuild passes
clean.

**Files:** `frontend/src/pages/JournalVoucherPage.tsx`.

## 2026-09-15 — changes-14-09-26.md: CHQ-01 (investigated, no repro) + CHQ-02 (Mark Cleared for endorsed cheques)

**CHQ-01 — "Endorsement fails":** per the item's own "reproduce first, then trace" instruction,
investigated before touching any code. Found two entirely different features both called "Endorse"
in this app: the Receipts page's own settlement checkbox (`dbo.settlements` — RP-01's subject, no
cheque "sections") and the real cheque-endorsement action on `ChequesTab.tsx`'s Disposal tab
(`endorseToVendor`/`endorseToExpense`, which does move a cheque through Pending → Endorsed →
Cleared "sections," matching the acceptance criterion). Traced the second one's full path — button
handler → frontend validation → IPC → service → repository → ledger/status writes — and it's
already error-handled at every step (`saveAllocation` surfaces any backend failure via
`setDialogError`, never silently). Checked the most plausible historical cause (endorsing a cheque
whose receipt is still DRAFT) and found it's already fully guarded — not just a disabled button but
an explanatory badge with a tooltip pointing at the fix — added in an earlier commit
(`git log -S receiptPosted` → `3d8bfed8`, pre-dating this whole change-request doc).

Verified the entire live flow directly against `wentox_db` rather than trusting the reading: called
`endorseToVendor` on a real PENDING cheque, endorsed partially, reversed it, then endorsed it in
full — every step succeeded, every ledger row landed correctly (per ACC-01's sign rule, already
verified earlier this session), no partial write, no silent failure. **Could not reproduce the
client's original failure.** Documented this as an investigation result, not a fix, with an honest
note that the exact click sequence was never run in a live Electron window in this environment —
if it still reproduces for the client, the next step is getting the precise steps from them rather
than guessing further (their own instruction: a guess here risks a half-endorsed cheque). No code
changed for CHQ-01 itself.

**CHQ-02 — Mark Cleared for endorsed cheques:** confirmed first that Mark Cleared is a pure status
flip with no ledger effect for the existing DEPOSITED→CLEARED case (money was already posted at
deposit/endorsement time) — so extending it to ENDORSED cheques is genuinely a new entry point into
an existing transition, not a new one, exactly as the item specifies. Two changes:
- `cheques.service.js#markCleared()`: accepted only `cheque_status === 'DEPOSITED'` — extended to
  also accept `'ENDORSED'`, renamed the error code `NOT_DEPOSITED` → `NOT_CLEARABLE` (no other
  reference to the old code existed anywhere in the codebase, confirmed by grep before renaming).
- `ChequesTab.tsx`: found the *exact same bug* this file had already hit and fixed once for
  DEPOSITED cheques (its own `OPEN_STATUSES` comment documents that earlier incident: a status left
  out of the "Open" filter view meant the row — and its Mark Cleared button, which only renders for
  matching statuses — became unreachable without manually changing the filter). `ENDORSED` had
  never been added to `OPEN_STATUSES`, and the Mark Cleared button's condition only checked
  `row.status === 'DEPOSITED'`. Added `'ENDORSED'` to both, mirroring `DEPOSITED` exactly.

**Verified live** against `wentox_db`: endorsed a real cheque (#4, ₨10,000) to completion (status →
ENDORSED), called `markCleared()` — succeeded, status → CLEARED; confirmed `markCleared()` still
correctly rejects a PENDING cheque, now with the renamed `NOT_CLEARABLE` code. All test allocation
and ledger rows created during both CHQ-01's and CHQ-02's live testing were deleted afterward and
cheque #4 restored to its original PENDING state (verified by re-querying it). `node --check`;
`npx tsc -b --force` full rebuild passes clean.

**Files:** `backend/src/services/cheques.service.js`, `frontend/src/components/ChequesTab.tsx`.

## 2026-09-15 — changes-14-09-26.md: RP-01 (direct settlements missing from posted records)

**What:** a settlement made directly through the Receipts screen's own "Endorse" checkbox
(`dbo.settlements` — distinct from cheque endorsement) never showed up again once you navigated
away — no way to find it, page back to it, or confirm it posted.

**Traced the full path** per the item's own instruction: the settlement write itself
(`settlements.service.js#create/post`) was never the problem — confirmed it writes cleanly to its
own table with its own id/status. The gap was exactly where the item predicted: the query behind
`ReceiptsPage.tsx`'s First/Prev/Next/Last navigation and Find,
`receiptVouchers.repository.js#list()`, never references `dbo.settlements` at all — a settlement
simply isn't part of the data those UI elements read from.

**Fix, scoped to the Entry tab** (what the acceptance criterion itself names — "reopen the page,
navigate posted records"):
- Added `allSettlements` state + `refreshAllSettlements()` (`api.settlements.list({})`), fetched on
  mount and after create/post/unpost, alongside the existing `allVouchers`/`refreshAllVouchers()`.
- A settlement has no `voucher_no` (not part of that numbering sequence), so it can't sort into the
  *same* numeric merge the deleted-number-gap display (`mergeWithDeleted`) uses for real vouchers.
  Wrote `insertSettlementsByDate()` — merge-inserts settlement entries by `settlement_date` into
  the already-ordered voucher+deleted-gap sequence, so First/Prev/Next/Last walk both kinds
  chronologically. A run of settlements queued behind a 'deleted' gap marker (which carries no
  date) just flushes in front of the next real voucher — the deleted-gap display's own position is
  untouched, this item is about settlements being findable, not about that display's date
  precision.
- Built `openSettlementInEntry(settlementId)` — there was genuinely no way to load an *existing*
  settlement by id before this; only the moment right after creating one happened to render
  correctly (`handleSaveSettlement` sets the same fields inline). The new function fetches by id
  and sets every one of those same fields, so a reopened settlement looks identical either way.
- `derivedNavIndex`/`goToNavIndex` extended to find/open a `kind: 'settlement'` entry the same way
  they already do for `kind: 'doc'`/`kind: 'deleted'`.
- Find (`findResults`/`handleFindSelect`) unified into one `FindResult` shape covering both
  receipt vouchers and settlements — searches settlement id, date, remarks, and either party's
  name (`from_name`/`to_name`).

**Confirmed already correct, not a gap (per the item's own "confirm the accounting side... report
separately" instruction):**
- Settlement ledger postings — already verified correct under ACC-01's sign rule earlier this
  session (creditor debited, debtor credited).
- Account/Business/Vendor Ledger and Overall Trail — all built on `reports.repository.js
  #ledgerRows()`, which reads `ledger_entries` directly (not the document tables) — a settlement's
  `source_type='SETTLEMENT'` rows are already picked up correctly there
  (`reports.service.js#formatLedgerRow()`'s own `'SETTLEMENT'` case). This gap was specific to the
  document-navigation query, not the ledger-reading ones.

**Checked and found genuinely out of scope, not silently skipped:**
- `ExpensesPage.tsx` has **no** Direct Settlement creation UI at all — its own "Endorse" concept
  (`payment_mode: 'CHEQUE_ENDORSED'`) is the unrelated cheque-endorsement feature. Nothing can be
  "missing from the payment list" today because nothing can be created there yet. Did find the
  identical latent gap already waiting for whenever that's built: `reports.repository.js
  #paymentTrailRows()` (backing `PaymentTrailPage`) only queries `dbo.expenses`, no
  `dbo.settlements` reference — reported per the item's own audit instruction, not fixed, since
  nothing can reach it yet.
- `OverallReceiptsTab.tsx`/`WeeklyReceiptsTab.tsx`/`MonthlyReceiptsTab.tsx` (the Records tabs' own
  voucher-*grouped* browsing tables, a separate and larger architecture keyed on `voucher_id` — a
  concept a settlement doesn't have) have the identical underlying gap but were not touched in this
  pass — the Entry tab fix above is what the acceptance criterion itself tests; these three are a
  follow-up if the client needs settlements reachable from the grouped report views too.

**Verified live** against `wentox_db`: created and posted a real settlement (₨2,500), confirmed
`settlements.service.js#list()` returns it with every field the new frontend code consumes
(`status`, `settlement_date`, `amount`, `from_name`, `to_name`) — the data layer both the fix and
its ongoing correctness depend on. The frontend logic itself is verified by a full, clean
type-check (structural typing meant the settlement-shaped entries unified with the existing
`NavEntry<T>` machinery with zero type errors) — no live click-through was possible in this
environment, noted as a limitation rather than claimed. Test settlement unposted and deleted
afterward. `npx tsc -b --force` full rebuild passes clean.

**Files:** `frontend/src/pages/ReceiptsPage.tsx`.

## 2026-09-15 — changes-14-09-26.md: G-02 (required-field keyboard trap — shared layer, partial rollout)

**What:** every field marked with the red asterisk should trap Enter/Tab/arrow-key advance while
it's empty, showing an inline validation message, releasing the moment it's filled — implemented
once in the shared field-navigation layer, never per page.

**The shared mechanism (`lib/fieldNav.ts` — already the one file `AppLayout.tsx`'s G-01 keyboard
handling and `SearchableSelect.tsx` both depend on, per its own header comment):**
- `isRequiredAndEmpty(el)` — native `required` attribute + `ValidityState.valueMissing`. Deliberately
  not a bespoke rule: a field only traps once it's actually marked `required`, inert everywhere
  else, so rollout to more fields later never touches this function again and can't drift between
  pages the way a bespoke per-page rule could.
- `blockIfRequiredEmpty(el)` — the single call every advance path makes before moving focus.
  Displays the message via the browser's native `reportValidity()` bubble, which positions itself
  correctly at the field automatically (works inside a portaled modal too) — no custom message
  component needed to satisfy "inline, under/next to the field."

**Wired into every path the item names**, in `AppLayout.tsx`'s window-level keydown handler plus
`lib/fieldNav.ts`'s shared `focusNextField()`:
- Enter — checked immediately before the existing next-field/submit logic.
- Tab — a new block; unlike Enter/arrows (which this app's G-01 code computes and moves itself),
  native Tab movement has no JS behind it at all today, so the trap is `e.preventDefault()` rather
  than computing a target field. Only forward Tab traps; Shift+Tab still retreats freely.
- Arrow-Right/Down — same trap, forward direction only. Arrow-Left/Up (backward) deliberately left
  alone — the item is about being carried *past* a field, not about being unable to retreat to fix
  it; trapping backward navigation would lock the user on the field they're trying to go back to.
- `focusNextField()` — the one shared advance point `SearchableSelect.tsx` and every page's own
  "pick from a modal, then move on" call sites already route through.

**Verified zero risk before marking anything `required`:** every current call site of
`focusNextField()` passes a `button[data-field-nav]` (a SearchableSelect trigger) — `isRequiredAndEmpty()`
only recognizes native `<input>`/`<select>`/`<textarea>`, so it's unconditionally `false` for all
of them today. Confirmed by reading every one of the ~15 call sites across the codebase before
writing a single line of the mechanism itself.

**Rolled out to 8 real fields as a working pilot** (not the full app-wide sweep — see below):
- `ReceiptsPage.tsx`: Amount, "Received Into" bank picker (a plain `<input>` search-trigger, not a
  `SearchableSelect` component, so it genuinely qualifies for the native-`required` path).
- `JournalVoucherPage.tsx`: Date, the entry strip's A/C Code search-trigger, Amount.
- `ExpensesPage.tsx`: Amount Paid, Cheque No./Cheque Date — `required={...}` conditional on
  `paymentMode`, matching the fields' own existing conditional asterisk exactly rather than a
  static attribute.

Confirmed the item's own "verify [the primary action button] still holds" requirement — all three
pages already have their own `buildPayload()`-style early-return validation blocking Save
regardless of this new keyboard-level trap; this item adds a second, earlier line of defense, not
a replacement for the first.

**Deliberately not done — explicit, low-risk follow-up, not silently dropped:**
- `SearchableSelect.tsx`-based pickers (account/vendor/customer/chart-account — the majority of the
  app's red-asterisk fields) aren't covered: a `<button>` has no native validity for
  `isRequiredAndEmpty()` to read. Needs its own small, separate addition — a `required` prop, an
  internal "is something selected" check, and its own inline message (native `reportValidity()`
  doesn't apply to a button) — scoped as a follow-up since it touches a heavily-shared component
  and deserves its own careful pass rather than a guess folded into this one.
- Roughly 9 more files still carry the red-asterisk marker with no `required` attribute yet (~80+
  marker occurrences found across 12 files total by grep; 3 files/8 fields done above). Adding
  `required` to each remaining field is mechanical, and — because the mechanism is inert until a
  field is actually marked — safe to do incrementally, one field or page at a time, with no drift
  risk between pages since there is only the one shared implementation.

**Verified:** `npx tsc -b --force` full rebuild passes clean. Traced every code path by hand rather
than a live click-through (not possible in this environment) — noted as a limitation rather than
claimed as browser-verified.

**Files:** `frontend/src/lib/fieldNav.ts`, `frontend/src/components/AppLayout.tsx`,
`frontend/src/pages/ReceiptsPage.tsx`, `frontend/src/pages/JournalVoucherPage.tsx`,
`frontend/src/pages/ExpensesPage.tsx`.

## 2026-09-15 — changes-14-09-26.md: LED-02 (business ledger narration — default account + mode of payment)

**What:** two-part item — investigate how narration is generated today (write it up before
touching anything, per the client's explicit ask), then extend it to show the counter-account and
payment mode. Two real definitions needed confirming with the client before coding.

**Investigation (part 1):** every ledger surface (Account/Business/Vendor Ledger, Overall Trail and
Overall Search's drill-downs) goes through one function, `reports.service.js#formatLedgerRow()` — a
switch on `source_type` that was inconsistent by document type: Receipt/Expense had
`rc_payment_mode`/`ex_payment_mode` already fetched and simply never shown; Transfer already showed
both account names as an accidental fallback; Settlement/JV/Cheque Endorsement left the raw stored
narration as-is; Sale Bill/Purchase/Wage Run/Salary Run/Opening Balance had no counter-account or
mode concept in their narration at all. Full per-type table written into `changes-14-09-26.md`
itself as the required PR write-up.

**Definitions confirmed with the client live** (via AskUserQuestion, mid-session): (1) a Journal
Voucher can have 3+ lines, so "the counter-account" isn't singular there — confirmed: show the
first other line only, matching every other document type's one-counter-account shape, rather than
listing all lines or excluding JVs. (2) "mode of payment" scope confirmed as Receipt + Expense
(the two types that actually record cash/cheque/bank at posting) plus Cheque Endorsement/Return
(always "Cheque" by definition) — Direct Settlement's own `payment_mode` is explicitly informational
(selects no posting target, per that code's own comment) and was confirmed excluded.

**Implementation (part 2):** `reports.repository.js#ledgerRows()` gained one correlated subquery —
for each row, the first *other* `ledger_entries` row sharing the same `source_type`+`source_id`
(by `entry_id`), resolved to its account name via `business_accounts`/`chart_of_accounts`.
`formatLedgerRow()` appends `— <counter account>` after its existing switch (skipped if that name's
already present in the narration — Transfer's own fallback already includes it, so no doubling up)
and, only for the three confirmed types, ` (<Mode>)` (`CASH`→Cash, `CHEQUE`/`CHEQUE_ENDORSED`/
`CHEQUE_ISSUED`→Cheque, `ONLINE`→Bank Transfer). Always appended, never substituted, per the item's
own "the user's text wins" rule.

**Verified live** against `wentox_db`: Receipt with no remarks → `"Receipt #4 — CHEQUES IN HAND
(Cheque)"`; Receipt WITH typed remarks → `"Advance for Sept order — CASH IN HAND (Cash)"` (the
exact acceptance-criterion shape); Transfer with no remarks → unchanged
`"Ahmed Footwear (LHR) → Karachi Boot House (KHI)"` (duplicate-name check correctly suppressed a
second append); Transfer WITH remarks → `"Month-end sweep — Karachi Boot House (KHI)"`; Journal
Voucher → `"<reason> — <first other line's account>"`; Cheque Endorsement →
`"Cheque #1 to vendor — CHEQUES IN HAND (Cheque)"`. Every test document unposted/reversed and
deleted afterward. Since every ledger view already renders `narration` as a plain string, this
change needed **no frontend edits at all** — every surface picks it up automatically.

**Noted, not fixed — pre-existing, out of scope:** Expense's own narration fallback
(`ex_remarks || ex_ba_name`) shows the expense/vendor account's own name when remarks are blank,
which reads oddly self-referential when viewed from that account's own ledger (flagged in
`changes-14-09-26.md`, not changed — not something this item asked to fix).

**Files:** `backend/src/repositories/reports.repository.js`, `backend/src/services/reports.service.js`.

## 2026-09-15 — changes-14-09-26.md: G-02 (required-field keyboard trap — full rollout, follow-up to the pilot above)

**What:** finish G-02 — extend the shared trap to `SearchableSelect`-based pickers (the majority of
the app's red-asterisk fields, explicitly deferred in the pilot entry above since a `<button>`
trigger has no native `required`/validity), then wire `required` onto every remaining native
input/select and every qualifying `SearchableSelect` call site app-wide.

**`SearchableSelect.tsx` support (`lib/fieldNav.ts` + `SearchableSelect.tsx`):**
- `isRequiredAndEmpty()` gained a second branch: for an `HTMLButtonElement`, reads
  `data-required`/`data-value-missing` attributes instead of `ValidityState` (which a button
  doesn't have).
- New `REQUIRED_BLOCKED_EVENT` (`'g02-required-blocked'`) constant — `blockIfRequiredEmpty()`
  dispatches it at the button in place of calling `.reportValidity()` (only exists on real
  form-validatable elements).
- `SearchableSelect` gained a `required?: boolean` prop: sets the trigger's `data-required`/
  `data-value-missing` attributes from `required`/`!value`; listens for `REQUIRED_BLOCKED_EVENT` on
  its own trigger ref and shows an inline "Please select an option." message directly under the
  button (satisfying the item's "inline, under/next to the field" requirement the same way the
  native `reportValidity()` bubble does for real inputs); the message clears the moment `value`
  becomes non-empty, mirroring how a native validation bubble disappears once its field is filled.

**Native-input rollout — 21 files**, adding `required` to every `<input>`/`<select>`/`<textarea>`
matching an existing (unmodified) red-asterisk label: `StoreSetupPage`, `AddaSetupPage`,
`CitySetupPage`, `CategorySetupPage`, `RegionSetupPage`, `VendorSetupPage`,
`SubCustomerSetupPage`, `ProductSetupPage` (Select Category search-trigger), `ChartAcSetupPage`,
`BankSetupPage`, `BusinessAcSetupPage`, `GroupAcSetupPage`, `SettingsPage` (credentials form only —
the system-reset password fields carry no asterisk and were left alone), `UserManagementPage` (5
fields: create-user + reset-password modal), `TransferPage`, `SaleBillPage`, `SaleReturnPage`,
`PurchasePage`, `PurchaseReturnPage`, `StockVoucherPage`. `CustomerSetupPage`'s Customer Name and
`ChequesTab`'s only marker (a `SearchableSelect`, handled below) were checked and needed no native
edit. `EmployeeSetupPage`'s Employee Name and `AddaSetupPage`'s Route checkbox-grid have no
red-asterisk marker in the current UI at all — confirmed a pre-existing gap, left untouched per
"only wire existing markers, never add new ones."

**`SearchableSelect` rollout — 12 call sites**, found by grepping every `<SearchableSelect` call
site app-wide (~55 total) and checking each one's surrounding label for either asterisk class the
codebase uses (`text-red-500` and `text-rose-500`/`600` — the second one was missed on the first
pass and caught by re-grepping for both): `ReceiptsPage` (Pay To, cheque-endorsement flow),
`TransferPage` (From, To, deposit-into Account), `ChequesTab` (Deposit Into), `SaleReturnPage`
(header Customer, line-item Color, Add-Sub-Customer-modal Region), `SaleBillPage` (line-item Color,
Add-Sub-Customer-modal Region, Add-Customer-modal Select Region), `PurchasePage` (Add-Vendor-modal
Select Region), `CustomerSetupPage` (Region — its sibling City field is explicitly labeled
"(Optional)" and correctly left alone), `SubCustomerSetupPage` (Region), `ChartAcSetupPage` (Parent
Group Account), `GroupAcSetupPage` (Account Class Category), `BusinessAcSetupPage` (Parent Chart of
Account). Every other call site — mostly report/search filter toolbars
(`ReportCashBookPage`/`SaleReportPage`/`SaleAnalysisPage`/`ReportStockPage`/`VendorReportPage`/
`ReportKhaataPage`/`OverallTrailContent`/`ProductLedgerContent`/`FindTab`), `VendorSetupPage`'s
optional Region/City, `ChequesTab`'s Vendor/Expense-Account fields, `EmployeeSetupPage` — was
individually confirmed to carry no red-asterisk marker and left unmarked.
`SearchCustomerPage.tsx`'s Customer filter does carry an asterisk but isn't inside a `<form>` at
all, so `focusNextField()`'s `closest('form')` lookup can never engage there regardless — correctly
left as-is rather than adding an inert prop.

Confirmed every wired field sits inside an actual `<form>` (checked via `grep -c '<form'` on each
touched file) so the field-nav mechanism genuinely applies, not just compiles.

**Verified:** `npx tsc -b --force` run after every single file edit throughout, clean every time,
including the final full-repo rebuild after the last change.

**Files:** `frontend/src/lib/fieldNav.ts`, `frontend/src/components/SearchableSelect.tsx`, and the
21+12 page/component files named above.

---

## 2026-09-15 — changes-14-09-26.md: G-06 (new data entry window opens on the default blank page, not a posted record)

**What:** a data entry window opening with zero unposted documents must land on a fresh blank
entry, not wherever the page's `mode` was left when the window last closed.

**How:** the bug in the spec's own framing ("opening a page when the unposted count is 0 lands on
posted records") isn't actually a fallback rule anywhere in the code — it's stale persisted UI
state. Every data entry page keeps `mode: 'new'|'edit'|'view'` in `usePersistentField`
(`frontend/src/hooks/usePersistentField.ts`), which writes through to localStorage and survives a
window close/reopen (and an app restart). Browsing to a posted record via First/Prev/Next/Find
sets `mode: 'view'`; nothing at mount ever reconciled that against the current unposted count, so a
window closed while viewing a posted record reopened on that same posted record even after every
draft had since been posted elsewhere or the unposted count had otherwise dropped to zero.

Fixed at the one place every page already fetches its unposted list on mount: once that fetch
resolves, if the result is empty **and** the persisted `mode` is `'view'`, call the page's own
`handleNew()` to reset to a blank entry. `mode === 'new'`/`'edit'` is left completely untouched —
that's genuine unsaved in-progress work (a new unsaved entry, or a draft mid-edit) and must survive
a reopen exactly as today; this only corrects a stale "I was looking at a posted record" state.
`handleNew()` itself was already safe to call unconditionally in this situation, since `mode
=== 'view'` guarantees there's nothing unsaved on screen to lose.

Two shapes of the same fix, depending on how each page tracks "unposted": `SaleBillPage`,
`PurchasePage`, `SaleReturnPage`, `PurchaseReturnPage`, `JournalVoucherPage`, `StockVoucherPage`
each keep a dedicated unposted-list state (`unpostedBills`/`unpostedPurchases`/`drafts`/
`unpostedReturns`/`unpostedJvs`/`unpostedSvs`) refreshed by their own `refreshUnposted()` —
chained `.then(data => data.length === 0 && mode === 'view' && handleNew())` onto that mount-time
call. `ReceiptsPage` and `ExpensesPage` have no dedicated unposted list — they compute it as
`allVouchers.filter(v => v.status !== 'POSTED')` — so the check there is
`data.every(v => v.status === 'POSTED')` (true on an empty list too, correctly) chained onto their
`refreshAllVouchers()`.

`TransferPage` and `PaymentTrailPage`, both named in G-04's page list which G-06 explicitly reuses,
turned out not to apply: Transfer's `mode` is a `'transfer'|'deposit'` tab switch with no
posted/draft concept anywhere in it, and PaymentTrailPage is a read-only date-range report with no
entry form or `mode` at all. Confirmed by reading both before excluding them, rather than assuming
from the name list.

**Verified:** `npx tsc -b --force` clean after all 8 edits. No live Electron click-through possible
in this environment — this is a code-level fix verified by reading each page's actual mount-effect
and `handleNew()` reset logic, not a UI walkthrough.

**Files:** `frontend/src/pages/SaleBillPage.tsx`, `PurchasePage.tsx`, `SaleReturnPage.tsx`,
`PurchaseReturnPage.tsx`, `ReceiptsPage.tsx`, `JournalVoucherPage.tsx`, `StockVoucherPage.tsx`,
`ExpensesPage.tsx`.

---

## 2026-09-15 — changes-14-09-26.md: G-08 (clicking a detail row must not enter edit mode or highlight it)

**What:** editing a detail-grid row is now deliberate — a plain click on a row produces no visible
change at all (no edit load, no highlight); the user must click the row and then press a new
toolbar "Edit Row" button before the row loads into the entry band and the blue highlight appears.

**How:** every applicable page shared the same bug shape — the grid row's own `onClick` called the
load-into-edit function directly, which loaded the row AND applied the highlight in one step, with
no separate gate. Fixed on `SaleBillPage`, `PurchasePage`, `PurchaseReturnPage`, `SaleReturnPage`,
`JournalVoucherPage`, `StockVoucherPage` by adding a second, purely internal
`selectedIndex`/`selectedUid` state next to the existing `editingIndex`/`editingUid`: a row click
now only records that value (no className tied to it at all — the click is genuinely invisible,
not just inert-with-a-hint), toggling off on a second click of the same row. `editingIndex` alone
still drives the highlight and the entry-band load, and is now set exclusively by a new toolbar
"Edit Row" button acting on `selectedIndex`. The existing toolbar Delete button — already
dual-purpose (delete the selected line, or the whole document with nothing selected) — was
extended to fall back to `selectedIndex` when nothing is actively loaded for edit, so
click-then-Delete keeps working exactly as before; every existing reset of
`editingIndex`/`editingUid` to null (New, loading a different record, committing/cancelling an
edit, removing a row) was extended to also clear the new selection state.

`ReceiptsPage`/`ExpensesPage` have a different existing shape (an `isSelected` boolean computed
from `mode === 'edit' && ... === line.draft_id`, and a per-row pencil/trash icon pair with their
own `stopPropagation`, independent of the row's click) — the pencil icon already **is** the
deliberate second action G-08 wants, and there's no toolbar-level "act on selected line" concept on
these two pages worth preserving a selection for, so the fix there was simply removing the row's
own `onClick` (which duplicated the pencil's load call) entirely, leaving a click fully inert.

`TransferPage`/`PaymentTrailPage` (named via G-04's reused page list) confirmed out of scope by
reading: Transfer's clickable tables are document-browse lists (First/Prev/Next-equivalent), not
detail/line-item rows; PaymentTrailPage is a read-only report with no entry/edit concept.

Judgment call: per the acceptance test's literal wording ("nothing changes on screen"), selection
is fully invisible until Edit Row is pressed — no subtle indicator marks the pending Delete target
either. Noted in `changes-14-09-26.md` as worth revisiting if the client's walkthrough wants a
lighter "selected" cue preserved.

**Verified:** `npx tsc -b --force` run and clean after every single file's edit. No live Electron
click-through possible in this environment — verified by reading each page's actual click handler,
highlight className, and toolbar button wiring, not a UI walkthrough.

**Files:** `frontend/src/pages/SaleBillPage.tsx`, `PurchasePage.tsx`, `PurchaseReturnPage.tsx`,
`SaleReturnPage.tsx`, `JournalVoucherPage.tsx`, `StockVoucherPage.tsx`, `ReceiptsPage.tsx`,
`ExpensesPage.tsx`.

---

## 2026-09-15 — changes-14-09-26.md: RP-02 (Amount required field) — closing the focus-trap gap now that G-02 exists

**What:** the required-Amount focus trap on Receipts/Payments, left as "not done, depends on G-02"
in the 2026-09-14 pass, is now closed — a typed "0" traps the same way a blank field does.

**How:** G-02's shared trap (`lib/fieldNav.ts#isRequiredAndEmpty`) only ever checked
`ValidityState.valueMissing`. Both Amount fields already had `required` and `min={0}` — a typed
"0" satisfies both (non-empty, not below a min of 0), so the trap silently let it through even
though save-time validation (`buildPayload`'s `amount <= 0` check, already in place) still rejected
it on Save. Fixed at the shared function rather than bolting on an Amount-specific special case:
`isRequiredAndEmpty` now checks `el.required && !el.validity.valid` — any native constraint
failure on a required field traps, not just a missing value. This is a strict superset of the old
check and provably inert everywhere else already using `required`: grepped every `required` field
in the app for a `min=`/`pattern=` alongside it and found only two more (Cartons on
`SaleBillPage.tsx`/`SaleReturnPage.tsx`, `min={0.1}`) — a 0-cartons line item failing that
should trap too, so this is a fix there as well, not a regression risk. Then changed both Amount
fields' `min={0}` to `min={1}` (integer currency, via the existing `parseInt`) so "0" is now a real
`rangeUnderflow` for the broadened check to actually catch.

**Verified:** `npx tsc -b --force` clean. No live Electron click-through possible in this
environment — verified by reading the native `ValidityState` semantics and confirming no other
`required` field in the app combines `required` with a constraint a legitimately-filled value could
still fail.

**Files:** `frontend/src/lib/fieldNav.ts`, `frontend/src/pages/ReceiptsPage.tsx`,
`frontend/src/pages/ExpensesPage.tsx`.

---

## 2026-09-15 — changes-14-09-26.md: RP-01 (direct settlements missing from posted records) — closing the Weekly/Monthly/Overall Records-tabs follow-up

**What:** RP-01's own audit had already fixed the Receipt Entry tab's First/Prev/Next/Find (the
acceptance criterion's literal ask) and flagged three more views with the identical gap as an
optional follow-up: `OverallReceiptsTab.tsx`, `WeeklyReceiptsTab.tsx`, `MonthlyReceiptsTab.tsx` —
the "Records" tabs that browse posted receipts grouped by voucher. A direct settlement made from
Receipt Entry still never showed up there. Closed that follow-up now, completing the item.

**How:** each of the three tabs already fetched `receipts.list()` + `receiptVouchers.list()` and
grouped receipt lines into `{ voucherId, receipts, totalAmount }` cards. A settlement is a
standalone `dbo.settlements` row with no `voucher_id`/lines, so it can't join that grouping —
added a parallel `api.settlements.list({ status: 'CONFIRMED' })` fetch to each tab's `refreshAll`,
filtered through the same date-range + name-query logic each tab already applies to receipts
(matching a settlement's own `from_name`/`to_name` instead of one account name), and merged the
result into a new discriminated `recordGroups` list (`{ kind: 'voucher', ... } | { kind:
'settlement', settlement, totalAmount }`) that the outer table now actually renders, instead of
`voucherCardsData` directly. A settlement row shows "Settlement #<id>" in the C.Book No column and
a distinct badge instead of a receipt-count badge; clicking one opens a parallel detail view
(Date/From/To/Mode/Remarks/Amount, a single row) with its own Unpost button
(`api.settlements.unpost`). Unposting there needed the same "land back on Entry with it loaded"
behavior the existing voucher Unpost already has — added `handleSettlementUnpostedElsewhere` to
`ReceiptsPage.tsx`, mirroring `handleVoucherUnpostedElsewhere` and reusing `openSettlementInEntry`
(already built for the Entry-tab half of RP-01), then wired a new `onSettlementUnposted` prop onto
all three tabs alongside the existing `onVoucherUnposted`.

The remaining "Not done" item from the original pass — a payment-side settlement showing in the
Payments (Expenses) list — is unchanged and still genuinely out of scope: `ExpensesPage.tsx` has no
Direct Settlement creation UI at all, so there's nothing yet that could be missing from that list;
closing it means building a new feature, not fixing an existing gap.

**Verified:** live against `wentox_db` — created a settlement (₨2,500, Ahmed Footwear (LHR) →
Karachi Boot House (KHI)), posted it, confirmed `settlements.service.js#list({ status: 'CONFIRMED'
})` returns exactly the shape (`from_name`/`to_name`/`amount`/`status`) the new frontend code
consumes, then unposted and deleted the test row. `npx tsc -b --force` full rebuild clean. No live
Electron click-through possible in this environment — the frontend logic itself was verified by
reading the merged rendering path end to end and by the clean type-check, not a UI walkthrough.

**Files:** `frontend/src/components/OverallReceiptsTab.tsx`, `WeeklyReceiptsTab.tsx`,
`MonthlyReceiptsTab.tsx`, `frontend/src/pages/ReceiptsPage.tsx`.

---

## 2026-09-15 — changes-14-09-26.md: G-04 (row-area scrolling on data entry pages)

**What:** the client's walkthrough landed (a photo of the legacy reference system, red box around
the fixed toolbar/header/entry area, blue box around the scrollable line-item grid), confirming the
doc's own default assumption exactly — so this item, previously blocked, is now unblocked and done.

**How:** before writing anything, checked whether any page already had this — found 6 of the 8
applicable pages (`SaleBillPage`, `PurchasePage`, `SaleReturnPage`, `PurchaseReturnPage`,
`JournalVoucherPage`, `StockVoucherPage`) already fully implement it: each measures its entry
card's own height via `getBoundingClientRect()` on mount/resize (`entryCardHeight`/
`invoiceCardHeight`, `Math.max(<floor>, window.innerHeight - top - 32)` — the `-32` accounting for
`AppLayout`'s `<main>`'s own bottom padding, the app's one shared scroll container), sets that as
the card's fixed height, lays the card out as a flex column with the entry fields and totals
footer `shrink-0` and only the line-items table `flex-1 min-h-0 overflow-y-auto`. This predates the
current change-request batch (a general UX pass, going by the comments crediting "SaleBillPage" as
the original) and happens to satisfy G-04 exactly as specified.

Extended the identical pattern to the two pages that lacked it — `ReceiptsPage` and `ExpensesPage`
— whose entry cards previously grew unbounded (form + entries table + totals all in normal flow),
leaving `AppLayout`'s `<main>` to scroll the whole page once content overflowed. Added the same
`entryCardRef`/`entryCardHeight` hook, wrapping deps on `activeTab`/`mode`/`lookupError`/
`errorMsg`/`successMsg` (whatever can change the chrome height above the card), made the entry
`<form>` and the totals/post-result-banner footer `shrink-0`, and made only the entries table's own
wrapper `flex-1 min-h-0 overflow-auto` with `sticky top-0 z-10 bg-slate-50` on each `<th>` (matching
`SaleBillPage`'s own line-item grid) so the column headers stay visible while scrolling.

`PaymentTrailPage`/`TransferPage` (both named in the item's own page list) are out of scope, same
reasoning already established for G-06/G-08: PaymentTrailPage is a read-only report with no entry
form; TransferPage has no multi-line document/detail-grid concept at all.

G-05 (the row pointer) is deliberately NOT included here even though the item says to implement
them together — the grid this pass builds is exactly the prerequisite G-05 needs, but the pointer
itself (a gutter marker + auto-scroll-to-it behavior) is a separate not-yet-built UI element with
its own acceptance criterion, tracked as its own follow-up.

**Verified:** `npx tsc -b --force` clean after each file. No live Electron click-through possible in
this environment — verified by reading each page's actual flex/height/overflow wiring and
confirming it matches the already-working pattern on the 6 pages that had it before this session,
not a UI walkthrough.

**Files:** `frontend/src/pages/ReceiptsPage.tsx`, `frontend/src/pages/ExpensesPage.tsx`.

---

## 2026-09-16 — changes-14-09-26.md: G-05 (last-record pointer in the detail grid)

**What:** a ▶ marker in a narrow gutter column, sitting on whichever detail row was most recently
added or updated from the entry strip, auto-scrolling the (now fixed-height, per G-04) grid into
view when that row would otherwise be off-screen. The one item explicitly deferred alongside G-04
("implement together... a fixed-height scrolling grid is what makes the row pointer meaningful"),
now unblocked since G-04 landed the day before.

**How:** new state — `lastEnteredIndex`/`lastEnteredUid`/`lastEnteredLineId` depending on the page
— deliberately separate from G-08's `selectedIndex`/`editingIndex`: the item's own text says the
pointer "must not look like, or behave as, the [G-08] highlight", so it's set ONLY when a row is
actually committed (Add/Update Row), never by a click, and rendered as a plain `▶`
(`text-emerald-600`) in its own unlabeled 18px gutter column — never a background/highlight, so it
can't be visually confused with G-08's blue edit fill. Auto-scroll via a `rowRefs` array/map (keyed
however that page already keys its rows) plus one `useEffect` that calls
`rowRefs.current[pointer]?.scrollIntoView({ block: 'nearest' })` whenever the pointer moves.

Three variants of the same idea, matched to how each page already tracks its own rows:
- **Index-keyed** (`SaleBillPage`, `SaleReturnPage`, `JournalVoucherPage`, `StockVoucherPage`): the
  pointer index is computed BEFORE the `setItems`/`setLines` call — a functional updater can't hand
  a value back out synchronously — following each page's own existing merge-duplicate/
  edit-in-place/append-new branching so a merged row points at what it merged into, an edited row
  keeps its index, a new row points at the array's new last slot.
- **Uid-keyed** (`PurchasePage`, `PurchaseReturnPage` — rows can leave the middle of the array, so
  these two already key by a generated `uid` rather than position): `lastEnteredUid` + a
  `Record<string, ...>` ref map instead of an array. The new row's `uid` is now generated up front
  in `commitCurrentRow` (it used to be generated inline inside the `setItems` call, unreachable
  from outside it) specifically so it can double as the pointer target.
- **Server-line-keyed** (`ReceiptsPage`, `ExpensesPage` — a line commit is a real API round-trip,
  and the grid re-fetches from the server after every commit rather than mutating a local array):
  `lastEnteredLineId` holds the committed line's own `draft_id`, read straight off
  `draftReceipts`/`draftExpenses`'s `create`/`update` result and set right after `refreshVoucher()`
  so the ▶ and the scroll land together, the instant the row is actually on screen.

Reset to `null` everywhere each page's own G-08-era `setSelectedIndex(null)`/`setSelectedUid(null)`
already resets in a genuine "load a different record"/"start fresh" context (`handleNew`, opening a
different bill/voucher/settlement) — found by grepping every existing call site and adding the
sibling reset next to it, explicitly skipping the "load a row into the edit strip" sites (re-editing
an existing row isn't "entering a new record", so the pointer stays where it was). Row removal
adjusts/clears the pointer the same way `editingIndex` already does on the same delete.

`TransferPage`/`PaymentTrailPage` confirmed out of scope again, same reasoning as G-04/G-06/G-08.

**Verified:** `npx tsc -b --force` clean after every one of the 8 files. No live Electron
click-through possible in this environment — verified by reading each page's actual pointer-index
arithmetic, gutter-column JSX, and reset-site coverage, not a UI walkthrough.

**Files:** `frontend/src/pages/SaleBillPage.tsx`, `PurchasePage.tsx`, `PurchaseReturnPage.tsx`,
`SaleReturnPage.tsx`, `JournalVoucherPage.tsx`, `StockVoucherPage.tsx`, `ReceiptsPage.tsx`,
`ExpensesPage.tsx`.

---

## 2026-09-16 — changes-14-09-26.md: JV-04 (row deletion) — closing the row-pointer reposition half now that G-05 exists

**What:** JV-04's own 2026-09-15 pass fixed the actual delete bug and added the per-row delete
icon, but explicitly left one acceptance detail open pending G-05: "the row pointer repositions
sensibly after a delete — to the row that took the deleted row's place, or the last row if the
deleted one was last." G-05 landed 2026-09-16; this closes that gap.

**How:** G-05's own rollout gave every page's row-removal function the same behavior — clear the
pointer if the deleted row was the one it pointed at, otherwise shift it down by one if a row
above it was removed. That's correct for G-05's own spec (which never asked for a reposition), but
JV-04's acceptance text is more specific. Changed `JournalVoucherPage.tsx`'s `removeLine` only: when
the deleted row was the pointer, instead of `setLastEnteredIndex(null)`, computes
`newLength = lines.length - 1` (read before the `setLines` filter commits) and sets
`Math.min(idx, newLength - 1)` — the row that now occupies the deleted row's old slot, or the new
last row if it was the last one — falling back to `null` only when the grid is now empty. The other
7 pages' G-05 behavior is untouched; none of their own items asked for this.

**Verified:** `npx tsc -b --force` clean.

**Files:** `frontend/src/pages/JournalVoucherPage.tsx`.

---

## 2026-09-16 — changes-14-09-26.md: JV-02 (Journal Voucher page redesign, frontend only)

**What:** matched `JournalVoucherPage.tsx`'s entry-band layout and overall density to the client's
reference photo (`ref-pics/batch2/jv2.0.jpeg`) and the doc's own already-decided target layout —
this item wasn't actually blocked (it isn't in the doc's "Blocked on the client" table, only listed
in the Sequencing note as "do it after JV-01/JV-03/JV-04," which are all done), so it was picked up
directly once the user pointed at the reference photo.

**How:**
- Renamed the header band's visible "Reason" label to "Remarks" (matching the reference exactly)
  in three places that all name the same field: the header input, the Find-modal placeholder, and
  the Recent Vouchers search placeholder/column header. The underlying field/state is still
  `reason`, untouched — a display label only, JV-03's optionality unaffected.
- Resolved one real ambiguity with the user before writing code: the reference's row 2 shows a
  second boxed field under Amount, and the spec's own text just calls it "the second right-aligned
  amount box." Since the app deliberately uses one signed Amount (ACC-01), adding a literal second
  editable amount would be new behavior this "frontend only" item doesn't authorize — confirmed
  with the user it's the picked account's own read-only running balance, so wired the existing
  `AccountBalanceTooltip` component (same one Receipts/Expenses already use next to their account
  pickers) into that slot, with a new `balanceRefreshKey` state bumped after save/post/unpost
  (mirroring the exact pattern those two pages use) so it doesn't go stale after this JV's own
  ledger effect.
- Implemented the client's explicit tab-order reordering ("Narration comes before the amount")
  via CSS Grid `gridTemplateAreas` rather than reordering the visual layout: the JSX's DOM order is
  now A/C Code → Account Description (disabled, so `fieldNav.ts`'s shared field-walk skips it
  automatically) → Narration → Amount → the balance box (no input, never in the walk), each still
  placed into its reference-matching visual cell via `gridArea` — giving the requested Code →
  Narration → Amount tab sequence while Amount stays visually in row 1 and Narration in row 2,
  exactly like the photo. Moved the commit-on-Enter handler from Narration's `onKeyDown` to
  Amount's, since Amount is now the strip's actual last tabbable field.
- Compactness pass: card padding `p-6`→`p-3 md:p-4`, header/entry bands' `gap-4`/`mb-4`/`p-4`
  →`gap-2`/`mb-2`/`p-2`, and every header/entry input's bare `soleria-input` + inline `style={{
  fontSize: '13px' }}` hack → the shared `soleria-input-compact` class (matching
  `SaleBillPage`/`ReceiptsPage`'s own convention) — closing the density gap the client's own
  "strip the extra vertical whitespace" note called out. The detail grid's column set, G-05 pointer
  gutter, JV-04 delete icons, and Net Total footer were already correct from earlier passes and
  untouched here.

**Verified:** `npx tsc -b --force` clean. Called `reports.service.js#accountBalance` (the balance
tooltip's backing endpoint) live against `wentox_db` for a real account — returned its correct
current balance. No live Electron click-through possible in this environment — the layout/tab-order
logic was verified by reading the actual `gridTemplateAreas`/DOM-order wiring, not a UI walkthrough.

**Files:** `frontend/src/pages/JournalVoucherPage.tsx`.

---

## 2026-09-16 — changes-14-09-26.md: BA-02 (Search & Bilty Adda Updation page redesign)

**What:** closed out BA-02's remaining "redesign" half — the compacting half was already done
2026-09-14; the redesign itself had been explicitly left blocked pending a client walkthrough,
which landed as a reference photo (`ref-pics/batch2/billity adda.jpeg`) of the legacy
"SEARCH & BILTY ADDA UPDATION" screen.

**How:** the reference shows one consolidated dense toolbar (search filters + the
selected-invoice Bilty/Adda update cluster + Update/Print buttons, all one strip), a single row of
radio filters beneath it, then the results grid. `BiltyUpdatePage.tsx` previously had this split
across two side-by-side cards ("Bilty Info Update" and "Search Filters") plus a separate results
toolbar holding the print-preview button. Merged all of it into one toolbar card laid out as three
bands matching the reference: search filters (one wrapping row), the update cluster with Update and
Print together at the end (the old "Show Print Preview" button moved up here and was relabeled
"Print" to match), then the bilty-status/sort-by radio pills combined into one row instead of two
side-by-side columns. The results-count/status badges strip (a useful addition from the earlier
build, not present in the reference) was kept, just moved below the new toolbar.

One judgment call confirmed with the user before writing code: the reference shows a single "By
Date" box, but the page already has a more capable Start/End date RANGE filter. Confirmed keeping
the range rather than regressing to match the photo literally — every other existing field
(Manual/System Bill No. split from BA-01, the Bilty No. search filter, Customer/Sub-Customer
search) was likewise kept; the item's own scope is layout, not removing capability.

**Verified:** `npx tsc -b --force` clean. No live Electron click-through possible in this
environment — the layout was verified by reading the actual JSX structure against the reference
photo, not a UI walkthrough. Purely a JSX rearrangement — same state, same handlers, same API
calls as before, so no behavior/backend verification was needed.

**Files:** `frontend/src/pages/BiltyUpdatePage.tsx`.

**Follow-up (same day):** user-reported screenshot showed the search-filters row's fields reading
as one merged blur — at up to 7 columns per row, this app's own `--border-color` (`#E3E0D8`, a very
light off-white) gave adjacent fields essentially no visible separation once the gap between them
got tight. Backed off to `md:grid-cols-3 lg:grid-cols-4` (wraps 7 fields to 2 rows) with `gap-x-4`
instead of `gap-2`, and widened the update-cluster row's gap the same way — matching how
`SaleBillPage`/`ReceiptsPage` never pack more than ~4 fields into one row for exactly this reason.
`npx tsc -b --force` clean.

**Two more follow-ups (same day), per the user:**
1. Selecting a row's Edit icon now focuses the Bilty No. input (`updateBiltyNoRef`, new) —
   "Selected Bill No." is read-only, so that's the first field there's actually anything to type
   into. Separate from `firstFieldRef` (G-03's own page-open focus).
2. The Show/Sort By filters were pill-style toggle buttons with a small dot — swapped for real
   `<input type="radio">` elements (native circle, fills on selection, `accent-[#111c2a]`) with
   plain label text, per the user's own screenshot showing what they wanted instead.
`npx tsc -b --force` clean.

---

## 2026-09-16 — changes-14-09-26.md: G-06 — severe bug fix (posted record shows despite "Unposted" selected, on window reopen)

**What:** user reported: opening a new window with 0 unposted documents sometimes still showed a
POSTED document's data on screen, despite the Posted/Unposted dropdown defaulting to "Unposted" —
a severe, confusing mismatch. This is a real gap in G-06's own 2026-09-15 fix, not a new item.

**How:** G-06's fix only reset to blank when `mode === 'view'` — but `mode` can also be `'edit'`
while a POSTED record is loaded, and G-06's check missed that entirely. Confirmed a concrete,
reachable path: `SaleBillPage.tsx#handleEditSpecificBill` (wired to the Weekly/Monthly/Overall
Records tabs' own "Edit" row action) calls `setMode('edit')` unconditionally on whatever row was
clicked — including an already-POSTED one (rows from those tabs are always `sale_bills`, i.e.
always posted). Closing the window there leaves `mode: 'edit'` + `currentBillIsPosted: true`
persisted; reopening skipped G-06's reset (wrong mode), while `browseFilter` (the Posted/Unposted
dropdown) is a plain `useState` that always defaults to `'unposted'` on mount, never persisted —
producing exactly the reported mismatch.

Fixed by switching the reset condition on 6 pages from `mode === 'view'` to each page's own
persisted "is the loaded record posted" flag: `currentBillIsPosted` (SaleBillPage),
`currentIsPosted` (PurchasePage, PurchaseReturnPage), `currentReturnIsPosted` (SaleReturnPage),
`isPosted` — derived from persisted `status` (JournalVoucherPage, StockVoucherPage). Each of these
is true if and only if an actual posted record is loaded, in EITHER `'view'` or `'edit'` mode, and
is only ever cleared by that page's own `handleNew()` — so it can never be true while there's
genuine unsaved new-document work to protect, same safety guarantee G-06's original fix had, just
keyed on the right signal.

Checked `ReceiptsPage`/`ExpensesPage` for the same gap before touching them: traced
`handleEditLine` (rejects `line.status === 'CONFIRMED'` outright) and the voucher-header Edit
button (`disabled={... || voucher.status === 'POSTED'}`) — neither page has any path into `'edit'`
mode on a posted voucher, so their original `mode === 'view'` condition is already correct;
left unchanged rather than fixed without a confirmed bug.

**Verified:** `npx tsc -b --force` clean. No live Electron click-through possible in this
environment — the bug path was confirmed by reading `handleEditSpecificBill`'s actual call sites
and each page's own `handleNew()`/posted-flag wiring, not a UI walkthrough.

**Files:** `frontend/src/pages/SaleBillPage.tsx`, `PurchasePage.tsx`, `PurchaseReturnPage.tsx`,
`SaleReturnPage.tsx`, `JournalVoucherPage.tsx`, `StockVoucherPage.tsx`.

---

## 2026-09-16 — Bug fix: Sale Return posting wrongly required GP No./Bilty No./Adda

**What:** user reported (screenshot): posting a Sale Return failed with "gp_no is required before
confirming" even though the GP No. field on screen is labeled "— optional" with no red asterisk —
the backend was silently enforcing a requirement the UI never told the user about.

**How:** `draftSaleReturns.service.js#confirm()` required `bill_no`, `gp_no`, `bilty_no`, AND
`adda_id` before posting. Every other document type disagrees: `saleBills.service.js`'s own
`validateHeader()` only requires `bill_no` (its own comment: "dispatch details filled in [later]"),
and `saleReturns.service.js`'s own `validateHeader()` — the function that actually runs on the real
insert path `confirm()` calls into — has the identical comment on the identical three fields:
"dispatch details that are often unknown when the return is [posted]" and also only requires
`bill_no`. `draftSaleReturns.service.js#confirm()`'s extra checks were a stale duplicate that never
got updated to match. Dropped the `gp_no`/`bilty_no`/`adda_id` checks, keeping only `bill_no` —
matching both the frontend's own "optional" labeling and Sale Bill's already-established
convention. Noted, not fixed (pre-existing, out of scope): unlike Sale Bill, Sale Return has no
BiltyUpdatePage-equivalent to fill these fields in after posting — that gap is real but wasn't
introduced by this fix, and keeping a requirement the UI never surfaced isn't the right way to
paper over it.

**Verified:** live against `wentox_db` — created a draft Sale Return with `gp_no`/`bilty_no`/
`adda_id` all left null, called `confirm()`, confirmed it posted successfully (`return_id`
assigned, all three fields correctly null on the resulting row). Unposted and deleted the test
record afterward, confirmed zero ledger entries/stock movements/rows remained. `node --check`
clean.

**Files:** `backend/src/services/draftSaleReturns.service.js`.

---

## 2026-09-16 — Bug fix: System No./C.Book No. preview showed before New was ever pressed

**What:** user reported: on every data-entry page, the System No./C.Book No. field showed a live
PREVIEW of the next number (e.g. "#27") any time the page was in a blank/new state — including
right when the page first opened, before New was ever clicked. Wanted it blank until New is
explicitly pressed. Confirmed with the user: a page reopening with a genuine in-progress,
never-saved draft restored from a previous session should still show the preview immediately
(that counts as New having effectively already happened) — only a page that's never had New
clicked and has nothing typed should show blank.

**How:** every page already has a `useHasPageDraft('<page-key>')` call — a hook that captures,
once at mount, whether there was genuine unsaved work restored from a previous session — which is
exactly "New already effectively happened." Added a new `hasClickedNew` state on every page,
seeded from that same `hasPageDraftAtMount`/`hasSaleBillDraft`/etc. value at mount (so a restored
draft starts `true`), and set to `true` inside `handleNew()` itself. Since every path that already
resets a page to a blank new document (the toolbar New button, G-06's own auto-reset-to-blank on a
window reopening with zero unposted, and "ready for the next one" after a successful Post) already
calls `handleNew()`, wiring it there covers all of them for free — no extra call sites needed.
Then changed the System No. field's fallback branch (the one that shows the preview when no real
number is assigned yet) from unconditional to gated on `hasClickedNew`: empty string instead of
the preview when `false`. `StockVoucherPage.tsx` needed the gate folded into its existing
three-way ternary (`svId != null` / `still loading, show '…'` / preview) rather than a simple
two-way swap, to preserve its own "still loading" state exactly as before.

**Verified:** `npx tsc -b --force` clean after every one of the 8 files. No live Electron
click-through possible in this environment — verified by reading each page's actual `handleNew()`
wiring and the field's display condition, not a UI walkthrough.

**Files:** `frontend/src/pages/SaleBillPage.tsx`, `PurchasePage.tsx`, `SaleReturnPage.tsx`,
`PurchaseReturnPage.tsx`, `JournalVoucherPage.tsx`, `StockVoucherPage.tsx`, `ReceiptsPage.tsx`,
`ExpensesPage.tsx`.

---

## 2026-09-17 — LED-01 extended to Purchase Return (per the user)

**What:** the purchase LEDGER's one-row-per-item grouping (LED-01, changes-14-09-26.md) now applies
to Purchase Return too — a return with more than one item expands into N+1 rows (one per item, plus
a totals row), same shape as a multi-item purchase; a single-item return renders exactly as before.

**How:** `reports.repository.js#ledgerRows()` had a `pur_items_json` correlated subquery guarded to
`source_type = 'PURCHASE'` only, joining `purchase_items`. Added an identical sibling subquery
(`pur_return_items_json`) guarded to `source_type = 'PURCHASE_RETURN'`, joining
`purchase_return_items` (same column shape: material_id, unit, quantity, price_per_unit,
total_price). `reports.service.js#formatLedgerRow()` now picks whichever JSON column matches the
row's own `source_type` and parses it into the SAME `purchase_items` field on the output row for
both types — deliberately one shared field name, not two, so the frontend's per-item expansion
logic only needs to also check `type === 'Purchase Return'` (`type` was already correctly set to
"Purchase Return" for these rows), not a second field name. Updated both places that do the
expansion — `ReportKhaataPage.tsx#runningKhaata` and `OverallTrailContent.tsx#expandedLedgerRows`
(the two components LED-01's own purchase pass already covered, since Vendor Balances/Business
Account Ledger route through the latter) — from `row.type === 'Purchase'` to
`(row.type === 'Purchase' || row.type === 'Purchase Return')`.

**Verified:** live against `wentox_db` — confirmed the existing single-item purchase return
(return_id 1) still shows one plain row (no regression). Created a temporary 2-item purchase return
(vendor 1, materials 2 + 2007), confirmed `reports.service.js#accountLedger()` returned both items
correctly in `purchase_items` on that ledger row, then unconfirmed and deleted the test draft —
confirmed zero rows remain in either `purchase_returns` or `draft_purchase_returns` for it
afterward. `npx tsc -b --force` clean; `node --check` clean on both backend files.

**Files:** `backend/src/repositories/reports.repository.js`, `backend/src/services/reports.service.js`,
`frontend/src/pages/ReportKhaataPage.tsx`, `frontend/src/pages/OverallTrailContent.tsx`.

---

## 2026-09-17 — Correction: System No. preview also showed after G-06's automatic reset

**What:** the "System No. blank until New is clicked" fix (logged above, 2026-09-16) was too loose
— user reported (screenshot) a freshly opened Sale Bill window with 0 unposted bills still showed
"#33" in the No. field, despite nobody clicking New. Corrected across all 8 pages.

**How:** the first version put `setHasClickedNew(true)` inside each page's `handleNew()` itself —
but `handleNew()` runs from many places, not just a deliberate click: G-06's own auto-reset-to-blank
effect, Post/Post All's "ready for the next one" auto-continue, a Posted/Unposted dropdown's
empty-list fallback, loading a specific voucher/settlement (which calls `handleNew()` first to
clear the strip before overriding with the loaded record), and a just-deleted-voucher cleanup. Any
of these running `handleNew()` was enough to reveal the preview.

Corrected: `handleNew()` itself now always sets `hasClickedNew` to **false** (every reset-to-blank
defaults to hiding the preview); only a deliberate "start a new document" UI action sets it **true**,
immediately after calling `handleNew()`/its wrapper. Read every call site of the reset function on
every page and classified each as deliberate (a human clicked a New-labeled button/tab) or
programmatic (everything else) — only deliberate sites got the `true`:
- **SaleBillPage/JournalVoucherPage/StockVoucherPage/SaleReturnPage**: the toolbar's own New
  button, plus (Sale Return, Journal Voucher, Stock Voucher) a "New Voucher"/"New Return" tab
  button in the Records tab bar.
- **PurchasePage/PurchaseReturnPage**: the toolbar's own New button, plus a "New Purchase"/"New
  Return" tab button.
- **ReceiptsPage/ExpensesPage**: only the toolbar's own New Voucher button — neither page has a
  second "New X" tab entry point.
- Left alone (programmatic, confirmed blank stays blank) on every page: G-06's mount-time
  auto-reset effect, Post/Post All's post-success "ready for the next one" reset, the
  Posted/Unposted (or Unposted/Records) dropdown's own "nothing to show, fall back to blank"
  branch, and loading a specific existing record/settlement (which resets via `handleNew()` first
  as a clearing step, not as "starting new").

**Verified:** `npx tsc -b --force` clean (checked after every file, and once more at the end across
the full repo).

**Files:** `frontend/src/pages/SaleBillPage.tsx`, `PurchasePage.tsx`, `SaleReturnPage.tsx`,
`PurchaseReturnPage.tsx`, `JournalVoucherPage.tsx`, `StockVoucherPage.tsx`, `ReceiptsPage.tsx`,
`ExpensesPage.tsx`.

---

## 2026-09-17 — Account deletion: investigated "not working" report, password-gated per the user

**What:** user reported account deletion "not working" and asked that it require a password first
(matching the app's other destructive-delete conventions). Investigated the "not working" claim
directly against `wentox_db`; added the password gate, which was genuinely missing.

**Investigation ("not working"):** live-tested all 4 account types' `remove()` end to end
(`businessAccounts.service.js`, `chartAccounts.service.js`, `groupAccounts.service.js`,
`bankAccounts.service.js`) with fresh, clean test accounts (no ledger activity, no party link, not
reserved, zero opening balance) — every one closed correctly (`status: 'CLOSED'`) with no error.
Read every frontend delete handler and the reserved-account (`is_reserved`) computation — no bug
found in any of them. Could not reproduce an actual failure; the most likely explanation is that
the account(s) the user tried to delete genuinely tripped one of ACC-02's own guards (has posted
ledger activity, is party-linked to a vendor/customer/employee/bank, is a reserved structural
account, or — Business Account only — has a non-zero opening balance) and the resulting error
banner wasn't clearly noticed as the reason nothing happened. Not fixed, because nothing reproducibly
broken was found — flagged back to the user for the specific account name/error if this recurs.

**Password gate (the fix):** none of the 4 account types' delete required a password, unlike every
other destructive delete in the app (bill/purchase/expense/receipt deletion). Added
`authService.verifyPassword(session.userId, payload.password)` to all 4 `*.ipc.js` remove handlers
(`businessAccounts`, `chartAccounts`, `groupAccounts`, `bankAccounts`), before calling into the
service's own `remove()` — same pattern `expenses:remove` already uses. Extended each frontend
`remove(id)` API wrapper to `remove(id, password)`, and the `window.api.*.remove` payload types to
carry it. On the frontend, replaced the delete confirmation UI with `PasswordPromptModal` (which
already verifies the password itself before calling `onSuccess`) on all 4 setup pages —
`BusinessAcSetupPage`/`ChartAcSetupPage`/`GroupAcSetupPage` swapped their shared `ConfirmModal` for
it; `BankSetupPage` had its own bespoke inline confirm dialog, replaced the same way for
consistency. One dialog now stands in for what used to be a two-step confirm-then-delete, matching
the rest of the app's convention where entering the password IS the deliberate confirmation.

**Verified:** live against `wentox_db` — `authService.verifyPassword` correctly rejects a wrong
password (`Incorrect password`) and accepts the real one; ran the exact IPC-handler sequence
(reject-then-accept) against a fresh test Business Account end to end — correctly refused with the
wrong password, then closed successfully with the right one. `npx tsc -b --force` and `node --check`
both clean.

**Files:** `backend/src/ipc/businessAccounts.ipc.js`, `chartAccounts.ipc.js`, `groupAccounts.ipc.js`,
`bankAccounts.ipc.js`, `frontend/src/lib/api.ts`, `frontend/src/pages/BusinessAcSetupPage.tsx`,
`ChartAcSetupPage.tsx`, `GroupAcSetupPage.tsx`, `BankSetupPage.tsx`.

---

## 2026-09-17 — Follow-up: "delete" only closed an account, it stayed visible everywhere

**What:** user clarified the actual complaint behind "deletion is not working": they meant a
"deleted" account should genuinely disappear, not just get an inactive badge while still showing
up in the setup page's own list and every account-picker dropdown across the app. Confirmed a real
hard delete isn't viable (many tables reference these accounts — drafts, settlements, transfers,
deposits, stock vouchers, cheque allocations — so a literal `DELETE FROM` would routinely fail on a
live foreign-key constraint unless every one of those was separately guarded against, and it would
give up the existing Reactivate/undo safety net). Asked the user directly; they chose: keep the
existing soft-close, but stop showing closed accounts anywhere by default.

**How, in two parts:**
1. **Setup pages' own lists.** `BusinessAcSetupPage`/`ChartAcSetupPage`/`GroupAcSetupPage` always
   fetched `includeInactive: true` and rendered every CLOSED account inline with a badge, with no
   way to hide them at all — unlike `BankSetupPage`, which already had a "Show inactive" toggle,
   off by default. Added the identical toggle ("Show closed") to the other three, filtering the
   main list client-side (`status === 'ACTIVE'` / `is_active` depending on the row shape) unless
   switched on, and threaded the same toggle into each page's own "children under this parent"
   nested fetch (business accounts under a chart, chart accounts under a group) so a closed child
   stays hidden there too. Reactivate remains reachable by switching the toggle on.
2. **Account-picker dropdowns app-wide.** Live-traced every non-setup page that loads business
   accounts to populate a picker (`JournalVoucherPage`, `ReceiptsPage`, `ExpensesPage`,
   `TransferPage`) and found `businessAccounts.repository.js#list()` defaults the OPPOSITE way from
   `bankAccounts`/`groupAccounts` (which default to active-only, `includeInactive` opts IN to
   showing closed/inactive) — it returns every account regardless of status unless the caller
   explicitly passes `excludeClosed: true`. Every one of those 4 pages called `listBusinessAccounts()`
   with no filter at all, so a closed business account was silently selectable as a payee/payer on
   a brand-new Journal Voucher line, Receipt, Expense, or Transfer. Added `excludeClosed: true` to
   all 4 call sites. Left `SaleBillPage`'s and `StockVoucherPage`'s own `listBusinessAccounts()`
   calls untouched — traced both and confirmed neither is a picker; they only resolve an id already
   chosen elsewhere (a customer's own linked account, the reserved Stock Transfer account) by
   lookup, not present a list of choices. `chartAccounts.repository.js#list()` has the identical
   inverted default, but no non-setup page calls it directly, so nothing to fix there.

**Verified:** live against `wentox_db` — closed a real test business account, confirmed
`businessAccounts.service.js#list({ excludeClosed: true })` correctly omits it while a plain
`list({})` still includes it (confirming the inverted-default diagnosis). `npx tsc -b --force`
clean. Cleaned up every test account/group/chart/bank row created while verifying this and the
prior password-gate entry (`TEST DELETE ACCOUNT`/`GROUP`/`CHART`/`BANK`, `TEST PASSWORD GATE
DELETE`) — confirmed zero rows remain.

**Files:** `frontend/src/pages/BusinessAcSetupPage.tsx`, `ChartAcSetupPage.tsx`,
`GroupAcSetupPage.tsx`, `JournalVoucherPage.tsx`, `ReceiptsPage.tsx`, `ExpensesPage.tsx`,
`TransferPage.tsx`.

## 2026-09-17 — Permanent (hard) delete, added on top of the soft-close, for all 4 account types

**What:** the user asked for a genuine hard delete — "add permanent delete option" — explicitly on
top of the soft-close/hide-everywhere behaviour just built above, not instead of it. Added a
second, stricter, irreversible action (`permanentDelete`) for Business Accounts, Chart Accounts,
Group Accounts, and Bank Accounts.

**Design:** a two-gate flow, identical shape across all 4 types:
1. The account must already be CLOSED (soft-deleted via the existing `remove()`) — `permanentDelete`
   refuses outright on an ACTIVE account with `ACCOUNT_NOT_CLOSED`.
2. A new `hasAnyReference()` repository check, per type, strictly broader than each type's existing
   "block a reversible close" guards (`hasLedgerActivity`/`isPartyLinked`/`hasChildren`/
   `isReferenced`, which only ever needed to cover what blocks a *reversible* close) — it covers
   every table+column with a live FK into the row, since a real `DELETE FROM` has to survive all of
   them or SQL Server throws a raw constraint error. Refuses with `ACCOUNT_STILL_REFERENCED` if
   anything is found.
3. Only then does an actual `DELETE FROM` run, inside `withTransaction`.
4. Password-gated identically to `remove()` (`authService.verifyPassword` in the IPC handler).

Per type, what `hasAnyReference()` covers beyond the existing guards:
- **Business accounts** (`businessAccounts.repository.js`): vendors/customers/employees/
  bank_accounts linked by `ba_id`, `ledger_entries`, `cheque_allocations.target_ba_id`,
  `deposits.to_ba_id`, draft/posted expenses and receipts (`ba_id` OR `online_ba_id`),
  `journal_voucher_lines`, `settlements` (`from_ba_id`/`to_ba_id`), `stock_vouchers.
  on_account_ba_id`, `transfers` (`from_ba_id`/`to_ba_id`).
- **Chart accounts** (`chartAccounts.repository.js`): any `business_accounts` row still filed
  under it, `ledger_entries.ac_id`, `draft_sale_bills`/`sale_bills`/`stock_vouchers.main_ac_id`.
- **Group accounts** (`groupAccounts.repository.js`): any `chart_of_accounts` row still filed under
  it, plus (one level further than the existing close guard checks) any `business_accounts` row
  resolved transitively through those chart accounts.
- **Bank accounts** (`bankAccounts.repository.js`): scoped the same way `remove()` already is —
  hard-deleting a bank account never touches its linked `business_accounts` row (kept for ledger/
  history integrity, same as the soft-close), so this only needs every FK pointing at `bank_id`
  itself: `cheques.bank_id`, `receipts`/`draft_receipts`/`expenses`/`draft_expenses.bank_id`.

Chart/group accounts also keep their existing reserved-account guard (`RESERVED_CODES`/
`STRUCTURAL_ACCOUNT_HEADS`) in `permanentDelete` — a reserved account can never even be closed, so
it can never reach the hard-delete path, but the check is repeated defensively rather than assumed.

**Frontend:** `api.ts` gained a `permanentDelete(id, password)` wrapper + type for all 4 account
APIs. Each setup page (`BusinessAcSetupPage`, `ChartAcSetupPage`, `GroupAcSetupPage`,
`BankSetupPage`) gained a second destructive action — an `XOctagon` icon button next to Reactivate,
visible only on an already-closed/deactivated row — opening its own `PasswordPromptModal` instance
with explicit "cannot be undone" wording distinct from the existing soft-delete modal's "can be
undone with Reactivate" wording.

**Verified:** live against `wentox_db`, for all 4 types — `permanentDelete` correctly refuses on an
ACTIVE/not-yet-closed row; correctly refuses once closed but still referenced (tested with a real
cross-table reference per type: a draft expense against a business account, a chart account filed
under a group, a chart account still active under a group, a draft expense with `bank_id` set); and
correctly succeeds and removes the row once closed and genuinely unreferenced, confirmed by a
follow-up lookup throwing "not found." All test rows created for verification were cleaned up
afterward — confirmed zero remain. `node --check` clean on every touched backend file; `npx tsc -b
--force` clean on the frontend.

**Files:** `backend/src/repositories/{businessAccounts,chartAccounts,groupAccounts,
bankAccounts}.repository.js`, `backend/src/services/{businessAccounts,chartAccounts,
groupAccounts,bankAccounts}.service.js`, `backend/src/ipc/{businessAccounts,chartAccounts,
groupAccounts,bankAccounts}.ipc.js`, `frontend/src/lib/api.ts`, `frontend/src/pages/
{BusinessAcSetupPage,ChartAcSetupPage,GroupAcSetupPage,BankSetupPage}.tsx`.

## 2026-09-17 — Business Accounts Setup: disable Delete for party-linked rows, not just reserved ones

**Bug:** the user reported (via screenshot) that every row in Business Accounts Setup — including
plainly customer-owned accounts like "Ahmed Footwear (LHR)" — had a fully clickable, non-greyed
Delete button, same as any ordinary account. Clicking it walked the user through the whole
password-prompt flow only to fail at the very end with `businessAccounts.service.js#remove()`'s
existing guard: "This account belongs to a vendor, customer, employee, or bank — manage it from
that setup screen instead." The guard itself was correct and always had been; only the reserved-
account rows (`is_reserved`, e.g. Cash in Hand) were ever pre-emptively disabled in the UI — a
party-linked row looked identical to a genuinely deletable one until the user had already entered
their password.

**Fix:** `businessAccounts.repository.js#list()` now computes `is_party_linked` per row (an EXISTS
check against `vendors`/`customers`/`employees`/`bank_accounts.ba_id`, the same four tables
`isPartyLinked()` already checked one row at a time inside `remove()` — just surfaced for every row
in one list query instead of only checked reactively at delete time). `businessAccounts.service.js
#list()` passes it straight through (already spreads the raw row). `BusinessAcSetupPage.tsx`'s
Delete button (and, defensively, the Permanent Delete button, though a party-linked row can never
actually reach CLOSED status since `remove()` blocks it before that point) is now also disabled
when `is_party_linked` is true, with a tooltip matching the backend's own wording — same treatment
`is_reserved` already got.

**Verified:** live against `wentox_db` — `businessAccounts.service.js#list({}, { role: 'ADMIN' })`
returns 47 rows, 26 flagged `is_party_linked: true`, and the flagged set is exactly the customer/
vendor/employee/bank-linked rows visible in the reported screenshot (Ahmed Footwear, Karachi Boot
House, Malik Traders, etc.). `node --check` clean; `npx tsc -b --force` clean.

**Files:** `backend/src/repositories/businessAccounts.repository.js`, `frontend/src/lib/api.ts`,
`frontend/src/pages/BusinessAcSetupPage.tsx`.

## 2026-09-24 — Journal Voucher: New/Edit split, always-visible row selection, drafts need not balance

**Requested by the user across one session, stated as a standing baseline for JV that later work
must not undo, and to be rolled out to the other document pages only after JV is tested.**

**1. New and Edit each got one job.** Previously the toolbar's Edit had to be pressed before a line
could be added — a press that had nothing to do with adding. Now the Master/Detail radio only
selects WHICH half New and Edit act on, and never unlocks anything itself: New+Detail appends a
line (header stays locked), New+Master starts a voucher, Edit+Master unlocks the header, Edit+Detail
edits the pointed-at row (the same job as Edit Row and the row's own edit button — all three kept,
per the user). Un Post now lands in view mode instead of pre-unlocking the detail half.

The lock could no longer be derived from the radio, because `useAutoEditScope` moves the radio on
any click — a stray click in the header would have unlocked it. So `editTarget` ('master' |
'detail' | null) was added as explicit state, set only by Edit or New, and `masterLocked`/
`detailLocked` now derive from it. `resetToNewVoucher()` was split out of `handleNew()` because
Post/Post All/Delete/"browse Unposted with nothing there" still mean "blank the form": routed
through the new `handleNew()` they would have appended a line to the voucher just posted or
deleted. The "New Journal Voucher" tab calls it directly too, since its label admits no other
meaning.

**2. Row selection is now visible, and live at all times.** G-08 (2026-09-15) required a row click
to produce no visible change at all; the user reversed the no-highlight half — an invisible
selection gave no clue why Edit Row/Delete had come alive. A click still never loads a line for
editing. Three row states are kept visually distinct by HUE, not weight, each with a 4px left bar:
loaded-for-editing `bg-blue-100`/blue-600, selected `bg-[#B08D57]/15`/gold, and G-05's ▶ gutter
marker. A first attempt (`bg-blue-50` vs `bg-slate-100`) was rejected by the user as "not
distinguisable" — near-identical lightness. Selection also had to stay live while another row sits
in the entry strip, so `loadLineIntoEntry` now keeps the selection instead of clearing it, and the
row/Edit Row buttons no longer disable themselves when `editingIndex != null`.

**3. Balance and line count became POSTING rules, not saving rules.** Per the user: a voucher "can
remain unposted and done button can be used" whether or not it balances. `validateBalance` became
`validatePostable` (>= 2 lines AND debit == credit) and is called only by `post()`;
`resolveLines()` no longer calls it, so create/update store an unbalanced draft. `validateLines`
dropped its own >= 2 floor to >= 1 — that floor, not the balance check, was what actually blocked
Done on the user's single-line voucher, and refusing to save the most unbalanced shape possible
while saving an unbalanced pair made no sense. One line is still required: Save allocates the
System No., and an empty voucher would burn a number on nothing. Frontend mirrors this exactly —
`isValid` (Save/Done) vs `isPostable` (Post/Save+Post).

**4. Deleting every line no longer resurrects them.** `usePersistentField` did persist the emptied
`lines: []`, but `useNewDocGate`'s `isFilled([])` is false — identical to a page never touched — so
the auto-open effect ran and re-fetched the saved copy from the database. `useNewDocGate` gained an
opt-in `emptiedEditCountsAsWork`, used only by the JV page, which treats a persisted `mode ===
'edit'` as genuine unsaved work. The other six pages using the hook are untouched.

**5. Two layout fixes.** The Post All result banner was a child of the toolbar row, which is
`flex-nowrap overflow-x-auto` — so its `w-full` could never wrap and it instead pushed the buttons
into horizontal overflow and squeezed the Posted/Unposted select to "Unpo…". Moved to a sibling
below the toolbar; the select got `shrink-0`. The dropdown also now shows counts like Sale Bill's,
from `navUnpostedList`/`navPostedList` (NOT raw `navVouchers`, which holds posted and unposted
together and would have overcounted Posted).

**Verified:** `npx tsc -b` clean; `npx eslint` unchanged at the 4 pre-existing React Compiler
errors (confirmed identical on the original file by stashing); `node --check` clean on both backend
files; `npm run build` clean. Tailwind arbitrary classes `border-l-[#B08D57]` and
`bg-[#B08D57]/15` confirmed present in the generated CSS rather than assumed. NOT verified by
driving the UI — screenshots are blocked under GNOME/Wayland (x11grab returns black, the Screenshot
D-Bus method returns AccessDenied); the user tested each round by hand.

**Note on the round trips:** several fixes appeared not to work because the running Electron had no
`VITE_DEV_SERVER_URL`, so `windowManager.js:94` was serving a `frontend/dist` bundle built hours
earlier while Vite ran unread alongside it. `backend/npm run dev` (`electron .`) always does this;
`npm run electron:dev` is the one with HMR. Worth making the dev path fail loudly.

**Workflow deviation:** `backend/CLAUDE.md` requires the `debugger` subagent after coding; that
agent type is not registered in this session ("Agent type 'debugger' not found"), so the diff was
self-reviewed instead — checked for stale `isBalanced`/`validateBalance` references (none), stray
`handleNew()` callers meaning "blank the form" (none left), and frontend/backend rule agreement
(save >= 1 line, post >= 2 + balanced).

**Files:** `frontend/src/pages/JournalVoucherPage.tsx`, `frontend/src/hooks/usePersistentField.ts`,
`backend/src/services/journalVouchers.service.js`, `backend/src/services/journalVouchers.math.js`.

## 2026-09-26 — Cheque Returns: hide CLEARED (and BOUNCED/RETURNED) endorsed cheques

**Bug (user-reported):** "Marked clear" cheques were still listed under Cheque > Returns.

**Cause:** `cheques.repository.js#listEndorsedAllocations` filtered on `ca.status = 'ACTIVE'`
(the ENDORSEMENT lifecycle) but not on `ch.cheque_status` (the CHEQUE lifecycle) — two independent
things. `cheques.service.js#markCleared` is a pure status flip that sets `cheque_status='CLEARED'`
and never reverses the allocation, so the allocation stays ACTIVE and the row kept appearing.
Confirmed in data: 10 such rows in wentox_prod (8 VENDOR_PAYMENT + 2 EXPENSE_PAYMENT), 2 in
wentox_db. The Return action itself was already guarded — `reverseAllocation()` rejects any cheque
in `TERMINAL_STATUSES = ['BOUNCED','RETURNED','CLEARED']` — so this was a misleading list, never a
bad posting.

**Fix:** added `"ch.cheque_status NOT IN ('CLEARED','BOUNCED','RETURNED')"` to the query's
conditions, mirroring that guard exactly. Leaves the genuinely returnable ENDORSED/
PARTIALLY_ENDORSED states. Query-side only — no schema/data change, no migration, corrects both
databases immediately. The issued-cheque source (`expenses.repository.js#listReturnableIssuedCheques`)
was already correct (`issued_cheque_status='PENDING'`; issued cheques have no CLEARED state).

**Verified:** `node --check` clean; live count before/after — wentox_prod 34 -> 24 (10 cleared
hidden), wentox_db 3 -> 1 (2 hidden); the 24 remaining in prod are exactly the ENDORSED rows.

**Workflow note:** plan was presented to the user and approved ("implement it") before coding, per
backend/CLAUDE.md rule 1. The rule-2 `debugger` subagent is not registered in this session, so the
change was self-reviewed instead.

**Files:** `backend/src/repositories/cheques.repository.js`.

## 2026-09-26 — Receipts/Jamma: endorsements (settlements) now use the standard toolbar like a receipt

**Bug (user-reported):** endorsing a cheque from one bank to another "does nothing" — after
composing it, pressing Enter/clicking Post had no effect.

**Cause (frontend only — backend verified fine):** an endorsement saves as a standalone
`dbo.settlements` row (no voucher). The standard toolbar Post was hardwired to the receipt voucher
(`handlePostVoucher`, `if (!voucher) return;` and `disabled: !voucher`), so it was a dead button
for a settlement. The only working Post was a SEPARATE "Post Endorsement" button appended at the
far right, which looked identical and was easy to miss — so clicking the obvious Post did nothing.
A prior fix had added that separate button without removing the dead standard one, which is why it
kept being reported. Backend confirmed correct end-to-end: created + posted a bank->bank CHEQUE
settlement via `settlements.service` against wentox_db (id 2002, POST -> CONFIRMED), then cleaned it
up (unpost + remove; verified 0 leftover settlement/ledger rows). wentox_prod NOT touched.

**Fix (per the user: "treat endorsement/settlement as a receipt also like a normal receipt"):** the
standard toolbar Post/Un Post/Edit/Delete now route to the settlement handlers when a settlement is
on screen (`isSettlementDoc = docKind === 'SETTLEMENT' && receiptId != null`):
- Post -> `handlePost` (settlements.post); enabled in view mode when unposted.
- Un Post -> `handleUnpost` (settlements.unpost); enabled in view mode when posted.
- Edit -> unlocks the fields; `handleDone` already routes to settlements.update.
- Delete -> password modal -> `api.settlements.remove` (DRAFT-only, no password backend-side; the
  modal still gates the irreversible action). Added `'settlement'` to the `PendingDelete` kind and a
  branch in `handleDeleteConfirmed` (resets to a new voucher when the deleted settlement was open).
The separate "Post/Unpost Endorsement" buttons were removed, so there is exactly one Post button
that always does the right thing. Removed the now-unused `Undo2`/`CheckCircle2` imports.

**Verified:** `npx tsc -b` clean; `npx eslint` shows the same 8 pre-existing React Compiler errors
as the pristine file (confirmed by stashing); `npm run build` clean. Not driven in the UI
(screenshots blocked under Wayland) — the backend path was exercised directly instead.

**Files:** `frontend/src/pages/ReceiptsPage.tsx`.

## 2026-09-26 — Current Stock full-colour matrix: add per-article Total (Ctn/Prs)

**Requested:** in the Current Finished Stock full-colour matrix report, add a total cartons figure
for each article — expressed as cartons/loose-pairs in the same shape each colour cell uses ("not
full carton like it is for each colour"), summed across all of the article's colours.

**Implementation (`frontend/src/pages/ReportStockPage.tsx`):** `colorReportRows` now also carries
`totalCartons`/`totalLoosePairs`, RE-NORMALISED against the article's packing
(`effective_packing`) rather than naively summing each colour's cartons and extra_pairs — a colour's
loose pairs summed across colours can add up to whole cartons (e.g. article 100: BROWN 9/6 + BLUE
15/6 = 300 pairs -> 25/0 at packing 12, not 24/12). Safe because packing is uniform across a single
article's colours (verified on live data: 0 of 104 articles mix packing); a `packing > 0` guard
falls back to a plain sum otherwise. Added a "Total (Ctn/Prs)" column before "Total Pairs" in all
three render sites: the printable current-stock matrix (the one in the report screenshot), the
modal's own print block, and the on-screen full-report modal table, plus the Excel export. The
grand-total ("Report Total") row shows "—" for that column on purpose: cartons are only meaningful
within one packing, so summing them across articles of different packing would be a meaningless
number; the pairs grand total is unchanged.

**Verified:** carton math checked against live data (article 100 -> 25/0); `npx tsc -b` clean;
`npx eslint` shows the same 4 pre-existing React Compiler errors as the pristine file (confirmed by
stashing); `npm run build` clean. wentox_prod read-only (SELECT only). Not driven in the UI
(screenshots blocked under Wayland).

**Files:** `frontend/src/pages/ReportStockPage.tsx`.

## 2026-09-26 — CHEQUES IN HAND moved from its own chart head to a business account under BANKS

**Requested by the user (investigated and approved first):** make CHEQUES IN HAND a business
account under the BANK ACCOUNTS chart head, move all its existing ledger there, and post future
entries there — "cheque in hand will be an account under banks." Decisions: fresh account (not the
client's stray hand-made "CHECKS IN HAND" ba 209), and close the old 100004 chart account.

**Background:** CHEQUES IN HAND was chart account 100004 that ledger_entries posted to via `ac_id`
directly (unlike banks, which are business accounts under 100003 reached via `ba_id`). On
wentox_prod it held 203 entries (122 RECEIPT + 81 CHEQUE_ALLOCATION), net 5,497,000. The client had
also hand-created an empty "CHECKS IN HAND" bank sub-account — the duplication this resolves.

**Resolution mechanism:** the new business account sits under BANK ACCOUNTS (many accounts), so it
can't be found by parent ac_id like Cash is, and its 10-digit code is serial-assigned. It is marked
with `business_accounts.link_code = 'CHEQUES_IN_HAND'` (a column nothing else uses) and resolved by
`businessAccounts.service#getChequesInHandAccount()`. New constant `CODES.CHEQUES_IN_HAND_BA_LINK`.

**Code (all posting/report reads switched from the chart ac_id to the ba):**
- `cheques.service.js` — 5 sites (deposit, endorseToVendor, endorseToExpense, reverse, reverseAllocation): `ac_id` → `ba_id`.
- `receipts.service.js#resolveDebitSide` — CHEQUE mode returns the ba now.
- `reports.service.js` / `reports.repository.js#cashBookUnpostedSides` — cheque head resolved as the ba; the posted cash-book both-sides query needs no change (a cheque movement's parent ac_id IS BANK ACCOUNTS, already caught by bankAcId).
- `businessAccounts.repository.js#findByLinkCode`, `businessAccounts.service#getChequesInHandAccount`.
- `db/seeds/run.js` — removed the 100004 chart account; added `ensureChequesInHandAccount()` (idempotent by link_code) under BANK ACCOUNTS.

**Migration `038_cheques_in_hand_under_banks.sql`:** existing DBs only (gated on 100004 being
ACTIVE, so fresh installs skip and re-runs are clean no-ops). Creates the ba (next serial under
100003, link_code marker), repoints every `ac_id=100004` ledger row to `ba_id`/`ac_id=NULL` in one
statement, guards that nothing remains on the old head and the net balance is unchanged, then closes
100004. Relies on tedious's default QUOTED_IDENTIFIER ON for the filtered-index DML (same as
migration 019).

**Frontend:** no change. 100004 stays in `RESERVED_ACCOUNT_CODES` so the closed legacy head stays
badged and locked from edit/delete in Chart of Accounts; the new CHEQUES IN HAND shows under banks.

**Verified on a COPY of wentox_prod** (backed up copy-only, restored as wentox_migtest, dropped
after — prod never touched): migration moved all 203 entries, net 5,497,000 preserved, 0 left on
100004, 100004 CLOSED, trial balance still 0; re-run is a clean no-op; seed creates no duplicate;
`getChequesInHandAccount()` resolves ba 1000030016 under BANK ACCOUNTS. Full backend suite 21/21
pass (incl. cheque disposal, split-deposit, reports). `node --check` clean on all 8 changed files.

**NOT YET RUN ON wentox_prod** — the user runs migrate against prod when ready (per the read-only
rule). Files: `backend/src/db/migrations/038_cheques_in_hand_under_banks.sql`,
`backend/src/services/{cheques,receipts,businessAccounts,reports}.service.js`,
`backend/src/repositories/{businessAccounts,reports}.repository.js`, `backend/src/db/seeds/run.js`,
`backend/src/constants/reservedAccounts.js`.

## 2026-09-26 — Overall Trail: group CHEQUES IN HAND (and any bare bank-chart account) under BANK

**Bug (user-reported after migration 038):** on the Overall Trail report, CHEQUES IN HAND showed
under the "BUSINESS ACCOUNT" section instead of "BANK", even though it sits under the BANK ACCOUNTS
chart head.

**Cause:** `reports.repository.js#businessAccountsWithCategory` classified the section by PARTY
LINKAGE — a business account counts as BANK only if it has a `dbo.bank_accounts` detail row. Every
real bank (and the client's holding buckets like PDCS, DEPOSIT AT IRFAN) has one; the new CHEQUES IN
HAND business account (migration 038) does not, so it fell to BUSINESS_ACCOUNT.

**Fix:** classify by PARENT CHART too — `WHEN bk.bank_id IS NOT NULL OR ca.code = @bankChartCode
THEN 'BANK'`. A business account under the BANK ACCOUNTS head is a bank whether or not it carries a
bank_accounts row. Verified on live data this moves ONLY CHEQUES IN HAND (every other under-bank
account already had a bank row and was already BANK) — zero side effects, report-only, no data
change, and it does not make the account a selectable deposit target (pickers query bank_accounts,
not this category). The bank chart code is passed from the service (CODES.BANK_ACCOUNTS), not
hardcoded in the repository. Both call sites updated (overallTrail + the business-ledger directory).

**Deployed to prod:** backend-only change; app restarted on the new code (single instance). No
frontend change (Overall Trail groups by the category the backend returns). `node --check` clean.

**Files:** `backend/src/repositories/reports.repository.js`, `backend/src/services/reports.service.js`.

## 2026-09-26 — Journal Voucher: deleting the last line deletes the voucher

**Bug (user-reported):** unpost a JV, delete its lines row by row until none remain, navigate away
and back — the "deleted" lines reappear. Delete didn't persist.

**Cause:** a row's Delete is a LOCAL edit (`removeLine` filters the `lines` array); it persists only
on the next Save (`api.journalVouchers.update` sends the whole line set). But a JV must have >= 1
line (`isValid`/`buildPayload`/backend all require it), so once the last line is deleted Save and
Done go disabled — there is no way to persist "now empty." Navigating back re-fetches the voucher
from the DB, restoring every line.

**Fix (user chose "delete the whole voucher"):** new `handleRowDelete(idx)` — on a SAVED unposted
voucher, deleting the LAST line routes to the existing password-gated whole-voucher delete
(`handleDeleteAction`) instead of a local `removeLine` that can never be saved. An unsaved new
voucher's last row just clears locally (nothing persisted); deleting a non-last row is the ordinary
local edit that persists on the next Save (unchanged). The password prompt's subtitle is
context-aware (`emptyingViaLastRow`): it explains the row delete is removing the whole voucher
because a voucher can't be empty.

**Deployed to prod:** frontend-only; dist rebuilt, app restarted (single instance). `npx tsc -b`
clean; `npx eslint` unchanged at the 4 pre-existing React Compiler errors.

**Files:** `frontend/src/pages/JournalVoucherPage.tsx`.
