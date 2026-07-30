# WentoX — Payroll (Piece-Rate Wages & Monthly Salaries)

**Status: design, not built.** This document is for review before any code is written.

**Revision 6** — the salary amount is now **editable on the run**, defaulting to the employee's
fixed figure (§11). `database/schema.sql` **has been updated** to match this document: all six
payroll tables exist, `workers` is renamed, and the two schema defects in §10 are fixed. The
frontend (§13 steps 3–8) is still untouched.

Revision 5 introduced the two staff kinds; `workers` became `employees` with a type discriminator,
and salaried staff got their own accrual document and account pair. Was `worker_wages.md`; renamed
because the old filename became narrower than the contents.

---

## 1. Why this exists

Two halves of the system were built and never joined:

- **Articles carry 12 manufacturing stage costs** — Cutting, Edging, Up Stitch, Bending,
  Stubble/Dori, Shape Form, Chipkai, Bottom, Machine, Trimming, Sock Stitch, Finish. Nothing reads
  them. They are write-only.
- **Workers exist** with ledger accounts under `WORKER WAGES`, and you can record what you *paid*
  them. There is no way to record what they *did*, so nothing derives what they are *owed*.

This closes that gap, and adds the salaried half of the payroll that was never modelled at all.

---

## 2. Two kinds of staff

| | **Worker** | **Salaried employee** |
|---|---|---|
| Paid for | work completed — piece rate | the month — fixed amount |
| Amount comes from | article stage cost × cartons × packing | a figure typed when the employee is created |
| Accrues via | a **wage run**, posted whenever you settle up | a **salary run**, posted once a month |
| Varies | every run | no — defaults to the fixed figure, editable per month (✔ §9.11) |
| Has trades | yes — restricted to them | no |
| Owed-money account | `WORKER WAGES` 220001 | `SALARIES PAYABLE` 220002 |
| Cost account | `WAGES EXPENSE` 410001 | `SALARIES EXPENSE` 410002 |

**One person is one type** (✔ §9.12). `employee_type` is a single value, not a pair of flags. If
someone genuinely draws a salary *and* piece work, they are entered twice — deliberately, so that
neither screen has to handle a person appearing in both sections.

Both types are the same party pattern the system already uses three times: a profile row plus a
unique `ba_id` into `business_accounts`. They differ only in which account head that `ba_id` is
created under, which is why one table serves both.

---

## 3. The client's existing sheet, decoded

```
WORKER NAME:  AMIR BOTTOM MAN
                                         stage: ( • ) Cutter Man     <- radio, one at a time
                                               (  ) Edge Painting
ARTICLE    RATE   QUANTITY     TOTAL           (  ) Upper Man
  9009       20         80    19,200           (  ) Stubble Man
   600       16         30     5,760           (  ) Bottom Man
   303       20        150    36,000           (  ) Machine Man
   700       16        200    38,400           (  ) Trimming
  6497       20        100    24,000           (  ) Socks Stitch
   800       16         50     9,600           (  ) Finish
   900       16        100    19,200           (  ) Chipkai Man

GRAND TOTAL              152,160
BAQAYA                     2,530
BANAM                     79,000
NET BALANCE               75,690      [ POST ]
```

### The arithmetic

`RATE × QUANTITY` does **not** produce `TOTAL`. `RATE × QUANTITY × 12` does — on all seven rows:

| RATE | QUANTITY | ×12 | TOTAL | ✓ |
|---|---|---|---|---|
| 20 | 80 | 19,200 | 19,200 | ✓ |
| 16 | 30 | 5,760 | 5,760 | ✓ |
| 20 | 150 | 36,000 | 36,000 | ✓ |
| 16 | 200 | 38,400 | 38,400 | ✓ |
| 20 | 100 | 24,000 | 24,000 | ✓ |
| 16 | 50 | 9,600 | 9,600 | ✓ |
| 16 | 100 | 19,200 | 19,200 | ✓ |

Sum = **152,160**, matching GRAND TOTAL exactly.

So: **QUANTITY is cartons, RATE is per pair, and 12 is the article's packing.**
Client-confirmed the multiplier is the **article's own `packing`**, not a fixed 12 — a 24-pair
article multiplies by 24.

> `schema.sql`'s comment on `dbo.articles` currently describes the wage calculation as
> *"stage rate x quantity completed"*, which omits packing and contradicts the table above.
> That comment needs correcting — see §10 finding 6.

### The balance block

