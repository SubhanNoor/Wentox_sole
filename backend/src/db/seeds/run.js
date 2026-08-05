// Idempotent seed script (npm run seed). Inserts only what's missing per schema v4.3 §8 —
// safe to re-run against a database that already has some/all of this data.
const bcrypt = require('bcrypt');
const sql = require('mssql');
const config = require('../../config');
const CODES = require('../../constants/reservedAccounts');
const STAGES = require('../../constants/stages');

async function ensureGroupAccount(pool, { code, name, classCode }) {
  const existing = await pool.request()
    .input('code', sql.VarChar, code)
    .query('SELECT group_id FROM dbo.group_accounts WHERE code = @code');
  if (existing.recordset.length) return existing.recordset[0].group_id;

  const cls = await pool.request()
    .input('code', sql.VarChar, classCode)
    .query('SELECT class_id FROM dbo.account_classes WHERE code = @code');
  const classId = cls.recordset[0].class_id;

  const inserted = await pool.request()
    .input('code', sql.VarChar, code)
    .input('name', sql.NVarChar, name)
    .input('classId', sql.Int, classId)
    .query(`INSERT INTO dbo.group_accounts (code, name, class_id)
            OUTPUT inserted.group_id VALUES (@code, @name, @classId)`);
  return inserted.recordset[0].group_id;
}

// Cash needs a business_accounts row exactly like every bank does — schema.sql's own comment on
// business_accounts.opening_balance says so ("cash needs one, every bank needs one"), and
// cash_and_bank.md §9 decisions 4/5 require it (single Petty Cash account, opening balance lives
// on business_accounts). Never seeded until now — without it, dbo.transfers (FK to
// business_accounts only) has no row to reference for a cash<->bank transfer at all. One row only,
// code = chartCode + '0001' (§3.2 composition, same as every other reserved-account party).
async function ensureCashBusinessAccount(pool, cashAcId, chartCode) {
  const existing = await pool.request()
    .input('acId', sql.Int, cashAcId)
    .query('SELECT ba_id FROM dbo.business_accounts WHERE ac_id = @acId');
  if (existing.recordset.length) return existing.recordset[0].ba_id;

  const code = chartCode + '0001';
  const inserted = await pool.request()
    .input('code', sql.VarChar, code)
    .input('name', sql.NVarChar, 'CASH IN HAND')
    .input('acId', sql.Int, cashAcId)
    .query(`INSERT INTO dbo.business_accounts (code, name, ac_id)
            OUTPUT inserted.ba_id VALUES (@code, @name, @acId)`);
  return inserted.recordset[0].ba_id;
}

async function ensureChartAccount(pool, { code, name, groupId, isRestricted = false }) {
  const existing = await pool.request()
    .input('code', sql.VarChar, code)
    .query('SELECT ac_id FROM dbo.chart_of_accounts WHERE code = @code');
  if (existing.recordset.length) return existing.recordset[0].ac_id;

  const inserted = await pool.request()
    .input('code', sql.VarChar, code)
    .input('name', sql.NVarChar, name)
    .input('groupId', sql.Int, groupId)
    .input('isRestricted', sql.Bit, isRestricted)
    .query(`INSERT INTO dbo.chart_of_accounts (code, name, group_id, is_restricted)
            OUTPUT inserted.ac_id VALUES (@code, @name, @groupId, @isRestricted)`);
  return inserted.recordset[0].ac_id;
}

