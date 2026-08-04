-- Milestone 5.2 "Overall Searching" (user-requested, not in the original 9-item Reports list):
-- type a name, get back every matching customer/vendor/employee/sub-customer/business account in
-- one list. Built as a VIEW rather than an app-side UNION so it auto-reflects whichever source
-- table changes — no report code to keep in sync when a customer/vendor/employee is added,
-- renamed, or deactivated. sub_customers carry no ba_id (delivery-address-only party, never
-- financially responsible for a bill — see dbo.sub_customers' own schema.sql comment), so their
-- ba_id column here is always NULL; the report layer shows "no financial account" for those
-- rather than faking a ledger.
CREATE VIEW dbo.vw_overall_directory AS
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
  'BUSINESS_ACCOUNT', ba.ba_id, ba.name, ba.ba_id, ci.name, NULL,
  CASE WHEN ba.status = 'ACTIVE' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END
FROM dbo.business_accounts ba
LEFT JOIN dbo.cities ci ON ci.city_id = ba.city_id
-- Excludes rows already surfaced above through their owning party (customer/vendor/employee) —
-- only "generic" business accounts (bank accounts, expense heads) show up under their own name.
WHERE NOT EXISTS (SELECT 1 FROM dbo.customers c2 WHERE c2.ba_id = ba.ba_id)
  AND NOT EXISTS (SELECT 1 FROM dbo.vendors v2   WHERE v2.ba_id = ba.ba_id)
  AND NOT EXISTS (SELECT 1 FROM dbo.employees e2 WHERE e2.ba_id = ba.ba_id);
