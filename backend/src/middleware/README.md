# middleware/ — Cross-cutting Express Middleware

| File | Purpose |
| --- | --- |
| `auth.js` | JWT guard. Reads `Authorization: Bearer <token>`, verifies with `JWT_SECRET`, puts the payload on `req.user`, 401s otherwise. Mounted in `routes/index.js` after the public `/auth` routes so everything else requires login. |
| `errorHandler.js` | Central error formatter, attached **last** in `app.js`. Turns thrown errors (ideally `ApiError`) into `{ error: { message, code } }` with the right status; logs 500s. Controllers just `next(err)`. |
| `validate.js` | Small helper: `validate(checkFn)` returns middleware that runs `checkFn(req.body)` and 400s if it throws. For quick shape checks on a route; full business validation lives in services. |
