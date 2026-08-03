// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

async function insertDraft(transaction, draft) {
  const request = requestWithParams(transaction, {
    purchaseDate: { type: sql.Date, value: draft.purchase_date },
    vendorId: { type: sql.Int, value: draft.vendor_id },
    billNo: { type: sql.VarChar(30), value: draft.bill_no ?? null },
    remarks: { type: sql.NVarChar(500), value: draft.remarks ?? null },
    totalValue: { type: sql.Decimal(14, 2), value: draft.total_value },
    createdBy: { type: sql.Int, value: draft.created_by ?? null },
  });

  const result = await request.query(`
    INSERT INTO dbo.draft_purchases (purchase_date, vendor_id, bill_no, remarks, total_value, created_by)
    OUTPUT inserted.draft_id
    VALUES (@purchaseDate, @vendorId, @billNo, @remarks, @totalValue, @createdBy)
  `);
  return result.recordset[0].draft_id;
}

async function insertDraftItems(transaction, draftId, items) {
  for (const [index, item] of items.entries()) {
    const request = requestWithParams(transaction, {
      draftId: { type: sql.Int, value: draftId },
      materialId: { type: sql.Int, value: item.material_id },
      unit: { type: sql.NVarChar(30), value: item.unit },
      quantity: { type: sql.Decimal(14, 3), value: item.quantity },
      weight: { type: sql.Decimal(14, 3), value: item.weight ?? null },
      pricePerUnit: { type: sql.Decimal(12, 2), value: item.price_per_unit },
      totalPrice: { type: sql.Decimal(14, 2), value: item.total_price },
      lineNo: { type: sql.Int, value: index + 1 },
    });
    await request.query(`
      INSERT INTO dbo.draft_purchase_items (
        draft_id, material_id, unit, quantity, weight, price_per_unit, total_price, line_no
      )
      VALUES (
        @draftId, @materialId, @unit, @quantity, @weight, @pricePerUnit, @totalPrice, @lineNo
      )
    `);
  }
}

async function findById(draftId) {
  const draftResult = await query(
    `SELECT * FROM dbo.draft_purchases WHERE draft_id = @draftId`,
    { draftId: { type: sql.Int, value: draftId } },
  );
  const draft = draftResult.recordset[0];
  if (!draft) return null;

  const itemsResult = await query(
    `SELECT dpi.*, m.name AS material_name
     FROM dbo.draft_purchase_items dpi
     JOIN dbo.materials m ON m.material_id = dpi.material_id
     WHERE dpi.draft_id = @draftId
     ORDER BY dpi.line_no`,
    { draftId: { type: sql.Int, value: draftId } },
  );

  return { ...draft, items: itemsResult.recordset };
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
    `SELECT * FROM dbo.draft_purchases ${where} ORDER BY purchase_date DESC, draft_id DESC`,
    params,
  );
  return result.recordset;
}

async function deleteDraft(transaction, draftId) {
  const request = requestWithParams(transaction, { draftId: { type: sql.Int, value: draftId } });
  await request.query('DELETE FROM dbo.draft_purchases WHERE draft_id = @draftId');
}

module.exports = { insertDraft, insertDraftItems, findById, list, deleteDraft };
