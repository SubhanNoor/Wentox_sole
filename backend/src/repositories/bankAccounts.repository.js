// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function list(filters = {}) {
  const where = filters.includeInactive ? '' : 'WHERE is_active = 1';
  const result = await query(`SELECT * FROM dbo.bank_accounts ${where} ORDER BY name`);
  return result.recordset;
}

async function findById(bankId) {
  const result = await query(
    'SELECT * FROM dbo.bank_accounts WHERE bank_id = @bankId',
    { bankId: { type: sql.Int, value: bankId } },
  );
  return result.recordset[0] || null;
}

// Two bank accounts CAN share a bank name (two different "Meezan Bank" accounts) — so the match
// key is name + account_no together, not name alone. Case-insensitive on name (explicit LOWER(),
// not relying on DB collation); account_no compares NULL-safe so two no-account_no entries with
// the same name still collide.
async function findByNameAndAccountNo(name, accountNo) {
  const result = await query(
    `SELECT * FROM dbo.bank_accounts
     WHERE LOWER(name) = LOWER(@name)
       AND ((account_no IS NULL AND @accountNo IS NULL) OR account_no = @accountNo)`,
    {
      name: { type: sql.NVarChar(100), value: name },
      accountNo: { type: sql.NVarChar(50), value: accountNo ?? null },
    },
  );
  return result.recordset[0] || null;
}

// Takes the caller's transaction — always called in the same withTransaction block as the
// business_accounts row it links to (bankAccounts.service.js:create()), so the bank account and
// its ledger account commit or roll back together (never an orphaned business_accounts row).
async function insert(transaction, bankAccount) {
  const request = requestWithParams(transaction, {
    name: { type: sql.NVarChar(100), value: bankAccount.name },
    accountNo: { type: sql.NVarChar(50), value: bankAccount.account_no ?? null },
    branch: { type: sql.NVarChar(100), value: bankAccount.branch ?? null },
    baId: { type: sql.Int, value: bankAccount.ba_id ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.bank_accounts (name, account_no, branch, ba_id)
    OUTPUT inserted.bank_id
    VALUES (@name, @accountNo, @branch, @baId)
  `);
  return result.recordset[0].bank_id;
}

async function update(bankId, bankAccount) {
  await query(
    `UPDATE dbo.bank_accounts SET
       name = @name, account_no = @accountNo, branch = @branch
     WHERE bank_id = @bankId`,
    {
      bankId: { type: sql.Int, value: bankId },
      name: { type: sql.NVarChar(100), value: bankAccount.name },
      accountNo: { type: sql.NVarChar(50), value: bankAccount.account_no ?? null },
      branch: { type: sql.NVarChar(100), value: bankAccount.branch ?? null },
    },
  );
}

async function setActive(bankId, isActive) {
  await query(
    'UPDATE dbo.bank_accounts SET is_active = @isActive WHERE bank_id = @bankId',
    { bankId: { type: sql.Int, value: bankId }, isActive: { type: sql.Bit, value: isActive } },
  );
}

module.exports = { list, findById, findByNameAndAccountNo, insert, update, setActive };
