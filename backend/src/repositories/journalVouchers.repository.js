// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.ba_id) {
    conditions.push('jv.ba_id = @baId');
    params.baId = { type: sql.Int, value: filters.ba_id };
  }
  if (filters.direction) {
    conditions.push('jv.direction = @direction');
    params.direction = { type: sql.VarChar(10), value: filters.direction };
  }
  if (filters.status) {
    conditions.push('jv.status = @status');
    params.status = { type: sql.VarChar(10), value: filters.status };
  }
  if (filters.date_from) {
    conditions.push('jv.jv_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('jv.jv_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT jv.*, ba.name AS ba_name, ba.code AS ba_code, ca.name AS main_account
     FROM dbo.journal_vouchers jv
     JOIN dbo.business_accounts ba ON ba.ba_id = jv.ba_id
     JOIN dbo.chart_of_accounts ca ON ca.ac_id = ba.ac_id
     ${where}
     ORDER BY jv.jv_date DESC, jv.jv_id DESC`,
    params,
  );
  return result.recordset;
}

async function findById(jvId) {
  const result = await query(
    `SELECT jv.*, ba.name AS ba_name, ba.code AS ba_code, ca.name AS main_account
     FROM dbo.journal_vouchers jv
     JOIN dbo.business_accounts ba ON ba.ba_id = jv.ba_id
     JOIN dbo.chart_of_accounts ca ON ca.ac_id = ba.ac_id
     WHERE jv.jv_id = @jvId`,
    { jvId: { type: sql.Int, value: jvId } },
  );
  return result.recordset[0] || null;
}

async function insert(transaction, jv) {
  const request = requestWithParams(transaction, {
    jvDate: { type: sql.Date, value: jv.jv_date },
    baId: { type: sql.Int, value: jv.ba_id },
    direction: { type: sql.VarChar(10), value: jv.direction },
    amount: { type: sql.Decimal(14, 2), value: jv.amount },
    reason: { type: sql.NVarChar(200), value: jv.reason },
    remarks: { type: sql.NVarChar(500), value: jv.remarks ?? null },
    createdBy: { type: sql.Int, value: jv.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.journal_vouchers (jv_date, ba_id, direction, amount, reason, remarks, status, created_by)
    OUTPUT inserted.jv_id
    VALUES (@jvDate, @baId, @direction, @amount, @reason, @remarks, 'DRAFT', @createdBy)
  `);
  return result.recordset[0].jv_id;
}

async function update(jvId, jv) {
  await query(
    `UPDATE dbo.journal_vouchers SET
       jv_date = @jvDate, ba_id = @baId, direction = @direction,
       amount = @amount, reason = @reason, remarks = @remarks
     WHERE jv_id = @jvId`,
    {
      jvId: { type: sql.Int, value: jvId },
      jvDate: { type: sql.Date, value: jv.jv_date },
      baId: { type: sql.Int, value: jv.ba_id },
      direction: { type: sql.VarChar(10), value: jv.direction },
      amount: { type: sql.Decimal(14, 2), value: jv.amount },
      reason: { type: sql.NVarChar(200), value: jv.reason },
      remarks: { type: sql.NVarChar(500), value: jv.remarks ?? null },
    },
  );
}

async function remove(jvId) {
  await query('DELETE FROM dbo.journal_vouchers WHERE jv_id = @jvId', {
    jvId: { type: sql.Int, value: jvId },
  });
}

async function setStatus(transaction, jvId, status, updatedBy) {
  const request = requestWithParams(transaction, {
    jvId: { type: sql.Int, value: jvId },
    status: { type: sql.VarChar(10), value: status },
    updatedBy: { type: sql.Int, value: updatedBy ?? null },
  });
  await request.query(
    'UPDATE dbo.journal_vouchers SET status = @status, updated_by = @updatedBy WHERE jv_id = @jvId',
  );
}

// One ledger pair, both legs ba_id — the party's account and the JOURNAL VOUCHER account.
//
//   CREDIT  Dr JOURNAL VOUCHER / Cr party   -> what the party owes us goes DOWN (the eidi case)
//   DEBIT   Dr party / Cr JOURNAL VOUCHER   -> what we owe the party goes DOWN
//
// Each leg's narration names the reason and the other side, so neither ledger shows an
// unexplained balance movement — the party's Khaata says a JV was applied and why, and the JV
// account's own ledger says who it was granted to.
async function insertLedgerEntries(transaction, { jvId, jvDate, baId, jvBaId, direction, amount, reason, partyName }) {
  const partyIsDebit = direction === 'DEBIT';
  const rows = [
    {
      ba_id: baId,
      debit: partyIsDebit ? amount : 0,
      credit: partyIsDebit ? 0 : amount,
      narration: `Journal Voucher #${jvId} — ${reason}`,
    },
    {
      ba_id: jvBaId,
      debit: partyIsDebit ? 0 : amount,
      credit: partyIsDebit ? amount : 0,
      narration: `JV #${jvId} to ${partyName} — ${reason}`,
    },
  ];
  for (const row of rows) {
    const request = requestWithParams(transaction, {
      entryDate: { type: sql.Date, value: jvDate },
      baId: { type: sql.Int, value: row.ba_id },
      debit: { type: sql.Decimal(14, 2), value: row.debit },
      credit: { type: sql.Decimal(14, 2), value: row.credit },
      sourceId: { type: sql.Int, value: jvId },
      narration: { type: sql.NVarChar(500), value: row.narration },
    });
    await request.query(`
      INSERT INTO dbo.ledger_entries (entry_date, ba_id, debit, credit, source_type, source_id, narration)
      VALUES (@entryDate, @baId, @debit, @credit, 'JOURNAL_VOUCHER', @sourceId, @narration)
    `);
  }
}

async function deleteLedgerEntries(transaction, jvId) {
  const request = requestWithParams(transaction, { jvId: { type: sql.Int, value: jvId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type = 'JOURNAL_VOUCHER' AND source_id = @jvId`,
  );
}

module.exports = {
  list, findById, insert, update, remove, setStatus, insertLedgerEntries, deleteLedgerEntries,
};
