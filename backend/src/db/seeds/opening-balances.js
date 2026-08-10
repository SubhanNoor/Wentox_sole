// Re-derives every account's OPENING ledger pair from its stored opening_balance/opening_date.
//
// Two jobs in one, both idempotent:
//   1. BACKFILL — an opening balance set before this feature existed has no ledger rows at all.
//   2. SELF-HEAL — businessAccounts.service.js#syncOpeningEntries() runs in its own transaction,
//      separate from the party-creation transaction that owns the account row. If one ever failed
//      halfway, the stored input would sit there without its rows and the account's balance would
//      read low. Running this on every startup closes that window without anyone noticing it.
//
// Rewriting rows that are already correct is harmless: replaceOpeningEntries() deletes and reinserts
// the same pair, and OPENING rows are keyed on source_id = ba_id so nothing else is touched.
const businessAccountsService = require('../../services/businessAccounts.service');
const repository = require('../../repositories/businessAccounts.repository');

async function seedOpeningBalanceEntries() {
  const accounts = await repository.allWithOpening();
  for (const account of accounts) {
    await businessAccountsService.syncOpeningEntries(account.ba_id);
  }
  if (accounts.length) {
    console.log(`synced opening-balance ledger entries for ${accounts.length} account(s)`);
  }
}

module.exports = { seedOpeningBalanceEntries };
