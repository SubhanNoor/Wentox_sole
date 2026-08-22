// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function insert(transaction, ret) {
  const request = requestWithParams(transaction, {
    returnDate: { type: sql.Date, value: ret.return_date },
    vendorId: { type: sql.Int, value: ret.vendor_id },
    billNo: { type: sql.VarChar(30), value: ret.bill_no ?? null },
    remarks: { type: sql.NVarChar(500), value: ret.remarks ?? null },
    totalValue: { type: sql.Decimal(14, 2), value: ret.total_value },
    createdBy: { type: sql.Int, value: ret.created_by ?? null },
  });

  const result = await request.query(`
    INSERT INTO dbo.purchase_returns (return_date, vendor_id, bill_no, remarks, total_value, created_by)
    OUTPUT inserted.return_id
    VALUES (@returnDate, @vendorId, @billNo, @remarks, @totalValue, @createdBy)
  `);
  return result.recordset[0].return_id;
}

async function insertItems(transaction, returnId, items) {
  for (const [index, item] of items.entries()) {
    const request = requestWithParams(transaction, {
      returnId: { type: sql.Int, value: returnId },
      materialId: { type: sql.Int, value: item.material_id },
      unit: { type: sql.NVarChar(30), value: item.unit },
      quantity: { type: sql.Decimal(14, 3), value: item.quantity },
      weight: { type: sql.Decimal(14, 3), value: item.weight ?? null },
      pricePerUnit: { type: sql.Decimal(12, 2), value: item.price_per_unit },
      totalPrice: { type: sql.Decimal(14, 2), value: item.total_price },
      lineNo: { type: sql.Int, value: index + 1 },
    });
    await request.query(`
      INSERT INTO dbo.purchase_return_items (
        return_id, material_id, unit, quantity, weight, price_per_unit, total_price, line_no
      )
      VALUES (
        @returnId, @materialId, @unit, @quantity, @weight, @pricePerUnit, @totalPrice, @lineNo
      )
    `);
  }
}

async function findById(returnId) {
  const returnResult = await query(
    `SELECT * FROM dbo.purchase_returns WHERE return_id = @returnId`,
    { returnId: { type: sql.Int, value: returnId } },
  );
  const ret = returnResult.recordset[0];
  if (!ret) return null;

  const itemsResult = await query(
    `SELECT pri.*, m.name AS material_name
     FROM dbo.purchase_return_items pri
     JOIN dbo.materials m ON m.material_id = pri.material_id
     WHERE pri.return_id = @returnId
     ORDER BY pri.line_no`,
    { returnId: { type: sql.Int, value: returnId } },
  );

  return { ...ret, is_posted: await isPosted(returnId), items: itemsResult.recordset };
}

