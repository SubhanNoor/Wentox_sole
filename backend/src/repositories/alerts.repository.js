// Repository layer: SQL only — parameterized queries via mssql named params
// (request.input('name', sql.Type, value) and @name in the query text), no req/res.
const { sql, query } = require('../db/pool');

// Cheque-due — same filter as IX_cheques_due (PENDING/PARTIALLY_ENDORSED only; a cheque that's
// been deposited/endorsed/cleared/bounced/returned is done, one way or another, and never alerts).
// cutoff = today + N days, so this returns both not-yet-due (amber) and already-overdue (red)
// rows in one pass; the service classifies severity from cheque_date vs today.
async function chequeDueRows(cutoff) {
  const result = await query(
    `SELECT ch.cheque_id, ch.cheque_no, ch.cheque_date, ch.cheque_status,
            r.receipt_id, r.ba_id, r.amount, ba.name AS account_name,
            c.customer_id, c.name AS customer_name
     FROM dbo.cheques ch
     JOIN dbo.receipts r ON r.receipt_id = ch.receipt_id
     JOIN dbo.business_accounts ba ON ba.ba_id = r.ba_id
     LEFT JOIN dbo.customers c ON c.ba_id = r.ba_id
     WHERE ch.cheque_status IN ('PENDING', 'PARTIALLY_ENDORSED') AND ch.cheque_date <= @cutoff
     ORDER BY ch.cheque_date`,
    { cutoff: { type: sql.Date, value: cutoff } },
  );
  return result.recordset;
}

// Sale bill due-date — only POSTED bills (existence of a SALE_BILL ledger row is how "posted" is
// derived everywhere else in this codebase; sale_bills carries no status column of its own). A
// due_date left blank never alerts (no fallback credit period) — enforced simply by the NOT NULL
// filter below, matching UC-05/UC-18's own wording.
async function saleBillDueRows(cutoff) {
  const result = await query(
    `SELECT sb.bill_id, sb.bill_no, sb.due_date, sb.net_value, sb.customer_id, c.name AS customer_name
     FROM dbo.sale_bills sb
     JOIN dbo.customers c ON c.customer_id = sb.customer_id
     WHERE sb.due_date IS NOT NULL AND sb.due_date <= @cutoff
       AND EXISTS (
         SELECT 1 FROM dbo.ledger_entries WHERE source_type = 'SALE_BILL' AND source_id = sb.bill_id
       )
     ORDER BY sb.due_date`,
    { cutoff: { type: sql.Date, value: cutoff } },
  );
  return result.recordset;
}

// "Dismissed until it expires" (UC-05) — a dismissal with dismissed_until IS NULL is permanent (the
// only kind this build ever writes); a non-NULL, still-future dismissed_until would be an unexpired
// snooze, kept ready for later even though nothing currently writes one.
async function activeDismissalKeys() {
  const result = await query(
    `SELECT alert_key FROM dbo.alert_dismissals
     WHERE dismissed_until IS NULL OR dismissed_until > SYSUTCDATETIME()`,
  );
  return new Set(result.recordset.map((r) => r.alert_key));
}

async function findDismissal(alertKey) {
  const result = await query(
    'SELECT TOP 1 dismissal_id FROM dbo.alert_dismissals WHERE alert_key = @alertKey',
    { alertKey: { type: sql.VarChar(100), value: alertKey } },
  );
  return result.recordset[0] || null;
}

async function insertDismissal(alertKey, userId) {
  await query(
    'INSERT INTO dbo.alert_dismissals (alert_key, user_id) VALUES (@alertKey, @userId)',
    { alertKey: { type: sql.VarChar(100), value: alertKey }, userId: { type: sql.Int, value: userId ?? null } },
  );
}

// ── dbo.generated_alerts — written by the startup job (alerts.service.js#refreshAlerts()), read
// by list(). Nothing else touches this table. ──────────────────────────────────────────────────

// Insert-or-refresh by alert_key (UQ_generated_alerts_key) in a single round trip — a cheque/bill
// already tracked from a prior run just gets its display fields brought current (amount could
// change on the rare edit, the date shouldn't but there's no reason to assume it can't); a newly-due
// one gets a fresh row. Previously this was a SELECT-then-INSERT/UPDATE (2 round trips) called
// sequentially per alert from the service — replaced with one MERGE per alert, run in parallel
// across alerts (see refreshAlerts()), since the old sequential 2-round-trips-per-alert pattern was
// the actual cause of a slow manual refresh once there were more than a few due cheques/bills.
async function mergeGeneratedAlert(alert) {
  const params = {
    alertKey: { type: sql.VarChar(100), value: alert.key },
    kind: { type: sql.VarChar(20), value: alert.kind },
    title: { type: sql.NVarChar(200), value: alert.title },
    detail: { type: sql.NVarChar(300), value: alert.detail ?? null },
    alertDate: { type: sql.Date, value: alert.date },
    amount: { type: sql.Decimal(14, 2), value: alert.amount },
    targetPage: { type: sql.VarChar(50), value: alert.target_page },
    targetTab: { type: sql.VarChar(50), value: alert.target_tab ?? null },
  };
  await query(
    `MERGE dbo.generated_alerts AS target
     USING (SELECT @alertKey AS alert_key) AS source
       ON target.alert_key = source.alert_key
     WHEN MATCHED THEN UPDATE SET
       kind = @kind, title = @title, detail = @detail, alert_date = @alertDate, amount = @amount,
       target_page = @targetPage, target_tab = @targetTab, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT
       (alert_key, kind, title, detail, alert_date, amount, target_page, target_tab)
       VALUES (@alertKey, @kind, @title, @detail, @alertDate, @amount, @targetPage, @targetTab);`,
    params,
  );
}

// Removes any stored alert whose key isn't in the freshly computed set — e.g. a cheque got
// deposited/bounced since the last run, or a bill's due date moved outside the 7-day window.
// Without this, generated_alerts would only ever grow, never shrink, on a long-running session
// that's never restarted (the job itself only runs once at startup — see main.js).
async function deleteGeneratedNotIn(currentKeys) {
  if (currentKeys.length === 0) {
    await query('DELETE FROM dbo.generated_alerts');
    return;
  }
  const params = {};
  const placeholders = currentKeys.map((k, i) => {
    const p = `key${i}`;
    params[p] = { type: sql.VarChar(100), value: k };
    return `@${p}`;
  });
  await query(
    `DELETE FROM dbo.generated_alerts WHERE alert_key NOT IN (${placeholders.join(', ')})`,
    params,
  );
}

async function listGenerated() {
  const result = await query(
    `SELECT ga.alert_key, ga.kind, ga.title, ga.detail, ga.alert_date, ga.amount,
            ga.target_page, ga.target_tab
     FROM dbo.generated_alerts ga
     WHERE NOT EXISTS (
       SELECT 1 FROM dbo.alert_dismissals ad
       WHERE ad.alert_key = ga.alert_key AND (ad.dismissed_until IS NULL OR ad.dismissed_until > SYSUTCDATETIME())
     )
     ORDER BY ga.alert_date`,
  );
  return result.recordset;
}

module.exports = {
  chequeDueRows, saleBillDueRows, activeDismissalKeys, findDismissal, insertDismissal,
  mergeGeneratedAlert, deleteGeneratedNotIn, listGenerated,
};
