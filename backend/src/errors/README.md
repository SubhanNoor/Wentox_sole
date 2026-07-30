# errors/ — Error Types

| File | Purpose |
| --- | --- |
| `ApiError.js` | Error class carrying a classification `status` (kept as a familiar HTTP-style code for the renderer's own use, e.g. deciding whether to show a "not found" vs. a generic error toast — nothing here actually sends an HTTP response) and a machine-readable `code`. Services throw these; `../ipc/wrap.js` catches them and re-throws a plain `{ message, code }` so the renderer's `await window.api.x.y()` rejects predictably. Helpers: `ApiError.badRequest(msg)`, `ApiError.unauthorized()`, `ApiError.notFound()`, `ApiError.conflict(msg)`. |

Usage in a service:

```js
if (!row) throw ApiError.notFound('Sale bill not found');
if (bill.status === 'POSTED') throw ApiError.conflict('Unpost the bill before editing', 'POSTED_LOCK');
```
