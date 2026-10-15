import type { IntegrationStatus } from '../shared/types.js';

type Json = Record<string, any>;
export type PayoutResult = { stripePayoutId: string; status: 'pending' | 'paid' | 'failed' | 'unknown'; amountPence: number; currency: string; destination: string; arrivalDate?: string; error?: string };
export class StripeIntegrationError extends Error {
  constructor(message: string, public uncertain = false) { super(message); this.name = 'StripeIntegrationError'; }
}
function key() {
  const value = process.env.STRIPE_SECRET_KEY?.trim();
  if (!value) throw new StripeIntegrationError('Set STRIPE_SECRET_KEY locally to connect your Stripe sandbox.');
  if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(value)) throw new StripeIntegrationError('Only Stripe test secret or restricted keys are accepted. Live keys are blocked.');
  return value;
}
function destinationId(requested?: string) {
  const allowed = process.env.STRIPE_PAYOUT_DESTINATION?.trim();
  if (!allowed || !/^ba_[A-Za-z0-9]+$/.test(allowed)) throw new StripeIntegrationError('Set STRIPE_PAYOUT_DESTINATION to your sandbox business bank account ID (ba_…).');
  if (requested && requested !== allowed) throw new StripeIntegrationError('Payout destination is not the configured business bank account.');
  return allowed;
}
async function request(path: string, method = 'GET', body?: URLSearchParams, idempotencyKey?: string): Promise<Json> {
  const secret = key();
  let response: Response;
  try {
    response = await fetch(`https://api.stripe.com/v1${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${secret}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, body,
    });
  } catch {
    throw new StripeIntegrationError(method === 'POST' ? 'Stripe response was not received. The payout may exist; reconcile using the same idempotency key before retrying.' : 'Stripe could not be reached. Check connectivity and try again.', method === 'POST');
  }
  let data: Json;
  try { data = await response.json() as Json; } catch {
    throw new StripeIntegrationError('Stripe returned an unreadable response. Reconcile before retrying any payout.', method === 'POST');
  }
  if (!response.ok) {
    // Do not echo provider messages, request headers or bodies: they may contain credentials or account data.
    const code = typeof data.error?.code === 'string' && /^[a-z_]+$/.test(data.error.code) ? ` (${data.error.code})` : '';
    throw new StripeIntegrationError(`Stripe request failed with HTTP ${response.status}${code}. Check sandbox permissions, available balance and bank configuration.`, method === 'POST' && (response.status >= 500 || response.status === 409));
  }
  return data;
}
async function readTestBalance() {
  const balance = await request('/balance');
  if (balance.livemode !== false) throw new StripeIntegrationError('Stripe did not confirm a test-mode balance. Funding is blocked.');
  const entries: Json[] = Array.isArray(balance.available) ? balance.available.filter((entry: Json) => entry.currency === 'gbp') : [];
  const balancePence = entries.reduce((sum, entry) => sum + (Number.isSafeInteger(entry.amount) ? entry.amount : 0), 0);
  const sources: Record<string, number> = {};
  for (const entry of entries) for (const [source, amount] of Object.entries(entry.source_types || {})) if (typeof amount === 'number') sources[source] = (sources[source] || 0) + amount;
  return { balancePence, sources };
}
async function ownAccount() {
  const account = await request('/account');
  if (typeof account.id !== 'string' || !/^acct_[A-Za-z0-9]+$/.test(account.id)) throw new StripeIntegrationError('Stripe account identity could not be verified.');
  return account;
}
function usableBank(bank: Json, accountId: string) {
  return /^ba_[A-Za-z0-9]+$/.test(bank.id) && bank.object === 'bank_account' && bank.currency === 'gbp' && (!bank.account || bank.account === accountId) && !['errored', 'verification_failed'].includes(bank.status);
}
async function verifyDestination(requested?: string) {
  const destination = destinationId(requested);
  const account = await ownAccount();
  // External-account management endpoints are documented for Connect. For an own-account
  // payout, use only banks exposed by the authenticated account itself; never guess ownership.
  const banks: Json[] = Array.isArray(account.external_accounts?.data) ? account.external_accounts.data : [];
  const bank = banks.find(item => item.id === destination);
  if (!bank) throw new StripeIntegrationError('Stripe did not expose the configured bank on your own account. Check the sandbox bank ID and account read permissions in Stripe; funding is blocked until ownership can be verified.');
  if (!usableBank(bank, account.id)) throw new StripeIntegrationError('The configured destination is not a usable GBP bank account on this Stripe account.');
  if (account.payouts_enabled === false) throw new StripeIntegrationError('Payouts are disabled on this Stripe account. Complete sandbox account setup in Stripe.');
  return destination;
}
async function verifiedContext(requested?: string) {
  const balance = await readTestBalance();
  const destination = await verifyDestination(requested);
  return { ...balance, destination };
}
export type StripeDestination = { id: string; bankName?: string; last4?: string; currency: string; defaultForCurrency: boolean; usable: boolean };
export async function getStripeDestinations(): Promise<{ accountId: string; destinations: StripeDestination[]; hasMore: boolean }> {
  await readTestBalance();
  const account = await ownAccount();
  if (!Array.isArray(account.external_accounts?.data)) throw new StripeIntegrationError('Stripe did not expose bank accounts for this key. View your own sandbox bank account in the Stripe dashboard and check account read permissions.');
  return {
    accountId: account.id,
    hasMore: account.external_accounts.has_more === true,
    destinations: account.external_accounts.data.filter((bank: Json) => bank.object === 'bank_account' && typeof bank.id === 'string' && /^ba_[A-Za-z0-9]+$/.test(bank.id) && (!bank.account || bank.account === account.id)).map((bank: Json) => ({
      id: bank.id, ...(typeof bank.bank_name === 'string' ? { bankName: bank.bank_name } : {}), ...(typeof bank.last4 === 'string' ? { last4: bank.last4 } : {}), currency: typeof bank.currency === 'string' ? bank.currency : 'unknown', defaultForCurrency: bank.default_for_currency === true, usable: usableBank(bank, account.id) && account.payouts_enabled !== false,
    })),
  };
}
export async function getStripeStatus(): Promise<{ status: IntegrationStatus; balancePence: number; destination?: string }> {
  const configured = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  let balancePence = 0;
  try {
    balancePence = (await readTestBalance()).balancePence;
    const destination = await verifyDestination();
    return { status: { configured: true, connected: true, mode: 'test', message: 'Stripe sandbox connected; own GBP bank destination verified. No real money moves.' }, balancePence, destination };
  } catch (error) {
    return { status: { configured, connected: false, mode: 'test', message: error instanceof StripeIntegrationError ? error.message : 'Stripe configuration could not be verified.' }, balancePence };
  }
}
function normalizePayout(data: Json, uncertain: boolean): PayoutResult {
  const destination = typeof data.destination === 'string' ? data.destination : data.destination?.id;
  if (data.livemode !== false || data.currency !== 'gbp' || destination !== destinationId() || typeof data.id !== 'string' || !/^po_[A-Za-z0-9]+$/.test(data.id) || !Number.isSafeInteger(data.amount)) {
    throw new StripeIntegrationError('Stripe returned an unexpected payout. Funding requires reconciliation.', uncertain);
  }
  const status = data.status === 'paid' ? 'paid' : ['failed', 'canceled'].includes(data.status) ? 'failed' : ['pending', 'in_transit'].includes(data.status) ? 'pending' : 'unknown';
  return { stripePayoutId: data.id, status, amountPence: data.amount, currency: data.currency, destination, ...(Number.isFinite(data.arrival_date) && data.arrival_date > 0 && data.arrival_date < 253402300800 ? { arrivalDate: new Date(data.arrival_date * 1000).toISOString().slice(0, 10) } : {}), ...(status === 'failed' ? { error: 'Stripe reports this payout failed or was canceled. Check the sandbox dashboard.' } : {}) };
}
export async function createTestPayout(input: { amountPence: number; idempotencyKey: string; runId: string; destination?: string; invoiceIds: string[] }): Promise<PayoutResult> {
  if (!Number.isSafeInteger(input.amountPence) || input.amountPence <= 0) throw new StripeIntegrationError('Payout amount must be a positive whole number of pence.');
  if (!/^[A-Za-z0-9_:-]{1,255}$/.test(input.idempotencyKey)) throw new StripeIntegrationError('A stable valid idempotency key is required.');
  if (!input.runId || input.runId.length > 500 || !input.invoiceIds.length || input.invoiceIds.join(',').length > 500) throw new StripeIntegrationError('A run ID and bounded invoice references are required.');
  const context = await verifiedContext(input.destination);
  if (context.balancePence < input.amountPence) throw new StripeIntegrationError('Insufficient available GBP Stripe balance. Pending balance cannot fund this payout.');
  const body = new URLSearchParams({ amount: String(input.amountPence), currency: 'gbp', destination: context.destination, method: 'standard', description: 'Briefcase: fund own business payments account', 'metadata[run_id]': input.runId, 'metadata[invoice_ids]': input.invoiceIds.join(',') });
  const sources = Object.entries(context.sources);
  if (sources.length) {
    const source = sources.find(([, amount]) => amount >= input.amountPence);
    if (!source) throw new StripeIntegrationError('No single Stripe balance source can cover this payout.');
    body.set('source_type', source[0]);
  }
  const result = normalizePayout(await request('/payouts', 'POST', body, input.idempotencyKey), true);
  if (result.amountPence !== input.amountPence) throw new StripeIntegrationError('Returned payout amount differs from the funding request; reconcile before retrying.', true);
  return result;
}
export async function retrieveTestPayout(id: string): Promise<PayoutResult> {
  if (!/^po_[A-Za-z0-9]+$/.test(id)) throw new StripeIntegrationError('Invalid Stripe payout reference.');
  return normalizePayout(await request(`/payouts/${encodeURIComponent(id)}`), false);
}
