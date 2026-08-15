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
    gpNo: { type: sql.VarChar(30), value: bill.gp_no ?? null },
    biltyNo: { type: sql.VarChar(30), value: bill.bilty_no ?? null },
    addaId: { type: sql.Int, value: bill.adda_id ?? null },
    remarks: { type: sql.NVarChar(500), value: bill.remarks ?? null },
    invoiceDiscount: { type: sql.Decimal(12, 2), value: bill.invoice_discount },
    totalCartons: { type: sql.Int, value: bill.total_cartons },
    totalPairs: { type: sql.Int, value: bill.total_pairs },
    grossValue: { type: sql.Decimal(14, 2), value: bill.gross_value },
    netValue: { type: sql.Decimal(14, 2), value: bill.net_value },
    dueDate: { type: sql.Date, value: bill.due_date ?? null },
    createdBy: { type: sql.Int, value: bill.created_by ?? null },
  });

  const result = await request.query(`
    INSERT INTO dbo.sale_bills (
      bill_date, store_id, customer_id, sub_customer_id, main_ac_id, delivery_type,
      delivery_address, bill_no, gp_no, bilty_no, adda_id, remarks, invoice_discount,
      total_cartons, total_pairs, gross_value, net_value, due_date, created_by
    )
    OUTPUT inserted.bill_id
    VALUES (
      @billDate, @storeId, @customerId, @subCustomerId, @mainAcId, @deliveryType,
      @deliveryAddress, @billNo, @gpNo, @biltyNo, @addaId, @remarks, @invoiceDiscount,
      @totalCartons, @totalPairs, @grossValue, @netValue, @dueDate, @createdBy
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

  return { ...bill, is_posted: await isPosted(billId), items: itemsResult.recordset };
}

// "Posted" is derived from ledger_entries existing for this bill, rather than a stored status
// column (dropped — schema §6 update) — a bill is posted iff its ledger/stock rows are live.
async function isPosted(billId) {
  const result = await query(
    `SELECT CASE WHEN EXISTS (
       SELECT 1 FROM dbo.ledger_entries WHERE source_type = 'SALE_BILL' AND source_id = @billId
     ) THEN 1 ELSE 0 END AS posted`,
    { billId: { type: sql.Int, value: billId } },
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

async function deleteItems(transaction, billId) {
  const request = requestWithParams(transaction, { billId: { type: sql.Int, value: billId } });
  await request.query('DELETE FROM dbo.sale_bill_items WHERE bill_id = @billId');
}

async function updateHeader(transaction, billId, bill) {
  const request = requestWithParams(transaction, {
    billId: { type: sql.Int, value: billId },
    billDate: { type: sql.Date, value: bill.bill_date },
    storeId: { type: sql.Int, value: bill.store_id ?? null },
    customerId: { type: sql.Int, value: bill.customer_id },
    subCustomerId: { type: sql.Int, value: bill.sub_customer_id ?? null },
    mainAcId: { type: sql.Int, value: bill.main_ac_id ?? null },
    deliveryType: { type: sql.VarChar(10), value: bill.delivery_type },
    deliveryAddress: { type: sql.NVarChar(300), value: bill.delivery_address ?? null },
    billNo: { type: sql.VarChar(30), value: bill.bill_no },
    gpNo: { type: sql.VarChar(30), value: bill.gp_no ?? null },
    biltyNo: { type: sql.VarChar(30), value: bill.bilty_no ?? null },
    addaId: { type: sql.Int, value: bill.adda_id ?? null },
    remarks: { type: sql.NVarChar(500), value: bill.remarks ?? null },
    invoiceDiscount: { type: sql.Decimal(12, 2), value: bill.invoice_discount },
    totalCartons: { type: sql.Int, value: bill.total_cartons },
    totalPairs: { type: sql.Int, value: bill.total_pairs },
    grossValue: { type: sql.Decimal(14, 2), value: bill.gross_value },
    netValue: { type: sql.Decimal(14, 2), value: bill.net_value },
    dueDate: { type: sql.Date, value: bill.due_date ?? null },
  });

  await request.query(`
    UPDATE dbo.sale_bills SET
      bill_date = @billDate, store_id = @storeId, customer_id = @customerId,
      sub_customer_id = @subCustomerId, main_ac_id = @mainAcId, delivery_type = @deliveryType,
      delivery_address = @deliveryAddress, bill_no = @billNo, gp_no = @gpNo, bilty_no = @biltyNo,
      adda_id = @addaId, remarks = @remarks, invoice_discount = @invoiceDiscount,
      total_cartons = @totalCartons, total_pairs = @totalPairs, gross_value = @grossValue,
      net_value = @netValue, due_date = @dueDate
    WHERE bill_id = @billId
  `);
}

async function deleteLedgerAndStock(transaction, billId) {
  const request = requestWithParams(transaction, { billId: { type: sql.Int, value: billId } });
  await request.query(
    `DELETE FROM dbo.ledger_entries WHERE source_type = 'SALE_BILL' AND source_id = @billId`,
  );
  await request.query(
    `DELETE FROM dbo.stock_movements WHERE source_type = 'SALE_BILL' AND source_id = @billId`,
  );
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
    conditions.push('bill_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('bill_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT * FROM dbo.sale_bills ${where} ORDER BY bill_date DESC, bill_id DESC`,
    params,
  );
  return result.recordset;
}

