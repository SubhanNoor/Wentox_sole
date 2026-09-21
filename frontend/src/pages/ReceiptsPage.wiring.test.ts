import { describe, expect, it } from 'vitest';
import source from './ReceiptsPage.tsx?raw';

// Regression test for the 2026-08-09 bug: receipts:post and receipts:unpost existed on the
// backend and in lib/api.ts, but nothing in ReceiptsPage.tsx ever called them — every receipt
// entered through the UI silently stayed a DRAFT forever, invisible to any balance or report.
// Found only via a user reporting a payment that never updated a balance.
//
// A backend-only test suite can never catch this class of bug — the backend worked correctly the
// whole time; the gap was purely in the frontend never calling it. This is a static source check,
// not a rendered-component test: ReceiptsPage.tsx is large and heavily integrated (AppContext,
// several hooks, the DocumentToolbar/RowActions components), and was mid-refactor when this test
// was written, so a full render+click test would be both expensive to build and fragile against
// that ongoing work. This check can't prove the button is actually clickable end-to-end, only that
// the handler exists, calls the right API function, and is genuinely referenced as an onClick
// somewhere in the JSX (not defined-and-orphaned, which is exactly what happened in 2026-08-09).
// Imported via Vite's `?raw` suffix (not Node's fs) so this test needs no Node type declarations
// and stays inside the same browser-context tsconfig as the rest of src/.

describe('ReceiptsPage: Post/Unpost are actually wired to the backend, not just defined', () => {
  it('defines a handlePost that calls the backend post endpoint (receipts or settlements)', () => {
    expect(source).toMatch(/const handlePost = async \(\) => \{/);
    expect(source).toMatch(/api\.receipts\.post\(/);
    expect(source).toMatch(/api\.settlements\.post\(/);
  });

  it('defines a handleUnpost that calls the backend unpost/unconfirm endpoint', () => {
    expect(source).toMatch(/const handleUnpost = async \(\) => \{/);
    // A regular receipt unposts via unconfirm() (moves it back to a draft), not a plain unpost() —
    // pin the ACTUAL call, not a guessed generic name, so this doesn't drift from reality.
    expect(source).toMatch(/api\.receipts\.unconfirm\(/);
    expect(source).toMatch(/api\.settlements\.unpost\(/);
  });

  it('wires handlePost to an actual button — not defined-and-never-called, the 2026-08-09 bug', () => {
    expect(source).toMatch(/onClick=\{handlePost\}/);
  });

  it('wires handleUnpost to an actual button — not defined-and-never-called', () => {
    expect(source).toMatch(/onClick=\{handleUnpost\}/);
  });
});