```
NET BALANCE = GRAND TOTAL + BAQAYA − BANAM
     75,690 =     152,160 +   2,530 −  79,000     ✓
```

| Term | Meaning |
|---|---|
| **GRAND TOTAL** | wages earned in this run |
| **BAQAYA** | balance still owed from before. Client-confirmed: **carried automatically**, never typed |
| **BANAM** | **the cash handed over at settlement** — payments dated on or after `run_date` (✔ §9.4) |
| **NET BALANCE** | still owed |

This block is why staff accounts sit under **LIABILITY** rather than an expense head — *baqaya* is
an opening balance and *net balance* is a debt. An expense account can hold neither. That reasoning
applies identically to salaried staff, which is why `SALARIES PAYABLE` is also a liability.

### Rates vary per article

RATE is 20 for some articles and 16 for others. Selecting a stage pulls **each article's own cost
for that stage**. This is exactly what the 12 stage-cost fields are for; they stop being write-only.

---

## 4. The 12 stages

The sheet shows 10. Client-confirmed **12 is correct** — the sheet predates Bending and Shape Form.

| Stage key | Product form label | Wage screen label | `articles` column |
|---|---|---|---|
| `cutting` | Cutting | Cutter Man | `cutting` |
| `edging` | Edging | Edge Painting | `edging` |
| `upStitch` | Up Stitch | Upper Man | `up_stitch` |
| `bending` | Bending | Bending | `bending` |
| `stubbleDori` | Stubble / Dori | Stubble Man | `stubble_dori` |
| `shapeForm` | Shape Form | Shape Form | `shape_form` |
| `chipkai` | Chipkai | Chipkai Man | `chipkai` |
| `bottom` | Bottom | Bottom Man | `bottom` |
| `machine` | Machine | Machine Man | `machine` |
| `trimming` | Trimming | Trimming | `trimming` |
| `sockStitch` | Sock Stitch | Socks Stitch | `sock_stitch` |
| `finish` | Finish | Finish | `finish` |

Two label sets, one list. On an article it's *the cost of cutting*; on the wage screen it's *the man
who cuts*. ✔ Adopting a `stages` table so the list is defined once, as data (§9.7, §10 finding 3).

---

## 5. Data model

```
stages                              -- the 12 keys, defined once (✔ §9.7)
  stage_key        PK VARCHAR(20)   -- 'cutting', 'edging', ...
  form_label       NVARCHAR(40)     -- 'Cutting'    — article form
  worker_label     NVARCHAR(40)     -- 'Cutter Man' — wage screen
  cost_column      VARCHAR(30)      -- which dbo.articles column holds this rate
  sort_order       INT
  is_active        BIT

employees                           -- WAS dbo.workers (✔ §9.10)
  employee_id      PK
  name             NVARCHAR(100)
  phone            VARCHAR(30)   NULL
  city_id          FK -> cities  NULL
  employee_type    VARCHAR(10)   CHECK ('WORKER','SALARIED')
  monthly_salary   DECIMAL(12,2) NULL   -- SALARIED only
  ba_id            FK -> business_accounts, UNIQUE
                   -- created under WORKER WAGES 220001 for a WORKER,
                   -- under SALARIES PAYABLE 220002 for a SALARIED employee
  is_active        BIT
  created_at / updated_at        -- NOT created_by/updated_by: schema.sql:82 scopes
                                 -- those to DOCUMENT tables, and the other master
                                 -- tables (vendors, customers) carry neither

  CHECK (employee_type = 'SALARIED' AND monthly_salary IS NOT NULL
      OR employee_type = 'WORKER'   AND monthly_salary IS NULL)
  UNIQUE (employee_id, employee_type)     -- exists only so the FKs below can bite

worker_stages                       -- which trades a worker may be paid for (✔ §9.3)
  employee_id      \
  employee_type    /  FK (employee_id, employee_type) -> employees, CHECK = 'WORKER'
  stage_key        FK -> stages
  PK (employee_id, stage_key)
```

### Piece-rate documents

