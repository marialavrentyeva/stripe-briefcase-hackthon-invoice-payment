# Briefcase

Briefcase helps a business keep cash in its account for longer by planning **when to pay each invoice**. It schedules ordinary invoices for their latest safe payment date and brings payments forward when an agreed early-payment discount is available, allowing time for settlement.

The app checks invoices against supplier contracts, payment terms and history in **Cognee memory**, applies a written spending policy, and presents a payment schedule for approval. The dashboard shows daily payment runs, forecast balances, potential discounts and estimated interest earned from retaining cash at a 3% annual rate. Each decision links back to its policy rules and source evidence, so you can ask why a payment was scheduled or authorised.

When approved obligations need funding, Briefcase calculates the shortfall and requests a **Stripe test-mode payout to the business’s own payments account**. It also exports the approved supplier payment run as CSV. Supplier payments themselves are not executed: the downstream bank ledger is simulated, and the CSV is a planning export.

## Example workflow: the two-minute demo

The prepared demo starts with **20 invoices: 19 eligible payments and one duplicate**, against a Stripe sandbox funded initially with **£50,000**. The dashboard uses the current Stripe balance, which changes after test payouts.

1. **See the cash plan on Home.** Browse daily payments and the declining forecast balance. Ordinary invoices stay scheduled as late as safely possible; four discounted invoices offer **£564 in potential savings**. Estimated interest reflects the time from invoice ingestion to its scheduled payment date at 3% per year.
2. **Open the agent and inspect the reasoning.** Ask “Why pay Northstar early?” Its £1,200 invoice offers a 2% discount: the plan schedules **£1,176**, sent on 19 October for expected arrival on 21 October. Supplier evidence from Cognee and the policy explain the timing.
3. **Remove the one duplicate.** The agent flags a second copy of Paper & Pine Studio invoice **PAP-1042**. Click **Remove duplicate from run**. The original remains scheduled, and the exclusion stays in the audit history.
4. **Approve the plan through chat.** Review the eligible invoices and click **Approve plan**. Approval authorises the schedule; it does not move money.
5. **Fund only what is needed now.** The agent shows approved obligations due for funding, the payments-account balance, pending funding and the exact Stripe shortfall. Click **Confirm test payout** after reviewing the amount. Future obligations stay scheduled. In the prepared recording state, £2,076 is due and £1,176 is already in the simulated payments account, leaving **£900** to fund; the current preview is always authoritative.
6. **Show the receipt and payment run.** In **Payment runs**, inspect the Stripe payout reference and refresh its status. Export the approved supplier CSV and audit trail to show the amounts, dates, approvals, policy clauses and evidence behind the run.

This is a guided chat demo with real application actions. Stripe funding uses genuine sandbox API requests when configured; no real money moves. The forecast, interest and discounts are estimates, not realised returns. See [the recording flow](docs/RECORDING_FLOW.md) for timing and [the written policy](docs/POLICY.md) for controls.

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
| `STRIPE_PAYOUT_DESTINATION` | Exact `ba_…` ID of your own sandbox GBP bank account |
| `COGNEE_API_KEY` | Cognee Cloud API key |
| `COGNEE_BASE_URL` | Exact tenant API Base URL from Cloud → API Keys → Connection Details |
| `COGNEE_TENANT_ID` | Tenant ID from the same Connection Details card, sent as `X-Tenant-Id` |
| `COGNEE_DATASET_NAME` | Dedicated demo dataset; defaults to `briefcase_demo` |
| `OPENAI_API_KEY` | Optional runtime API key for extracting new plain-text invoices |
| `OPENAI_MODEL` | Extraction model; `.env.example` supplies the default |

Stripe setup must provide available GBP test balance and an explicit own bank destination. Normally payouts must be enabled. For a standalone sandbox that reports payouts disabled and omits its bank list, the adapter requires a previously paid test GBP bank payout to that exact destination before allowing funding. When the account exposes its bank list, the adapter verifies ownership and GBP currency before funding. Standalone accounts can omit this list by design; their configured bank is validated by Stripe when the account-scoped payout is submitted, and the status message says so. The adapter never chooses a default bank or calls Connect bank-management endpoints. A valid key with incomplete setup can show the real available balance while funding remains disabled.