async function seed() {
  const pool = await new sql.ConnectionPool(config.db).connect();

  // --- Admin user ---
  const adminExists = await pool.request()
    .input('username', sql.VarChar, 'admin')
    .query('SELECT 1 FROM dbo.users WHERE username = @username');
  if (!adminExists.recordset.length) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await pool.request()
      .input('username', sql.VarChar, 'admin')
      .input('passwordHash', sql.VarChar, passwordHash)
      .input('role', sql.VarChar, 'ADMIN')
      .query(`INSERT INTO dbo.users (username, password_hash, role)
              VALUES (@username, @passwordHash, @role)`);
    console.log('seeded admin user (username: admin, password: admin123 — change immediately)');
  }

  // --- Account classes (§8) ---
  const classes = [
    { code: 'ASSETS', name: 'Assets' },
    { code: 'LIABILITY', name: 'Liability' },
    { code: 'INCOME', name: 'Income' },
    { code: 'EXPENSES', name: 'Expenses' },
  ];
  for (const c of classes) {
    const exists = await pool.request()
      .input('code', sql.VarChar, c.code)
      .query('SELECT 1 FROM dbo.account_classes WHERE code = @code');
    if (!exists.recordset.length) {
      await pool.request()
        .input('code', sql.VarChar, c.code)
        .input('name', sql.NVarChar, c.name)
        .query('INSERT INTO dbo.account_classes (code, name) VALUES (@code, @name)');
    }
  }

  // --- Group accounts (§8: one group per class, 4-digit codes) ---
  const assetsGroup = await ensureGroupAccount(pool, { code: '1000', name: 'Assets', classCode: 'ASSETS' });
  const liabilityGroup = await ensureGroupAccount(pool, { code: '2000', name: 'Liability', classCode: 'LIABILITY' });
  const incomeGroup = await ensureGroupAccount(pool, { code: '3000', name: 'Income', classCode: 'INCOME' });
  const expensesGroup = await ensureGroupAccount(pool, { code: '4000', name: 'Expenses', classCode: 'EXPENSES' });

  // --- Reserved chart accounts (§8) ---
  await ensureChartAccount(pool, { code: CODES.CUSTOMERS_ACCOUNTS, name: 'CUSTOMERS ACCOUNTS', groupId: assetsGroup });
  await ensureChartAccount(pool, { code: CODES.VENDORS_ACCOUNTS, name: 'VENDORS ACCOUNTS', groupId: liabilityGroup });
  const cashAcId = await ensureChartAccount(pool, { code: CODES.CASH_IN_HAND, name: 'CASH IN HAND', groupId: assetsGroup });
  await ensureCashBusinessAccount(pool, cashAcId, CODES.CASH_IN_HAND);
  await ensureChartAccount(pool, {
    code: CODES.BANK_ACCOUNTS, name: 'BANK ACCOUNTS', groupId: assetsGroup, isRestricted: true,
  });
  await ensureChartAccount(pool, { code: CODES.SALES, name: 'SALES', groupId: incomeGroup });
  await ensureChartAccount(pool, { code: CODES.PURCHASES, name: 'PURCHASES', groupId: expensesGroup });
  await ensureChartAccount(pool, { code: CODES.COMMISSION_ALLOWED, name: 'COMMISSION ALLOWED', groupId: expensesGroup });
  await ensureChartAccount(pool, { code: CODES.CHEQUES_IN_HAND, name: 'CHEQUES IN HAND', groupId: assetsGroup });

  // --- Payment Trail chart accounts (TASK-17) ---
  await ensureChartAccount(pool, {
    code: CODES.BUSINESS_RUNNING_EXPENSES, name: 'Business Running Expenses', groupId: expensesGroup,
  });
  await ensureChartAccount(pool, {
    code: CODES.DIRECTORS_DRAWINGS, name: 'Directors Expenses - Drawings', groupId: expensesGroup, isRestricted: true,
  });
  await ensureChartAccount(pool, { code: CODES.EMPLOYEES, name: 'Employees', groupId: expensesGroup });
  await ensureChartAccount(pool, { code: CODES.VENDORS_SUPPLIERS, name: 'Vendors - Suppliers', groupId: liabilityGroup });

  // --- Payroll chart accounts (Module 4.5 — payroll.md §6) ---
  await ensureChartAccount(pool, { code: CODES.WORKER_WAGES, name: 'WORKER WAGES', groupId: liabilityGroup });
  await ensureChartAccount(pool, { code: CODES.SALARIES_PAYABLE, name: 'SALARIES PAYABLE', groupId: liabilityGroup });
  await ensureChartAccount(pool, { code: CODES.WAGES_EXPENSE, name: 'WAGES EXPENSE', groupId: expensesGroup });
  await ensureChartAccount(pool, { code: CODES.SALARIES_EXPENSE, name: 'SALARIES EXPENSE', groupId: expensesGroup });

  // --- Stages (payroll.md §4) — the 12 manufacturing stages, defined once as data ---
  for (const [index, stage] of STAGES.entries()) {
    const exists = await pool.request()
      .input('stageKey', sql.VarChar, stage.stage_key)
      .query('SELECT 1 FROM dbo.stages WHERE stage_key = @stageKey');
    if (!exists.recordset.length) {
      await pool.request()
        .input('stageKey', sql.VarChar, stage.stage_key)
        .input('formLabel', sql.NVarChar, stage.form_label)
        .input('workerLabel', sql.NVarChar, stage.worker_label)
        .input('costColumn', sql.VarChar, stage.cost_column)
        .input('sortOrder', sql.Int, index + 1)
        .query(`INSERT INTO dbo.stages (stage_key, form_label, worker_label, cost_column, sort_order)
                VALUES (@stageKey, @formLabel, @workerLabel, @costColumn, @sortOrder)`);
    }
  }

  // --- Default store ---
  const storeExists = await pool.request()
    .input('name', sql.NVarChar, 'Main Store')
    .query('SELECT 1 FROM dbo.stores WHERE name = @name');
  if (!storeExists.recordset.length) {
    await pool.request()
      .input('name', sql.NVarChar, 'Main Store')
      .query('INSERT INTO dbo.stores (name) VALUES (@name)');
    console.log('seeded default store: Main Store');
  }

  await pool.close();
  console.log('seed complete');
}

seed().catch((err) => {
  console.error('seed failed:', err.message);
  process.exitCode = 1;
});
