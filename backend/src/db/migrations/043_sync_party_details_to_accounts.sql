/* ============================================================================
   043 — Backfill: copy each customer's / vendor's / employee's region and city onto its linked
   business account

   WHY: the city is stored twice — on the party row (customers/vendors/employees) and on its
   business_accounts row. Editing a party only copied the NAME across, so the ledgers (which read
   business_accounts.city_id) kept the old city. Reported by the user, 2026-10-08: CARRYO SHOES
   HAFIZABAD showed HAFIZ ABAD in Customers but MINGORA on the Business Ledger. The services now
   sync both ways; this repairs the rows that already drifted. The party row wins — it is the
   screen the user edits the city on. Only rows that actually differ are touched.

   Also (same audit): renaming an account from the Accounts screen updated customer and vendor
   names (migration 040) but not EMPLOYEE or BANK names. For names the account wins, as in 040 —
   a party-screen rename always copied the name to the account, so a differing name can only come
   from an Accounts-screen rename.
   ============================================================================ */

UPDATE ba
SET    ba.region_id = c.region_id, ba.city_id = c.city_id
FROM   dbo.business_accounts ba
JOIN   dbo.customers c ON c.ba_id = ba.ba_id
WHERE  ISNULL(ba.city_id, -1) <> ISNULL(c.city_id, -1)
   OR  ISNULL(ba.region_id, -1) <> ISNULL(c.region_id, -1);

UPDATE ba
SET    ba.region_id = v.region_id, ba.city_id = v.city_id
FROM   dbo.business_accounts ba
JOIN   dbo.vendors v ON v.ba_id = ba.ba_id
WHERE  ISNULL(ba.city_id, -1) <> ISNULL(v.city_id, -1)
   OR  ISNULL(ba.region_id, -1) <> ISNULL(v.region_id, -1);

UPDATE ba
SET    ba.city_id = e.city_id
FROM   dbo.business_accounts ba
JOIN   dbo.employees e ON e.ba_id = ba.ba_id
WHERE  ISNULL(ba.city_id, -1) <> ISNULL(e.city_id, -1);
UPDATE e
SET    e.name = ba.name
FROM   dbo.employees e
JOIN   dbo.business_accounts ba ON ba.ba_id = e.ba_id
WHERE  e.name <> ba.name;

UPDATE b
SET    b.name = ba.name
FROM   dbo.bank_accounts b
JOIN   dbo.business_accounts ba ON ba.ba_id = b.ba_id
WHERE  b.name <> ba.name;
GO
