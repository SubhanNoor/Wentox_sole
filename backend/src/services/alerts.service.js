// Service layer: business logic, validation, transactions.
// Throw ApiError for expected failures; use withTransaction for multi-write ops.
const repository = require('../repositories/alerts.repository');
const ApiError = require('../errors/ApiError');
const { toISODate, todayISO, daysFromNowISO } = require('../utils/dates');

// UC-05/cash_and_bank.md §12: 7 days out turns amber ("due-soon"), the date itself passing turns
// red ("overdue"). Both cheque-due and sale-bill-due-date alerts use the same window.
const DAYS_AHEAD = 7;

// Local dates, not UTC — see utils/dates.js. This job decides whether a cheque is "due" and how far
// ahead to look, so a UTC "today" shifted WHEN an alert fires by up to a day, not merely which rows
// a list showed.
const cutoffISO = () => daysFromNowISO(DAYS_AHEAD);

// Every cheque generates one of these unconditionally (UC-05: "these are unconditional — every
// cheque generates them") — no balance check, just cheque_date vs today.
function chequeDueAlert(r) {
  return {
    key: `CHEQUE_DUE:${r.cheque_id}`,
    kind: 'CHEQUE_DUE',
    title: `Cheque ${r.cheque_no} due`,
    detail: `${r.account_name} — cheque #${r.cheque_no}`,
    date: toISODate(r.cheque_date),
    amount: Number(r.amount),
    target_page: 'receipts-jamma',
    target_tab: 'cheques',
  };
}

// Fires once due_date is set and within the window, no balance check either — matches what was
// actually asked for (a due-date reminder the user can dismiss), not UC-05's original stale
// "and the balance is still positive" wording, which would need a per-bill payment link this
// schema doesn't have (receipts are customer-level, never tied to one specific bill).
function saleBillDueAlert(r) {
  return {
    key: `PAYMENT_OVERDUE:${r.bill_id}`,
    kind: 'PAYMENT_OVERDUE',
    title: `Sale bill ${r.bill_no} due`,
    detail: `${r.customer_name} — bill #${r.bill_no}`,
    date: toISODate(r.due_date),
    amount: Number(r.net_value),
    target_page: 'find-bill',
  };
}

// THE STARTUP JOB — called once from electron/main.js, right after registerIpcHandlers() and
// before the window opens, never on a repeating timer (explicit instruction: startup only, no
// re-run while the app stays open). Computes the same cheque-due/sale-bill-due rows list() used to
// compute live, and persists them into dbo.generated_alerts instead of returning them — this is
// the one place in the whole alerts feature that writes to that table.
async function refreshAlerts() {
  const cutoff = cutoffISO();
  const [chequeRows, billRows] = await Promise.all([
    repository.chequeDueRows(cutoff),
    repository.saleBillDueRows(cutoff),
  ]);

  const alerts = [
    ...chequeRows.map(chequeDueAlert),
    ...billRows.map(saleBillDueAlert),
  ];

  // Parallel, not sequential — each alert's MERGE is an independent round trip, and awaiting them
  // one at a time was the real cause of a slow manual refresh once more than a couple of alerts
  // were due at once.
  await Promise.all(alerts.map((alert) => repository.mergeGeneratedAlert(alert)));
  await repository.deleteGeneratedNotIn(alerts.map((a) => a.key));

  return { count: alerts.length };
}

// UC-01: sorted nearest due date first. Reads whatever refreshAlerts() last stored — this does NOT
// recompute from cheques/sale_bills itself, so it stays cheap regardless of how often the UI polls
// it; severity is the one thing still derived live (against "today"), never stored, so a due-soon
// alert correctly reads as overdue once its date passes even between job runs.
async function list() {
  const today = todayISO();
  const rows = await repository.listGenerated();
  return rows.map((r) => {
    const date = toISODate(r.alert_date);
    return {
      key: r.alert_key,
      kind: r.kind,
      severity: date < today ? 'overdue' : 'due-soon',
      title: r.title,
      detail: r.detail,
      date,
      amount: Number(r.amount),
      target_page: r.target_page,
      target_tab: r.target_tab,
    };
  });
}

// "We can delete the alert also" — permanent dismiss (dismissed_until stays NULL, per
// alert_dismissals' own schema comment: no snooze in this build, just a dismiss). Idempotent —
// dismissing an already-dismissed key is a no-op, not a duplicate row or an error.
async function dismiss(alertKey, userId) {
  if (!alertKey) throw ApiError.badRequest('alertKey is required');
  const existing = await repository.findDismissal(alertKey);
  if (!existing) await repository.insertDismissal(alertKey, userId);
  return { ok: true };
}

module.exports = { refreshAlerts, list, dismiss };
