# WentoX — Database Schema (PostgreSQL)

Version 3.0 — designed for the Node.js + Express + `pg` backend (Electron desktop app, locally installed PostgreSQL).
19 tables + 6 enum types. Normalized to 3NF. All money columns are `NUMERIC`, never floats/INT.

---

## Design Decisions

### 1. Stock is derived from `stock_movements` (no stored stock column)
Stock enters the system through **PRODUCTION** entries (UC-08 "Confirm Add & Log") and manual
**OPENING / ADJUSTMENT** movements. Posting a sale bill inserts negative `SALE`
movements per item; posting a sale return inserts positive `SALE_RETURN` movements.

> Current stock of a product = `SUM(qty_pairs)` over its movements (UC-08).

PRODUCTION movements double as the **production log** (UC-08 Daily/Weekly/Monthly/Overall tabs):
they record the raw input (`input_qty` + `input_unit` CARTONS/PAIRS) and a `packing` snapshot,
while `qty_pairs` always stores the normalized total pairs. Stock display in cartons + extra
pairs is derived: `cartons = total_pairs / packing`, `extra = total_pairs % packing`.

This makes stock always consistent with transactions and trivially auditable. The business has a
**single store**, so movements carry no `store_id` (the `stores` table remains as bill metadata only).

### 2. Double-entry ledger via `ledger_entries` (posting semantics)
`Posted/Unposted` status is made meaningful by a journal table. **Posting** a document writes its
ledger rows (and stock movements, for bills/returns) inside **one DB transaction**; **unposting**
deletes them in one transaction.

| Document | Debit | Credit |
| --- | --- | --- |
| Sale Bill (net value) | Customer's chart account | SALES account |
| Sale Return (credit value) | SALES account | Customer's chart account |
| Receipt (Jamma) | CASH account | Customer's chart account |
| Expense (Kharch) | Expense head (business account) | CASH account |

- **UC-09 Khaata** (business accounts ledger) = query `ledger_entries` filtered by account + date range.
- **UC-10 Cash Book** = query `ledger_entries` on the designated CASH account, grouped by date.
- CASH and SALES are seeded chart accounts referenced by code from app config.

### 3. Enum strategy
Postgres native `CREATE TYPE ... AS ENUM` for small, stable sets (account class, payment mode,
posting status, movement type, delivery type). Values are UPPERCASE; the API maps to/from the
frontend's display labels.

### 4. Conventions applied to every table
- PK: `GENERATED ALWAYS AS IDENTITY`.
- Audit: `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  (bumped by a shared `set_updated_at()` trigger).
- Soft delete on lookup/setup tables via `is_active BOOLEAN NOT NULL DEFAULT true` (transactions are never soft-deleted; they are unposted/edited).
- Document numbers (`bill_no`, `gp_no`, `bilty_no`) are `VARCHAR(30)` — real-world numbers can be alphanumeric.
- Indexes on every FK used in filters, on transaction dates, and partial indexes for the UC-07
  "without bilty / without adda" filters.
- Editing rule (recommended): financial fields editable only while **UNPOSTED**; `bilty_no`/`adda_id`
  (UC-07) may be updated on posted bills since they are non-financial.

---

## Enum Types

```sql
CREATE TYPE account_class       AS ENUM ('ASSETS','LIABILITY','INCOME','EXPENSES');
CREATE TYPE account_status      AS ENUM ('ACTIVE','CLOSED');
CREATE TYPE payment_mode        AS ENUM ('CASH','CHEQUE','ONLINE');
CREATE TYPE posting_status      AS ENUM ('POSTED','UNPOSTED');
CREATE TYPE stock_movement_type AS ENUM ('OPENING','ADJUSTMENT','PRODUCTION','SALE','SALE_RETURN');
CREATE TYPE delivery_type       AS ENUM ('SAME','CUSTOM');
```

Shared trigger function:

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- CREATE TRIGGER trg_<table>_updated BEFORE UPDATE ON <table>
--   FOR EACH ROW EXECUTE FUNCTION set_updated_at();   (one per table)
```

---

## 1. System / Auth

### users  *(UC-19, UC-20 — new)*

```sql
CREATE TABLE users (
  user_id       INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,           -- bcrypt
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- Seed: one admin user.
```

---

## 2. Setup / Lookup Tables

All four share the same shape (UC-14 cities; stores; addas; vendors):

