-- Debugger-caught gap in migration 008's dbo.vw_overall_directory: the generic BUSINESS_ACCOUNT
-- branch excluded rows already claimed by customers/vendors/employees, but had no exclusion — or
-- own branch — for dbo.bank_accounts, so a bank account fell through to the generic branch
-- instead of getting its own 'BANK' entity_type. reports.repository.js#businessAccountsWithCategory()
-- (used by Overall Trail) already resolves a 5-way category including 'BANK'; this brings Overall
-- Search's view in line with it. bank_accounts has no city_id of its own (unlike
-- customers/vendors/employees) — city comes from its linked business_accounts row instead, same
-- as every other business_accounts-only field.
ALTER VIEW dbo.vw_overall_directory AS
SELECT
  'CUSTOMER'      AS entity_type,
  c.customer_id   AS entity_id,
  c.name          AS name,
  c.ba_id         AS ba_id,
  ci.name         AS city_name,
  NULL            AS phone,
  c.is_active     AS is_active
FROM dbo.customers c
LEFT JOIN dbo.cities ci ON ci.city_id = c.city_id

UNION ALL

SELECT
  'VENDOR', v.vendor_id, v.name, v.ba_id, ci.name, v.phone, v.is_active
FROM dbo.vendors v
LEFT JOIN dbo.cities ci ON ci.city_id = v.city_id

UNION ALL

SELECT
  'EMPLOYEE', e.employee_id, e.name, e.ba_id, ci.name, e.phone, e.is_active
FROM dbo.employees e
LEFT JOIN dbo.cities ci ON ci.city_id = e.city_id

UNION ALL

SELECT
  'SUB_CUSTOMER', s.sub_customer_id, s.name, NULL, ci.name, NULL, s.is_active
FROM dbo.sub_customers s
LEFT JOIN dbo.cities ci ON ci.city_id = s.city_id

UNION ALL

SELECT
  'BANK', bk.bank_id, bk.name, bk.ba_id, ci.name, CAST(bk.account_no AS VARCHAR(30)), bk.is_active
FROM dbo.bank_accounts bk
LEFT JOIN dbo.business_accounts ba ON ba.ba_id = bk.ba_id
LEFT JOIN dbo.cities ci ON ci.city_id = ba.city_id

UNION ALL

SELECT
  'BUSINESS_ACCOUNT', ba.ba_id, ba.name, ba.ba_id, ci.name, NULL,
  CASE WHEN ba.status = 'ACTIVE' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END
FROM dbo.business_accounts ba
LEFT JOIN dbo.cities ci ON ci.city_id = ba.city_id
-- Excludes rows already surfaced above through their owning party (customer/vendor/employee/bank)
-- — only "generic" business accounts (expense heads, directors drawings, ...) show up here.
WHERE NOT EXISTS (SELECT 1 FROM dbo.customers c2     WHERE c2.ba_id = ba.ba_id)
  AND NOT EXISTS (SELECT 1 FROM dbo.vendors v2        WHERE v2.ba_id = ba.ba_id)
  AND NOT EXISTS (SELECT 1 FROM dbo.employees e2      WHERE e2.ba_id = ba.ba_id)
  AND NOT EXISTS (SELECT 1 FROM dbo.bank_accounts bk2 WHERE bk2.ba_id = ba.ba_id);
