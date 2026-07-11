# WentoX  — Project Overview

---

## What is this project?

Wento is a footwear manufacturing and distribution company based in Lahore, Pakistan. They currently use an old desktop ERP software built around 2012. The software works but the interface is outdated, complex, and hard to use.

The goal of this project is to **redesign and rebuild the software** as a modern web application — keeping all the existing functionality but making it clean, simple, and easy to use.

---

## Business Context

- **Industry:** Footwear manufacturing and wholesale distribution
- **Operations:** Manufacturing in Lahore, selling to customers across Pakistan (Karachi, Hyderabad, Mardan, Multan, Sukkur, etc.)
- **Distribution:** Via transport addas and bilty system
- **Scale:** Hundreds of customers, multiple product categories, multi-city operations

---

## Current System Problems

- Built in ~2012, Windows desktop app (dialog-based)
- Every screen opens as a floating popup window
- No clear navigation or flow
- Inconsistent UI — random color coding, small icons, unlabeled fields
- No input validation feedback to the user
- Complex for new staff to learn

---

## Modules to Rebuild


| #  | Module                            | Type                |
| -- | --------------------------------- | ------------------- |
| 1  | Sale Bill                         | Data Entry          |
| 2  | Sale Return                       | Data Entry          |
| 3  | Receipts / Jamma                  | Data Entry          |
| 4  | Product Detail Info               | Setup               |
| 5  | Product Category                  | Setup               |
| 6  | Product Current Stock             | Report              |
| 7  | Product Ledger                    | Report              |
| 8  | Search & Bilty Adda Updation      | Data Entry + Search |
| 9  | Sub Customer                      | Setup               |
| 10 | City Creation                     | Setup               |
| 11 | Group Accounts                    | Accounts Setup      |
| 12 | Control Accounts                  | Accounts Setup      |
| 13 | Chart of Accounts                 | Accounts Setup      |
| 14 | Business Accounts                 | Accounts Setup      |
| 15 | Business Accounts Ledger (Khaata) | Report              |
| 16 | Cash Book Summary                 | Report              |

---

## Account Hierarchy

The accounting structure is 4 levels deep:

```
Class (ASSETS / LIABILITY / INCOME / EXPENSES)
  └── Group Account (e.g. TRADE DEBTORS)
        └── Control Account (e.g. CUSTOMERS ACCOUNTS)
              └── Chart of Accounts / Business Accounts (individual accounts)
```

---

## Key Business Concepts


| Term                 | Meaning                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| **Bilty**            | Delivery receipt issued by transport company                           |
| **Adda**             | Transport station/company used for delivery                            |
| **Jamma / Receipts** | Cash or cheque received from customers                                 |
| **Khaata**           | Urdu for ledger — account book                                        |
| **SAME delivery**    | Direct delivery to customer's warehouse, no middleman                  |
| **Sub-customer**     | A delivery agent or middleman between the company and the end customer |
| **Packing**          | Number of pairs per carton (usually 12)                                |
| **Posting**          | Finalizing a transaction so it reflects in accounts                    |

---

## Tech Stack (Proposed)

> To be finalized — below is a suggestion based on project requirements.

- **Frontend:** React + Tailwind CSS
- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Deployment:** To be decided

---

## Pending Discussions

- Control Accounts screen — full functionality
- Receipts (Jamma) screen — full functionality
- Payments screen
- Any additional reports or screens not yet captured
