// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  // A single ba_id matches EITHER side — "show me everything settled against this account" is the
  // question the Account Ledger drill-down asks, and it does not care which direction it went.
  if (filters.ba_id) {
    conditions.push('(s.from_ba_id = @baId OR s.to_ba_id = @baId)');
    params.baId = { type: sql.Int, value: filters.ba_id };
  }
  if (filters.from_ba_id) {
    conditions.push('s.from_ba_id = @fromBaId');
    params.fromBaId = { type: sql.Int, value: filters.from_ba_id };
  }
  if (filters.to_ba_id) {
    conditions.push('s.to_ba_id = @toBaId');
    params.toBaId = { type: sql.Int, value: filters.to_ba_id };
  }
  if (filters.status) {
    conditions.push('s.status = @status');
    params.status = { type: sql.VarChar(10), value: filters.status };
  }
  if (filters.date_from) {
    conditions.push('s.settlement_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('s.settlement_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT s.*, f.name AS from_name, t.name AS to_name
     FROM dbo.settlements s
     JOIN dbo.business_accounts f ON f.ba_id = s.from_ba_id
     JOIN dbo.business_accounts t ON t.ba_id = s.to_ba_id
     ${where}
     ORDER BY s.settlement_date DESC, s.settlement_id DESC`,
    params,
  );
  return result.recordset;
}

async function findById(settlementId) {
  const result = await query(
    `SELECT s.*, f.name AS from_name, t.name AS to_name
     FROM dbo.settlements s
     JOIN dbo.business_accounts f ON f.ba_id = s.from_ba_id
     JOIN dbo.business_accounts t ON t.ba_id = s.to_ba_id
     WHERE s.settlement_id = @settlementId`,
    { settlementId: { type: sql.Int, value: settlementId } },
  );
  return result.recordset[0] || null;
}

// 'DRAFT' passed explicitly even though the column now defaults to it — the same discipline every
// other document table's insert uses, so the create-then-post shape is readable here without
// looking up the DDL.
async function insert(transaction, settlement) {
  const request = requestWithParams(transaction, {
    settlementDate: { type: sql.Date, value: settlement.settlement_date },
    fromBaId: { type: sql.Int, value: settlement.from_ba_id },
    toBaId: { type: sql.Int, value: settlement.to_ba_id },
    amount: { type: sql.Decimal(14, 2), value: settlement.amount },
    paymentMode: { type: sql.VarChar(10), value: settlement.payment_mode ?? null },
    chequeNo: { type: sql.VarChar(50), value: settlement.cheque_no ?? null },
    chequeDate: { type: sql.Date, value: settlement.cheque_date ?? null },
    remarks: { type: sql.NVarChar(500), value: settlement.remarks ?? null },
    createdBy: { type: sql.Int, value: settlement.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.settlements (settlement_date, from_ba_id, to_ba_id, amount,
                                 payment_mode, cheque_no, cheque_date, remarks, status, created_by)
    OUTPUT inserted.settlement_id
    VALUES (@settlementDate, @fromBaId, @toBaId, @amount,
            @paymentMode, @chequeNo, @chequeDate, @remarks, 'DRAFT', @createdBy)
  `);
  return result.recordset[0].settlement_id;
}

async function update(settlementId, settlement) {
  await query(
    `UPDATE dbo.settlements SET
       settlement_date = @settlementDate, from_ba_id = @fromBaId, to_ba_id = @toBaId,
       amount = @amount, payment_mode = @paymentMode, cheque_no = @chequeNo,
       cheque_date = @chequeDate, remarks = @remarks
     WHERE settlement_id = @settlementId`,
    {
      settlementId: { type: sql.Int, value: settlementId },
      settlementDate: { type: sql.Date, value: settlement.settlement_date },
      fromBaId: { type: sql.Int, value: settlement.from_ba_id },
      toBaId: { type: sql.Int, value: settlement.to_ba_id },
      amount: { type: sql.Decimal(14, 2), value: settlement.amount },
      paymentMode: { type: sql.VarChar(10), value: settlement.payment_mode ?? null },
      chequeNo: { type: sql.VarChar(50), value: settlement.cheque_no ?? null },
      chequeDate: { type: sql.Date, value: settlement.cheque_date ?? null },
      remarks: { type: sql.NVarChar(500), value: settlement.remarks ?? null },
    },
  );
}

async function remove(settlementId) {
  await query(
    'DELETE FROM dbo.settlements WHERE settlement_id = @settlementId',
    { settlementId: { type: sql.Int, value: settlementId } },
  );
}

async function setStatus(transaction, settlementId, status, updatedBy) {
  const request = requestWithParams(transaction, {
    settlementId: { type: sql.Int, value: settlementId },
    status: { type: sql.VarChar(10), value: status },
    updatedBy: { type: sql.Int, value: updatedBy ?? null },
  });
  await request.query(
    'UPDATE dbo.settlements SET status = @status, updated_by = @updatedBy WHERE settlement_id = @settlementId',
  );
}

// One ledger pair: Dr the creditor we owed / Cr the debtor who paid them on our behalf.
//
// BOTH rows carry ba_id and neither carries ac_id. That is the whole point of this document type —
// with no chart account on either leg, a settlement cannot reach CASH IN HAND, a bank account or
// CHEQUES IN HAND even by accident, because there is nowhere for it to go.
//
// Each leg's narration names the OTHER side, so reading either account's Khaata says explicitly
// where the money actually went rather than leaving an unexplained balance movement.
async function insertLedgerEntries(transaction, { settlementId, settlementDate, fromBaId, toBaId, fromName, toName, amount }) {
  const rows = [
    {
      ba_id: toBaId, debit: amount, credit: 0,
      narration: `Settled directly by ${fromName} (Settlement #${settlementId})`,
    },
    {
      ba_id: fromBaId, debit: 0, credit: amount,
      narration: `Settled directly to ${toName} (Settlement #${settlementId})`,
    },
  ];
  for (const row of rows) {
    const request = requestWithParams(transaction, {
      entryDate: { type: sql.Date, value: settlementDate },
      baId: { type: sql.Int, value: row.ba_id },
      debit: { type: sql.Decimal(14, 2), value: row.debit },
      credit: { type: sql.Decimal(14, 2), value: row.credit },
      sourceId: { type: sql.Int, value: settlementId },
      narration: { type: sql.NVarChar(500), value: row.narration },
    });
    await request.query(`
      INSERT INTO dbo.ledger_entries (entry_date, ba_id, debit, credit, source_type, source_id, narration)
      VALUES (@entryDate, @baId, @debit, @credit, 'SETTLEMENT', @sourceId, @narration)
    `);
  }
}

async function deleteLedgerEntries(transaction, settlementId) {
  const request = requestWithParams(transaction, { settlementId: { type: sql.Int, value: settlementId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type = 'SETTLEMENT' AND source_id = @settlementId`,
  );
}

module.exports = {
  list, findById, insert, update, remove, setStatus, insertLedgerEntries, deleteLedgerEntries,
};