```
wage_runs
  wage_run_id      PK
  employee_id      \
  employee_type    /  FK -> employees, CHECK = 'WORKER'
  stage_key        FK -> stages
  run_date         DATE           the SETTLEMENT date, not a work date (✔ §9.5)
  total_amount     DECIMAL(14,2)  GRAND TOTAL — Σ of item amounts
  status           VARCHAR(10)    CONFIRMED | DRAFT
  unposted_at / unposted_by / amount_before        -- §8
  created_at / created_by / updated_at / updated_by

wage_run_items
  item_id          PK
  wage_run_id      FK -> wage_runs  (ON DELETE CASCADE)
  article_id       FK -> articles
  rate             DECIMAL(12,2)  SNAPSHOT of the article's stage cost
  cartons          INT            QUANTITY as entered
  packing          INT            SNAPSHOT of the article's packing
  amount           AS (rate * cartons * packing) PERSISTED     -- computed, cannot drift
  line_no          INT
  CHECK (cartons > 0), CHECK (rate >= 0), CHECK (packing > 0)
```

### Salary documents

```
salary_runs                         -- one per month, covering everyone salaried (§11)
  salary_run_id    PK
  period_month     DATE           first day of the month it pays for
  run_date         DATE           when it was posted
  total_amount     DECIMAL(14,2)  Σ of item amounts
  status           VARCHAR(10)    CONFIRMED | DRAFT
  unposted_at / unposted_by / amount_before
  created_at / created_by / updated_at / updated_by

  UNIQUE (period_month) WHERE status = 'CONFIRMED'   -- one confirmed run per month

salary_run_items
  item_id          PK
  salary_run_id    FK -> salary_runs  (ON DELETE CASCADE)
  employee_id      \
  employee_type    /  FK -> employees, CHECK = 'SALARIED'
  salary_amount    DECIMAL(12,2)  SNAPSHOT of monthly_salary at post
  amount           DECIMAL(12,2)  what was actually credited — EDITABLE (✔ §9.11)
  remarks          NVARCHAR(200)  NULL — why it differs, when it differs
  line_no          INT
  UNIQUE (salary_run_id, employee_id)   -- nobody paid twice in one month
  CHECK (amount >= 0), CHECK (salary_amount >= 0)
```

Indexes mirror the house pattern: `wage_runs(employee_id, run_date)`, `wage_runs(status)`,
`wage_run_items(wage_run_id)`, `wage_run_items(article_id)`, `salary_runs(period_month)`,
`salary_run_items(salary_run_id)`, `salary_run_items(employee_id)`.

### How the type is actually enforced

`employees` carries a redundant-looking `UNIQUE (employee_id, employee_type)`. It exists so that
`worker_stages`, `wage_runs` and `salary_run_items` can each carry `employee_type` and point a
**composite** FK at it, with a `CHECK` pinning that column to a literal.

The result: **the database physically cannot** give a salaried employee a trade, put one on a wage
run, or put a worker on a salary run. Without it, those rules live only in screen code and hold
until the first import script or manual fix. It costs one extra column on three tables and no extra
typing anywhere.

### Five decisions worth arguing about

**Rate and packing are snapshotted onto the wage line, and salary onto the salary line.** The total
depends on them, so if the article's stage cost, its packing, or an employee's salary is edited
later, history must not silently recalculate. Without this, one raise rewrites every past month —
and there would be no record of what the person was actually paid.

**Wage lines reference `article_id`, not `variant_id`.** The sheet's column is ARTICLE, the stage
costs live on `articles`, and colour is irrelevant to a piece rate. This is the one place in the
system that deliberately points at the article rather than the colour variant.

**`opening_balance` is gone.** Revision 1 stored BAQAYA on the run, snapshotted at post. Adding
unpost breaks that: unposting run #3 leaves every *later* run's snapshot stale, because each was
computed with #3 included — and nothing would flag it. Deriving BAQAYA live instead makes unpost
correct by construction, and matches the codebase: there is **no `opening_balance` column anywhere
in the current 41 tables**. The only things this schema snapshots are *inputs* whose meaning would
drift — never a derived balance.

The distinction that matters: **what the person earned stays frozen**, while **what they are owed
stays live**.

**Wage items store `cartons` + `packing`; `sale_bill_items` stores `cartons` + `pairs`.** Both keep
two of three related numbers and derive the third. On a sale line the useful number is pairs (it
drives stock); on a wage line it is packing, because packing is the snapshot whose whole purpose is
to record what the multiplier was. Store `pairs` instead and a reader must divide to discover
whether the article packed 12 or 24 — and cannot divide at all if `cartons` is 0.

**One table for both staff types, not two.** They share the party pattern, the list page, the
balance helper, and the payment path. Splitting them would duplicate all four to express one
`VARCHAR(10)` difference, and would leave `expenses.ba_id` with two possible profile tables to join
back to.

### What `run_date` does and does not tell you

