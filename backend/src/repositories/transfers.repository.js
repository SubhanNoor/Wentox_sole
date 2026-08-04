// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.from_ba_id) {
    conditions.push('from_ba_id = @fromBaId');
    params.fromBaId = { type: sql.Int, value: filters.from_ba_id };
  }
  if (filters.to_ba_id) {
    conditions.push('to_ba_id = @toBaId');
    params.toBaId = { type: sql.Int, value: filters.to_ba_id };
  }
  if (filters.date_from) {
    conditions.push('transfer_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('transfer_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT t.*, f.name AS from_name, tb.name AS to_name
     FROM dbo.transfers t
     JOIN dbo.business_accounts f  ON f.ba_id  = t.from_ba_id
     JOIN dbo.business_accounts tb ON tb.ba_id = t.to_ba_id
     ${where}
     ORDER BY t.transfer_date DESC, t.transfer_id DESC`,
    params,
  );
  return result.recordset;
}

async function findById(transferId) {
  const result = await query(
    `SELECT t.*, f.name AS from_name, tb.name AS to_name
     FROM dbo.transfers t
     JOIN dbo.business_accounts f  ON f.ba_id  = t.from_ba_id
     JOIN dbo.business_accounts tb ON tb.ba_id = t.to_ba_id
     WHERE t.transfer_id = @transferId`,
    { transferId: { type: sql.Int, value: transferId } },
  );
  return result.recordset[0] || null;
}

// Always created DRAFT regardless of the table's DEFAULT ('CONFIRMED') — post() is the only thing
// that moves a transfer to CONFIRMED, so create() explicitly overrides the column default rather
// than relying on it (same create-as-DRAFT-then-post shape as receipts/expenses/purchases).
async function insert(transaction, transfer) {
  const request = requestWithParams(transaction, {
    transferDate: { type: sql.Date, value: transfer.transfer_date },
    fromBaId: { type: sql.Int, value: transfer.from_ba_id },
    toBaId: { type: sql.Int, value: transfer.to_ba_id },
    amount: { type: sql.Decimal(14, 2), value: transfer.amount },
    remarks: { type: sql.NVarChar(500), value: transfer.remarks ?? null },
    createdBy: { type: sql.Int, value: transfer.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.transfers (transfer_date, from_ba_id, to_ba_id, amount, remarks, status, created_by)
    OUTPUT inserted.transfer_id
    VALUES (@transferDate, @fromBaId, @toBaId, @amount, @remarks, 'DRAFT', @createdBy)
  `);
  return result.recordset[0].transfer_id;
}

async function update(transferId, transfer) {
  await query(
    `UPDATE dbo.transfers SET
       transfer_date = @transferDate, from_ba_id = @fromBaId, to_ba_id = @toBaId,
       amount = @amount, remarks = @remarks
     WHERE transfer_id = @transferId`,
    {
      transferId: { type: sql.Int, value: transferId },
      transferDate: { type: sql.Date, value: transfer.transfer_date },
      fromBaId: { type: sql.Int, value: transfer.from_ba_id },
      toBaId: { type: sql.Int, value: transfer.to_ba_id },
      amount: { type: sql.Decimal(14, 2), value: transfer.amount },
      remarks: { type: sql.NVarChar(500), value: transfer.remarks ?? null },
    },
  );
}

async function remove(transferId) {
  await query(
    'DELETE FROM dbo.transfers WHERE transfer_id = @transferId',
    { transferId: { type: sql.Int, value: transferId } },
  );
}

async function setStatus(transaction, transferId, status, updatedBy) {
  const request = requestWithParams(transaction, {
    transferId: { type: sql.Int, value: transferId },
    status: { type: sql.VarChar(10), value: status },
    updatedBy: { type: sql.Int, value: updatedBy ?? null },
  });
  await request.query(
    'UPDATE dbo.transfers SET status = @status, updated_by = @updatedBy WHERE transfer_id = @transferId',
  );
}

// One ledger pair per transfer: Dr destination / Cr source (cash_and_bank.md §7).
async function insertLedgerEntries(transaction, { transferId, transferDate, fromBaId, toBaId, amount }) {
  const rows = [
    {
      entry_date: transferDate, ba_id: toBaId, debit: amount, credit: 0,
      source_type: 'TRANSFER', source_id: transferId, narration: `Transfer #${transferId}`,
    },
    {
      entry_date: transferDate, ba_id: fromBaId, debit: 0, credit: amount,
      source_type: 'TRANSFER', source_id: transferId, narration: `Transfer #${transferId}`,
    },
  ];
  for (const row of rows) {
    const request = requestWithParams(transaction, {
      entryDate: { type: sql.Date, value: row.entry_date },
      baId: { type: sql.Int, value: row.ba_id },
      debit: { type: sql.Decimal(14, 2), value: row.debit },
      credit: { type: sql.Decimal(14, 2), value: row.credit },
      sourceType: { type: sql.VarChar(20), value: row.source_type },
      sourceId: { type: sql.Int, value: row.source_id },
      narration: { type: sql.NVarChar(500), value: row.narration },
    });
    await request.query(`
      INSERT INTO dbo.ledger_entries (entry_date, ba_id, debit, credit, source_type, source_id, narration)
      VALUES (@entryDate, @baId, @debit, @credit, @sourceType, @sourceId, @narration)
    `);
  }
}

async function deleteLedgerEntries(transaction, transferId) {
  const request = requestWithParams(transaction, { transferId: { type: sql.Int, value: transferId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type = 'TRANSFER' AND source_id = @transferId`,
  );
}

module.exports = {
  list, findById, insert, update, remove, setStatus, insertLedgerEntries, deleteLedgerEntries,
};
