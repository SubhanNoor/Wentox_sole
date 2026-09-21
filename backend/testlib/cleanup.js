// Deletes fixtures created via helpers/fixtures.js (plus any document rows a test created on top),
// in FK-safe order. Every field is optional — pass only what a given test actually created.
'use strict';

const { query } = require('../src/db/pool');

async function cleanupFixtures({
  billId, returnId, receiptId, purchaseId, materialIds, settlementId, vendorId, bankId, ba_id,
  customerId, variantId, productId, categoryId, storeId, regionId,
} = {}) {
  if (settlementId != null) {
    await query("DELETE FROM dbo.ledger_entries WHERE source_type = 'SETTLEMENT' AND source_id = @id", { id: settlementId });
    await query('DELETE FROM dbo.settlements WHERE settlement_id = @id', { id: settlementId });
  }
  if (purchaseId != null) {
    await query("DELETE FROM dbo.ledger_entries WHERE source_type = 'PURCHASE' AND source_id = @id", { id: purchaseId });
    await query("DELETE FROM dbo.vendor_stock_movements WHERE source_type = 'PURCHASE' AND source_id = @id", { id: purchaseId });
    await query('DELETE FROM dbo.purchases WHERE purchase_id = @id', { id: purchaseId }); // cascades purchase_items
  }
  if (materialIds != null) {
    for (const materialId of materialIds) {
      await query('DELETE FROM dbo.materials WHERE material_id = @id', { id: materialId });
    }
  }
  if (receiptId != null) {
    // Circular FK: receipts.cheque_id -> cheques(cheque_id), cheques.receipt_id -> receipts
    // (NOT NULL) — the receipt's own cheque_id must be nulled out before the cheques row can go,
    // same order receipts.service.js#remove() itself uses.
    const chequeRow = await query('SELECT cheque_id FROM dbo.cheques WHERE receipt_id = @id', { id: receiptId });
    const chequeId = chequeRow.recordset[0]?.cheque_id ?? null;

    await query(
      `DELETE FROM dbo.ledger_entries WHERE source_type = 'CHEQUE_ALLOCATION'
       AND source_id IN (SELECT allocation_id FROM dbo.cheque_allocations WHERE receipt_id = @id)`,
      { id: receiptId },
    );
    await query('DELETE FROM dbo.cheque_allocations WHERE receipt_id = @id', { id: receiptId });
    await query(
      "DELETE FROM dbo.ledger_entries WHERE source_type IN ('RECEIPT', 'COMMISSION') AND source_id = @id",
      { id: receiptId },
    );
    if (chequeId != null) {
      await query('UPDATE dbo.receipts SET cheque_id = NULL WHERE receipt_id = @id', { id: receiptId });
      await query('DELETE FROM dbo.cheques WHERE cheque_id = @chequeId', { chequeId });
    }
    await query('DELETE FROM dbo.receipts WHERE receipt_id = @id', { id: receiptId });
  }
  if (vendorId != null) {
    const row = await query('SELECT ba_id FROM dbo.vendors WHERE vendor_id = @id', { id: vendorId });
    await query('DELETE FROM dbo.vendors WHERE vendor_id = @id', { id: vendorId });
    if (row.recordset[0]?.ba_id != null) {
      await query('DELETE FROM dbo.business_accounts WHERE ba_id = @baId', { baId: row.recordset[0].ba_id });
    }
  }
  if (bankId != null) {
    const row = await query('SELECT ba_id FROM dbo.bank_accounts WHERE bank_id = @id', { id: bankId });
    await query('DELETE FROM dbo.bank_accounts WHERE bank_id = @id', { id: bankId });
    if (row.recordset[0]?.ba_id != null) {
      await query('DELETE FROM dbo.business_accounts WHERE ba_id = @baId', { baId: row.recordset[0].ba_id });
    }
  }
  if (billId != null) {
    await query("DELETE FROM dbo.ledger_entries WHERE source_type = 'SALE_BILL' AND source_id = @id", { id: billId });
    await query("DELETE FROM dbo.stock_movements WHERE source_type = 'SALE_BILL' AND source_id = @id", { id: billId });
    await query('DELETE FROM dbo.sale_bills WHERE bill_id = @id', { id: billId }); // cascades sale_bill_items
  }
  if (returnId != null) {
    await query("DELETE FROM dbo.ledger_entries WHERE source_type = 'SALE_RETURN' AND source_id = @id", { id: returnId });
    await query("DELETE FROM dbo.stock_movements WHERE source_type = 'SALE_RETURN' AND source_id = @id", { id: returnId });
    await query('DELETE FROM dbo.sale_returns WHERE return_id = @id', { id: returnId }); // cascades sale_return_items
  }
  if (customerId != null) {
    await query('DELETE FROM dbo.customers WHERE customer_id = @id', { id: customerId });
  }
  if (ba_id != null) {
    // Opening pair is two legs sharing source_type/source_id — one keyed by ba_id, one by ac_id
    // (OPENING_BALANCE_EQUITY) — see businessAccounts.openingBalance.test.js's own note.
    await query("DELETE FROM dbo.ledger_entries WHERE source_type = 'OPENING' AND source_id = @id", { id: ba_id });
    await query('DELETE FROM dbo.business_accounts WHERE ba_id = @id', { id: ba_id });
  }
  if (variantId != null) {
    await query('DELETE FROM dbo.stock_movements WHERE variant_id = @id', { id: variantId });
    await query('DELETE FROM dbo.article_colors WHERE variant_id = @id', { id: variantId });
  }
  if (productId != null) {
    await query('DELETE FROM dbo.articles WHERE article_id = @id', { id: productId });
  }
  if (categoryId != null) {
    await query('DELETE FROM dbo.product_categories WHERE category_id = @id', { id: categoryId });
  }
  if (storeId != null) {
    await query('DELETE FROM dbo.stores WHERE store_id = @id', { id: storeId });
  }
  if (regionId != null) {
    await query('DELETE FROM dbo.regions WHERE region_id = @id', { id: regionId });
  }
}

module.exports = { cleanupFixtures };
