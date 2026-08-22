// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

// Effective packing per variant is COALESCE(article_colors.packing, articles.packing) — schema.sql §5.
async function getVariantPackings(variantIds) {
  if (variantIds.length === 0) return new Map();
  const params = {};
  const placeholders = variantIds.map((id, i) => {
    const name = `variant${i}`;
    params[name] = { type: sql.Int, value: id };
    return `@${name}`;
  });
  const result = await query(
    `SELECT ac.variant_id, COALESCE(ac.packing, a.packing) AS effective_packing
     FROM dbo.article_colors ac
     JOIN dbo.articles a ON a.article_id = ac.article_id
     WHERE ac.variant_id IN (${placeholders.join(', ')})`,
    params,
  );
  return new Map(result.recordset.map((row) => [row.variant_id, row.effective_packing]));
}

async function insert(transaction, ret) {
  const request = requestWithParams(transaction, {
    returnDate: { type: sql.Date, value: ret.return_date },
    storeId: { type: sql.Int, value: ret.store_id ?? null },
    customerId: { type: sql.Int, value: ret.customer_id },
    subCustomerId: { type: sql.Int, value: ret.sub_customer_id ?? null },
    billNo: { type: sql.VarChar(30), value: ret.bill_no },
    gpNo: { type: sql.VarChar(30), value: ret.gp_no },
    biltyNo: { type: sql.VarChar(30), value: ret.bilty_no },
    addaId: { type: sql.Int, value: ret.adda_id },
    remarks: { type: sql.NVarChar(500), value: ret.remarks ?? null },
    invoiceDiscount: { type: sql.Decimal(12, 2), value: ret.invoice_discount },
    totalCartons: { type: sql.Int, value: ret.total_cartons },
    totalPairs: { type: sql.Int, value: ret.total_pairs },
    grossValue: { type: sql.Decimal(14, 2), value: ret.gross_value },
    netValue: { type: sql.Decimal(14, 2), value: ret.net_value },
    createdBy: { type: sql.Int, value: ret.created_by ?? null },
  });

  const result = await request.query(`
    INSERT INTO dbo.sale_returns (
      return_date, store_id, customer_id, sub_customer_id, bill_no, gp_no, bilty_no, adda_id,
      remarks, invoice_discount, total_cartons, total_pairs, gross_value, net_value, created_by
    )
    OUTPUT inserted.return_id
    VALUES (
      @returnDate, @storeId, @customerId, @subCustomerId, @billNo, @gpNo, @biltyNo, @addaId,
      @remarks, @invoiceDiscount, @totalCartons, @totalPairs, @grossValue, @netValue, @createdBy
    )
  `);
  return result.recordset[0].return_id;
}

async function insertItems(transaction, returnId, items) {
  for (const [index, item] of items.entries()) {
    const request = requestWithParams(transaction, {
      returnId: { type: sql.Int, value: returnId },
      variantId: { type: sql.Int, value: item.variant_id },
      cartons: { type: sql.Int, value: item.cartons },
      pairs: { type: sql.Int, value: item.pairs },
      rate: { type: sql.Decimal(12, 2), value: item.rate },
      discountPercent: { type: sql.Decimal(5, 2), value: item.discount_percent },
      discountValue: { type: sql.Decimal(12, 2), value: item.discount_value },
      value: { type: sql.Decimal(14, 2), value: item.value },
      lineNo: { type: sql.Int, value: index + 1 },
    });
    await request.query(`
      INSERT INTO dbo.sale_return_items (
        return_id, variant_id, cartons, pairs, rate, discount_percent, discount_value, value, line_no
      )
      VALUES (
        @returnId, @variantId, @cartons, @pairs, @rate, @discountPercent, @discountValue, @value, @lineNo
      )
    `);
  }
}

async function findById(returnId) {
  const returnResult = await query(
    `SELECT * FROM dbo.sale_returns WHERE return_id = @returnId`,
    { returnId: { type: sql.Int, value: returnId } },
  );
  const ret = returnResult.recordset[0];
  if (!ret) return null;

  const itemsResult = await query(
    `SELECT
       sri.*,
       ac.color,
       a.code AS article_code,
       a.name AS article_name
     FROM dbo.sale_return_items sri
     JOIN dbo.article_colors ac ON ac.variant_id = sri.variant_id
     JOIN dbo.articles a ON a.article_id = ac.article_id
     WHERE sri.return_id = @returnId
     ORDER BY sri.line_no`,
    { returnId: { type: sql.Int, value: returnId } },
  );

  return { ...ret, is_posted: await isPosted(returnId), items: itemsResult.recordset };
}

// "Posted" is derived from ledger_entries existing for this return, rather than a stored status
// column (dropped — schema §6 update) — a return is posted iff its ledger/stock rows are live.
async function isPosted(returnId) {
  const result = await query(
    `SELECT CASE WHEN EXISTS (
       SELECT 1 FROM dbo.ledger_entries WHERE source_type = 'SALE_RETURN' AND source_id = @returnId
     ) THEN 1 ELSE 0 END AS posted`,
    { returnId: { type: sql.Int, value: returnId } },
  );
  return result.recordset[0].posted === 1;
}

