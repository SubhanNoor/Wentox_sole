# controllers/ — HTTP Layer

One controller per feature (`<feature>.controller.js`). A controller:

- reads `req.params` / `req.query` / `req.body`
- calls the matching **service** function
- sends the JSON response (`res.json`, correct status code)
- forwards errors with `next(err)` (never formats errors itself)

**Never** put business logic, validation rules, or SQL here.

Files map 1:1 to the features listed in `../routes/README.md`:
`auth`, `cities`, `stores`, `addas`, `vendors`, `categories`, `products`, `customers`,
`subCustomers`, `groupAccounts`, `controlAccounts`, `chartAccounts`, `businessAccounts`,
`saleBills`, `saleReturns`, `receipts`, `expenses`, `stock`, `reports`.

Handler shape:

```js
exports.list = async (req, res, next) => {
  try {
    res.json(await service.list(req.query));
  } catch (err) {
    next(err);
  }
};
```
