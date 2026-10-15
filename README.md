# Briefcase

A local invoice-planning demo: inspect supplier evidence, check payment policy, capture eligible discounts, approve a schedule, and fund your **own business payments account** through the Stripe test Payouts API. Export the approved supplier payment plan as CSV for review.

**Funding the business account does not pay suppliers.** No supplier bank-payment API is connected. Fixture bank balances, invoice records and supplier banking references are simulated. Stripe funding uses genuine test API requests only when a sandbox key and verified destination are configured; there is no mock-success fallback.

## Run locally

Use Node.js 20 or newer and npm. From the project directory:

```sh
npm install
cp .env.example .env
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite serves the React dashboard on port 5173 and proxies `/api` to the Express server on port 3001. Keep the default API port for this configuration. The server binds to loopback; this is a single-operator local demo without production authentication.

The app opens with eight fixture invoices and local source evidence. You can inspect the plan and approval controls without any API keys. To serve a built dashboard from Express instead:

```sh
npm run build
npm start
```

Then open [http://127.0.0.1:3001](http://127.0.0.1:3001).

## Configure integrations

Enter credentials only in your local `.env`; it is ignored by Git. Never paste keys into chat, commit them, or put them in browser code. Restart after configuration changes, then refresh **Policy → Connections & data sources**. See [integration setup](docs/INTEGRATIONS.md) for request formats and troubleshooting.

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe sandbox `sk_test_…` or appropriately permissioned `rk_test_…`; live keys are rejected |
| `STRIPE_PAYOUT_DESTINATION` | Exact `ba_…` ID of your own sandbox GBP bank account, exposed by the authenticated Stripe account |
| `COGNEE_API_KEY` | Cognee Cloud API key |
| `COGNEE_BASE_URL` | Defaults to `https://api.cognee.ai` |
| `COGNEE_DATASET_NAME` | Dedicated demo dataset; defaults to `briefcase_demo` |
| `OPENAI_API_KEY` | Optional runtime API key for extracting new plain-text invoices |
| `OPENAI_MODEL` | Extraction model; `.env.example` supplies the default |

Stripe setup must provide available GBP test balance and a usable own bank destination. The adapter verifies test mode, ownership and currency before funding. A valid key with incomplete bank setup can show the real available balance while funding remains disabled. The bank-management APIs documented for Connect are not assumed to work on a standalone business account; if `/v1/account` does not expose the bank, check Stripe configuration and permissions.

For Cognee, select **Policy → Seed demo memory** after configuring the key. This uploads the current policy and supplier contract/history documents to the dedicated dataset and requests background processing. Wait for processing in Cognee Cloud, then select **Run agent**. Decisions show genuine retrieved source chunks when available. With a configured key, missing matching retrieval holds the affected invoice for review. Without a key, evidence remains explicitly local demo material. An accepted seed request is not proof that indexing has completed.

Structured JSON invoice uploads work without an extraction key. Plain-text `.txt` uploads require OpenAI API access. PDF, scanned-invoice OCR and email ingestion are outside this build. A coding-agent subscription does not provide this app's runtime API credentials.

## Walk through the demo

1. Open an invoice and inspect its source, contract, history, checks and calculated dates. **Run agent** recalculates the plan.
2. Inspect the exceptions: duplicate invoice, changed bank reference, unknown supplier, open dispute and ambiguous due date. Approval cannot override those holds.
3. Review **Policy**. Manual approval is the default. Automatic mode authorises eligible invoices at or below its gross-amount limit; larger eligible invoices still need manual approval. Funding always requires an operator action. Policy changes recalculate the run and clear prior manual approvals.
4. Approve eligible invoices. On the default demo date, Northstar Cloud's £1,200 invoice qualifies for a £24 discount: £1,176 net, funding date 15 October, send date 19 October, expected arrival 21 October. It needs manual approval even in automatic mode because gross exceeds £1,000.
5. Inspect the funding preview. With the initial simulated £300 payments-account balance, Northstar's due funding shortfall is £876. Future funding obligations are excluded until their scheduled funding date. The daily cap and retained Stripe reserve still apply.
6. Once Stripe is connected and the preview permits it, use the funding action to request a **test payout to your own account**. Inspect the `po_…` reference in Stripe and use **Payment runs → Refresh status** to reconcile. `pending` means requested/in transit; `paid` means the test payout reports completion. Neither status means suppliers were paid.
7. Download **Export payment CSV** and **Audit trail**. The CSV contains approved eligible rows marked `APPROVED_NOT_PAID`; it is a generic planning file, not a certified bank upload format or an execution receipt. The JSON audit retains decision and funding records. Do not submit the demo CSV to a real bank.

The demo clock starts at **15 October 2026** and affects local scheduling only; it cannot advance Stripe. Lead times assume Monday–Friday working days, excluding public holidays and bank cut-offs. The £300 bank balance is simulated, and a reconciled successful test payout credits that local simulation only. No bank account balance is fetched.

## Persistence and failures

State persists in ignored `.data/state.json` through atomic file replacement. A process-local queue serialises changes; run only one server against a data directory. This is a durable local JSON store, not a multi-process database.

A funding attempt is saved before the Stripe request. Uncertain responses retain the attempt and idempotency key; automatic resubmission is disabled when no payout ID is known. Inspect Stripe request logs before resolving such an attempt. Pending or unknown funding blocks changes that would invalidate the run. The demo clock locks after a funding attempt, and workspace reset is disabled once any funding attempt exists to preserve its ledger. Do not delete `.data` to bypass those protections.

There is no unattended scheduler, supplier payment execution, supplier bank reconciliation, production identity/access control, or automatic outcome writeback to Cognee. The generic CSV does not contain production bank details. Potential discounts are planned savings, not proof of realised savings.

## Check the build

```sh
npm test
npm run build
```

Tests cover policy/date calculations and mocked integration safety, including live-key rejection, destination verification, available balance, uncertain Stripe outcomes and scoped Cognee evidence. They do not validate a real cloud account. For manual acceptance, repeat the walkthrough, refresh the browser to verify persistence, change approval mode before funding, and confirm held invoices cannot be approved or exported.

At this handoff, cloud configuration and end-to-end credentialed verification are still pending. No actual Stripe payout has been created by the build process. The user supplies local keys and the destination; a successful real test payout and Cognee retrieval must be demonstrated separately.

## Code and references

- `src/App.tsx`: dashboard, invoice details, approval and funding controls.
- `server/domain.ts`, `server/fixtures.ts`: deterministic rules, scheduling and demo data.
- `server/index.ts`, `server/store.ts`, `server/funding.ts`: API, durable state, funding orchestration and CSV.
- `server/stripe.ts`, `server/cognee.ts`, `server/extract.ts`: server-side integration adapters.
- `public/demo/`: source examples and expected decisions.
- [Written policy](docs/POLICY.md), [integration setup](docs/INTEGRATIONS.md), [build plan](BUILD_PLAN.md).
- [Stripe Payouts API](https://docs.stripe.com/api/payouts/create), [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests), [Cognee API reference](https://docs.cognee.ai/api-reference/introduction).
