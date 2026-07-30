// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams } = require('../db/pool');

// Effective packing per variant is COALESCE(article_colors.packing, articles.packing) — schema.sql §5.
// Kept as its own copy (same shape as saleBills.repository.getVariantPackings) rather than a
// cross-repository call, so each repository stays self-contained.
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

async function insertDraft(transaction, draft) {
  const request = requestWithParams(transaction, {
    billDate: { type: sql.Date, value: draft.bill_date },
    storeId: { type: sql.Int, value: draft.store_id ?? null },
    customerId: { type: sql.Int, value: draft.customer_id },
    subCustomerId: { type: sql.Int, value: draft.sub_customer_id ?? null },
    mainAcId: { type: sql.Int, value: draft.main_ac_id ?? null },
    deliveryType: { type: sql.VarChar(10), value: draft.delivery_type },
    deliveryAddress: { type: sql.NVarChar(300), value: draft.delivery_address ?? null },
    billNo: { type: sql.VarChar(30), value: draft.bill_no ?? null },
    gpNo: { type: sql.VarChar(30), value: draft.gp_no ?? null },
    biltyNo: { type: sql.VarChar(30), value: draft.bilty_no ?? null },
    addaId: { type: sql.Int, value: draft.adda_id ?? null },
    remarks: { type: sql.NVarChar(500), value: draft.remarks ?? null },
    invoiceDiscount: { type: sql.Decimal(12, 2), value: draft.invoice_discount },
    totalCartons: { type: sql.Int, value: draft.total_cartons },
    totalPairs: { type: sql.Int, value: draft.total_pairs },
    grossValue: { type: sql.Decimal(14, 2), value: draft.gross_value },
    netValue: { type: sql.Decimal(14, 2), value: draft.net_value },
    createdBy: { type: sql.Int, value: draft.created_by ?? null },
  });

  const result = await request.query(`
    INSERT INTO dbo.draft_sale_bills (
      bill_date, store_id, customer_id, sub_customer_id, main_ac_id, delivery_type,
      delivery_address, bill_no, gp_no, bilty_no, adda_id, remarks, invoice_discount,
      total_cartons, total_pairs, gross_value, net_value, created_by
    )
    OUTPUT inserted.draft_id
    VALUES (
      @billDate, @storeId, @customerId, @subCustomerId, @mainAcId, @deliveryType,
      @deliveryAddress, @billNo, @gpNo, @biltyNo, @addaId, @remarks, @invoiceDiscount,
      @totalCartons, @totalPairs, @grossValue, @netValue, @createdBy
    )
  `);
  return result.recordset[0].draft_id;
}

async function insertDraftItems(transaction, draftId, items) {
  for (const [index, item] of items.entries()) {
    const request = requestWithParams(transaction, {
      draftId: { type: sql.Int, value: draftId },
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
      INSERT INTO dbo.draft_sale_bill_items (
        draft_id, variant_id, cartons, pairs, rate, discount_percent, discount_value, value, line_no
      )
      VALUES (
        @draftId, @variantId, @cartons, @pairs, @rate, @discountPercent, @discountValue, @value, @lineNo
      )
    `);
  }
}

async function findById(draftId) {
  const draftResult = await query(
    `SELECT * FROM dbo.draft_sale_bills WHERE draft_id = @draftId`,
    { draftId: { type: sql.Int, value: draftId } },
  );
  const draft = draftResult.recordset[0];
  if (!draft) return null;

  const itemsResult = await query(
    `SELECT
       dsbi.*,
       ac.color,
       a.code AS article_code,
       a.name AS article_name
     FROM dbo.draft_sale_bill_items dsbi
     JOIN dbo.article_colors ac ON ac.variant_id = dsbi.variant_id
     JOIN dbo.articles a ON a.article_id = ac.article_id
     WHERE dsbi.draft_id = @draftId
     ORDER BY dsbi.line_no`,
    { draftId: { type: sql.Int, value: draftId } },
  );

  return { ...draft, items: itemsResult.recordset };
}

async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.customer_id) {
    conditions.push('customer_id = @customerId');
    params.customerId = { type: sql.Int, value: filters.customer_id };
  }
  if (filters.date_from) {
    conditions.push('bill_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('bill_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT * FROM dbo.draft_sale_bills ${where} ORDER BY bill_date DESC, draft_id DESC`,
    params,
  );
  return result.recordset;
}

async function deleteDraft(transaction, draftId) {
  const request = requestWithParams(transaction, { draftId: { type: sql.Int, value: draftId } });
  await request.query('DELETE FROM dbo.draft_sale_bills WHERE draft_id = @draftId');
}

// Same shape as saleBills.repository.insertStockMovements — kept as its own copy so this
// repository doesn't depend on another feature's repository for a plain SQL insert.
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

module.exports = {
  getVariantPackings, insertDraft, insertDraftItems, findById, list, deleteDraft, insertStockMovements,
};
