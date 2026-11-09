// A salary run posts on the first of the month it is for (client 2026-11-09), whatever day it was
// created or posted, and its ledger rows carry that same date.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { query, closePool } = require('../src/db/pool');
const salaryRunsService = require('../src/services/salaryRuns.service');
const employeesService = require('../src/services/employees.service');
const { uniqueName } = require('../testlib/fixtures');

const iso = (d) => d.toISOString().slice(0, 10);

test('Salary run: dated the 1st of its month on create, edit and in the ledger', async (t) => {
  const created = {};
  t.after(async () => {
    if (created.runId) {
      await query("DELETE FROM dbo.ledger_entries WHERE source_type = 'SALARY_RUN' AND source_id = @id", { id: created.runId });
      await query('DELETE FROM dbo.salary_run_items WHERE salary_run_id = @id', { id: created.runId });
      await query('DELETE FROM dbo.salary_runs WHERE salary_run_id = @id', { id: created.runId });
    }
    if (created.employee) {
      await query('DELETE FROM dbo.employees WHERE employee_id = @id', { id: created.employee.employee_id });
      await query('DELETE FROM dbo.business_accounts WHERE ba_id = @id', { id: created.employee.ba_id });
    }
  });

  created.employee = await employeesService.create({ name: uniqueName('SALARIED'), employee_type: 'SALARIED', monthly_salary: 30000 });

  // Any day of the month picks that month; a far-off month no real run can already be posted for.
  const run = await salaryRunsService.create({ period_month: '2031-03-17' }, null);
  created.runId = run.salary_run_id;
  assert.equal(iso(run.period_month), '2031-03-01');
  assert.equal(iso(run.run_date), '2031-03-01');

  const edited = await salaryRunsService.update(run.salary_run_id, { period_month: '2031-03-28' }, null);
  assert.equal(iso(edited.run_date), '2031-03-01');

  await salaryRunsService.post(run.salary_run_id, null);
  const dates = (await query(
    "SELECT DISTINCT entry_date FROM dbo.ledger_entries WHERE source_type = 'SALARY_RUN' AND source_id = @id",
    { id: run.salary_run_id },
  )).recordset.map((r) => iso(r.entry_date));
  assert.deepEqual(dates, ['2031-03-01']);
});

test.after(() => closePool());