A wage run is a **settlement**, not a day's work (✔ §9.5). `run_date` is the day you settled up; the
work it covers may span a week or a fortnight.

The run does **not** record which period it covers — no `period_from` / `period_to`. The client's
sheet has no such columns, and adding them means typing dates the operator currently never types.
The honest consequence: **nothing can detect that the same week's work was paid twice.** Accepted
limitation, mitigated by showing recent runs on screen (§7) rather than by a constraint.

Salary runs have no such gap — `period_month` says exactly what the run pays for, and a unique index
enforces one confirmed run per month. The asymmetry is real and deliberate: a month is unambiguous,
a piece-work settlement period is not.

---

## 6. Posting

```
Wage run posted:     Dr  WAGES EXPENSE     total_amount
                     Cr  worker BA         total_amount

Salary run posted:   Dr  SALARIES EXPENSE  total_amount
                     Cr  each employee BA  their own amount     (one credit per line)

Either one paid:     Dr  employee BA                            unchanged — an Expense today
                     Cr  CASH / BANK
```

Same two-sided shape a purchase has (`Dr PURCHASES / Cr VENDOR BA`).

**Two of these four accounts do not exist yet.** `WORKER WAGES` 220001 and `WAGES EXPENSE` 410001
are seeded (`AppContext.tsx:113,119`). `SALARIES PAYABLE` and `SALARIES EXPENSE` must be added —
`220002` under group `2000` and `410002` under group `4000`, following the existing 4-digit-head +
serial layout. Salaried business accounts then run `2200020001`, `2200020002`, … while workers keep
`2200010001`+.

**`ledger_entries` cannot currently accept any of these rows** — its `source_type` CHECK lists
neither wages nor salaries, so the insert fails. See §10 finding 1.

The frontend keeps no ledger, so "posting" there means the run is recorded and balances derive from
documents — consistent with every existing report. The entries above are for the backend.

### Everything on the sheet becomes derived

```
getEmployeeBalance(employeeId) = Σ CONFIRMED accruals − Σ payments
                                 (wage runs for a WORKER, salary run items for a SALARIED employee)

BAQAYA       = balance strictly before run_date          (live, not stored)
GRAND TOTAL  = this run's total_amount
BANAM        = payments dated on or after run_date       (✔ §9.4)
NET BALANCE  = BAQAYA + GRAND TOTAL − BANAM
```

**Only CONFIRMED runs count.** A DRAFT run contributes nothing to any balance — which is what makes
unpost meaningful rather than cosmetic.

**Why the two terms split on `run_date`.** BAQAYA is the *net* balance before the settlement date, so
it has already absorbed every earlier payment. BANAM picks up from exactly there. The two must agree
on the same cut date or the block double-counts and the sheet stops reconciling.

One consequence: **reopening an old run later may show a larger BANAM than it did on the day**,
because more payments have since been dated after that `run_date`. Correct — it is the running
balance doing its job — but a wage slip is a snapshot of when it was printed, not a frozen document.

The same helper fixes the Employees list, whose "Paid to Date" column is currently the only thing on
that page not reflecting what someone is owed.

---

## 7. Screens

### Sidebar: Workers → Employees

`AppLayout.tsx:48` currently reads `{ page: 'setup-worker', label: 'Workers', icon: HardHat }`.
The label becomes **Employees**. The page splits into two sections — **Workers** and **Salaried
Employees** — each listing its own type with the columns that make sense for it (trades and balance
for workers; monthly salary and balance for salaried staff).

### Creating an employee — type first

The form asks **which type** before anything else, because the rest of the fields depend on it:

| Field | Worker | Salaried |
|---|---|---|
| Name, phone, city | ✔ | ✔ |
| Trades (12 stages, multi-select) | ✔ **at least one required** | — |
| Monthly salary | — | ✔ **required** |

At least one trade is required for a worker — one with none can never be paid, so saving it makes a
dead record, and failing at save is kinder than failing on the wage screen weeks later. Same
reasoning makes `monthly_salary` required for salaried staff.

`ba_id` is auto-created on save, under whichever head the type implies (§6).

Editing can add or remove trades. **Removing a trade does not touch history** — `wage_runs.stage_key`
is on the run, so past runs for a dropped trade still read correctly. Changing a salary does not
touch history either, because `salary_run_items.salary_amount` snapshots what it was at the time.

**Changing an employee's *type* after creation is not supported.** It would strand their `ba_id`
under the wrong account head and orphan either their trades or their salary history. If someone
genuinely changes footing, deactivate and re-create.

