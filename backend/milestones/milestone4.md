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
- [ ] `bankAccounts` (ipc handler/service/repository) CRUD — name, account no., branch, opening balance/date; `create()` auto-links a `business_accounts` row under `120002`, same transaction-safety pattern as `vendors.service.js`/`customers.service.js`
- [ ] Confirm `CODES.BANK_ACCOUNTS` exists in `src/constants/reservedAccounts.js` / is seeded in `src/db/seeds/run.js` — `cash_and_bank.md` §11 item 1 says this chart account needs seeding
- [ ] Verify: create a bank account → linked business account appears under `120002` → soft-delete → linked account stays `ACTIVE`

## Module 4.4 — Transfer (Cash ↔ Bank) (no UC — see `cash_and_bank.md` §7)
**Newly planned (2026-08-19).** `dbo.transfers` already exists in `schema.sql`. Moves money
between two of WentoX's own `business_accounts` (cash ↔ bank, bank ↔ bank) — neither a receipt nor
an expense, must be excluded from every income/expense total and from Sale/Purchase reports.
- [ ] `transfers` (ipc handler/service/repository) CRUD + post/unpost — `CK_transfers_distinct` already blocks `from_ba_id = to_ba_id` at the DB level, but validate it in the service too for a clean 400 instead of a raw constraint error
- [ ] Post: debit `to_ba_id` / credit `from_ba_id`, `source_type = 'TRANSFER'`
- [ ] Verify: transfer between two bank accounts → both balances move → confirm Cash Book / balance reports exclude transfers from income/expense totals (not just from the ledger — a report-level exclusion, per `cash_and_bank.md` §11 item 13)

## Module 4.5 — Employees, Stages & Worker Trades (no UC — see `payroll.md` §2–§5, §7)
**Was Milestone 7 Module 7.1, "blocked on definition" — unblocked 2026-08-19.** That block was
wrong: `payroll.md` is a complete, reasoned design doc, and `dbo.employees`/`dbo.stages`/
`dbo.worker_stages` are already fully specced and applied in `schema.sql`. Sidebar label is
**Employees** (was "Workers" — `payroll.md` §7), split into two sections: Workers and Salaried
Employees, one form asking **type first** since the rest of the fields depend on it.
- [ ] `stages` (ipc handler/service/repository) — read-only lookup, 12 rows, seed via `src/db/seeds/run.js` (`payroll.md` §4's stage_key/form_label/worker_label/cost_column list — same list already defined once in `backend/src/constants` or frontend `COST_FIELDS`, don't duplicate a fourth time)
- [ ] `employees` (ipc handler/service/repository) CRUD — type-first form: Worker requires ≥1 trade (`worker_stages`), Salaried requires `monthly_salary`; `create()` auto-links a `business_accounts` row under WORKER WAGES (`220001`) or SALARIES PAYABLE (`220002`) depending on type (reuse `createUnderChartCode`)
- [ ] **`employee_type` is immutable after creation** (`payroll.md` §7) — changing it would strand `ba_id` under the wrong head and orphan trades/salary history; `update()` must reject a type change, not silently apply it
- [ ] Removing a trade / editing a salary does NOT touch history (`wage_run_items`/`salary_run_items` snapshot rate/packing/amount at posting time — see Module 4.6/4.7)
- [ ] Verify: create a worker with 0 trades rejected; create with 1 trade → linked BA under `220001`; create a salaried employee with no salary rejected → linked BA under `220002`; attempt to change `employee_type` on update rejected

## Module 4.6 — Wage Run / Piece Rate (no UC — see `payroll.md` §5–§8)
**Newly planned (2026-08-19).** One settlement: one worker + one stage + many article lines.
Reads `dbo.articles`' 12 stage-cost columns (write-only until now) but only writes
`ledger_entries` — no stock movement. `rate`/`packing` are **snapshotted** onto each
`wage_run_items` row at posting time, deliberately diverging from `dbo.articles` later so editing
an article never rewrites a wage already paid. `amount` is a persisted computed column
(`rate * cartons * packing`) — the schema enforces the arithmetic, not the app.
- [ ] `wageRuns` (ipc handler/service/repository) CRUD + post/unpost — stage list on create must filter to the chosen worker's `worker_stages` only
- [ ] Post: debit WAGES EXPENSE (`410001`) / credit the worker's `ba_id`, `source_type = 'WAGE_RUN'`
- [ ] Unpost is audited, not silent — sets `unposted_at`/`unposted_by`/`amount_before` (`CK_wage_runs_unpost` enforces all-or-nothing on those three columns)
- [ ] **No duplicate-settlement guard by design** (`payroll.md` §5, "NOTHING HERE CAN DETECT THE SAME WEEK BEING PAID TWICE") — instead, `wageRuns:list` needs a "last 3 runs for this worker+stage" query the frontend uses to show recent settlements inline, so don't skip building that filter thinking it's optional
- [ ] Verify: create a run against a worker's un-trained stage rejected; create against a trained stage with 2 article lines → `total_amount` matches `SUM(wage_run_items.amount)` → post → ledger debit/credit correct → unpost → audit columns populated, ledger rows removed

## Module 4.7 — Salary Run / Monthly (no UC — see `payroll.md` §5–§6, §11)
**Newly planned (2026-08-19).** One run per calendar month, covering every active salaried
employee at once — `CK_salary_runs_month` requires `period_month` to be the 1st of the month;
`UQ_salary_runs_month` (filtered, `WHERE status='CONFIRMED'`) blocks a second CONFIRMED run for
the same month while leaving DRAFTs unconstrained for building a correction alongside.
- [ ] `salaryRuns` (ipc handler/service/repository) CRUD + post/unpost — `create()` pre-fills one `salary_run_items` line per active salaried employee at their current `monthly_salary`, editable per-line before posting (§11: "each amount can be typed over... for a short month, an absence or a deduction")
- [ ] Post: debit SALARIES EXPENSE (`410002`) / credit each salaried employee's `ba_id`, one credit line per employee, `source_type = 'SALARY_RUN'`
- [ ] If a CONFIRMED run already exists for the target month, reject create() with a clear conflict pointing at the existing run — don't let a second one be built
- [ ] Unpost audited the same way as Wage Run (`unposted_at`/`unposted_by`/`amount_before`)
- [ ] Verify: create a run for a month with no active salaried employees → empty/rejected appropriately; create with 2 employees → totals correct → post → ledger has one credit row per employee → attempt a second CONFIRMED run same month rejected → unpost → audit columns populated
