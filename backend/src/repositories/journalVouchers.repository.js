// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

function linesSubquery(alias = 'jv') {
  return `(
    SELECT jvl.jv_id,
           COUNT(*) AS line_count,
           SUM(jvl.debit) AS total_debit,
           SUM(jvl.credit) AS total_credit
    FROM dbo.journal_voucher_lines jvl
    WHERE jvl.jv_id = ${alias}.jv_id
  )`;
}

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.ba_id) {
    conditions.push('EXISTS (SELECT 1 FROM dbo.journal_voucher_lines jvl WHERE jvl.jv_id = jv.jv_id AND jvl.ba_id = @baId)');
    params.baId = { type: sql.Int, value: filters.ba_id };
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
  // "Find the JV from any detail" — matches the header (reason/number) or any of its lines
  // (account name/code, per-line narration, debit/credit amount), so a search box doesn't need
  // to know which field the thing it's looking for actually landed in.
  if (filters.search && filters.search.trim()) {
    conditions.push(`(
      jv.reason LIKE @search OR jv.voucher_no LIKE @search OR EXISTS (
        SELECT 1 FROM dbo.journal_voucher_lines s_jvl
        JOIN dbo.business_accounts s_ba ON s_ba.ba_id = s_jvl.ba_id
        WHERE s_jvl.jv_id = jv.jv_id AND (
          s_ba.name LIKE @search OR s_ba.code LIKE @search OR s_jvl.narration LIKE @search
          OR CAST(s_jvl.debit AS NVARCHAR(30)) LIKE @search OR CAST(s_jvl.credit AS NVARCHAR(30)) LIKE @search
        )
      )
    )`);
    params.search = { type: sql.NVarChar(120), value: `%${filters.search.trim()}%` };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT jv.*, totals.line_count, totals.total_debit, totals.total_credit
     FROM dbo.journal_vouchers jv
     CROSS APPLY ${linesSubquery('jv')} totals
     ${where}
     ORDER BY jv.jv_date DESC, jv.jv_id DESC`,
    params,
  );
  return result.recordset;
}

// Every JV still awaiting posting, oldest first — the order they were entered is the order they
// should post. Mirrors purchases.repository.js#listUnposted, but "unposted" reads straight off
// journal_vouchers.status rather than being derived from ledger_entries existing, since the JV
// table (unlike purchases) still carries its own status column.
async function listUnposted() {
  const result = await query(
    `SELECT jv.jv_id, jv.jv_date, jv.voucher_no, jv.reason, totals.total_debit
     FROM dbo.journal_vouchers jv
     CROSS APPLY ${linesSubquery('jv')} totals
     WHERE jv.status = 'DRAFT'
     ORDER BY jv.jv_date ASC, jv.jv_id ASC`,
  );
  return result.recordset;
}

async function getLines(jvId) {
  const result = await query(
    `SELECT jvl.*, ba.name AS ba_name, ba.code AS ba_code
     FROM dbo.journal_voucher_lines jvl
     JOIN dbo.business_accounts ba ON ba.ba_id = jvl.ba_id
     WHERE jvl.jv_id = @jvId
     ORDER BY jvl.line_no`,
    { jvId: { type: sql.Int, value: jvId } },
  );
  return result.recordset;
}

async function findById(jvId) {
  const result = await query(
    `SELECT jv.*, totals.line_count, totals.total_debit, totals.total_credit
     FROM dbo.journal_vouchers jv
     CROSS APPLY ${linesSubquery('jv')} totals
     WHERE jv.jv_id = @jvId`,
    { jvId: { type: sql.Int, value: jvId } },
  );
  const jv = result.recordset[0];
  if (!jv) return null;
  return { ...jv, lines: await getLines(jvId) };
}

async function insert(transaction, jv) {
  const request = requestWithParams(transaction, {
    jvDate: { type: sql.Date, value: jv.jv_date },
    voucherNo: { type: sql.NVarChar(30), value: jv.voucher_no ?? null },
    reason: { type: sql.NVarChar(200), value: jv.reason },
    remarks: { type: sql.NVarChar(500), value: jv.remarks ?? null },
    createdBy: { type: sql.Int, value: jv.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.journal_vouchers (jv_date, voucher_no, reason, remarks, status, created_by)
    OUTPUT inserted.jv_id
    VALUES (@jvDate, @voucherNo, @reason, @remarks, 'DRAFT', @createdBy)
  `);
  return result.recordset[0].jv_id;
}

async function updateHeader(transaction, jvId, jv) {
  const request = requestWithParams(transaction, {
    jvId: { type: sql.Int, value: jvId },
    jvDate: { type: sql.Date, value: jv.jv_date },
    voucherNo: { type: sql.NVarChar(30), value: jv.voucher_no ?? null },
    reason: { type: sql.NVarChar(200), value: jv.reason },
    remarks: { type: sql.NVarChar(500), value: jv.remarks ?? null },
  });
  await request.query(`
    UPDATE dbo.journal_vouchers SET
      jv_date = @jvDate, voucher_no = @voucherNo, reason = @reason, remarks = @remarks
    WHERE jv_id = @jvId
  `);
}

async function insertLines(transaction, jvId, lines) {
  for (const [index, line] of lines.entries()) {
    const request = requestWithParams(transaction, {
      jvId: { type: sql.Int, value: jvId },
      lineNo: { type: sql.Int, value: index + 1 },
      baId: { type: sql.Int, value: line.ba_id },
      debit: { type: sql.Decimal(14, 2), value: line.debit },
      credit: { type: sql.Decimal(14, 2), value: line.credit },
      narration: { type: sql.NVarChar(500), value: line.narration ?? null },
    });
    await request.query(`
      INSERT INTO dbo.journal_voucher_lines (jv_id, line_no, ba_id, debit, credit, narration)
      VALUES (@jvId, @lineNo, @baId, @debit, @credit, @narration)
    `);
  }
}

async function deleteLines(transaction, jvId) {
  const request = requestWithParams(transaction, { jvId: { type: sql.Int, value: jvId } });
  await request.query('DELETE FROM dbo.journal_voucher_lines WHERE jv_id = @jvId');
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

// One ledger_entries row per line — each line's own narration if given, else the header reason
// prefixed with the voucher id, so every ledger it lands on says which JV moved it and why.
async function insertLedgerEntries(transaction, { jvId, jvDate, lines, reason }) {
  for (const line of lines) {
    const request = requestWithParams(transaction, {
      entryDate: { type: sql.Date, value: jvDate },
      baId: { type: sql.Int, value: line.ba_id },
      debit: { type: sql.Decimal(14, 2), value: line.debit },
      credit: { type: sql.Decimal(14, 2), value: line.credit },
      sourceId: { type: sql.Int, value: jvId },
      narration: { type: sql.NVarChar(500), value: `Journal Voucher #${jvId} — ${line.narration || reason}` },
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
  list, listUnposted, findById, getLines, insert, updateHeader, insertLines, deleteLines, remove,
  setStatus, insertLedgerEntries, deleteLedgerEntries,
};
