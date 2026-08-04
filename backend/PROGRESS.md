# Wentox Backend — Progress Log

**Current milestone:** Milestone 4 is now FULLY BUILT — Module 4.2 (Expenses / Kharch) is code-complete, extensively verified live, debugger review clean after fixing 4 issues (1 HIGH). All 7 of Milestone 4's modules (4.1–4.7) are now done. Milestone 5's Module 5.2 (Reports) remains deliberately deferred — the only backend gap left across Milestones 4–8 is Module 5.2 plus, everywhere, the frontend integration pass (Milestone 9.2).
**Status:** SQL Server is up and `wentox_db` migrated + seeded. Milestone 1 code-complete and its migrate/seed scripts verified working end-to-end (including live `auth:login`/`requireSession` checks). Milestone 2: **Modules 2.1 and 2.2 both complete and verified end-to-end** (create/post/unpost, ledger + stock direction, drafts, password re-verification guard, and the `status`-column removal / `due_date` addition). Milestone 3: **Modules 3.1 and 3.2 both complete and verified end-to-end** (create with material auto-registration, post/unpost, drafts with zero vendor-stock effect until confirmed, no password guard). Milestone 6: **Modules 6.1, 6.2, and 6.3 all complete and verified end-to-end** (Product Details/`articles`, Categories, Vendors with auto-linked business account). Milestone 7: **Modules 7.2 and 7.3 complete and verified end-to-end** (Customers mirroring Vendors' auto-linked-account pattern, Sub-Customers as a flat independent CRUD per UC-10, later given a required `region_id` for Sale Bill/Return dropdown filtering); **Module 7.1 moved to Milestone 4 Module 4.5** (see 2026-08-19 entry below — it was never actually "blocked," `payroll.md` fully designs it). Milestone 8: **Module 8.1 complete and verified end-to-end** (Regions, Cities, Stores, Addas — including Addas' UC-14 delete-guard and its new required `region_id` — see below); Modules 8.2/8.3 (accounting hierarchy) not started. **Milestone 4 was expanded 2026-08-19** from Receipts/Expenses-only into also covering Bank Accounts, Transfer, and Payroll (Employees/Wage Run/Salary Run) — none of that is built yet, all newly planned. The Milestone 2/3 frontend wiring is also still pending. Milestones 6/7/8 (system setup) were deliberately pulled forward because Sale Bill/Return/Purchase/Return all depend on real customer/vendor/adda/city/region data to be testable end-to-end through the actual UI, not hardcoded fixtures. "Reactivate an inactive duplicate-named row instead of rejecting on create()" — no longer parked: implemented across every built entity — vendors (name+phone key), customers/sub-customers (name-only, never blocks on active match), regions/cities/stores/categories/addas (name-only, blocks on active match, matching their existing DB-level `UNIQUE(name)`), and products (name+vendor_id key, didn't have ANY duplicate check before this). Employees still has no CRUD built. See `System_architecture/soft_delete_and_duplicate_check.md`. **Module 4.3 (Bank Accounts) now built** — see the dated entry below; it now also uses the reactivate-instead-of-reject pattern (name+account_no key) from day one, rather than needing a later retrofit.

Log every completed task here (newest first within its milestone). Format:

```
### YYYY-MM-DD — <Task name> (Milestone X, Module X.Y)
- **What:** what was built/changed
- **How:** approach, key decisions, gotchas
- **Files:** paths touched
```

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
_Not started._

## Milestone 9 — Alerts, Frontend Integration & Electron
_Not started._
