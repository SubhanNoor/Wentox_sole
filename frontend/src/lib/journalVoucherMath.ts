// Pure debit/credit sign mapping for the Journal Voucher entry strip (JournalVoucherPage.tsx).
// Extracted so the ACC-01 rule can be unit-tested in isolation, after it shipped INVERTED for a
// while (2026-08-26 → 2026-09-15): the entry strip sent a positive typed amount to CREDIT and
// negative to DEBIT, the exact opposite of the client's authoritative sign rule — a silent
// wrong-side posting with no error signal, caught only by a client-mandated verification audit,
// not by any test. See System_architecture/testing_priority_plan.md, pattern 5.
//
// ACC-01 (changes-14-09-26.md, confirmed by the client 2026-09-14): "+ve -> DEBIT, -ve -> CREDIT"
// is the one sign rule for every account type, no exceptions.

export interface DebitCredit {
  debit: number;
  credit: number;
}

export function amountToDebitCredit(amount: number): DebitCredit {
  return {
    debit: amount > 0 ? amount : 0,
    credit: amount < 0 ? Math.abs(amount) : 0,
  };
}

// Inverse of amountToDebitCredit, for reloading an already-committed line back into the entry
// strip (loadLineIntoEntry). A row is expected to hold a debit XOR a credit (never both, per
// ledger_entries' own CK_ledger_entries_side/_sign constraints), so whichever side is nonzero wins.
export function debitCreditToAmount(debit: number, credit: number): number {
  return debit > 0 ? debit : -credit;
}
