/* ============================================================================
   040 — Backfill: sync customer and vendor names from their linked business accounts

   WHAT: Fixes rows where business_accounts.name was updated via the Accounts screen
   but the linked customers.name / vendors.name was not updated (one-way sync bug).
   Only touches rows where the two names actually differ — no-op on everything in sync.
   ============================================================================ */

UPDATE c
SET    c.name = ba.name
FROM   dbo.customers c
JOIN   dbo.business_accounts ba ON ba.ba_id = c.ba_id
WHERE  c.name <> ba.name;

UPDATE v
SET    v.name = ba.name
FROM   dbo.vendors v
JOIN   dbo.business_accounts ba ON ba.ba_id = v.ba_id
WHERE  v.name <> ba.name;
GO
