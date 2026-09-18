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

// ACC-02 (changes-14-09-26.md, 2026-09-15): "carries transactions" — a bank account never carries
// ledger_entries directly (there's no bank_id column on that table); every payment/receipt/
// transfer through it posts against its LINKED business_accounts row instead (bank_accounts.ba_id
// — see schema.sql's own comment). So "does this bank have activity" means the linked ba_id's own
// ledger activity plus its own opening balance, same two checks businessAccounts.service.js#remove
// applies to any other business account.
async function hasLedgerActivity(bankId) {
  const result = await query(
    `SELECT TOP 1 1 AS found
     FROM dbo.bank_accounts ba
     JOIN dbo.ledger_entries le ON le.ba_id = ba.ba_id
     WHERE ba.bank_id = @bankId`,
    { bankId: { type: sql.Int, value: bankId } },
  );
  return result.recordset.length > 0;
}

async function findLinkedOpeningBalance(bankId) {
  const result = await query(
    `SELECT b.opening_balance
     FROM dbo.bank_accounts ba
     JOIN dbo.business_accounts b ON b.ba_id = ba.ba_id
     WHERE ba.bank_id = @bankId`,
    { bankId: { type: sql.Int, value: bankId } },
  );
  return result.recordset[0]?.opening_balance ?? null;
}

// Permanent delete (per the user, 2026-09-17 — added on top of the existing soft-close, not
// instead of it). Scoped the same way remove() is: only this bank_accounts row is ever hard-
// deleted, never its linked business_accounts row (that stays intact for ledger/history integrity,
// same reasoning as remove()'s own comment). So this only needs to cover every FK that points at
// bank_id itself — cheques.bank_id, receipts/draft_receipts.bank_id, expenses/draft_expenses.
// bank_id — not the linked ba_id's own references (businessAccounts.repository.js#hasAnyReference
// already covers that row separately, if it's ever hard-deleted on its own).
async function hasAnyReference(bankId) {
  const result = await query(
    `SELECT
       (SELECT TOP 1 1 FROM dbo.cheques WHERE bank_id = @bankId) AS cheque,
       (SELECT TOP 1 1 FROM dbo.receipts WHERE bank_id = @bankId) AS receipt,
       (SELECT TOP 1 1 FROM dbo.draft_receipts WHERE bank_id = @bankId) AS draftReceipt,
       (SELECT TOP 1 1 FROM dbo.expenses WHERE bank_id = @bankId) AS expense,
       (SELECT TOP 1 1 FROM dbo.draft_expenses WHERE bank_id = @bankId) AS draftExpense`,
    { bankId: { type: sql.Int, value: bankId } },
  );
  const row = result.recordset[0];
  return Object.values(row).some((v) => v != null);
}

async function hardDelete(transaction, bankId) {
  const request = requestWithParams(transaction, { bankId: { type: sql.Int, value: bankId } });
  await request.query('DELETE FROM dbo.bank_accounts WHERE bank_id = @bankId');
}

module.exports = {
  list, findById, findByNameAndAccountNo, insert, update, setActive,
  hasLedgerActivity, findLinkedOpeningBalance, hasAnyReference, hardDelete,
};
