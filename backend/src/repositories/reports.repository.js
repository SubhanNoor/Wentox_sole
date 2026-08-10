// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

// PRODUCTION-only movement log, with date range + article/category search (Module 5.1's
// reports:production — daily/weekly/monthly/overall filters are resolved to date_from/date_to by
// the service, same convention as saleBills.service.js#resolveDateRange).
async function productionLog(filters = {}) {
  const conditions = ["sm.movement_type = 'PRODUCTION'"];
  const params = {};

  if (filters.article_id) {
    conditions.push('a.article_id = @articleId');
    params.articleId = { type: sql.Int, value: filters.article_id };
  }
  if (filters.category_id) {
    conditions.push('a.category_id = @categoryId');
    params.categoryId = { type: sql.Int, value: filters.category_id };
  }
  if (filters.search) {
    conditions.push('(a.name LIKE @search OR a.code LIKE @search)');
    params.search = { type: sql.NVarChar(150), value: `%${filters.search}%` };
  }
  if (filters.date_from) {
    conditions.push('sm.movement_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('sm.movement_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const result = await query(
    `SELECT sm.*, ac.color, a.code AS article_code, a.name AS article_name, c.name AS category_name
     FROM dbo.stock_movements sm
     JOIN dbo.article_colors ac ON ac.variant_id = sm.variant_id
     JOIN dbo.articles a ON a.article_id = ac.article_id
     JOIN dbo.product_categories c ON c.category_id = a.category_id
     ${where}
     ORDER BY sm.movement_date DESC, sm.movement_id DESC`,
    params,
  );
  return result.recordset;
}

// UC-29/UC-38 Product Ledger — same shape as productionLog() above but across EVERY movement
// type (PRODUCTION, SALE, SALE_RETURN, OPENING, ADJUSTMENT), plus a company/vendor filter
// (a.vendor_id) that productionLog() never needed. Debit(IN)/Credit(OUT) split happens in the
// service — this just returns the signed qty_pairs rows, same as stock.repository.js#movements().
async function productLedger(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.article_id) {
    conditions.push('a.article_id = @articleId');
    params.articleId = { type: sql.Int, value: filters.article_id };
  }
  if (filters.category_id) {
    conditions.push('a.category_id = @categoryId');
    params.categoryId = { type: sql.Int, value: filters.category_id };
  }
  if (filters.vendor_id) {
    conditions.push('a.vendor_id = @vendorId');
    params.vendorId = { type: sql.Int, value: filters.vendor_id };
  }
  if (filters.search) {
    conditions.push('(a.name LIKE @search OR a.code LIKE @search)');
    params.search = { type: sql.NVarChar(150), value: `%${filters.search}%` };
  }
  if (filters.date_from) {
    conditions.push('sm.movement_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('sm.movement_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT sm.*, ac.color, a.article_id, a.code AS article_code, a.name AS article_name,
            c.name AS category_name, v.name AS vendor_name
     FROM dbo.stock_movements sm
     JOIN dbo.article_colors ac ON ac.variant_id = sm.variant_id
     JOIN dbo.articles a ON a.article_id = ac.article_id
     JOIN dbo.product_categories c ON c.category_id = a.category_id
     JOIN dbo.vendors v ON v.vendor_id = a.vendor_id
     ${where}
     ORDER BY sm.movement_date, sm.movement_id`,
    params,
  );
  return result.recordset;
}

// UC-30 Vendor Stock — on-hand raw material per vendor+material+unit, purchases in minus returns/
// consumption out, plus the purchased/returned breakdown the frontend's Material Stock tab shows
// (movement_type is a real CHECK-constrained discriminator on this table, sign-constrained per
// type — PURCHASE_RETURN rows are negative, flipped here for a positive "returned" figure). No
// HAVING filter: a material that was purchased and fully consumed (on_hand = 0) still has real
// purchased/returned history the breakdown view needs to show.
async function vendorStock() {
  const result = await query(
    `SELECT v.vendor_id, v.name AS vendor_name, m.material_id, m.name AS material_name, vsm.unit,
            SUM(CASE WHEN vsm.movement_type = 'PURCHASE' THEN vsm.qty ELSE 0 END) AS purchased_qty,
            SUM(CASE WHEN vsm.movement_type = 'PURCHASE_RETURN' THEN -vsm.qty ELSE 0 END) AS returned_qty,
            SUM(vsm.qty) AS on_hand
     FROM dbo.vendor_stock_movements AS vsm
     JOIN dbo.vendors   AS v ON v.vendor_id   = vsm.vendor_id
     JOIN dbo.materials AS m ON m.material_id = vsm.material_id
     GROUP BY v.vendor_id, v.name, m.material_id, m.name, vsm.unit
     ORDER BY v.name, m.name`,
  );
  return result.recordset;
}

// ── Shared ledger helper ────────────────────────────────────────────────────────────────────
// UC-35 Khaata's exact row shape, backing 4 reports: account-ledger, business-ledger,
// overall-trail's drill-down, and overall-search's drill-down. Exactly one of ba_id/ac_id is
// passed (mirrors CK_ledger_entries_one). Joins back to whichever source document produced each
// row — the join only ever matches for the one LEFT JOIN whose table le.source_type selects, the
// rest stay NULL — so a single pass over ledger_entries gets every report's narration/reference
// columns without N+1 lookups.
async function ledgerRows(filters = {}) {
  if (!filters.ba_id && !filters.ac_id) {
    throw new Error('ledgerRows requires ba_id or ac_id');
  }
  const conditions = [];
  const params = {};

  // cashBook() passes BOTH — Cash uniquely posts across two dimensions (CASH receipts/expenses go
  // straight to the CASH_IN_HAND chart account's ac_id, same as always; a cash<->bank transfer
  // posts via the Cash business account's ba_id, same as every other transfer party) — an OR, not
  // CK_ledger_entries_one's usual "exactly one," which is a per-row constraint and unaffected by
  // this query matching rows from either dimension. Every other caller still passes exactly one.
  if (filters.ba_id && filters.ac_id) {
    conditions.push('(le.ba_id = @baId OR le.ac_id = @acId)');
    params.baId = { type: sql.Int, value: filters.ba_id };
    params.acId = { type: sql.Int, value: filters.ac_id };
  } else if (filters.ba_id) {
    conditions.push('le.ba_id = @baId');
    params.baId = { type: sql.Int, value: filters.ba_id };
  } else {
    conditions.push('le.ac_id = @acId');
    params.acId = { type: sql.Int, value: filters.ac_id };
  }
  if (filters.date_from) {
    conditions.push('le.entry_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('le.entry_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const result = await query(
    `SELECT
       le.entry_id, le.entry_date, le.source_type, le.source_id, le.debit, le.credit,
       le.pairs, le.narration,
       sb.bill_id AS sb_inv_no, sb.bill_no AS sb_bill_no,
       sr.return_id AS sr_inv_no, sr.bill_no AS sr_bill_no,
       rc.receipt_id AS rc_id, rc.payment_mode AS rc_payment_mode, rc.remarks AS rc_remarks,
       rc.details AS rc_details, rc_ba.name AS rc_account_name,
       ch.cheque_no, ch.cheque_date, ch.cheque_received_date,
       ex.expense_id AS ex_id, ex.remarks AS ex_remarks, ex_ba.name AS ex_ba_name,
       -- Cash Book only (UC-37): its TYPE and CHEQUE NO columns come from the paying document, not
       -- from the ledger row. Every other ledgerRows() caller ignores these three.
       ex.payment_mode AS ex_payment_mode, ex.issued_cheque_no AS ex_issued_cheque_no,
       wr.wage_run_id AS wr_id, wr.stage_key AS wr_stage_key, wr_emp.name AS wr_employee_name,
       sar.salary_run_id AS sar_id, sar.period_month AS sar_period_month,
       tr.transfer_id AS tr_id, tr.remarks AS tr_remarks,
       tr_from.name AS tr_from_name, tr_to.name AS tr_to_name
     FROM dbo.ledger_entries le
     LEFT JOIN dbo.sale_bills sb    ON le.source_type = 'SALE_BILL'    AND sb.bill_id = le.source_id
     LEFT JOIN dbo.sale_returns sr  ON le.source_type = 'SALE_RETURN'  AND sr.return_id = le.source_id
     LEFT JOIN dbo.receipts rc      ON le.source_type IN ('RECEIPT','COMMISSION') AND rc.receipt_id = le.source_id
     LEFT JOIN dbo.business_accounts rc_ba ON rc_ba.ba_id = rc.ba_id
     LEFT JOIN dbo.cheques ch       ON rc.cheque_id = ch.cheque_id
     LEFT JOIN dbo.expenses ex      ON le.source_type = 'EXPENSE'      AND ex.expense_id = le.source_id
     LEFT JOIN dbo.business_accounts ex_ba ON ex_ba.ba_id = ex.ba_id
     LEFT JOIN dbo.wage_runs wr     ON le.source_type = 'WAGE_RUN'     AND wr.wage_run_id = le.source_id
     LEFT JOIN dbo.employees wr_emp ON wr_emp.employee_id = wr.employee_id
                                   AND wr_emp.employee_type = wr.employee_type
     LEFT JOIN dbo.salary_runs sar  ON le.source_type = 'SALARY_RUN'   AND sar.salary_run_id = le.source_id
     LEFT JOIN dbo.transfers tr     ON le.source_type = 'TRANSFER'     AND tr.transfer_id = le.source_id
     LEFT JOIN dbo.business_accounts tr_from ON tr_from.ba_id = tr.from_ba_id
     LEFT JOIN dbo.business_accounts tr_to   ON tr_to.ba_id   = tr.to_ba_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY le.entry_date, le.entry_id`,
    params,
  );
  return result.recordset;
}

// Net balance up to (and including, unless exclusive) a given date — business_accounts' own
// Purely the ledger sum up to that date — for BOTH ba_id and ac_id.
//
// It used to add business_accounts.opening_balance on top for the ba_id case. That made an opening
// balance one-sided: it reached the account's balance with no counter-entry anywhere, so the trial
// balance went out by the total of every opening balance in the system. Opening balances are now
// real OPENING ledger rows against OPENING BALANCE EQUITY (businessAccounts.service.js#
// syncOpeningEntries), so adding the column here as well would double-count them.
async function netBalance({ ba_id, ac_id, up_to_date, exclusive = false }) {
  const cmp = exclusive ? '<' : '<=';
  // cashBook() only — same both-dimensions case as ledgerRows() above. Opening balance still comes
  // only from the business_accounts side (chart accounts have no opening_balance column at all).
  if (ba_id && ac_id) {
    const result = await query(
      `SELECT ISNULL(SUM(debit), 0) - ISNULL(SUM(credit), 0) AS ledger_net
       FROM dbo.ledger_entries WHERE (ba_id = @baId OR ac_id = @acId) AND entry_date ${cmp} @upToDate`,
      { baId: { type: sql.Int, value: ba_id }, acId: { type: sql.Int, value: ac_id }, upToDate: { type: sql.Date, value: up_to_date } },
    );
    return Number(result.recordset[0].ledger_net);
  }
  if (ba_id) {
    const result = await query(
      `SELECT ISNULL(SUM(debit), 0) - ISNULL(SUM(credit), 0) AS ledger_net
       FROM dbo.ledger_entries WHERE ba_id = @baId AND entry_date ${cmp} @upToDate`,
      { baId: { type: sql.Int, value: ba_id }, upToDate: { type: sql.Date, value: up_to_date } },
    );
    return Number(result.recordset[0].ledger_net);
  }
  const result = await query(
    `SELECT ISNULL(SUM(debit), 0) - ISNULL(SUM(credit), 0) AS ledger_net
     FROM dbo.ledger_entries WHERE ac_id = @acId AND entry_date ${cmp} @upToDate`,
    { acId: { type: sql.Int, value: ac_id }, upToDate: { type: sql.Date, value: up_to_date } },
  );
  return Number(result.recordset[0].ledger_net);
}

// UC-31/32 Sale Analysis & Sale Report share one grouped aggregation — one row per customer,
// joined to region AND city so the frontend can group/sort by either or both (Region Wise, City
// Wise, Region + City Wise) — bucketing itself happens client-side, this always returns flat
// per-customer rows. LEFT JOIN on cities since customers.city_id is nullable.
async function saleAggregateByCustomer(filters = {}) {
  const params = {};
  const billDate = [];
  const returnDate = [];
  const receiptDate = [];
  const settleDate = [];
  const jvDate = [];

  if (filters.date_from) {
    billDate.push('bill_date >= @dateFrom');
    returnDate.push('return_date >= @dateFrom');
    receiptDate.push('receipt_date >= @dateFrom');
    settleDate.push('settlement_date >= @dateFrom');
    jvDate.push('jv_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    billDate.push('bill_date <= @dateTo');
    returnDate.push('return_date <= @dateTo');
    receiptDate.push('receipt_date <= @dateTo');
    settleDate.push('settlement_date <= @dateTo');
    jvDate.push('jv_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }
  const billWhere = billDate.length ? `WHERE ${billDate.join(' AND ')}` : '';
  const returnWhere = returnDate.length ? `WHERE ${returnDate.join(' AND ')}` : '';
  const receiptWhere = receiptDate.length ? `WHERE ${receiptDate.join(' AND ')}` : '';
  // Built from its own column name rather than string-replacing receiptWhere — that would only
  // swap the FIRST 'receipt_date' and leave the date_to half pointing at a column settlements
  // does not have.
  const settleWhere = `WHERE ${[...settleDate, "status = 'CONFIRMED'"].join(' AND ')}`;
  // Journal Vouchers are reported as their own ROW under the party, never folded into Payment
  // Received — a JV reduces what is owed but is not money collected, and mixing the two would make
  // collections read higher than the cash and cheques actually taken in.
  const jvWhere = `WHERE ${[...jvDate, "status = 'CONFIRMED'"].join(' AND ')}`;

  const result = await query(
    `SELECT
       c.customer_id, c.name AS customer_name, c.region_id, r.name AS region_name,
       c.city_id, ci.name AS city_name,
       ISNULL(sb.total_sales, 0) AS total_sales, ISNULL(sb.total_cartons, 0) AS total_cartons,
       ISNULL(sr.total_returns, 0) AS total_returns,
       ISNULL(rc.total_payment, 0) + ISNULL(st.total_settled, 0) AS total_payment,
       ISNULL(rc.total_commission, 0) AS total_commission,
       ISNULL(jv.total_jv, 0) AS total_jv
     FROM dbo.customers c
     JOIN dbo.regions r ON r.region_id = c.region_id
     LEFT JOIN dbo.cities ci ON ci.city_id = c.city_id
     LEFT JOIN (
       SELECT customer_id, SUM(net_value) AS total_sales, SUM(total_cartons) AS total_cartons
       FROM dbo.sale_bills ${billWhere} GROUP BY customer_id
     ) sb ON sb.customer_id = c.customer_id
     LEFT JOIN (
       SELECT customer_id, SUM(net_value) AS total_returns
       FROM dbo.sale_returns ${returnWhere} GROUP BY customer_id
     ) sr ON sr.customer_id = c.customer_id
     -- Grouped by ba_id, not customer_id: since migration 014 a receipt names any business
     -- account. Joining back through customers.ba_id (UNIQUE) keeps this strictly customer money —
     -- a payment from a director or an employee has no ba_id match here and correctly never lands
     -- in a customer's "Payment Received".
     LEFT JOIN (
       SELECT ba_id, SUM(amount) AS total_payment, SUM(commission) AS total_commission
       FROM dbo.receipts ${receiptWhere ? receiptWhere + " AND status = 'CONFIRMED'" : "WHERE status = 'CONFIRMED'"}
       GROUP BY ba_id
     ) rc ON rc.ba_id = c.ba_id
     -- Direct Settlement (migration 015): the customer discharged their debt by paying one of our
     -- creditors instead of paying us. Real money never reached us, but the debt was settled, so it
     -- counts as Payment Received — leaving it out would show a squared-up customer as outstanding.
     LEFT JOIN (
       SELECT from_ba_id, SUM(amount) AS total_settled
       FROM dbo.settlements ${settleWhere}
       GROUP BY from_ba_id
     ) st ON st.from_ba_id = c.ba_id
     LEFT JOIN (
       SELECT ba_id,
              SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END) AS total_jv
       FROM dbo.journal_vouchers ${jvWhere} GROUP BY ba_id
     ) jv ON jv.ba_id = c.ba_id
     WHERE sb.total_sales IS NOT NULL OR sr.total_returns IS NOT NULL
        OR rc.total_payment IS NOT NULL OR st.total_settled IS NOT NULL
        OR jv.total_jv IS NOT NULL
     ORDER BY r.name, ci.name, c.name`,
    params,
  );
  return result.recordset;
}

// UC-33 Vendor Report — Total Purchase / Purchase Return / Payment Paid (expenses against the
// vendor's ba_id, PLUS cheque_allocations endorsed straight to the vendor via target_vendor_id —
// distinct from target_ba_id, which is only set for EXPENSE_PAYMENT allocations, see
// cheque_allocations' own CK_cheque_allocations_target).
async function vendorReportRows(filters = {}) {
  const params = {};
  const purchaseDate = [];
  const returnDate = [];
  const expenseDate = [];
  const allocDate = [];

  if (filters.vendor_id) {
    purchaseDate.push('vendor_id = @vendorId');
    returnDate.push('vendor_id = @vendorId');
    params.vendorId = { type: sql.Int, value: filters.vendor_id };
  }
  if (filters.date_from) {
    purchaseDate.push('purchase_date >= @dateFrom');
    returnDate.push('return_date >= @dateFrom');
    expenseDate.push('expense_date >= @dateFrom');
    allocDate.push('allocation_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    purchaseDate.push('purchase_date <= @dateTo');
    returnDate.push('return_date <= @dateTo');
    expenseDate.push('expense_date <= @dateTo');
    allocDate.push('allocation_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }
  const purchaseWhere = purchaseDate.length ? `WHERE ${purchaseDate.join(' AND ')}` : '';
  const returnWhere = returnDate.length ? `WHERE ${returnDate.join(' AND ')}` : '';
  const expenseWhere = expenseDate.length ? `WHERE ${expenseDate.join(' AND ')}` : '';
  const allocWhere = [...allocDate, "disposition_type = 'VENDOR_PAYMENT'", "status = 'ACTIVE'"].join(' AND ');
  // Direct Settlement (migration 015): a debtor of ours paid this vendor on our behalf. No money
  // left our cash or bank, but the vendor was paid, so it belongs in "Payment Paid" alongside
  // expenses and cheque endorsements — otherwise a fully-settled vendor reads as never paid.
  const settleDate = [];
  if (filters.date_from) settleDate.push('settlement_date >= @dateFrom');
  if (filters.date_to) settleDate.push('settlement_date <= @dateTo');
  const settleWhere = [...settleDate, "status = 'CONFIRMED'"].join(' AND ');
  const jvDate = [];
  if (filters.date_from) jvDate.push('jv_date >= @dateFrom');
  if (filters.date_to) jvDate.push('jv_date <= @dateTo');
  const jvWhere = [...jvDate, "status = 'CONFIRMED'"].join(' AND ');

  const vendorFilter = filters.vendor_id ? 'WHERE v.vendor_id = @vendorId' : '';
  const result = await query(
    `SELECT
       v.vendor_id, v.name AS vendor_name,
       ISNULL(p.total_purchase, 0) AS total_purchase,
       ISNULL(pr.total_return, 0) AS total_return,
       ISNULL(ex.total_expense_payment, 0) + ISNULL(al.total_alloc_payment, 0)
         + ISNULL(st.total_settled, 0) AS total_payment,
       ISNULL(jv.total_jv, 0) AS total_jv
     FROM dbo.vendors v
     LEFT JOIN (
       SELECT vendor_id, SUM(total_value) AS total_purchase FROM dbo.purchases ${purchaseWhere} GROUP BY vendor_id
     ) p ON p.vendor_id = v.vendor_id
     LEFT JOIN (
       SELECT vendor_id, SUM(total_value) AS total_return FROM dbo.purchase_returns ${returnWhere} GROUP BY vendor_id
     ) pr ON pr.vendor_id = v.vendor_id
     LEFT JOIN (
       SELECT ba.ba_id, SUM(e.amount) AS total_expense_payment
       FROM dbo.expenses e JOIN dbo.business_accounts ba ON ba.ba_id = e.ba_id
       ${expenseWhere ? expenseWhere + " AND e.status = 'CONFIRMED'" : "WHERE e.status = 'CONFIRMED'"}
       GROUP BY ba.ba_id
     ) ex ON ex.ba_id = v.ba_id
     LEFT JOIN (
       SELECT target_vendor_id, SUM(amount) AS total_alloc_payment
       FROM dbo.cheque_allocations WHERE ${allocWhere} GROUP BY target_vendor_id
     ) al ON al.target_vendor_id = v.vendor_id
     LEFT JOIN (
       SELECT to_ba_id, SUM(amount) AS total_settled
       FROM dbo.settlements WHERE ${settleWhere} GROUP BY to_ba_id
     ) st ON st.to_ba_id = v.ba_id
     LEFT JOIN (
       SELECT ba_id,
              SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END) AS total_jv
       FROM dbo.journal_vouchers WHERE ${jvWhere} GROUP BY ba_id
     ) jv ON jv.ba_id = v.ba_id
     ${vendorFilter}
     ORDER BY v.name`,
    params,
  );
  return result.recordset;
}

// UC-34 Payment Trail — 5 fixed buckets. Vendor payments post against a vendor's OWN business
// account (created under VENDORS_ACCOUNTS, 200001 — see vendors.service.js), not the separate
// VENDORS_SUPPLIERS (200002) code, and employee payments post against WORKER_WAGES/
// SALARIES_PAYABLE (each employee's own ba, per employee_type), not the separate EMPLOYEES
// (400005) code — so each bucket is defined by which chart accounts real money actually flows
// through, not by the single reserved code whose NAME matches the bucket label most literally.
async function paymentTrailRows(filters = {}) {
  const conditions = ["e.status = 'CONFIRMED'"];
  const params = {};
  if (filters.date_from) {
    conditions.push('e.expense_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('e.expense_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const result = await query(
    `SELECT ca.code, ca.name, ca.is_restricted, SUM(e.amount) AS total
     FROM dbo.expenses e
     JOIN dbo.business_accounts ba ON ba.ba_id = e.ba_id
     JOIN dbo.chart_of_accounts ca ON ca.ac_id = ba.ac_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY ca.code, ca.name, ca.is_restricted`,
    params,
  );
  return result.recordset;
}

// UC-36 Business Accounts Ledger listing — Code/Description/Main Account/City, plus the resolved
// party category (Customer/Vendor/Employee/Bank/generic) for Overall Trail's grouping (§ new
// report). One business_accounts row is claimed by at most one party table, so the CASE below is
// unambiguous; a row nothing claims is a generic head (e.g. Business Running Expenses, Directors
// Drawings) shown under its own chart-account name.
async function businessAccountsWithCategory() {
  const result = await query(
    `SELECT
       ba.ba_id, ba.code, ba.name, ba.city_id, ci.name AS city_name,
       ca.ac_id, ca.code AS ac_code, ca.name AS ac_name,
       CASE
         WHEN cu.customer_id IS NOT NULL THEN 'CUSTOMER'
         WHEN ve.vendor_id   IS NOT NULL THEN 'VENDOR'
         WHEN em.employee_id IS NOT NULL THEN 'EMPLOYEE'
         WHEN bk.bank_id     IS NOT NULL THEN 'BANK'
         ELSE 'BUSINESS_ACCOUNT'
       END AS category,
       em.employee_type
     FROM dbo.business_accounts ba
     JOIN dbo.chart_of_accounts ca ON ca.ac_id = ba.ac_id
     LEFT JOIN dbo.cities ci        ON ci.city_id = ba.city_id
     LEFT JOIN dbo.customers cu     ON cu.ba_id = ba.ba_id
     LEFT JOIN dbo.vendors ve       ON ve.ba_id = ba.ba_id
     LEFT JOIN dbo.employees em     ON em.ba_id = ba.ba_id
     LEFT JOIN dbo.bank_accounts bk ON bk.ba_id = ba.ba_id
     WHERE ba.status = 'ACTIVE'
     ORDER BY ca.code, ba.code`,
  );
  return result.recordset;
}

// Balance-as-of for EVERY business account in one pass (used by Business Ledger's summary mode
// and Overall Trail, which both need every account's balance rather than one at a time — avoids
// an N+1 netBalance() call per account).
async function businessAccountBalancesAsOf(asOfDate) {
  const result = await query(
    // Ledger sum only — the stored opening_balance used to be added on top here too, which would
    // now double-count it against its own OPENING rows (see netBalance above).
    `SELECT ba.ba_id,
       ISNULL(le.debit_sum, 0) - ISNULL(le.credit_sum, 0) AS balance
     FROM dbo.business_accounts ba
     LEFT JOIN (
       SELECT ba_id, SUM(debit) AS debit_sum, SUM(credit) AS credit_sum
       FROM dbo.ledger_entries WHERE ba_id IS NOT NULL AND entry_date <= @asOf GROUP BY ba_id
     ) le ON le.ba_id = ba.ba_id`,
    { asOf: { type: sql.Date, value: asOfDate } },
  );
  return new Map(result.recordset.map((r) => [r.ba_id, Number(r.balance)]));
}

// Same, for chart accounts posted to directly (no opening_balance column there).
async function chartAccountBalancesAsOf(asOfDate) {
  const result = await query(
    `SELECT ac_id, SUM(debit) - SUM(credit) AS balance
     FROM dbo.ledger_entries WHERE ac_id IS NOT NULL AND entry_date <= @asOf GROUP BY ac_id`,
    { asOf: { type: sql.Date, value: asOfDate } },
  );
  return new Map(result.recordset.map((r) => [r.ac_id, Number(r.balance)]));
}

// Overall Trail's "direct chart account" rows — heads that ledger_entries posts to via ac_id
// rather than through a business_accounts row (SALES, PURCHASES, CASH IN HAND, COMMISSION
// ALLOWED, CHEQUES IN HAND, WAGES/SALARIES EXPENSE, ...). Only accounts with at least one posted
// entry are returned — an account nothing has ever posted to isn't worth a trial-balance row.
async function chartAccountsWithActivity() {
  const result = await query(
    `SELECT DISTINCT ca.ac_id, ca.code, ca.name, ca.is_restricted
     FROM dbo.chart_of_accounts ca
     JOIN dbo.ledger_entries le ON le.ac_id = ca.ac_id
     ORDER BY ca.code`,
  );
  return result.recordset;
}

// UC-37 Cash Book — CASH_IN_HAND account's ledger rows for a date/month, reusing ledgerRows()'s
// join set so cheque-allocation and expense narrations come along for free.
function cashBookRows(cashAcId, filters) {
  return ledgerRows({ ac_id: cashAcId, date_from: filters.date_from, date_to: filters.date_to });
}

// UC-37 Cash Book, "Cheq./Online" columns — the day's NON-cash receipts and payments, listed for
// visibility only. They are deliberately NOT read from the cash ledger, because they never touch
// it: a CHEQUE receipt posts to CHEQUES IN HAND and an ONLINE one to the receiving bank, so no
// query over CASH IN HAND could ever surface them. Read from the source documents instead, which
// also means zero risk of double-counting a cash row — the two sets are disjoint by construction.
//
// The caller keeps these out of every cash total (they only reach the Totals strip); the summary
// box stays strictly "what the cash drawer did", per UC-37.
//
// Receipts: CHEQUE (cheque_no via cheques) and ONLINE. Expenses: CHEQUE_ISSUED (our own cheque,
// number on the expense row itself), CHEQUE_ENDORSED (a customer's cheque handed on, number via
// cheques) and ONLINE. DRAFT documents are excluded — nothing unconfirmed belongs on a day book.
//
// Third source: cheque_allocations, which UC-37 requires ("an endorsed cheque posts as an outflow
// on its allocation date"). Only VENDOR_PAYMENT, and only while ACTIVE. The other two dispositions
// are deliberately excluded because they would DOUBLE-COUNT:
//   EXPENSE_PAYMENT — carries an expense_id, so its dbo.expenses row (payment_mode
//                     'CHEQUE_ENDORSED') is already picked up by the UNION above.
//   DEPOSIT         — banking a cheque is an internal asset move (Dr bank / Cr CHEQUES IN HAND),
//                     not new money; the receipt that brought the cheque in already appears as a
//                     Receipts Cheq./Online row on its own date.
// A REVERSED allocation (bounce/return cascade, §6.1 reverse-never-delete) is excluded for the
// same reason a reversed anything is: the money went back.
async function cashBookNonCashRows({ date_from, date_to }) {
  const result = await query(
    `SELECT 'RECEIPT' AS kind, rc.receipt_id AS source_id, rc.receipt_date AS entry_date,
            rc_ba.name AS account_name, COALESCE(rc.remarks, rc.details) AS remarks,
            rc.payment_mode, ch.cheque_no, rc.amount
     FROM dbo.receipts rc
     JOIN dbo.business_accounts rc_ba ON rc_ba.ba_id = rc.ba_id
     LEFT JOIN dbo.cheques ch ON ch.cheque_id = rc.cheque_id
     WHERE rc.status = 'CONFIRMED' AND rc.payment_mode <> 'CASH'
       AND rc.receipt_date >= @dateFrom AND rc.receipt_date <= @dateTo
     UNION ALL
     SELECT 'EXPENSE' AS kind, ex.expense_id, ex.expense_date,
            ba.name, COALESCE(ex.remarks, ex.details),
            ex.payment_mode, COALESCE(ex.issued_cheque_no, ch.cheque_no), ex.amount
     FROM dbo.expenses ex
     JOIN dbo.business_accounts ba ON ba.ba_id = ex.ba_id
     LEFT JOIN dbo.cheques ch ON ch.cheque_id = ex.cheque_id
     WHERE ex.status = 'CONFIRMED' AND ex.payment_mode <> 'CASH'
       AND ex.expense_date >= @dateFrom AND ex.expense_date <= @dateTo
     UNION ALL
     SELECT 'ALLOCATION' AS kind, ca.allocation_id, ca.allocation_date,
            v.name, COALESCE(ca.remarks, 'Cheque endorsed to vendor'),
            'CHEQUE', ch.cheque_no, ca.amount
     FROM dbo.cheque_allocations ca
     JOIN dbo.vendors v   ON v.vendor_id   = ca.target_vendor_id
     JOIN dbo.receipts rc2 ON rc2.receipt_id = ca.receipt_id
     LEFT JOIN dbo.cheques ch ON ch.cheque_id = rc2.cheque_id
     WHERE ca.status = 'ACTIVE' AND ca.disposition_type = 'VENDOR_PAYMENT'
       AND ca.allocation_date >= @dateFrom AND ca.allocation_date <= @dateTo
     ORDER BY entry_date, kind, source_id`,
    {
      dateFrom: { type: sql.Date, value: date_from },
      dateTo: { type: sql.Date, value: date_to },
    },
  );
  return result.recordset;
}

// New "Overall Searching" (UC-none — user-requested) — backed by the migration 008 VIEW so it
// stays current with customers/vendors/employees/sub_customers/business_accounts automatically,
// no app-side UNION to keep in sync by hand.
async function overallDirectory(searchQuery, entityType) {
  const conditions = [];
  const params = {};
  if (searchQuery) {
    conditions.push('(name LIKE @search OR CAST(entity_id AS VARCHAR(20)) LIKE @search)');
    params.search = { type: sql.NVarChar(150), value: `%${searchQuery}%` };
  }
  if (entityType) {
    conditions.push('entity_type = @entityType');
    params.entityType = { type: sql.VarChar(20), value: entityType };
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(`SELECT * FROM dbo.vw_overall_directory ${where} ORDER BY name`, params);
  return result.recordset;
}

module.exports = {
  productionLog,
  productLedger,
  vendorStock,
  ledgerRows,
  netBalance,
  saleAggregateByCustomer,
  vendorReportRows,
  paymentTrailRows,
  businessAccountsWithCategory,
  businessAccountBalancesAsOf,
  chartAccountBalancesAsOf,
  chartAccountsWithActivity,
  cashBookRows,
  cashBookNonCashRows,
  overallDirectory,
};