For Cognee, use your provisioned tenant URL (such as `https://your-tenant.aws.cognee.ai`), not the older shared `api.cognee.ai` example. Select **Policy → Seed demo memory** after configuring the key. This uploads the current policy and supplier contract/history documents to the dedicated dataset and requests background processing. Wait for processing in Cognee Cloud, then use **Open agent** to check invoices again. Decisions show genuine retrieved source chunks when available. With a configured key, missing matching retrieval holds the affected invoice for review. Without a key, evidence remains explicitly local demo material. An accepted seed request is not proof that indexing has completed.

Structured JSON invoice uploads work without an extraction key. Plain-text `.txt` uploads require OpenAI API access. PDF, scanned-invoice OCR and email ingestion are outside this build. A coding-agent subscription does not provide this app's runtime API credentials.

## Prepare the demo dataset

A fresh install contains eight invoices covering several exception types. To prepare the focused walkthrough above, run these requests against the local server, in order:

```sh
curl -X POST http://127.0.0.1:3001/api/demo/expand
curl -X POST http://127.0.0.1:3001/api/demo/prepare-recording
```

Expansion adds suppliers and invoices with staggered dates and more discounts. Recording preparation archives the other exception examples, leaving the duplicate for review. These actions preserve existing funding history and balances; they do not create a payout. With Cognee configured, allow the new source documents to finish indexing before checking invoices again through **Open agent**. A fresh workspace's £300 simulated payments-account balance will produce a different funding shortfall from the previously funded recording state.

The CSV contains approved eligible rows marked `APPROVED_NOT_PAID`. It is a generic planning file, not a certified bank upload format or an execution receipt. The JSON audit retains decision and funding records. Do not submit demo banking references to a real bank.

The demo clock starts at **15 October 2026** and affects local scheduling only; it cannot advance Stripe. Lead times assume Monday–Friday working days, excluding public holidays and bank cut-offs. The £300 bank balance is simulated, and a reconciled successful test payout credits that local simulation only. No bank account balance is fetched.

## Persistence and failures

State persists in ignored `.data/state.json` through atomic file replacement. A process-local queue serialises changes; run only one server against a data directory. This is a durable local JSON store, not a multi-process database.

A funding attempt is saved before the Stripe request. Uncertain responses retain the attempt and idempotency key; automatic resubmission is disabled when no payout ID is known. Inspect Stripe request logs before resolving such an attempt. Pending or unknown funding blocks changes that would invalidate the run. The demo clock locks after a funding attempt, and workspace reset is disabled once any funding attempt exists to preserve its ledger. Do not delete `.data` to bypass those protections.

There is no unattended scheduler, supplier payment execution, supplier bank reconciliation or production identity/access control. The generic CSV does not contain production bank details. Potential discounts are planned savings, not proof of realised savings.

## Check the build

```sh
npm test
npm run test:api
npm run build
```

Tests cover policy/date calculations and mocked integration safety, including live-key rejection, destination verification, available balance, uncertain Stripe outcomes and scoped Cognee evidence. They do not validate a real cloud account. For manual acceptance, repeat the walkthrough, refresh the browser to verify persistence, change approval mode before funding, and confirm held invoices cannot be approved or exported.

Cognee tenant health, authentication and genuine CHUNKS retrieval from `briefcase_demo` have been verified with the locally configured app key. The Northstar contract was retrieved with service-provided document and chunk IDs. OpenAI correctly extracted the synthetic Northstar invoice's amount, discount, dates and bank reference. Stripe sandbox balance access and a completed £876 test payout to the configured business bank destination have also been verified in the development workspace. These checks do not configure credentials or recreate funding history in a fresh installation.

Policy changes and funding outcomes are queued durably for Cognee ingestion after local persistence. A failed memory sync never repeats a payout; the queue is retried at startup, after reconciliation, or through `POST /api/memory/sync`. Background indexing can finish after the local action completes. `POST /api/memory/seed` also flushes queued history. The audit export preserves the exact run and evidence used for funding.

## Code and references

- `src/App.tsx`: dashboard, invoice details, approval and funding controls.
- `server/domain.ts`, `server/fixtures.ts`: deterministic rules, scheduling and demo data.
- `server/index.ts`, `server/store.ts`, `server/funding.ts`: API, durable state, funding orchestration and CSV.
- `server/stripe.ts`, `server/cognee.ts`, `server/extract.ts`: server-side integration adapters.
- `public/demo/`: source examples and expected decisions.
- [Written policy](docs/POLICY.md), [integration setup](docs/INTEGRATIONS.md), [build plan](BUILD_PLAN.md).
- [Stripe Payouts API](https://docs.stripe.com/api/payouts/create), [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests), [Cognee Cloud HTTP API](https://docs.cognee.ai/cognee-cloud/http-api).
