# errors/ — Error Types

| File | Purpose |
| --- | --- |
| `ApiError.js` | Error class carrying an HTTP `status` and machine-readable `code`. Services throw these; `middleware/errorHandler.js` formats them. Helpers: `ApiError.badRequest(msg)` (400), `ApiError.unauthorized()` (401), `ApiError.notFound()` (404), `ApiError.conflict(msg)` (409). |

Usage in a service:

```js
if (!row) throw ApiError.notFound('Sale bill not found');
if (bill.status === 'POSTED') throw ApiError.conflict('Unpost the bill before editing', 'POSTED_LOCK');
```