// Bulk-inserts ledger_entries rows for a post (schema: exactly one of ac_id/ba_id per row).
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
      pairs: { type: sql.Int, value: row.pairs ?? null },
    });
    await request.query(`
      INSERT INTO dbo.ledger_entries (
        entry_date, ac_id, ba_id, debit, credit, source_type, source_id, narration, pairs
      )
      VALUES (
        @entryDate, @acId, @baId, @debit, @credit, @sourceType, @sourceId, @narration, @pairs
      )
    `);
  }
}

// Bulk-inserts stock_movements rows (used for the positive SALE_RETURN rows written on post).
async function insertStockMovements(transaction, rows) {
  for (const row of rows) {
    const request = requestWithParams(transaction, {
      variantId: { type: sql.Int, value: row.variant_id },
      movementType: { type: sql.VarChar(15), value: row.movement_type },
      qtyPairs: { type: sql.Int, value: row.qty_pairs },
      movementDate: { type: sql.Date, value: row.movement_date },
      sourceType: { type: sql.VarChar(20), value: row.source_type ?? null },
      sourceId: { type: sql.Int, value: row.source_id ?? null },
      createdBy: { type: sql.Int, value: row.created_by ?? null },
    });
    await request.query(`
      INSERT INTO dbo.stock_movements (
        variant_id, movement_type, qty_pairs, movement_date, source_type, source_id, created_by
      )
      VALUES (
        @variantId, @movementType, @qtyPairs, @movementDate, @sourceType, @sourceId, @createdBy
      )
    `);
  }
}

async function deleteItems(transaction, returnId) {
  const request = requestWithParams(transaction, { returnId: { type: sql.Int, value: returnId } });
  await request.query('DELETE FROM dbo.sale_return_items WHERE return_id = @returnId');
}

async function updateHeader(transaction, returnId, ret) {
  const request = requestWithParams(transaction, {
    returnId: { type: sql.Int, value: returnId },
    returnDate: { type: sql.Date, value: ret.return_date },
    storeId: { type: sql.Int, value: ret.store_id ?? null },
    customerId: { type: sql.Int, value: ret.customer_id },
    subCustomerId: { type: sql.Int, value: ret.sub_customer_id ?? null },
    billNo: { type: sql.VarChar(30), value: ret.bill_no },
    gpNo: { type: sql.VarChar(30), value: ret.gp_no },
    biltyNo: { type: sql.VarChar(30), value: ret.bilty_no },
    addaId: { type: sql.Int, value: ret.adda_id },
    remarks: { type: sql.NVarChar(500), value: ret.remarks ?? null },
    invoiceDiscount: { type: sql.Decimal(12, 2), value: ret.invoice_discount },
    totalCartons: { type: sql.Int, value: ret.total_cartons },
    totalPairs: { type: sql.Int, value: ret.total_pairs },
    grossValue: { type: sql.Decimal(14, 2), value: ret.gross_value },
    netValue: { type: sql.Decimal(14, 2), value: ret.net_value },
  });

  await request.query(`
    UPDATE dbo.sale_returns SET
      return_date = @returnDate, store_id = @storeId, customer_id = @customerId,
      sub_customer_id = @subCustomerId, bill_no = @billNo, gp_no = @gpNo, bilty_no = @biltyNo,
      adda_id = @addaId, remarks = @remarks, invoice_discount = @invoiceDiscount,
      total_cartons = @totalCartons, total_pairs = @totalPairs, gross_value = @grossValue,
      net_value = @netValue
    WHERE return_id = @returnId
  `);
}

async function deleteLedgerAndStock(transaction, returnId) {
  const request = requestWithParams(transaction, { returnId: { type: sql.Int, value: returnId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type = 'SALE_RETURN' AND source_id = @returnId`,
  );
  await request.query(
    `DELETE FROM dbo.stock_movements WHERE source_type = 'SALE_RETURN' AND source_id = @returnId`,
  );
}

// Split for saleReturns.service.js#unconfirm() — same reasoning as saleBills.repository.js's
// split: stock is now reserved/moved independently of the ledger under the draft-table model, so
// they no longer share one lifecycle.
async function deleteLedgerEntries(transaction, returnId) {
  const request = requestWithParams(transaction, { returnId: { type: sql.Int, value: returnId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type = 'SALE_RETURN' AND source_id = @returnId`,
  );
}

// Removing a real return entirely (only ever called on an unposted one — saleReturns.service.js#
// unconfirm() deletes ledger/stock first, this table row last).
async function deleteReturn(transaction, returnId) {
  const request = requestWithParams(transaction, { returnId: { type: sql.Int, value: returnId } });
  await request.query('DELETE FROM dbo.sale_returns WHERE return_id = @returnId');
}

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.customer_id) {
    conditions.push('customer_id = @customerId');
    params.customerId = { type: sql.Int, value: filters.customer_id };
  }
  if (filters.sub_customer_id) {
    conditions.push('sub_customer_id = @subCustomerId');
    params.subCustomerId = { type: sql.Int, value: filters.sub_customer_id };
  }
  if (filters.bill_no) {
    conditions.push('bill_no = @billNo');
    params.billNo = { type: sql.VarChar(30), value: filters.bill_no };
  }
  if (filters.date_from) {
    conditions.push('return_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('return_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT * FROM dbo.sale_returns ${where} ORDER BY return_date DESC, return_id DESC`,
    params,
  );
  return result.recordset;
}

module.exports = {
  getVariantPackings, insert, insertItems, findById, isPosted, insertLedgerEntries,
  insertStockMovements, deleteItems, updateHeader, deleteLedgerAndStock, deleteLedgerEntries,
  deleteReturn, list,
};
