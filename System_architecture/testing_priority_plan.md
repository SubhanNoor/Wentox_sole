# WentoX — Testing Priority Plan

**Why this exists:** the client has hit ~15-20 post-delivery bugs/regressions. This repo has **zero
automated tests** (no test script, no `*.test.js` anywhere) and the GitHub release pipeline
(`.github/workflows/release.yml`) has **no test gate at all** — it lints the NSIS installer script,
builds, and publishes on every tag push with nothing checking the app actually works. This document
is a risk-ranked inventory of every module, built from `System_architecture/use_cases.md` (UC list
and table-mapping only — its ✅/⚠️/❌ status column is stale, written before any backend existed) cross
checked against the real current `backend/src/services/` code and the full bug history in
`backend/PROGRESS.md`.

Compiled 2026-09-20. **Updated same day** after a second research pass surfaced ~1700 lines of
`PROGRESS.md` (2026-09-14 → 2026-09-17, the client's own `changes-14-09-26.md` review pass) missed in
the first pass — this is very recent, heavily client-verified bug history and it changes the #1
priority (see the Journal Voucher sign bug, pattern 5 below, and the revised Top 8).

---

## Root-cause patterns (read this part first)

The 25+ historical bugs below aren't random — they cluster into five repeating failure modes. Fixing
the *pattern*, not just each individual bug, is the highest-leverage move:

1. **Silent frontend/backend wiring gaps.** The single most common failure. A feature is fully built
   and "verified" on the backend, but the frontend never actually calls it, or calls it under the
   wrong name — and nothing detects the mismatch because each side looks correct in isolation.
   Examples: Receipts' `post()`/`unpost()` existed on both ends but the UI never called them, so every
   receipt sat as an invisible DRAFT forever (2026-08-09); `journalVouchers` and `settlements` were
   missing from the frontend's IPC allow-list (`ipcBridge.ts` `FEATURES`), so both features were
   `undefined` in the running app despite being reported as complete (2026-08-10); a bilty-search
   channel was registered kebab-case on the backend but called camelCase from the frontend
   (2026-08-08). **A pure backend unit-test suite will never catch this class of bug** — it requires
   either an end-to-end check through the real IPC bridge, or a structural CI check that every backend
   feature with IPC channels has a matching frontend registration.

2. **Double-entry/reconciliation invariants silently violated.** Several bugs left the books
   internally inconsistent with no visible symptom until someone reconciled by hand: an opening
   balance written with no counter-entry (2026-08-10, threw the trial balance off by exactly the
   opening amount); a cheque deposit that wrote no ledger row at all (2026-08-10); Sale Bill/Return
   ledger rows missing their `pairs` value (2026-09-20). None of these crashed or errored — they just
   produced quietly wrong numbers. **A standing invariant test — "after any posting operation,
   sum(debit) = sum(credit), and no `ledger_entries` row from a document type expected to carry pairs
   is ever NULL" — would catch this entire category regardless of which feature introduces it next.**

3. **Unposted documents leaking into reports.** At least three separate report queries (Sale
   Analysis, Sale Report, Vendor Report) independently forgot to filter to POSTED-only documents,
   each found and fixed separately. This is a copy-paste-prone mistake that will keep recurring
   whenever a report gains a new aggregate column, unless there's a regression test asserting
   "creating-but-not-posting a document changes zero report totals."

4. **Timezone (UTC vs. local) cutoff bugs.** `toISOString()` used for "today" instead of the
   project's own local-date helper caused the Cash Book's month boundary to shift by a day and the
   cheque-due alert cutoff to be wrong for 5 hours a day (both 2026-08-10). Cheap to prevent: run any
   date-boundary test with `TZ` set to a non-UTC zone, deliberately near local midnight.

5. **Silent wrong-side / wrong-state posting with no error signal.** The most dangerous class found:
   the code runs without error but does the financially wrong thing. `JournalVoucherPage.tsx`'s entry
   strip sent a positive amount to CREDIT and negative to DEBIT — the exact inverse of the client's
   authoritative sign rule (2026-09-15, `ACC-01`) — and was only caught because the client demanded a
   full verification matrix across every posting path, not by any error, crash, or test. Related:
   clicking a POSTED Journal Voucher row let a user "delete" a line that visually disappeared but was
   never actually persisted, because Save silently failed against the service's own `POSTED_LOCK`
   guard (`JV-04`, 2026-09-15) — a UI state that lies about what happened. **This is the category a
   client-mandated audit catches and normal development does not**: it needs an explicit debit/credit
   sign-mapping regression test (typed input → posted ledger side, for every document type), not just
   "does it save without throwing."

**Also structural, not a bug pattern but a process gap:** at least two features (Journal Voucher,
Direct Settlement) were reported as backend-complete and verified, but the verification never touched
the real running UI — for Journal Voucher this happened *twice*, once for the missing IPC bridge entry
(2026-08-10) and again for the inverted sign mapping (2026-09-15). This is the same gap flagged in
today's session: changes need to actually be exercised in the running app, not just type-checked and
code-reviewed.

---

## Full inventory (UC-01 → UC-40, then modules with no UC number)

| UC# | Module/Feature | Backend service file(s) | Writes ledger_entries? | Writes stock_movements? | Lifecycle ops | Has broken before? (PROGRESS.md date) | Test priority |
|---|---|---|---|---|---|---|---|
| UC-01 | Home / Alerts widget | `alerts.service.js`, `reports.service.js` (account-balance) | No (reads only) | No | list, refresh, dismiss | No | Low |
| UC-02 | Login/Logout | `auth.service.js` | No | No | login, updateCredentials | No | Medium |
| UC-03 | Role-based access control | `businessAccounts.service.js#assertAccessible`, `auth.service.js` roles, `session.js` | No | No | assertAccessible guard | **Yes — 2026-08-10**: server-side enforcement didn't exist at all (UI-only); every cheque/expense/receipt/settlement channel called only `requireSession()`. Fixed by guarding on the account, not the channel. **2026-08-11 correction**: an over-broad follow-up locked all 6 cheque-disposal channels to ADMIN-only (never the actual rule) — reverted. **2026-08-12**: `post()`/`unpost()` on transfers, deposits, receipts, expenses, journal vouchers and settlements did NOT re-check the restricted-account rule (only create/update did) — an ADMIN could stage a draft against a restricted account for a USER to post; demonstrated live before the fix. | Critical |
| UC-04 | Update credentials | `auth.service.js` | No | No | update | No | Low |
| UC-05 | Review/dismiss alerts | `alerts.service.js` | Reads `ledger_entries`; writes `alert_dismissals` only | No | refreshAlerts, list, dismiss | **Yes — 2026-08-10**: UTC cutoff shifted cheque-due alert timing for 5 hrs/day. | High |
| UC-06 | Categories | `categories.service.js` | No | No | create/update/remove/reactivate | No | Low |
| UC-07 | Articles & colours | `products.service.js`, `productColors.service.js` | No | No (enables stock indirectly) | create/createBatch/update/remove/reactivate; resolveOrCreate | Minor UI-only bug (2026-08-10) | Low/Medium |
| UC-08 | Vendors | `vendors.service.js` | No | No | create/update/remove/reactivate | No | Medium |
| UC-09 | Customers | `customers.service.js` | No | No | create/update/remove/checkName/reactivate | No | Medium |
| UC-10 | Sub-customers | `subCustomers.service.js` | No | No | create/update/remove/checkName/reactivate | No | Low |
| UC-11 | Cities | `cities.service.js` | No | No | CRUD | No | Low |
| UC-12 | Regions | `regions.service.js` | No | No | CRUD | No | Low |
| UC-13 | Stores | `stores.service.js` | No | No | CRUD | No | Low |
| UC-14 | Addas | `addas.service.js` | No | No | CRUD | No | Low |
| UC-15 | Group accounts | `groupAccounts.service.js` | No | No | CRUD | No | Low |
| UC-16 | Chart of accounts | `chartAccounts.service.js` | No | No | create/update/remove/reactivate/permanentDelete/purge | **Yes — 2026-08-10**: `remove()` could close Cash in Hand / the Journal Voucher account (would break every transfer and all JV posting); the same-day fix briefly over-corrected and froze all 41 accounts before being narrowed. | High |
| UC-17 | Business accounts | `businessAccounts.service.js`, `accountsTree.service.js`, `bankAccounts.service.js`, `accountClasses.service.js` | **Yes** (`setOpening`/`syncOpeningEntries`) | No | create/createBatch/update/remove/reactivate/setOpening | **Yes — 2026-08-10**: opening balance written with no counter-entry — threw the trial balance off by exactly that amount while `ledger_entries` alone still netted to zero. Same day: `ApiError.badRequest()` silently dropped its `details` arg, swallowing `createBatch()`'s per-row errors. | Critical |
| UC-18 | Create Sale Bill | `saleBills.service.js`, `draftSaleBills.service.js`, `saleBillMath.js` | Yes | Yes | create/update/post/postAll/unpost/unconfirm/remove | **Yes, repeatedly**: (a) 2026-09-20 — `ledger_entries.pairs` never populated for Sale Bill/Return postings; (b) 2026-09-07 — `ISNULL(@systemNo, NEXT VALUE FOR ...)` rejected outright by SQL Server, broke every save/confirm across all 4 document types; (c) stock-reserved-at-save redesign shipped "not yet live-verified"; (d) unposted amounts leaked into Sale Analysis/Sale Report before Post. | Critical |
| UC-19 | Find/update sale bill | `saleBills.service.js` (update/list/getById) | Yes | Yes | update | Shares UC-18 history | Critical |
| UC-20 | Search/update bilty & adda | `saleBills.service.js` (updateBiltyInfo, biltySearch) | No | No | updateBiltyInfo | **Yes — 2026-08-08**: channel registered kebab-case on backend, called camelCase from frontend — page completely broken. | Medium |
| UC-21 | Create Sale Return | `saleReturns.service.js`, `draftSaleReturns.service.js`, `saleReturnMath.js` | Yes | Yes | create/update/post/unpost/unconfirm | **Yes**: same pairs bug, same `NEXT VALUE FOR` bug, same unposted-leaking bug. **Also 2026-09-16**: `draftSaleReturns.service.js#confirm()` required `gp_no`/`bilty_no`/`adda_id` before posting, contradicting the frontend's "optional" labeling and `saleReturns.service.js`'s own `validateHeader()` (only `bill_no` required) — a stale duplicate validation silently blocked postings the UI said were fine. | Critical |
| UC-22 | Find/update sale return | `saleReturns.service.js` | Yes | Yes | update | Shares UC-21 | Critical |
| UC-23 | Record a purchase | `purchases.service.js`, `draftPurchases.service.js`, `purchaseMath.js` | Yes | Yes (`vendor_stock_movements`) | create/update/post/postAll/unpost/unconfirm | **Yes**: 2026-09-07 `NEXT VALUE FOR` bug; unposted purchases leaked into Vendor Report's Total Purchase. | Critical |
| UC-24 | Record a purchase return | `purchaseReturns.service.js`, `draftPurchaseReturns.service.js` | Yes | Yes | create/update/post/unpost/unconfirm | **Yes**: same `NEXT VALUE FOR` bug; same Vendor-Report leaking bug. | Critical |
| UC-25 | Record a receipt (Jamma) | `receiptVouchers.service.js`, `receipts.service.js`, `draftReceipts.service.js`, `cheques.service.js` | Yes | No | create/update/post/unpost/unconfirm (lines); create/post/unpost/remove (header) | **Yes — 2026-08-09 (severe)**: UI never called `receipts:post`/`unpost` — every receipt sat as DRAFT forever, invisible to ledger/balances/reports. Found via a user report of a payment not updating a balance. Also 2026-08-07: `cheque_received_date` omitted from a SELECT, always showed blank. | Critical |
| UC-26 | Record an expense (Kharch) | `expenseVouchers.service.js`, `expenses.service.js`, `draftExpenses.service.js` | Yes | No | create/update/post/unpost/unconfirm/reverseEndorsementFor/bounceIssuedCheque/returnIssuedCheque | **Yes — 2026-08-05**: an issued cheque had no bounce/return reversal path at all by original design. **Also (2026-09-1x window)**: `post()` on a `CHEQUE_ENDORSED` expense called `endorseToExpense()` (its own committing transaction, real money movement) then flipped the expense's status in a SEPARATE transaction — a failure in between left it stuck DRAFT with the cheque already disposed of, and retrying `post()` would silently double-allocate the cheque. Fixed via a `cheque_allocations.expense_id` back-reference making retry idempotent. | Critical |
| UC-27 | Dispose of a received cheque | `cheques.service.js` | Yes | No | deposit, endorseToVendor, endorseToExpense, markCleared, reverseCheque, bounce, returnToSender, reverseAllocation | **Yes — most bug-dense module found**: (a) 2026-08-10 `deposit()` wrote no ledger row, a deposited/cleared cheque never reached the bank or drained Cheques In Hand; (b) 2026-08-09 Cash Book omitted `cheque_allocations` entirely; (c) 2026-08-04 `recomputeStatus()` read via the plain pool instead of the in-flight transaction (stale read); (d) 2026-08-04 reversing a DEPOSIT allocation crashed on a CHECK constraint. | Critical |
| UC-28 | Current stock / add stock / log production | `stock.service.js`, `stockVouchers.service.js`, `productColors.service.js` | No | Yes | logProduction, adjust, reduceVendorStock; Stock Vouchers: create/update/post/unpost/postAll | New Stock Voucher type replaced the old inline flow — architecturally new, no history yet but untested/high-churn. | High |
| UC-29 | Product ledger | `reports.service.js#productLedger`, `stock.service.js#movements` | Read-only | Read-only | — | No | Low |
| UC-30 | Vendor stock | `stock.service.js#reduceVendorStock`, `reports.service.js#vendorStock` | No | Yes | reduceVendorStock | No | Medium |
| UC-31 | Sale Analysis | `reports.service.js#saleAnalysis` | Read-only | No | — | **Yes**: unposted amounts counted before Post wrote to ledger. | High |
| UC-32 | Sale Report | `reports.service.js#saleReport` | Read-only | No | — | **Yes**: same unposted-leaking bug. | High |
| UC-33 | Vendor Report | `reports.service.js#vendorReport`, `#vendorLedger` | Read-only | No | — | **Yes**: same class — `vendorReportRows()` missing the posted-only filter every sibling bucket had. | High |
| UC-34 | Payment Trail | `reports.service.js#paymentTrail` | Read-only | No | — | **Confirmed live latent gap, 2026-09-15 (`RP-01`)**: `reports.repository.js#paymentTrailRows()` only queries `dbo.expenses`, never `dbo.settlements` — currently unreachable since Expenses has no settlement-creation UI yet, but will silently under-report the day that ships. Not yet fixed. | High |
| UC-35 | Account Ledger (Khaata) | `reports.service.js#accountLedger`, `#accountBalance` | Read-only | No | — | **Yes**: 2026-09-20 Pairs column blank (symptom of UC-18/21's write bug); 2026-08-10 UTC cutoff hid a same-day settlement. | High |
| UC-36 | Business Accounts Ledger | `reports.service.js#businessLedger` | Read-only | No | — | Shares UC-17's opening-balance history | Medium |
| UC-37 | Cash Book of the Day | `reports.service.js#cashBook` | Read-only | No | — | **Yes**: 2026-08-09 missing cheque-endorsement outflows; 2026-08-10 UTC month-range bug shifted the whole month back a day. | High |
| UC-38 | Product Ledger (Reports tab) | Same as UC-29 | Read-only | No | — | No | Low |
| UC-39 | Direct Settlement | `settlements.service.js` | Yes | No | create/update/remove/post/unpost | **Yes — 2026-08-10**: `ipcBridge.ts` `FEATURES` allow-list never included `settlements` — the whole feature silently broken (`window.api.settlements` undefined) despite being reported as working. **Also 2026-09-15 (`RP-01`)**: a settlement created via Receipts' "Endorse" checkbox posted correctly but was completely unfindable afterwards — `receiptVouchers.repository.js#list()` (backs Find/First/Prev/Next/Last on Receipts) never referenced `dbo.settlements`. Fixed for Receipts navigation; see UC-34 for the still-open Payment Trail half of the same gap. | Critical |
| UC-40 | Journal Voucher | `journalVouchers.service.js`, `journalVouchers.math.js`, `JournalVoucherPage.tsx` | Yes | No | create/update/remove/post/unpost/postAll | **Yes — highest-risk item in this whole inventory, three separate incidents**: (a) 2026-08-10 `ipcBridge.ts` allow-list missing `journalVouchers`, dropdown showed zero options; (b) **2026-09-15 (`ACC-01`), the most dangerous bug found** — `JournalVoucherPage.tsx#handleCommitLine` sent a positive typed amount to CREDIT and negative to DEBIT, the exact inverse of the client's authoritative sign rule (+ve=DEBIT/-ve=CREDIT) — a silent wrong-side posting with no error signal, caught only by a client-mandated full verification audit, not by any test; (c) 2026-09-15 (`JV-04`) a plain row click could open a POSTED voucher into edit mode (bypassing the toolbar Edit button's own guard), let a line be visually deleted, but Save always silently failed against the service's `POSTED_LOCK` — the deletion was never actually persisted despite appearing to work. | **Critical — highest priority** |

### Cross-cutting bug (not one UC, hits 6 document pages)

| Feature | Pages affected | Has broken before? | Test priority |
|---|---|---|---|
| Posted/Unposted filter state on reopen | `SaleBillPage.tsx`, `PurchaseReturnPage.tsx`, `PurchasePage.tsx`, `SaleReturnPage.tsx`, `JournalVoucherPage.tsx`, `StockVoucherPage.tsx` | **Yes — 2026-09-16 (`G-06`), described in PROGRESS.md as a "severe bug"**: opening a new window could show a POSTED document's data while the Posted/Unposted filter still defaulted to "Unposted" — a reset-on-reopen check keyed on `mode === 'view'` missed the `mode === 'edit'` case, reachable via `SaleBillPage.tsx#handleEditSpecificBill` (Records-tab Edit action loads an always-posted row into edit mode). Fixed across all 6 pages at once, meaning it was one bug copy-pasted 6 times, not 6 independent ones. | Critical |

### New/uncovered modules (no UC number in the use-case doc)

| Module | Backend service file(s) | Writes ledger_entries? | Writes stock_movements? | Lifecycle ops | Has broken before? | Test priority |
|---|---|---|---|---|---|---|
| Cash⇄Bank Transfers | `transfers.service.js` | Yes | No | create/update/remove/post/unpost | No | High |
| Deposits (owner capital / misc) | `deposits.service.js` | Yes | No | create/update/remove/post/unpost | No | Medium |
| Stock Vouchers | `stockVouchers.service.js` | No | Yes | create/update/remove/post/unpost/postAll | See UC-28 | High |
| Wage Run (payroll) | `wageRuns.service.js` | Yes | No | create/update/remove/post/unpost | No | High |
| Salary Run (payroll) | `salaryRuns.service.js` | Yes | No | create/update/remove/post/unpost | No | High |
| Employees & Stages (payroll setup) | `employees.service.js`, `stages.service.js` | No | No | CRUD | No | Low |
| Admin User Management | `auth.service.js` (createUser/listUsers/setUserActive/resetPassword) | No | No | createUser/setUserActive/resetPassword | Minor UI bug only | Medium (security-adjacent) |
| Backup (internal mirror + external drive) | `backup.service.js` | No | No | sync/syncIfDirty/ensureInitialBackup/backupToExternal/status | **Yes — 2026-08-13**: mirror backup staged its `.bak` via `os.tmpdir()` — on Windows that's the logged-in user's temp folder, which SQL Server's service account can't write to; would almost certainly have failed silently on the client's real machine. Plus a recent (`0f80a447`) external-backup error-masking bug. | Critical (silent disaster-recovery failure) |
| System Reset (danger zone) | `systemReset.service.js` | No | No | resetDatabase (DROP/CREATE DATABASE) | No specific bug, but irreversible admin DDL | Critical (blast radius) |
| Check for Updates | `updates.service.js` | No | No | check/install | No | Low |

---

## Top 8 targets for automated tests, in order

**Revised** after the second research pass — the Journal Voucher sign bug is now #1, displacing the
original list by one slot each.

1. **`JournalVoucherPage.tsx#handleCommitLine`/`loadLineIntoEntry` + `journalVouchers.service.js#post()`** — a full debit/credit sign-mapping regression test, typed amount → posted ledger side, for every entry path. This is a confirmed, real, silently-wrong-side posting bug that shipped and was only caught by a client-mandated sign-rule audit — the single most dangerous defect class in the whole log, and the kind normal "does it save" testing does not catch.
2. **`saleBills.service.js`/`saleReturns.service.js`: `writeLedger()`/`postLedgerAndStock()`** — assert `ledger_entries.pairs` always equals `sum(item.pairs)`; also regression-cover the `NEXT VALUE FOR`/`ISNULL` bug that broke every save across all 4 document types (2026-09-07).
3. **`cheques.service.js`: `deposit()`/`reverseCheque()`/`recomputeStatus()`** — full disposal-lifecycle matrix; the most bug-dense backend module found (4 distinct real bugs).
4. **`receipts.service.js`/`draftReceipts.service.js` post/unpost wiring from `ReceiptsPage.tsx`** — the 2026-08-09 "every receipt stranded as DRAFT forever" bug was a frontend call-wiring gap invisible to backend tests; needs an IPC-bridge-level end-to-end test.
5. **`expenses.service.js#post()`'s `CHEQUE_ENDORSED` branch** — an idempotent-retry test for the two-transaction commit gap that caused silent double-allocation of a cheque.
6. **Cross-page "Posted/Unposted filter" state machine** (`SaleBillPage.tsx`, `PurchaseReturnPage.tsx`, `PurchasePage.tsx`, `SaleReturnPage.tsx`, `JournalVoucherPage.tsx`, `StockVoucherPage.tsx`) — the `G-06` bug (a posted record shown despite "Unposted" being selected) was one bug copy-pasted across 6 pages; needs a test per page, not one shared assumption that fixing it once fixed it everywhere.
7. **`businessAccounts.service.js#setOpening()`/`syncOpeningEntries()`**, paired with a **standing "trial balance nets to zero after any posting operation" invariant test** — catches this whole bug class system-wide, not just here.
8. **IPC bridge registration audit** (`ipc/index.js` vs `ipcBridge.ts`'s `FEATURES`) **+ posted-only gating audit** (`reports.repository.js#vendorReportRows()`, `#saleAggregateByCustomer()`, `#paymentTrailRows()`) — both are "one missing guard silently disables or under-reports a whole feature" bug classes that have each recurred more than once (Settlements/Journal Voucher bridge gaps; Payment Trail's settlements gap is confirmed still open today).

**Honorable mentions, just outside the top 8:**
- `backup.service.js` — a silent disaster-recovery failure has no visible symptom until the day it's actually needed, and it's already happened once.
- Date-boundary tests run with `TZ` set to a non-UTC zone, targeting `reports.service.js#cashBook()`, `alerts.service.js#refreshAlerts()`, and every document service's `resolveDateRange()`.
- `draftSaleReturns.service.js#confirm()`'s stale duplicate bilty/adda/GP-No. validation (2026-09-16) — a smaller instance of "two places validate the same thing and they've drifted apart," worth a grep across all 4 draft-document services for the same pattern before it recurs a third time.
