# Milestone 4 — Receipts, Expenses, Bank Accounts, Transfer, Payroll

**Goal:** The remaining sidebar TRANSACTIONS entries: Receipts, Expenses, the cheque lifecycle
both can produce, Bank Accounts (setup, but a hard dependency of cheque deposit / Online payment
mode so it lives here), Transfer (Cash ↔ Bank), Wage Run (piece-rate), and Salary Run (monthly).
Ledger-only postings throughout (no stock movements) — Wage Run is the one exception that reads
`dbo.articles`' 12 stage-cost columns but still only writes `ledger_entries`.

**2026-08-19 update:** this milestone was expanded from its original Receipts/Expenses-only scope.
Bank Accounts, Transfer, and Payroll (Employees/Wage Run/Salary Run) all had complete tables
already sitting in `database/schema.sql` — `bank_accounts`, `cheques`, `transfers`, `employees`,
`stages`, `worker_stages`, `wage_runs`/`wage_run_items`, `salary_runs`/`salary_run_items` — plus
two fully-written design docs, `System_architecture/cash_and_bank.md` and
`System_architecture/payroll.md`, that were never folded into any milestone. **Read those two docs
before starting the relevant module below** — they cover screens, posting rules, edit/unpost
behavior, and open decisions in far more depth than these checklists restate.
`database_schema_v4.3.md`/`use_cases.md` do NOT describe these tables (that's why Module 7.1 used
to say "blocked, no definition exists") — `payroll.md`/`cash_and_bank.md` are the actual source of
truth for this scope, not those two files.

**Posting rules:** Post receipt: debit CASH / credit customer. Post expense: debit expense head
(business account) / credit CASH. Post transfer: debit `to_ba_id` / credit `from_ba_id`
(`cash_and_bank.md` §7). Post wage run: debit WAGES EXPENSE / credit worker BA. Post salary run:
debit SALARIES EXPENSE / credit each salaried employee's BA, one credit line per employee
(`payroll.md` §6). **Reverse-never-erase:** bounced cheques/receipts get a reversing entry, not a
deleted row (schema §6.1); wage/salary run unpost is audited (`unposted_at`/`unposted_by`/
`amount_before` columns on both run tables), not a silent status flip.

## Module 4.1 — Receipts / Jamma & Cheque Disposal (UC-25, UC-27)
- [ ] `receipts` (ipc handler/service/repository) CRUD + post/unpost (ledger only)
- [ ] `draftReceipts` — dummy/unconfirmed receipts (same draft pattern)
- [ ] `bankAccounts`/`cheques` (ipc handler/service/repository) — shared cheque lifecycle row (received → deposited/bounced/cleared), `bounced_date` drives the reversal; bounce writes a reversing ledger entry, never deletes the original (reverse-never-erase, schema §6.1)
- [ ] Weekly/Monthly/Overall list filters
- [ ] Verify: record a cheque receipt → mark bounced → confirm a reversing ledger entry exists and the original row is untouched

## Module 4.2 — Expenses / Kharch (UC-26)
- [ ] `expenses` (ipc handler/service/repository) CRUD + post/unpost (ledger only), expense head = business account
- [ ] `draftExpenses` — dummy/unconfirmed expenses (same draft pattern)
- [ ] Weekly/Monthly/Overall list filters
- [ ] Note: payment-overdue alert is dropped in v4.3 — only cheque-due alerts remain (Milestone 9)

