// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/saleBills.repository');
const chartAccountsRepository = require('../repositories/chartAccounts.repository');
const customersService = require('./customers.service');
const ApiError = require('../errors/ApiError');
const { withTransaction } = require('../db/pool');
const {
  buildLine, buildTotals, validateItems, checkKnownVariants, validateDeliveryCustomer,
} = require('./saleBillMath');
const CODES = require('../constants/reservedAccounts');

function validateHeader(payload) {
  if (!payload.customer_id) throw ApiError.badRequest('customer_id is required');
  if (!payload.bilty_no) throw ApiError.badRequest('bilty_no is required');
  if (!payload.adda_id) throw ApiError.badRequest('adda_id is required');
  if (!payload.bill_no) throw ApiError.badRequest('bill_no is required');
  if (!payload.gp_no) throw ApiError.badRequest('gp_no is required');
  validateDeliveryCustomer(payload);
}

async function create(payload, userId) {
  validateItems(payload.items);
  validateHeader(payload);

  const variantIds = [...new Set(payload.items.map((item) => item.variant_id))];
  const packings = await repository.getVariantPackings(variantIds);
  checkKnownVariants(variantIds, packings);

  const lines = payload.items.map((item) => buildLine(item, packings.get(item.variant_id)));
  const totals = buildTotals(lines, payload.invoice_discount);

  const bill = {
    bill_date: payload.bill_date,
    store_id: payload.store_id,
    customer_id: payload.customer_id,
    sub_customer_id: payload.sub_customer_id,
    main_ac_id: payload.main_ac_id,
    delivery_type: payload.delivery_type || 'SAME',
    delivery_address: payload.delivery_address,
    bill_no: payload.bill_no,
    gp_no: payload.gp_no,
    bilty_no: payload.bilty_no,
    adda_id: payload.adda_id,
    remarks: payload.remarks,
    invoice_discount: payload.invoice_discount || 0,
    total_cartons: totals.totalCartons,
    total_pairs: totals.totalPairs,
    gross_value: totals.grossValue,
    net_value: totals.netValue,
    status: 'DRAFT',
    created_by: userId,
  };

  const billId = await withTransaction(async (transaction) => {
    const id = await repository.insert(transaction, bill);
    await repository.insertItems(transaction, id, lines);
    return id;
  });

  return repository.findById(billId);
}

// Shared posting logic (schema §6 posting matrix): debit CUSTOMER BA / credit SALES chart account,
// negative SALE stock movement per item. Used by sale-bills:post and by draftSaleBills.confirm
// (which posts immediately instead of leaving the bill unposted).
async function postLedgerAndStock(transaction, { billId, customerId, netValue, billDate, items }) {
  const customer = await customersService.getById(customerId);
  if (!customer.ba_id) {
    throw ApiError.conflict(
      'Customer has no linked account yet — add one before posting',
      'NO_CUSTOMER_ACCOUNT',
    );
  }

  const salesAccount = await chartAccountsRepository.findByCode(CODES.SALES);
  if (!salesAccount) {
    throw new Error(`Reserved chart account SALES (code ${CODES.SALES}) not found — run npm run seed`);
  }

  await repository.insertLedgerEntries(transaction, [
    {
      entry_date: billDate,
      ba_id: customer.ba_id,
      debit: netValue,
      credit: 0,
      source_type: 'SALE_BILL',
      source_id: billId,
      narration: `Sale bill #${billId}`,
    },
    {
      entry_date: billDate,
      ac_id: salesAccount.ac_id,
      debit: 0,
      credit: netValue,
      source_type: 'SALE_BILL',
      source_id: billId,
      narration: `Sale bill #${billId}`,
    },
  ]);

  await repository.insertStockMovements(
    transaction,
    items.map((item) => ({
      variant_id: item.variant_id,
      movement_type: 'SALE',
      qty_pairs: -item.pairs,
      movement_date: billDate,
      source_type: 'SALE_BILL',
      source_id: billId,
    })),
  );
}

// Inserts an already-built bill+lines with an explicit status (used by draftSaleBills.confirm,
// which builds a CONFIRMED bill directly from a draft's already-computed data instead of
// recomputing totals). Caller owns the transaction.
async function insertConfirmed(transaction, bill, lines) {
  const id = await repository.insert(transaction, bill);
  await repository.insertItems(transaction, id, lines);
  return id;
}

async function getById(billId) {
  const bill = await repository.findById(billId);
  if (!bill) throw ApiError.notFound('Sale bill not found');
  return bill;
}

module.exports = { create, postLedgerAndStock, insertConfirmed, getById };
