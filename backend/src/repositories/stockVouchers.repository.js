// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

function linesSubquery(alias = 'sv') {
  // No GROUP BY — SQL Server rejects a bare column selected alongside aggregates without one,
  // even though the WHERE already correlates to a single voucher. Mirrors journalVouchers
  // repository's own identical subquery.
  return `(
    SELECT COUNT(*) AS line_count,
           SUM(svl.cartons) AS total_cartons,
           SUM(svl.pairs) AS total_pairs
    FROM dbo.stock_voucher_lines svl
    WHERE svl.stock_voucher_id = ${alias}.stock_voucher_id
  )`;
}

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.store_id) {
    conditions.push('sv.store_id = @storeId');
    params.storeId = { type: sql.Int, value: filters.store_id };
  }
  if (filters.status) {
    conditions.push('sv.status = @status');
    params.status = { type: sql.VarChar(10), value: filters.status };
  }
  if (filters.date_from) {
    conditions.push('sv.voucher_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('sv.voucher_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }
  // "Find the voucher from any detail" — matches the header (remarks) or any of its lines
  // (article code/name, color), same idea as journal_vouchers' own search.
  if (filters.search && filters.search.trim()) {
    conditions.push(`(
      sv.remarks LIKE @search OR EXISTS (
        SELECT 1 FROM dbo.stock_voucher_lines s_svl
        JOIN dbo.article_colors s_ac ON s_ac.variant_id = s_svl.variant_id
        JOIN dbo.articles s_a ON s_a.article_id = s_ac.article_id
        WHERE s_svl.stock_voucher_id = sv.stock_voucher_id AND (
          s_a.name LIKE @search OR s_a.code LIKE @search OR s_ac.color LIKE @search
        )
      )
    )`);
    params.search = { type: sql.NVarChar(120), value: `%${filters.search.trim()}%` };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT sv.*, st.name AS store_name, totals.line_count, totals.total_cartons, totals.total_pairs
     FROM dbo.stock_vouchers sv
     LEFT JOIN dbo.stores st ON st.store_id = sv.store_id
     CROSS APPLY ${linesSubquery('sv')} totals
     ${where}
     ORDER BY sv.voucher_date DESC, sv.stock_voucher_id DESC`,
    params,
  );
  return result.recordset;
}

// Every stock voucher still awaiting posting, oldest first — the order they were entered is the
// order they should post. Mirrors journalVouchers.repository.js#listUnposted.
async function listUnposted() {
  const result = await query(
    `SELECT sv.stock_voucher_id, sv.voucher_date, sv.remarks, totals.total_pairs
     FROM dbo.stock_vouchers sv
     CROSS APPLY ${linesSubquery('sv')} totals
     WHERE sv.status = 'DRAFT'
     ORDER BY sv.voucher_date ASC, sv.stock_voucher_id ASC`,
  );
  return result.recordset;
}

async function getLines(stockVoucherId) {
  const result = await query(
    `SELECT svl.*, ac.color, a.code AS article_code, a.name AS article_name, a.article_id
     FROM dbo.stock_voucher_lines svl
     JOIN dbo.article_colors ac ON ac.variant_id = svl.variant_id
     JOIN dbo.articles a ON a.article_id = ac.article_id
     WHERE svl.stock_voucher_id = @stockVoucherId
     ORDER BY svl.line_no`,
    { stockVoucherId: { type: sql.Int, value: stockVoucherId } },
  );
  return result.recordset;
}

async function findById(stockVoucherId) {
  const result = await query(
    `SELECT sv.*, st.name AS store_name, totals.line_count, totals.total_cartons, totals.total_pairs
     FROM dbo.stock_vouchers sv
     LEFT JOIN dbo.stores st ON st.store_id = sv.store_id
     CROSS APPLY ${linesSubquery('sv')} totals
     WHERE sv.stock_voucher_id = @stockVoucherId`,
    { stockVoucherId: { type: sql.Int, value: stockVoucherId } },
  );
  const sv = result.recordset[0];
  if (!sv) return null;
  return { ...sv, lines: await getLines(stockVoucherId) };
}

async function insert(transaction, sv) {
  const request = requestWithParams(transaction, {
    voucherDate: { type: sql.Date, value: sv.voucher_date },
    storeId: { type: sql.Int, value: sv.store_id ?? null },
    remarks: { type: sql.NVarChar(500), value: sv.remarks ?? null },
    createdBy: { type: sql.Int, value: sv.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.stock_vouchers (voucher_date, store_id, remarks, status, created_by)
    OUTPUT inserted.stock_voucher_id
    VALUES (@voucherDate, @storeId, @remarks, 'DRAFT', @createdBy)
  `);
  return result.recordset[0].stock_voucher_id;
}