## Module 4.3 — Bank Accounts (no UC — see `cash_and_bank.md` §3, §11)
**Newly planned (2026-08-19).** A party record, same pattern as Vendors/Customers/Employees: own
PK (`bank_accounts`) plus an auto-created linked `business_accounts` row under the reserved
**BANK ACCOUNTS** chart head (`120002`) — reuse `businessAccountsService.createUnderChartCode`,
same as Vendors/Customers already do. This is a hard dependency of Module 4.1's cheque DEPOSIT
disposition (needs a bank to deposit into) and of Online payment mode on Receipts/Expenses, so it
should be built before or alongside those, not after.
- [x] `bankAccounts` (ipc handler/service/repository) CRUD — name, account_no, branch, opening_balance/opening_date; `create()` auto-links a `business_accounts` row under the reserved BANK ACCOUNTS chart account (`CODES.BANK_ACCOUNTS`, actual project code `100003` — the `120002` figure in this checklist and in `cash_and_bank.md` was that doc's illustrative numbering, not this project's real reserved-code scheme), same transaction-safety pattern as `vendors.service.js`/`customers.service.js`. `opening_balance`/`opening_date` deliberately live on the linked `business_accounts` row, not on `bank_accounts` itself (per `cash_and_bank.md` §3), passed through `businessAccountsService.createUnderChartCode`'s `extra` param.
- [x] `CODES.BANK_ACCOUNTS` — renamed from the pre-existing `CODES.CASH_AT_BANKS` (same code, `100003`, already seeded — it was just carrying the stale pre-correction name "Cash at Banks"); seed name corrected to `'BANK ACCOUNTS'` in `src/db/seeds/run.js` (idempotent insert-only, so this only takes effect on a fresh `npm run seed` — no migration needed since `database/schema.sql` isn't applied to a real DB yet in this environment)
- [x] Added `account_no`/`branch` columns to `dbo.bank_accounts` (missing before — the table only had `name`) in `database_schema_v4.3.md` and `database/schema.sql`; dropped the table's `UNIQUE(name)` constraint, since two bank accounts can legitimately share a bank name with a different `account_no` — duplicate handling is name+account_no, service-layer only, matching the reactivate-instead-of-reject pattern used everywhere else (see `System_architecture/soft_delete_and_duplicate_check.md`)
- [x] Registered in `src/ipc/index.js`; added `bankAccounts` to `electron/preload.js`'s `FEATURES` array (was missing — the channel wouldn't have been reachable from the renderer at all)
- [x] Verify: create a bank account → linked business account appears under BANK ACCOUNTS (`100003`) → soft-delete → linked account stays `ACTIVE` — run live against `wentox_db` (migration `001_bank_accounts_and_duplicate_check.sql` applied), active/inactive-duplicate/reactivate flow also exercised live, debugger review clean
- [ ] Frontend: no Bank Accounts setup page/wiring done — same "backend real, frontend still on demo data" gap as every other entity so far

## Module 4.4 — Transfer (Cash ↔ Bank) (no UC — see `cash_and_bank.md` §7)
**Newly planned (2026-08-19).** `dbo.transfers` already exists in `schema.sql`. Moves money
between two of WentoX's own `business_accounts` (cash ↔ bank, bank ↔ bank) — neither a receipt nor
an expense, must be excluded from every income/expense total and from Sale/Purchase reports.
- [x] `transfers` (ipc handler/service/repository) CRUD + post/unpost — `CK_transfers_distinct` already blocks `from_ba_id = to_ba_id` at the DB level, validated in the service too (`ApiError.badRequest`) for a clean 400 instead of a raw constraint error. `create()` always inserts as `DRAFT` regardless of the column's `DEFAULT ('CONFIRMED')` — only `post()` moves it to `CONFIRMED`. `update()`/`remove()` blocked while `CONFIRMED` (same "unpost first" rule as `purchases.service.js`); `remove()` is a hard `DELETE` (transfers is a transaction table, never soft-deleted, per schema.sql's own convention note)
- [x] Post: debit `to_ba_id` / credit `from_ba_id`, `source_type = 'TRANSFER'` — verified live: `Dr` row lands on `to_ba_id` with `debit=amount/credit=0`, `Cr` row on `from_ba_id` with `debit=0/credit=amount`
- [x] `businessAccountsService.getById()` added (was missing — only `createUnderChartCode`/`renameLinked` existed) so `transfers.service.js` can validate `from_ba_id`/`to_ba_id` exist without reaching into another feature's repository directly
- [x] Verify: create DRAFT → same-account rejected → post (correct Dr/Cr ledger pair) → double-post blocked → edit-while-posted blocked → unpost removes ledger rows → remove works while DRAFT — all run live against `wentox_db` (two throwaway bank accounts used as the two sides, cleaned up after), debugger review clean
- [ ] Report-level exclusion (Cash Book / balance reports must skip `TRANSFER` from income/expense totals — `cash_and_bank.md` §11 item 13) — **not done**, no reports exist yet at all (Milestone 5, not started)
- [ ] Frontend: no Transfer screen exists yet — same "backend real, frontend still on demo data" gap as every other entity so far

