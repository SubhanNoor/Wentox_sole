/* ============================================================================
   WentoX — MS SQL Server Database Schema
   Source of truth: System_architecture/database_schema_v4.3.md
   Engine: Microsoft SQL Server (T-SQL)
   Status: NOT executed anywhere yet. This file is the reviewable migration
   script. Run it only after sign-off.

   39 tables, organised below in dependency order (a table only references
   tables that appear above it), grouped into the same sections as the
   design doc:
     1. Session options (required — see note below)
     2. System / auth               -> users
     3. Setup / lookup              -> regions, cities, stores, addas,
                                        materials, product_categories
     4. Accounts hierarchy          -> account_classes, group_accounts,
                                        chart_of_accounts, business_accounts
     5. Parties                     -> vendors, customers, sub_customers
     6. Products                    -> articles, article_colors
     7. Sales                       -> sale_bills(+items), draft_sale_bills(+items),
                                        sale_returns(+items), draft_sale_returns(+items)
     8. Purchases                   -> purchases(+items), purchase_returns(+items)
     9. Money                       -> bank_accounts, cheques, receipts,
                                        draft_receipts, expenses, draft_expenses
    10. Derived-state ledgers       -> stock_movements, vendor_stock_movements,
                                        ledger_entries
    11. Cheque alerts / endorsement -> cheque_allocations, alert_dismissals

   For every table you will find, in this order:
     a) a short "WHAT / WHY" comment block
     b) the CREATE TABLE statement (with inline column comments)
     c) its indexes
     d) a "USED BY / JOINS" note showing which screens or reports read it
        and the typical JOIN path to get there

   Conventions (full detail in the design doc §3):
     - Schema dbo. PK = INT IDENTITY(1,1), named PK_<table>.
     - snake_case names; constraints prefixed PK_/FK_/UQ_/CK_/DF_, indexes IX_.
     - NVARCHAR for anything a human types; VARCHAR for machine codes/enums.
     - Money DECIMAL(14,2); rates/costs DECIMAL(12,2); material qty DECIMAL(14,3);
       pairs/cartons INT.
     - DATE for business dates; DATETIME2(0) for audit stamps.
     - created_at/updated_at on every table; updated_at is maintained by a
       per-table AFTER UPDATE trigger (§13 of the doc — one trigger per
       table, no shared trigger function in T-SQL).
     - Soft delete (is_active BIT) on lookup/setup tables only. Transactions
       are never soft-deleted; they live in DRAFT or get edited.
     - FK default is NO ACTION (RESTRICT). Only document -> line-item
       relationships use ON DELETE CASCADE.
     - Nullable "unique" columns use a filtered UNIQUE INDEX (MS SQL's
       UNIQUE constraint only tolerates one NULL).
   ============================================================================ */

/* ----------------------------------------------------------------------------
   0. REQUIRED SESSION OPTIONS
   Every filtered index below (WHERE clauses on CREATE INDEX) and later
   INSERT/UPDATE statements against those tables will fail at runtime if a
   session does not have these options set exactly as below. Not optional
   housekeeping — set them before running this script, and make sure the
   application's DB connection sets them too.
---------------------------------------------------------------------------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- Database collation should be case-insensitive, e.g. SQL_Latin1_General_CP1_CI_AS.
-- UQ_materials_name relies on it: retyping 'pu sheet roll' must collide with
-- 'PU Sheet Roll' instead of creating a duplicate material row.

/* ============================================================================
   1. SYSTEM / AUTH
   ============================================================================ */

/* ----------------------------------------------------------------------------
   dbo.users
   WHAT:  Application login accounts. One row per staff member who can sign in.
   WHY:   role drives §8/TASK-14 role-based restriction (ADMIN vs USER),
          and created_by/updated_by on every document table points here for
          audit ("who confirmed this bill").
---------------------------------------------------------------------------- */
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
GO
-- USED BY: Login screen (SELECT ... WHERE username = @u), every document
-- table's created_by/updated_by FK for audit trails, and the middleware that
-- filters restricted chart accounts (role = 'USER' -> hide is_restricted = 1
-- accounts, §4.6).

/* ============================================================================
   2. SETUP / LOOKUP TABLES
   ============================================================================ */

/* ----------------------------------------------------------------------------
   dbo.regions
   WHAT:  Top-level geography lookup (e.g. "Punjab", "Sindh").
   WHY:   §10 gap 6 / TASK-07 — customer identification is Region first,
          City second (§11). Real lookup table instead of a free-text column.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.regions (
  region_id  INT IDENTITY(1,1) NOT NULL,
  name       NVARCHAR(100) NOT NULL,
  is_active  BIT          NOT NULL CONSTRAINT DF_regions_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_regions_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_regions_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_regions      PRIMARY KEY (region_id),
  CONSTRAINT UQ_regions_name UNIQUE (name)
);
GO
-- USED BY: Region dropdown on Customer/Business Account forms; the customer
-- search screen filters JOIN dbo.customers c ON c.region_id = regions.region_id
-- (Region first, then City — see IX_customers_region below).

/* ----------------------------------------------------------------------------
   dbo.cities
   WHAT:  City lookup, optionally rolled up into a region.
   WHY:   UC-36 shows City for accounts with no customer to inherit one from
          (business_accounts.city_id); customers also carry city_id directly.
---------------------------------------------------------------------------- */
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
GO
-- USED BY: City dropdown (optionally filtered by the region already picked);
-- dbo.addas.city_id, dbo.business_accounts.city_id, dbo.vendors.city_id,
-- dbo.customers.city_id all join here for display.

/* ----------------------------------------------------------------------------
   dbo.stores
   WHAT:  Physical store/warehouse metadata. The business runs a SINGLE
          store today, so this is bill metadata only — it does NOT gate
          stock_movements (§4.1: "movements carry no store_id").
   WHY:   sale_bills.store_id / sale_returns.store_id still reference it so
          the source/destination store can be printed on a bill.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.stores (
  store_id   INT IDENTITY(1,1) NOT NULL,
  name       NVARCHAR(100) NOT NULL,
  is_active  BIT          NOT NULL CONSTRAINT DF_stores_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_stores_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_stores_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_stores      PRIMARY KEY (store_id),
  CONSTRAINT UQ_stores_name UNIQUE (name)
);
GO
-- USED BY: Store dropdown on Sale Bill / Sale Return forms
-- (sale_bills.store_id, sale_returns.store_id, ON DELETE SET NULL so a
-- deleted store never blocks historical bills from being viewed).

/* ----------------------------------------------------------------------------
   dbo.addas
   WHAT:  Transport terminal lookup (where goods are dispatched from/to).
   WHY:   sale_bills.adda_id / sale_returns.adda_id are NOT NULL in v4.3 —
          every bill must name a dispatch adda (the "Without Adda" deferred
          workflow was removed, see doc §5.6 note).
---------------------------------------------------------------------------- */
-- POST-v4.3: region_id (required) added, per client instruction, so the Sale Bill/Sale Return
-- adda dropdown/filter can be scoped the same way sub_customers' region filtering works.
CREATE TABLE dbo.addas (
  adda_id    INT IDENTITY(1,1) NOT NULL,
  name       NVARCHAR(100) NOT NULL,
  region_id  INT          NOT NULL,
  city_id    INT          NULL,
  details    NVARCHAR(200) NULL,
  is_active  BIT          NOT NULL CONSTRAINT DF_addas_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_addas_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_addas_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_addas        PRIMARY KEY (adda_id),
  CONSTRAINT UQ_addas_name   UNIQUE (name),
  CONSTRAINT FK_addas_region FOREIGN KEY (region_id) REFERENCES dbo.regions(region_id),
  CONSTRAINT FK_addas_city   FOREIGN KEY (city_id)   REFERENCES dbo.cities(city_id)
);
CREATE INDEX IX_addas_region ON dbo.addas(region_id);
-- Hard-deleting an adda referenced by a sale bill is blocked by FK NO ACTION; use is_active = 0.
GO
-- USED BY: Adda dropdown on Sale Bill / Sale Return forms; TASK-09's Search &
-- Bilty Adda Updation screen (adda_id can still be changed after a bill is
-- CONFIRMED, since it is non-financial dispatch metadata, §4.7).

/* ----------------------------------------------------------------------------
   dbo.materials
   WHAT:  Self-building raw-material lookup (§4.3). NOT hand-curated, has no
          setup screen — a Purchase line typing a new name auto-creates it.
   WHY:   Prevents "PU Sheet", "PU sheet roll", "P.U. Sheet Roll" from
          fragmenting vendor-stock totals across three near-identical rows.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.materials (
  material_id  INT IDENTITY(1,1) NOT NULL,
  name         NVARCHAR(150) NOT NULL,                       -- as first typed, e.g. 'PU Sheet Roll'
  default_unit NVARCHAR(30)  NULL,                           -- pre-fills the unit on a new purchase line
  is_active    BIT          NOT NULL CONSTRAINT DF_materials_active  DEFAULT (1),
  created_at   DATETIME2(0) NOT NULL CONSTRAINT DF_materials_created DEFAULT (SYSUTCDATETIME()),
  updated_at   DATETIME2(0) NOT NULL CONSTRAINT DF_materials_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_materials      PRIMARY KEY (material_id),
  -- case-insensitive collation: retyping 'pu sheet roll' resolves to the existing row, never a twin
  CONSTRAINT UQ_materials_name UNIQUE (name)
);
CREATE INDEX IX_materials_name ON dbo.materials(name) WHERE is_active = 1;   -- dropdown typeahead
GO
-- USED BY: Purchase / Purchase Return line item material dropdown
-- (purchase_items.material_id, purchase_return_items.material_id), and the
-- Vendor Stock page's GROUP BY (vendor_stock_movements.material_id).
-- Renaming a material here propagates to every historical document by
-- design — same physical material, current name is the right display name.

/* ----------------------------------------------------------------------------
   dbo.product_categories
   WHAT:  Category lookup for finished-goods articles (e.g. "Slippers",
          "School Shoes").
---------------------------------------------------------------------------- */
CREATE TABLE dbo.product_categories (
  category_id INT IDENTITY(1,1) NOT NULL,
  name        NVARCHAR(100) NOT NULL,
  is_active   BIT          NOT NULL CONSTRAINT DF_categories_active  DEFAULT (1),
  created_at  DATETIME2(0) NOT NULL CONSTRAINT DF_categories_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0) NOT NULL CONSTRAINT DF_categories_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_product_categories      PRIMARY KEY (category_id),
  CONSTRAINT UQ_product_categories_name UNIQUE (name)
);
GO
-- USED BY: Category dropdown/filter on the Products (TASK-03) page
-- (dbo.articles.category_id).

/* ============================================================================
   3. ACCOUNTS HIERARCHY — Group -> Chart -> Business
   control_accounts is deleted entirely (§9/TASK-11); chart_of_accounts now
   hangs directly off group_accounts, business_accounts off chart_of_accounts.
   See doc §3.2 for the code-composition rule (child code = parent code +
   zero-padded serial).
   ============================================================================ */

/* ----------------------------------------------------------------------------
   dbo.account_classes
   WHAT:  Top-of-hierarchy classification: ASSETS / LIABILITY / INCOME /
          EXPENSES. Promoted from a fixed CHECK list to a real lookup so a
          new class is a row insert, not a schema migration (§3.1).
---------------------------------------------------------------------------- */
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
GO
-- USED BY: dbo.group_accounts.class_id — every group (e.g. code '1000') is
-- classified through this table for financial-statement grouping.

