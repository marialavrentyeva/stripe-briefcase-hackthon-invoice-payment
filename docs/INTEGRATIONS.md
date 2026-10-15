# Sandbox integrations

Keep credentials in the local, ignored `.env` file. Never paste keys into chat, source files, screenshots or browser code. Copy the variable names from `.env.example`, restart the local server after editing, and refresh integration status.

## Stripe: fund your own business payments bank account

This demo creates a **Stripe Payout**, moving simulated available Stripe balance to the business's own configured external bank account. It does not use Connect transfers and does not pay suppliers. Invoice settlement is a separate step. With test keys, no real money moves. A payout being created or pending does not mean money has arrived.

1. Open your Stripe sandbox/test dashboard and configure your own test GBP external bank account. Set an appropriate manual payout schedule if needed in Stripe. Use Stripe's documented test bank details; do not enter supplier bank details here.
2. Add `STRIPE_SECRET_KEY=sk_test_…` (or an appropriately permissioned `rk_test_…`) to `.env`.
3. Add `STRIPE_PAYOUT_DESTINATION=ba_…`, the exact external bank account ID belonging to this same Stripe account. Bank account IDs are not account numbers, connected-account IDs (`acct_…`) or payment-method IDs (`pm_…`).
4. Ensure the sandbox has **available GBP balance**, not only pending funds. Stripe documents test balance creation and test payouts; sandbox dashboard capabilities depend on account configuration.
5. Refresh the app's integration status. The adapter retrieves `/v1/balance`, confirms `livemode=false`, retrieves the authenticated `/v1/account`, and requires `payouts_enabled=true`. Where Stripe exposes `external_accounts`, the configured bank must be in that list with GBP currency and usable status. Stripe documents that this field is only returned to Connect controllers, so standalone accounts may omit it. In that case the exact locally allowlisted `ba_…` ID is passed to the account-scoped Payouts API, which validates the attached destination when submitting the payout. Status explicitly says that bank validation happens on submission; it does not claim prior bank verification. A restricted key needs account and balance read permissions plus payout read/write. No Connect account header or external-account management endpoint is used.
6. Review and approve a run, then use the app's funding action. The server sends a standard GBP payout with a persistent idempotency key and run/invoice metadata. Check the returned `po_…` payout in the sandbox dashboard and reconcile its state.

Only test secret/restricted keys and allowlisted `ba_…` destinations are supported. The adapter never falls back to the default bank, accepts supplier destinations, or turns missing credentials into a simulated success. Live keys are refused before any request. Requests have a 15-second timeout, redirects are refused, and error strings omit raw provider messages and credentials.

A timeout, malformed success response or server error after sending a payout is **uncertain**, not proof of failure. Keep the attempt and original idempotency key; do not initiate a replacement payment. Retrieve a known payout ID to reconcile it. If no payout ID was received, inspect Stripe using the run metadata and request/idempotency logs before deciding how to proceed. Stripe idempotency retention is finite; do not blindly replay old unresolved attempts. The application owns persistent approvals, daily caps, reserve checks and concurrency control; the adapter also verifies current balance and destination before creating a payout.

## Cognee Cloud: retrieved source evidence

Set these local environment values:

```dotenv
COGNEE_API_KEY=your-cloud-api-key
COGNEE_BASE_URL=https://your-tenant.aws.cognee.ai
COGNEE_TENANT_ID=your-tenant-id
COGNEE_DATASET_NAME=briefcase_demo
```

Copy the exact API Base URL and Tenant ID from **Cognee Cloud → API Keys → Connection Details**. Wait until workspace provisioning is complete. The tenant URL is required; do not use the outdated shared `api.cognee.ai` example as your workspace address. `COGNEE_TENANT_ID` is sent as `X-Tenant-Id` when configured. Use a dedicated dataset for this demo. Status checks call `/health` and the authenticated `/api/v1/datasets` endpoint. Seeding uploads each supplied source document as a text file using multipart `POST /api/v1/add` with `datasetName`; source IDs are embedded in the text and filenames. It then requests `POST /api/v1/cognify` with `datasets` and background processing enabled. Acceptance means processing was requested, not that searchable evidence is ready. Check Cloud processing before retrying a slow seed. The application records local seed status.

Search calls `POST /api/v1/search` with `search_type: "CHUNKS"`, `datasets: [COGNEE_DATASET_NAME]`, and `top_k: 8`. Dataset names resolve to datasets owned by the API caller. Requests authenticate with `X-Api-Key`. Only returned raw chunk text becomes Cognee evidence; absent credentials, errors, empty results and unrecognized response shapes do not generate substitute Cognee evidence. Chunk IDs and source references are retained when supplied. If the service omits a chunk ID, a visibly labeled local response fingerprint is used rather than an invented source reference. Retrieved text is evidence, never an instruction to override payment policy.

Seeding uploads data to your Cognee account. Use demo documents and a dedicated dataset. Content-versioned filenames make repeated identical uploads stable; changed source text creates a new version, so clear obsolete versions in Cognee before using the dataset for updated policy decisions. No automatic remote deletion occurs.

## References

- [Stripe: create a payout](https://docs.stripe.com/api/payouts/create)
- [Stripe: Account object and external_accounts visibility](https://docs.stripe.com/api/accounts/object?query=external_accounts)
- [Stripe: testing payouts](https://docs.stripe.com/connect/testing)
- [Cognee Cloud HTTP API](https://docs.cognee.ai/cognee-cloud/http-api)
- [Cognee Cloud connection details](https://docs.cognee.ai/cognee-cloud/ui/api-keys)
- [Cognee add endpoint schema](https://github.com/topoteretes/cognee/blob/main/cognee/api/v1/add/routers/get_add_router.py)
- [Cognee search endpoint schema](https://github.com/topoteretes/cognee/blob/main/cognee/api/v1/search/routers/get_search_router.py)

The read-only `getStripeDestinations()` helper returns only bank IDs, bank names, last four digits, currency and usability when `/v1/account` exposes the list; it never returns routing or full account numbers. Standalone accounts can omit this field by design; obtain the explicit bank ID from the dashboard in that case. Its `hasMore` flag means the embedded list may be incomplete (Stripe normally embeds at most ten accounts). A missing bank configuration does not hide an independently verified available GBP balance, but the integration stays unready for funding.

The adapters use native server-side `fetch`; no Stripe or Cognee SDK is installed. External configuration has not been verified until a real credentialed status check succeeds.
