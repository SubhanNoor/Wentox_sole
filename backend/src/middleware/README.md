# middleware/ — Shared Helpers

There's no Express middleware chain in this app (no HTTP layer at all) — this folder just holds
small helpers shared across ipc handlers/services.

| File | Purpose |
| --- | --- |
| `validate.js` | `validate(payload, checkFn)` — runs `checkFn(payload)` and returns the cleaned payload, or lets `checkFn` throw `ApiError.badRequest(...)`. For quick shape checks in an ipc handler; full business validation lives in services. |

Session/auth guards (`requireSession`, `requireRole`) live in `../ipc/session.js`, not here — they're
specific to the IPC transport, unlike this folder's generic helpers.