/* ----------------------------------------------------------------------------
   dbo.group_accounts
   WHAT:  Top level of the chart-of-accounts hierarchy (4-digit code, e.g.
          '1000' ASSETS). Parent of chart_of_accounts.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.group_accounts (
  group_id    INT IDENTITY(1,1) NOT NULL,
  code        VARCHAR(20)   NOT NULL,                         -- 4 digits, e.g. '1000' (§3.2)
  legacy_code VARCHAR(20)   NULL,                             -- old system's number; import reconciliation only
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
GO
-- USED BY: Chart of Accounts setup screen (top level of the tree); joins
-- down to dbo.chart_of_accounts.group_id for the full hierarchy display.

/* ----------------------------------------------------------------------------
   dbo.chart_of_accounts
   WHAT:  Middle level (6-digit code, e.g. '110001' CUSTOMERS ACCOUNTS).
          Parent of business_accounts. Also the direct target of
          ledger_entries.ac_id for postings that are not party-specific
          (SALES, PURCHASES, CASH IN HAND, COMMISSION ALLOWED, ...).
   WHY:   is_restricted drives §4.6/§8/TASK-14's data-driven role
          restriction — a USER role cannot see "Bank Accounts" or
          "Directors Expenses - Drawings" because those rows have the flag
          set, not because application code matches their names.
---------------------------------------------------------------------------- */
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
GO
-- USED BY: Chart of Accounts screen (middle level); dbo.business_accounts.ac_id
-- (parent); dbo.sale_bills.main_ac_id (customer's main A/C snapshot);
-- dbo.ledger_entries.ac_id (posting target for non-party rows like SALES,
-- PURCHASES, CASH IN HAND, COMMISSION ALLOWED, CHEQUES IN HAND); the
-- Trial Balance / Account Ledger reports GROUP BY / JOIN on ac_id.

/* ----------------------------------------------------------------------------
   dbo.business_accounts
   WHAT:  Leaf level (10-digit code, e.g. '1100010001'). One row per
          real-world ledger account a party or expense head resolves to.
          vendors, customers, and bank_accounts each carry a unique ba_id
          into this table (§4.5).
   WHY:   city_id is stored here directly (not inherited from a customer)
          because employee/director accounts are business accounts with no
          customer behind them — this is UC-36's City column.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.business_accounts (
  ba_id       INT IDENTITY(1,1) NOT NULL,
  code        VARCHAR(20)   NOT NULL,                         -- 10 digits, e.g. '1100010001' (§3.2)
  legacy_code VARCHAR(20)   NULL,                             -- old system's number; import only
  name        NVARCHAR(100) NOT NULL,
  ac_id       INT           NOT NULL,                         -- was control_id; parent chart account
  link_code   VARCHAR(20)   NULL,
  region_id   INT           NULL,
  city_id     INT           NULL,                             -- UC-36 City column; not inherited from customer
  -- What the account already held before WentoX started recording it. A stored
  -- INPUT, not a stored balance -- the running balance is still derived, it just
  -- starts here instead of at zero.
  -- On business_accounts rather than bank_accounts on purpose: cash needs one,
  -- every bank needs one, and so will all 218+ customer/vendor accounts when the
  -- client's legacy ledger is imported. One mechanism beats a bank-only field
  -- that gets reinvented three more times.
  opening_balance DECIMAL(14,2) NULL,
  opening_date    DATE          NULL,
  status      VARCHAR(10)   NOT NULL CONSTRAINT DF_ba_status  DEFAULT ('ACTIVE'),
  created_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_ba_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_ba_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_business_accounts        PRIMARY KEY (ba_id),
  CONSTRAINT UQ_business_accounts_code   UNIQUE (code),
  CONSTRAINT FK_business_accounts_chart  FOREIGN KEY (ac_id)     REFERENCES dbo.chart_of_accounts(ac_id),
  CONSTRAINT FK_business_accounts_region FOREIGN KEY (region_id) REFERENCES dbo.regions(region_id),
  CONSTRAINT FK_business_accounts_city   FOREIGN KEY (city_id)   REFERENCES dbo.cities(city_id),
  CONSTRAINT CK_business_accounts_status CHECK (status IN ('ACTIVE','CLOSED')),
  -- An opening balance without a date cannot be placed on a timeline, so a
  -- ledger could not tell whether it sits before or after the first document.
  CONSTRAINT CK_business_accounts_opening CHECK (
        (opening_balance IS NULL     AND opening_date IS NULL)
     OR (opening_balance IS NOT NULL AND opening_date IS NOT NULL))
);
CREATE INDEX IX_business_accounts_chart  ON dbo.business_accounts(ac_id);
CREATE INDEX IX_business_accounts_region ON dbo.business_accounts(region_id);
CREATE INDEX IX_business_accounts_city   ON dbo.business_accounts(city_id);
GO
-- USED BY: Business Accounts Ledger screen; every party table's ba_id
-- (vendors.ba_id, customers.ba_id, bank_accounts.ba_id); dbo.ledger_entries.ba_id
-- (posting target for party-specific rows — customer/vendor/bank balances);
-- dbo.expenses.ba_id (expense head or vendor payment target);
-- dbo.cheque_allocations.target_ba_id. Account Ledger report:
--   SELECT ... FROM dbo.ledger_entries le
--   JOIN dbo.business_accounts ba ON ba.ba_id = le.ba_id
--   WHERE ba.ba_id = @selected_account ORDER BY le.entry_date;

/* ============================================================================
   4. PARTIES — vendors, customers, sub customers
   ============================================================================ */

/* ----------------------------------------------------------------------------
   dbo.vendors
   WHAT:  A raw-material supplier. Owns its own PK plus a unique ba_id into
          business_accounts (§4.5) so Purchase (needs vendor_id) and
          Expense-as-vendor-payment (needs ba_id) resolve to the same party.
   WHY:   ba_id auto-created under the reserved VENDORS ACCOUNTS chart
          account when the vendor is created — one form, no separate
          account-setup step exposed to the user.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.vendors (
  vendor_id  INT IDENTITY(1,1) NOT NULL,
  name       NVARCHAR(100) NOT NULL,
  phone      VARCHAR(30)   NULL,
  region_id  INT           NULL,
  city_id    INT           NULL,
  ba_id      INT           NULL,   -- §10 gap 2: auto-created under VENDORS ACCOUNTS on vendor create
  is_active  BIT          NOT NULL CONSTRAINT DF_vendors_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_vendors_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_vendors_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_vendors        PRIMARY KEY (vendor_id),
  -- No UNIQUE(name): two vendors may legitimately share a name (e.g. two different "Ali
  -- Traders"); duplicate detection is name+phone together, service-layer only (findByNameAndPhone).
  CONSTRAINT FK_vendors_ba     FOREIGN KEY (ba_id)     REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_vendors_region FOREIGN KEY (region_id) REFERENCES dbo.regions(region_id),
  CONSTRAINT FK_vendors_city   FOREIGN KEY (city_id)   REFERENCES dbo.cities(city_id)
);
-- Filtered unique: one vendor per business account, but many vendors may await backfill (NULL).
CREATE UNIQUE INDEX UQ_vendors_ba ON dbo.vendors(ba_id) WHERE ba_id IS NOT NULL;
GO
-- USED BY: Vendor dropdown on Purchase / Purchase Return (purchases.vendor_id,
-- purchase_return_items via purchase_returns.vendor_id); Vendor Stock page
-- (vendor_stock_movements.vendor_id); Expense screen's vendor-payment path
-- via vendors.ba_id -> expenses.ba_id; dbo.articles.vendor_id (TASK-02 ledger
-- filter by company/vendor).

/* ----------------------------------------------------------------------------
   dbo.employees                                   (was dbo.workers)
   WHAT:  A member of staff, of one of TWO kinds. The third instance of the
          §4.5 pattern — own PK plus a unique ba_id into business_accounts.

            WORKER    paid per piece, via dbo.wage_runs. Has trades
                      (dbo.worker_stages). No salary.
            SALARIED  paid a fixed amount monthly, via dbo.salary_runs.
                      Has monthly_salary. No trades.

   WHY:   ba_id is auto-created under a **LIABILITY** head, not an expense
          head. That distinction is load-bearing: staff can be owed money
          between doing the work and being paid, and an account under EXPENSES
          can only accumulate what was paid out, never a balance due. Vendors
          already work this way.

          The two kinds hang under DIFFERENT heads, which is the only thing
          employee_type changes at creation time:
            WORKER    -> WORKER WAGES     220001  ->  ba codes 2200010001+
            SALARIED  -> SALARIES PAYABLE 220002  ->  ba codes 2200020001+
          Keeping them apart lets a report separate piece-rate labour (a
          product cost) from salary (overhead) -- blended, you cannot see what
          a pair actually costs in direct labour.

   NOTE:  ONE TABLE, not two. Both kinds share the party pattern, the list
          page, the balance helper and the payment path; splitting them would
          duplicate all four to express one VARCHAR(10) difference, and would
          leave expenses.ba_id with two profile tables to join back to.
          A person is one kind or the other -- someone who genuinely does both
          is entered twice, on purpose, so no screen has to show one person in
          two sections.

   INTEGRITY: UQ_employees_id_type looks redundant next to the PK. It is not
          decoration -- it is the FK target that lets worker_stages, wage_runs
          and salary_run_items each carry employee_type and pin it to a
          literal, so the DATABASE (not just screen code) refuses to give a
          salaried employee a trade, put one on a wage run, or put a worker on
          a salary run. Costs one column on three child tables.

   NUMBERING: this is the head that grows into the hundreds (the client's
          legacy data holds 218+ under Employees), which is why §3.2's
          4-digit serial matters here more than anywhere: 2200010001.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.employees (
  employee_id    INT IDENTITY(1,1) NOT NULL,
  name           NVARCHAR(100) NOT NULL,
  phone          VARCHAR(30)   NULL,
  city_id        INT           NULL,   -- the legacy Employees ledger displays City
  employee_type  VARCHAR(10)   NOT NULL CONSTRAINT DF_emp_type DEFAULT ('WORKER'),
  monthly_salary DECIMAL(12,2) NULL,   -- SALARIED only; NULL for a WORKER
  ba_id          INT           NULL,   -- auto-created on save, under the head the type implies
  is_active      BIT          NOT NULL CONSTRAINT DF_emp_active  DEFAULT (1),
  created_at     DATETIME2(0) NOT NULL CONSTRAINT DF_emp_created DEFAULT (SYSUTCDATETIME()),
  updated_at     DATETIME2(0) NOT NULL CONSTRAINT DF_emp_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_employees      PRIMARY KEY (employee_id),
  CONSTRAINT FK_employees_ba   FOREIGN KEY (ba_id)   REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_employees_city FOREIGN KEY (city_id) REFERENCES dbo.cities(city_id),
  CONSTRAINT CK_employees_type CHECK (employee_type IN ('WORKER','SALARIED')),
  -- A salary is exactly as meaningful as the type says it is. Without this,
  -- a worker can carry a stray salary nothing will ever pay, and a salaried
  -- employee can carry NULL and post a run of zero.
  CONSTRAINT CK_employees_salary CHECK (
        (employee_type = 'WORKER'   AND monthly_salary IS NULL)
     OR (employee_type = 'SALARIED' AND monthly_salary IS NOT NULL AND monthly_salary >= 0)),
  CONSTRAINT UQ_employees_id_type UNIQUE (employee_id, employee_type)
);
CREATE UNIQUE INDEX UQ_employees_ba   ON dbo.employees(ba_id) WHERE ba_id IS NOT NULL;
CREATE INDEX        IX_employees_name ON dbo.employees(name);
CREATE INDEX        IX_employees_type ON dbo.employees(employee_type, is_active);
GO
-- USED BY: Employees setup page (two sections, Workers / Salaried Employees);
-- Expense screen (paying anyone is an Expense against employees.ba_id);
-- Payment Trail's "Employees" row -- which already called them employees long
-- before the table did. Accrual is dbo.wage_runs (piece rate) and
-- dbo.salary_runs (monthly), both at the end of this file.
-- CHANGING employee_type after creation is NOT supported: it would strand the
-- ba_id under the wrong account head and orphan either the trades or the
-- salary history. Deactivate and re-create instead.

/* ----------------------------------------------------------------------------
   dbo.customers
   WHAT:  A buyer. Mirrors vendors — own PK plus a unique ba_id.
   WHY:   ba_id is NULLABLE; when NULL, TASK-05's Sale Bill form shows
          "Please add customer account first" instead of letting the bill
          post with nowhere to ledger it.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.customers (
  customer_id INT IDENTITY(1,1) NOT NULL,
  name        NVARCHAR(150) NOT NULL,
  ba_id       INT           NULL,   -- NULL is exactly TASK-05's "Please add customer account first"
  region_id   INT           NOT NULL,                         -- §11: primary search key
  city_id     INT           NULL,                             -- §11: secondary search key
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
GO
-- USED BY: Customer dropdown/search on Sale Bill and Sale Return
-- (sale_bills.customer_id, sale_returns.customer_id); Receipt screen
-- (receipts.customer_id); §11 customer search:
--   SELECT ... FROM dbo.customers c
--   JOIN dbo.regions r ON r.region_id = c.region_id
--   LEFT JOIN dbo.cities ci ON ci.city_id = c.city_id
--   WHERE r.region_id = @region [AND ci.city_id = @city];

/* ----------------------------------------------------------------------------
   dbo.sub_customers
   WHAT:  Alternate delivery-to party on a Sale Bill (delivery_type = 'CUSTOM').
   WHY:   TASK-06 — deliberately a flat independent list, NOT a child of
          customers (the old schema's customer_id NOT NULL FK is removed).
---------------------------------------------------------------------------- */
-- POST-v4.3: region_id (required)/city_id (optional) added so the Sale Bill/Sale Return
-- "deliver to" dropdown can be narrowed to sub-customers in the selected customer's region —
-- per client instruction, reversing UC-10's original "lists every sub-customer, not a filtered
-- subset" wording (see use_cases.md UC-10 note). Sub-customers otherwise stay independent — no
-- parent customer link.
CREATE TABLE dbo.sub_customers (
  sub_customer_id INT IDENTITY(1,1) NOT NULL,
  name            NVARCHAR(150) NOT NULL,
  region_id       INT           NOT NULL,
  city_id         INT           NULL,
  address         NVARCHAR(200) NULL,
  is_active       BIT          NOT NULL CONSTRAINT DF_subcust_active  DEFAULT (1),
  created_at      DATETIME2(0) NOT NULL CONSTRAINT DF_subcust_created DEFAULT (SYSUTCDATETIME()),
  updated_at      DATETIME2(0) NOT NULL CONSTRAINT DF_subcust_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_sub_customers        PRIMARY KEY (sub_customer_id),
  -- No UNIQUE(name): real people can share a name; duplicate handling is app-level (checkName()).
  CONSTRAINT FK_sub_customers_region FOREIGN KEY (region_id) REFERENCES dbo.regions(region_id),
  CONSTRAINT FK_sub_customers_city   FOREIGN KEY (city_id)   REFERENCES dbo.cities(city_id)
);
CREATE INDEX IX_sub_customers_name   ON dbo.sub_customers(name);        -- TASK-06 searchable dropdown
CREATE INDEX IX_sub_customers_region ON dbo.sub_customers(region_id);   -- Sale Bill/Return region filter
GO
-- USED BY: Sale Bill / Sale Return "deliver to" dropdown when
-- delivery_type = 'CUSTOM' (sale_bills.sub_customer_id,
-- sale_returns.sub_customer_id, and their draft mirrors) — filtered by the
-- selected customer's region_id.

/* ============================================================================
   5. ARTICLES AND COLOUR VARIANTS
   TASK-03's main rows are `articles`; its expandable sub-rows are
   `article_colors`. Everything that moves stock or appears on a bill line
   points at a VARIANT (article_colors), never at the article directly.
   ============================================================================ */

/* ----------------------------------------------------------------------------
   dbo.articles
   WHAT:  Finished-goods master. One row per article code; colour lives one
          level down in article_colors.
   WHY:   Carries the 12 manufacturing stage costs (cutting .. finish) plus
          sale_price. The stages replace the legacy 15-field breakdown, which
          included p1/p2/na — columns nobody could explain.
   NOTE:  The stage costs are entered by hand and NEVER summed. There is no
          total-cost column and no total shown anywhere in the UI: they are
          piece rates, read individually to calculate a worker's wage
          (stage rate x cartons x packing -- the rate is PER PAIR, so the
          article's own packing is the multiplier). sale_price is separate and also
          typed in — never derived from the stages — and is the number a sale
          line defaults its rate from.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.articles (
  article_id  INT IDENTITY(1,1) NOT NULL,
  code        VARCHAR(30)   NOT NULL,                         -- TASK-03 "article code (pcode)", e.g. 'P-101'
  name        NVARCHAR(150) NOT NULL,                         -- common name, colour excluded
  category_id INT           NOT NULL,
  -- POST-v4.3: promoted to NOT NULL, per client instruction — batch_no is generated per vendor
  -- (see below), so a vendor must always be present to scope it against.
  vendor_id   INT           NOT NULL,                         -- TASK-02: filter ledger by company/vendor
  -- POST-v4.3: was VARCHAR(50), free-typed. Now system-generated, per client instruction: each
  -- vendor has its own batch-numbering sequence (batch_no = MAX(batch_no) + 1 WHERE vendor_id =
  -- this article's vendor), immutable once assigned — never typed by hand, never edited.
  batch_no    INT           NOT NULL,
  packing     INT           NOT NULL,                         -- default pairs per carton (usually 12)
  -- The one price on an article: typed in by hand, never computed from the stage
  -- costs below. Every sale line defaults its rate from this.
  sale_price    DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_sale   DEFAULT (0),
  -- Manufacturing cost per stage, in the order they appear on the form. These
  -- replace the legacy set (which included p1/p2/na, meaning unknown). They are
  -- entered by hand and deliberately NEVER aggregated -- no total-cost column
  -- anywhere -- because they are piece rates, consumed individually when a
  -- worker's wage is calculated. The rate is PER PAIR and wage quantity is in
  -- CARTONS, so a wage line is rate x cartons x packing -- see dbo.wage_run_items,
  -- which snapshots both the rate and the packing so editing an article later
  -- cannot rewrite a wage already paid.
  cutting       DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_cut    DEFAULT (0),
  edging        DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_edge   DEFAULT (0),
  up_stitch     DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_upst   DEFAULT (0),
  bending       DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_bend   DEFAULT (0),
  stubble_dori  DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_stub   DEFAULT (0),
  shape_form    DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_shape  DEFAULT (0),
  chipkai       DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_chip   DEFAULT (0),
  bottom        DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_bot    DEFAULT (0),
  machine       DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_mach   DEFAULT (0),
  trimming      DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_trim   DEFAULT (0),
  sock_stitch   DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_sockst DEFAULT (0),
  finish        DECIMAL(12,2) NOT NULL CONSTRAINT DF_articles_fin    DEFAULT (0),
  is_active   BIT          NOT NULL CONSTRAINT DF_articles_active  DEFAULT (1),
  created_at  DATETIME2(0) NOT NULL CONSTRAINT DF_articles_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0) NOT NULL CONSTRAINT DF_articles_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_articles          PRIMARY KEY (article_id),
  CONSTRAINT UQ_articles_code     UNIQUE (code),
  CONSTRAINT UQ_articles_vendor_batch UNIQUE (vendor_id, batch_no),
  CONSTRAINT FK_articles_category FOREIGN KEY (category_id) REFERENCES dbo.product_categories(category_id),
  CONSTRAINT FK_articles_vendor   FOREIGN KEY (vendor_id)   REFERENCES dbo.vendors(vendor_id),
  CONSTRAINT CK_articles_packing  CHECK (packing > 0)
);
CREATE INDEX IX_articles_category ON dbo.articles(category_id);
CREATE INDEX IX_articles_vendor   ON dbo.articles(vendor_id);
CREATE INDEX IX_articles_name     ON dbo.articles(name);
GO
-- USED BY: Products page (TASK-03) main rows; Product Ledger (TASK-02),
-- filterable by vendor/company via articles.vendor_id; parent of
-- article_colors (its expandable colour sub-rows).

/* ----------------------------------------------------------------------------
   dbo.article_colors
   WHAT:  Colour variant of a product (TASK-03 sub-rows). This is the row
          every bill line and every stock movement actually points at.
   WHY:   packing is an OPTIONAL override of articles.packing — effective
          packing for a variant is COALESCE(article_colors.packing,
          articles.packing). Carton/extra-pair display is then derived:
          cartons = total_pairs / packing, extra = total_pairs % packing.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.article_colors (
  variant_id INT IDENTITY(1,1) NOT NULL,
  article_id INT           NOT NULL,
  color      NVARCHAR(50)  NOT NULL,                          -- TASK-03 "content color"
  packing    INT           NULL,                              -- optional override of articles.packing
  is_active  BIT          NOT NULL CONSTRAINT DF_variants_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_variants_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_variants_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_article_colors         PRIMARY KEY (variant_id),
  CONSTRAINT UQ_article_colors_acolor  UNIQUE (article_id, color),
  CONSTRAINT FK_article_colors_product FOREIGN KEY (article_id) REFERENCES dbo.articles(article_id),
  CONSTRAINT CK_article_colors_packing CHECK (packing IS NULL OR packing > 0)
);
CREATE INDEX IX_article_colors_product ON dbo.article_colors(article_id);
GO
-- USED BY: TASK-03 "Add" dialog (new colour -> new row here, then logs a
-- PRODUCTION stock movement against it); every sale/return line item
-- (sale_bill_items.variant_id, sale_return_items.variant_id, and draft
-- mirrors); dbo.stock_movements.variant_id (the Product Ledger *is* this
-- movement table, filtered by variant_id).

/* ============================================================================
   6. SALES
   ============================================================================ */

/* ----------------------------------------------------------------------------
   dbo.sale_bills
   WHAT:  A confirmed or draft sale invoice (TASK-16). bill_no, gp_no,
          bilty_no and adda_id are NOT NULL in v4.3 — the "Without
          Bilty"/"Without Adda" dispatch-later workflow was removed
          (real behaviour change, see design doc §5.6).
   WHY:   main_ac_id snapshots the customer's main A/C at bill time
          (TASK-05), so later reorganising the account tree cannot silently
          change which account an old bill posted to.
---------------------------------------------------------------------------- */
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
  due_date         DATE          NULL,                       -- post-v4.3: re-added for the payment-overdue notification feature
  created_by       INT           NULL,
  updated_by       INT           NULL,
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sb_created  DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sb_updated  DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_sale_bills          PRIMARY KEY (bill_id),
  CONSTRAINT FK_sale_bills_store    FOREIGN KEY (store_id)        REFERENCES dbo.stores(store_id) ON DELETE SET NULL,
  CONSTRAINT FK_sale_bills_cust     FOREIGN KEY (customer_id)     REFERENCES dbo.customers(customer_id),
  CONSTRAINT FK_sale_bills_subcust  FOREIGN KEY (sub_customer_id) REFERENCES dbo.sub_customers(sub_customer_id),
  CONSTRAINT FK_sale_bills_mainac   FOREIGN KEY (main_ac_id)      REFERENCES dbo.chart_of_accounts(ac_id),
  CONSTRAINT FK_sale_bills_adda     FOREIGN KEY (adda_id)         REFERENCES dbo.addas(adda_id),
  CONSTRAINT FK_sale_bills_user     FOREIGN KEY (created_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT FK_sale_bills_upd      FOREIGN KEY (updated_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT CK_sale_bills_deliv    CHECK (delivery_type IN ('SAME','CUSTOM')),
  CONSTRAINT CK_sale_bills_custdlv  CHECK (delivery_type = 'SAME' OR sub_customer_id IS NOT NULL)
);
CREATE INDEX IX_sale_bills_date     ON dbo.sale_bills(bill_date);
CREATE INDEX IX_sale_bills_customer ON dbo.sale_bills(customer_id, bill_date);
CREATE INDEX IX_sale_bills_no       ON dbo.sale_bills(bill_no);   -- manual bill no lookup
GO
-- USED BY: Sale Bill (TASK-16) list/print/search screens; posts on confirm
-- to dbo.ledger_entries (Debit CUSTOMER BA / Credit SALES chart account,
-- source_type='SALE_BILL') and to dbo.stock_movements (negative SALE rows
-- per line item, see posting matrix §6). Parent of sale_bill_items.

/* ----------------------------------------------------------------------------
   dbo.sale_bill_items
   WHAT:  Line items of a confirmed/draft sale bill. Points at a VARIANT
          (article_colors), never a product.
---------------------------------------------------------------------------- */
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
GO
-- USED BY: Sale Bill line-item grid (JOIN back to article_colors + articles
-- for display); TASK-12's "articles previously bought by this customer"
-- dropdown reads this JOIN dbo.sale_bills for a given customer_id; on
-- confirm, each row writes one negative SALE dbo.stock_movements row.
-- ON DELETE CASCADE: deleting the parent bill deletes its lines with it.

/* ----------------------------------------------------------------------------
   dbo.draft_sale_bills / dbo.draft_sale_bill_items
   WHAT:  A dummy/unconfirmed sale bill (§5.6.1, new in v4.3). Same fields as
          sale_bills, but nothing here has been through the ledger yet.
   WHY:   Saving a draft DEDUCTS stock immediately (as a stock_movements row,
          no ledger entry); deleting a draft RESTORES it; confirming copies
          the rows into sale_bills/sale_bill_items and deletes the draft —
          stock is not touched again since it was already deducted at
          draft-save time. This deduct/restore behaviour is application
          logic, not enforced by any constraint here.
---------------------------------------------------------------------------- */
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
  updated_by       INT           NULL,
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_dsb_created  DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_dsb_updated  DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_sale_bills          PRIMARY KEY (draft_id),
  CONSTRAINT FK_draft_sale_bills_store    FOREIGN KEY (store_id)        REFERENCES dbo.stores(store_id) ON DELETE SET NULL,
  CONSTRAINT FK_draft_sale_bills_cust     FOREIGN KEY (customer_id)     REFERENCES dbo.customers(customer_id),
  CONSTRAINT FK_draft_sale_bills_subcust  FOREIGN KEY (sub_customer_id) REFERENCES dbo.sub_customers(sub_customer_id),
  CONSTRAINT FK_draft_sale_bills_mainac   FOREIGN KEY (main_ac_id)      REFERENCES dbo.chart_of_accounts(ac_id),
  CONSTRAINT FK_draft_sale_bills_adda     FOREIGN KEY (adda_id)         REFERENCES dbo.addas(adda_id),
  CONSTRAINT FK_draft_sale_bills_user     FOREIGN KEY (created_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT FK_draft_sale_bills_upd      FOREIGN KEY (updated_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT CK_draft_sale_bills_deliv    CHECK (delivery_type IN ('SAME','CUSTOM'))
);
CREATE INDEX IX_draft_sale_bills_date     ON dbo.draft_sale_bills(bill_date);
CREATE INDEX IX_draft_sale_bills_customer ON dbo.draft_sale_bills(customer_id, bill_date);
CREATE INDEX IX_draft_sale_bills_no       ON dbo.draft_sale_bills(bill_no);
GO

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
GO
-- USED BY: "Draft/Dummy Sale Bill" screen. App flow:
--   SAVE draft   -> INSERT draft_sale_bills + draft_sale_bill_items,
--                   INSERT a stock_movements row (ADJUSTMENT/DRAFT type) to deduct stock.
--   DELETE draft -> INSERT the reverse stock_movements row (restore),
--                   DELETE the draft rows. No trace ever reaches sale_bills.
--   CONFIRM      -> INSERT ... SELECT into sale_bills/sale_bill_items from
--                   the draft, DELETE the draft rows. Stock is NOT
--                   re-touched (already deducted at save time).

/* ----------------------------------------------------------------------------
   dbo.sale_returns / dbo.sale_return_items
   WHAT:  Mirror sale_bills/sale_bill_items. store_id is the DESTINATION
          store (TO — where stock comes back); remarks holds the return
          reason; net_value is a CREDIT value, not a debit.
---------------------------------------------------------------------------- */
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
  created_by       INT           NULL,
  updated_by       INT           NULL,
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sr_created DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_sr_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_sale_returns         PRIMARY KEY (return_id),
  CONSTRAINT FK_sale_returns_store   FOREIGN KEY (store_id)        REFERENCES dbo.stores(store_id) ON DELETE SET NULL,
  CONSTRAINT FK_sale_returns_cust    FOREIGN KEY (customer_id)     REFERENCES dbo.customers(customer_id),
  CONSTRAINT FK_sale_returns_subcust FOREIGN KEY (sub_customer_id) REFERENCES dbo.sub_customers(sub_customer_id),
  CONSTRAINT FK_sale_returns_adda    FOREIGN KEY (adda_id)         REFERENCES dbo.addas(adda_id),
  CONSTRAINT FK_sale_returns_user    FOREIGN KEY (created_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT FK_sale_returns_upd     FOREIGN KEY (updated_by)      REFERENCES dbo.users(user_id)
);
CREATE INDEX IX_sale_returns_date     ON dbo.sale_returns(return_date);
CREATE INDEX IX_sale_returns_customer ON dbo.sale_returns(customer_id, return_date);
CREATE INDEX IX_sale_returns_no       ON dbo.sale_returns(bill_no);
GO

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
GO
-- USED BY: Sale Return screen; TASK-12's "articles previously bought"
-- dropdown reads sale_bill_items JOIN sale_bills for the chosen customer
-- (no column of its own needed here); on confirm, posts Debit SALES /
-- Credit CUSTOMER BA and writes positive SALE_RETURN stock_movements rows.

/* ----------------------------------------------------------------------------
   dbo.draft_sale_returns / dbo.draft_sale_return_items
   WHAT:  Draft mirror of sale_returns (§5.6.2).
   WHY:   Inverse of draft_sale_bills — saving a draft return RESTORES stock
          (anticipating the return), deleting it DEDUCTS stock back out (as
          if it never happened). Confirming copies into
          sale_returns/sale_return_items and deletes the draft.
---------------------------------------------------------------------------- */
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
  updated_by       INT           NULL,
  created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_dsr_created DEFAULT (SYSUTCDATETIME()),
  updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_dsr_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_sale_returns          PRIMARY KEY (draft_id),
  CONSTRAINT FK_draft_sale_returns_store    FOREIGN KEY (store_id)        REFERENCES dbo.stores(store_id) ON DELETE SET NULL,
  CONSTRAINT FK_draft_sale_returns_cust     FOREIGN KEY (customer_id)     REFERENCES dbo.customers(customer_id),
  CONSTRAINT FK_draft_sale_returns_subcust  FOREIGN KEY (sub_customer_id) REFERENCES dbo.sub_customers(sub_customer_id),
  CONSTRAINT FK_draft_sale_returns_adda     FOREIGN KEY (adda_id)         REFERENCES dbo.addas(adda_id),
  CONSTRAINT FK_draft_sale_returns_user     FOREIGN KEY (created_by)      REFERENCES dbo.users(user_id),
  CONSTRAINT FK_draft_sale_returns_upd      FOREIGN KEY (updated_by)      REFERENCES dbo.users(user_id)
);
CREATE INDEX IX_draft_sale_returns_date     ON dbo.draft_sale_returns(return_date);
CREATE INDEX IX_draft_sale_returns_customer ON dbo.draft_sale_returns(customer_id, return_date);
CREATE INDEX IX_draft_sale_returns_no       ON dbo.draft_sale_returns(bill_no);
GO

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
GO
-- USED BY: "Draft/Dummy Sale Return" screen, same save/delete/confirm
-- pattern as draft_sale_bills but with stock restore/deduct reversed.

/* ============================================================================
   7. PURCHASES — raw materials from vendors
   Purchases never touch finished-goods (pairs) stock (§2 decision 2) — they
   feed the separate vendor_stock_movements ledger in material units.
   ============================================================================ */

/* ----------------------------------------------------------------------------
   dbo.purchases
   WHAT:  A confirmable raw-material purchase document (TASK-01), same
          Confirmed/Draft pattern as Sale Bill. Confirming writes ledger
          entries AND vendor-stock movements in one transaction.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.purchases (
  purchase_id   INT IDENTITY(1,1) NOT NULL,
  purchase_date DATE          NOT NULL,
  vendor_id     INT           NOT NULL,
  bill_no       VARCHAR(30)   NULL,                           -- vendor's own invoice number
  remarks       NVARCHAR(500) NULL,
  total_value   DECIMAL(14,2) NOT NULL CONSTRAINT DF_pur_total  DEFAULT (0),
  created_by    INT           NULL,
  updated_by    INT           NULL,
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_pur_created DEFAULT (SYSUTCDATETIME()),
  updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_pur_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_purchases        PRIMARY KEY (purchase_id),
  CONSTRAINT FK_purchases_vendor FOREIGN KEY (vendor_id)  REFERENCES dbo.vendors(vendor_id),
  CONSTRAINT FK_purchases_user   FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_purchases_upd    FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id)
);
CREATE INDEX IX_purchases_date   ON dbo.purchases(purchase_date);
CREATE INDEX IX_purchases_vendor ON dbo.purchases(vendor_id, purchase_date);
GO
-- USED BY: Purchase screen (TASK-01); on confirm posts Debit PURCHASES
-- chart account / Credit VENDOR BA, and writes positive PURCHASE
-- vendor_stock_movements rows (posting matrix §6).

/* ----------------------------------------------------------------------------
   dbo.purchase_items
   WHAT:  Line items of a purchase. References materials — the user types
          any new name, auto-created on save (§4.3).
---------------------------------------------------------------------------- */
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
GO
-- USED BY: Purchase line-item grid; on confirm, each row writes one
-- positive PURCHASE dbo.vendor_stock_movements row keyed on
-- (vendor_id, material_id, unit).

/* ----------------------------------------------------------------------------
   dbo.draft_purchases / dbo.draft_purchase_items
   WHAT:  Pure scratch mirror of purchases/purchase_items — own table, not a
          status value on the real table (post-v4.3). Unlike draft_sale_bills,
          saving/deleting a draft purchase has ZERO effect on
          vendor_stock_movements: nothing physically arrives before a
          purchase is actually recorded, so there is no eager stock effect to
          apply or reverse. Confirming inserts into purchases/purchase_items
          and posts (ledger + vendor stock) in one step, then deletes the
          draft rows — same "create+post atomically" pattern as
          draftSaleBills.confirm.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.draft_purchases (
  draft_id      INT IDENTITY(1,1) NOT NULL,
  purchase_date DATE          NOT NULL,
  vendor_id     INT           NOT NULL,
  bill_no       VARCHAR(30)   NULL,
  remarks       NVARCHAR(500) NULL,
  total_value   DECIMAL(14,2) NOT NULL CONSTRAINT DF_dpur_total   DEFAULT (0),
  created_by    INT           NULL,
  updated_by    INT           NULL,
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_dpur_created DEFAULT (SYSUTCDATETIME()),
  updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_dpur_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_purchases        PRIMARY KEY (draft_id),
  CONSTRAINT FK_draft_purchases_vendor FOREIGN KEY (vendor_id)  REFERENCES dbo.vendors(vendor_id),
  CONSTRAINT FK_draft_purchases_user   FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_draft_purchases_upd    FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id)
);
CREATE INDEX IX_draft_purchases_date   ON dbo.draft_purchases(purchase_date);
CREATE INDEX IX_draft_purchases_vendor ON dbo.draft_purchases(vendor_id, purchase_date);
GO

CREATE TABLE dbo.draft_purchase_items (
  item_id        INT IDENTITY(1,1) NOT NULL,
  draft_id       INT           NOT NULL,
  material_id    INT           NOT NULL,
  unit           NVARCHAR(30)  NOT NULL,
  quantity       DECIMAL(14,3) NOT NULL,
  weight         DECIMAL(14,3) NULL,
  price_per_unit DECIMAL(12,2) NOT NULL,
  total_price    DECIMAL(14,2) NOT NULL,
  line_no        INT           NOT NULL CONSTRAINT DF_dpui_line    DEFAULT (1),
  created_at     DATETIME2(0)  NOT NULL CONSTRAINT DF_dpui_created DEFAULT (SYSUTCDATETIME()),
  updated_at     DATETIME2(0)  NOT NULL CONSTRAINT DF_dpui_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_purchase_items          PRIMARY KEY (item_id),
  CONSTRAINT FK_draft_purchase_items_draft    FOREIGN KEY (draft_id)    REFERENCES dbo.draft_purchases(draft_id) ON DELETE CASCADE,
  CONSTRAINT FK_draft_purchase_items_material FOREIGN KEY (material_id) REFERENCES dbo.materials(material_id),
  CONSTRAINT CK_draft_purchase_items_qty      CHECK (quantity > 0),
  CONSTRAINT CK_draft_purchase_items_price    CHECK (price_per_unit >= 0)
);
CREATE INDEX IX_draft_purchase_items_draft    ON dbo.draft_purchase_items(draft_id);
CREATE INDEX IX_draft_purchase_items_material ON dbo.draft_purchase_items(material_id);
GO

/* ----------------------------------------------------------------------------
   dbo.purchase_returns / dbo.purchase_return_items
   WHAT:  Purchase Return, its own dedicated page/tables mirroring Sale
          Return exactly (§10 gap 1).
---------------------------------------------------------------------------- */
CREATE TABLE dbo.purchase_returns (
  return_id   INT IDENTITY(1,1) NOT NULL,
  return_date DATE          NOT NULL,
  vendor_id   INT           NOT NULL,
  bill_no     VARCHAR(30)   NULL,
  remarks     NVARCHAR(500) NULL,                             -- return reason
  total_value DECIMAL(14,2) NOT NULL CONSTRAINT DF_pret_total  DEFAULT (0),
  created_by  INT           NULL,
  updated_by  INT           NULL,
  created_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_pret_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_pret_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_purchase_returns        PRIMARY KEY (return_id),
  CONSTRAINT FK_purchase_returns_vendor FOREIGN KEY (vendor_id)  REFERENCES dbo.vendors(vendor_id),
  CONSTRAINT FK_purchase_returns_user   FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_purchase_returns_upd    FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id)
);
CREATE INDEX IX_purchase_returns_date   ON dbo.purchase_returns(return_date);
CREATE INDEX IX_purchase_returns_vendor ON dbo.purchase_returns(vendor_id, return_date);
GO

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
GO
-- USED BY: Purchase Return screen; on confirm posts Debit VENDOR BA /
-- Credit PURCHASES chart account, and writes negative PURCHASE_RETURN
-- vendor_stock_movements rows.

/* ----------------------------------------------------------------------------
   dbo.draft_purchase_returns / dbo.draft_purchase_return_items
   WHAT:  Pure scratch mirror of purchase_returns/purchase_return_items, same
          rationale as draft_purchases above — zero effect on
          vendor_stock_movements until confirmed.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.draft_purchase_returns (
  draft_id    INT IDENTITY(1,1) NOT NULL,
  return_date DATE          NOT NULL,
  vendor_id   INT           NOT NULL,
  bill_no     VARCHAR(30)   NULL,
  remarks     NVARCHAR(500) NULL,
  total_value DECIMAL(14,2) NOT NULL CONSTRAINT DF_dpret_total   DEFAULT (0),
  created_by  INT           NULL,
  updated_by  INT           NULL,
  created_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_dpret_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_dpret_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_purchase_returns        PRIMARY KEY (draft_id),
  CONSTRAINT FK_draft_purchase_returns_vendor FOREIGN KEY (vendor_id)  REFERENCES dbo.vendors(vendor_id),
  CONSTRAINT FK_draft_purchase_returns_user   FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_draft_purchase_returns_upd    FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id)
);
CREATE INDEX IX_draft_purchase_returns_date   ON dbo.draft_purchase_returns(return_date);
CREATE INDEX IX_draft_purchase_returns_vendor ON dbo.draft_purchase_returns(vendor_id, return_date);
GO

CREATE TABLE dbo.draft_purchase_return_items (
  item_id        INT IDENTITY(1,1) NOT NULL,
  draft_id       INT           NOT NULL,
  material_id    INT           NOT NULL,
  unit           NVARCHAR(30)  NOT NULL,
  quantity       DECIMAL(14,3) NOT NULL,
  weight         DECIMAL(14,3) NULL,
  price_per_unit DECIMAL(12,2) NOT NULL,
  total_price    DECIMAL(14,2) NOT NULL,
  line_no        INT           NOT NULL CONSTRAINT DF_dpri_line    DEFAULT (1),
  created_at     DATETIME2(0)  NOT NULL CONSTRAINT DF_dpri_created DEFAULT (SYSUTCDATETIME()),
  updated_at     DATETIME2(0)  NOT NULL CONSTRAINT DF_dpri_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_purchase_return_items          PRIMARY KEY (item_id),
  CONSTRAINT FK_draft_purchase_return_items_draft    FOREIGN KEY (draft_id)    REFERENCES dbo.draft_purchase_returns(draft_id) ON DELETE CASCADE,
  CONSTRAINT FK_draft_purchase_return_items_material FOREIGN KEY (material_id) REFERENCES dbo.materials(material_id),
  CONSTRAINT CK_draft_purchase_return_items_qty      CHECK (quantity > 0),
  CONSTRAINT CK_draft_purchase_return_items_price    CHECK (price_per_unit >= 0)
);
CREATE INDEX IX_draft_purchase_return_items_draft    ON dbo.draft_purchase_return_items(draft_id);
CREATE INDEX IX_draft_purchase_return_items_material ON dbo.draft_purchase_return_items(material_id);
GO

/* ============================================================================
   8. MONEY — receipts, expenses, banks, cheques
   Cheque data lives in its own tables (bank_accounts, cheques) instead of
   being duplicated across receipts/expenses — a cheque is one row with one
   shared lifecycle. See design doc §5.8 for the full posting-resolution
   rules (CASH/ONLINE/CHEQUE) and the bounce cascade.
   ============================================================================ */

/* ----------------------------------------------------------------------------
   dbo.bank_accounts
   WHAT:  A real party table, same pattern as vendors/customers — own PK
          (bank_id) plus a unique ba_id into business_accounts.
   WHY:   §12 Q3/Q9 resolution: posting now has a real chart account to
          resolve to PER bank, not one blended "Bank" figure. Auto-created
          under the seeded "Cash at Banks" chart account when added.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.bank_accounts (
  bank_id    INT IDENTITY(1,1) NOT NULL,
  name       NVARCHAR(100) NOT NULL,                          -- e.g. 'Bank Alfalah A/C - 0124'
  account_no NVARCHAR(50)  NULL,
  branch     NVARCHAR(100) NULL,
  ba_id      INT           NULL,   -- auto-created under the BANK ACCOUNTS chart account (CODES.BANK_ACCOUNTS, 100003) on bank create
  is_active  BIT          NOT NULL CONSTRAINT DF_bankacc_active  DEFAULT (1),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_bankacc_created DEFAULT (SYSUTCDATETIME()),
  updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_bankacc_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_bank_accounts PRIMARY KEY (bank_id),
  -- No UNIQUE(name): two bank accounts can share a bank name with a different account_no (e.g.
  -- two "Meezan Bank" accounts); duplicate handling is name+account_no, service-layer only.
  CONSTRAINT FK_bank_accounts_ba   FOREIGN KEY (ba_id) REFERENCES dbo.business_accounts(ba_id)
);
-- Filtered unique: one bank account per business account, but many may await backfill (NULL).
CREATE UNIQUE INDEX UQ_bank_accounts_ba ON dbo.bank_accounts(ba_id) WHERE ba_id IS NOT NULL;
GO
-- USED BY: Bank dropdown on Receipt/Expense forms when payment_mode = 'ONLINE'
-- (receipts.bank_id, expenses.bank_id); dbo.cheques.bank_id (which bank a
-- cheque is deposited to).

/* ----------------------------------------------------------------------------
   dbo.cheques
   WHAT:  One row per physical cheque — its full shared lifecycle
          (PENDING -> DEPOSITED -> CLEARED, PENDING -> PARTIALLY_ENDORSED ->
          ENDORSED, BOUNCED reachable from any state, §2 decision 10).
   WHY:   receipts.cheque_id and expenses.cheque_id both point at the same
          row here — that is what makes endorsement (paying a vendor with a
          cheque already on hand) a single shared record instead of two
          disconnected copies.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.cheques (
  cheque_id            INT IDENTITY(1,1) NOT NULL,
  bank_id              INT           NULL,                     -- which bank_accounts row the cheque deposits to
  receipt_id           INT           NOT NULL,                 -- the receipt that brought this cheque in
  cheque_no            VARCHAR(50)   NOT NULL,
  cheque_date          DATE          NOT NULL,                  -- date written on the cheque
  cheque_received_date DATE          NULL,                      -- date WentoX physically received it
  cheque_status        VARCHAR(20)   NOT NULL CONSTRAINT DF_cheques_status DEFAULT ('PENDING'),
  bounced_date         DATE          NULL,                      -- §13/§6.1: the date every reversal is posted on
  -- RETURNED is deliberately distinct from BOUNCED — same reverse-never-delete mechanics (customer
  -- credited back, any allocations reversed), but for a reason that is NOT a bank bounce (e.g. a
  -- due-date issue) — return_reason is freeform, always shown alongside the cheque in the ledger.
  returned_date        DATE          NULL,
  return_reason        NVARCHAR(500) NULL,
  created_at           DATETIME2(0)  NOT NULL CONSTRAINT DF_cheques_created DEFAULT (SYSUTCDATETIME()),
  updated_at           DATETIME2(0)  NOT NULL CONSTRAINT DF_cheques_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_cheques         PRIMARY KEY (cheque_id),
  CONSTRAINT FK_cheques_bank    FOREIGN KEY (bank_id)    REFERENCES dbo.bank_accounts(bank_id),
  -- FK to receipts is added by ALTER after dbo.receipts exists (circular pair)
  CONSTRAINT CK_cheques_status  CHECK (cheque_status IN
        ('PENDING','DEPOSITED','ENDORSED','PARTIALLY_ENDORSED','CLEARED','BOUNCED','RETURNED')),
  -- bounced_date exists if and only if the cheque actually bounced (moved here from `receipts`, v4.1)
  CONSTRAINT CK_cheques_bounced CHECK (
        (bounced_date IS NULL     AND cheque_status <> 'BOUNCED')
     OR (bounced_date IS NOT NULL AND cheque_status =  'BOUNCED')),
  CONSTRAINT CK_cheques_returned CHECK (
        (returned_date IS NULL     AND cheque_status <> 'RETURNED')
     OR (returned_date IS NOT NULL AND cheque_status =  'RETURNED'))
);
-- One cheque per receipt — the app-level invariant cheques.repository.js#insert() relies on,
-- now DB-enforced too (defense in depth, found missing during Module 4.2's debugger review).
CREATE UNIQUE INDEX UQ_cheques_receipt ON dbo.cheques(receipt_id);
CREATE INDEX IX_cheques_no          ON dbo.cheques(cheque_no);              -- join key from receipts/expenses
CREATE INDEX IX_cheques_endorsable  ON dbo.cheques(cheque_status)           -- Expense screen's cheque picker
       WHERE cheque_status IN ('PENDING','DEPOSITED');
CREATE INDEX IX_cheques_due         ON dbo.cheques(cheque_date)             -- §12 cheque-due alerts
       WHERE cheque_status IN ('PENDING','PARTIALLY_ENDORSED');
GO
-- NOTE — insert order: cheques.receipt_id and receipts.cheque_id reference
-- each other. A cheque receipt is written in two steps inside one
-- transaction: (1) INSERT receipts with cheque_id NULL, (2) INSERT cheques
-- pointing back at it, then UPDATE receipts SET cheque_id = ...
-- USED BY: Cheque-due alert (amber 7 days before cheque_date, red once
-- passed — reads IX_cheques_due); Expense screen's cheque picker (reads
-- IX_cheques_endorsable, only PENDING/DEPOSITED cheques may be endorsed);
-- Bounced-cheque flow (flips cheque_status='BOUNCED', sets bounced_date,
-- cascades to cheque_allocations — see §11 below).

/* ----------------------------------------------------------------------------
   dbo.receipts
   WHAT:  Money received from a customer ("Jamma"). commission is posted as
          a separate credit ledger row (§7), never folded into amount.
   WHY:   Which chart account a receipt posts to depends on payment_mode
          (§12 Q3, resolved by the CK_receipts_bank/CK_receipts_cheque
          checks below): CASH always posts to the seeded CASH IN HAND
          account; ONLINE requires bank_id and posts to that bank's own
          chart account; CHEQUE resolves its bank through
          cheque_id -> cheques.bank_id instead, so bank_id stays NULL.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.receipts (
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
  updated_by   INT           NULL,
  created_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_rec_created DEFAULT (SYSUTCDATETIME()),
  updated_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_rec_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_receipts        PRIMARY KEY (receipt_id),
  CONSTRAINT FK_receipts_cust   FOREIGN KEY (customer_id) REFERENCES dbo.customers(customer_id),
  CONSTRAINT FK_receipts_cheque FOREIGN KEY (cheque_id)   REFERENCES dbo.cheques(cheque_id),
  CONSTRAINT FK_receipts_bank   FOREIGN KEY (bank_id)     REFERENCES dbo.bank_accounts(bank_id),
  CONSTRAINT FK_receipts_user   FOREIGN KEY (created_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT FK_receipts_upd    FOREIGN KEY (updated_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT CK_receipts_amount CHECK (amount > 0),
  CONSTRAINT CK_receipts_comm   CHECK (commission >= 0),
  CONSTRAINT CK_receipts_mode   CHECK (payment_mode IN ('CASH','CHEQUE','ONLINE')),
  CONSTRAINT CK_receipts_status CHECK (status IN ('CONFIRMED','DRAFT')),
  -- A non-cheque receipt must never carry a cheque_id. A CHEQUE receipt's cheque_id is allowed to
  -- be NULL only momentarily, inside the insert transaction, before the linking UPDATE below runs
  -- (SQL Server checks CHECK constraints per-statement, not deferred to commit, so a stricter
  -- "cheque_id IS NOT NULL whenever payment_mode='CHEQUE'" version can never be satisfied by the
  -- two-step insert this note itself describes). The "every CHEQUE receipt eventually gets a real
  -- cheque_id" guarantee is enforced at the application layer instead — see receipts.service.js.
  CONSTRAINT CK_receipts_cheque CHECK (
        (payment_mode <> 'CHEQUE' AND cheque_id IS NULL)
     OR (payment_mode =  'CHEQUE')),
  CONSTRAINT CK_receipts_bank   CHECK (
        (payment_mode = 'ONLINE' AND bank_id IS NOT NULL)
     OR (payment_mode <> 'ONLINE' AND bank_id IS NULL))
);
CREATE INDEX IX_receipts_date     ON dbo.receipts(receipt_date);
CREATE INDEX IX_receipts_customer ON dbo.receipts(customer_id, receipt_date);
GO

/* --------------------------------------------------------------------------
   Deferred FK: dbo.cheques.receipt_id -> dbo.receipts.receipt_id

   cheques and receipts reference each other (cheques.receipt_id and
   receipts.cheque_id), so one side cannot be declared inline — whichever
   table is created first would reference a table that does not exist yet and
   the script would abort. Added here, once both exist.
-------------------------------------------------------------------------- */
ALTER TABLE dbo.cheques
  ADD CONSTRAINT FK_cheques_receipt FOREIGN KEY (receipt_id)
      REFERENCES dbo.receipts(receipt_id);
GO
-- USED BY: Receipt (Jamma) entry screen; Customer Account Ledger (JOIN back
-- to dbo.customers via customer_id); on confirm posts two ledger rows —
-- Debit CASH/BANK / Credit CUSTOMER BA for the amount, and a separate
-- Debit COMMISSION ALLOWED / Credit CUSTOMER BA row
-- (source_type='COMMISSION') for the commission, per the §7 worked example.

/* ----------------------------------------------------------------------------
   dbo.draft_receipts
   WHAT:  Unconfirmed receipt, field-for-field mirror of receipts.
   WHY:   Same TBD/dummy pattern as draft_sale_bills, but a draft
          receipt/expense has NO stock effect to reverse — purely deferred
          ledger posting.
---------------------------------------------------------------------------- */
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
  updated_by   INT           NULL,
  created_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_drec_created DEFAULT (SYSUTCDATETIME()),
  updated_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_drec_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_receipts        PRIMARY KEY (draft_id),
  CONSTRAINT FK_draft_receipts_cust   FOREIGN KEY (customer_id) REFERENCES dbo.customers(customer_id),
  CONSTRAINT FK_draft_receipts_cheque FOREIGN KEY (cheque_id)   REFERENCES dbo.cheques(cheque_id),
  CONSTRAINT FK_draft_receipts_bank   FOREIGN KEY (bank_id)     REFERENCES dbo.bank_accounts(bank_id),
  CONSTRAINT FK_draft_receipts_user   FOREIGN KEY (created_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT FK_draft_receipts_upd    FOREIGN KEY (updated_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT CK_draft_receipts_amount CHECK (amount > 0),
  CONSTRAINT CK_draft_receipts_mode   CHECK (payment_mode IN ('CASH','CHEQUE','ONLINE'))
);
CREATE INDEX IX_draft_receipts_date     ON dbo.draft_receipts(receipt_date);
CREATE INDEX IX_draft_receipts_customer ON dbo.draft_receipts(customer_id, receipt_date);
GO
-- USED BY: "Draft/Dummy Receipt" screen; confirming copies the row into
-- receipts and deletes the draft — no stock or ledger side effects until then.

/* ----------------------------------------------------------------------------
   dbo.expenses
   WHAT:  Money paid out ("Kharch"). Also the vendor-payment path (§10 gap 2)
          — ba_id can point at either a plain expense head or a vendor's
          business account, resolved through vendors.ba_id.
   WHY:   cheque_id here is the ENDORSEMENT path: paying a vendor with a
          cheque already on hand (not a fresh cheque) sets expenses.cheque_id
          to that existing cheque row, and application logic flips
          cheques.cheque_status to 'ENDORSED' in the same transaction.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.expenses (
  expense_id   INT IDENTITY(1,1) NOT NULL,
  expense_date DATE          NOT NULL,
  ba_id        INT           NOT NULL,                        -- expense head / vendor account
  amount       DECIMAL(14,2) NOT NULL,
  -- VARCHAR(20), not (10) — 'CHEQUE_ENDORSED'/'CHEQUE_ISSUED' are 15/13 chars, wider than the old
  -- single-word modes this column was originally sized for (see 005_expenses_payment_mode_width.sql).
  payment_mode VARCHAR(20)   NOT NULL,
  details      NVARCHAR(200) NULL,
  cheque_id    INT           NULL,                             -- CHEQUE_ENDORSED only: the received cheque being handed on
  bank_id      INT           NULL,                             -- ONLINE and CHEQUE_ISSUED: which of our accounts it leaves
  -- CHEQUE_ISSUED only: the cheque WE wrote. Deliberately NOT a row in
  -- dbo.cheques -- that table is for cheques RECEIVED (it requires a
  -- receipt_id, and its value sits in CHEQUES IN HAND as an asset). A cheque we
  -- write is the opposite: money leaving a bank. Since the bank is debited the
  -- day it is written (payroll-style deduct-on-write, cash_and_bank.md SS6),
  -- there is no pending state to model and no table to add -- just the number
  -- and date, for the record and for tracing it on a statement later.
  issued_cheque_no   VARCHAR(50) NULL,
  issued_cheque_date DATE        NULL,
  remarks      NVARCHAR(500) NULL,
  status       VARCHAR(10)   NOT NULL CONSTRAINT DF_exp_status  DEFAULT ('CONFIRMED'),
  created_by   INT           NULL,
  updated_by   INT           NULL,
  created_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_exp_created DEFAULT (SYSUTCDATETIME()),
  updated_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_exp_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_expenses        PRIMARY KEY (expense_id),
  CONSTRAINT FK_expenses_ba     FOREIGN KEY (ba_id)      REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_expenses_cheque FOREIGN KEY (cheque_id)  REFERENCES dbo.cheques(cheque_id),
  CONSTRAINT FK_expenses_bank   FOREIGN KEY (bank_id)    REFERENCES dbo.bank_accounts(bank_id),
  CONSTRAINT FK_expenses_user   FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_expenses_upd    FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_expenses_amount CHECK (amount > 0),
  -- 'CHEQUE' split in two, because the two credit DIFFERENT accounts:
  --   CHEQUE_ENDORSED  hand on a customer's cheque   -> Cr CHEQUES IN HAND
  --   CHEQUE_ISSUED    write our own cheque          -> Cr the selected bank
  -- Receipts keep a plain 'CHEQUE': you can only ever RECEIVE someone else's,
  -- so there is nothing to disambiguate on that side.
  CONSTRAINT CK_expenses_mode   CHECK (payment_mode IN
        ('CASH','CHEQUE_ENDORSED','CHEQUE_ISSUED','ONLINE')),
  CONSTRAINT CK_expenses_status CHECK (status IN ('CONFIRMED','DRAFT')),
  -- Each mode carries exactly the identity it needs and nothing it does not.
  CONSTRAINT CK_expenses_payment CHECK (
        (payment_mode = 'CASH'
             AND bank_id IS NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'ONLINE'
             AND bank_id IS NOT NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'CHEQUE_ENDORSED'
             AND cheque_id IS NOT NULL AND bank_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'CHEQUE_ISSUED'
             AND bank_id IS NOT NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NOT NULL AND issued_cheque_date IS NOT NULL))
);
CREATE INDEX IX_expenses_date ON dbo.expenses(expense_date);
CREATE INDEX IX_expenses_ba   ON dbo.expenses(ba_id, expense_date);
GO
-- USED BY: Expense (Kharch) entry screen, including the vendor-payment
-- flow (pick a vendor -> resolves to vendors.ba_id -> expenses.ba_id);
-- on confirm posts Debit expense-head/vendor BA / Credit CASH or BANK; for
-- an endorsement, also flips the referenced cheques.cheque_status.

/* ----------------------------------------------------------------------------
   dbo.draft_expenses
   WHAT:  Unconfirmed expense, field-for-field mirror of expenses.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.draft_expenses (
  draft_id     INT IDENTITY(1,1) NOT NULL,
  expense_date DATE          NOT NULL,
  ba_id        INT           NOT NULL,
  amount       DECIMAL(14,2) NOT NULL,
  payment_mode VARCHAR(20)   NOT NULL,
  details      NVARCHAR(200) NULL,
  cheque_id    INT           NULL,
  bank_id      INT           NULL,
  issued_cheque_no   VARCHAR(50) NULL,
  issued_cheque_date DATE        NULL,
  remarks      NVARCHAR(500) NULL,
  -- Set right after confirm() creates the real expense, BEFORE attempting to post it — so a later
  -- confirm() retry (e.g. the user clicking "Confirm" again after a failed attempt) resumes
  -- against this SAME expense_id (whose post() is idempotent for CHEQUE_ENDORSED, migration 006)
  -- instead of minting a second expense and double-disposing the cheque. Only meaningful for
  -- CHEQUE_ENDORSED, whose post() is not a single atomic transaction — see draftExpenses.service.js.
  pending_expense_id INT NULL,
  created_by   INT           NULL,
  updated_by   INT           NULL,
  created_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_dexp_created DEFAULT (SYSUTCDATETIME()),
  updated_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_dexp_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_draft_expenses        PRIMARY KEY (draft_id),
  CONSTRAINT FK_draft_expenses_ba     FOREIGN KEY (ba_id)      REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_draft_expenses_cheque FOREIGN KEY (cheque_id)  REFERENCES dbo.cheques(cheque_id),
  CONSTRAINT FK_draft_expenses_bank   FOREIGN KEY (bank_id)    REFERENCES dbo.bank_accounts(bank_id),
  CONSTRAINT FK_draft_expenses_pending_expense FOREIGN KEY (pending_expense_id) REFERENCES dbo.expenses(expense_id),
  CONSTRAINT FK_draft_expenses_user   FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_draft_expenses_upd    FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_draft_expenses_amount CHECK (amount > 0),
  -- 'CHEQUE' split the same way as expenses (§6) — kept in sync via migration
  -- 004_draft_expenses_parity.sql (this table had drifted out of parity with expenses).
  CONSTRAINT CK_draft_expenses_mode   CHECK (payment_mode IN
        ('CASH','CHEQUE_ENDORSED','CHEQUE_ISSUED','ONLINE')),
  CONSTRAINT CK_draft_expenses_payment CHECK (
        (payment_mode = 'CASH'
             AND bank_id IS NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'ONLINE'
             AND bank_id IS NOT NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'CHEQUE_ENDORSED'
             AND cheque_id IS NOT NULL AND bank_id IS NULL
             AND issued_cheque_no IS NULL AND issued_cheque_date IS NULL)
     OR (payment_mode = 'CHEQUE_ISSUED'
             AND bank_id IS NOT NULL AND cheque_id IS NULL
             AND issued_cheque_no IS NOT NULL AND issued_cheque_date IS NOT NULL))
);
CREATE INDEX IX_draft_expenses_date ON dbo.draft_expenses(expense_date);
CREATE INDEX IX_draft_expenses_ba   ON dbo.draft_expenses(ba_id, expense_date);
GO
-- USED BY: "Draft/Dummy Expense" screen; confirming copies into expenses
-- and deletes the draft.

/* ============================================================================
   9. DERIVED-STATE LEDGERS
   ============================================================================ */

/* ----------------------------------------------------------------------------
   dbo.stock_movements
   WHAT:  Finished-goods (pairs) movement ledger, keyed on variant_id. This
          IS the Product Ledger (TASK-02) — no stored running-balance
          column anywhere; current stock of a variant is SUM(qty_pairs)
          over its rows (§4.1).
   WHY:   PRODUCTION rows double as the production log — they keep the raw
          user input (input_qty + input_unit) and a packing snapshot, while
          qty_pairs always stores the normalised total. Carton/extra
          display is derived: cartons = total_pairs / packing,
          extra = total_pairs % packing.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.stock_movements (
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
  updated_by    INT           NULL,
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_sm_created DEFAULT (SYSUTCDATETIME()),
  updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_sm_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_stock_movements         PRIMARY KEY (movement_id),
  CONSTRAINT FK_stock_movements_variant FOREIGN KEY (variant_id) REFERENCES dbo.article_colors(variant_id),
  CONSTRAINT FK_stock_movements_user    FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_stock_movements_upd     FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_stock_movements_type    CHECK (movement_type IN
        ('OPENING','ADJUSTMENT','PRODUCTION','SALE','SALE_RETURN')),   -- deliberately no PURCHASE, see §2 decision 2
  CONSTRAINT CK_stock_movements_unit    CHECK (input_unit IS NULL OR input_unit IN ('CARTONS','PAIRS')),
  CONSTRAINT CK_stock_movements_sign    CHECK (
        (movement_type = 'SALE'                              AND qty_pairs < 0)
     OR (movement_type IN ('PRODUCTION','SALE_RETURN')       AND qty_pairs > 0)
     OR (movement_type IN ('OPENING','ADJUSTMENT')))
);
CREATE INDEX IX_stock_movements_variant ON dbo.stock_movements(variant_id, movement_date);
CREATE INDEX IX_stock_movements_date    ON dbo.stock_movements(movement_date);
CREATE INDEX IX_stock_movements_source  ON dbo.stock_movements(source_type, source_id);
GO
-- USED BY: Current Stock page — current on-hand for a variant:
--   SELECT variant_id, SUM(qty_pairs) AS on_hand
--   FROM dbo.stock_movements GROUP BY variant_id HAVING SUM(qty_pairs) <> 0;
-- Product Ledger (TASK-02) — the same table filtered WHERE variant_id = @v
-- ORDER BY movement_date; written to by Sale Bill confirm (negative SALE),
-- Sale Return confirm (positive SALE_RETURN), and the Products "Add" dialog
-- (positive PRODUCTION with input_qty/input_unit/packing snapshot).

/* ----------------------------------------------------------------------------
   dbo.vendor_stock_movements
   WHAT:  Raw-material movement ledger, keyed on vendor + material + unit —
          a second, independent ledger in material units (§4.2), NOT mixed
          into stock_movements because that table is pairs-only.
   WHY:   Reduced two ways (§2 decision 5): a Purchase Return
          (PURCHASE_RETURN rows), or a manual "this much has been used"
          reduction against a vendor's stock line (CONSUMPTION rows,
          source_type NULL).
---------------------------------------------------------------------------- */
CREATE TABLE dbo.vendor_stock_movements (
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
  updated_by    INT           NULL,
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_vsm_created DEFAULT (SYSUTCDATETIME()),
  updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_vsm_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_vendor_stock_movements          PRIMARY KEY (movement_id),
  CONSTRAINT FK_vendor_stock_movements_vendor   FOREIGN KEY (vendor_id)   REFERENCES dbo.vendors(vendor_id),
  CONSTRAINT FK_vendor_stock_movements_material FOREIGN KEY (material_id) REFERENCES dbo.materials(material_id),
  CONSTRAINT FK_vendor_stock_movements_user     FOREIGN KEY (created_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT FK_vendor_stock_movements_upd      FOREIGN KEY (updated_by)  REFERENCES dbo.users(user_id),
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
GO
-- USED BY: Vendor Stock sub-page (Stock page, §14) — exactly this query:
--   SELECT v.name AS vendor, m.name AS material, vsm.unit, SUM(vsm.qty) AS on_hand
--   FROM dbo.vendor_stock_movements AS vsm
--   JOIN dbo.vendors   AS v ON v.vendor_id   = vsm.vendor_id
--   JOIN dbo.materials AS m ON m.material_id = vsm.material_id
--   GROUP BY v.name, m.name, vsm.unit
--   HAVING SUM(vsm.qty) <> 0;
-- Written to by Purchase confirm (positive PURCHASE), Purchase Return
-- confirm (negative PURCHASE_RETURN), and the manual reduction form
-- (negative CONSUMPTION, source_type NULL).

/* ----------------------------------------------------------------------------
   dbo.ledger_entries
   WHAT:  The double-entry journal. Every CONFIRMED document writes its rows
          here inside one transaction; unposting deletes them in one
          transaction (§4.4).
   WHY:   Uses two nullable FK columns (ac_id, ba_id) with a CHECK that
          exactly one is populated, instead of the old polymorphic
          account_type+account_id pair that SQL Server could not enforce
          with a real foreign key. Same flexibility, real referential
          integrity — a typo can no longer point a ledger row at a
          nonexistent account.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.ledger_entries (
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
         'PURCHASE','PURCHASE_RETURN','CHEQUE_ALLOCATION','OPENING',
         -- Payroll accrual (payroll doc SS5-6). WAGE_RUN is the piece-rate
         -- side (Dr WAGES EXPENSE / Cr worker BA); SALARY_RUN is the monthly
         -- salary side (Dr SALARIES EXPENSE / Cr each salaried employee BA).
         -- Paying either is still an EXPENSE row, not a new type.
         'WAGE_RUN','SALARY_RUN',
         -- Money moved between OUR OWN accounts (cash_and_bank.md SS7).
         -- Dr destination / Cr source. It is neither income nor expenditure and
         -- MUST be excluded from every such total -- see dbo.transfers.
         'TRANSFER',
         -- One-sided manual adjustment against MISC_ADJUSTMENTS (Module 4b) -- see dbo.deposits.
         'DEPOSIT'))
);
CREATE INDEX IX_ledger_entries_ba     ON dbo.ledger_entries(ba_id, entry_date) WHERE ba_id IS NOT NULL;
CREATE INDEX IX_ledger_entries_ac     ON dbo.ledger_entries(ac_id, entry_date) WHERE ac_id IS NOT NULL;
CREATE INDEX IX_ledger_entries_source ON dbo.ledger_entries(source_type, source_id);
CREATE INDEX IX_ledger_entries_date   ON dbo.ledger_entries(entry_date);
GO
-- USED BY: Account Ledger / Business Accounts Ledger screens (JOIN to
-- business_accounts on ba_id, or chart_of_accounts on ac_id); Trial
-- Balance report (GROUP BY ac_id/ba_id, SUM(debit), SUM(credit)); every
-- confirmable document posts here per the Posting Matrix (design doc §6):
-- Sale Bill, Sale Return, Purchase, Purchase Return, Receipt (amount +
-- separate commission row), Expense, Cheque Allocation, and cheque-bounce
-- reversal legs. Opening balances are source_type='OPENING' rows dated
-- before the first real transaction (TASK-16 "Opening Balance" /
-- TASK-15 "Opening Cash").

/* ============================================================================
   10. CHEQUE ALERTS AND ENDORSEMENT
   Built in the frontend at Milestone 6 against a working AppContext — these
   two tables are required, not speculative.
   ============================================================================ */

/* ----------------------------------------------------------------------------
   dbo.cheque_allocations
   WHAT:  Where a received cheque's value gets disposed of (§13) —
          deposited to the bank, used to pay a vendor, or used to pay an
          expense head. Exactly one target column is set, matching
          disposition_type.
   WHY:   allocation_date is what the Cash Book uses to date the outflow —
          separate from the cheque's own cheque_date/receipt date.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.cheque_allocations (
  allocation_id      INT IDENTITY(1,1) NOT NULL,
  receipt_id         INT           NOT NULL,
  disposition_type   VARCHAR(20)   NOT NULL,                  -- DEPOSIT | VENDOR_PAYMENT | EXPENSE_PAYMENT
  target_vendor_id   INT           NULL,                      -- set only for VENDOR_PAYMENT
  target_ba_id       INT           NULL,                      -- set only for EXPENSE_PAYMENT
  -- Module 4.2: set only when this allocation was created by a CHEQUE_ENDORSED expense (via
  -- expenses.service.js#post() delegating to cheques.service.js#endorseToExpense()) rather than
  -- directly from the Cheques page. Lets post() detect "did THIS expense already create an
  -- allocation?" before retrying, so a failure between endorseToExpense()'s commit and the
  -- expense's own status flip can't cause a silent double-disposal on retry.
  expense_id         INT           NULL,
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
  CONSTRAINT FK_cheque_allocations_expense FOREIGN KEY (expense_id)       REFERENCES dbo.expenses(expense_id),
  CONSTRAINT FK_cheque_allocations_user    FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_cheque_allocations_upd     FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_cheque_allocations_amount  CHECK (amount > 0),
  CONSTRAINT CK_cheque_allocations_disp    CHECK (disposition_type IN
        ('DEPOSIT','VENDOR_PAYMENT','EXPENSE_PAYMENT')),
  -- exactly one target column set, and only the one matching the disposition.
  -- DEPOSIT still names NO target here, and that is deliberate: the bank a
  -- cheque is deposited into lives on dbo.cheques.bank_id, not on the
  -- allocation, because one cheque is never split across two banks. Whoever
  -- writes the deposit flow must set cheques.bank_id in the same transaction --
  -- without it the money leaves CHEQUES IN HAND and lands nowhere.
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
GO
-- USED BY: Cheque endorsement screen — DEPOSIT/VENDOR_PAYMENT/EXPENSE_PAYMENT
-- flows; Cash Book (dated by allocation_date, not receipt_date); the
-- bounced-cheque cascade flips every ACTIVE row for the bounced cheque's
-- receipt to REVERSED and writes counter ledger entries (§6.1
-- reverse-never-erase — nothing here is ever deleted, only reversed and
-- dated cheques.bounced_date, so a report printed before the bounce still
-- reconciles after it). NOTE: receipt_id still points at receipts, not
-- cheques directly — a receipt has at most one cheque, so the two are
-- equivalent; app code can join through either.

/* ----------------------------------------------------------------------------
   dbo.alert_dismissals
   WHAT:  Snooze/dismiss state for derived alerts (cheque-due today; the
          payment-overdue alert this was originally built for no longer
          exists, since due_date was removed from sale_bills/purchases —
          only the cheque-due alert survives). POST-v4.3: due_date was
          re-added to sale_bills (not purchases) for a planned notification
          feature (details TBD) — this table's PAYMENT_OVERDUE alert_key
          shape is kept ready for it, but that alert isn't wired up yet.
   WHY:   dismissed_until stays NULL in the current build (the UI dismisses
          permanently with a "Restore" action instead of a snooze); the
          column is kept for the eventual snooze without a later migration.
          user_id is kept for when dismissals become per-user, though they
          are global today.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.alert_dismissals (
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
GO
-- USED BY: Cheque-due alert banner — checks IX_alert_dismissals_key for a
-- matching 'CHEQUE_DUE:<receipt_id>' row before showing an amber/red badge
-- for a cheque due within 7 days / already past due
-- (sourced from dbo.cheques.cheque_date / cheque_status, not receipts).

/* ----------------------------------------------------------------------------
   dbo.transfers
   WHAT:  Money moved between WentoX's OWN accounts — cash banked, one bank to
          another, or a withdrawal to pay wages in cash.
   WHY:   This is neither a receipt nor an expense: nobody paid us and we paid
          nobody. Recording it as an expense-plus-receipt pair (the obvious
          shortcut) would inflate BOTH income and expenditure with money that
          never left the business, and every report built on those totals would
          read wrong.
   RULE:  A transfer must NEVER appear in an income or expense total. Cash Book,
          Sale Analysis and the expense reports all have to skip source_type
          'TRANSFER' explicitly. This is the easiest thing here to get wrong,
          because a transfer looks like a payment from every angle except the
          one that counts.
   NOTE:  from/to are business_accounts, not bank_accounts — cash is a business
          account too, and bank -> cash is likely the most common direction of
          all, since piece-rate workers are paid in cash.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.transfers (
  transfer_id   INT IDENTITY(1,1) NOT NULL,
  transfer_date DATE          NOT NULL,
  from_ba_id    INT           NOT NULL,
  to_ba_id      INT           NOT NULL,
  amount        DECIMAL(14,2) NOT NULL,
  remarks       NVARCHAR(500) NULL,
  status        VARCHAR(10)   NOT NULL CONSTRAINT DF_trf_status  DEFAULT ('CONFIRMED'),
  created_by    INT           NULL,
  updated_by    INT           NULL,
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_trf_created DEFAULT (SYSUTCDATETIME()),
  updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_trf_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_transfers        PRIMARY KEY (transfer_id),
  CONSTRAINT FK_transfers_from   FOREIGN KEY (from_ba_id) REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_transfers_to     FOREIGN KEY (to_ba_id)   REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_transfers_cby    FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_transfers_uby    FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_transfers_amount CHECK (amount > 0),
  CONSTRAINT CK_transfers_status CHECK (status IN ('CONFIRMED','DRAFT')),
  -- Moving money to the account it came from is a no-op that would still show
  -- as two ledger rows, so it is blocked rather than tolerated.
  CONSTRAINT CK_transfers_distinct CHECK (from_ba_id <> to_ba_id)
);
CREATE INDEX IX_transfers_date ON dbo.transfers(transfer_date);
CREATE INDEX IX_transfers_from ON dbo.transfers(from_ba_id, transfer_date);
CREATE INDEX IX_transfers_to   ON dbo.transfers(to_ba_id, transfer_date);
GO
-- USED BY: Transfer screen; every cash/bank balance (both sides); Cash Book.
-- LEDGERS AS: Dr to_ba_id / Cr from_ba_id, source_type 'TRANSFER'.

-- Module 4b: Deposit — a one-sided manual credit/debit adjustment to a single account (owner
-- capital, bank fees, etc), posted against the fixed MISC_ADJUSTMENTS chart account (400006) on
-- the other side. Deposit's free-text `source` carries the specific reason, same as how PURCHASES
-- doesn't care what was bought.
CREATE TABLE dbo.deposits (
  deposit_id   INT IDENTITY(1,1) NOT NULL,
  deposit_date DATE          NOT NULL,
  to_ba_id     INT           NOT NULL,
  direction    VARCHAR(10)   NOT NULL,
  amount       DECIMAL(14,2) NOT NULL,
  source       NVARCHAR(200) NOT NULL,
  remarks      NVARCHAR(500) NULL,
  status       VARCHAR(10)   NOT NULL CONSTRAINT DF_dep_status  DEFAULT ('DRAFT'),
  created_by   INT           NULL,
  updated_by   INT           NULL,
  created_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_dep_created DEFAULT (SYSUTCDATETIME()),
  updated_at   DATETIME2(0)  NOT NULL CONSTRAINT DF_dep_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_deposits           PRIMARY KEY (deposit_id),
  CONSTRAINT FK_deposits_ba        FOREIGN KEY (to_ba_id)   REFERENCES dbo.business_accounts(ba_id),
  CONSTRAINT FK_deposits_cby       FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
  CONSTRAINT FK_deposits_uby       FOREIGN KEY (updated_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_deposits_amount    CHECK (amount > 0),
  CONSTRAINT CK_deposits_status    CHECK (status IN ('CONFIRMED','DRAFT')),
  CONSTRAINT CK_deposits_direction CHECK (direction IN ('CREDIT','DEBIT'))
);
CREATE INDEX IX_deposits_ba   ON dbo.deposits(to_ba_id, deposit_date);
CREATE INDEX IX_deposits_date ON dbo.deposits(deposit_date);
GO
-- USED BY: Transfer screen's Deposit mode.
-- LEDGERS AS: CREDIT -> Dr to_ba_id / Cr MISC_ADJUSTMENTS; DEBIT -> Dr MISC_ADJUSTMENTS / Cr to_ba_id;
-- source_type 'DEPOSIT'.

/* ############################################################################
   PAYROLL — piece-rate wages and monthly salaries.
   Design doc: System_architecture/payroll.md
   ############################################################################ */

/* ----------------------------------------------------------------------------
   dbo.stages
   WHAT:  The 12 manufacturing stages, as data. Reference table, 12 rows.
   WHY:   Before this table the list was spelled out in FOUR places -- 12
          columns on dbo.articles, a CHECK on wage_runs, a CHECK on
          worker_stages, and COST_FIELDS in the frontend. Adding or renaming a
          stage meant four coordinated edits, and the two CHECK lists could
          drift apart with nothing to catch it. Now the two CHECKs are FKs and
          the labels are rows.
   NOTE:  TWO label sets, one list. On the article form a stage is the COST OF
          THE WORK ("Cutting"); on the wage screen it is THE MAN WHO DOES IT
          ("Cutter Man"). Both live here so one definition drives both.
   NOTE:  cost_column names which dbo.articles column holds that stage's rate.
          It exists because article costs are 12 COLUMNS rather than rows --
          the one bridge between the normalised list and the denormalised
          article. If articles is ever normalised into article_stage_costs,
          this column disappears with it.
   SEED:  12 rows, in form order. This file is DDL only (no INSERTs anywhere),
          so seeding lives with the app:
            cutting/Cutting/Cutter Man        edging/Edging/Edge Painting
            upStitch/Up Stitch/Upper Man      bending/Bending/Bending
            stubbleDori/Stubble-Dori/Stubble Man
            shapeForm/Shape Form/Shape Form   chipkai/Chipkai/Chipkai Man
            bottom/Bottom/Bottom Man          machine/Machine/Machine Man
            trimming/Trimming/Trimming        sockStitch/Sock Stitch/Socks Stitch
            finish/Finish/Finish
---------------------------------------------------------------------------- */
CREATE TABLE dbo.stages (
  stage_key    VARCHAR(20)  NOT NULL,               -- 'cutting', 'upStitch', ...
  form_label   NVARCHAR(40) NOT NULL,               -- article form:  'Cutting'
  worker_label NVARCHAR(40) NOT NULL,               -- wage screen:   'Cutter Man'
  cost_column  VARCHAR(30)  NOT NULL,               -- dbo.articles column holding the rate
  sort_order   INT          NOT NULL,
  is_active    BIT          NOT NULL CONSTRAINT DF_stages_active DEFAULT (1),
  CONSTRAINT PK_stages          PRIMARY KEY (stage_key),
  CONSTRAINT UQ_stages_col      UNIQUE (cost_column),   -- two stages cannot read one column
  CONSTRAINT UQ_stages_sort     UNIQUE (sort_order)
);
GO
-- USED BY: article setup form (form_label, ordering); wage run screen
-- (worker_label, and cost_column to find the rate); employee setup form's
-- trades multi-select.

/* ----------------------------------------------------------------------------
   dbo.worker_stages
   WHAT:  Which trades a WORKER may be paid for. Link table.
   WHY:   Client-confirmed a worker is restricted to his own trade -- the wage
          screen's stage list filters to these rows. A worker with none cannot
          be paid at all, which is why the create form requires at least one.
   NOTE:  employee_type is carried and pinned to 'WORKER' so the composite FK
          makes it IMPOSSIBLE to give a salaried employee a trade. It is never
          typed by the app; the default supplies it.
   NOTE:  Removing a trade does NOT touch history. wage_runs.stage_key is
          stored on the run, so runs already posted under a dropped trade
          still read correctly. Removal is deliberately not blocked.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.worker_stages (
  employee_id   INT         NOT NULL,
  employee_type VARCHAR(10) NOT NULL CONSTRAINT DF_ws_type DEFAULT ('WORKER'),
  stage_key     VARCHAR(20) NOT NULL,
  CONSTRAINT PK_worker_stages    PRIMARY KEY (employee_id, stage_key),
  CONSTRAINT FK_worker_stages_emp FOREIGN KEY (employee_id, employee_type)
        REFERENCES dbo.employees(employee_id, employee_type) ON DELETE CASCADE,
  CONSTRAINT FK_worker_stages_stg FOREIGN KEY (stage_key) REFERENCES dbo.stages(stage_key),
  CONSTRAINT CK_worker_stages_type CHECK (employee_type = 'WORKER')
);
CREATE INDEX IX_worker_stages_stage ON dbo.worker_stages(stage_key);
GO
-- USED BY: employee setup form (trades multi-select); wage run screen (filters
-- the stage list once a worker is chosen).

/* ----------------------------------------------------------------------------
   dbo.wage_runs
   WHAT:  One piece-rate settlement: one worker, one stage, many article lines.
          Header/items shape copied from sale_bills / sale_bill_items.
   WHY:   This is what finally READS the 12 stage costs on dbo.articles, which
          were write-only until now, and what credits a worker so his balance
          can be something other than "what we paid him".
   NOTE:  run_date is the SETTLEMENT date, NOT a work date. A run may cover a
          week or a fortnight of work. The period itself is deliberately NOT
          recorded -- the client's sheet has no such columns and it would mean
          typing dates they never type. Consequence, stated rather than
          hidden: NOTHING HERE CAN DETECT THE SAME WEEK BEING PAID TWICE. The
          screen mitigates by listing the worker's last three runs for the
          chosen stage. There is deliberately no unique constraint: a man can
          genuinely settle twice in a day.
   NOTE:  total_amount duplicates SUM(wage_run_items.amount). That is the
          house pattern (sale_bills.net_value does the same) and a computed
          column cannot aggregate over a child table -- so it MUST be
          rewritten in the SAME transaction as any line change. Real
          invariant, no constraint can hold it.
   NOTE:  Only CONFIRMED runs count toward a balance. DRAFT contributes
          nothing, which is what makes unpost meaningful rather than cosmetic.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.wage_runs (
  wage_run_id    INT IDENTITY(1,1) NOT NULL,
  employee_id    INT           NOT NULL,
  employee_type  VARCHAR(10)   NOT NULL CONSTRAINT DF_wr_type DEFAULT ('WORKER'),
  stage_key      VARCHAR(20)   NOT NULL,
  run_date       DATE          NOT NULL,
  total_amount   DECIMAL(14,2) NOT NULL CONSTRAINT DF_wr_total  DEFAULT (0),
  status         VARCHAR(10)   NOT NULL CONSTRAINT DF_wr_status DEFAULT ('DRAFT'),
  -- Unpost audit. A labourer holds no paperwork of his own, so unlike a sale
  -- bill there is nothing on the other side of the transaction to check a
  -- silent edit against. These three are the symmetric partner of
  -- created_by/updated_by, not a full edit history.
  unposted_at    DATETIME2(0)  NULL,
  unposted_by    INT           NULL,
  amount_before  DECIMAL(14,2) NULL,   -- total_amount at the moment it was unposted
  created_at     DATETIME2(0)  NOT NULL CONSTRAINT DF_wr_created DEFAULT (SYSUTCDATETIME()),
  created_by     INT           NULL,
  updated_at     DATETIME2(0)  NOT NULL CONSTRAINT DF_wr_updated DEFAULT (SYSUTCDATETIME()),
  updated_by     INT           NULL,
  CONSTRAINT PK_wage_runs       PRIMARY KEY (wage_run_id),
  CONSTRAINT FK_wage_runs_emp   FOREIGN KEY (employee_id, employee_type)
        REFERENCES dbo.employees(employee_id, employee_type),
  CONSTRAINT FK_wage_runs_stage FOREIGN KEY (stage_key)   REFERENCES dbo.stages(stage_key),
  CONSTRAINT FK_wage_runs_cby   FOREIGN KEY (created_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT FK_wage_runs_uby   FOREIGN KEY (updated_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT FK_wage_runs_nby   FOREIGN KEY (unposted_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_wage_runs_type   CHECK (employee_type = 'WORKER'),
  CONSTRAINT CK_wage_runs_status CHECK (status IN ('CONFIRMED','DRAFT')),
  CONSTRAINT CK_wage_runs_total  CHECK (total_amount >= 0),
  CONSTRAINT CK_wage_runs_unpost CHECK (
        (unposted_at IS NULL AND unposted_by IS NULL AND amount_before IS NULL)
     OR (unposted_at IS NOT NULL))
);
CREATE INDEX IX_wage_runs_emp    ON dbo.wage_runs(employee_id, run_date);
CREATE INDEX IX_wage_runs_stage  ON dbo.wage_runs(stage_key, run_date);
CREATE INDEX IX_wage_runs_status ON dbo.wage_runs(status);
GO
-- USED BY: Wage Run page (Transactions); employee balance helper
-- (SUM of CONFIRMED runs minus payments); Employees list "balance" column.
-- LEDGERS AS: Dr WAGES EXPENSE 410001 / Cr worker BA, source_type 'WAGE_RUN'.

/* ----------------------------------------------------------------------------
   dbo.wage_run_items
   WHAT:  One article on a wage run: rate x cartons x packing.
   WHY:   The client's sheet reads RATE x QUANTITY = TOTAL, which does not
          compute -- RATE x QUANTITY x 12 does, on every row. QUANTITY is
          CARTONS, RATE is PER PAIR, and 12 is the ARTICLE'S OWN PACKING (a
          24-pair article multiplies by 24).
   NOTE:  rate and packing are SNAPSHOTS, deliberately duplicating
          dbo.articles. The whole point is that they STOP matching when the
          article is edited -- without them, changing one stage cost would
          rewrite every wage ever paid at that rate, with no record of what
          the worker actually received.
   NOTE:  amount is a PERSISTED COMPUTED column -- the first in this schema.
          Everywhere else (sale_bill_items.value, purchase_items.total_price)
          the extension is a plain column that CAN silently disagree with its
          own inputs. Here it arithmetically cannot.
   NOTE:  Lines point at article_id, NOT variant_id. The sheet's column is
          ARTICLE, the stage costs live on dbo.articles, and colour is
          irrelevant to a piece rate. This is the one place in the system that
          deliberately targets the article rather than the colour variant.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.wage_run_items (
  item_id     INT IDENTITY(1,1) NOT NULL,
  wage_run_id INT           NOT NULL,
  article_id  INT           NOT NULL,
  rate        DECIMAL(12,2) NOT NULL,               -- SNAPSHOT of the article's stage cost
  cartons     INT           NOT NULL,               -- QUANTITY as entered on the sheet
  packing     INT           NOT NULL,               -- SNAPSHOT of dbo.articles.packing
  amount      AS (rate * cartons * packing) PERSISTED NOT NULL,
  line_no     INT           NOT NULL CONSTRAINT DF_wri_line    DEFAULT (1),
  created_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_wri_created DEFAULT (SYSUTCDATETIME()),
  updated_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_wri_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_wage_run_items      PRIMARY KEY (item_id),
  CONSTRAINT FK_wage_run_items_run  FOREIGN KEY (wage_run_id) REFERENCES dbo.wage_runs(wage_run_id) ON DELETE CASCADE,
  CONSTRAINT FK_wage_run_items_art  FOREIGN KEY (article_id)  REFERENCES dbo.articles(article_id),
  CONSTRAINT CK_wage_run_items_ctn  CHECK (cartons > 0),
  CONSTRAINT CK_wage_run_items_rate CHECK (rate >= 0),
  CONSTRAINT CK_wage_run_items_pack CHECK (packing > 0)
);
CREATE INDEX IX_wage_run_items_run ON dbo.wage_run_items(wage_run_id);
CREATE INDEX IX_wage_run_items_art ON dbo.wage_run_items(article_id);
GO
-- USED BY: Wage Run page line grid. A rate of 0 is allowed but flagged on
-- screen -- it almost always means the article's stage costs were never
-- filled in, not that the work is free.

/* ----------------------------------------------------------------------------
   dbo.salary_runs
   WHAT:  One month's salary accrual, covering every active salaried employee.
   WHY:   SALARIES PAYABLE is a LIABILITY, and a liability nothing ever credits
          sits at zero forever. This run is what puts "we owe the staff 340,000
          for July" on the books BEFORE anyone is paid -- which is the whole
          reason staff accounts are a liability rather than an expense head.
   NOTE:  UNLIKE wage_runs, this DOES get a uniqueness rule: one CONFIRMED run
          per period_month. A month is unambiguous, so a second one is always a
          mistake -- whereas a piece-work settlement period is not, which is
          why wage_runs has no equivalent. Unposting releases the month.
   NOTE:  period_month is the FIRST of the month it pays for; run_date is when
          it was actually posted. They are different questions.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.salary_runs (
  salary_run_id INT IDENTITY(1,1) NOT NULL,
  period_month  DATE          NOT NULL,             -- first day of the month being paid for
  run_date      DATE          NOT NULL,             -- when it was posted
  total_amount  DECIMAL(14,2) NOT NULL CONSTRAINT DF_salrun_total  DEFAULT (0),
  status        VARCHAR(10)   NOT NULL CONSTRAINT DF_salrun_status DEFAULT ('DRAFT'),
  unposted_at   DATETIME2(0)  NULL,
  unposted_by   INT           NULL,
  amount_before DECIMAL(14,2) NULL,
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_salrun_created DEFAULT (SYSUTCDATETIME()),
  created_by    INT           NULL,
  updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_salrun_updated DEFAULT (SYSUTCDATETIME()),
  updated_by    INT           NULL,
  CONSTRAINT PK_salary_runs        PRIMARY KEY (salary_run_id),
  CONSTRAINT FK_salary_runs_cby    FOREIGN KEY (created_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT FK_salary_runs_uby    FOREIGN KEY (updated_by)  REFERENCES dbo.users(user_id),
  CONSTRAINT FK_salary_runs_nby    FOREIGN KEY (unposted_by) REFERENCES dbo.users(user_id),
  CONSTRAINT CK_salary_runs_status CHECK (status IN ('CONFIRMED','DRAFT')),
  CONSTRAINT CK_salary_runs_total  CHECK (total_amount >= 0),
  CONSTRAINT CK_salary_runs_month  CHECK (DAY(period_month) = 1),
  CONSTRAINT CK_salary_runs_unpost CHECK (
        (unposted_at IS NULL AND unposted_by IS NULL AND amount_before IS NULL)
     OR (unposted_at IS NOT NULL))
);
-- One CONFIRMED run per month; DRAFTs are unconstrained so a correction can be
-- built alongside. This is the constraint wage_runs deliberately does NOT have.
CREATE UNIQUE INDEX UQ_salary_runs_month ON dbo.salary_runs(period_month) WHERE status = 'CONFIRMED';
CREATE INDEX        IX_salary_runs_date  ON dbo.salary_runs(run_date);
GO
-- USED BY: Salary Run page (Transactions).
-- LEDGERS AS: Dr SALARIES EXPENSE 410002 / Cr each salaried employee BA,
-- one credit per line, source_type 'SALARY_RUN'.

/* ----------------------------------------------------------------------------
   dbo.salary_run_items
   WHAT:  One salaried employee's line on a month's salary run.
   WHY:   Two amounts, not one, and the difference is the point:
            salary_amount  SNAPSHOT of employees.monthly_salary at post time
            amount         what was ACTUALLY credited -- editable
          They are equal in a normal month. When they differ, the deduction is
          visible AND explicable, instead of the ledger quietly disagreeing
          with the employee's stated salary.
   WHY TWO: without the snapshot, a line reading 35,000 against a man whose
          salary later becomes 60,000 is unreadable -- was it a deduction, or
          was 35,000 his salary back then? Same reasoning as wage_run_items
          snapshotting rate and packing.
   NOTE:  amount is NOT a computed column (unlike wage_run_items.amount). It is
          an operator input defaulting to salary_amount, not an arithmetic
          result -- so there is nothing to compute and nothing that can drift.
   NOTE:  employee_type pinned to 'SALARIED' so the composite FK makes it
          impossible to put a piece-rate worker on a salary run.
---------------------------------------------------------------------------- */
CREATE TABLE dbo.salary_run_items (
  item_id       INT IDENTITY(1,1) NOT NULL,
  salary_run_id INT           NOT NULL,
  employee_id   INT           NOT NULL,
  employee_type VARCHAR(10)   NOT NULL CONSTRAINT DF_salri_type DEFAULT ('SALARIED'),
  salary_amount DECIMAL(12,2) NOT NULL,             -- SNAPSHOT of monthly_salary
  amount        DECIMAL(12,2) NOT NULL,             -- what was credited; defaults to salary_amount
  remarks       NVARCHAR(200) NULL,                 -- why it differs, when it differs
  line_no       INT           NOT NULL CONSTRAINT DF_salri_line    DEFAULT (1),
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_salri_created DEFAULT (SYSUTCDATETIME()),
  updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_salri_updated DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT PK_salary_run_items      PRIMARY KEY (item_id),
  CONSTRAINT FK_salary_run_items_run  FOREIGN KEY (salary_run_id)
        REFERENCES dbo.salary_runs(salary_run_id) ON DELETE CASCADE,
  CONSTRAINT FK_salary_run_items_emp  FOREIGN KEY (employee_id, employee_type)
        REFERENCES dbo.employees(employee_id, employee_type),
  CONSTRAINT UQ_salary_run_items_once UNIQUE (salary_run_id, employee_id),  -- nobody paid twice in a month
  CONSTRAINT CK_salary_run_items_type CHECK (employee_type = 'SALARIED'),
  CONSTRAINT CK_salary_run_items_amt  CHECK (amount >= 0),
  CONSTRAINT CK_salary_run_items_snap CHECK (salary_amount >= 0)
);
CREATE INDEX IX_salary_run_items_run ON dbo.salary_run_items(salary_run_id);
CREATE INDEX IX_salary_run_items_emp ON dbo.salary_run_items(employee_id);
GO
-- USED BY: Salary Run page. The grid pre-fills amount from salary_amount; the
-- operator overrides it for a short month, an absence or a deduction, and
-- says why in remarks.

/* ============================================================================
   END OF SCHEMA — Bounced-cheque cascade (application logic, not a
   constraint, doc §5.10): setting dbo.cheques.cheque_status = 'BOUNCED'
   must, in the SAME transaction:
     1. set dbo.cheques.bounced_date,
     2. flip every dbo.cheque_allocations row for that cheque's receipt to
        status = 'REVERSED',
     3. write counter ledger_entries rows on BOTH sides (customer side and
        each reversed allocation's target side), dated bounced_date.
   Nothing is ever deleted — this is the single most important rule
   attached to the money tables in this schema.

   Payroll header totals (application logic, no constraint can hold it):
   wage_runs.total_amount and salary_runs.total_amount duplicate the SUM of
   their child rows. A computed column cannot aggregate over a child table, so
   BOTH must be rewritten in the SAME transaction as any line insert, update or
   delete. wage_run_items.amount needs no such care -- it is PERSISTED computed
   and recalculates itself.

   Unpost (payroll doc §8): CONFIRMED -> DRAFT -> edit -> CONFIRMED. Flipping a
   run to DRAFT must stamp unposted_at/unposted_by and copy the outgoing
   total into amount_before. Only CONFIRMED runs count toward any balance;
   deleting is permitted ONLY while DRAFT.
   ============================================================================ */
