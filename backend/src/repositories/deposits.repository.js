// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.to_ba_id) {
    conditions.push('to_ba_id = @toBaId');
    params.toBaId = { type: sql.Int, value: filters.to_ba_id };
  }
  if (filters.direction) {
    conditions.push('direction = @direction');
    params.direction = { type: sql.VarChar(10), value: filters.direction };
  }
  if (filters.date_from) {
    conditions.push('deposit_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('deposit_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT d.*, ba.name AS to_name
     FROM dbo.deposits d
     JOIN dbo.business_accounts ba ON ba.ba_id = d.to_ba_id
     ${where}
     ORDER BY d.deposit_date DESC, d.deposit_id DESC`,
    params,
  );
  return result.recordset;
}

async function findById(depositId) {
  const result = await query(
    `SELECT d.*, ba.name AS to_name
     FROM dbo.deposits d
     JOIN dbo.business_accounts ba ON ba.ba_id = d.to_ba_id
     WHERE d.deposit_id = @depositId`,
    { depositId: { type: sql.Int, value: depositId } },
  );
  return result.recordset[0] || null;
}

// Always created DRAFT regardless of the table's DEFAULT — post() is the only thing that moves a
// deposit to CONFIRMED (same create-as-DRAFT-then-post shape as transfers/purchases).
async function insert(transaction, deposit) {
  const request = requestWithParams(transaction, {
    depositDate: { type: sql.Date, value: deposit.deposit_date },
    toBaId: { type: sql.Int, value: deposit.to_ba_id },
    direction: { type: sql.VarChar(10), value: deposit.direction },
    amount: { type: sql.Decimal(14, 2), value: deposit.amount },
    source: { type: sql.NVarChar(200), value: deposit.source },
    remarks: { type: sql.NVarChar(500), value: deposit.remarks ?? null },
    createdBy: { type: sql.Int, value: deposit.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.deposits (deposit_date, to_ba_id, direction, amount, source, remarks, status, created_by)
    OUTPUT inserted.deposit_id
    VALUES (@depositDate, @toBaId, @direction, @amount, @source, @remarks, 'DRAFT', @createdBy)
  `);
  return result.recordset[0].deposit_id;
}

async function update(depositId, deposit) {
  await query(
    `UPDATE dbo.deposits SET
       deposit_date = @depositDate, to_ba_id = @toBaId, direction = @direction,
       amount = @amount, source = @source, remarks = @remarks
     WHERE deposit_id = @depositId`,
    {
      depositId: { type: sql.Int, value: depositId },
      depositDate: { type: sql.Date, value: deposit.deposit_date },
      toBaId: { type: sql.Int, value: deposit.to_ba_id },
      direction: { type: sql.VarChar(10), value: deposit.direction },
      amount: { type: sql.Decimal(14, 2), value: deposit.amount },
      source: { type: sql.NVarChar(200), value: deposit.source },
      remarks: { type: sql.NVarChar(500), value: deposit.remarks ?? null },
    },
  );
}

async function remove(depositId) {
  await query(
    'DELETE FROM dbo.deposits WHERE deposit_id = @depositId',
    { depositId: { type: sql.Int, value: depositId } },
  );
}

async function setStatus(transaction, depositId, status, updatedBy) {
  const request = requestWithParams(transaction, {
    depositId: { type: sql.Int, value: depositId },
    status: { type: sql.VarChar(10), value: status },
    updatedBy: { type: sql.Int, value: updatedBy ?? null },
  });
  await request.query(
    'UPDATE dbo.deposits SET status = @status, updated_by = @updatedBy WHERE deposit_id = @depositId',
  );
}

// One ledger pair per deposit against the fixed MISC_ADJUSTMENTS chart account (resolved by the
// service) — CREDIT: Dr to_ba_id / Cr MISC_ADJUSTMENTS; DEBIT: Dr MISC_ADJUSTMENTS / Cr to_ba_id.
async function insertLedgerEntries(transaction, rows) {
  for (const row of rows) {
    const request = requestWithParams(transaction, {
      entryDate: { type: sql.Date, value: row.entry_date },
      acId: { type: sql.Int, value: row.ac_id ?? null },
      baId: { type: sql.Int, value: row.ba_id ?? null },
      debit: { type: sql.Decimal(14, 2), value: row.debit },
      credit: { type: sql.Decimal(14, 2), value: row.credit },
      sourceType: { type: sql.VarChar(20), value: row.source_type },
      sourceId: { type: sql.Int, value: row.source_id },
      narration: { type: sql.NVarChar(500), value: row.narration ?? null },
    });
    await request.query(`
      INSERT INTO dbo.ledger_entries (entry_date, ac_id, ba_id, debit, credit, source_type, source_id, narration)
      VALUES (@entryDate, @acId, @baId, @debit, @credit, @sourceType, @sourceId, @narration)
    `);
  }
}

async function deleteLedgerEntries(transaction, depositId) {
  const request = requestWithParams(transaction, { depositId: { type: sql.Int, value: depositId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type = 'DEPOSIT' AND source_id = @depositId`,
  );
}

module.exports = {
  list, findById, insert, update, remove, setStatus, insertLedgerEntries, deleteLedgerEntries,
};