### Wage run — new page under Transactions

Not Setup: it posts financial entries. Closest existing model is `PurchasePage.tsx` — multi-line
entry with a running total.

- pick worker → pick stage → add article lines
- **the stage list shows only that worker's trades** (✔ §9.3)
- choosing an article auto-fills `rate` from that article's stage cost and `packing` from the article
- operator types **cartons**; amount computes as `rate × cartons × packing`
- **a rate of 0 flags the line** (✔ §9.2) — "this article has no cost set for Cutting". The operator
  can type a rate over it or go fix the article. It does not block posting
- footer shows Grand Total, Baqaya, Banam, Net Balance
- **Post**

**Recent runs, shown inline — replaces the duplicate warning.** Revision 2 planned a modal on a
second run for the same worker + stage + date (✔ §9.1). Settling by *period* rather than by day
makes that check close to worthless: two settlements for the same man and trade on the same date are
unusual, while the real risk — paying the same fortnight twice, a week apart — never trips it.

So the screen instead lists **that worker's last three runs for the selected stage** — date and
total — as soon as the stage is picked. The operator sees *"Cutting, 16-Jul, 148,200"* and knows
whether this settlement is new. One query, no extra typing, and it catches what a date-equality
check structurally cannot.

Payments are recorded separately, so unposting a run *after* someone has been paid drives their
balance negative. The footer shows that honestly rather than clamping at zero — a negative balance
is the correct reading of "we paid for work that is no longer recorded", and hiding it is how the
discrepancy survives.

### Salary run — new page under Transactions

Deliberately almost empty, because there is nothing to type:

- pick the **month**
- the screen lists **every active salaried employee** with their `monthly_salary` pre-filled, and
  totals them
- **each amount can be typed over** (✔ §9.11) for a short month, an absence or a deduction, with a
  `remarks` box beside it. An untouched line posts the full salary, so a normal month needs no
  typing at all. A line whose amount differs from the employee's salary is highlighted, so a
  deduction is never invisible
- if that month already has a confirmed run, the screen says so and offers to open it rather than
  letting a second one be built
- **Post**

### Demo data

- **12 workers, one per stage**, so every trade is testable end to end (✔ §9.6). The three existing
  demo workers (`w1` Noman Butt, `w2` Zafar Hussain, `w3` Imran Amir — `AppContext.tsx:57`) are
  **kept and given trades**, not replaced; their `baId`s `2200010001`–`0003` may be referenced by
  other demo records. Nine more on `2200010004`–`0012`, named in the client's own style —
  *"Amir Bottom Man"*, *"Rashid Cutter Man"*.
- **4 salaried employees** on `2200020001`–`0004` — the kind of roles that actually draw a salary in
  a sole factory: a manager, an accountant, a storekeeper, a driver.

---

## 8. Edit & unpost

Applies to both run types. One mutation path only:

```
CONFIRMED  --unpost-->  DRAFT  --edit-->  DRAFT  --post-->  CONFIRMED
```

- **A CONFIRMED run is never edited in place.** Unpost first. This keeps "confirmed" meaning one
  thing — counted in the balance, not currently being changed — instead of two.
- **Unpost flips `status` to DRAFT.** Rows and lines are kept; the run stops counting toward the
  balance immediately, because §6's helper sums CONFIRMED only.
- **Editing a DRAFT run** behaves like initial entry. Snapshots re-take from the source *at the
  moment the line is (re-)added* — an edit is a fresh statement of what happened.
- **Delete is allowed only while DRAFT.** A DRAFT run contributes to nothing; deleting a CONFIRMED
  one would silently move a balance.
- **No separate draft tables**, unlike `draft_sale_bills` and friends. Those hold documents that
  were *never* confirmed. Unposting is different — the run has an identity and a history, and moving
  it between tables would either break the id or duplicate it.

Unposting a salary run releases that month's unique index, so the month can be re-posted.

### This is already how the system behaves

`AppContext.tsx:721` — `UNPOST_SALE_BILL` has existed since before this feature. It flips a posted
bill back to Unposted and restores the stock it deducted; `UPDATE_SALE_BILL` (:651) and
`DELETE_SALE_BILL` (:682) reverse the old effect and apply the new one. **Sale bills — the most
important document in the system — can already be unposted, edited, and deleted.** Payroll runs
having unpost makes them consistent, not exceptional.

Revision 2 flagged this as contradicting the cheque rule (a bounce *reverses*, never erases). That
was wrong. Both behaviours already coexist, and they split on a real distinction:

