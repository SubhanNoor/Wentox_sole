-- Wentox ERP — initial schema (see System_architecture/database_schema.md v3)

-- ===== Enum types =====
CREATE TYPE account_class       AS ENUM ('ASSETS','LIABILITY','INCOME','EXPENSES');
CREATE TYPE account_status      AS ENUM ('ACTIVE','CLOSED');
CREATE TYPE payment_mode        AS ENUM ('CASH','CHEQUE','ONLINE');
CREATE TYPE posting_status      AS ENUM ('POSTED','UNPOSTED');
CREATE TYPE stock_movement_type AS ENUM ('OPENING','ADJUSTMENT','SALE','SALE_RETURN');
CREATE TYPE delivery_type       AS ENUM ('SAME','CUSTOM');

-- ===== updated_at trigger =====
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===== System / Auth =====
CREATE TABLE users (
  user_id       INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ===== Setup / lookup =====
CREATE TABLE cities (
  city_id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE stores (
  store_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE addas (
  adda_id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE vendors (
  vendor_id  INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ===== Products =====
CREATE TABLE product_categories (
  category_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE products (
  product_id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  category_id   INT NOT NULL REFERENCES product_categories(category_id),
  vendor_id     INT REFERENCES vendors(vendor_id),
  batch_no      VARCHAR(50),
  packing       INT NOT NULL CHECK (packing > 0),
  cost_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
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

-- ===== Accounts hierarchy =====
CREATE TABLE group_accounts (
  group_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100)  NOT NULL UNIQUE,
  class      account_class NOT NULL,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);

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

-- ===== Customers =====
CREATE TABLE customers (
  customer_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  ac_id       INT REFERENCES chart_of_accounts(ac_id),
  city_id     INT REFERENCES cities(city_id),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_ac   ON customers(ac_id);
CREATE INDEX idx_customers_city ON customers(city_id);

CREATE TABLE sub_customers (
  sub_customer_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            VARCHAR(150) NOT NULL,
  customer_id     INT NOT NULL REFERENCES customers(customer_id),
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sub_customers_customer ON sub_customers(customer_id);

-- ===== Sales =====
CREATE TABLE sale_bills (
  bill_id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bill_date        DATE NOT NULL,
  store_id         INT NOT NULL REFERENCES stores(store_id),
  customer_id      INT NOT NULL REFERENCES customers(customer_id),
  sub_customer_id  INT REFERENCES sub_customers(sub_customer_id),
  delivery_type    delivery_type NOT NULL DEFAULT 'SAME',
  delivery_address TEXT,
  bill_no          VARCHAR(30),
  gp_no            VARCHAR(30),
  bilty_no         VARCHAR(30),
  adda_id          INT REFERENCES addas(adda_id),
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
CREATE INDEX idx_sale_bills_no_bilty ON sale_bills(bill_date) WHERE bilty_no IS NULL;
CREATE INDEX idx_sale_bills_no_adda  ON sale_bills(bill_date) WHERE adda_id  IS NULL;

CREATE TABLE sale_bill_items (
  item_id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bill_id          INT NOT NULL REFERENCES sale_bills(bill_id) ON DELETE CASCADE,
  product_id       INT NOT NULL REFERENCES products(product_id),
  cartons          INT NOT NULL CHECK (cartons > 0),
  pairs            INT NOT NULL CHECK (pairs > 0),
  rate             NUMERIC(12,2) NOT NULL,
  discount_percent NUMERIC(5,2)  NOT NULL DEFAULT 0,
  discount_value   NUMERIC(12,2) NOT NULL DEFAULT 0,
  value            NUMERIC(14,2) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_bill_items_bill    ON sale_bill_items(bill_id);
CREATE INDEX idx_sale_bill_items_product ON sale_bill_items(product_id);

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
CREATE INDEX idx_sale_returns_date     ON sale_returns(return_date);
CREATE INDEX idx_sale_returns_customer ON sale_returns(customer_id);

CREATE TABLE sale_return_items (
  item_id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_id        INT NOT NULL REFERENCES sale_returns(return_id) ON DELETE CASCADE,
  product_id       INT NOT NULL REFERENCES products(product_id),
  cartons          INT NOT NULL CHECK (cartons > 0),
  pairs            INT NOT NULL CHECK (pairs > 0),
  rate             NUMERIC(12,2) NOT NULL,
  discount_percent NUMERIC(5,2)  NOT NULL DEFAULT 0,
  discount_value   NUMERIC(12,2) NOT NULL DEFAULT 0,
  value            NUMERIC(14,2) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_return_items_return  ON sale_return_items(return_id);
CREATE INDEX idx_sale_return_items_product ON sale_return_items(product_id);

-- ===== Money =====
CREATE TABLE receipts (
  receipt_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_date DATE NOT NULL,
  customer_id  INT NOT NULL REFERENCES customers(customer_id),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_mode payment_mode  NOT NULL,
  details      VARCHAR(200),
  remarks      TEXT,
  status       posting_status NOT NULL DEFAULT 'POSTED',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_receipts_date     ON receipts(receipt_date);
CREATE INDEX idx_receipts_customer ON receipts(customer_id);

CREATE TABLE expenses (
  expense_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_date DATE NOT NULL,
  ba_id        INT NOT NULL REFERENCES business_accounts(ba_id),
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

-- ===== Derived state =====
CREATE TABLE stock_movements (
  movement_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id    INT NOT NULL REFERENCES products(product_id),
  movement_type stock_movement_type NOT NULL,
  qty_pairs     INT NOT NULL,
  movement_date DATE NOT NULL,
  source_type   VARCHAR(20),
  source_id     INT,
  remarks       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_date    ON stock_movements(movement_date);
CREATE INDEX idx_stock_movements_source  ON stock_movements(source_type, source_id);

CREATE TABLE ledger_entries (
  entry_id     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date   DATE NOT NULL,
  account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('CHART','BUSINESS')),
  account_id   INT NOT NULL,
  debit        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  source_type  VARCHAR(20) NOT NULL,
  source_id    INT NOT NULL,
  narration    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (debit = 0 OR credit = 0)
);
CREATE INDEX idx_ledger_account ON ledger_entries(account_type, account_id, entry_date);
CREATE INDEX idx_ledger_source  ON ledger_entries(source_type, source_id);
CREATE INDEX idx_ledger_date    ON ledger_entries(entry_date);

-- ===== updated_at triggers (one per table) =====
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END $$;