```sql
CREATE TABLE cities (
  city_id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE stores  (LIKE cities INCLUDING ALL);  -- store_id PK, name UNIQUE  (illustrative; real DDL spells columns out)
CREATE TABLE addas   (LIKE cities INCLUDING ALL);  -- adda_id  PK, name UNIQUE (UC-21: delete blocked if referenced by sale bills)

CREATE TABLE vendors (
  vendor_id  INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  phone      VARCHAR(30),
  city       VARCHAR(100),
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

> In the actual migration each table is written out explicitly with its own PK column name
> (`store_id`, `adda_id`) — same columns as `cities` otherwise.
> UC-21: hard-deleting an adda is blocked when sale bills reference it (FK RESTRICT); use
> `is_active = false` instead.

---

## 3. Product Tables

### product_categories  *(UC-12)*

```sql
CREATE TABLE product_categories (
  category_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

### products  *(UC-11)*

```sql
CREATE TABLE products (
  product_id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  color         VARCHAR(50),
  category_id   INT NOT NULL REFERENCES product_categories(category_id),
  vendor_id     INT REFERENCES vendors(vendor_id),
  batch_no      VARCHAR(50),
  packing       INT NOT NULL CHECK (packing > 0),   -- pairs per carton (usually 12)
  cost_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- cost breakdown (per wento_docs; names kept as-is from the legacy system)
  labour        NUMERIC(12,2) NOT NULL DEFAULT 0,
  proi_cost     NUMERIC(12,2) NOT NULL DEFAULT 0,
  sole_stich    NUMERIC(12,2) NOT NULL DEFAULT 0,
  pasting       NUMERIC(12,2) NOT NULL DEFAULT 0,
  trim          NUMERIC(12,2) NOT NULL DEFAULT 0,
  finishing     NUMERIC(12,2) NOT NULL DEFAULT 0,
  socks_pasting NUMERIC(12,2) NOT NULL DEFAULT 0,
  dc            NUMERIC(12,2) NOT NULL DEFAULT 0,
  sock_stich    NUMERIC(12,2) NOT NULL DEFAULT 0,
  sheet         NUMERIC(12,2) NOT NULL DEFAULT 0,
  stubble       NUMERIC(12,2) NOT NULL DEFAULT 0,
  bottom        NUMERIC(12,2) NOT NULL DEFAULT 0,
  p1            NUMERIC(12,2) NOT NULL DEFAULT 0,
  p2            NUMERIC(12,2) NOT NULL DEFAULT 0,
  na            NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_vendor   ON products(vendor_id);
CREATE INDEX idx_products_name     ON products(name);
```

---

## 4. Accounts Hierarchy (Class → Group → Control → Chart/Business)

### group_accounts  *(UC-15)*

```sql
CREATE TABLE group_accounts (
  group_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100)  NOT NULL UNIQUE,
  class      account_class NOT NULL,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);
```

### control_accounts  *(UC-16)*

```sql
CREATE TABLE control_accounts (
  control_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  group_id   INT NOT NULL REFERENCES group_accounts(group_id),
  sorting    INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, name)
);
CREATE INDEX idx_control_accounts_group ON control_accounts(group_id);
```

### chart_of_accounts  *(UC-17)*

```sql
CREATE TABLE chart_of_accounts (
  ac_id      INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100)   NOT NULL,
  control_id INT NOT NULL REFERENCES control_accounts(control_id),
  link_code  VARCHAR(20),
  status     account_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX idx_chart_accounts_control ON chart_of_accounts(control_id);
-- Seed: CASH and SALES accounts (codes referenced from app config).
```

### business_accounts  *(UC-18)*

```sql
CREATE TABLE business_accounts (
  ba_id      INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100)   NOT NULL,
  control_id INT NOT NULL REFERENCES control_accounts(control_id),
  link_code  VARCHAR(20),
  region     VARCHAR(50),
  status     account_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX idx_business_accounts_control ON business_accounts(control_id);
```

---

## 5. Customer Tables

### customers

```sql
CREATE TABLE customers (
  customer_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  ac_id       INT REFERENCES chart_of_accounts(ac_id),  -- main ledger account
  city_id     INT REFERENCES cities(city_id),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_ac   ON customers(ac_id);
CREATE INDEX idx_customers_city ON customers(city_id);
```

### sub_customers  *(UC-13 — delivery agents / middlemen)*

```sql
CREATE TABLE sub_customers (
  sub_customer_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            VARCHAR(150) NOT NULL,
  customer_id     INT NOT NULL REFERENCES customers(customer_id),
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sub_customers_customer ON sub_customers(customer_id);
```

---

## 6. Sales Tables

### sale_bills  *(UC-01, UC-02, UC-07)*

```sql
CREATE TABLE sale_bills (
  bill_id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bill_date        DATE NOT NULL,
  store_id         INT NOT NULL REFERENCES stores(store_id),
  customer_id      INT NOT NULL REFERENCES customers(customer_id),
  sub_customer_id  INT REFERENCES sub_customers(sub_customer_id),  -- NULL for SAME delivery
  delivery_type    delivery_type NOT NULL DEFAULT 'SAME',
  delivery_address TEXT,
  bill_no          VARCHAR(30),
  gp_no            VARCHAR(30),
  bilty_no         VARCHAR(30),                     -- NULL until assigned (UC-07)
  adda_id          INT REFERENCES addas(adda_id),   -- NULL until assigned (UC-07)
  remarks          TEXT,
  invoice_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cartons    INT           NOT NULL DEFAULT 0,
  total_pairs      INT           NOT NULL DEFAULT 0,
  gross_value      NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_value        NUMERIC(14,2) NOT NULL DEFAULT 0,
  status           posting_status NOT NULL DEFAULT 'UNPOSTED',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_bills_date     ON sale_bills(bill_date);
CREATE INDEX idx_sale_bills_customer ON sale_bills(customer_id);
CREATE INDEX idx_sale_bills_no_bilty ON sale_bills(bill_date) WHERE bilty_no IS NULL;  -- UC-07 filter
CREATE INDEX idx_sale_bills_no_adda  ON sale_bills(bill_date) WHERE adda_id  IS NULL;  -- UC-07 filter
```

### sale_bill_items

```sql
CREATE TABLE sale_bill_items (
  item_id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bill_id          INT NOT NULL REFERENCES sale_bills(bill_id) ON DELETE CASCADE,
  product_id       INT NOT NULL REFERENCES products(product_id),
  cartons          INT NOT NULL CHECK (cartons > 0),
  pairs            INT NOT NULL CHECK (pairs > 0),          -- cartons × packing
  rate             NUMERIC(12,2) NOT NULL,
  discount_percent NUMERIC(5,2)  NOT NULL DEFAULT 0,
  discount_value   NUMERIC(12,2) NOT NULL DEFAULT 0,
  value            NUMERIC(14,2) NOT NULL,                  -- net line value
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_bill_items_bill    ON sale_bill_items(bill_id);
CREATE INDEX idx_sale_bill_items_product ON sale_bill_items(product_id);
```

### sale_returns  *(UC-03, UC-04)* — mirrors sale_bills (store = destination "TO" store)

```sql
CREATE TABLE sale_returns (
  return_id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_date      DATE NOT NULL,
  store_id         INT NOT NULL REFERENCES stores(store_id),
  customer_id      INT NOT NULL REFERENCES customers(customer_id),
  sub_customer_id  INT REFERENCES sub_customers(sub_customer_id),
  bill_no          VARCHAR(30),
  gp_no            VARCHAR(30),
  bilty_no         VARCHAR(30),
  adda_id          INT REFERENCES addas(adda_id),
  remarks          TEXT,                                     -- return reason
  invoice_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cartons    INT           NOT NULL DEFAULT 0,
  total_pairs      INT           NOT NULL DEFAULT 0,
  gross_value      NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_value        NUMERIC(14,2) NOT NULL DEFAULT 0,        -- credit value
  status           posting_status NOT NULL DEFAULT 'UNPOSTED',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_returns_date     ON sale_returns(return_date);
CREATE INDEX idx_sale_returns_customer ON sale_returns(customer_id);
```

### sale_return_items — same shape as sale_bill_items, FK `return_id → sale_returns ON DELETE CASCADE`.

---

## 7. Money Tables

### receipts (Jamma)  *(UC-05)*

```sql
CREATE TABLE receipts (
  receipt_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_date DATE NOT NULL,
  customer_id  INT NOT NULL REFERENCES customers(customer_id),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_mode payment_mode  NOT NULL,
  details      VARCHAR(200),                    -- cheque no / transaction ref
  remarks      TEXT,
  status       posting_status NOT NULL DEFAULT 'POSTED',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_receipts_date     ON receipts(receipt_date);
CREATE INDEX idx_receipts_customer ON receipts(customer_id);
```

### expenses (Kharch)  *(UC-06 — new)*

```sql
CREATE TABLE expenses (
  expense_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_date DATE NOT NULL,
  ba_id        INT NOT NULL REFERENCES business_accounts(ba_id),  -- expense head
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_mode payment_mode  NOT NULL,
  details      VARCHAR(200),
  remarks      TEXT,
  status       posting_status NOT NULL DEFAULT 'POSTED',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_expenses_ba   ON expenses(ba_id);
```

---

## 8. Derived-State Tables

### stock_movements  *(UC-08 — new)*

```sql
CREATE TABLE stock_movements (
  movement_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id    INT NOT NULL REFERENCES products(product_id),
  movement_type stock_movement_type NOT NULL,
  qty_pairs     INT NOT NULL,          -- signed, normalized to pairs: SALE negative; PRODUCTION/SALE_RETURN positive
  movement_date DATE NOT NULL,         -- production date for PRODUCTION rows (UC-08 logs)
  input_qty     INT,                   -- PRODUCTION only: quantity as entered by the user
  input_unit    VARCHAR(10) CHECK (input_unit IN ('CARTONS','PAIRS')),  -- PRODUCTION only
  packing       INT,                   -- PRODUCTION only: packing snapshot at entry time
  source_type   VARCHAR(20),           -- 'SALE_BILL' | 'SALE_RETURN' | NULL (manual/production)
  source_id     INT,                   -- bill_id / return_id
  remarks       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_date    ON stock_movements(movement_date);
CREATE INDEX idx_stock_movements_source  ON stock_movements(source_type, source_id);
```

### ledger_entries  *(UC-09, UC-10 — new)*

```sql
CREATE TABLE ledger_entries (
  entry_id     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date   DATE NOT NULL,
  account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('CHART','BUSINESS')),
  account_id   INT NOT NULL,          -- ac_id or ba_id depending on account_type
  debit        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  source_type  VARCHAR(20) NOT NULL,  -- 'SALE_BILL' | 'SALE_RETURN' | 'RECEIPT' | 'EXPENSE' | 'OPENING'
  source_id    INT NOT NULL,
  narration    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (debit = 0 OR credit = 0)     -- each row is one side of an entry
);
CREATE INDEX idx_ledger_account ON ledger_entries(account_type, account_id, entry_date);
CREATE INDEX idx_ledger_source  ON ledger_entries(source_type, source_id);
CREATE INDEX idx_ledger_date    ON ledger_entries(entry_date);
```

---

## Table Inventory (19)

| # | Table | UC coverage | New in v3 |
| --- | --- | --- | --- |
| 1 | users | UC-19, UC-20 | ✅ |
| 2 | cities | UC-14 | |
| 3 | stores | UC-01 | |
| 4 | addas | UC-01, UC-07, UC-21 | |
| 5 | vendors | UC-11 | |
| 6 | product_categories | UC-12 | |
| 7 | products | UC-11 | |
| 8 | group_accounts | UC-15 | |
| 9 | control_accounts | UC-16 | |
| 10 | chart_of_accounts | UC-17 | |
| 11 | business_accounts | UC-18 | |
| 12 | customers | UC-01… | |
| 13 | sub_customers | UC-13 | |
| 14 | sale_bills | UC-01, UC-02, UC-07 | |
| 15 | sale_bill_items | UC-01 | |
| 16 | sale_returns | UC-03, UC-04 | |
| 17 | sale_return_items | UC-03 | |
| 18 | receipts | UC-05 | |
| 19 | expenses | UC-06 | ✅ |
| — | stock_movements | UC-08 | ✅ |
| — | ledger_entries | UC-09, UC-10 | ✅ |

*(21 relations total counting the two derived-state tables.)*

---

## Open Questions

1. ~~Production entry~~ — resolved in v3.1: UC-08 production logging is covered by `PRODUCTION`
   stock movements (with `input_qty` / `input_unit` / `packing` snapshot). A separate *purchase*
   entry, if ever needed, becomes another `stock_movement_type` value.
2. **CASH / SALES account codes** — which existing chart accounts represent Cash-in-hand and
   Sales income? They must be seeded/configured before posting works.
3. **`products.p1`, `p2`, `na`** — legacy column names of unknown meaning; kept verbatim. Rename
   once clarified.
4. **Editing posted documents** — recommended policy (adopted above): financial edits require
   unposting first; bilty/adda updates allowed on posted bills.
