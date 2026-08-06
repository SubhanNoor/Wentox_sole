// Service layer: business logic, validation, transactions.
const repository = require('../repositories/accountsTree.repository');

// Assembles accountsTree.repository.js's flat rows into Class → Group → Chart → Business
// nesting. is_restricted chart accounts (and every business account under one) are dropped
// entirely for a non-ADMIN session — same TASK-14 hiding chartAccounts/businessAccounts apply at
// their own list()/get() level.
async function tree(session) {
  const isAdmin = session?.role === 'ADMIN';
  const rows = await repository.treeRows();

  const classes = new Map();
  for (const r of rows) {
    if (r.is_restricted && !isAdmin) continue;

    if (!classes.has(r.class_id)) {
      classes.set(r.class_id, { class_id: r.class_id, code: r.class_code, name: r.class_name, groups: new Map() });
    }
    const cls = classes.get(r.class_id);

    if (!cls.groups.has(r.group_id)) {
      cls.groups.set(r.group_id, { group_id: r.group_id, code: r.group_code, name: r.group_name, charts: new Map() });
    }
    const group = cls.groups.get(r.group_id);

    if (r.ac_id && !group.charts.has(r.ac_id)) {
      group.charts.set(r.ac_id, {
        ac_id: r.ac_id, code: r.ac_code, name: r.ac_name, status: r.ac_status, business: [],
      });
    }
    if (r.ac_id && r.ba_id) {
      group.charts.get(r.ac_id).business.push({
        ba_id: r.ba_id, code: r.ba_code, name: r.ba_name, status: r.ba_status,
      });
    }
  }

  return [...classes.values()].map((cls) => ({
    ...cls,
    groups: [...cls.groups.values()].map((group) => ({
      ...group,
      charts: [...group.charts.values()],
    })),
  }));
}

module.exports = { tree };
