// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

function linesSubquery(alias = 'sv') {
  // No GROUP BY — SQL Server rejects a bare column selected alongside aggregates without one,
  // even though the WHERE already correlates to a single voucher. Mirrors journalVouchers
  // repository's own identical subquery. No total_value — this document carries no valuation
  // (per the user, 2026-08-30).
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
    `SELECT sv.*, st.name AS store_name,
            boa.name AS on_account_name, boa.code AS on_account_code,
            totals.line_count, totals.total_cartons, totals.total_pairs
     FROM dbo.stock_vouchers sv
     LEFT JOIN dbo.stores st ON st.store_id = sv.store_id
     LEFT JOIN dbo.business_accounts boa ON boa.ba_id = sv.on_account_ba_id
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

// Cartons/pairs still sitting in DRAFT (unposted) vouchers, summed per variant — nothing here has
// reached dbo.stock_movements yet (only post() writes those), so this is what the Stock In Hand
// readout subtracts from real stock as a "already spoken for by other pending vouchers" reserve,
// per the user (2026-08-31). `excludeStockVoucherId` leaves out the voucher currently open in the
// entry form — its own lines are accounted for separately, client-side, from the in-progress grid.
async function listUnpostedCartonsByVariant(excludeStockVoucherId) {
  const result = await query(`
    SELECT svl.variant_id, SUM(svl.cartons) AS cartons, SUM(svl.pairs) AS pairs
    FROM dbo.stock_voucher_lines svl
    JOIN dbo.stock_vouchers sv ON sv.stock_voucher_id = svl.stock_voucher_id
    WHERE sv.status = 'DRAFT'
    ${excludeStockVoucherId != null ? 'AND sv.stock_voucher_id <> @excludeId' : ''}
    GROUP BY svl.variant_id
  `, excludeStockVoucherId != null ? { excludeId: { type: sql.Int, value: excludeStockVoucherId } } : {});
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
    `SELECT sv.*, st.name AS store_name,
            boa.name AS on_account_name, boa.code AS on_account_code,
            totals.line_count, totals.total_cartons, totals.total_pairs
     FROM dbo.stock_vouchers sv
     LEFT JOIN dbo.stores st ON st.store_id = sv.store_id
     LEFT JOIN dbo.business_accounts boa ON boa.ba_id = sv.on_account_ba_id
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
    billNo: { type: sql.Int, value: sv.bill_no ?? null },
    biltyNo: { type: sql.Int, value: sv.bilty_no ?? null },
    igpNo: { type: sql.Int, value: sv.igp_no ?? null },
    deliveryType: { type: sql.VarChar(10), value: sv.delivery_type },
    deliveryAddress: { type: sql.NVarChar(300), value: sv.delivery_address ?? null },
    onAccountBaId: { type: sql.Int, value: sv.on_account_ba_id ?? null },
    mainAcId: { type: sql.Int, value: sv.main_ac_id ?? null },
    createdBy: { type: sql.Int, value: sv.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.stock_vouchers
      (voucher_date, store_id, remarks, bill_no, bilty_no, igp_no, delivery_type, delivery_address,
       on_account_ba_id, main_ac_id, status, created_by)
    OUTPUT inserted.stock_voucher_id
    VALUES
      (@voucherDate, @storeId, @remarks, @billNo, @biltyNo, @igpNo, @deliveryType, @deliveryAddress,
       @onAccountBaId, @mainAcId, 'DRAFT', @createdBy)
  `);
  return result.recordset[0].stock_voucher_id;
}

async function updateHeader(transaction, stockVoucherId, sv) {
  const request = requestWithParams(transaction, {
    stockVoucherId: { type: sql.Int, value: stockVoucherId },
    voucherDate: { type: sql.Date, value: sv.voucher_date },
    storeId: { type: sql.Int, value: sv.store_id ?? null },
    remarks: { type: sql.NVarChar(500), value: sv.remarks ?? null },
    billNo: { type: sql.Int, value: sv.bill_no ?? null },
    biltyNo: { type: sql.Int, value: sv.bilty_no ?? null },
    igpNo: { type: sql.Int, value: sv.igp_no ?? null },
    deliveryType: { type: sql.VarChar(10), value: sv.delivery_type },
    deliveryAddress: { type: sql.NVarChar(300), value: sv.delivery_address ?? null },
    onAccountBaId: { type: sql.Int, value: sv.on_account_ba_id ?? null },
    mainAcId: { type: sql.Int, value: sv.main_ac_id ?? null },
  });
  await request.query(`
    UPDATE dbo.stock_vouchers SET
      voucher_date = @voucherDate, store_id = @storeId, remarks = @remarks,
      bill_no = @billNo, bilty_no = @biltyNo, igp_no = @igpNo,
      delivery_type = @deliveryType, delivery_address = @deliveryAddress,
      on_account_ba_id = @onAccountBaId, main_ac_id = @mainAcId
    WHERE stock_voucher_id = @stockVoucherId
  `);
}

async function insertLines(transaction, stockVoucherId, lines) {
  for (const [index, line] of lines.entries()) {
    const request = requestWithParams(transaction, {
      stockVoucherId: { type: sql.Int, value: stockVoucherId },
      lineNo: { type: sql.Int, value: index + 1 },
      variantId: { type: sql.Int, value: line.variant_id },
      cartons: { type: sql.Decimal(12, 1), value: line.cartons },
      pairs: { type: sql.Int, value: line.pairs },
      rate: { type: sql.Decimal(18, 4), value: line.rate },
      discountPct: { type: sql.Decimal(9, 4), value: line.discount_pct },
      discountValue: { type: sql.Decimal(18, 4), value: line.discount_value },
      value: { type: sql.Decimal(18, 4), value: line.value },
    });
    await request.query(`
      INSERT INTO dbo.stock_voucher_lines
        (stock_voucher_id, line_no, variant_id, cartons, pairs, rate, discount_pct, discount_value, value)
      VALUES
        (@stockVoucherId, @lineNo, @variantId, @cartons, @pairs, @rate, @discountPct, @discountValue, @value)
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
  setStatus, insertStockMovements, deleteStockMovements, listUnpostedCartonsByVariant,
};
