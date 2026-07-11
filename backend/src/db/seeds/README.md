# seeds/ — Seed Data

Scripts that insert the minimum data a fresh database needs (run with `npm run seed`).

Planned (Milestone 1, Module 1.2):

| File | Purpose |
| --- | --- |
| `run.js` | Entry point — runs all seeds idempotently (safe to re-run) |
| Seeds to include | Admin user (bcrypt-hashed password), CASH and SALES chart accounts (required by the posting engine), default store |
