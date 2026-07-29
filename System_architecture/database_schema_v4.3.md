# WentoX — Database Schema (Microsoft SQL Server)

**Version 4.3 — tentative, for review before the migration script is written.**

> **v4.3 changes:** merged in the working-session actions/answers applied on top of the reverted
> v4.0 copy, so this file now carries both lineages. Renames `articles` → `products` (cascaded to
> `product_id` and all constraint/index names). Promotes `account_class` from a fixed `CHECK` list
> to a real lookup, `dbo.account_classes`. Adds `draft_sale_bills`/`draft_sale_bill_items` (§5.6.1)
> and their mirror `draft_sale_returns`/`draft_sale_return_items` (§5.6.2) — dummy/unconfirmed bills
> and returns that deduct/restore stock on save/delete, with no ledger entry until confirmed.
> Removes `due_date` from `sale_bills` and `purchases`, dropping the payment-overdue alert entirely
> (only cheque-due survives). Makes `sale_bills`/`sale_returns.bill_no`, `gp_no`, `bilty_no`,
> `adda_id` `NOT NULL` and `store_id` nullable with `ON DELETE SET NULL` — **this removes the
> "Without Bilty"/"Without Adda" dispatch-later workflow**, flagged as a real behaviour change, not
> a formality. Pulls cheque data out of `receipts`/`expenses` into new `bank_accounts` and `cheques` tables
> (cheque now has one shared lifecycle row, including `bounced_date`, moved off `receipts`), plus
> `draft_receipts`/`draft_expenses` for the same dummy-record pattern. Removes `remarks` from
> `stock_movements`/`vendor_stock_movements`.
>
> **v4.2 changes:** reconciled against a screenshot of the client's **legacy** Business Accounts
> Ledger. Adds §3.2, the account-code composition rule that was missing entirely — and widens the
> business-account serial to 4 digits, because the frontend's 2 digits cap a chart account at 99
> children while the legacy data already holds 218 under one. Adds `legacy_code` to the three
> account tables (import reconciliation only) and `city_id` to `business_accounts`, which UC-36
> displays for accounts that have no customer to inherit a city from. Records the financial year as
> a filter with no structural effect, and logs bank accounts as a genuine remaining gap.
>
> **v4.1 changes:** reconciled against Milestone 6, which built the §12/§13 cheque features in the
> frontend. Adds the missing `receipts.bounced_date` column (the whole reversal model is dated by
> it), its `CHECK`, the two bounce rows in the posting matrix, and a new §6.1 spelling out
> reverse-never-erase. §5.10's "planning only" framing is gone — those tables now match a working
> implementation.

Derived **solely** from `architecture-v2.md` (the single source of truth for this project) plus the
client decisions recorded in §2 below. The previous v3 schema, `use_cases.md`, `architecture.md`,
`new_features-v1.0.md` and the applied PostgreSQL migration `backend/src/db/migrations/001_init.sql`
were **not** used as inputs — they are known-stale and are being regenerated downstream of this file.

30 tables. Normalised to 3NF. Every money column is `DECIMAL`, never `FLOAT`/`REAL`.

> **Status of this document:** no database exists yet — nothing here has been created in SQL. The
> frontend has, however, already built against this shape (Milestones 2–6) using in-memory demo
> data, so the table shapes are validated by a working UI rather than by inspection alone. This is
> the design to review. Once
> approved it becomes the migration script verbatim — the DDL below is real, runnable T-SQL, not
> pseudo-code, so there is no translation step in which errors can creep in.

---

## 1. What changed versus the previous schema

`architecture-v2.md` §0 states the situation plainly: the old Postgres schema is missing large
parts of the target system. This version closes those gaps.


| Area               | Previous state                                                | This version                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform           | PostgreSQL (native`ENUM`, `TIMESTAMPTZ`, `IDENTITY`)          | **MS SQL Server** (`CHECK` constraints, `DATETIME2`, `IDENTITY(1,1)`)                                                                                                              |
| Control Accounts   | `control_accounts` table, parent of chart + business accounts | **Dropped entirely** (§9 / TASK-11). Hierarchy is now Group → Chart → Business                                                                                                  |
| Products           | One flat`products` table, colour as a loose column            | Split into**`articles` + `article_colors`**, so TASK-03's article rows with colour sub-rows are a real relationship, not string-parsing                                            |
| Regions            | Free-text`region` column on `business_accounts`               | Real**`regions`** lookup; customer identification is Region first, City second (§10 gap 6, §11)                                                                                  |
| Sub customers      | `customer_id NOT NULL` FK to parent                           | **Parent FK removed** — independent flat list (§10, TASK-06)                                                                                                                     |
| Purchases          | Did not exist                                                 | **`purchases` + `purchase_items` + returns**, feeding a separate vendor stock (§2 below)                                                                                          |
| Materials          | Did not exist                                                 | **`materials`** — self-building lookup, auto-registered the first time a name is typed (§2 below)                                                                                |
| Vendor ↔ accounts | No link                                                       | **`vendors.ba_id`** → `business_accounts`, so Purchase and Expense-as-vendor-payment resolve to the same real vendor (§10 gap 2)                                                 |
| Commission         | Did not exist                                                 | **`receipts.commission`**, posted as a credit row on the customer ledger (§7)                                                                                                     |
| Cheques            | `details` free text only                                      | **`cheque_no` / `cheque_date` / `cheque_received_date` / `cheque_status` / `bounced_date`** (§12), plus `cheque_allocations` for endorsement and the bounce cascade (§13, §6.1) |
| Roles              | No role column                                                | **`users.role`** + a data-driven restriction flag on accounts (§8 / TASK-14)                                                                                                      |
| Due dates / alerts | Did not exist                                                 | Optional`due_date` on sale bills and purchases, plus `alert_dismissals` (§12)                                                                                                     |

---

## 2. Client decisions that shape this schema

Settled directly with the client. Where one of these conflicts with `architecture-v2.md`, the
client's answer wins and the conflict is called out explicitly.

1. **Purchase buys raw materials, entered open-ended** — "PU Sheet Roll", "Buckle Fasteners", in
   units like Meters and Buckles. The user types **any** new material name freely; from then on
   that name **comes back as a dropdown option from the database**, so the next purchase picks the
   existing name instead of retyping it. Entry stays open-ended; only re-entry is constrained.
   This is what prevents the same material fragmenting into several near-identical stock lines.
2. **Purchases never touch finished-goods (pairs) stock.** They feed a **separate vendor stock**,
   shown as a `Vendor Stock` sub-page inside the Stock page.
   > ⚠️ **This overrides `architecture-v2.md` §6 and §10 gap 5**, which called for adding
   > `PURCHASE` and `PURCHASE_RETURN` values to `stock_movements.movement_type`. Those values are
   > **not** added here — pairs stock still moves only via Production, Sale and Sale Return.
   > §14's Vendor Stock sub-page is therefore expressed in **material units, not pairs**.
   >
3. **Vendor stock is a movement ledger**, not a running-balance column — signed rows, balance is
   `SUM(qty)`. Same auditable pattern as `stock_movements`.
4. **Purchase is a confirmable document** (Confirmed/Draft, like Sale Bill). Confirming writes ledger
   entries **and** vendor-stock movements inside one transaction.
5. **Vendor stock is reduced two ways**: by a Purchase Return, and by a manual "this much has been
   used" reduction entered against a specific vendor's stock line on the Vendor Stock page.
6. **Articles split into `articles` + `article_colors`** — cost breakdown on the article, colour
   and an optional packing override on the variant.
7. **Customers mirror vendors** — own PK plus a unique `ba_id` into `business_accounts`.
8. **A bounce reverses, it never erases** — the correction is posted as counter-entries dated
   `cheques.bounced_date` (moved off `receipts` in the §5.8 cheque redesign); original rows and
   `allocation_date`s are left untouched, so a report
   printed before the bounce still reconciles after it. See §6.1.
9. **Cheque-due alerts turn amber 7 days before the date on the cheque**, red once it has passed.
   Payment-overdue alerts fire only where an explicit `due_date` was entered *and* a balance is
   still outstanding — there is deliberately no fallback credit period.
10. **The full cheque lifecycle is in use** — `PENDING → DEPOSITED → CLEARED`,
    `PENDING → PARTIALLY_ENDORSED → ENDORSED`, and `BOUNCED` reachable from any state. No value in
    `cheque_status` is unreachable.
11. **Account codes are internal identifiers, not something users memorise.** The client confirmed
    staff look accounts up by name, never by number, so the legacy 12-digit codes carry no meaning
    worth preserving in the UI and the numbering scheme is ours to design (§3.2).
12. **The legacy codes are still stored, for import reconciliation only.** A nullable `legacy_code`
    on the three account tables ties each new account back to its old one, so opening balances can
    be checked account-for-account after migration. Never shown to users, and impossible to
    reconstruct later if skipped.
13. **The financial year is a filter, not a structure.** The legacy ledger defaults to 01/07–30/06,
    but reports simply select monthly / annually / between two dates. There is deliberately **no**
    fiscal-year table, no year-end closing, no carry-forward balances, and no year component in any
    document number — dates stay plain dates.

---

## 3. Conventions applied to every table

- **Schema:** everything in `dbo`.
- **PK:** `INT IDENTITY(1,1)`, named `PK_<table>`.
- **Naming:** `snake_case` tables and columns; constraints prefixed `PK_ FK_ UQ_ CK_ DF_`, indexes `IX_`.
- **Text:** `NVARCHAR` for anything a human types (names, remarks, addresses — Urdu/mixed script safe).
  `VARCHAR` only for machine codes and enum-style values.
- **Money:** `DECIMAL(14,2)`. **Rates/costs:** `DECIMAL(12,2)`. **Material quantities:** `DECIMAL(14,3)`
  (materials are sold by weight/length, so fractional). **Pairs/cartons:** `INT` (never fractional).
- **Dates:** `DATE` for business dates (bill date, cheque date). `DATETIME2(0)` for audit stamps.
- **Audit:** every table has `created_at`/`updated_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()`.
  `updated_at` is maintained by a per-table `AFTER UPDATE` trigger (§13 — MS SQL has no shared
  trigger function, so one trigger per table, generated by script). Document tables (§12 open Q6,
  answered) also carry `updated_by INT NULL` beside `created_by`, application-set on every update —
  `created_by`/`updated_by` are single-user-app niceties today, but resolve who changed a row once
  multiple staff share the system, without a later migration.
- **Soft delete:** `is_active BIT NOT NULL DEFAULT 1` on lookup/setup tables. Transactions are never
  soft-deleted — they are still in DRAFT or edited.
- **Document numbers:** `VARCHAR(30)` — real-world bill/GP/bilty numbers are alphanumeric.
- **FK behaviour:** default `NO ACTION` (= RESTRICT), so a referenced Adda or Customer cannot be
  hard-deleted. Only document→line-item relationships use `ON DELETE CASCADE`.
- **Nullable uniques:** MS SQL's `UNIQUE` constraint permits only one NULL, so nullable unique
  columns use a **filtered unique index** (`WHERE col IS NOT NULL`) instead.
- **Required SET options:** the migration must run — and the application must connect — with
  `ANSI_NULLS`, `QUOTED_IDENTIFIER`, `ANSI_PADDING`, `ANSI_WARNINGS`, `ARITHABORT` and
  `CONCAT_NULL_YIELDS_NULL` **ON**, and `NUMERIC_ROUNDABORT` **OFF**. This is not optional
  housekeeping: every filtered index below will fail to build, and later `INSERT`/`UPDATE`
  statements against those tables will fail at runtime, if a session has the wrong options set.
- **Collation:** the database should use a **case-insensitive** collation (e.g.
  `SQL_Latin1_General_CP1_CI_AS`). `UQ_materials_name` relies on it — retyping `pu sheet roll`
  must collide with `PU Sheet Roll` rather than create a duplicate material.

### 3.1 Enum replacement

MS SQL has no `CREATE TYPE ... AS ENUM`. Each former enum becomes a `VARCHAR` column with a named
`CHECK`. Values are UPPERCASE; the API maps them to the frontend's display labels.

> **Action applied:** `account_class` is promoted out of this table into a real lookup
> (`dbo.account_classes`, §5.3) — same self-building pattern as `materials` (§4.3) — so a new class
> is a row insert, not a schema migration. The rest below are genuinely fixed, closed sets baked
> into app logic, so they stay `CHECK`-constrained.


| Former enum                  | Column type   | Allowed values                                                                 |
| ---------------------------- | ------------- | ------------------------------------------------------------------------------ |
| `account_status`             | `VARCHAR(10)` | `ACTIVE`, `CLOSED`                                                             |
| `payment_mode`               | `VARCHAR(10)` | `CASH`, `CHEQUE`, `ONLINE`                                                     |
| `confirm_status`             | `VARCHAR(10)` | `CONFIRMED`, `DRAFT`                                                           |
| `delivery_type`              | `VARCHAR(10)` | `SAME`, `CUSTOM`                                                               |
| `stock_movement_type`        | `VARCHAR(15)` | `OPENING`, `ADJUSTMENT`, `PRODUCTION`, `SALE`, `SALE_RETURN`                   |
| `vendor_stock_movement_type` | `VARCHAR(20)` | `PURCHASE`, `PURCHASE_RETURN`, `CONSUMPTION`, `ADJUSTMENT`                     |
| `cheque_status`              | `VARCHAR(20)` | `PENDING`, `DEPOSITED`, `ENDORSED`, `PARTIALLY_ENDORSED`, `CLEARED`, `BOUNCED` |
| `user_role`                  | `VARCHAR(10)` | `ADMIN`, `USER`                                                                |

---

### 3.2 Account code composition

