# Demo evidence pack

All suppliers, invoices, contracts, history and banking references are fictional. No file contains real bank account details. The demo uses **15 October 2026**, GBP integer pence and manual approval by default.

## Start here

- `invoice-batch.json` — eight normalized invoice objects; upload as one batch.
- `invoices/` — the same eight invoices as readable, independently uploadable text files.
- `contracts/` — six supplier contracts, approved fictional banking references, relationship history and recorded dispute evidence.
- `suppliers.json` — canonical supplier records used for matching and verification.
- `settings.json` — policy defaults, including two working days for each funding and settlement leg.
- `expected-decisions.json` — deterministic expected analysis with source excerpts, checks and policy references.
- `simulated-bank-export.csv` — illustrative bank instruction export for three eligible invoices. **Not executed, not approved, not a bank-compatible payment file.** Rows use fictional references only. Approval and due-date controls must still be satisfied in the application.
- The repository's `docs/POLICY.md` explains each numbered policy clause and calendar assumptions.

## Scenario index

| Invoice file | Scenario | Expected result |
| --- | --- | --- |
| `invoices/inv-paper-1042.txt` | £780, no discount; due 2 November | Eligible; fund 27 October, send 29 October. |
| `invoices/inv-cloud-1088.txt` | £1,200, contract-backed 2% discount by 21 October | Eligible; approve manually; fund 15 October, send 19 October, pay £1,176. |
| `invoices/inv-paper-copy.txt` | Resent PAP-1042 with changed capitalization and punctuation | Blocked as second occurrence in the batch. |
| `invoices/inv-office-203.txt` | Supplier name matches but banking reference has changed | Blocked pending independent verification; suspicious, not proven fraudulent. |
| `invoices/inv-unknown-008.txt` | Blue Ridge has no supplier onboarding record | Blocked pending onboarding. |
| `invoices/inv-cedar-721.txt` | £648 invoice with unresolved missing-crate dispute DSP-014 | Blocked while dispute remains open. |
| `invoices/inv-foundry-441.txt` | £1,840, above the £1,000 automatic approval ceiling | Eligible but always requires human approval; fund 30 October, send 3 November. |
| `invoices/inv-moss-019.txt` | “11/12” has no year or agreed date convention | Review; obtain explicit terms before scheduling. |

Source documents mix ISO, named-month, UK numeric and US named-month dates. Normalized JSON uses ISO dates only. No date is inferred for the ambiguous invoice.

The duplicate rule retains the first occurrence, so use the full batch to demonstrate the copy being held. Uploading an original invoice already present in the app will create another duplicate; start with an empty invoice list for a clean upload demonstration, or use the built-in reset to restore the seeded eight-row demo.

### Expanded discount scenario

`extra-discount-invoices.json` and `extra-discount-suppliers.json` add three matched supplier contracts and invoices with £540 of additional agreed discounts (£564 including Northstar). `POST /api/demo/expand` idempotently adds them to the local workspace and queues their contracts into Cognee. After cloud indexing, check invoices again to corroborate the new suppliers. Reset restores the original eight-invoice scenario; repeat expansion to restore this scenario.

Home estimates simple interest at 3% a year on each eligible net payment amount for whole calendar days between ingestion and scheduled sending (ACT/365). This is an illustrative opportunity estimate, not actual interest credited by Stripe. The cash graph combines current Stripe and simulated bank balances, deducting future eligible supplier payments; transfers between those accounts do not change combined cash.

The expanded calendar also includes 13 ordinary operating invoices (£15,900 total), bringing the workspace to 24 invoices. There are eligible payments on every business day from 19 October through 5 November. At £50,299 starting combined cash, projected closing cash is £24,093 after £26,206 in eligible payments. The forecast is planned activity, not additional executed Stripe payouts.
