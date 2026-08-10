/* ============================================================================
   017 — Manufacturing Product vendor

   WHY: dbo.articles.vendor_id is NOT NULL with an FK to dbo.vendors, and it is
        not decorative — it scopes batch numbering (batch_no = MAX + 1 per
        vendor, protected by UQ_articles_vendor_batch) and the duplicate-name
        rule (name + vendor). But the business manufactures its own product, so
        there is no real supplier to name. Every article is now attributed to a
        single system vendor, "Manufacturing Product", which the product form
        sets permanently and cannot be changed.

   WHY A FLAG rather than matching on the name: dbo.vendors has no code column
        and deliberately no UNIQUE(name) (two real vendors may share a name —
        see the table's own comment), so a name match could break the moment
        someone renames it or adds a second "Manufacturing Product". A flag is
        the same discipline reserved chart accounts use: resolve by a stable
        marker, never by a display string.

   THE ROW ITSELF is created by db/seeds/manufacturing-vendor.js, not here — it
        needs the VENDORS ACCOUNTS chart account to hang its business account
        from, and that is seeded AFTER migrations run. This file only opens the
        column; the seed fills it and moves existing articles across.
   ============================================================================ */

ALTER TABLE dbo.vendors ADD is_system BIT NOT NULL CONSTRAINT DF_vendors_system DEFAULT (0);
GO

-- At most ONE system vendor, ever. A filtered unique index is the only way to say
-- "unique among the rows where is_system = 1" — a plain UNIQUE would demand every
-- ordinary vendor be distinct on a column that is 0 for all of them.
CREATE UNIQUE INDEX UQ_vendors_system ON dbo.vendors(is_system) WHERE is_system = 1;
GO
