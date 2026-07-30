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

async function insert(transaction, bill) {
  const request = requestWithParams(transaction, {
    billDate: { type: sql.Date, value: bill.bill_date },
    storeId: { type: sql.Int, value: bill.store_id ?? null },
    customerId: { type: sql.Int, value: bill.customer_id },
    subCustomerId: { type: sql.Int, value: bill.sub_customer_id ?? null },
    mainAcId: { type: sql.Int, value: bill.main_ac_id ?? null },
    deliveryType: { type: sql.VarChar(10), value: bill.delivery_type },
    deliveryAddress: { type: sql.NVarChar(300), value: bill.delivery_address ?? null },
    billNo: { type: sql.VarChar(30), value: bill.bill_no },
    gpNo: { type: sql.VarChar(30), value: bill.gp_no },
    biltyNo: { type: sql.VarChar(30), value: bill.bilty_no },
    addaId: { type: sql.Int, value: bill.adda_id },
    remarks: { type: sql.NVarChar(500), value: bill.remarks ?? null },
    invoiceDiscount: { type: sql.Decimal(12, 2), value: bill.invoice_discount },
    totalCartons: { type: sql.Int, value: bill.total_cartons },
    totalPairs: { type: sql.Int, value: bill.total_pairs },
    grossValue: { type: sql.Decimal(14, 2), value: bill.gross_value },
    netValue: { type: sql.Decimal(14, 2), value: bill.net_value },
    status: { type: sql.VarChar(10), value: bill.status },
    createdBy: { type: sql.Int, value: bill.created_by ?? null },
  });

  const result = await request.query(`
    INSERT INTO dbo.sale_bills (
      bill_date, store_id, customer_id, sub_customer_id, main_ac_id, delivery_type,
      delivery_address, bill_no, gp_no, bilty_no, adda_id, remarks, invoice_discount,
      total_cartons, total_pairs, gross_value, net_value, status, created_by
    )
    OUTPUT inserted.bill_id
    VALUES (
      @billDate, @storeId, @customerId, @subCustomerId, @mainAcId, @deliveryType,
      @deliveryAddress, @billNo, @gpNo, @biltyNo, @addaId, @remarks, @invoiceDiscount,
      @totalCartons, @totalPairs, @grossValue, @netValue, @status, @createdBy
    )
  `);
  return result.recordset[0].bill_id;
}

async function insertItems(transaction, billId, items) {
  for (const [index, item] of items.entries()) {
    const request = requestWithParams(transaction, {
      billId: { type: sql.Int, value: billId },
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
      INSERT INTO dbo.sale_bill_items (
        bill_id, variant_id, cartons, pairs, rate, discount_percent, discount_value, value, line_no
      )
      VALUES (
        @billId, @variantId, @cartons, @pairs, @rate, @discountPercent, @discountValue, @value, @lineNo
      )
    `);
  }
}

async function findById(billId) {
  const billResult = await query(
    `SELECT * FROM dbo.sale_bills WHERE bill_id = @billId`,
    { billId: { type: sql.Int, value: billId } },
  );
  const bill = billResult.recordset[0];
  if (!bill) return null;

  const itemsResult = await query(
    `SELECT
       sbi.*,
       ac.color,
       a.code AS article_code,
       a.name AS article_name
     FROM dbo.sale_bill_items sbi
     JOIN dbo.article_colors ac ON ac.variant_id = sbi.variant_id
     JOIN dbo.articles a ON a.article_id = ac.article_id
     WHERE sbi.bill_id = @billId
     ORDER BY sbi.line_no`,
    { billId: { type: sql.Int, value: billId } },
  );

  return { ...bill, items: itemsResult.recordset };
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

// Bulk-inserts stock_movements rows (used for the negative SALE rows written on post).
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
  getVariantPackings, insert, insertItems, findById, insertLedgerEntries, insertStockMovements,
};
