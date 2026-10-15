# Briefcase — 90-minute hackathon build and handoff plan

Updated 15 October 2026 to reflect the implemented local demo and the own-account funding scope.

The journey is **read invoices → retrieve evidence → validate policy → calculate payment dates and discounts → approve → fund the business's own payments account → export the supplier payment plan**. The implemented money-movement adapter uses Stripe **Payouts**, not Connect supplier transfers. A payout funds the account from which supplier payments could later be made; supplier execution is outside this build.

## Current implementation

| Area | Implemented | Boundary |
| --- | --- | --- |
| Local application | React/TypeScript dashboard served by Vite; Express API on loopback | Single operator; no production authentication or public deployment |
| Persistence | Atomic JSON writes to ignored `.data/state.json`, run history and funding ledger, process-local mutation queue | One server process; no SQLite or multi-process transactions |
| Ingestion | Eight starting fixtures; JSON batch upload; optional OpenAI structured extraction from plain text | No PDF/OCR/email ingestion; runtime extraction key required for text |
| Evidence | Invoice, canonical supplier contract, history and policy excerpts; genuine Cognee CHUNKS retrieval when configured | Local fixtures are labeled; no invented Cognee results or automatic outcome writeback |
| Policy | Supplier/bank match, duplicate checks, disputes, explicit dates, GBP arithmetic, contract terms, gross limits | Deterministic decisions; invoice text and model output cannot authorise a payout |
| Scheduling | Separate funding, send and expected arrival dates; feasible contract discounts; integer pence | Weekdays only, no holidays/cut-offs or settlement guarantee |
| Approval | Manual by default; configurable automatic approval below gross limit; higher eligible amounts require a person | Held invoices cannot be overridden; funding remains an operator action |
| Funding | Available GBP sandbox balance, own-bank allowlist, shortfall, reserve and cap checks; persistent attempts and reconciliation | Real test API only; no live credentials, Connect recipients or simulated success |
| Export | Approved eligible CSV marked `APPROVED_NOT_PAID`; JSON audit download | Generic review/handoff files, not certified bank imports; no supplier settlement |

Cloud keys and a usable destination remain user setup dependencies. The adapters and mocked tests exist; end-to-end Stripe/Cognee verification has not yet been demonstrated with the user's credentials. No payout was created during implementation.

## Demo defaults and worked path

Defaults are manual approval; **£1,000 gross automatic ceiling**, **£2,500 gross hard ceiling**, **£3,000 funding cap** and **£500 retained Stripe reserve**. Both supplier-payment lead time and own-account payout lead time default to two working days. The local demo date is **15 October 2026**. Policy controls are editable; saving recalculates the run and clears prior manual approvals. The [written policy](docs/POLICY.md) describes each clause.

Northstar Cloud NS-1088 is £1,200 gross with a 2% contract discount: **£1,176 net**, funding on 15 October, bank send on 19 October and expected arrival on 21 October. Its gross amount requires a person even in automatic mode. The starting **simulated £300 bank balance** leaves an **£876 funding shortfall** for this due obligation after approval. Paper & Pine and Foundry remain future obligations. Exceptions demonstrate duplicate, changed-bank, unknown-supplier, open-dispute and ambiguous-date holds.

The clock controls local scheduling only. It does not advance Stripe time. A `pending` payout is not arrival; a Stripe test `paid` result credits the simulated local account balance and still does not mark supplier invoices paid. Planned discounts are not realised savings.

## Execution safeguards

- Keep credentials in ignored local `.env`. Reject live keys before network access and require a Stripe balance with `livemode=false`.
- Verify the configured `ba_…` GBP bank against the authenticated own Stripe account. If ownership cannot be verified, stop funding. Do not assume Connect bank-management endpoints work for a standalone account.
- Revalidate approved obligations on the server before requesting the authorised shortfall. Preserve the Stripe reserve and cap; include pending, unknown and successful reservations.
- Save an attempt and stable idempotency key before the request. Record amount, destination, run, invoices, policy and returned payout reference.
- Treat ambiguous network/server responses as unknown. Reconcile known `po_…` IDs; if no ID arrived, inspect Stripe logs. Do not replace an unresolved attempt with a new key.
- Block policy/run changes during pending or unknown funding. Lock the demo date after an attempt and disable reset after any attempt to retain the ledger.
- Treat the CSV as a planning artifact. It contains approved obligations, not proof of bank execution, and must not be submitted to a real bank.

