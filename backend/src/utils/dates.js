// Local-date helpers, shared so there is exactly one definition of "today" in the backend.
//
// WHY THIS EXISTS: every date in WentoX is a LOCAL business date. The date pickers emit local
// dates, a business day is a local day, and every DATE column is compared date-only. But
// `new Date().toISOString()` converts to UTC first — so in PKT (UTC+5) the "ISO date" is still
// YESTERDAY between 19:00 and midnight local.
//
// That was not theoretical: a document dated today moved no balance at all for those five hours,
// because reports.service.js#accountBalance()'s `up_to_date` cutoff excluded it, and the Cash Book
// opened on the previous day. The same three-line `toISOString().slice(0, 10)` helper had been
// copy-pasted into eight files, so fixing one still left seven wrong. Hence one module.
//
// NOT for dbo.salary_runs.period_month, which normalises months in UTC deliberately and is
// self-consistent (Date.UTC in, getUTC* out) — see salaryRuns.service.js.

// Local calendar date of a Date, formatted YYYY-MM-DD. Built from the local getFullYear/getMonth/
// getDate parts rather than toISOString(), so no timezone conversion happens at all.
function toISODate(value) {
  if (value == null) return null;
  // Already a plain date string (or a datetime string) — take the date part as-is; it came from a
  // date input or the driver, and re-parsing it would reintroduce the timezone shift.
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayISO() {
  return toISODate(new Date());
}

// Local date `days` from now — used by the alerts job's look-ahead window.
function daysFromNowISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

module.exports = { toISODate, todayISO, daysFromNowISO };
