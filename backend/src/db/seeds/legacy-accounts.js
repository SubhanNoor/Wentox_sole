// Legacy business accounts carried over from the client's old "BUSINESS ACCOUNTS LEDGER (KHAATA)"
// system, transcribed from their screenshot of it. Idempotent like the rest of run.js — keyed on
// business_accounts.legacy_code, which schema.sql defines for exactly this ("old system's number;
// import reconciliation only"). Re-running skips anything already imported, and renaming an
// imported account here in WentoX will NOT cause it to be re-inserted, because the match is on the
// legacy number rather than the name.
//
// Each row lands under a chart account that db/seeds/run.js already creates (§8 / TASK-17), so
// this module must be called AFTER those exist. Note the Directors rows inherit
// chart_of_accounts.is_restricted = 1 from their parent, so the USER role cannot see them (TASK-14).
//
// The screenshot is a partial view of a much longer ledger (its first visible legacy code is
// ...2218), so treat this list as the first import batch, not the whole chart. Later batches append
// to LEGACY_ACCOUNTS; already-imported rows are skipped on the next run.
const sql = require('mssql');
const CODES = require('../../constants/reservedAccounts');

// Every account on the imported screen sits in Lahore. Region is the primary customer search key
// (TASK-07) and cities.region_id rolls city up into it, so the city is created under a region
// rather than orphaned. Spelled to match db/seeds/dev-sample-data.js so the demo database ends up
// with one 'Lahore', not two.
const REGION_NAME = 'Punjab';
const CITY_NAME = 'Lahore';

// Order preserved from the legacy screen; names verbatim, including '@HOME BILLS' and 'HAJI SB.'.
const LEGACY_ACCOUNTS = [
  { legacyCode: '841000002218', name: 'NOMAN BUTT UPPERMAN MURIDKE', chartCode: CODES.EMPLOYEES },
  { legacyCode: '841000002219', name: 'ZAFAR CHOWKIDAAR', chartCode: CODES.EMPLOYEES },
  { legacyCode: '841000004001', name: 'USMAN BHATTI', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004002', name: 'ABU BAKAR', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004003', name: 'IMRAN AMIR', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004004', name: 'DHOODH', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004005', name: 'HAJI SB.', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004006', name: 'ZAKAT', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004007', name: 'CHARITY', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004008', name: 'COMMITTEE', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004009', name: 'HAFIZ IRFAN', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004010', name: 'VEHICLES OWNED', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004011', name: 'SAGGIAN FACTORY', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004012', name: 'UMER FAROOQ BHATTI', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004013', name: 'AARZI ACCOUNT', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004014', name: '@HOME BILLS', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004015', name: 'UK REMITTANCE', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004016', name: 'PAYABLE PAYS', chartCode: CODES.DIRECTORS_DRAWINGS },
  { legacyCode: '841000004017', name: 'BORROWINGS', chartCode: CODES.DIRECTORS_DRAWINGS },
];

async function ensureRegion(pool, name) {
  const existing = await pool.request()
    .input('name', sql.NVarChar, name)
    .query('SELECT region_id FROM dbo.regions WHERE name = @name');
  if (existing.recordset.length) return existing.recordset[0].region_id;

  const inserted = await pool.request()
    .input('name', sql.NVarChar, name)
    .query('INSERT INTO dbo.regions (name) OUTPUT inserted.region_id VALUES (@name)');
  console.log(`seeded region: ${name}`);
  return inserted.recordset[0].region_id;
}

async function ensureCity(pool, name, regionId) {
  const existing = await pool.request()
    .input('name', sql.NVarChar, name)
    .query('SELECT city_id FROM dbo.cities WHERE name = @name');
  if (existing.recordset.length) return existing.recordset[0].city_id;

  const inserted = await pool.request()
    .input('name', sql.NVarChar, name)
    .input('regionId', sql.Int, regionId)
    .query('INSERT INTO dbo.cities (name, region_id) OUTPUT inserted.city_id VALUES (@name, @regionId)');
  console.log(`seeded city: ${name}`);
  return inserted.recordset[0].city_id;
}

// Same §3.2 allocation rule businessAccounts.repository.nextSerial() uses — parent chart code + a
// 4-digit serial one past the highest already issued under that parent. Recomputed per insert so a
// partially-completed import resumes correctly instead of colliding on UQ_business_accounts_code.
async function nextCode(pool, chartCode) {
  const result = await pool.request()
    .input('chartCode', sql.VarChar, chartCode)
    .query(`SELECT MAX(TRY_CAST(RIGHT(code, 4) AS INT)) AS maxSerial
            FROM dbo.business_accounts
            WHERE LEN(code) = 10 AND LEFT(code, 6) = @chartCode`);
  const serial = (result.recordset[0].maxSerial || 0) + 1;
  return chartCode + String(serial).padStart(4, '0');
}

async function seedLegacyAccounts(pool) {
  const regionId = await ensureRegion(pool, REGION_NAME);
  const cityId = await ensureCity(pool, CITY_NAME, regionId);

  // Resolve each distinct parent once; a missing one means run.js's chart-account seeding was
  // skipped or its reserved code changed, which is a bug worth failing loudly on rather than
  // importing 19 accounts under the wrong head.
  const chartIds = {};
  for (const chartCode of new Set(LEGACY_ACCOUNTS.map((a) => a.chartCode))) {
    const found = await pool.request()
      .input('code', sql.VarChar, chartCode)
      .query('SELECT ac_id FROM dbo.chart_of_accounts WHERE code = @code');
    if (!found.recordset.length) {
      throw new Error(`Legacy import: chart account ${chartCode} not found — seed reserved accounts first`);
    }
    chartIds[chartCode] = found.recordset[0].ac_id;
  }

  let imported = 0;
  for (const account of LEGACY_ACCOUNTS) {
    const exists = await pool.request()
      .input('legacyCode', sql.VarChar, account.legacyCode)
      .query('SELECT 1 FROM dbo.business_accounts WHERE legacy_code = @legacyCode');
    if (exists.recordset.length) continue;

    const code = await nextCode(pool, account.chartCode);
    await pool.request()
      .input('code', sql.VarChar, code)
      .input('legacyCode', sql.VarChar, account.legacyCode)
      .input('name', sql.NVarChar, account.name)
      .input('acId', sql.Int, chartIds[account.chartCode])
      .input('regionId', sql.Int, regionId)
      .input('cityId', sql.Int, cityId)
      .query(`INSERT INTO dbo.business_accounts (code, legacy_code, name, ac_id, region_id, city_id)
              VALUES (@code, @legacyCode, @name, @acId, @regionId, @cityId)`);
    imported += 1;
  }

  if (imported) console.log(`seeded ${imported} legacy business account(s) from the old KHAATA ledger`);
}

module.exports = { seedLegacyAccounts, LEGACY_ACCOUNTS };