// UC-20: Search & Bilty/Adda Updation — same filter set as list() but with the display fields
// that screen needs (customer/sub-customer/adda names), so results are readable without a
// separate lookup per row.
async function biltySearch(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.customer_id) {
    conditions.push('sb.customer_id = @customerId');
    params.customerId = { type: sql.Int, value: filters.customer_id };
  }
  if (filters.sub_customer_id) {
    conditions.push('sb.sub_customer_id = @subCustomerId');
    params.subCustomerId = { type: sql.Int, value: filters.sub_customer_id };
  }
  if (filters.bill_no) {
    // BA-01: search by either bill number — the manual one (bill_no, client-typed) or the
    // system-generated one (bill_id, the IDENTITY "Inv #"). A numeric query might be either, so
    // both sides of the OR are checked; billId is null (never matches) when the query isn't a
    // plain integer.
    const trimmed = String(filters.bill_no).trim();
    const asBillId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
    conditions.push('(sb.bill_no = @billNo OR sb.bill_id = @billId)');
    params.billNo = { type: sql.VarChar(30), value: trimmed };
    params.billId = { type: sql.Int, value: asBillId };
  }
  if (filters.date_from) {
    conditions.push('sb.bill_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('sb.bill_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT sb.*, c.name AS customer_name, sc.name AS sub_customer_name, ad.name AS adda_name
     FROM dbo.sale_bills sb
     JOIN dbo.customers c ON c.customer_id = sb.customer_id
     LEFT JOIN dbo.sub_customers sc ON sc.sub_customer_id = sb.sub_customer_id
     LEFT JOIN dbo.addas ad ON ad.adda_id = sb.adda_id
     ${where}
     ORDER BY sb.bill_date DESC, sb.bill_id DESC`,
    params,
  );
  return result.recordset;
}

// bilty_no + adda_id ONLY — non-financial, so unlike updateHeader() this never touches
// ledger/stock and is allowed regardless of posted status (UC-20).
async function updateBiltyInfo(billId, { bilty_no, adda_id }) {
  await query(
    'UPDATE dbo.sale_bills SET bilty_no = @biltyNo, adda_id = @addaId WHERE bill_id = @billId',
    {
      billId: { type: sql.Int, value: billId },
      biltyNo: { type: sql.VarChar(30), value: bilty_no },
      addaId: { type: sql.Int, value: adda_id },
    },
  );
}

// SR-01: the rate this customer actually paid last time for this variant, across every POSTED
// bill (not drafts — a draft's rate was never confirmed as real). Most recent by bill_date, then
// bill_id as the tiebreak for same-day bills. Null when there's no prior posted sale to go on.
async function lastSoldRate(customerId, variantId) {
  const result = await query(
    `SELECT TOP 1 sbi.rate
     FROM dbo.sale_bill_items sbi
     JOIN dbo.sale_bills sb ON sb.bill_id = sbi.bill_id
     WHERE sb.customer_id = @customerId AND sbi.variant_id = @variantId
       AND EXISTS (SELECT 1 FROM dbo.ledger_entries le WHERE le.source_type = 'SALE_BILL' AND le.source_id = sb.bill_id)
     ORDER BY sb.bill_date DESC, sb.bill_id DESC`,
    {
      customerId: { type: sql.Int, value: customerId },
      variantId: { type: sql.Int, value: variantId },
    },
  );
  return result.recordset[0] ? Number(result.recordset[0].rate) : null;
}

module.exports = {
  getVariantPackings, insert, insertItems, findById, isPosted, insertLedgerEntries,
  insertStockMovements, deleteItems, updateHeader, deleteLedgerAndStock, list,
  biltySearch, updateBiltyInfo, lastSoldRate,
};