| | Correction shape | Why |
|---|---|---|
| **Cheque bounce** | reversing entry, original untouched | a **new event**. The cheque really was received and really did bounce; both are true and both belong in history |
| **Unpost** | mutate in place | a **wrong record**. The document was mistyped; there is no second real-world event to preserve |

A double-posted wage run is the second kind. No contradiction to resolve.

### The one thing payroll does not share with sale bills

A sale bill's counterparty holds their own paperwork and will argue. **A labourer does not.**
Unposting a bill moves stock and a customer ledger, both independently checkable; unposting a
payroll run changes what a person is recorded as owed, in a cash business, with nothing on the other
side of the transaction.

That is why `unposted_at`, `unposted_by` and `amount_before` are in §5's model rather than left to
the "audit trail" item in §12. They are the symmetric partner of `created_by` / `updated_by`, which
`schema.sql:82` already declares belongs on *every* document table. Three columns, no new
machinery — and they recover exactly what the cheque rule was protecting, without asking operators
to post compensating entries they will not understand.

---

## 9. Decisions — all questions answered

**Piece-rate wages**

1. ✔ **Two runs, same worker + stage + day: allowed, no constraint.** The planned modal warning is
   **replaced** by an inline list of the worker's recent runs for that stage (§7).
2. ✔ **Stage cost of 0: warn, allow override.**
3. ✔ **Workers are restricted to their trades.** `worker_stages` (§5).
4. ✔ **BANAM is the cash handed over at settlement** — payments dated on or after `run_date`;
   BAQAYA is the balance strictly before it (§6).
5. ✔ **A wage run covers a settlement period, not a day.** The period itself is not recorded —
   accepted limitation (§5).
6. ✔ **Trades are chosen when a worker is created**, at least one required. Demo data seeds 12
   workers, one per stage (§7).
7. ✔ **Adopt the `stages` lookup table** (§5, §10 finding 3).

**Employees & salaries**

8. ✔ **The Workers page becomes Employees**, split into Workers and Salaried Employees (§7).
9. ✔ **Creating an employee asks the type first**; the remaining fields follow from it (§7).
10. ✔ **One `employees` table with an `employee_type` discriminator**, replacing `workers` — not two
    tables (§5).
11. ✔ **Salaried staff accrue via a monthly salary run.** The salary is recorded when the employee
    is created and pre-fills each line; **the operator can edit the amount** for a short month, an
    absence or a deduction, with `remarks` for why. *Revised — revision 5 had this fixed and
    uneditable; that made the ledger claim a full month was owed even when it was not (§11).*
12. ✔ **One type per person.** Someone who does both is entered twice (§2).
13. ✔ **Separate account pair for salaries** — `SALARIES PAYABLE` 220002 and `SALARIES EXPENSE`
    410002, alongside the existing wage pair (§6).

Nothing is blocked. What remains is §10 — defects in the existing schema that this depends on.

---

## 10. Data integrity audit

Checked against `database/schema.sql` as it stands.

### 1. `ledger_entries` rejects every payroll posting — ✅ **fixed**

`CK_ledger_entries_src` restricts `source_type` to:

```
SALE_BILL, SALE_RETURN, RECEIPT, COMMISSION, EXPENSE,
PURCHASE, PURCHASE_RETURN, CHEQUE_ALLOCATION, OPENING
```

Neither wages nor salaries appeared. §6's entries would have failed the CHECK on insert — not
silently wrong, but a hard error the first time anyone posted. `WAGE_RUN` and `SALARY_RUN` are now
in the constraint, with a comment noting that *paying* either is still an `EXPENSE` row rather than
a third new type.

### 2. Derived totals — redundant, but this is the house pattern

| Column | Duplicates | Precedent |
|---|---|---|
| `wage_run_items.amount` | `rate × cartons × packing` | `sale_bill_items.value`, `purchase_items.total_price` |
| `wage_runs.total_amount` | `Σ item amounts` | `sale_bills.gross_value` / `net_value` |
| `salary_runs.total_amount` | `Σ item amounts` | same |

Derived data stored anyway, and the schema does this everywhere — so payroll should not be the one
exception. But **nothing in the current schema enforces these**: no table uses a computed column
(`grep PERSISTED` returns nothing), so `sale_bill_items.value` can silently disagree with
`pairs × rate` today.