## Module 4.5 — Employees, Stages & Worker Trades (no UC — see `payroll.md` §2–§5, §7)
**Was Milestone 7 Module 7.1, "blocked on definition" — unblocked 2026-08-19.** That block was
wrong: `payroll.md` is a complete, reasoned design doc, and `dbo.employees`/`dbo.stages`/
`dbo.worker_stages` are already fully specced and applied in `schema.sql`. Sidebar label is
**Employees** (was "Workers" — `payroll.md` §7), split into two sections: Workers and Salaried
Employees, one form asking **type first** since the rest of the fields depend on it.
- [x] `stages` (ipc handler/service/repository) — read-only lookup (`list` only, no create/update/remove), 12 rows seeded via `src/db/seeds/run.js` from a new single source of truth `src/constants/stages.js` (`payroll.md` §4's stage_key/form_label/worker_label/cost_column/sort_order — not duplicated a fourth time; frontend's `COST_FIELDS` in `types/index.ts` is the only other copy, left as-is since it's a different runtime)
- [x] `employees` (ipc handler/service/repository) CRUD — type-first: `validate(payload, employeeType)` takes the type as an explicit second param (never trusts `payload.employee_type` directly) so `update()` can validate against the row's EXISTING type. Worker requires ≥1 trade (`worker_stages`, validated against real `stages` rows — an unknown `stage_key` is rejected before it would otherwise hit the FK), Salaried requires `monthly_salary >= 0`; `create()` auto-links a `business_accounts` row under WORKER WAGES (`220001`) or SALARIES PAYABLE (`220002`) depending on type (reuses `createUnderChartCode`, both new codes added to `reservedAccounts.js` + seeded)
- [x] **`employee_type` is immutable after creation** (`payroll.md` §7) — `update()` rejects `payload.employee_type !== existing.employee_type` with a `TYPE_IMMUTABLE` 400 before anything else runs; the rest of `update()` always derives type-dependent fields (monthly_salary, whether trades apply) from `existing.employee_type`, never from the payload, so omitting `employee_type` from an update payload can't smuggle a type change through
- [x] Removing a trade does NOT touch history — `wage_runs.stage_key` is its own FK straight to `dbo.stages`, not through `worker_stages`, confirmed by reading the schema (deferred: editing a salary not touching history is a Module 4.7 concern, since `salary_run_items.salary_amount` is what snapshots it — nothing to verify here yet)
- [x] Duplicate-name handling: same reactivate-instead-of-reject pattern as vendors (name+phone key, case-insensitive/NULL-safe), added here from day one rather than needing a later retrofit
- [x] `replaceTrades()` (delete-all-then-reinsert) is transactional together with the employee row update — `employees.repository.js:update()` was made transaction-aware (was going to be a plain non-transactional `query()` call, fixed before this was ever run) specifically so a WORKER's rename and trade-set change commit or roll back together
- [x] Verify: create a worker with 0 trades rejected; invalid `stage_key` rejected; create with 1 trade → linked BA confirmed under `220001`; create a salaried employee with no salary rejected → linked BA confirmed under `220002`; attempt to change `employee_type` on update rejected (`TYPE_IMMUTABLE`); worker's trade set successfully replaced via `update()`; active/inactive duplicate + reactivate flow all correct — all run live against `wentox_db`, debugger review pending
- [ ] Frontend: no Employees setup page/wiring done — same "backend real, frontend still on demo data" gap as every other entity so far

## Module 4.6 — Wage Run / Piece Rate (no UC — see `payroll.md` §5–§8)
**Newly planned (2026-08-19).** One settlement: one worker + one stage + many article lines.
Reads `dbo.articles`' 12 stage-cost columns (write-only until now) but only writes
`ledger_entries` — no stock movement. `rate`/`packing` are **snapshotted** onto each
`wage_run_items` row at posting time, deliberately diverging from `dbo.articles` later so editing
an article never rewrites a wage already paid. `amount` is a persisted computed column
(`rate * cartons * packing`) — the schema enforces the arithmetic, not the app.
- [x] `wageRuns` (ipc handler/service/repository) CRUD + post/unpost — `validateEmployeeStage()` fetches the worker via `employeesService.getById()` and checks `stage_key` against `employee.stages` before anything else, rejecting a non-worker or a trade the worker doesn't have with a clean 400 (the composite FK to `(employee_id, employee_type)` pinned to `'WORKER'` backstops this at the DB level too). `rate`/`packing` snapshot from the article's CURRENT figures at line-add/edit time via `resolveLines()` (uses `src/constants/stages.js`'s stage_key→cost_column map, built in Module 4.5); `rate` can be overridden by a caller-supplied value, `packing` never can — always the article's own `packing`, matching the schema comment
- [x] Post: debit WAGES EXPENSE (`410001`) / credit the worker's `ba_id`, `source_type = 'WAGE_RUN'` — verified live with real arithmetic (5 cartons × rate 20 × packing 12 = 1200, matching the DB's own `amount` computed column exactly)
- [x] Unpost is audited, not silent — sets `unposted_at`/`unposted_by`/`amount_before`; note `CK_wage_runs_unpost` at the DB level only actually requires `unposted_at IS NOT NULL` when any of the three are set (not true all-or-nothing, despite this checklist's original phrasing) — the service always sets all three together regardless, which is the intended behavior; `markPosted()` clears all three back to `NULL` on every post so a stale audit trail from an earlier unpost cycle never lingers
- [x] **No duplicate-settlement guard by design** (`payroll.md` §5) — `wageRuns:recent` (`recentRuns()`) returns that worker's last 3 runs for the selected stage, any status, verified live returning 1 row after creating one
- [x] Verify: create with 5 cartons → total_amount=1200 confirmed; post → correct Dr(WAGES EXPENSE ac_id)/Cr(worker ba_id) ledger pair; double-post blocked; update-while-posted blocked; unpost → audit fields set, ledger rows removed; edit-while-draft re-snapshotted with 10 cartons → total_amount=2400 confirmed; remove-while-draft succeeded — all run live against `wentox_db`, debugger review pending
- [ ] Frontend: no Wage Run page exists yet — same "backend real, frontend still on demo data" gap as every other entity so far
- [ ] Verify: create a run against a worker's un-trained stage rejected; create against a trained stage with 2 article lines → `total_amount` matches `SUM(wage_run_items.amount)` → post → ledger debit/credit correct → unpost → audit columns populated, ledger rows removed

## Module 4.7 — Salary Run / Monthly (no UC — see `payroll.md` §5–§6, §11)
**Newly planned (2026-08-19).** One run per calendar month, covering every active salaried
employee at once — `CK_salary_runs_month` requires `period_month` to be the 1st of the month;
`UQ_salary_runs_month` (filtered, `WHERE status='CONFIRMED'`) blocks a second CONFIRMED run for
the same month while leaving DRAFTs unconstrained for building a correction alongside.
- [x] `salaryRuns` (ipc handler/service/repository) CRUD + post/unpost — `create()`/`update()` build the roster server-side (`buildLines()` queries every ACTIVE salaried employee directly, not trusted from the caller), one line per employee at their current `monthly_salary`; a caller-supplied `overrides: [{employee_id, amount, remarks}]` array can override specific lines' `amount` (editable) while `salary_amount` (the snapshot) is always freshly re-derived and never overridable, matching §11's two-column design exactly
- [x] Post: debit SALARIES EXPENSE (`410002`) / credit each salaried employee's `ba_id`, one credit line per employee, `source_type = 'SALARY_RUN'` — verified live as exactly 1 debit + N credit rows, correct `ba_id` per employee, debit amount equal to the sum of (possibly overridden) credits
- [x] If a CONFIRMED run already exists for the target month, `create()` (and `post()`, as a second independent check) reject with `MONTH_ALREADY_CONFIRMED` and the existing run's id in `details` — verified live; also verified a DRAFT for the same month IS allowed (unconstrained by design, matching `UQ_salary_runs_month`'s filtered index), and that unposting a confirmed run correctly frees the month back up for a new one
- [x] `period_month` normalized to the 1st of its month server-side (`normalizeMonth()`, UTC-safe) regardless of what date the caller sends, matching `CK_salary_runs_month`
- [x] Unpost audited the same way as Wage Run (`unposted_at`/`unposted_by`/`amount_before`) — verified live, `amount_before` matched the run's total exactly before it was cleared
- [x] Verify: create a run for a month with no active salaried employees → rejected (added mid-review — wasn't guarded initially, caught while re-checking this exact checklist line, fixed and re-verified live before the debugger pass); create with 2 employees → totals correct (90000); post → ledger has one credit row per employee (35000 + 50000 after a deduction override, debit 85000); attempt a second CONFIRMED run same month rejected; unpost → audit columns populated (`amount_before`=85000) — all run live against `wentox_db`, debugger review clean
