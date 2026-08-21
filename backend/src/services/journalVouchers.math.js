// Shared line/total math and validation for the multi-line Journal Voucher — mirrors
// purchaseMath.js's shape. Every line is single-sided (debit XOR credit), and the whole
// voucher must net to zero before it can be saved (real double-entry, no fixed counter-account).
const ApiError = require('../errors/ApiError');

function round2(n) {
  return Math.round(n * 100) / 100;
}

// CK_jvl_one_side/CK_jvl_nonzero require exactly one of debit/credit > 0 per line.
function validateLines(rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length < 2) {
    throw ApiError.badRequest('A Journal Voucher needs at least 2 lines');
  }
  for (const line of rawLines) {
    if (!line.ba_id) throw ApiError.badRequest('Each line must have an account');
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    if (debit < 0 || credit < 0) throw ApiError.badRequest('Debit/credit cannot be negative');
    if (debit > 0 && credit > 0) throw ApiError.badRequest('Each line must be either a debit or a credit, not both');
    if (debit === 0 && credit === 0) throw ApiError.badRequest('Each line must have a debit or credit amount > 0');
  }
}

function buildLines(rawLines) {
  validateLines(rawLines);
  return rawLines.map((line) => ({
    ba_id: line.ba_id,
    debit: round2(Number(line.debit) || 0),
    credit: round2(Number(line.credit) || 0),
    narration: line.narration ? line.narration.trim() : null,
  }));
}

function buildTotals(lines) {
  const totalDebit = round2(lines.reduce((sum, l) => sum + l.debit, 0));
  const totalCredit = round2(lines.reduce((sum, l) => sum + l.credit, 0));
  return { totalDebit, totalCredit };
}

// Compared in paisa (integer cents) to avoid float drift on the sum.
function validateBalance(lines) {
  const { totalDebit, totalCredit } = buildTotals(lines);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
    throw ApiError.badRequest(
      `Total debit (${totalDebit}) must equal total credit (${totalCredit})`,
    );
  }
  return { totalDebit, totalCredit };
}

module.exports = { round2, buildLines, buildTotals, validateBalance };