Wage lines can do better for free: `amount AS (rate * cartons * packing) PERSISTED` is a genuine
MS SQL computed column — stored, indexable, and **arithmetically incapable of drifting**. First such
column in this schema, which is the only argument against it.

Neither `total_amount` can get that treatment — a computed column may not aggregate over a child
table — so both stay denormalized and must be rewritten inside the same transaction as any line
change. A real invariant the backend has to hold, worth writing down rather than discovering.

`salary_run_items.amount` is *not* computed and must not be: it is an operator input pre-filled from
`salary_amount`, not an arithmetic result. There is nothing to derive it from, and making it
computed would destroy exactly the override the run exists to allow.

### 3. The 12 stages are spelled out four times — ✔ fixing via `stages`

Without a lookup table the list lives in 12 `articles` columns, a `CHECK` on `wage_runs.stage`, a
`CHECK` on `worker_stages.stage`, and the frontend `COST_FIELDS` array — four coordinated edits to
add a stage, two of them able to drift apart silently.

§5's `stages` table makes both stage columns FKs and moves both label sets into data. The 12
`articles` columns stay: normalising those into `article_stage_costs(article_id, stage, cost)` would
be the fully-normalised answer, but the article form is already built around the columns, the client
confirmed the 12, and `stages.cost_column` bridges the gap. **Lookup table yes, column rewrite no.**

### 4. Intentional redundancy — leave it alone

Flagged so a later reader does not "fix" them:

- **`rate` / `packing` / `salary_run_items.salary_amount` duplicate current values.** On purpose.
  They are snapshots; the whole point is that they *stop* matching when the source is edited.
- **`salary_amount` and `amount` on the same line look like one column too many.** They are not.
  Equal in a normal month, they diverge on a deduction — and the gap between them is the only
  record that a deduction happened at all.
- **`wage_runs.stage_key` is not constrained to the worker's `worker_stages`.** Also on purpose.
  Trades change; runs already posted under a dropped trade must still read correctly. The FK goes to
  `stages`, never to `worker_stages`.
- **`employee_type` is duplicated onto three child tables.** Not denormalization for speed — it is
  the mechanism that makes the composite FKs enforce type (§5).

### 5. House-pattern divergences — corrected in §5

- `confirmed_by` → **`created_by` / `updated_by`**. `schema.sql:82` states these belong on every
  document table, and `sale_bills` (:639, :649-650) already carries them.
- **`line_no` was missing.** Both existing item tables have it; without it, line order after an edit
  depends on `item_id`, which reorders the moment a line is deleted and re-added.
- **No CHECK constraints.** Existing item tables constrain quantities. Added.
- **No indexes.** Added, mirroring `IX_sale_bill_items_bill` / `_variant`.

### 6. `schema.sql`'s own comment on wages was wrong — ✅ **fixed**

`dbo.articles` described the wage calculation as *"stage rate x quantity completed"* — omitting
packing, which would give 12,680 instead of 152,160 on the client's sheet. It said this in **two**
places (the table header comment and inline above the stage columns); both now read
*stage rate × cartons × packing*, and the inline one points at `wage_run_items` for the snapshots.

### 7. Renaming `workers` → `employees` touches more than the table

`dbo.workers` is referenced by its own comments (`schema.sql:414-449`), the frontend `Worker` type
(`types/index.ts:34`), `WorkerSetupPage.tsx`, `demoWorkers` (`AppContext.tsx:57`), the sidebar entry
(`AppLayout.tsx:48`), and the Payment Trail's "Employees" row — which, notably, **already calls them
employees**. The rename brings the schema in line with what the reports have been saying all along.

Nothing is deployed yet — `schema.sql` is a file, not a live database — so this costs edits, not a
migration. Doing it now is far cheaper than after the first import.

### 8. Naming: `Posted/Unposted` vs `CONFIRMED/DRAFT` — pre-existing, do not make it worse

The frontend types status as `'Posted' | 'Unposted'` (`SaleBillPage.tsx:36`); the schema uses
`CONFIRMED | DRAFT` on all six document tables. Sale bills already straddle this split. Payroll runs
follow the same convention on each side rather than inventing a third spelling.

---

## 11. The salary run

Salaried staff are paid once a month, so the document is deliberately thin: **pick a month, check
the list, post.** Every line pre-fills from `employees.monthly_salary`, recorded when the employee
was created — in a normal month nothing is typed at all.

Why a document at all, rather than just recording the payment as an Expense:

