// The 12 manufacturing stages — single source of truth for dbo.stages' seed data (payroll.md §4).
// Two label sets, one list: form_label is the cost on the product form ("Cutting"), worker_label
// is the man who does it on the wage screen ("Cutter Man"). cost_column is which dbo.articles
// column holds that stage's rate. sort_order is this array's index + 1. Mirrors (does not import
// from, since it's a different runtime) frontend/src/types/index.ts's COST_FIELDS — same 12 keys,
// same order.
module.exports = [
  { stage_key: 'cutting',     form_label: 'Cutting',        worker_label: 'Cutter Man',    cost_column: 'cutting' },
  { stage_key: 'edging',      form_label: 'Edging',         worker_label: 'Edge Painting', cost_column: 'edging' },
  { stage_key: 'upStitch',    form_label: 'Up Stitch',      worker_label: 'Upper Man',     cost_column: 'up_stitch' },
  { stage_key: 'bending',     form_label: 'Bending',        worker_label: 'Bending',       cost_column: 'bending' },
  { stage_key: 'stubbleDori', form_label: 'Stubble / Dori', worker_label: 'Stubble Man',   cost_column: 'stubble_dori' },
  { stage_key: 'shapeForm',   form_label: 'Shape Form',     worker_label: 'Shape Form',    cost_column: 'shape_form' },
  { stage_key: 'chipkai',     form_label: 'Chipkai',        worker_label: 'Chipkai Man',   cost_column: 'chipkai' },
  { stage_key: 'bottom',      form_label: 'Bottom',         worker_label: 'Bottom Man',    cost_column: 'bottom' },
  { stage_key: 'machine',     form_label: 'Machine',        worker_label: 'Machine Man',   cost_column: 'machine' },
  { stage_key: 'trimming',    form_label: 'Trimming',       worker_label: 'Trimming',      cost_column: 'trimming' },
  { stage_key: 'sockStitch',  form_label: 'Sock Stitch',    worker_label: 'Socks Stitch',  cost_column: 'sock_stitch' },
  { stage_key: 'finish',      form_label: 'Finish',         worker_label: 'Finish',        cost_column: 'finish' },
];