Group, chart and business accounts each carry a human-readable `code`. **A child's code is its
parent's code with a zero-padded serial appended**, so the hierarchy is visible in the number
itself:

```
GROUP     4 digits    1000 ASSETS   2000 LIABILITY   3000 INCOME   4000 EXPENSES

CHART     6 digits    CC + SSSS
                      ││   └── 4-digit serial within that class/sub-group
                      └┴────── class + sub-group
                      110001  CUSTOMERS ACCOUNTS            (1 = asset, 1 = receivables)
                      120002  BANK ALFALAH A/C - 0124       (1 = asset, 2 = cash & bank)
                      440001  DIRECTORS EXPENSES - DRAWINGS (4 = expense, 4 = drawings)

BUSINESS  10 digits   <parent chart code> + SSSS
                      1100010001  Ahmed Footwear (LHR)   under 110001
                      4400010017  BORROWINGS             under 440001
```

**Allocation rule:** `serial = MAX(existing serial under that parent) + 1`, zero-padded to width.
Serials are **never reused** after a delete — a gap is correct and expected.

The code is **stored, not derived**. It is written once at creation and never recomputed, so
reorganising the hierarchy later cannot silently renumber existing accounts or invalidate documents
that reference them.

> **Why the business serial is 4 digits.** The frontend currently generates 2 (`210001` + `01`),
> which caps a chart account at 99 children. The client's legacy data already holds **at least 218**
> accounts under a single Main Account (`841000002218`), so an import would have hit that ceiling
> immediately. Four digits allows 9,999.

`code` is `VARCHAR(20)` on all three tables — comfortably wider than the 10 digits this needs, with
room to widen a level later without a migration.

**Legacy codes.** The client's existing system numbers accounts differently (12 digits, e.g.
`841000004017`). Those numbers are **not** carried into `code`, because staff look accounts up by
name and never by number (§2 decision 11). They are preserved in a separate nullable `legacy_code`
purely so the migration can be proved correct — join old to new on it and confirm every opening
balance matches. It is never displayed, and deliberately **not** unique, since two legacy accounts
may legitimately be merged into one.

---

## 4. Design decisions

### 4.1 Pairs stock is derived from `stock_movements` — no stored stock column

Per §6, current stock of a colour variant is `SUM(qty_pairs)` over its movements. Sale rows are
negative; Production and Sale Return rows are positive. This keeps stock always consistent with
transactions and trivially auditable, and it is what makes the Product Ledger (TASK-02) free —
the ledger *is* the movement table, filtered.

`PRODUCTION` rows double as the production log: they keep the raw user input (`input_qty` +
`input_unit`) and a `packing` snapshot, while `qty_pairs` always stores normalised total pairs.
The carton/extra-pair display in TASK-03's sub-rows is derived:
`cartons = total_pairs / packing`, `extra = total_pairs % packing`.

The business has a **single store**, so movements carry no `store_id` — `stores` remains bill
metadata only.

### 4.2 Vendor stock is a second, independent ledger

Because purchases are raw materials in their own units (§2 decisions 1–2), mixing them into
`stock_movements` would mean one table holding two incompatible quantity units. Instead
`vendor_stock_movements` is a parallel ledger keyed on vendor + material + unit. The Vendor Stock
page is a single `GROUP BY`; the Current Stock page never sees these rows.

### 4.3 `materials` is a self-building lookup, not a master list to maintain

Per §2 decision 1, material entry is open-ended but re-entry is not. The `materials` table is never
curated by hand and has no setup screen:

- The Purchase line's material field is a **searchable dropdown reading `materials`**, plus the
  option to type something new.
- Typing a name that does not exist **auto-creates the row** as part of saving the purchase — the
  user experiences it as free text.
- Every subsequent purchase finds that name in the dropdown instead of retyping it.

Purchase lines therefore store a `material_id`, not a string, which is what makes vendor-stock
totals reliable: the same material can no longer split across "PU Sheet", "PU sheet roll" and
"P.U. Sheet Roll". `materials.name` carries a `UNIQUE` constraint on a case-insensitive collation,
so a differently-cased retype resolves to the existing row rather than creating a twin.

This also supplies the repair path that free text could never have: if two rows do get created for
the same real material, an admin can repoint one `material_id` and delete the duplicate, and all
history corrects itself. Renaming a material likewise propagates to historical documents by
design — it is the same physical material, so its current name is the right one to display.

`materials.default_unit` pre-fills the unit on a new purchase line; the line keeps its own `unit`
column, since the same material may occasionally be bought in a different unit.

### 4.4 Double-entry via `ledger_entries`, with real foreign keys

`CONFIRMED`/`DRAFT` is made meaningful by a journal table. **Posting** a document writes its ledger
rows (and its stock/vendor-stock rows) inside one transaction; **unposting** deletes them in one
transaction.

The previous design used a polymorphic `account_type` + `account_id` pair, which SQL Server cannot
enforce with a foreign key — a typo could point a ledger row at a nonexistent account and nothing
would object. This version uses **two nullable FK columns, `ac_id` and `ba_id`, with a `CHECK` that
exactly one is populated**. Same flexibility, real referential integrity.

### 4.5 A Vendor and a Customer are both a `business_accounts` row plus a profile

Resolving §10 gap 2: a vendor must be a single source of truth shared by Purchase (which needs
`vendor_id`) and Expense-as-vendor-payment (which needs `ba_id`). So `vendors` carries a unique
`ba_id`, auto-created under the reserved **VENDORS ACCOUNTS** chart account when the vendor is
created — one form, no separate account-setup step exposed to the user.

`customers` follows the identical pattern under the reserved **CUSTOMERS ACCOUNTS** chart account.
`customers.ba_id` is **nullable**, and that is precisely what drives TASK-05: when a customer is
selected on a Sale Bill and `ba_id IS NULL`, the UI shows *"Please add customer account first"*.

### 4.6 Role restriction is data-driven, not hardcoded

§8 blocks the `USER` role from "Bank Accounts" and "Directors Expenses - Drawings". Rather than
matching account names in application code, `chart_of_accounts.is_restricted BIT` marks them, and
the middleware filters on the flag. Adding a future restricted account is then a data change.

### 4.7 Editing rule