// "Posted" is derived from ledger_entries existing for this return, rather than a stored status
// column (dropped — schema §7 update) — a return is posted iff its ledger/vendor-stock rows are live.
async function isPosted(returnId) {
  const result = await query(
    `SELECT CASE WHEN EXISTS (
       SELECT 1 FROM dbo.ledger_entries WHERE source_type = 'PURCHASE_RETURN' AND source_id = @returnId
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
    });
    await request.query(`
      INSERT INTO dbo.ledger_entries (
        entry_date, ac_id, ba_id, debit, credit, source_type, source_id, narration
      )
      VALUES (
        @entryDate, @acId, @baId, @debit, @credit, @sourceType, @sourceId, @narration
      )
    `);
  }
}

// Bulk-inserts vendor_stock_movements rows (negative PURCHASE_RETURN rows written on post).
async function insertVendorStockMovements(transaction, rows) {
  for (const row of rows) {
    const request = requestWithParams(transaction, {
      vendorId: { type: sql.Int, value: row.vendor_id },
      materialId: { type: sql.Int, value: row.material_id },
      unit: { type: sql.NVarChar(30), value: row.unit },
      qty: { type: sql.Decimal(14, 3), value: row.qty },
      movementDate: { type: sql.Date, value: row.movement_date },
      movementType: { type: sql.VarChar(20), value: row.movement_type },
      sourceType: { type: sql.VarChar(20), value: row.source_type ?? null },
      sourceId: { type: sql.Int, value: row.source_id ?? null },
      createdBy: { type: sql.Int, value: row.created_by ?? null },
    });
    await request.query(`
      INSERT INTO dbo.vendor_stock_movements (
        vendor_id, material_id, unit, qty, movement_date, movement_type, source_type, source_id, created_by
      )
      VALUES (
        @vendorId, @materialId, @unit, @qty, @movementDate, @movementType, @sourceType, @sourceId, @createdBy
      )
    `);
  }
}

async function deleteItems(transaction, returnId) {
  const request = requestWithParams(transaction, { returnId: { type: sql.Int, value: returnId } });
  await request.query('DELETE FROM dbo.purchase_return_items WHERE return_id = @returnId');
}

async function updateHeader(transaction, returnId, ret) {
  const request = requestWithParams(transaction, {
    returnId: { type: sql.Int, value: returnId },
    returnDate: { type: sql.Date, value: ret.return_date },
    vendorId: { type: sql.Int, value: ret.vendor_id },
    billNo: { type: sql.VarChar(30), value: ret.bill_no ?? null },
    remarks: { type: sql.NVarChar(500), value: ret.remarks ?? null },
    totalValue: { type: sql.Decimal(14, 2), value: ret.total_value },
  });

  await request.query(`
    UPDATE dbo.purchase_returns SET
      return_date = @returnDate, vendor_id = @vendorId, bill_no = @billNo,
      remarks = @remarks, total_value = @totalValue
    WHERE return_id = @returnId
  `);
}

async function deleteLedgerAndStock(transaction, returnId) {
  const request = requestWithParams(transaction, { returnId: { type: sql.Int, value: returnId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type = 'PURCHASE_RETURN' AND source_id = @returnId`,
  );
  await request.query(
    `DELETE FROM dbo.vendor_stock_movements WHERE source_type = 'PURCHASE_RETURN' AND source_id = @returnId`,
  );
}

// Deletes the real return row itself (used by unconfirm(), after deleteItems/deleteLedgerAndStock
// have already cleared its dependents) — mirrors purchases.repository.js#deletePurchase.
async function deleteReturn(transaction, returnId) {
  const request = requestWithParams(transaction, { returnId: { type: sql.Int, value: returnId } });
  await request.query('DELETE FROM dbo.purchase_returns WHERE return_id = @returnId');
}

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.vendor_id) {
    conditions.push('vendor_id = @vendorId');
    params.vendorId = { type: sql.Int, value: filters.vendor_id };
  }
  if (filters.date_from) {
    conditions.push('return_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('return_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  // is_posted: same fix as purchases.repository.js#list() — plain SELECT * never computed this
  // before, despite PurchaseReturnRow.is_posted being a required field, so callers listing a
  // vendor's/account's RETURN HISTORY (e.g. PurchaseReturnPage's "Recorded Purchase Returns" tab)
  // could never actually filter to posted-only.
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT pr.*, CASE WHEN EXISTS (
       SELECT 1 FROM dbo.ledger_entries le WHERE le.source_type = 'PURCHASE_RETURN' AND le.source_id = pr.return_id
     ) THEN 1 ELSE 0 END AS is_posted
     FROM dbo.purchase_returns pr ${where} ORDER BY return_date DESC, return_id DESC`,
    params,
  );
  return result.recordset.map((r) => ({ ...r, is_posted: r.is_posted === 1 }));
}

module.exports = {
  insert, insertItems, findById, isPosted, insertLedgerEntries, insertVendorStockMovements,
  deleteItems, updateHeader, deleteLedgerAndStock, deleteReturn, list,
};
