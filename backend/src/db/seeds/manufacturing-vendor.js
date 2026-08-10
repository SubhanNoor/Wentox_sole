// The single system vendor every article is attributed to.
//
// The business manufactures its own product, so dbo.articles.vendor_id — NOT NULL, FK to
// dbo.vendors, and load-bearing (it scopes batch numbering and the duplicate-name rule) — has no
// real supplier to point at. One system vendor, "Manufacturing Product", fills that role; the
// product form shows it locked and products.service.js ignores whatever vendor_id a client sends.
//
// Lives in seeds rather than in migration 017 because it needs the VENDORS ACCOUNTS chart account
// to hang its business account from, and reserved chart accounts are seeded AFTER migrations run.
// Idempotent, like the rest of run.js: re-running finds the vendor and moves nothing.
const sql = require('mssql');
const CODES = require('../../constants/reservedAccounts');

const VENDOR_NAME = 'Manufacturing Product';

async function ensureVendor(pool) {
  const existing = await pool.request()
    .query('SELECT vendor_id, ba_id FROM dbo.vendors WHERE is_system = 1');
  if (existing.recordset.length) return existing.recordset[0];

  // Its business account is created the same way vendors.service.js#create() does it — under
  // VENDORS ACCOUNTS, code = chart code + 4-digit serial (§3.2) — so the system vendor has a real
  // ledger like any other, even though nothing should ever post to it.
  const chart = await pool.request()
    .input('code', sql.VarChar, CODES.VENDORS_ACCOUNTS)
    .query('SELECT ac_id, code FROM dbo.chart_of_accounts WHERE code = @code');
  if (!chart.recordset.length) {
    throw new Error(`Reserved chart account VENDORS ACCOUNTS (code ${CODES.VENDORS_ACCOUNTS}) not found — seed reserved accounts first`);
  }
  const { ac_id: acId, code: chartCode } = chart.recordset[0];

  const serialRow = await pool.request()
    .input('chartCode', sql.VarChar, chartCode)
    .query(`SELECT MAX(TRY_CAST(RIGHT(code, 4) AS INT)) AS maxSerial
            FROM dbo.business_accounts
            WHERE LEN(code) = 10 AND LEFT(code, 6) = @chartCode`);
  const code = chartCode + String((serialRow.recordset[0].maxSerial || 0) + 1).padStart(4, '0');

  const ba = await pool.request()
    .input('code', sql.VarChar, code)
    .input('name', sql.NVarChar, VENDOR_NAME)
    .input('acId', sql.Int, acId)
    .query(`INSERT INTO dbo.business_accounts (code, name, ac_id)
            OUTPUT inserted.ba_id VALUES (@code, @name, @acId)`);
  const baId = ba.recordset[0].ba_id;

  const inserted = await pool.request()
    .input('name', sql.NVarChar, VENDOR_NAME)
    .input('baId', sql.Int, baId)
    .query(`INSERT INTO dbo.vendors (name, ba_id, is_system)
            OUTPUT inserted.vendor_id VALUES (@name, @baId, 1)`);
  console.log(`seeded system vendor: ${VENDOR_NAME}`);
  return { vendor_id: inserted.recordset[0].vendor_id, ba_id: baId };
}

// Moves every article onto the system vendor, renumbering batch_no 1..N in the SAME statement.
// It has to be one statement: UQ_articles_vendor_batch is UNIQUE (vendor_id, batch_no), and the
// existing data has duplicate batch numbers that are only legal because they sit under different
// vendors (three articles on batch 1, two on batch 2 in the demo set). Setting vendor_id first and
// renumbering second would violate the constraint mid-flight.
//
// batch_no is safe to rewrite: it is never typed, never edited, never displayed on any screen and
// read by nothing except its own MAX + 1 — confirmed with the user, who has no use for it outside
// the app. Ordered by article_id so the sequence follows creation order.
async function reassignArticles(pool, vendorId) {
  const result = await pool.request()
    .input('vendorId', sql.Int, vendorId)
    .query(`
      WITH renumbered AS (
        SELECT article_id, vendor_id, batch_no,
               ROW_NUMBER() OVER (ORDER BY article_id) AS new_batch
        FROM dbo.articles
      )
      UPDATE renumbered SET vendor_id = @vendorId, batch_no = new_batch
      WHERE vendor_id <> @vendorId OR batch_no <> new_batch;
    `);
  if (result.rowsAffected[0]) {
    console.log(`moved ${result.rowsAffected[0]} article(s) onto ${VENDOR_NAME} and renumbered their batches`);
  }
}

async function seedManufacturingVendor(pool) {
  const vendor = await ensureVendor(pool);
  await reassignArticles(pool, vendor.vendor_id);
  return vendor;
}

module.exports = { seedManufacturingVendor, VENDOR_NAME };
