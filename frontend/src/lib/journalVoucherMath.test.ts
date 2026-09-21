import { describe, expect, it } from 'vitest';
import { amountToDebitCredit, debitCreditToAmount } from './journalVoucherMath';

// Regression test for the 2026-09-15 (ACC-01) bug: JournalVoucherPage.tsx's entry strip sent a
// positive typed amount to CREDIT and negative to DEBIT — the exact inverse of the client's
// authoritative sign rule. It shipped and posted silently wrong-side for weeks with no error, no
// crash, nothing visibly off — only caught by a client-mandated full verification audit. These
// cases pin the rule down exactly so it can never quietly flip back.
describe('amountToDebitCredit (ACC-01: +ve -> DEBIT, -ve -> CREDIT)', () => {
  it('maps a positive amount to a debit', () => {
    expect(amountToDebitCredit(500)).toEqual({ debit: 500, credit: 0 });
  });

  it('maps a negative amount to a credit, magnitude only (never a negative credit)', () => {
    expect(amountToDebitCredit(-500)).toEqual({ debit: 0, credit: 500 });
  });

  it('maps zero to neither side', () => {
    expect(amountToDebitCredit(0)).toEqual({ debit: 0, credit: 0 });
  });

  it('never produces both a debit and a credit for the same amount', () => {
    for (const amount of [1, -1, 999.99, -999.99]) {
      const { debit, credit } = amountToDebitCredit(amount);
      expect(debit === 0 || credit === 0).toBe(true);
    }
  });
});

describe('debitCreditToAmount (inverse, used when reloading a committed line)', () => {
  it('reconstructs a positive amount from a debit-only row', () => {
    expect(debitCreditToAmount(500, 0)).toBe(500);
  });

  it('reconstructs a negative amount from a credit-only row', () => {
    expect(debitCreditToAmount(0, 500)).toBe(-500);
  });

  it('round-trips through amountToDebitCredit for representative amounts', () => {
    for (const amount of [1, -1, 100, -100, 54321.5, -54321.5]) {
      const { debit, credit } = amountToDebitCredit(amount);
      expect(debitCreditToAmount(debit, credit)).toBe(amount);
    }
  });
});