- `SALARIES PAYABLE` is a **liability**, and a liability that nothing ever credits stays at zero. The
  run is what puts "we owe the staff 340,000 for July" on the books before anyone is paid.
- It makes the same balance block work for salaried staff as for workers — accrued, paid, still
  owed — with one helper (§6).
- Unpost/edit come free, since they key off `status` exactly as wage runs do.

**One confirmed run per month**, enforced by a filtered unique index on `period_month`. Unlike wage
runs, this constraint is worth having: a month is unambiguous, so a duplicate is always a mistake.

### Why the amount is editable, and why there are two of them

Revision 5 had the amount fixed and uneditable. The flaw: **someone hired on the 25th was credited a
full month**, and a month with three weeks' absence still posted in full. The shortfall could be
settled by paying less — but the *ledger* would go on claiming you owed a full month when you had
agreed you did not. The liability would be wrong, not just the convenience.

So the line carries **two** amounts:

| Column | Is | Editable |
|---|---|---|
| `salary_amount` | snapshot of `employees.monthly_salary` at post time | no |
| `amount` | what was actually credited | **yes**, pre-filled from `salary_amount` |

Equal in a normal month. When they differ, the deduction is **visible and explicable** — `remarks`
says why — instead of the ledger silently disagreeing with the employee's stated salary.

Storing both matters for the same reason `wage_run_items` snapshots rate and packing. Without
`salary_amount`, a line reading 35,000 against a man whose salary later became 60,000 is unreadable:
was that a deduction, or was 35,000 simply his salary back then? One column cannot answer that; two
can, forever.

This is still **not** an attendance system. Nothing computes the deduction — a person decides it and
types it. Pro-rata, absence tracking and overtime remain out of scope (§12).

---

## 12. Not in scope

- **Auto-posting payments.** Paying anyone stays a manual Expense, as today.
- **Attendance tracking, and anything that *computes* a deduction.** A deduction is typed by a
  person who has decided it, with `remarks` for why (§11) — nothing derives it from days present.
- **Changing an employee's type after creation.** See §7.
- **A full edit history.** §5 records who unposted a run, when, and what it was worth — not a
  row-by-row diff. "What did line 3 say before Tuesday" is a separate design.
- **Period tracking on a wage run.** See §5 — deliberately omitted, limitation stated.
- **Bonuses, overtime, advances as first-class documents.** An advance already works today: pay
  early, and the balance goes negative until the next accrual clears it.
- **Backend.** Still 100% scaffolding — this is frontend plus schema only.

---

## 13. Build order

1. ✅ **done** — `schema.sql`: `stages`, `workers` → `employees` (+ type, salary, composite unique),
   `worker_stages`, `wage_runs`, `wage_run_items`, `salary_runs`, `salary_run_items`. 40 tables → 46.
2. ✅ **done** — `schema.sql`: `WAGE_RUN` / `SALARY_RUN` added to `CK_ledger_entries_src`; both
   `dbo.articles` comments corrected; payroll invariants written into the END OF SCHEMA block.
3. Seed `SALARIES PAYABLE` 220002 and `SALARIES EXPENSE` 410002 into the chart of accounts
   (`AppContext.tsx:113,119` is where the existing pair lives), and the 12 `stages` rows
4. Frontend types + `AppContext` — `Employee` replaces `Worker`, stages, both run types,
   reducer actions including unpost
5. Employees page — rename, two sections, type-first create form
6. Wage run page
7. Salary run page
8. Demo data — 12 workers with trades, 4 salaried employees

### What was checked on the schema, and what was not

Verified mechanically: every FK target exists and is defined *before* it is referenced; no duplicate
`CONSTRAINT` or index names anywhere in the file (MS SQL requires these globally unique — the first
draft collided `DF_sr_*` with `sale_returns`, since fixed); parentheses balanced in every table.

**Not verified: the file has never been executed.** There is no MS SQL instance in this environment,
so nothing has parsed it. The computed column, the filtered unique index and the composite FKs are
all written to standard T-SQL, but "it reads correctly" is a weaker claim than "it ran".

---

## Appendix — a stale file worth knowing about

`frontend/CLAUDE.md` describes a data model that no longer exists: `Article`/`Slip`/`Client`/
`Production`/`ChemPurchase`, pages keyed on `slips`/`production`/`chemical`/`profit`. The current
app has `SaleBillPage`, `PurchasePage`, `VendorSetupPage` and the rest. Anyone — or any tool —
reading it for orientation will be misled. Not part of this feature; flagged because it sits in the
path of whoever builds it.
