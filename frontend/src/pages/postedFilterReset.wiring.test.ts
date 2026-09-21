import { describe, expect, it } from 'vitest';
import saleBillSource from './SaleBillPage.tsx?raw';
import saleReturnSource from './SaleReturnPage.tsx?raw';
import purchaseSource from './PurchasePage.tsx?raw';
import purchaseReturnSource from './PurchaseReturnPage.tsx?raw';
import journalVoucherSource from './JournalVoucherPage.tsx?raw';
import stockVoucherSource from './StockVoucherPage.tsx?raw';

// Regression test for G-06 (changes-14-09-26.md, 2026-09-15), described in PROGRESS.md as a
// "severe bug": opening a new window could show a POSTED document's data while the Posted/
// Unposted filter still defaulted to "Unposted" — a reset-on-reopen check keyed on
// `mode === 'view'` missed the `mode === 'edit'` case (reachable via an edit-on-a-posted-record
// flow, e.g. SaleBillPage's own bilty/adda-on-a-posted-bill edit). Fixed across all 6 document
// pages with a Records/Weekly/Monthly/Overall tab by gating on the persisted "is this a real
// posted record" flag instead of `mode`, since only handleNew() ever clears it.
//
// This was one bug copy-pasted 6 times, not 6 independent ones — each page has its own copy of
// the fix with its own locally-named flag (currentBillIsPosted, currentIsPosted, isPosted, etc.),
// so a regression in any single page's copy would not be caught by testing another page. Static
// source check, not a rendered-component test, for the same reasons as ReceiptsPage.wiring.test.ts
// (these pages are large, heavily integrated, and some were mid-refactor when this was written).
//
// Each case pins the ACTUAL current flag name for that page (not a guessed generic one) and
// asserts three things: the reset effect calls the list refresh, the callback is gated on
// "list is empty AND the posted flag" (not `mode === 'view'` alone, the original bug), and it
// actually calls handleNew() when both hold.
function assertGuardedReset(source: string, isPostedFlag: string, refreshCall: string) {
  const guardPattern = new RegExp(
    `${refreshCall}\\([^)]*\\)\\.then\\(data => \\{\\s*if \\(data && data\\.length === 0 && ${isPostedFlag}\\) handleNew\\(\\);`,
  );
  expect(source).toMatch(guardPattern);
}

describe('G-06: Posted/Unposted reset-on-reopen is gated on the persisted posted flag, not mode', () => {
  it('SaleBillPage uses currentBillIsPosted, not mode === \'view\' alone', () => {
    assertGuardedReset(saleBillSource, 'currentBillIsPosted', 'refreshUnposted');
  });

  it('SaleReturnPage uses currentReturnIsPosted, not mode === \'view\' alone', () => {
    assertGuardedReset(saleReturnSource, 'currentReturnIsPosted', 'refreshDrafts');
  });

  it('PurchasePage uses currentIsPosted, not mode === \'view\' alone', () => {
    assertGuardedReset(purchaseSource, 'currentIsPosted', 'refreshUnposted');
  });

  it('PurchaseReturnPage uses currentIsPosted, not mode === \'view\' alone', () => {
    assertGuardedReset(purchaseReturnSource, 'currentIsPosted', 'refreshUnposted');
  });

  it('JournalVoucherPage uses isPosted, not mode === \'view\' alone', () => {
    assertGuardedReset(journalVoucherSource, 'isPosted', 'refreshUnposted');
  });

  it('StockVoucherPage uses isPosted, not mode === \'view\' alone', () => {
    assertGuardedReset(stockVoucherSource, 'isPosted', 'refreshUnposted');
  });
});
