# Wento ERP — Database Schema (3NF)

---

## Setup / Lookup Tables

### cities
| Column | Type |
|---|---|
| city_id | INT PK AUTO |
| name | VARCHAR |

---

### stores
| Column | Type |
|---|---|
| store_id | INT PK AUTO |
| name | VARCHAR |

---

### addas
| Column | Type |
|---|---|
| adda_id | INT PK AUTO |
| name | VARCHAR |

---

### vendors
| Column | Type |
|---|---|
| vendor_id | INT PK AUTO |
| name | VARCHAR |

---

## Product Tables

### product_categories
| Column | Type |
|---|---|
| category_id | INT PK AUTO |
| name | VARCHAR |

---

### products
| Column | Type |
|---|---|
| product_id | INT PK AUTO |
| name | VARCHAR |
| category_id | INT FK → product_categories |
| vendor_id | INT FK → vendors |
| batch_no | INT |
| packing | INT |
| cost_price | INT |
| labour | INT |
| proi_cost | INT |
| sole_stich | INT |
| pasting | INT |
| trim | INT |
| finishing | INT |
| socks_pasting | INT |
| dc | INT |
| sock_stich | INT |
| sheet | INT |
| stubble | INT |
| bottom | INT |
| p1 | INT |
| p2 | INT |
| na | INT |

---

## Accounts Tables

### group_accounts
| Column | Type |
|---|---|
| group_id | INT PK AUTO |
| name | VARCHAR |
| class | ENUM('ASSETS','LIABILITY','INCOME','EXPENSES') |

---

### control_accounts
| Column | Type |
|---|---|
| control_id | INT PK AUTO |
| name | VARCHAR |
| group_id | INT FK → group_accounts |
| sorting | INT |

---

### chart_of_accounts
| Column | Type |
|---|---|
| ac_id | INT PK AUTO |
| name | VARCHAR |
| control_id | INT FK → control_accounts |
| link_code | VARCHAR |
| status | ENUM('Active','Closed') |

---

### business_accounts
| Column | Type |
|---|---|
| ba_id | INT PK AUTO |
| name | VARCHAR |
| control_id | INT FK → control_accounts |
| link_code | VARCHAR |
| region | VARCHAR |
| status | ENUM('Active','Closed') |

---

## Customer Tables

### customers
| Column | Type |
|---|---|
| customer_id | INT PK AUTO |
| name | VARCHAR |
| ac_id | INT FK → chart_of_accounts |
| city_id | INT FK → cities |

---

### sub_customers
| Column | Type |
|---|---|
| sub_customer_id | INT PK AUTO |
| name | VARCHAR |
| customer_id | INT FK → customers |

---

## Sale Tables

### sale_bills
| Column | Type |
|---|---|
| bill_id | INT PK AUTO |
| date | DATE |
| store_id | INT FK → stores |
| customer_id | INT FK → customers |
| sub_customer_id | INT FK → sub_customers (nullable) |
| bill_no | INT |
| gp_no | INT |
| bilty_no | INT |
| adda_id | INT FK → addas |
| remarks | VARCHAR |
| invoice_discount | DECIMAL |
| status | ENUM('Posted','Unposted') |

---

### sale_bill_items
| Column | Type |
|---|---|
| item_id | INT PK AUTO |
| bill_id | INT FK → sale_bills |
| product_id | INT FK → products |
| cartons | INT |
| pairs | INT |
| rate | DECIMAL |
| discount_percent | DECIMAL |
| discount_value | DECIMAL |
| value | DECIMAL |

---

### sale_returns
| Column | Type |
|---|---|
| return_id | INT PK AUTO |
| date | DATE |
| store_id | INT FK → stores |
| customer_id | INT FK → customers |
| sub_customer_id | INT FK → sub_customers (nullable) |
| bill_no | INT |
| gp_no | INT |
| bilty_no | INT |
| status | ENUM('Posted','Unposted') |
| remarks | VARCHAR |

---

### sale_return_items
| Column | Type |
|---|---|
| item_id | INT PK AUTO |
| return_id | INT FK → sale_returns |
| product_id | INT FK → products |
| cartons | INT |
| pairs | INT |
| rate | DECIMAL |
| discount_percent | DECIMAL |
| discount_value | DECIMAL |
| value | DECIMAL |

---

## Receipt Tables

### receipts
| Column | Type |
|---|---|
| receipt_id | INT PK AUTO |
| date | DATE |
| customer_id | INT FK → customers |
| amount | DECIMAL |
| payment_mode | ENUM('Cash', 'Cheque', 'Online') |
| details | VARCHAR |
| remarks | VARCHAR |

---

> **Note:** All tables have been successfully implemented on the frontend React AppContext state store.