async function updateHeader(transaction, stockVoucherId, sv) {
  const request = requestWithParams(transaction, {
    stockVoucherId: { type: sql.Int, value: stockVoucherId },
    voucherDate: { type: sql.Date, value: sv.voucher_date },
    storeId: { type: sql.Int, value: sv.store_id ?? null },
    remarks: { type: sql.NVarChar(500), value: sv.remarks ?? null },
  });
  await request.query(`
    UPDATE dbo.stock_vouchers SET
      voucher_date = @voucherDate, store_id = @storeId, remarks = @remarks
    WHERE stock_voucher_id = @stockVoucherId
  `);
}

async function insertLines(transaction, stockVoucherId, lines) {
  for (const [index, line] of lines.entries()) {
    const request = requestWithParams(transaction, {
      stockVoucherId: { type: sql.Int, value: stockVoucherId },
      lineNo: { type: sql.Int, value: index + 1 },
      variantId: { type: sql.Int, value: line.variant_id },
      cartons: { type: sql.Int, value: line.cartons },
      pairs: { type: sql.Int, value: line.pairs },
    });
    await request.query(`
      INSERT INTO dbo.stock_voucher_lines (stock_voucher_id, line_no, variant_id, cartons, pairs)
      VALUES (@stockVoucherId, @lineNo, @variantId, @cartons, @pairs)
    `);
  }
}

async function deleteLines(transaction, stockVoucherId) {
  const request = requestWithParams(transaction, { stockVoucherId: { type: sql.Int, value: stockVoucherId } });
  await request.query('DELETE FROM dbo.stock_voucher_lines WHERE stock_voucher_id = @stockVoucherId');
}

async function remove(stockVoucherId) {
  await query('DELETE FROM dbo.stock_vouchers WHERE stock_voucher_id = @stockVoucherId', {
    stockVoucherId: { type: sql.Int, value: stockVoucherId },
  });
}

async function setStatus(transaction, stockVoucherId, status, updatedBy) {
  const request = requestWithParams(transaction, {
    stockVoucherId: { type: sql.Int, value: stockVoucherId },
    status: { type: sql.VarChar(10), value: status },
    updatedBy: { type: sql.Int, value: updatedBy ?? null },
  });
  await request.query(
    'UPDATE dbo.stock_vouchers SET status = @status, updated_by = @updatedBy WHERE stock_voucher_id = @stockVoucherId',
  );
}

// One stock_movements row per line, movement_type='ADJUSTMENT' (already unconstrained-sign),
// source_type='STOCK_VOUCHER' so unpost() can find and delete exactly these rows again.
async function insertStockMovements(transaction, { stockVoucherId, voucherDate, lines, createdBy }) {
  for (const line of lines) {
    const request = requestWithParams(transaction, {
      variantId: { type: sql.Int, value: line.variant_id },
      qtyPairs: { type: sql.Int, value: line.pairs },
      movementDate: { type: sql.Date, value: voucherDate },
      sourceId: { type: sql.Int, value: stockVoucherId },
      createdBy: { type: sql.Int, value: createdBy ?? null },
    });
    await request.query(`
      INSERT INTO dbo.stock_movements (variant_id, movement_type, qty_pairs, movement_date, source_type, source_id, created_by)
      VALUES (@variantId, 'ADJUSTMENT', @qtyPairs, @movementDate, 'STOCK_VOUCHER', @sourceId, @createdBy)
    `);
  }
}

async function deleteStockMovements(transaction, stockVoucherId) {
  const request = requestWithParams(transaction, { stockVoucherId: { type: sql.Int, value: stockVoucherId } });
  await request.query(
    `DELETE FROM dbo.stock_movements WHERE source_type = 'STOCK_VOUCHER' AND source_id = @stockVoucherId`,
  );
}

module.exports = {
  list, listUnposted, findById, getLines, insert, updateHeader, insertLines, deleteLines, remove,
  setStatus, insertStockMovements, deleteStockMovements,
};
