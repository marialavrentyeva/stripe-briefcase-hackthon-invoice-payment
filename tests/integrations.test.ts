import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createTestPayout, getStripeDestinations, getStripeStatus, retrieveTestPayout, StripeIntegrationError } from '../server/stripe.js';
import { getCogneeStatus, searchCognee, seedCognee } from '../server/cognee.js';

const names = ['STRIPE_SECRET_KEY', 'STRIPE_PAYOUT_DESTINATION', 'COGNEE_API_KEY', 'COGNEE_BASE_URL', 'COGNEE_DATASET_NAME'] as const;
let saved: Record<string, string | undefined>;
let originalFetch: typeof fetch;
let calls: { url: string; init?: RequestInit }[];
let overrides: Record<string, () => Response | Promise<Response>>;
const bank = { id: 'ba_mock', object: 'bank_account', currency: 'gbp', account: 'acct_mock', status: 'new', bank_name: 'Test bank', last4: '1234', account_number: 'never-return-this', routing_number: 'never-return-this' };
const payout = { id: 'po_mock', amount: 1000, currency: 'gbp', destination: 'ba_mock', livemode: false, status: 'pending', arrival_date: 1800000000 };
const funding = { amountPence: 1000, idempotencyKey: 'run:1', runId: 'run1', invoiceIds: ['inv1'] };
beforeEach(() => {
  saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  originalFetch = globalThis.fetch;
  calls = []; overrides = {};
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock'; process.env.STRIPE_PAYOUT_DESTINATION = 'ba_mock';
  process.env.COGNEE_API_KEY = 'dummy'; process.env.COGNEE_BASE_URL = 'https://api.cognee.ai'; process.env.COGNEE_DATASET_NAME = 'briefcase_demo';
  globalThis.fetch = (async (input, init) => {
    const url = String(input); calls.push({ url, init });
    const path = new URL(url).pathname;
    if (overrides[path]) return overrides[path]();
    if (path === '/v1/balance') return Response.json({ livemode: false, available: [{ currency: 'gbp', amount: 2000, source_types: { card: 2000 } }], pending: [{ currency: 'gbp', amount: 999999 }] });
    if (path === '/v1/account') return Response.json({ id: 'acct_mock', payouts_enabled: true, external_accounts: { data: [bank], has_more: false } });
    if (path === '/v1/payouts' || path === '/v1/payouts/po_mock') return Response.json(payout);
    if (path === '/api/v1/search') return Response.json([{ dataset_id: 'dataset-123', search_result: [{ id: 'chunk-123', text: 'The contract allows a 2% early payment discount.' }] }]);
    if (['/health', '/api/v1/datasets/', '/api/v1/add', '/api/v1/cognify'].includes(path)) return Response.json({ status: 'accepted' });
    throw new Error(`Unexpected URL in mock: ${url}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
});

test('live and missing Stripe keys never make network requests', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_live_rejected';
  assert.equal((await getStripeStatus()).status.connected, false);
  await assert.rejects(createTestPayout(funding), /test secret/);
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal((await getStripeStatus()).status.configured, false);
  assert.equal(calls.length, 0);
});
test('status retains available GBP balance when destination is missing or unverified', async () => {
  delete process.env.STRIPE_PAYOUT_DESTINATION;
  let status = await getStripeStatus();
  assert.equal(status.balancePence, 2000); assert.equal(status.status.configured, true); assert.equal(status.status.connected, false);
  process.env.STRIPE_PAYOUT_DESTINATION = 'ba_missing';
  status = await getStripeStatus();
  assert.equal(status.balancePence, 2000); assert.equal(status.status.connected, false);
  assert.ok(calls.every(call => !call.url.includes('/external_accounts')));
});
test('a non-test balance prevents payouts and destination discovery', async () => {
  overrides['/v1/balance'] = () => Response.json({ livemode: true, available: [{ currency: 'gbp', amount: 2000 }] });
  await assert.rejects(createTestPayout(funding), /test-mode balance/);
  await assert.rejects(getStripeDestinations(), /test-mode balance/);
  assert.ok(calls.every(call => call.init?.method === 'GET'));
});
test('own-bank discovery strips account/routing numbers and rejects foreign banks', async () => {
  overrides['/v1/account'] = () => Response.json({ id: 'acct_mock', external_accounts: { data: [bank, { ...bank, id: 'ba_other', account: 'acct_other' }], has_more: true } });
  const result = await getStripeDestinations();
  assert.equal(result.hasMore, true); assert.equal(result.destinations.length, 1); assert.equal(result.destinations[0].last4, '1234');
  assert.equal(JSON.stringify(result).includes('never-return-this'), false);
});
test('allowlist, bank ownership, bank currency and payout eligibility fail closed', async () => {
  await assert.rejects(createTestPayout({ ...funding, destination: 'ba_other' }), /configured business/);
  for (const unsafeBank of [{ ...bank, account: 'acct_other' }, { ...bank, currency: 'usd' }, { ...bank, status: 'errored' }]) {
    overrides['/v1/account'] = () => Response.json({ id: 'acct_mock', external_accounts: { data: [unsafeBank] } });
    await assert.rejects(createTestPayout(funding), /usable GBP/);
  }
  overrides['/v1/account'] = () => Response.json({ id: 'acct_mock', payouts_enabled: false, external_accounts: { data: [bank] } });
  await assert.rejects(createTestPayout(funding), /Payouts are disabled/);
  assert.ok(calls.every(call => call.init?.method === 'GET'));
});
test('pending funds cannot cover payout and split sources cannot be implicitly combined', async () => {
  await assert.rejects(createTestPayout({ ...funding, amountPence: 3000 }), /Insufficient available/);
  overrides['/v1/balance'] = () => Response.json({ livemode: false, available: [{ currency: 'gbp', amount: 2000, source_types: { card: 600, bank_account: 1400 } }] });
  await assert.rejects(createTestPayout({ ...funding, amountPence: 1800 }), /No single/);
});
test('payout posts stable idempotency, exact GBP amount and own bank; pending is not paid', async () => {
  assert.equal((await getStripeStatus()).status.connected, true);
  assert.equal((await createTestPayout(funding)).status, 'pending');
  const call = calls.find(call => call.init?.method === 'POST')!;
  assert.equal((call.init?.headers as Record<string, string>)['Idempotency-Key'], 'run:1');
  const form = new URLSearchParams(String(call.init?.body));
  assert.equal(form.get('amount'), '1000'); assert.equal(form.get('currency'), 'gbp'); assert.equal(form.get('destination'), 'ba_mock'); assert.equal(form.get('metadata[run_id]'), 'run1');
  assert.equal((await retrieveTestPayout('po_mock')).stripePayoutId, 'po_mock');
});
test('network failure, malformed success and server errors require reconciliation without exposing secrets', async () => {
  for (const response of [() => { throw new Error('sk_test_sensitive'); }, () => new Response('not JSON'), () => Response.json({ error: { message: 'sk_test_sensitive' } }, { status: 500 }), () => Response.json({ ...payout, amount: 2000 }), () => Response.json({ ...payout, destination: 'ba_other' })]) {
    overrides['/v1/payouts'] = response;
    await assert.rejects(createTestPayout(funding), error => error instanceof StripeIntegrationError && error.uncertain && !error.message.includes('sensitive'));
  }
});
test('Cognee searches only configured dataset and preserves actual chunk IDs/text', async () => {
  const evidence = await searchCognee('discount');
  assert.equal(evidence[0].id, 'cognee:chunk-123'); assert.match(evidence[0].title, /dataset-123/); assert.equal(evidence[0].excerpt, 'The contract allows a 2% early payment discount.');
  const body = JSON.parse(String(calls[0].init?.body)); assert.deepEqual(body.datasets, ['briefcase_demo']); assert.equal(body.search_type, 'CHUNKS');
  overrides['/api/v1/search'] = () => Response.json({ answer: 'Synthetic answer is not source evidence' });
  assert.deepEqual(await searchCognee('discount'), []);
});
test('Cognee does not invent evidence on authentication error or missing keys', async () => {
  overrides['/api/v1/search'] = () => Response.json({ message: 'dummy-secret' }, { status: 401 });
  await assert.rejects(searchCognee('discount'), /HTTP 401/);
  delete process.env.COGNEE_API_KEY;
  assert.equal((await getCogneeStatus()).configured, false);
  await assert.rejects(searchCognee('discount'), /COGNEE_API_KEY/);
});
test('Cognee uploads source documents then requests scoped background processing', async () => {
  const result = await seedCognee([{ id: 'contract1', text: '2% discount' }]); assert.equal(result.accepted, true);
  const form = calls[0].init?.body as FormData; assert.ok(form instanceof FormData); assert.equal(form.get('datasetName'), 'briefcase_demo'); assert.match(await (form.get('data') as Blob).text(), /Source document: contract1/);
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { datasets: ['briefcase_demo'], run_in_background: true });
  overrides['/api/v1/add'] = () => Response.json({ status: 'failed' });
  await assert.rejects(seedCognee([{ id: 'contract1', text: '2% discount' }]), /failed ingestion/);
});
