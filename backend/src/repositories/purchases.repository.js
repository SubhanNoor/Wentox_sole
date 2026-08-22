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

  // is_posted: plain SELECT * never carried this before (only get()/create()/update()/post()/
  // unpost() computed it via isPosted()'s own separate query) — added here as a computed column so
  // callers that list a vendor's/account's purchase HISTORY (VendorSetupPage's drill-down modal)
  // can actually filter to posted-only instead of showing drafts that haven't happened yet.
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT p.*, CASE WHEN EXISTS (
       SELECT 1 FROM dbo.ledger_entries le WHERE le.source_type = 'PURCHASE' AND le.source_id = p.purchase_id
     ) THEN 1 ELSE 0 END AS is_posted
     FROM dbo.purchases p ${where} ORDER BY purchase_date DESC, purchase_id DESC`,
    params,
  );
  return result.recordset.map((r) => ({ ...r, is_posted: r.is_posted === 1 }));
}

// P-03: every purchase still awaiting posting, oldest first — the order they were entered is the
// order they should post. "Unposted" is the absence of ledger entries, the same definition
// isPosted() uses. Only the display fields the Post All confirmation/result list needs.
async function listUnposted() {
  const result = await query(
    `SELECT p.purchase_id, p.bill_no, p.purchase_date, p.total_value, v.name AS vendor_name
     FROM dbo.purchases p
     LEFT JOIN dbo.vendors v ON v.vendor_id = p.vendor_id
     WHERE NOT EXISTS (
       SELECT 1 FROM dbo.ledger_entries le
       WHERE le.source_type = 'PURCHASE' AND le.source_id = p.purchase_id
     )
     ORDER BY p.purchase_date ASC, p.purchase_id ASC`,
  );
  return result.recordset;
}

// PR-01: what this vendor was actually last paid for this material, across every POSTED purchase
// (not drafts — a draft's price was never confirmed as real). Most recent by purchase_date, then
// purchase_id as the tiebreak for same-day purchases. Null when there's no prior posted purchase
// to go on, and the caller falls back to whatever it already had.
//
// Keyed on the material NAME, not material_id, because that is what the Purchase/Purchase Return
// screens hold — a line is typed free-text and only resolved to a material_id at save time by
// materials.repository#resolveOrCreate. Matching here is a plain `=` on name, relying on the same
// case-insensitive default collation resolveOrCreate relies on, so 'pu sheet roll' finds
// 'PU Sheet Roll'. Deliberately a read-only lookup: it never registers a material, so typing an
// unknown name into the return form returns null rather than quietly creating a materials row.
//
// Returns the unit alongside the price because, unlike a sale (where the rate is per pair and the
// unit is implicit), a purchase line's unit is self-assigned per line — "200 kg @ 230" and
// "200 meters @ 230" are different purchases, so a price copied without its unit is meaningless.
// Mirror of saleBills.repository.js#lastSoldRate — same posted-only rule, same ordering.
async function lastPurchasedRate(vendorId, materialName) {
  const result = await query(
    `SELECT TOP 1 pi.price_per_unit, pi.unit
     FROM dbo.purchase_items pi
     JOIN dbo.purchases p ON p.purchase_id = pi.purchase_id
     JOIN dbo.materials m ON m.material_id = pi.material_id
     WHERE p.vendor_id = @vendorId AND m.name = @materialName
       AND EXISTS (SELECT 1 FROM dbo.ledger_entries le WHERE le.source_type = 'PURCHASE' AND le.source_id = p.purchase_id)
     ORDER BY p.purchase_date DESC, p.purchase_id DESC`,
    {
      vendorId: { type: sql.Int, value: vendorId },
      materialName: { type: sql.NVarChar(150), value: materialName },
    },
  );
  const row = result.recordset[0];
  return row ? { price_per_unit: Number(row.price_per_unit), unit: row.unit } : null;
}

// Removing a real purchase entirely (only ever called on an unposted one —
// purchases.service.js#unconfirm() deletes ledger/vendor-stock and items first, this table row
// last).
async function deletePurchase(transaction, purchaseId) {
  const request = requestWithParams(transaction, { purchaseId: { type: sql.Int, value: purchaseId } });
  await request.query('DELETE FROM dbo.purchases WHERE purchase_id = @purchaseId');
}

module.exports = {
  insert, insertItems, findById, isPosted, insertLedgerEntries, insertVendorStockMovements,
  deleteItems, updateHeader, deleteLedgerAndStock, deletePurchase, list, lastPurchasedRate,
  listUnposted,
};
