# routes/ — URL Layer

Maps URLs + HTTP verbs to controller functions. **No logic here** — just `router.get/post/put/delete`.

| File | Mounted at | Feature |
| --- | --- | --- |
| `index.js` | `/api` | Central router: mounts `/auth` publicly, applies JWT `auth` middleware, then mounts everything below |
| `auth.routes.js` | `/api/auth` | Login (public) + update credentials (UC-19/20) |
| `cities.routes.js` | `/api/cities` | City setup CRUD (UC-14) |
| `stores.routes.js` | `/api/stores` | Store setup CRUD |
| `addas.routes.js` | `/api/addas` | Transport adda setup CRUD |
| `vendors.routes.js` | `/api/vendors` | Vendor setup CRUD |
| `categories.routes.js` | `/api/categories` | Product category CRUD (UC-12) |
| `products.routes.js` | `/api/products` | Product CRUD incl. cost breakdown (UC-11) |
| `customers.routes.js` | `/api/customers` | Customer CRUD |
| `subCustomers.routes.js` | `/api/sub-customers` | Sub-customer / delivery agent CRUD (UC-13) |
| `groupAccounts.routes.js` | `/api/accounts/groups` | Group accounts (UC-15) |
| `controlAccounts.routes.js` | `/api/accounts/controls` | Control accounts (UC-16) |
| `chartAccounts.routes.js` | `/api/accounts/chart` | Chart of accounts (UC-17) |
| `businessAccounts.routes.js` | `/api/accounts/business` | Business accounts (UC-18) |
| `saleBills.routes.js` | `/api/sale-bills` | Sale bills + post/unpost + bilty search/update (UC-01/02/07) |
| `saleReturns.routes.js` | `/api/sale-returns` | Sale returns (UC-03/04) |
| `receipts.routes.js` | `/api/receipts` | Receipts / Jamma (UC-05) |
| `expenses.routes.js` | `/api/expenses` | Expenses / Kharch (UC-06) |
| `stock.routes.js` | `/api/stock` | Opening/adjustment movements + movement history |
| `reports.routes.js` | `/api/reports` | Stock, Khaata, Cash Book reports (UC-08/09/10) |

Adding a feature: create the 4 layer files, then add one `router.use(...)` line in `index.js`.
