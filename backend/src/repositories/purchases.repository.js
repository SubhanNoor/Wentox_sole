// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function insert(transaction, purchase) {
  const request = requestWithParams(transaction, {
    purchaseDate: { type: sql.Date, value: purchase.purchase_date },
    vendorId: { type: sql.Int, value: purchase.vendor_id },
    billNo: { type: sql.VarChar(30), value: purchase.bill_no ?? null },
    remarks: { type: sql.NVarChar(500), value: purchase.remarks ?? null },
    totalValue: { type: sql.Decimal(14, 2), value: purchase.total_value },
    createdBy: { type: sql.Int, value: purchase.created_by ?? null },
  });

  const result = await request.query(`
    INSERT INTO dbo.purchases (purchase_date, vendor_id, bill_no, remarks, total_value, created_by)
    OUTPUT inserted.purchase_id
    VALUES (@purchaseDate, @vendorId, @billNo, @remarks, @totalValue, @createdBy)
  `);
  return result.recordset[0].purchase_id;
}

async function insertItems(transaction, purchaseId, items) {
  for (const [index, item] of items.entries()) {
    const request = requestWithParams(transaction, {
      purchaseId: { type: sql.Int, value: purchaseId },
      materialId: { type: sql.Int, value: item.material_id },
      unit: { type: sql.NVarChar(30), value: item.unit },
      quantity: { type: sql.Decimal(14, 3), value: item.quantity },
      weight: { type: sql.Decimal(14, 3), value: item.weight ?? null },
      pricePerUnit: { type: sql.Decimal(12, 2), value: item.price_per_unit },
      totalPrice: { type: sql.Decimal(14, 2), value: item.total_price },
      lineNo: { type: sql.Int, value: index + 1 },
    });
    await request.query(`
      INSERT INTO dbo.purchase_items (
        purchase_id, material_id, unit, quantity, weight, price_per_unit, total_price, line_no
      )
      VALUES (
        @purchaseId, @materialId, @unit, @quantity, @weight, @pricePerUnit, @totalPrice, @lineNo
      )
    `);
  }
}

async function findById(purchaseId) {
  const purchaseResult = await query(
    `SELECT * FROM dbo.purchases WHERE purchase_id = @purchaseId`,
    { purchaseId: { type: sql.Int, value: purchaseId } },
  );
  const purchase = purchaseResult.recordset[0];
  if (!purchase) return null;

  const itemsResult = await query(
    `SELECT pi.*, m.name AS material_name
     FROM dbo.purchase_items pi
     JOIN dbo.materials m ON m.material_id = pi.material_id
     WHERE pi.purchase_id = @purchaseId
     ORDER BY pi.line_no`,
    { purchaseId: { type: sql.Int, value: purchaseId } },
  );

  return { ...purchase, is_posted: await isPosted(purchaseId), items: itemsResult.recordset };
}

// "Posted" is derived from ledger_entries existing for this purchase, rather than a stored status
// column (dropped — schema §7 update) — a purchase is posted iff its ledger/vendor-stock rows are live.
async function isPosted(purchaseId) {
  const result = await query(
    `SELECT CASE WHEN EXISTS (
       SELECT 1 FROM dbo.ledger_entries WHERE source_type = 'PURCHASE' AND source_id = @purchaseId
     ) THEN 1 ELSE 0 END AS posted`,
    { purchaseId: { type: sql.Int, value: purchaseId } },
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

// Bulk-inserts vendor_stock_movements rows (positive PURCHASE rows written on post).
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

async function deleteItems(transaction, purchaseId) {
  const request = requestWithParams(transaction, { purchaseId: { type: sql.Int, value: purchaseId } });
  await request.query('DELETE FROM dbo.purchase_items WHERE purchase_id = @purchaseId');
}

async function updateHeader(transaction, purchaseId, purchase) {
  const request = requestWithParams(transaction, {
    purchaseId: { type: sql.Int, value: purchaseId },
    purchaseDate: { type: sql.Date, value: purchase.purchase_date },
    vendorId: { type: sql.Int, value: purchase.vendor_id },
    billNo: { type: sql.VarChar(30), value: purchase.bill_no ?? null },
    remarks: { type: sql.NVarChar(500), value: purchase.remarks ?? null },
    totalValue: { type: sql.Decimal(14, 2), value: purchase.total_value },
  });

  await request.query(`
    UPDATE dbo.purchases SET
      purchase_date = @purchaseDate, vendor_id = @vendorId, bill_no = @billNo,
      remarks = @remarks, total_value = @totalValue
    WHERE purchase_id = @purchaseId
  `);
}

async function deleteLedgerAndStock(transaction, purchaseId) {
  const request = requestWithParams(transaction, { purchaseId: { type: sql.Int, value: purchaseId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type = 'PURCHASE' AND source_id = @purchaseId`,
  );
  await request.query(
    `DELETE FROM dbo.vendor_stock_movements WHERE source_type = 'PURCHASE' AND source_id = @purchaseId`,
  );
}

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.vendor_id) {
    conditions.push('vendor_id = @vendorId');
    params.vendorId = { type: sql.Int, value: filters.vendor_id };
  }
  if (filters.date_from) {
    conditions.push('purchase_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('purchase_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT * FROM dbo.purchases ${where} ORDER BY purchase_date DESC, purchase_id DESC`,
    params,
  );
  return result.recordset;
}

module.exports = {
  insert, insertItems, findById, isPosted, insertLedgerEntries, insertVendorStockMovements,
  deleteItems, updateHeader, deleteLedgerAndStock, list,
};