Financial fields are editable only while `DRAFT`. `bilty_no` and `adda_id` may be updated on
confirmed bills, since they are non-financial dispatch metadata (§9's Search & Bilty Adda Updation).

---

## 5. Schema DDL

### 5.1 System / auth

```sql
CREATE TABLE dbo.users (
  user_id       INT IDENTITY(1,1) NOT NULL,
  username      VARCHAR(50)   NOT NULL,
  password_hash VARCHAR(100)  NOT NULL,                       -- bcrypt
  full_name     NVARCHAR(100) NULL,
  role          VARCHAR(10)   NOT NULL CONSTRAINT DF_users_role      DEFAULT ('USER'),
  is_active     BIT           NOT NULL CONSTRAINT DF_users_active    DEFAULT (1),
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_users_created   DEFAULT (SYSUTCDATETIME()),
  updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_users_updated   DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_users      PRIMARY KEY (user_id),
  CONSTRAINT UQ_users_name UNIQUE (username),
  CONSTRAINT CK_users_role CHECK (role IN ('ADMIN','USER'))
);
```

### 5.2 Setup / lookup

```sql
CREATE TABLE dbo.regions (                                    -- §10 gap 6, TASK-07
  region_id  INT IDENTITY(1,1) NOT NULL,
  name       NVARCHAR(100) NOT NULL,
  is_active  BIT          NOT NULL CONSTRAINT DF_regions_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_regions_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_regions_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_regions      PRIMARY KEY (region_id),
  CONSTRAINT UQ_regions_name UNIQUE (name)
);

CREATE TABLE dbo.cities (
  city_id    INT IDENTITY(1,1) NOT NULL,
  name       NVARCHAR(100) NOT NULL,
  region_id  INT          NULL,                               -- optional roll-up of city into region
  is_active  BIT          NOT NULL CONSTRAINT DF_cities_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_cities_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_cities_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_cities        PRIMARY KEY (city_id),
  CONSTRAINT UQ_cities_name   UNIQUE (name),
  CONSTRAINT FK_cities_region FOREIGN KEY (region_id) REFERENCES dbo.regions(region_id)
);
CREATE INDEX IX_cities_region ON dbo.cities(region_id);

CREATE TABLE dbo.stores (
  store_id   INT IDENTITY(1,1) NOT NULL,
  name       NVARCHAR(100) NOT NULL,
  is_active  BIT          NOT NULL CONSTRAINT DF_stores_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_stores_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_stores_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_stores      PRIMARY KEY (store_id),
  CONSTRAINT UQ_stores_name UNIQUE (name)
);

CREATE TABLE dbo.addas (                                      -- transport terminals
  adda_id    INT IDENTITY(1,1) NOT NULL,
  name       NVARCHAR(100) NOT NULL,
  city_id    INT          NULL,
  details    NVARCHAR(200) NULL,
  is_active  BIT          NOT NULL CONSTRAINT DF_addas_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_addas_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_addas_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_addas      PRIMARY KEY (adda_id),
  CONSTRAINT UQ_addas_name UNIQUE (name),
  CONSTRAINT FK_addas_city FOREIGN KEY (city_id) REFERENCES dbo.cities(city_id)
);
-- Hard-deleting an adda referenced by a sale bill is blocked by FK NO ACTION; use is_active = 0.

CREATE TABLE dbo.materials (                                  -- §4.3 self-building; no setup screen
  material_id  INT IDENTITY(1,1) NOT NULL,
  name         NVARCHAR(150) NOT NULL,                       -- as first typed, e.g. 'PU Sheet Roll'
  default_unit NVARCHAR(30)  NULL,                           -- pre-fills the unit on a new line
  is_active    BIT          NOT NULL CONSTRAINT DF_materials_active  DEFAULT (1),
  created_at   DATETIME2(0) NOT NULL CONSTRAINT DF_materials_created DEFAULT (SYSUTCDATETIME()),
  updated_at   DATETIME2(0) NOT NULL CONSTRAINT DF_materials_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_materials      PRIMARY KEY (material_id),
  -- case-insensitive collation: retyping 'pu sheet roll' resolves to the existing row, never a twin
  CONSTRAINT UQ_materials_name UNIQUE (name)
);
CREATE INDEX IX_materials_name ON dbo.materials(name) WHERE is_active = 1;   -- dropdown typeahead

CREATE TABLE dbo.product_categories (
  category_id INT IDENTITY(1,1) NOT NULL,
  name        NVARCHAR(100) NOT NULL,
  is_active   BIT          NOT NULL CONSTRAINT DF_categories_active  DEFAULT (1),
  created_at  DATETIME2(0) NOT NULL CONSTRAINT DF_categories_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0) NOT NULL CONSTRAINT DF_categories_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_product_categories      PRIMARY KEY (category_id),
  CONSTRAINT UQ_product_categories_name UNIQUE (name)
);
```

### 5.3 Accounts hierarchy — Group → Chart → Business

`control_accounts` is **deleted** (§9, TASK-11). `chart_of_accounts` now hangs directly off
`group_accounts`, and `business_accounts` off `chart_of_accounts`.

```sql
CREATE TABLE dbo.account_classes (
  class_id   INT IDENTITY(1,1) NOT NULL,
  code       VARCHAR(10)   NOT NULL,                          -- 'ASSETS','LIABILITY','INCOME','EXPENSES', ...
  name       NVARCHAR(50)  NOT NULL,
  is_active  BIT          NOT NULL CONSTRAINT DF_acclass_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_acclass_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_acclass_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_account_classes      PRIMARY KEY (class_id),
  CONSTRAINT UQ_account_classes_code UNIQUE (code)
);
-- Seed: ASSETS, LIABILITY, INCOME, EXPENSES (§8). New classes are inserted here, not migrated.

CREATE TABLE dbo.group_accounts (
  group_id    INT IDENTITY(1,1) NOT NULL,
  code        VARCHAR(20)   NOT NULL,                         -- 4 digits, e.g. '1000' (§3.2)
  legacy_code VARCHAR(20)   NULL,                             -- old system's number; import only
  name        NVARCHAR(100) NOT NULL,
  class_id    INT           NOT NULL,                         -- was `class VARCHAR(10)` with a CHECK
  sorting     INT          NOT NULL CONSTRAINT DF_groups_sort    DEFAULT (0),
  is_active   BIT          NOT NULL CONSTRAINT DF_groups_active  DEFAULT (1),
  created_at  DATETIME2(0) NOT NULL CONSTRAINT DF_groups_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0) NOT NULL CONSTRAINT DF_groups_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_group_accounts       PRIMARY KEY (group_id),
  CONSTRAINT UQ_group_accounts_code  UNIQUE (code),
  CONSTRAINT UQ_group_accounts_name  UNIQUE (name),
  CONSTRAINT FK_group_accounts_class FOREIGN KEY (class_id) REFERENCES dbo.account_classes(class_id)
);

CREATE TABLE dbo.chart_of_accounts (
  ac_id         INT IDENTITY(1,1) NOT NULL,
  code          VARCHAR(20)   NOT NULL,                       -- 6 digits, e.g. '110001' (§3.2)
  legacy_code   VARCHAR(20)   NULL,                           -- old system's number; import only
  name          NVARCHAR(100) NOT NULL,
  group_id      INT           NOT NULL,                       -- was control_id (control accounts removed)
  link_code     VARCHAR(20)   NULL,
  is_restricted BIT           NOT NULL CONSTRAINT DF_chart_restricted DEFAULT (0),  -- §8 / TASK-14
  status        VARCHAR(10)   NOT NULL CONSTRAINT DF_chart_status     DEFAULT ('ACTIVE'),
  sorting       INT           NOT NULL CONSTRAINT DF_chart_sort       DEFAULT (0),
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_chart_created    DEFAULT (SYSUTCDATETIME()),
  updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_chart_updated    DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_chart_of_accounts        PRIMARY KEY (ac_id),
  CONSTRAINT UQ_chart_of_accounts_code   UNIQUE (code),
  CONSTRAINT UQ_chart_of_accounts_name   UNIQUE (group_id, name),
  CONSTRAINT FK_chart_of_accounts_group  FOREIGN KEY (group_id) REFERENCES dbo.group_accounts(group_id),
  CONSTRAINT CK_chart_of_accounts_status CHECK (status IN ('ACTIVE','CLOSED'))
);
CREATE INDEX IX_chart_of_accounts_group ON dbo.chart_of_accounts(group_id);

CREATE TABLE dbo.business_accounts (
  ba_id       INT IDENTITY(1,1) NOT NULL,
  code        VARCHAR(20)   NOT NULL,                         -- 10 digits, e.g. '1100010001' (§3.2)
  legacy_code VARCHAR(20)   NULL,                             -- old system's number; import only
  name        NVARCHAR(100) NOT NULL,
  ac_id       INT           NOT NULL,                         -- was control_id; parent chart account
  link_code   VARCHAR(20)   NULL,
  region_id   INT           NULL,
  -- UC-36's City column. Held here, not inherited from a customer: employee and
  -- director accounts are business accounts with no customer behind them.
  city_id     INT           NULL,
  status      VARCHAR(10)   NOT NULL CONSTRAINT DF_ba_status  DEFAULT ('ACTIVE'),
  created_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_ba_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_ba_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_business_accounts        PRIMARY KEY (ba_id),
  CONSTRAINT UQ_business_accounts_code   UNIQUE (code),
  CONSTRAINT FK_business_accounts_chart  FOREIGN KEY (ac_id)     REFERENCES dbo.chart_of_accounts(ac_id),
  CONSTRAINT FK_business_accounts_region FOREIGN KEY (region_id) REFERENCES dbo.regions(region_id),
  CONSTRAINT FK_business_accounts_city   FOREIGN KEY (city_id)   REFERENCES dbo.cities(city_id),
  CONSTRAINT CK_business_accounts_status CHECK (status IN ('ACTIVE','CLOSED'))
);
CREATE INDEX IX_business_accounts_chart  ON dbo.business_accounts(ac_id);
CREATE INDEX IX_business_accounts_region ON dbo.business_accounts(region_id);
CREATE INDEX IX_business_accounts_city   ON dbo.business_accounts(city_id);
```

### 5.4 Parties — vendors, customers, sub customers

```sql
CREATE TABLE dbo.vendors (
  vendor_id  INT IDENTITY(1,1) NOT NULL,
  name       NVARCHAR(100) NOT NULL,
  phone      VARCHAR(30)   NULL,
  address    NVARCHAR(200) NULL,
  region_id  INT           NULL,
  city_id    INT           NULL,
  ba_id      INT           NULL,   -- §10 gap 2: auto-created under VENDORS ACCOUNTS on vendor create
  is_active  BIT          NOT NULL CONSTRAINT DF_vendors_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_vendors_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_vendors_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_vendors        PRIMARY KEY (vendor_id),
  CONSTRAINT UQ_vendors_name   UNIQUE (name),
  CONSTRAINT FK_vendors_ba     FOREIGN KEY (ba_id)     REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_vendors_region FOREIGN KEY (region_id) REFERENCES dbo.regions(region_id),
  CONSTRAINT FK_vendors_city   FOREIGN KEY (city_id)   REFERENCES dbo.cities(city_id)
);
-- Filtered unique: one vendor per business account, but many vendors may await backfill (NULL).
CREATE UNIQUE INDEX UQ_vendors_ba ON dbo.vendors(ba_id) WHERE ba_id IS NOT NULL;

CREATE TABLE dbo.customers (
  customer_id INT IDENTITY(1,1) NOT NULL,
  name        NVARCHAR(150) NOT NULL,
  ba_id       INT           NULL,   -- NULL is exactly TASK-05's "Please add customer account first"
  region_id   INT           NOT NULL,                         -- §11: primary search key
  city_id     INT           NULL,                             -- §11: secondary search key
  phone       VARCHAR(30)   NULL,
  address     NVARCHAR(200) NULL,
  is_active   BIT          NOT NULL CONSTRAINT DF_customers_active  DEFAULT (1),
  created_at  DATETIME2(0) NOT NULL CONSTRAINT DF_customers_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0) NOT NULL CONSTRAINT DF_customers_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_customers        PRIMARY KEY (customer_id),
  CONSTRAINT FK_customers_ba     FOREIGN KEY (ba_id)     REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_customers_region FOREIGN KEY (region_id) REFERENCES dbo.regions(region_id),
  CONSTRAINT FK_customers_city   FOREIGN KEY (city_id)   REFERENCES dbo.cities(city_id)
);
CREATE UNIQUE INDEX UQ_customers_ba     ON dbo.customers(ba_id) WHERE ba_id IS NOT NULL;
CREATE INDEX        IX_customers_region ON dbo.customers(region_id, city_id);   -- Region first, City second
CREATE INDEX        IX_customers_name   ON dbo.customers(name);

CREATE TABLE dbo.sub_customers (                              -- TASK-06: NO parent customer FK
  sub_customer_id INT IDENTITY(1,1) NOT NULL,
  name            NVARCHAR(150) NOT NULL,
  phone           VARCHAR(30)   NULL,
  address         NVARCHAR(200) NULL,
  is_active       BIT          NOT NULL CONSTRAINT DF_subcust_active  DEFAULT (1),
  created_at      DATETIME2(0) NOT NULL CONSTRAINT DF_subcust_created DEFAULT (SYSUTCDATETIME()),
  updated_at      DATETIME2(0) NOT NULL CONSTRAINT DF_subcust_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_sub_customers      PRIMARY KEY (sub_customer_id),
  CONSTRAINT UQ_sub_customers_name UNIQUE (name)
);
CREATE INDEX IX_sub_customers_name ON dbo.sub_customers(name);   -- TASK-06 searchable dropdown
```

### 5.5 Products and colour variants

TASK-03's main rows are `products` (renamed from `articles`); its expandable sub-rows are
`article_colors`. Everything that moves stock or appears on a bill line points at a **variant**,
never at the product. This reuses the name `products` for a *different* table than the old flat one
described in §1 as "replaced by articles + article_colors" — that old one is gone.

```sql
CREATE TABLE dbo.products (
  product_id  INT IDENTITY(1,1) NOT NULL,
  code        VARCHAR(30)   NOT NULL,                         -- TASK-03 "article code (pcode)", e.g. 'P-101'
  name        NVARCHAR(150) NOT NULL,                         -- common name, colour excluded
  category_id INT           NOT NULL,
  vendor_id   INT           NULL,                             -- TASK-02 UPDATE: filter ledger by company/vendor
  batch_no    VARCHAR(50)   NULL,
  packing     INT           NOT NULL,                         -- default pairs per carton (usually 12)
  -- cost breakdown (names kept verbatim from the legacy system)
  cost_price    DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_cost   DEFAULT (0),
  labour        DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_lab    DEFAULT (0),
  proi_cost     DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_proi   DEFAULT (0),
  sole_stich    DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_solest DEFAULT (0),
  pasting       DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_past   DEFAULT (0),
  trim          DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_trim   DEFAULT (0),
  finishing     DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_fin    DEFAULT (0),
  socks_pasting DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_sockp  DEFAULT (0),
  dc            DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_dc     DEFAULT (0),
  sock_stich    DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_sockst DEFAULT (0),
  sheet         DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_sheet  DEFAULT (0),
  stubble       DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_stub   DEFAULT (0),
  bottom        DECIMAL(12,2) NOT NULL CONSTRAINT DF_products_bot    DEFAULT (0),
  p1            INT           NOT NULL CONSTRAINT DF_products_p1     DEFAULT (0),
  p2            INT           NOT NULL CONSTRAINT DF_products_p2     DEFAULT (0),
  na            INT           NOT NULL CONSTRAINT DF_products_na     DEFAULT (0),
  is_active   BIT          NOT NULL CONSTRAINT DF_products_active  DEFAULT (1),
  created_at  DATETIME2(0) NOT NULL CONSTRAINT DF_products_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0) NOT NULL CONSTRAINT DF_products_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_products          PRIMARY KEY (product_id),
  CONSTRAINT UQ_products_code     UNIQUE (code),
  CONSTRAINT FK_products_category FOREIGN KEY (category_id) REFERENCES dbo.product_categories(category_id),
  CONSTRAINT FK_products_vendor   FOREIGN KEY (vendor_id)   REFERENCES dbo.vendors(vendor_id),
  CONSTRAINT CK_products_packing  CHECK (packing > 0)
);
CREATE INDEX IX_products_category ON dbo.products(category_id);
CREATE INDEX IX_products_vendor   ON dbo.products(vendor_id);
CREATE INDEX IX_products_name     ON dbo.products(name);

CREATE TABLE dbo.article_colors (                             -- TASK-03 sub-rows
  variant_id INT IDENTITY(1,1) NOT NULL,
  product_id INT           NOT NULL,
  color      NVARCHAR(50)  NOT NULL,                          -- TASK-03 "content color"
  packing    INT           NULL,                              -- optional override of products.packing
  is_active  BIT          NOT NULL CONSTRAINT DF_variants_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_variants_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_variants_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_article_colors         PRIMARY KEY (variant_id),
  CONSTRAINT UQ_product_colors_acolor  UNIQUE (product_id, color),
  CONSTRAINT FK_product_colors_product FOREIGN KEY (product_id) REFERENCES dbo.products(product_id),
  CONSTRAINT CK_product_colors_packing CHECK (packing IS NULL OR packing > 0)
);
CREATE INDEX IX_product_colors_product ON dbo.article_colors(product_id);
```

> Effective packing for a variant is `COALESCE(article_colors.packing, products.packing)`.
> TASK-03's "Add" dialog creates a new `article_colors` row when an unseen colour is entered,
> then logs a `PRODUCTION` stock movement against it.

### 5.6 Sales

> **Actions applied:** `store_id` is nullable with `ON DELETE SET NULL` (store deletion no longer
> blocked). `bill_no`, `gp_no`, `bilty_no`, `adda_id` are `NOT NULL` — **this removes the "Without
> Bilty"/"Without Adda" filters and the dispatch-later workflow** those columns existed to support
> (§9 TASK-16, "NULL until dispatch assigns it"); their filtered indexes are dropped. `due_date` is
> removed along with its index — combined with the same removal on `purchases` (§5.7), §12's
> payment-overdue alert is gone entirely; only the cheque-due alert remains.

```sql
CREATE TABLE dbo.sale_bills (
  bill_id          INT IDENTITY(1,1) NOT NULL,                -- TASK-16 "Inv #" (system invoice)
  bill_date        DATE          NOT NULL,
  store_id         INT           NULL,                        -- source store (FROM); NULL if store deleted
  customer_id      INT           NOT NULL,
  sub_customer_id  INT           NULL,                        -- NULL when delivery_type = 'SAME'
  main_ac_id       INT           NULL,                        -- TASK-05 snapshot of customer's main A/C
  delivery_type    VARCHAR(10)   NOT NULL CONSTRAINT DF_sb_deliv    DEFAULT ('SAME'),
  delivery_address NVARCHAR(300) NULL,
  bill_no          VARCHAR(30)   NOT NULL,                    -- TASK-16 "Bill #" (manual)
  gp_no            VARCHAR(30)   NOT NULL,
  bilty_no         VARCHAR(30)   NOT NULL,
  adda_id          INT           NOT NULL,
  remarks          NVARCHAR(500) NULL,
  invoice_discount DECIMAL(12,2) NOT NULL CONSTRAINT DF_sb_invdisc  DEFAULT (0),
  total_cartons    INT           NOT NULL CONSTRAINT DF_sb_ctn      DEFAULT (0),
  total_pairs      INT           NOT NULL CONSTRAINT DF_sb_pairs    DEFAULT (0),
  gross_value      DECIMAL(14,2) NOT NULL CONSTRAINT DF_sb_gross    DEFAULT (0),
  net_value        DECIMAL(14,2) NOT NULL CONSTRAINT DF_sb_net      DEFAULT (0),
  status           VARCHAR(10)   NOT NULL CONSTRAINT DF_sb_status   DEFAULT ('DRAFT'),
  created_by       INT           NULL,
  updated_by              INT           NULL,
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sb_created  DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sb_updated  DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_sale_bills          PRIMARY KEY (bill_id),
  CONSTRAINT FK_sale_bills_store    FOREIGN KEY (store_id)        REFERENCES dbo.stores(store_id) ON DELETE SET NULL,
  CONSTRAINT FK_sale_bills_cust     FOREIGN KEY (customer_id)     REFERENCES dbo.customers(customer_id),
  CONSTRAINT FK_sale_bills_subcust  FOREIGN KEY (sub_customer_id) REFERENCES dbo.sub_customers(sub_customer_id),
  CONSTRAINT FK_sale_bills_mainac   FOREIGN KEY (main_ac_id)      REFERENCES dbo.chart_of_accounts(ac_id),
  CONSTRAINT FK_sale_bills_adda     FOREIGN KEY (adda_id)         REFERENCES dbo.addas(adda_id),
  CONSTRAINT FK_sale_bills_user     FOREIGN KEY (created_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT FK_sale_bills_upd     FOREIGN KEY (updated_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT CK_sale_bills_deliv    CHECK (delivery_type IN ('SAME','CUSTOM')),
  CONSTRAINT CK_sale_bills_status   CHECK (status IN ('CONFIRMED','DRAFT')),
  CONSTRAINT CK_sale_bills_custdlv  CHECK (delivery_type = 'SAME' OR sub_customer_id IS NOT NULL)
);
CREATE INDEX IX_sale_bills_date     ON dbo.sale_bills(bill_date);
CREATE INDEX IX_sale_bills_customer ON dbo.sale_bills(customer_id, bill_date);
CREATE INDEX IX_sale_bills_no       ON dbo.sale_bills(bill_no);   -- manual bill no lookup

CREATE TABLE dbo.sale_bill_items (
  item_id          INT IDENTITY(1,1) NOT NULL,
  bill_id          INT           NOT NULL,
  variant_id       INT           NOT NULL,                    -- article_colors, not article
  cartons          INT           NOT NULL,
  pairs            INT           NOT NULL,                    -- cartons x effective packing
  rate             DECIMAL(12,2) NOT NULL,
  discount_percent DECIMAL(5,2)  NOT NULL CONSTRAINT DF_sbi_dpct DEFAULT (0),   -- "D%" — sale-time discount
  discount_value   DECIMAL(12,2) NOT NULL CONSTRAINT DF_sbi_dval DEFAULT (0),
  value            DECIMAL(14,2) NOT NULL,                    -- net line value
  line_no          INT           NOT NULL CONSTRAINT DF_sbi_line DEFAULT (1),
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sbi_created DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sbi_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_sale_bill_items         PRIMARY KEY (item_id),
  CONSTRAINT FK_sale_bill_items_bill    FOREIGN KEY (bill_id)    REFERENCES dbo.sale_bills(bill_id) ON DELETE CASCADE,
  CONSTRAINT FK_sale_bill_items_variant FOREIGN KEY (variant_id) REFERENCES dbo.article_colors(variant_id),
  CONSTRAINT CK_sale_bill_items_ctn     CHECK (cartons >= 0),
  CONSTRAINT CK_sale_bill_items_pairs   CHECK (pairs > 0)
);
CREATE INDEX IX_sale_bill_items_bill    ON dbo.sale_bill_items(bill_id);
CREATE INDEX IX_sale_bill_items_variant ON dbo.sale_bill_items(variant_id);
```

### 5.6.1 Draft Sale Bills (TBD — new)

A **draft/dummy** bill: same fields as `sale_bills`, but stock is deducted on save and restored on
delete — no ledger entry, never appears in `sale_bills` until confirmed.

```sql
CREATE TABLE dbo.draft_sale_bills (
  draft_id         INT IDENTITY(1,1) NOT NULL,
  bill_date        DATE          NOT NULL,
  store_id         INT           NULL,
  customer_id      INT           NOT NULL,
  sub_customer_id  INT           NULL,
  main_ac_id       INT           NULL,
  delivery_type    VARCHAR(10)   NOT NULL CONSTRAINT DF_dsb_deliv    DEFAULT ('SAME'),
  delivery_address NVARCHAR(300) NULL,
  bill_no          VARCHAR(30)   NULL,
  gp_no            VARCHAR(30)   NULL,
  bilty_no         VARCHAR(30)   NULL,
  adda_id          INT           NULL,
  remarks          NVARCHAR(500) NULL,
  invoice_discount DECIMAL(12,2) NOT NULL CONSTRAINT DF_dsb_invdisc  DEFAULT (0),
  total_cartons    INT           NOT NULL CONSTRAINT DF_dsb_ctn      DEFAULT (0),
  total_pairs      INT           NOT NULL CONSTRAINT DF_dsb_pairs    DEFAULT (0),
  gross_value      DECIMAL(14,2) NOT NULL CONSTRAINT DF_dsb_gross    DEFAULT (0),
  net_value        DECIMAL(14,2) NOT NULL CONSTRAINT DF_dsb_net      DEFAULT (0),
  created_by       INT           NULL,
  updated_by              INT           NULL,
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_dsb_created  DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_dsb_updated  DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_sale_bills          PRIMARY KEY (draft_id),
  CONSTRAINT FK_draft_sale_bills_store    FOREIGN KEY (store_id)        REFERENCES dbo.stores(store_id) ON DELETE SET NULL,
  CONSTRAINT FK_draft_sale_bills_cust     FOREIGN KEY (customer_id)     REFERENCES dbo.customers(customer_id),
  CONSTRAINT FK_draft_sale_bills_subcust  FOREIGN KEY (sub_customer_id) REFERENCES dbo.sub_customers(sub_customer_id),
  CONSTRAINT FK_draft_sale_bills_mainac   FOREIGN KEY (main_ac_id)      REFERENCES dbo.chart_of_accounts(ac_id),
  CONSTRAINT FK_draft_sale_bills_adda     FOREIGN KEY (adda_id)         REFERENCES dbo.addas(adda_id),
  CONSTRAINT FK_draft_sale_bills_user     FOREIGN KEY (created_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT FK_draft_sale_bills_upd     FOREIGN KEY (updated_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT CK_draft_sale_bills_deliv    CHECK (delivery_type IN ('SAME','CUSTOM'))
);
CREATE INDEX IX_draft_sale_bills_date     ON dbo.draft_sale_bills(bill_date);
CREATE INDEX IX_draft_sale_bills_customer ON dbo.draft_sale_bills(customer_id, bill_date);
CREATE INDEX IX_draft_sale_bills_no       ON dbo.draft_sale_bills(bill_no);

CREATE TABLE dbo.draft_sale_bill_items (
  item_id          INT IDENTITY(1,1) NOT NULL,
  draft_id         INT           NOT NULL,
  variant_id       INT           NOT NULL,
  cartons          INT           NOT NULL,
  pairs            INT           NOT NULL,
  rate             DECIMAL(12,2) NOT NULL,
  discount_percent DECIMAL(5,2)  NOT NULL CONSTRAINT DF_dsbi_dpct DEFAULT (0),
  discount_value   DECIMAL(12,2) NOT NULL CONSTRAINT DF_dsbi_dval DEFAULT (0),
  value            DECIMAL(14,2) NOT NULL,
  line_no          INT           NOT NULL CONSTRAINT DF_dsbi_line DEFAULT (1),
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_dsbi_created DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_dsbi_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_sale_bill_items          PRIMARY KEY (item_id),
  CONSTRAINT FK_draft_sale_bill_items_draft    FOREIGN KEY (draft_id)   REFERENCES dbo.draft_sale_bills(draft_id) ON DELETE CASCADE,
  CONSTRAINT FK_draft_sale_bill_items_variant  FOREIGN KEY (variant_id) REFERENCES dbo.article_colors(variant_id),
  CONSTRAINT CK_draft_sale_bill_items_ctn      CHECK (cartons >= 0),
  CONSTRAINT CK_draft_sale_bill_items_pairs    CHECK (pairs > 0)
);
CREATE INDEX IX_draft_sale_bill_items_draft   ON dbo.draft_sale_bill_items(draft_id);
CREATE INDEX IX_draft_sale_bill_items_variant ON dbo.draft_sale_bill_items(variant_id);
```

Flow:

- **Save draft** → insert `draft_sale_bills` + `draft_sale_bill_items`, deduct stock (as a
  `stock_movements` row, e.g. type `ADJUSTMENT` or a new `DRAFT` type — no ledger entry).
- **Delete draft** → restore stock (reverse the same movement), delete the draft rows. No trace
  in `sale_bills` — equivalent to the bill never having been made.
- **Confirm** → insert into `sale_bills`/`sale_bill_items` from the draft, delete the draft rows;
  stock is not touched again (already deducted at draft-save time).

---

`sale_returns` and `sale_return_items` mirror the two tables above exactly, with these differences:

- `return_id` / `return_date`; `store_id` is the **destination** store (TO — where stock comes back).
- `remarks` holds the return reason.
- No `due_date` (a return is not a payable).
- `net_value` is the credit value.
- TASK-12's "products previously bought by this customer" dropdown is a **read** against
  `sale_bill_items` joined to `sale_bills` for that customer — it needs no column of its own.

```sql
CREATE TABLE dbo.sale_returns (
  return_id        INT IDENTITY(1,1) NOT NULL,
  return_date      DATE          NOT NULL,
  store_id         INT           NULL,
  customer_id      INT           NOT NULL,
  sub_customer_id  INT           NULL,
  bill_no          VARCHAR(30)   NOT NULL,
  gp_no            VARCHAR(30)   NOT NULL,
  bilty_no         VARCHAR(30)   NOT NULL,
  adda_id          INT           NOT NULL,
  remarks          NVARCHAR(500) NULL,                        -- return reason
  invoice_discount DECIMAL(12,2) NOT NULL CONSTRAINT DF_sr_invdisc DEFAULT (0),
  total_cartons    INT           NOT NULL CONSTRAINT DF_sr_ctn     DEFAULT (0),
  total_pairs      INT           NOT NULL CONSTRAINT DF_sr_pairs   DEFAULT (0),
  gross_value      DECIMAL(14,2) NOT NULL CONSTRAINT DF_sr_gross   DEFAULT (0),
  net_value        DECIMAL(14,2) NOT NULL CONSTRAINT DF_sr_net     DEFAULT (0),
  status           VARCHAR(10)   NOT NULL CONSTRAINT DF_sr_status  DEFAULT ('DRAFT'),
  created_by       INT           NULL,
  updated_by              INT           NULL,
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sr_created DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sr_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_sale_returns         PRIMARY KEY (return_id),
  CONSTRAINT FK_sale_returns_store   FOREIGN KEY (store_id)        REFERENCES dbo.stores(store_id) ON DELETE SET NULL,
  CONSTRAINT FK_sale_returns_cust    FOREIGN KEY (customer_id)     REFERENCES dbo.customers(customer_id),
  CONSTRAINT FK_sale_returns_subcust FOREIGN KEY (sub_customer_id) REFERENCES dbo.sub_customers(sub_customer_id),
  CONSTRAINT FK_sale_returns_adda    FOREIGN KEY (adda_id)         REFERENCES dbo.addas(adda_id),
  CONSTRAINT FK_sale_returns_user    FOREIGN KEY (created_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT FK_sale_returns_upd    FOREIGN KEY (updated_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT CK_sale_returns_status  CHECK (status IN ('CONFIRMED','DRAFT'))
);
CREATE INDEX IX_sale_returns_date     ON dbo.sale_returns(return_date);
CREATE INDEX IX_sale_returns_customer ON dbo.sale_returns(customer_id, return_date);
CREATE INDEX IX_sale_returns_no       ON dbo.sale_returns(bill_no);

CREATE TABLE dbo.sale_return_items (
  item_id          INT IDENTITY(1,1) NOT NULL,
  return_id        INT           NOT NULL,
  variant_id       INT           NOT NULL,
  cartons          INT           NOT NULL,
  pairs            INT           NOT NULL,
  rate             DECIMAL(12,2) NOT NULL,
  discount_percent DECIMAL(5,2)  NOT NULL CONSTRAINT DF_sri_dpct DEFAULT (0),
  discount_value   DECIMAL(12,2) NOT NULL CONSTRAINT DF_sri_dval DEFAULT (0),
  value            DECIMAL(14,2) NOT NULL,
  line_no          INT           NOT NULL CONSTRAINT DF_sri_line DEFAULT (1),
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sri_created DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sri_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_sale_return_items         PRIMARY KEY (item_id),
  CONSTRAINT FK_sale_return_items_return  FOREIGN KEY (return_id)  REFERENCES dbo.sale_returns(return_id) ON DELETE CASCADE,
  CONSTRAINT FK_sale_return_items_variant FOREIGN KEY (variant_id) REFERENCES dbo.article_colors(variant_id),
  CONSTRAINT CK_sale_return_items_pairs   CHECK (pairs > 0)
);
CREATE INDEX IX_sale_return_items_return  ON dbo.sale_return_items(return_id);
CREATE INDEX IX_sale_return_items_variant ON dbo.sale_return_items(variant_id);
```

### 5.6.2 Draft Sale Returns (TBD — new)

Mirrors `draft_sale_bills` (§5.6.1), but in reverse: saving a draft return **restores** stock
(anticipating the return), and deleting it **deducts stock back out** — as if the return never
happened. Confirming inserts into `sale_returns`/`sale_return_items` and deletes the draft rows.

```sql
CREATE TABLE dbo.draft_sale_returns (
  draft_id         INT IDENTITY(1,1) NOT NULL,
  return_date      DATE          NOT NULL,
  store_id         INT           NULL,
  customer_id      INT           NOT NULL,
  sub_customer_id  INT           NULL,
  bill_no          VARCHAR(30)   NULL,
  gp_no            VARCHAR(30)   NULL,
  bilty_no         VARCHAR(30)   NULL,
  adda_id          INT           NULL,
  remarks          NVARCHAR(500) NULL,
  invoice_discount DECIMAL(12,2) NOT NULL CONSTRAINT DF_dsr_invdisc DEFAULT (0),
  total_cartons    INT           NOT NULL CONSTRAINT DF_dsr_ctn     DEFAULT (0),
  total_pairs      INT           NOT NULL CONSTRAINT DF_dsr_pairs   DEFAULT (0),
  gross_value      DECIMAL(14,2) NOT NULL CONSTRAINT DF_dsr_gross   DEFAULT (0),
  net_value        DECIMAL(14,2) NOT NULL CONSTRAINT DF_dsr_net     DEFAULT (0),
  created_by       INT           NULL,
  updated_by              INT           NULL,
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_dsr_created DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_dsr_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_sale_returns          PRIMARY KEY (draft_id),
  CONSTRAINT FK_draft_sale_returns_store    FOREIGN KEY (store_id)        REFERENCES dbo.stores(store_id) ON DELETE SET NULL,
  CONSTRAINT FK_draft_sale_returns_cust     FOREIGN KEY (customer_id)     REFERENCES dbo.customers(customer_id),
  CONSTRAINT FK_draft_sale_returns_subcust  FOREIGN KEY (sub_customer_id) REFERENCES dbo.sub_customers(sub_customer_id),
  CONSTRAINT FK_draft_sale_returns_adda     FOREIGN KEY (adda_id)         REFERENCES dbo.addas(adda_id),
  CONSTRAINT FK_draft_sale_returns_user     FOREIGN KEY (created_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT FK_draft_sale_returns_upd     FOREIGN KEY (updated_by)      REFERENCES dbo.users(user_id)
);
CREATE INDEX IX_draft_sale_returns_date     ON dbo.draft_sale_returns(return_date);
CREATE INDEX IX_draft_sale_returns_customer ON dbo.draft_sale_returns(customer_id, return_date);
CREATE INDEX IX_draft_sale_returns_no       ON dbo.draft_sale_returns(bill_no);

CREATE TABLE dbo.draft_sale_return_items (
  item_id          INT IDENTITY(1,1) NOT NULL,
  draft_id         INT           NOT NULL,
  variant_id       INT           NOT NULL,
  cartons          INT           NOT NULL,
  pairs            INT           NOT NULL,
  rate             DECIMAL(12,2) NOT NULL,
  discount_percent DECIMAL(5,2)  NOT NULL CONSTRAINT DF_dsri_dpct DEFAULT (0),
  discount_value   DECIMAL(12,2) NOT NULL CONSTRAINT DF_dsri_dval DEFAULT (0),
  value            DECIMAL(14,2) NOT NULL,
  line_no          INT           NOT NULL CONSTRAINT DF_dsri_line DEFAULT (1),
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_dsri_created DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_dsri_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_sale_return_items          PRIMARY KEY (item_id),
  CONSTRAINT FK_draft_sale_return_items_draft    FOREIGN KEY (draft_id)   REFERENCES dbo.draft_sale_returns(draft_id) ON DELETE CASCADE,
  CONSTRAINT FK_draft_sale_return_items_variant  FOREIGN KEY (variant_id) REFERENCES dbo.article_colors(variant_id),
  CONSTRAINT CK_draft_sale_return_items_pairs    CHECK (pairs > 0)
);
CREATE INDEX IX_draft_sale_return_items_draft   ON dbo.draft_sale_return_items(draft_id);
CREATE INDEX IX_draft_sale_return_items_variant ON dbo.draft_sale_return_items(variant_id);
```

### 5.7 Purchases — raw materials from vendors

Per §2 decisions 1–4. Lines reference `materials` (§4.3) — the user still types any new name, and
the row is auto-created on save.

> **Action applied:** `due_date` removed (and its filtered index) — vendor-payable due-date alerts
> are dropped from §12's scope, same as `sale_bills` above.

```sql
CREATE TABLE dbo.purchases (                                  -- TASK-01
  purchase_id   INT IDENTITY(1,1) NOT NULL,
  purchase_date DATE          NOT NULL,
  vendor_id     INT           NOT NULL,
  bill_no       VARCHAR(30)   NULL,                           -- vendor's own invoice number
  remarks       NVARCHAR(500) NULL,
  total_value   DECIMAL(14,2) NOT NULL CONSTRAINT DF_pur_total  DEFAULT (0),
  status        VARCHAR(10)   NOT NULL CONSTRAINT DF_pur_status DEFAULT ('DRAFT'),
  created_by    INT           NULL,
  updated_by        INT           NULL,
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_pur_created DEFAULT (SYSUTCDATETIME()),
  updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_pur_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_purchases        PRIMARY KEY (purchase_id),
  CONSTRAINT FK_purchases_vendor FOREIGN KEY (vendor_id)  REFERENCES dbo.vendors(vendor_id),
  CONSTRAINT FK_purchases_user   FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_purchases_upd   FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_purchases_status CHECK (status IN ('CONFIRMED','DRAFT'))
);
CREATE INDEX IX_purchases_date   ON dbo.purchases(purchase_date);
CREATE INDEX IX_purchases_vendor ON dbo.purchases(vendor_id, purchase_date);

CREATE TABLE dbo.purchase_items (
  item_id        INT IDENTITY(1,1) NOT NULL,
  purchase_id    INT           NOT NULL,
  material_id    INT           NOT NULL,                      -- dropdown from dbo.materials; auto-created if new
  unit           NVARCHAR(30)  NOT NULL,                      -- self-assigned: Meters, Buckles, KG...
  quantity       DECIMAL(14,3) NOT NULL,
  weight         DECIMAL(14,3) NULL,                          -- §2 "weight" field; informational
  price_per_unit DECIMAL(12,2) NOT NULL,
  total_price    DECIMAL(14,2) NOT NULL,                      -- auto = quantity x price_per_unit
  line_no        INT           NOT NULL CONSTRAINT DF_pui_line DEFAULT (1),
  created_at     DATETIME2(0)  NOT NULL CONSTRAINT DF_pui_created DEFAULT (SYSUTCDATETIME()),
  updated_at     DATETIME2(0)  NOT NULL CONSTRAINT DF_pui_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_purchase_items          PRIMARY KEY (item_id),
  CONSTRAINT FK_purchase_items_purchase FOREIGN KEY (purchase_id) REFERENCES dbo.purchases(purchase_id) ON DELETE CASCADE,
  CONSTRAINT FK_purchase_items_material FOREIGN KEY (material_id) REFERENCES dbo.materials(material_id),
  CONSTRAINT CK_purchase_items_qty      CHECK (quantity > 0),
  CONSTRAINT CK_purchase_items_price    CHECK (price_per_unit >= 0)
);
CREATE INDEX IX_purchase_items_purchase ON dbo.purchase_items(purchase_id);
CREATE INDEX IX_purchase_items_material ON dbo.purchase_items(material_id);
```

`purchase_returns` / `purchase_return_items` mirror the two tables above (§10 gap 1: Purchase
Return gets its own dedicated page and tables, mirroring Sale Return exactly).

```sql
CREATE TABLE dbo.purchase_returns (
  return_id   INT IDENTITY(1,1) NOT NULL,
  return_date DATE          NOT NULL,
  vendor_id   INT           NOT NULL,
  bill_no     VARCHAR(30)   NULL,
  remarks     NVARCHAR(500) NULL,                             -- return reason
  total_value DECIMAL(14,2) NOT NULL CONSTRAINT DF_pret_total  DEFAULT (0),
  status      VARCHAR(10)   NOT NULL CONSTRAINT DF_pret_status DEFAULT ('DRAFT'),
  created_by  INT           NULL,
  updated_by    INT           NULL,
  created_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_pret_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_pret_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_purchase_returns        PRIMARY KEY (return_id),
  CONSTRAINT FK_purchase_returns_vendor FOREIGN KEY (vendor_id)  REFERENCES dbo.vendors(vendor_id),
  CONSTRAINT FK_purchase_returns_user   FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_purchase_returns_upd   FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_purchase_returns_status CHECK (status IN ('CONFIRMED','DRAFT'))
);
CREATE INDEX IX_purchase_returns_date   ON dbo.purchase_returns(return_date);
CREATE INDEX IX_purchase_returns_vendor ON dbo.purchase_returns(vendor_id, return_date);

CREATE TABLE dbo.purchase_return_items (
  item_id        INT IDENTITY(1,1) NOT NULL,
  return_id      INT           NOT NULL,
  material_id    INT           NOT NULL,
  unit           NVARCHAR(30)  NOT NULL,
  quantity       DECIMAL(14,3) NOT NULL,
  weight         DECIMAL(14,3) NULL,
  price_per_unit DECIMAL(12,2) NOT NULL,
  total_price    DECIMAL(14,2) NOT NULL,
  line_no        INT           NOT NULL CONSTRAINT DF_pri_line DEFAULT (1),
  created_at     DATETIME2(0)  NOT NULL CONSTRAINT DF_pri_created DEFAULT (SYSUTCDATETIME()),
  updated_at     DATETIME2(0)  NOT NULL CONSTRAINT DF_pri_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_purchase_return_items          PRIMARY KEY (item_id),
  CONSTRAINT FK_purchase_return_items_return   FOREIGN KEY (return_id)   REFERENCES dbo.purchase_returns(return_id) ON DELETE CASCADE,
  CONSTRAINT FK_purchase_return_items_material FOREIGN KEY (material_id) REFERENCES dbo.materials(material_id),
  CONSTRAINT CK_purchase_return_items_qty      CHECK (quantity > 0)
);
CREATE INDEX IX_purchase_return_items_return   ON dbo.purchase_return_items(return_id);
CREATE INDEX IX_purchase_return_items_material ON dbo.purchase_return_items(material_id);
```

### 5.8 Money — receipts, expenses, banks, cheques

> **Actions applied:** cheque data is pulled out of `receipts`/`expenses` into two new tables,
> `bank_accounts` and `cheques`, so a cheque is one row with one lifecycle shared by both sides instead of
> duplicated columns. `bounced_date` (added in v4.1) and its bounce `CHECK` move from `receipts` to
> `cheques` along with the rest of the cheque identity.
>
> - `bank_accounts` — a real party table, same pattern as `vendors`/`customers`: own PK
>   (`bank_id`) plus a unique `ba_id` into `business_accounts`, auto-created under the seeded
>   **Cash at Banks** chart account (§8) when a bank account is added. This is the §12 Q3/Q9
>   resolution — posting now has a real chart account to resolve to per bank, not one blended figure.
> - `cheques` — one row per physical cheque, `receipt_id` FK (the receipt that brought it in),
>   `cheque_status` defaults to `'PENDING'`. `receipts.cheque_id` and `expenses.cheque_id` both
>   point at the same `cheques` row. `cheques.bank_id` says which bank the cheque was deposited to.
> - **Which chart account a transaction posts to (§12 Q3, resolved):** `payment_mode = 'CASH'`
>   always posts to the single seeded `CASH IN HAND` chart account. `'ONLINE'` requires
>   `receipts.bank_id`/`expenses.bank_id` to be set, and posts to that bank's own chart account via
>   `bank_accounts.ba_id`. `'CHEQUE'` resolves the bank through the cheque instead
>   (`cheque_id → cheques.bank_id`), so `receipts.bank_id`/`expenses.bank_id` stay `NULL` for cheque
>   payments — the bank is on the cheque, not the receipt.
> - **Endorsement flow:** an expense that pays a vendor with a cheque already on hand sets
>   `expenses.cheque_id` to that cheque, and application logic flips `cheques.cheque_status` to
>   `'ENDORSED'` in the same transaction. Only cheques with `cheque_status IN ('PENDING','DEPOSITED')`
>   should populate the Expense screen's cheque picker — enforced by `IX_cheques_endorsable` below,
>   not by a CHECK (SQL Server can't conditionally restrict which rows a *different* table's FK may
>   point to).
> - **Draft:** `draft_receipts` and `draft_expenses` mirror `receipts`/`expenses` field-for-field,
>   same TBD pattern as `draft_sale_bills` (§5.6.1) — unconfirmed rows live only there. Unlike sale
>   bills, saving a draft receipt/expense has **no stock effect** to reverse; it is purely deferred
>   ledger posting.
> - **Indexes:** `IX_cheques_no` (lookup by cheque number) and `IX_cheques_endorsable` (filtered on
>   the two endorsable statuses).
> - **Insert order:** `cheques.receipt_id` and `receipts.cheque_id` reference each other, so a
>   cheque receipt is written in two steps — insert the `receipts` row with `cheque_id NULL`, insert
>   the `cheques` row pointing back at it, then `UPDATE receipts SET cheque_id = ...`. Both in one
>   transaction.
> - **§12 impact:** the payment-overdue alert (driven by `sale_bills.due_date`/`purchases.due_date`)
>   is gone — both columns were removed (§5.6/§5.7). Only the cheque-due alert survives, now sourced
>   from `cheques.cheque_date`/`cheque_status` instead of `receipts`.

```sql
CREATE TABLE dbo.bank_accounts (                              -- §12 Q3/Q9: real party, mirrors vendors/customers
  bank_id    INT IDENTITY(1,1) NOT NULL,
  name       NVARCHAR(100) NOT NULL,                          -- e.g. 'Bank Alfalah A/C - 0124'
  ba_id      INT           NULL,   -- auto-created under CASH AT BANKS chart account on bank create
  is_active  BIT          NOT NULL CONSTRAINT DF_bankacc_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_bankacc_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_bankacc_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_bank_accounts PRIMARY KEY (bank_id),
  CONSTRAINT UQ_bank_accounts_name UNIQUE (name),
  CONSTRAINT FK_bank_accounts_ba   FOREIGN KEY (ba_id) REFERENCES dbo.business_accounts(ba_id)
);
-- Filtered unique: one bank account per business account, but many may await backfill (NULL).
CREATE UNIQUE INDEX UQ_bank_accounts_ba ON dbo.bank_accounts(ba_id) WHERE ba_id IS NOT NULL;

CREATE TABLE dbo.cheques (
  cheque_id            INT IDENTITY(1,1) NOT NULL,
  bank_id              INT           NULL,                     -- which bank_accounts row the cheque deposits to
  receipt_id           INT           NOT NULL,                 -- the receipt that brought this cheque in
  cheque_no            VARCHAR(50)   NOT NULL,
  cheque_date          DATE          NOT NULL,                  -- date written on the cheque
  cheque_received_date DATE          NULL,                      -- date WentoX physically received it
  cheque_status        VARCHAR(20)   NOT NULL CONSTRAINT DF_cheques_status DEFAULT ('PENDING'),
  bounced_date         DATE          NULL,                      -- §13/§6.1: the date every reversal is posted on
  created_at           DATETIME2(0)  NOT NULL CONSTRAINT DF_cheques_created DEFAULT (SYSUTCDATETIME()),
  updated_at           DATETIME2(0)  NOT NULL CONSTRAINT DF_cheques_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_cheques         PRIMARY KEY (cheque_id),
  CONSTRAINT FK_cheques_bank    FOREIGN KEY (bank_id)    REFERENCES dbo.bank_accounts(bank_id),
  CONSTRAINT FK_cheques_receipt FOREIGN KEY (receipt_id) REFERENCES dbo.receipts(receipt_id),
  CONSTRAINT CK_cheques_status  CHECK (cheque_status IN
        ('PENDING','DEPOSITED','ENDORSED','PARTIALLY_ENDORSED','CLEARED','BOUNCED')),
  -- bounced_date exists if and only if the cheque actually bounced (moved here from `receipts`, v4.1)
  CONSTRAINT CK_cheques_bounced CHECK (
        (bounced_date IS NULL     AND cheque_status <> 'BOUNCED')
     OR (bounced_date IS NOT NULL AND cheque_status =  'BOUNCED'))
);
CREATE INDEX IX_cheques_no          ON dbo.cheques(cheque_no);              -- join key from receipts/expenses
CREATE INDEX IX_cheques_endorsable  ON dbo.cheques(cheque_status)           -- Expense screen's cheque picker
       WHERE cheque_status IN ('PENDING','DEPOSITED');
CREATE INDEX IX_cheques_due         ON dbo.cheques(cheque_date)             -- §12 cheque-due alerts
       WHERE cheque_status IN ('PENDING','PARTIALLY_ENDORSED');

CREATE TABLE dbo.receipts (                                   -- Jamma
  receipt_id   INT IDENTITY(1,1) NOT NULL,
  receipt_date DATE          NOT NULL,
  customer_id  INT           NOT NULL,
  amount       DECIMAL(14,2) NOT NULL,
  commission   DECIMAL(14,2) NOT NULL CONSTRAINT DF_rec_comm DEFAULT (0),  -- §7: payment-time only
  payment_mode VARCHAR(10)   NOT NULL,
  details      NVARCHAR(200) NULL,                            -- online reference etc.
  cheque_id    INT           NULL,                             -- FK to dbo.cheques; set once the cheque row exists
  bank_id      INT           NULL,                             -- ONLINE only; CHEQUE's bank lives on cheques.bank_id
  remarks      NVARCHAR(500) NULL,                             -- narration source for Account Ledger (§5)
  status       VARCHAR(10)   NOT NULL CONSTRAINT DF_rec_status  DEFAULT ('CONFIRMED'),
  created_by   INT           NULL,
  updated_by      INT           NULL,
  created_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_rec_created DEFAULT (SYSUTCDATETIME()),
  updated_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_rec_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_receipts        PRIMARY KEY (receipt_id),
  CONSTRAINT FK_receipts_cust   FOREIGN KEY (customer_id) REFERENCES dbo.customers(customer_id),
  CONSTRAINT FK_receipts_cheque FOREIGN KEY (cheque_id)   REFERENCES dbo.cheques(cheque_id),
  CONSTRAINT FK_receipts_bank   FOREIGN KEY (bank_id)     REFERENCES dbo.bank_accounts(bank_id),
  CONSTRAINT FK_receipts_user   FOREIGN KEY (created_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT FK_receipts_upd   FOREIGN KEY (updated_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT CK_receipts_amount CHECK (amount > 0),
  CONSTRAINT CK_receipts_comm   CHECK (commission >= 0),
  CONSTRAINT CK_receipts_mode   CHECK (payment_mode IN ('CASH','CHEQUE','ONLINE')),
  CONSTRAINT CK_receipts_status CHECK (status IN ('CONFIRMED','DRAFT')),
  -- a cheque receipt must carry its cheque identity; a non-cheque receipt must not
  CONSTRAINT CK_receipts_cheque CHECK (
        (payment_mode =  'CHEQUE' AND cheque_id IS NOT NULL)
     OR (payment_mode <> 'CHEQUE' AND cheque_id IS NULL)),
  -- §12 Q3: which chart account a receipt posts to. CASH never carries a bank; ONLINE always
  -- must; CHEQUE resolves its bank through cheques.bank_id instead, so stays NULL here.
  CONSTRAINT CK_receipts_bank   CHECK (
        (payment_mode = 'ONLINE' AND bank_id IS NOT NULL)
     OR (payment_mode <> 'ONLINE' AND bank_id IS NULL))
);
CREATE INDEX IX_receipts_date     ON dbo.receipts(receipt_date);
CREATE INDEX IX_receipts_customer ON dbo.receipts(customer_id, receipt_date);

CREATE TABLE dbo.draft_receipts (
  draft_id     INT IDENTITY(1,1) NOT NULL,
  receipt_date DATE          NOT NULL,
  customer_id  INT           NOT NULL,
  amount       DECIMAL(14,2) NOT NULL,
  commission   DECIMAL(14,2) NOT NULL CONSTRAINT DF_drec_comm DEFAULT (0),
  payment_mode VARCHAR(10)   NOT NULL,
  details      NVARCHAR(200) NULL,
  cheque_id    INT           NULL,
  bank_id      INT           NULL,
  remarks      NVARCHAR(500) NULL,
  created_by   INT           NULL,
  updated_by      INT           NULL,
  created_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_drec_created DEFAULT (SYSUTCDATETIME()),
  updated_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_drec_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_receipts        PRIMARY KEY (draft_id),
  CONSTRAINT FK_draft_receipts_cust   FOREIGN KEY (customer_id) REFERENCES dbo.customers(customer_id),
  CONSTRAINT FK_draft_receipts_cheque FOREIGN KEY (cheque_id)   REFERENCES dbo.cheques(cheque_id),
  CONSTRAINT FK_draft_receipts_bank   FOREIGN KEY (bank_id)     REFERENCES dbo.bank_accounts(bank_id),
  CONSTRAINT FK_draft_receipts_user   FOREIGN KEY (created_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT FK_draft_receipts_upd   FOREIGN KEY (updated_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT CK_draft_receipts_amount CHECK (amount > 0),
  CONSTRAINT CK_draft_receipts_mode   CHECK (payment_mode IN ('CASH','CHEQUE','ONLINE'))
);
CREATE INDEX IX_draft_receipts_date     ON dbo.draft_receipts(receipt_date);
CREATE INDEX IX_draft_receipts_customer ON dbo.draft_receipts(customer_id, receipt_date);

CREATE TABLE dbo.expenses (                                   -- Kharch; also the vendor-payment path (§10 gap 2)
  expense_id   INT IDENTITY(1,1) NOT NULL,
  expense_date DATE          NOT NULL,
  ba_id        INT           NOT NULL,                        -- expense head / vendor account
  amount       DECIMAL(14,2) NOT NULL,
  payment_mode VARCHAR(10)   NOT NULL,
  details      NVARCHAR(200) NULL,
  cheque_id    INT           NULL,                             -- endorsed cheque, from dbo.cheques
  bank_id      INT           NULL,                             -- ONLINE only; CHEQUE's bank lives on cheques.bank_id
  remarks      NVARCHAR(500) NULL,
  status       VARCHAR(10)   NOT NULL CONSTRAINT DF_exp_status  DEFAULT ('CONFIRMED'),
  created_by   INT           NULL,
  updated_by      INT           NULL,
  created_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_exp_created DEFAULT (SYSUTCDATETIME()),
  updated_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_exp_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_expenses        PRIMARY KEY (expense_id),
  CONSTRAINT FK_expenses_ba     FOREIGN KEY (ba_id)      REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_expenses_cheque FOREIGN KEY (cheque_id)  REFERENCES dbo.cheques(cheque_id),
  CONSTRAINT FK_expenses_bank   FOREIGN KEY (bank_id)    REFERENCES dbo.bank_accounts(bank_id),
  CONSTRAINT FK_expenses_user   FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_expenses_upd   FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_expenses_amount CHECK (amount > 0),
  CONSTRAINT CK_expenses_mode   CHECK (payment_mode IN ('CASH','CHEQUE','ONLINE')),
  CONSTRAINT CK_expenses_status CHECK (status IN ('CONFIRMED','DRAFT')),
  CONSTRAINT CK_expenses_bank   CHECK (
        (payment_mode = 'ONLINE' AND bank_id IS NOT NULL)
     OR (payment_mode <> 'ONLINE' AND bank_id IS NULL))
);
CREATE INDEX IX_expenses_date ON dbo.expenses(expense_date);
CREATE INDEX IX_expenses_ba   ON dbo.expenses(ba_id, expense_date);

CREATE TABLE dbo.draft_expenses (
  draft_id     INT IDENTITY(1,1) NOT NULL,
  expense_date DATE          NOT NULL,
  ba_id        INT           NOT NULL,
  amount       DECIMAL(14,2) NOT NULL,
  payment_mode VARCHAR(10)   NOT NULL,
  details      NVARCHAR(200) NULL,
  cheque_id    INT           NULL,
  bank_id      INT           NULL,
  remarks      NVARCHAR(500) NULL,
  created_by   INT           NULL,
  updated_by      INT           NULL,
  created_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_dexp_created DEFAULT (SYSUTCDATETIME()),
  updated_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_dexp_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_expenses        PRIMARY KEY (draft_id),
  CONSTRAINT FK_draft_expenses_ba     FOREIGN KEY (ba_id)      REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_draft_expenses_cheque FOREIGN KEY (cheque_id)  REFERENCES dbo.cheques(cheque_id),
  CONSTRAINT FK_draft_expenses_bank   FOREIGN KEY (bank_id)    REFERENCES dbo.bank_accounts(bank_id),
  CONSTRAINT FK_draft_expenses_user   FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_draft_expenses_upd   FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_draft_expenses_amount CHECK (amount > 0),
  CONSTRAINT CK_draft_expenses_mode   CHECK (payment_mode IN ('CASH','CHEQUE','ONLINE'))
);
CREATE INDEX IX_draft_expenses_date ON dbo.draft_expenses(expense_date);
CREATE INDEX IX_draft_expenses_ba   ON dbo.draft_expenses(ba_id, expense_date);
```

### 5.9 Derived-state ledgers

```sql
CREATE TABLE dbo.stock_movements (                            -- finished goods, in PAIRS
  movement_id   INT IDENTITY(1,1) NOT NULL,
  variant_id    INT           NOT NULL,
  movement_type VARCHAR(15)   NOT NULL,
  qty_pairs     INT           NOT NULL,                       -- signed: SALE negative, PRODUCTION/SALE_RETURN positive
  movement_date DATE          NOT NULL,
  input_qty     INT           NULL,                           -- PRODUCTION only: qty as the user typed it
  input_unit    VARCHAR(10)   NULL,                           -- PRODUCTION only: CARTONS | PAIRS
  packing       INT           NULL,                           -- PRODUCTION only: packing snapshot
  source_type   VARCHAR(20)   NULL,                           -- SALE_BILL | SALE_RETURN | NULL (manual/production)
  source_id     INT           NULL,
  created_by    INT           NULL,
  updated_by        INT           NULL,
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_sm_created DEFAULT (SYSUTCDATETIME()),
  updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_sm_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_stock_movements         PRIMARY KEY (movement_id),
  CONSTRAINT FK_stock_movements_variant FOREIGN KEY (variant_id) REFERENCES dbo.article_colors(variant_id),
  CONSTRAINT FK_stock_movements_user    FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_stock_movements_upd    FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_stock_movements_type    CHECK (movement_type IN
        ('OPENING','ADJUSTMENT','PRODUCTION','SALE','SALE_RETURN')),   -- deliberately no PURCHASE, see §2.2
  CONSTRAINT CK_stock_movements_unit    CHECK (input_unit IS NULL OR input_unit IN ('CARTONS','PAIRS')),
  CONSTRAINT CK_stock_movements_sign    CHECK (
        (movement_type = 'SALE'                              AND qty_pairs < 0)
     OR (movement_type IN ('PRODUCTION','SALE_RETURN')       AND qty_pairs > 0)
     OR (movement_type IN ('OPENING','ADJUSTMENT')))
);
CREATE INDEX IX_stock_movements_variant ON dbo.stock_movements(variant_id, movement_date);
CREATE INDEX IX_stock_movements_date    ON dbo.stock_movements(movement_date);
CREATE INDEX IX_stock_movements_source  ON dbo.stock_movements(source_type, source_id);

CREATE TABLE dbo.vendor_stock_movements (                     -- raw materials, in MATERIAL UNITS
  movement_id   INT IDENTITY(1,1) NOT NULL,
  vendor_id     INT           NOT NULL,
  material_id   INT           NOT NULL,
  unit          NVARCHAR(30)  NOT NULL,
  qty           DECIMAL(14,3) NOT NULL,                       -- signed: PURCHASE +, RETURN/CONSUMPTION -
  movement_date DATE          NOT NULL,
  movement_type VARCHAR(20)   NOT NULL,
  source_type   VARCHAR(20)   NULL,                           -- PURCHASE | PURCHASE_RETURN | NULL (manual)
  source_id     INT           NULL,
  created_by    INT           NULL,
  updated_by        INT           NULL,
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_vsm_created DEFAULT (SYSUTCDATETIME()),
  updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_vsm_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_vendor_stock_movements          PRIMARY KEY (movement_id),
  CONSTRAINT FK_vendor_stock_movements_vendor   FOREIGN KEY (vendor_id)   REFERENCES dbo.vendors(vendor_id),
  CONSTRAINT FK_vendor_stock_movements_material FOREIGN KEY (material_id) REFERENCES dbo.materials(material_id),
  CONSTRAINT FK_vendor_stock_movements_user     FOREIGN KEY (created_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT FK_vendor_stock_movements_upd     FOREIGN KEY (updated_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT CK_vendor_stock_movements_type   CHECK (movement_type IN
        ('PURCHASE','PURCHASE_RETURN','CONSUMPTION','ADJUSTMENT')),
  CONSTRAINT CK_vendor_stock_movements_sign   CHECK (
        (movement_type = 'PURCHASE'                            AND qty > 0)
     OR (movement_type IN ('PURCHASE_RETURN','CONSUMPTION')    AND qty < 0)
     OR (movement_type = 'ADJUSTMENT'))
);
CREATE INDEX IX_vendor_stock_vendor   ON dbo.vendor_stock_movements(vendor_id, material_id);
CREATE INDEX IX_vendor_stock_material ON dbo.vendor_stock_movements(material_id);
CREATE INDEX IX_vendor_stock_date     ON dbo.vendor_stock_movements(movement_date);
CREATE INDEX IX_vendor_stock_source   ON dbo.vendor_stock_movements(source_type, source_id);
```

> **Vendor Stock page (§14)** is exactly:
>
> ```sql
> SELECT v.name AS vendor, m.name AS material, vsm.unit, SUM(vsm.qty) AS on_hand
> FROM dbo.vendor_stock_movements AS vsm
> JOIN dbo.vendors   AS v ON v.vendor_id   = vsm.vendor_id
> JOIN dbo.materials AS m ON m.material_id = vsm.material_id
> GROUP BY v.name, m.name, vsm.unit
> HAVING SUM(vsm.qty) <> 0;
> ```
>
> The manual "this much has been used" reduction (§2 decision 5) inserts a single `CONSUMPTION`
> row with a negative `qty` and `source_type = NULL`.

```sql
CREATE TABLE dbo.ledger_entries (                             -- double-entry journal
  entry_id    INT IDENTITY(1,1) NOT NULL,
  entry_date  DATE          NOT NULL,
  ac_id       INT           NULL,                             -- exactly one of ac_id / ba_id is set
  ba_id       INT           NULL,
  debit       DECIMAL(14,2) NOT NULL CONSTRAINT DF_le_debit  DEFAULT (0),
  credit      DECIMAL(14,2) NOT NULL CONSTRAINT DF_le_credit DEFAULT (0),
  source_type VARCHAR(20)   NOT NULL,
  source_id   INT           NOT NULL,
  narration   NVARCHAR(500) NULL,
  pairs       INT           NULL,                             -- TASK-16 Pairs column; NULL on payment rows
  created_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_le_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_le_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_ledger_entries       PRIMARY KEY (entry_id),
  CONSTRAINT FK_ledger_entries_chart FOREIGN KEY (ac_id) REFERENCES dbo.chart_of_accounts(ac_id),
  CONSTRAINT FK_ledger_entries_ba    FOREIGN KEY (ba_id) REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT CK_ledger_entries_one   CHECK ((CASE WHEN ac_id IS NULL THEN 0 ELSE 1 END)
                                          + (CASE WHEN ba_id IS NULL THEN 0 ELSE 1 END) = 1),
  CONSTRAINT CK_ledger_entries_side  CHECK (debit = 0 OR credit = 0),
  CONSTRAINT CK_ledger_entries_sign  CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT CK_ledger_entries_src   CHECK (source_type IN
        ('SALE_BILL','SALE_RETURN','RECEIPT','COMMISSION','EXPENSE',
         'PURCHASE','PURCHASE_RETURN','CHEQUE_ALLOCATION','OPENING'))
);
CREATE INDEX IX_ledger_entries_ba     ON dbo.ledger_entries(ba_id, entry_date) WHERE ba_id IS NOT NULL;
CREATE INDEX IX_ledger_entries_ac     ON dbo.ledger_entries(ac_id, entry_date) WHERE ac_id IS NOT NULL;
CREATE INDEX IX_ledger_entries_source ON dbo.ledger_entries(source_type, source_id);
CREATE INDEX IX_ledger_entries_date   ON dbo.ledger_entries(entry_date);
```

> Opening balances are `source_type = 'OPENING'` rows dated before the first transaction — that is
> what TASK-16's "Opening Balance" and TASK-15's "Opening Cash" read.

### 5.10 Cheque alerts and endorsement (§12, §13)

**These are no longer speculative.** `architecture-v2.md` still marks §12/§13 "planning only", but
both are now **built in the frontend** (Milestone 6) against `AppContext`, so these two tables have
a working implementation to match rather than a guess — the column shapes below were reconciled
against `frontend/src/types/index.ts` (`ChequeAllocation`, `AlertDismissal`). They are required,
not optional.

Two notes where the frontend is currently narrower than the schema:

- `alert_dismissals.dismissed_until` — the UI dismisses permanently and offers a "Restore" action
  instead of a snooze. The column is kept for the eventual snooze, and simply stays `NULL`.
- `alert_dismissals.user_id` — dismissals are global in the demo build. The FK is kept so
  dismissals can become per-user once real auth lands, without a migration.
- `cheque_allocations.receipt_id` still points at `receipts`, not `cheques` (§5.8) — left as-is
  since a receipt has at most one cheque, so the two are equivalent; app code can join through
  either.

```sql
CREATE TABLE dbo.cheque_allocations (                         -- §13 endorsement / pass-through
  allocation_id      INT IDENTITY(1,1) NOT NULL,
  receipt_id         INT           NOT NULL,
  disposition_type   VARCHAR(20)   NOT NULL,                  -- DEPOSIT | VENDOR_PAYMENT | EXPENSE_PAYMENT
  target_vendor_id   INT           NULL,                      -- set only for VENDOR_PAYMENT
  target_ba_id       INT           NULL,                      -- set only for EXPENSE_PAYMENT
  amount             DECIMAL(14,2) NOT NULL,
  allocation_date    DATE          NOT NULL,                  -- Cash Book dates the outflow by THIS date
  remarks            NVARCHAR(500) NULL,
  status             VARCHAR(10)   NOT NULL CONSTRAINT DF_ca_status  DEFAULT ('ACTIVE'),
  created_by         INT           NULL,
  updated_by         INT           NULL,
  created_at         DATETIME2(0)  NOT NULL CONSTRAINT DF_ca_created DEFAULT (SYSUTCDATETIME()),
  updated_at         DATETIME2(0)  NOT NULL CONSTRAINT DF_ca_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_cheque_allocations         PRIMARY KEY (allocation_id),
  CONSTRAINT FK_cheque_allocations_receipt FOREIGN KEY (receipt_id)       REFERENCES dbo.receipts(receipt_id),
  CONSTRAINT FK_cheque_allocations_vendor  FOREIGN KEY (target_vendor_id) REFERENCES dbo.vendors(vendor_id),
  CONSTRAINT FK_cheque_allocations_ba      FOREIGN KEY (target_ba_id)     REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_cheque_allocations_user    FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_cheque_allocations_upd     FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_cheque_allocations_amount  CHECK (amount > 0),
  CONSTRAINT CK_cheque_allocations_disp    CHECK (disposition_type IN
        ('DEPOSIT','VENDOR_PAYMENT','EXPENSE_PAYMENT')),
  -- exactly one target column set, and only the one matching the disposition
  CONSTRAINT CK_cheque_allocations_target  CHECK (
        (disposition_type =  'DEPOSIT'         AND target_vendor_id IS NULL     AND target_ba_id IS NULL)
     OR (disposition_type =  'VENDOR_PAYMENT'  AND target_vendor_id IS NOT NULL AND target_ba_id IS NULL)
     OR (disposition_type =  'EXPENSE_PAYMENT' AND target_vendor_id IS NULL     AND target_ba_id IS NOT NULL)),
  CONSTRAINT CK_cheque_allocations_status  CHECK (status IN ('ACTIVE','REVERSED'))
);
CREATE INDEX IX_cheque_allocations_receipt ON dbo.cheque_allocations(receipt_id);
CREATE INDEX IX_cheque_allocations_date    ON dbo.cheque_allocations(allocation_date);
CREATE INDEX IX_cheque_allocations_vendor  ON dbo.cheque_allocations(target_vendor_id) WHERE target_vendor_id IS NOT NULL;
CREATE INDEX IX_cheque_allocations_ba      ON dbo.cheque_allocations(target_ba_id)     WHERE target_ba_id     IS NOT NULL;

CREATE TABLE dbo.alert_dismissals (                           -- §12 snooze/dismiss derived alerts
  dismissal_id    INT IDENTITY(1,1) NOT NULL,
  alert_key       VARCHAR(100)  NOT NULL,                     -- 'CHEQUE_DUE:<receipt_id>' | 'PAYMENT_OVERDUE:<bill_id>'
  user_id         INT           NULL,
  dismissed_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_ad_at    DEFAULT (SYSUTCDATETIME()),
  dismissed_until DATETIME2(0)  NULL,                          -- NULL = dismissed permanently
  created_at      DATETIME2(0)  NOT NULL CONSTRAINT DF_ad_created DEFAULT (SYSUTCDATETIME()),
  updated_at      DATETIME2(0)  NOT NULL CONSTRAINT DF_ad_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_alert_dismissals      PRIMARY KEY (dismissal_id),
  CONSTRAINT FK_alert_dismissals_user FOREIGN KEY (user_id) REFERENCES dbo.users(user_id)
);
CREATE INDEX IX_alert_dismissals_key ON dbo.alert_dismissals(alert_key);
```

**Bounced-cheque cascade (§13):** setting `cheques.cheque_status = 'BOUNCED'` must, in the same
transaction, also set `cheques.bounced_date`, flip every `cheque_allocations` row for that cheque's
receipt to `REVERSED`, and write the counter-entries on **both** sides per §6.1. Nothing is deleted — the
reversal is posted as opposite ledger rows dated `bounced_date`, so historic reports stay intact.
This is application logic; no constraint can express it, and it is the single most important rule
attached to these two tables.

---

## 6. Posting matrix

Posting a document writes these rows in **one transaction**; unposting deletes them in one
transaction. `CUSTOMER BA` / `VENDOR BA` mean the party's `business_accounts` row.


| Document                                            | Debit                            | Credit                                                    | Also writes                                                  |
| --------------------------------------------------- | -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| Sale Bill (`net_value`)                             | CUSTOMER BA                      | SALES chart account                                       | negative`SALE` stock movements per line                      |
| Sale Return (`net_value`)                           | SALES chart account              | CUSTOMER BA                                               | positive`SALE_RETURN` stock movements                        |
| Purchase (`total_value`)                            | PURCHASES chart account          | VENDOR BA                                                 | positive`PURCHASE` vendor-stock movements                    |
| Purchase Return (`total_value`)                     | VENDOR BA                        | PURCHASES chart account                                   | negative`PURCHASE_RETURN` vendor-stock movements             |
| Receipt — amount                                   | CASH or BANK chart account       | CUSTOMER BA                                               | —                                                           |
| Receipt — commission (§7)                         | COMMISSION ALLOWED chart account | CUSTOMER BA                                               | separate ledger row,`source_type='COMMISSION'`               |
| Expense                                             | Expense head BA                  | CASH or BANK chart account                                | —                                                           |
| Cheque allocation — VENDOR_PAYMENT                 | VENDOR BA                        | CHEQUES IN HAND                                           | `source_type='CHEQUE_ALLOCATION'`                            |
| Cheque allocation — EXPENSE_PAYMENT                | Target BA                        | CHEQUES IN HAND                                           | `source_type='CHEQUE_ALLOCATION'`                            |
| **Bounce — receipt leg** (`amount` + `commission`) | CUSTOMER BA                      | CASH/BANK, and COMMISSION ALLOWED for the commission part | dated`cheques.bounced_date`                                  |
| **Bounce — each allocation leg**                   | CHEQUES IN HAND                  | VENDOR BA / Target BA                                     | one per reversed allocation, dated`cheques.bounced_date`     |
| Production                                          | —                               | —                                                        | positive`PRODUCTION` stock movements only (no ledger effect) |

**Commission worked example (§7)** — the sale bill is never altered:

```
Sale Bill   Debit  1,020,000     (confirmed, unchanged)
Commission  Credit    20,000     (recorded at payment time)
Payment     Credit 1,000,000
Balance   = 1,020,000 - (20,000 + 1,000,000) = 0   ✓
```

Per §10 gap 4, the Receipts screen and the ledger must show **both** figures explicitly — amount
owed before commission and after — not only the net balance. Both are derivable: the "before"
figure is the running balance excluding `source_type='COMMISSION'` rows.

### 6.1 A bounce reverses; it never erases

**Client-confirmed.** When a cheque bounces, the original ledger rows are **left exactly where they
are** and the correction is posted as opposite entries dated `cheques.bounced_date`. Rows are never
deleted and `allocation_date` is never rewritten.

```
10 Oct   Jamma  +1,000,000    cheque received from customer
15 Oct   Naam   -1,000,000    endorsed to vendor
22 Oct   Naam   -1,000,000    BOUNCE: reverses the 10 Oct receipt
22 Oct   Jamma  +1,000,000    BOUNCE: reverses the 15 Oct endorsement

10 Oct and 15 Oct totals: unchanged forever
22 Oct: absorbs the whole correction
```

This is what makes a Cash Book printed before the bounce still reconcile with the same report
printed after it. Deleting the rows instead would silently change historic days.

Two consequences the backend must honour:

- `cheque_allocations` rows flip to `status='REVERSED'` but **stay in the table**, and still count
  as an outflow on their own `allocation_date`. `REVERSED` excludes them from *current* balances
  (Vendor Report's Payment Paid), not from history.
- The receipt's **commission reverses with it** — a bounce cancels the whole receipt, so both
  `amount` and `commission` legs are undone.

A bounced receipt must also be excluded from every "payment received" total (Account Ledger,
Sale Analysis, Sale Report, customer balance) — the money never arrived.

---

## 7. Report → source map

Every report in §9 answered from the tables above, with no report-specific storage.


| Report                            | Reads                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current Stock (TASK-03)           | `stock_movements` grouped by `variant_id`, rolled up to `products`                                                                                                                                                                                                                             |
| Product Ledger (TASK-02)          | `stock_movements` filtered by date / vendor / article / category                                                                                                                                                                                                                               |
| **Vendor Stock (§14)**           | `vendor_stock_movements` grouped by vendor + material + unit                                                                                                                                                                                                                                   |
| Account Ledger / Khaata (TASK-16) | `ledger_entries` for one `ba_id` + `sale_bills` (Inv#/Bill#) + `receipts` joined to `cheques` (cheque sub-columns)                                                                                                                                                                             |
| Cash Book (TASK-15)               | `receipts` + `expenses` + `cheque_allocations`, split by `payment_mode`; opening cash from `OPENING` rows                                                                                                                                                                                      |
| Business Ledger (UC-36)           | `ledger_entries` joined to `business_accounts`; the Code / Description / Main Account / City columns are `code` / `name` / the parent `chart_of_accounts.name` / `city_id` — **City comes from the account itself**, since employee and director accounts have no customer to inherit it from |
| Sale Analysis (TASK-09)           | `sale_bills` + `sale_returns` + `receipts`, grouped by customer or by `customers.region_id`                                                                                                                                                                                                    |
| Sale Report (TASK-18)             | as above;**Commission column = `SUM(receipts.commission)`**, not sale-time discounts (§7)                                                                                                                                                                                                     |
| Vendor Report (TASK-10)           | `purchases` + `purchase_returns` by `vendor_id`, joined to `expenses` via `vendors.ba_id` for Payment Paid                                                                                                                                                                                     |
| Payment Trail (TASK-17)           | `expenses` joined up to `chart_of_accounts`, grouped by chart account                                                                                                                                                                                                                          |
| Notifications (§12)              | `cheques` (cheque due) only — `due_date` removed from `sale_bills`/`purchases`, minus `alert_dismissals`                                                                                                                                                                                      |

The two things this map depends on are worth stating plainly: **Vendor Report only reconciles
because `vendors.ba_id` ties the purchase side to the payment side**, and **Payment Trail's five
categories are chart accounts**, so they must be seeded (§8) rather than inferred from names.

---

## 8. Required seed data

The schema is not usable until these rows exist — several are referenced by code paths, not just
by convention.


| Kind                             | Rows                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| User                             | One`ADMIN` user (bcrypt hash)                                                                                      |
| Group accounts                   | `ASSETS` (1000), `LIABILITY` (2000), `INCOME` (3000), `EXPENSES` (4000)                                            |
| Chart — reserved                | **CUSTOMERS ACCOUNTS** (parent of every customer BA), **VENDORS ACCOUNTS** (parent of every vendor BA, §10 gap 2), **Cash at Banks** also doubles as parent of every `bank_accounts` BA (§12 Q3/Q9) |
| Chart — posting targets         | **CASH IN HAND**, **SALES**, **PURCHASES**, **COMMISSION ALLOWED**, **CHEQUES IN HAND**                            |
| Chart — Payment Trail (TASK-17) | Business Running Expenses,**Cash at Banks**, **Directors Expenses - Drawings**, Employees, Vendors - Suppliers     |
| Restricted flag (§8/TASK-14)    | `is_restricted = 1` on **Cash at Banks** and **Directors Expenses - Drawings**                                     |
| Store                            | One default store (single-store business)                                                                          |

All seeded accounts are numbered per §3.2 — groups 4 digits, chart accounts 6. Where a seeded
account corresponds to one in the client's existing system, its `legacy_code` is populated during
the import so opening balances can be reconciled against the old ledger.

The reserved chart accounts must be resolvable from app config by `code`, so the vendor/customer
auto-create logic and the posting logic never hardcode an `ac_id`.

---

## 9. `updated_at` triggers

MS SQL has no shared trigger function, so each table needs its own. Template:

```sql
CREATE TRIGGER dbo.TR_products_updated ON dbo.products AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE t SET updated_at = SYSUTCDATETIME()
  FROM dbo.products AS t
  INNER JOIN inserted AS i ON t.product_id = i.product_id;
END;
```

Rather than hand-writing 29 of these, the migration generates them:

```sql
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql = @sql + N'
CREATE TRIGGER dbo.TR_' + t.name + N'_updated ON dbo.' + QUOTENAME(t.name) + N' AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE x SET updated_at = SYSUTCDATETIME()
  FROM dbo.' + QUOTENAME(t.name) + N' AS x
  INNER JOIN inserted AS i ON x.' + QUOTENAME(pk.name) + N' = i.' + QUOTENAME(pk.name) + N';
END;'
FROM sys.tables AS t
CROSS APPLY (SELECT TOP 1 c.name FROM sys.index_columns ic
             JOIN sys.indexes  i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
             JOIN sys.columns  c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
             WHERE i.is_primary_key = 1 AND ic.object_id = t.object_id) AS pk
WHERE EXISTS (SELECT 1 FROM sys.columns c
              WHERE c.object_id = t.object_id AND c.name = 'updated_at');
EXEC sp_executesql @sql;
```

---

## 10. Table inventory (30)


| #  | Table                    | Purpose                                           | New                              |
| -- | ------------------------ | ------------------------------------------------- | -------------------------------- |
| 1  | `users`                  | auth + role (§8)                                 | role is new                      |
| 2  | `regions`                | §10 gap 6 / TASK-07                              | ✅                               |
| 3  | `cities`                 | city lookup                                       |                                  |
| 4  | `stores`                 | bill metadata                                     |                                  |
| 5  | `addas`                  | transport terminals                               |                                  |
| 6  | `materials`              | self-building purchase-material lookup (§4.3)    | ✅                               |
| 7  | `product_categories`     | TASK-03 category column                           |                                  |
| 8  | `products`               | TASK-03 main rows (renamed from`articles`)        | ✅ (replaces old flat`products`) |
| 9  | `article_colors`         | TASK-03 colour sub-rows                           | ✅                               |
| 10 | `group_accounts`         | class level                                       |                                  |
| 11 | `chart_of_accounts`      | now parented by group (TASK-11)                   | reshaped                         |
| 12 | `business_accounts`      | leaf ledger accounts                              | reshaped                         |
| 13 | `vendors`                | +`ba_id` link (§10 gap 2)                        | reshaped                         |
| 14 | `customers`              | +`ba_id`, `region_id`                             | reshaped                         |
| 15 | `sub_customers`          | parent FK removed (TASK-06)                       | reshaped                         |
| 16 | `sale_bills`             | +`main_ac_id`; `due_date` removed                 |                                  |
| 17 | `sale_bill_items`        | now keyed on`variant_id`                          |                                  |
| 18 | `sale_returns`           |                                                   |                                  |
| 19 | `sale_return_items`      |                                                   |                                  |
| 20 | `purchases`              | TASK-01                                           | ✅                               |
| 21 | `purchase_items`         | material lines,`material_id` FK                   | ✅                               |
| 22 | `purchase_returns`       | §10 gap 1                                        | ✅                               |
| 23 | `purchase_return_items`  |                                                   | ✅                               |
| 24 | `receipts`               | + commission; cheque fields moved to`cheques`     |                                  |
| 25 | `expenses`               | also the vendor-payment path                      |                                  |
| 26 | `stock_movements`        | pairs ledger, keyed on variant                    | reshaped                         |
| 27 | `vendor_stock_movements` | material ledger (§14)                            | ✅                               |
| 28 | `ledger_entries`         | real FKs instead of polymorphic id                | reshaped                         |
| 29 | `cheque_allocations`     | §13 — cheque endorsement (built in frontend M6) | ✅                               |
| 30 | `alert_dismissals`       | §12 — alert dismissals (built in frontend M6)   | ✅                               |

**Removed:** `control_accounts` (TASK-11), old flat `products` (superseded by `products` [renamed
from `articles`] + `article_colors`).

> This inventory predates the draft-bill/cheque-redesign/account-class work and is stale on count.
> Nine tables were added since: `account_classes` (§5.3), `draft_sale_bills`, `draft_sale_bill_items`
> (§5.6.1), `draft_sale_returns`, `draft_sale_return_items` (§5.6.2), `bank_accounts`, `cheques`,
> `draft_receipts`, `draft_expenses` (§5.8) — real total 39, not 30. `cheque_allocations` (row 29)
> still keys off `receipts.receipt_id`, not `cheques.cheque_id` — noted as intentional in §5.10.

---

## 11. Deviations from `architecture-v2.md`

Called out so the review is against a known baseline rather than a silent reinterpretation.

1. **`stock_movements` gains no `PURCHASE`/`PURCHASE_RETURN` values**, contradicting §6 and §10
   gap 5. Superseded by the client's decision that purchases are raw materials tracked in a
   separate vendor stock (§2 decisions 1–3). §14's Vendor Stock is therefore in material units,
   not pairs.
2. **§10 gap 2 says the vendor's business account sits "under a 'Vendors' `group_accounts` group".**
   With Control Accounts removed the hierarchy is Group → Chart → Business, so a business account's
   parent is a *chart* account. Modelled here as a reserved **VENDORS ACCOUNTS chart account**,
   under the LIABILITY group. Same intent, one level down.
3. **`chart_of_accounts.is_restricted`** is an addition — §8 names the two restricted areas but not
   a mechanism. A flag keeps the rule in data rather than in hardcoded name matching.
4. **`expenses.cheque_no` / `cheque_date`** are an inference from §4's Cash Book requirement for a
   per-cheque/online/cash breakdown on the payments side.
5. **`purchase_items.weight`** is nullable and informational. §2 lists Weight among the Purchase
   fields, but nothing downstream consumes it, so `quantity` (in `unit`) drives value and stock.
6. **`ledger_entries` splits the polymorphic `account_id`** into two nullable FK columns, so SQL
   Server can enforce the reference. Behaviourally identical, strictly safer.

---

## 12. Open questions

1. ~~**Free-text materials will fragment.**~~ — **RESOLVED**: material entry stays open-ended, but
   a name typed once is auto-registered in `materials` and comes back as a **dropdown option from
   the database** on every later purchase, so it is picked rather than retyped (§4.3). Purchase
   lines store `material_id`, and duplicates that do slip through can be merged after the fact by
   repointing the FK — which free text could never have supported. *Remaining nicety, not a
   blocker:* there is no admin screen to rename or merge materials yet, so that repair is a manual
   SQL statement for now.
2. ~~**`cheque_allocations.target_id` is polymorphic**~~ — **RESOLVED (Yes)**: split into
   `target_vendor_id` / `target_ba_id`, same pattern as `ledger_entries`. Real FKs to `vendors` and
   `business_accounts`, `CK_cheque_allocations_target` enforces exactly the one matching
   `disposition_type` is set.
3. ~~**Which chart account is CASH vs BANK for each payment mode?**~~ — **RESOLVED (Option B —
   picked per transaction):** `CASH` always posts to the single seeded `CASH IN HAND` chart account.
   `ONLINE` requires `receipts.bank_id`/`expenses.bank_id` (§5.8), resolving through the new
   `bank_accounts.ba_id` to that specific bank's own chart account (e.g. `Bank Alfalah A/C - 0124`).
   `CHEQUE` resolves its bank through the cheque instead (`cheque_id → cheques.bank_id`), so the
   receipt/expense's own `bank_id` stays `NULL` for cheque payments. Same fix as Q9 below — they
   were always the same gap.
4. ~~**`products.p1`, `p2`, `na`**~~ — **RESOLVED**: these are owner-supplied fields, kept exactly
   as named — no renaming, no other table references them. **Action applied:** column type changed
   `DECIMAL(12,2)` → `INT`; nothing else touched.
5. ~~**Sale Return has no `due_date`**~~ — **MOOT**: `due_date` was removed from `sale_bills` and
   `purchases` entirely (§5.6/§5.7 actions), so the asymmetry this question raised no longer exists.
6. ~~**Multi-user audit**~~ — **RESOLVED (add for future safety):** `updated_by INT NULL` added
   beside `created_by` on every document table (§3 Audit convention, above). It stays unused today
   (single system, single session) but is there the moment multiple staff or a network deployment
   shows up — no migration needed later. Still no full change-history/versioning table; that's a
   bigger step, only worth it if you need to see *what* changed, not just *who* touched it last.
7. ~~**Account numbering**~~ — **RESOLVED**: codes are internal identifiers that staff never
   memorise, so the scheme is ours (§3.2): parent code + zero-padded serial, 4 / 6 / 10 digits.
   Legacy 12-digit codes are preserved in `legacy_code` for import reconciliation only.
8. ~~**Financial year**~~ — **RESOLVED**: the July–June year on the legacy ledger is a reporting
   filter, nothing more. No fiscal-year table, no closing, no carry-forward, no year in document
   numbers. *Frontend follow-up, not schema:* reports offer Overall / By Month / Between Two Dates
   but no **annual** option, which the client expects — a filter to add in a later milestone.
9. ~~**Bank accounts are still only partly modelled.**~~ — **RESOLVED (Option B):** `dbo.banks` is
   promoted to `dbo.bank_accounts` — a real party table with its own `ba_id` into
   `business_accounts`, auto-created under the reserved **Cash at Banks** chart account, exactly the
   `vendors`/`customers` pattern. `receipts.bank_id`/`expenses.bank_id` let a specific bank be picked
   per transaction (required for `ONLINE`, `NULL` for `CASH`/`CHEQUE` — see Q3). "Cash at Banks" can
   now be broken down and reconciled per bank, not just for cheque activity.
