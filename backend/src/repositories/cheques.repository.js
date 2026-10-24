// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query, requestWithParams, acquireAppLock } = require('../db/pool');

// Takes the caller's transaction — always called right after receipts.repository.js#insert() in
// the same withTransaction block (receipts.service.js:create()), then linked back via
// receipts.repository.js#linkCheque(). See the schema's own note on this two-step insert order.
async function insert(transaction, cheque) {
  const request = requestWithParams(transaction, {
    receiptId: { type: sql.Int, value: cheque.receipt_id },
    chequeNo: { type: sql.VarChar(50), value: cheque.cheque_no },
    chequeDate: { type: sql.Date, value: cheque.cheque_date },
    chequeReceivedDate: { type: sql.Date, value: cheque.cheque_received_date ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.cheques (receipt_id, cheque_no, cheque_date, cheque_received_date, cheque_status)
    OUTPUT inserted.cheque_id
    VALUES (@receiptId, @chequeNo, @chequeDate, @chequeReceivedDate, 'PENDING')
  `);
  return result.recordset[0].cheque_id;
}

async function updateDetails(transaction, chequeId, { cheque_no, cheque_date, cheque_received_date }) {
  const request = requestWithParams(transaction, {
    chequeId: { type: sql.Int, value: chequeId },
    chequeNo: { type: sql.VarChar(50), value: cheque_no },
    chequeDate: { type: sql.Date, value: cheque_date },
    chequeReceivedDate: { type: sql.Date, value: cheque_received_date ?? null },
  });
  await request.query(`
    UPDATE dbo.cheques SET cheque_no = @chequeNo, cheque_date = @chequeDate,
      cheque_received_date = @chequeReceivedDate
    WHERE cheque_id = @chequeId
  `);
}

async function findById(chequeId) {
  const result = await query(
    `SELECT ch.*, r.amount AS receipt_amount, r.ba_id, r.status AS receipt_status,
            ba.name AS account_name, c.customer_id, c.name AS customer_name, b.name AS bank_name
     FROM dbo.cheques ch
     JOIN dbo.receipts r ON r.receipt_id = ch.receipt_id
     JOIN dbo.business_accounts ba ON ba.ba_id = r.ba_id
     LEFT JOIN dbo.customers c ON c.ba_id = r.ba_id
     LEFT JOIN dbo.bank_accounts b ON b.bank_id = ch.bank_id
     WHERE ch.cheque_id = @chequeId`,
    { chequeId: { type: sql.Int, value: chequeId } },
  );
  return result.recordset[0] || null;
}

// Only ever called on a cheque with no allocations against it (a DRAFT receipt's cheque switched
// out of CHEQUE mode, or dropped entirely — see receipts.service.js#update()/#remove()).
async function deleteCheque(transaction, chequeId) {
  const request = requestWithParams(transaction, { chequeId: { type: sql.Int, value: chequeId } });
  await request.query('DELETE FROM dbo.cheques WHERE cheque_id = @chequeId');
}

async function findByReceiptId(receiptId) {
  const result = await query(
    'SELECT * FROM dbo.cheques WHERE receipt_id = @receiptId',
    { receiptId: { type: sql.Int, value: receiptId } },
  );
  return result.recordset[0] || null;
}

// Endorsable picker (Expense screen) reads PENDING/DEPOSITED only (IX_cheques_endorsable); cheque-
// due alerts read PENDING/PARTIALLY_ENDORSED only (IX_cheques_due) — this list() supports both via
// filters.status, plus a general status/date/bank browse for the Cheques tab.
async function list(filters = {}) {
  const conditions = [];
  const params = {};

  if (filters.status) {
    conditions.push('ch.cheque_status = @status');
    params.status = { type: sql.VarChar(20), value: filters.status };
  }
  if (filters.bank_id) {
    conditions.push('ch.bank_id = @bankId');
    params.bankId = { type: sql.Int, value: filters.bank_id };
  }
  if (filters.date_from) {
    conditions.push('ch.cheque_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('ch.cheque_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    // receipt_status rides along so the Disposal screen can tell a posted cheque from one whose
    // receipt is still DRAFT — assertDisposable() refuses the latter, and without this column the
    // UI offered a Dispose button that could only ever fail.
    `SELECT ch.*, r.amount AS receipt_amount, r.ba_id, r.status AS receipt_status,
            ba.name AS account_name, c.customer_id, c.name AS customer_name, b.name AS bank_name
     FROM dbo.cheques ch
     JOIN dbo.receipts r ON r.receipt_id = ch.receipt_id
     JOIN dbo.business_accounts ba ON ba.ba_id = r.ba_id
     LEFT JOIN dbo.customers c ON c.ba_id = r.ba_id
     LEFT JOIN dbo.bank_accounts b ON b.bank_id = ch.bank_id
     ${where}
     ORDER BY ch.cheque_date DESC, ch.cheque_id DESC`,
    params,
  );
  return result.recordset;
}

async function setBank(transaction, chequeId, bankId) {
  const request = requestWithParams(transaction, {
    chequeId: { type: sql.Int, value: chequeId },
    bankId: { type: sql.Int, value: bankId },
  });
  await request.query('UPDATE dbo.cheques SET bank_id = @bankId WHERE cheque_id = @chequeId');
}

async function setStatus(transaction, chequeId, status) {
  const request = requestWithParams(transaction, {
    chequeId: { type: sql.Int, value: chequeId },
    status: { type: sql.VarChar(20), value: status },
  });
  await request.query('UPDATE dbo.cheques SET cheque_status = @status WHERE cheque_id = @chequeId');
}

// Claims a BOUNCED cheque for re-use: flips BOUNCED -> PENDING and reports whether THIS call did it.
// The status change is the guard against a double re-credit — two simultaneous first actions both
// read BOUNCED before their transactions open, but only one UPDATE can match.
async function claimBouncedForReuse(transaction, chequeId) {
  const request = requestWithParams(transaction, { chequeId: { type: sql.Int, value: chequeId } });
  const result = await request.query(
    `UPDATE dbo.cheques SET cheque_status = 'PENDING' WHERE cheque_id = @chequeId AND cheque_status = 'BOUNCED'`,
  );
  return result.rowsAffected[0] > 0;
}

// Locks the cheque row for the rest of `transaction` and reports whether its status is still one of
// `statuses`. Every caller checks the status on a pool read BEFORE its transaction opens, so two
// simultaneous actions both pass that check; this no-op UPDATE is where the second one waits for
// the first to commit and then finds the status has moved on. Once it has run, no pool read of
// this cheque row may follow inside the same transaction — it would wait on our own lock.
async function lockIfStatusIn(transaction, chequeId, statuses) {
  const params = { chequeId: { type: sql.Int, value: chequeId } };
  statuses.forEach((status, i) => { params[`status${i}`] = { type: sql.VarChar(20), value: status }; });
  const request = requestWithParams(transaction, params);
  const result = await request.query(
    `UPDATE dbo.cheques SET cheque_status = cheque_status
     WHERE cheque_id = @chequeId AND cheque_status IN (${statuses.map((_, i) => `@status${i}`).join(', ')})`,
  );
  return result.rowsAffected[0] > 0;
}

// Serializes every money action on ONE cheque (deposit, endorse, bounce, return, undo) and returns
// its status as of now. The services check status and remaining balance on a pool read BEFORE their
// transaction opens, so two clicks both passed those checks and both posted — a double endorsement,
// or a receipt reversed twice. Under this lock the second caller waits for the first to commit, then
// re-checks against the committed state. Released automatically at commit/rollback. Also taken by
// receipts.service.js#unpost/#unconfirm, so a receipt cannot be unposted under a cheque being used.
// Returns { cheque_status, receipt_status } — both as committed, read inside the lock.
async function lockCheque(transaction, chequeId) {
  await acquireAppLock(transaction, `cheque:${chequeId}`);
  const request = requestWithParams(transaction, { chequeId: { type: sql.Int, value: chequeId } });
  const result = await request.query(
    `SELECT ch.cheque_status, r.status AS receipt_status
     FROM dbo.cheques ch JOIN dbo.receipts r ON r.receipt_id = ch.receipt_id
     WHERE ch.cheque_id = @chequeId`,
  );
  return result.recordset[0] || { cheque_status: null, receipt_status: null };
}

// An ACTIVE allocation already tied to this expense, read inside the caller's transaction (under
// lockCheque) — what stops two simultaneous posts of one CHEQUE_ENDORSED expense from both endorsing.
async function hasActiveAllocationForExpenseInTransaction(transaction, expenseId) {
  const request = requestWithParams(transaction, { expenseId: { type: sql.Int, value: expenseId } });
  const result = await request.query(
    `SELECT TOP 1 1 AS found FROM dbo.cheque_allocations WHERE expense_id = @expenseId AND status = 'ACTIVE'`,
  );
  return result.recordset.length > 0;
}

async function markBounced(transaction, chequeId, bouncedDate) {
  const request = requestWithParams(transaction, {
    chequeId: { type: sql.Int, value: chequeId },
    bouncedDate: { type: sql.Date, value: bouncedDate },
  });
  await request.query(
    `UPDATE dbo.cheques SET cheque_status = 'BOUNCED', bounced_date = @bouncedDate WHERE cheque_id = @chequeId`,
  );
}

// A bounce that only undoes ONE step (the latest allocation) leaves the cheque in an earlier state
// rather than BOUNCED, but it must still be marked as bounced — bounced_date is that marker.
async function setBouncedDate(transaction, chequeId, bouncedDate) {
  const request = requestWithParams(transaction, {
    chequeId: { type: sql.Int, value: chequeId },
    bouncedDate: { type: sql.Date, value: bouncedDate },
  });
  await request.query('UPDATE dbo.cheques SET bounced_date = @bouncedDate WHERE cheque_id = @chequeId');
}

// The most recent still-ACTIVE allocation (deposit or endorsement) on a receipt — the step a bounce
// undoes. Latest by ENTRY order (allocation_id), not allocation_date: a back-dated step entered later
// is still the most recent hand-over (user decision, 2026-10-22).
async function findLatestActiveAllocation(receiptId) {
  const result = await query(
    `SELECT TOP 1 ca.*, ch.cheque_id, ch.cheque_status, ch.cheque_no, ch.cheque_date
     FROM dbo.cheque_allocations ca
     JOIN dbo.cheques ch ON ch.receipt_id = ca.receipt_id
     WHERE ca.receipt_id = @receiptId AND ca.status = 'ACTIVE'
     ORDER BY ca.allocation_id DESC`,
    { receiptId: { type: sql.Int, value: receiptId } },
  );
  return result.recordset[0] || null;
}

// RETURNED — distinct from BOUNCED (a due-date issue or any other non-bounce reason), same
// reverse-never-delete mechanics, own date/reason columns (see 002_cheques_returned_status.sql).
async function markReturned(transaction, chequeId, returnedDate, reason) {
  const request = requestWithParams(transaction, {
    chequeId: { type: sql.Int, value: chequeId },
    returnedDate: { type: sql.Date, value: returnedDate },
    reason: { type: sql.NVarChar(500), value: reason ?? null },
  });
  await request.query(
    `UPDATE dbo.cheques SET cheque_status = 'RETURNED', returned_date = @returnedDate, return_reason = @reason
     WHERE cheque_id = @chequeId`,
  );
}

async function insertAllocation(transaction, allocation) {
  const request = requestWithParams(transaction, {
    receiptId: { type: sql.Int, value: allocation.receipt_id },
    dispositionType: { type: sql.VarChar(20), value: allocation.disposition_type },
    targetVendorId: { type: sql.Int, value: allocation.target_vendor_id ?? null },
    targetBaId: { type: sql.Int, value: allocation.target_ba_id ?? null },
    bankId: { type: sql.Int, value: allocation.bank_id ?? null },
    expenseId: { type: sql.Int, value: allocation.expense_id ?? null },
    amount: { type: sql.Decimal(14, 2), value: allocation.amount },
    allocationDate: { type: sql.Date, value: allocation.allocation_date },
    remarks: { type: sql.NVarChar(500), value: allocation.remarks ?? null },
    createdBy: { type: sql.Int, value: allocation.created_by ?? null },
  });
  const result = await request.query(`
    INSERT INTO dbo.cheque_allocations (
      receipt_id, disposition_type, target_vendor_id, target_ba_id, bank_id, expense_id, amount,
      allocation_date, remarks, status, created_by
    )
    OUTPUT inserted.allocation_id
    VALUES (
      @receiptId, @dispositionType, @targetVendorId, @targetBaId, @bankId, @expenseId, @amount,
      @allocationDate, @remarks, 'ACTIVE', @createdBy
    )
  `);
  return result.recordset[0].allocation_id;
}

// Lets expenses.service.js#post() detect "did THIS expense already create an allocation?" before
// retrying — makes posting a CHEQUE_ENDORSED expense safely idempotent across a retry, since
// endorseToExpense() and the expense's own status flip are two separately-committing operations
// (see migration 006's note).
// ACTIVE only. A reversed allocation keeps its row (status 'REVERSED') — reverse-never-erase — so
// an unfiltered lookup answers "this expense was endorsed once" when the caller is really asking
// "is this expense endorsed RIGHT NOW". expenses.service.js#post uses it to decide whether to
// endorse, so without the filter, re-posting an expense whose endorsement had been reversed would
// find the dead row, skip endorseToExpense(), and mark the expense CONFIRMED having moved no money
// and left the cheque still free. Unreachable until unpost gained the ability to reverse its own
// allocation (2026-08-31); that is what made this filter necessary.
async function findAllocationByExpenseId(expenseId) {
  const result = await query(
    "SELECT * FROM dbo.cheque_allocations WHERE expense_id = @expenseId AND status = 'ACTIVE'",
    { expenseId: { type: sql.Int, value: expenseId } },
  );
  return result.recordset[0] || null;
}

// Detaches a REVERSED allocation from the expense that made it, so that expense can be moved out
// of dbo.expenses (unconfirm sends it to dbo.draft_expenses, which is a DELETE here, and
// FK_cheque_allocations_expense blocks that while the pointer stands).
//
// Nothing of the audit trail is lost: the allocation keeps its receipt, target, amount, date,
// remarks and REVERSED status, plus both sets of ledger entries. Only the back-pointer goes, and
// it was about to dangle anyway — the document is re-created in draft_expenses under a NEW id, so
// the old expense_id stops identifying anything the moment the row moves.
// Any allocation for this expense regardless of status — the retry-safe counterpart to
// findAllocationByExpenseId(). See reverseEndorsementFor() for why both exist.
async function findAnyAllocationByExpenseId(expenseId) {
  const result = await query(
    'SELECT * FROM dbo.cheque_allocations WHERE expense_id = @expenseId',
    { expenseId: { type: sql.Int, value: expenseId } },
  );
  return result.recordset[0] || null;
}

async function detachAllocationFromExpense(transaction, allocationId) {
  const request = requestWithParams(transaction, { allocationId: { type: sql.Int, value: allocationId } });
  await request.query('UPDATE dbo.cheque_allocations SET expense_id = NULL WHERE allocation_id = @allocationId');
}

async function listAllocations(receiptId) {
  const result = await query(
    `SELECT ca.*, v.name AS vendor_name, ba.name AS target_name, bank.name AS bank_name
     FROM dbo.cheque_allocations ca
     LEFT JOIN dbo.vendors v ON v.vendor_id = ca.target_vendor_id
     LEFT JOIN dbo.business_accounts ba ON ba.ba_id = ca.target_ba_id
     LEFT JOIN dbo.bank_accounts bank ON bank.bank_id = ca.bank_id
     WHERE ca.receipt_id = @receiptId
     ORDER BY ca.allocation_id`,
    { receiptId: { type: sql.Int, value: receiptId } },
  );
  return result.recordset;
}

async function findAllocationById(allocationId) {
  const result = await query(
    `SELECT ca.*, v.name AS vendor_name, ba.name AS target_name, ch.cheque_id, ch.cheque_status,
            ch.cheque_no, ch.cheque_date
     FROM dbo.cheque_allocations ca
     LEFT JOIN dbo.vendors v ON v.vendor_id = ca.target_vendor_id
     LEFT JOIN dbo.business_accounts ba ON ba.ba_id = ca.target_ba_id
     JOIN dbo.cheques ch ON ch.receipt_id = ca.receipt_id
     WHERE ca.allocation_id = @allocationId`,
    { allocationId: { type: sql.Int, value: allocationId } },
  );
  return result.recordset[0] || null;
}

// "Endorsed cheques" list for the Cheque Return page — ACTIVE VENDOR_PAYMENT/EXPENSE_PAYMENT
// allocations only (DEPOSIT is excluded on purpose; returning a deposit is "move it to a different
// bank," a different action, not this one).
async function listEndorsedAllocations(filters = {}) {
  // ca.status is the ENDORSEMENT's lifecycle (ACTIVE/REVERSED); ch.cheque_status is the CHEQUE's
  // (PENDING/ENDORSED/CLEARED/BOUNCED/RETURNED…) — two independent things. Filtering on ca.status
  // alone let a CLEARED endorsed cheque keep showing in Cheque > Returns: markCleared() is a pure
  // status flip that never reverses the allocation, so it stays ACTIVE (reported 2026-09-26, 10
  // such rows in production). The cheque_status guard mirrors cheques.service.js#reverseAllocation's
  // own TERMINAL_STATUSES ['BOUNCED','RETURNED','CLEARED'] check exactly — that action already
  // rejected these, so this only stops the list offering a row the action would refuse, leaving the
  // genuinely returnable ENDORSED/PARTIALLY_ENDORSED states.
  const conditions = [
    "ca.status = 'ACTIVE'",
    "ca.disposition_type IN ('VENDOR_PAYMENT','EXPENSE_PAYMENT')",
    "ch.cheque_status NOT IN ('CLEARED','RETURNED')",
  ];
  const params = {};

  if (filters.date_from) {
    conditions.push('ca.allocation_date >= @dateFrom');
    params.dateFrom = { type: sql.Date, value: filters.date_from };
  }
  if (filters.date_to) {
    conditions.push('ca.allocation_date <= @dateTo');
    params.dateTo = { type: sql.Date, value: filters.date_to };
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const result = await query(
    `SELECT ca.*, v.name AS vendor_name, ba.name AS target_name, ch.cheque_id, ch.cheque_no,
            -- cheque_date is the DUE date (see IX_cheques_due / §12 alerts) and cheque_received_date
            -- when it came in; both are shown on the Cheque Returns table's standard columns.
            ch.cheque_date, ch.cheque_received_date, ch.cheque_status
     FROM dbo.cheque_allocations ca
     LEFT JOIN dbo.vendors v ON v.vendor_id = ca.target_vendor_id
     LEFT JOIN dbo.business_accounts ba ON ba.ba_id = ca.target_ba_id
     JOIN dbo.cheques ch ON ch.receipt_id = ca.receipt_id
     ${where}
     ORDER BY ca.allocation_date DESC, ca.allocation_id DESC`,
    params,
  );
  return result.recordset;
}

// Reverses ONE allocation (not every active allocation on the receipt, unlike reverseAllocations()
// used by bounce/return) — the cheque itself is fine, only this specific endorsement is being
// undone (e.g. a vendor hands the cheque back). Returns the row so the service can write the
// matching reversing ledger entry.
async function reverseOneAllocation(transaction, allocationId) {
  const selectRequest = requestWithParams(transaction, { allocationId: { type: sql.Int, value: allocationId } });
  const result = await selectRequest.query(
    `SELECT * FROM dbo.cheque_allocations WHERE allocation_id = @allocationId`,
  );
  const allocation = result.recordset[0];
  if (!allocation) return null;

  // Only an ACTIVE row flips, and the row count is the guard: the service checks "is it ACTIVE" on a
  // pool read BEFORE this transaction, so two simultaneous reversals both pass that check. The
  // second one's UPDATE matches nothing, we return null, and the caller rolls back before it can
  // post a second reversal pair.
  const updateRequest = requestWithParams(transaction, { allocationId: { type: sql.Int, value: allocationId } });
  const updated = await updateRequest.query(
    `UPDATE dbo.cheque_allocations SET status = 'REVERSED' WHERE allocation_id = @allocationId AND status = 'ACTIVE'`,
  );
  if (!updated.rowsAffected[0]) return null;
  return allocation;
}

// Remaining balance still sitting in CHEQUES IN HAND for this cheque — receipt.amount minus every
// ACTIVE allocation against it (REVERSED allocations don't count, same as the design doc's
// derived-balance formula).
async function sumActiveAllocations(receiptId) {
  const result = await query(
    `SELECT ISNULL(SUM(amount), 0) AS total FROM dbo.cheque_allocations
     WHERE receipt_id = @receiptId AND status = 'ACTIVE'`,
    { receiptId: { type: sql.Int, value: receiptId } },
  );
  return result.recordset[0].total;
}

// Transaction-aware variant — the plain query() above runs on a different pooled connection, so it
// cannot see a same-transaction allocation insert that hasn't committed yet. Used by
// cheques.service.js#recomputeStatus(), which always runs right after inserting a new allocation
// in the same transaction and needs to see it.
async function sumActiveAllocationsInTransaction(transaction, receiptId) {
  const request = requestWithParams(transaction, { receiptId: { type: sql.Int, value: receiptId } });
  const result = await request.query(
    `SELECT ISNULL(SUM(amount), 0) AS total FROM dbo.cheque_allocations
     WHERE receipt_id = @receiptId AND status = 'ACTIVE'`,
  );
  return result.recordset[0].total;
}

// Bounce/return reversal step 1: flip every ACTIVE allocation for this receipt to REVERSED,
// returning the rows so the service can write one reversing ledger entry per allocation (§6.1: a
// bounce reverses, never erases — allocations stay in the table, they just stop counting).
async function reverseAllocations(transaction, receiptId) {
  const selectRequest = requestWithParams(transaction, { receiptId: { type: sql.Int, value: receiptId } });
  const active = await selectRequest.query(
    `SELECT * FROM dbo.cheque_allocations WHERE receipt_id = @receiptId AND status = 'ACTIVE'`,
  );

  for (const row of active.recordset) {
    const request = requestWithParams(transaction, { allocationId: { type: sql.Int, value: row.allocation_id } });
    const updated = await request.query(
      `UPDATE dbo.cheque_allocations SET status = 'REVERSED' WHERE allocation_id = @allocationId AND status = 'ACTIVE'`,
    );
    // The caller holds lockCheque(), so nothing else can have flipped it — but if it ever has, a
    // second reversal pair must not be posted for it, so fail the whole transaction loudly.
    if (!updated.rowsAffected[0]) throw new Error(`Allocation ${row.allocation_id} was reversed concurrently`);
  }
  return active.recordset;
}

// Used for both a normal endorsement (Dr target / Cr CHEQUES IN HAND) and a bounce/return reversal
// (the opposite pair) — same generic shape as every other module's insertLedgerEntries.
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
      // Migration 045 — set only by recreditIfBounced(); see the column's own migration for why.
      isInternal: { type: sql.Bit, value: row.is_internal ? 1 : 0 },
    });
    await request.query(`
      INSERT INTO dbo.ledger_entries (entry_date, ac_id, ba_id, debit, credit, source_type, source_id, narration, is_internal)
      VALUES (@entryDate, @acId, @baId, @debit, @credit, @sourceType, @sourceId, @narration, @isInternal)
    `);
  }
}

module.exports = {
  insert, updateDetails, deleteCheque, findById, findByReceiptId, list, setBank, setStatus,
  lockCheque, hasActiveAllocationForExpenseInTransaction, markBounced, claimBouncedForReuse, lockIfStatusIn, setBouncedDate, findLatestActiveAllocation, markReturned, insertAllocation, findAllocationByExpenseId, listAllocations,
  detachAllocationFromExpense, findAnyAllocationByExpenseId,
  findAllocationById, listEndorsedAllocations, sumActiveAllocations,
  sumActiveAllocationsInTransaction, reverseAllocations, reverseOneAllocation, insertLedgerEntries,
};