## Runtime and ownership map

| Files | Responsibility |
| --- | --- |
| `shared/types.ts` | Shared invoice, evidence, decision, run, integration and funding contracts |
| `src/App.tsx`, `src/styles.css` | Dashboard, evidence details, policy form and user actions |
| `server/domain.ts`, `server/fixtures.ts` | Pure checks, dates, amounts and demo sources |
| `server/index.ts` | Express routes and approval/funding orchestration |
| `server/store.ts`, `server/funding.ts` | Durable local state, funding preview and CSV export |
| `server/stripe.ts` | Native-fetch Stripe test payouts, status and reconciliation |
| `server/cognee.ts` | Native-fetch Cloud authentication, ingestion, cognify and scoped source retrieval |
| `server/extract.ts` | Optional runtime OpenAI structured extraction |
| `tests/`, `public/demo/`, `docs/` | Focused checks, reproducible fixtures, policy and setup guidance |

Actual routes include `GET /api/state`, `POST /api/invoices`, `POST /api/analyse`, `PATCH /api/settings`, `POST /api/approve`, `GET /api/funding-preview`, `POST /api/fund`, `POST /api/reconcile`, `POST /api/memory/seed`, `GET /api/export` and `GET /api/audit`.

Cognee follows **add → cognify → search**. Seeding uploads policy and supplier contracts/history as text files to a dedicated dataset. Background processing acceptance is distinct from readiness. Search requests raw CHUNKS within that dataset and preserves real source references. Retrieval corroborates canonical records; it cannot set a bank destination or override policy. Missing matching Cloud evidence holds the affected decision when Cloud is configured.

## 90-minute delivery schedule

This is the timebox and acceptance sequence, not a claim that external setup has completed.

| Elapsed | Work | Checkpoint |
| --- | --- | --- |
| 0–10 min | Scaffold Vite/Express, agree types, define fixtures; user prepares local sandbox/Cloud credentials | Local app starts; own-account funding boundary agreed |
| 10–20 min | Implement Stripe and Cognee adapters; build pure policy functions and UI shell | Safe unconfigured states; test-only requests and dataset scope reviewed |
| 20–35 min | Wire fixture/JSON ingestion, decisions, scheduling and source details | Coherent happy path plus visible exceptions |
| 35–50 min | Connect approval settings, durable ledger, CSV, funding preview and reconciliation | Refresh preserves state; held rows cannot enter executable plan |
| 50–60 min | Run focused safety tests/build; resolve integration errors; freeze features | Automated checks pass; unresolved external dependencies explicitly listed |
| 60–75 min | User tests local flow; configure keys; seed Cognee and inspect retrieved chunks; create one authorised test payout if ready | Actual Cloud evidence and `po_…` receipt, or precise readiness blocker |
| 75–85 min | Fix critical issues; inspect pending/paid distinction, duplicate protection and audit | No unintended repeat payout; ledger retained |
| 85–90 min | Rehearse final walkthrough and state limitations | Explain amount/date/evidence, own-account funding and supplier-payment handoff |

## Remaining acceptance work

1. User configures the Stripe sandbox test key, its own usable GBP bank destination and available balance. Confirm readiness in the app without changing to live credentials.
2. User configures Cognee Cloud. Seed from **Policy → Seed demo memory**, wait for processing, run analysis and inspect genuine retrieved chunks.
3. If plain-text extraction is needed for the demo, configure the runtime OpenAI key and test a new text invoice. Structured fixtures already support the walkthrough without it.
4. Approve the intended eligible obligation, inspect the shortfall and request one test payout. Confirm the payout in Stripe; reconcile status without claiming supplier payment.
5. Download CSV/audit, verify persistence and rehearse the explanation. Keep a transparent local-only walkthrough available if Cloud setup is incomplete; never substitute fake external success.

Run `npm test` and `npm run build` for the automated acceptance gate. Follow [README.md](README.md) for local startup and [integration instructions](docs/INTEGRATIONS.md) for credentials and reconciliation.

References: [Stripe create payout](https://docs.stripe.com/api/payouts/create), [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests), [Cognee API](https://docs.cognee.ai/api-reference/introduction).
