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
  if (account.payouts_enabled !== true) {
    // A standalone sandbox can report production onboarding as incomplete after
    // successfully paying out test funds. Only authenticated paid test history
    // for this exact destination can attest that narrow sandbox exception.
    // https://docs.stripe.com/api/payouts/list
    if (account.payouts_enabled === false && account.external_accounts === undefined) {
      const query = new URLSearchParams({ destination, status: 'paid', limit: '1' });
      const history = await request(`/payouts?${query}`);
      const previous = history.object === 'list' && Array.isArray(history.data) ? history.data[0] : undefined;
      if (previous?.object === 'payout' && previous.type === 'bank_account' && previous.livemode === false && previous.status === 'paid'
        && previous.currency === 'gbp' && previous.destination === destination && typeof previous.id === 'string' && /^po_[A-Za-z0-9]+$/.test(previous.id)
        && Number.isSafeInteger(previous.amount) && previous.amount > 0 && !previous.failure_code && !previous.reversed_by) {
        return { destination, bankVerified: false, paidTestHistory: true };
      }
    }
    throw new StripeIntegrationError('Payouts are not enabled on this Stripe account. Complete sandbox account setup in Stripe, or verify a previously paid test GBP payout to the configured bank.');
  }
  // Stripe omits external_accounts on standalone accounts where this key is not a
  // Connect controller. The account-scoped Payouts API validates an explicit bank ID
  // on submission; never substitute a default destination or use a Connect header.
  if (account.external_accounts === undefined) return { destination, bankVerified: false };
  if (!Array.isArray(account.external_accounts?.data)) throw new StripeIntegrationError('Stripe returned an unreadable bank-account list. Funding is blocked.');
  const bank = (account.external_accounts.data as Json[]).find(item => item.id === destination);
  if (!bank) throw new StripeIntegrationError('The configured bank was not found in the bank accounts exposed by Stripe. Check the allowlisted sandbox bank ID.');
  if (!usableBank(bank, account.id)) throw new StripeIntegrationError('The configured destination is not a usable GBP bank account on this Stripe account.');
  return { destination, bankVerified: true };
}
async function verifiedContext(requested?: string) {
  const balance = await readTestBalance();
  const bank = await verifyDestination(requested);
  return { ...balance, ...bank };
}
export type StripeDestination = { id: string; bankName?: string; last4?: string; currency: string; defaultForCurrency: boolean; usable: boolean };
export async function getStripeDestinations(): Promise<{ accountId: string; destinations: StripeDestination[]; hasMore: boolean }> {
  await readTestBalance();
  const account = await ownAccount();
  if (!Array.isArray(account.external_accounts?.data)) throw new StripeIntegrationError('Stripe does not expose bank-account lists for this standalone account. Copy your own sandbox bank ID from the Stripe dashboard into STRIPE_PAYOUT_DESTINATION; Stripe validates it when a payout is submitted.');
  return {
    accountId: account.id,
    hasMore: account.external_accounts.has_more === true,
    destinations: account.external_accounts.data.filter((bank: Json) => bank.object === 'bank_account' && typeof bank.id === 'string' && /^ba_[A-Za-z0-9]+$/.test(bank.id) && (!bank.account || bank.account === account.id)).map((bank: Json) => ({
      id: bank.id, ...(typeof bank.bank_name === 'string' ? { bankName: bank.bank_name } : {}), ...(typeof bank.last4 === 'string' ? { last4: bank.last4 } : {}), currency: typeof bank.currency === 'string' ? bank.currency : 'unknown', defaultForCurrency: bank.default_for_currency === true, usable: usableBank(bank, account.id) && account.payouts_enabled === true,
    })),
  };
}
export async function getStripeStatus(): Promise<{ status: IntegrationStatus; balancePence: number; destination?: string }> {
  const configured = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  let balancePence = 0;
  try {
    balancePence = (await readTestBalance()).balancePence;
    const { destination, bankVerified, paidTestHistory } = await verifyDestination();
    const message = paidTestHistory ? 'Stripe sandbox connected; a previously paid test GBP payout verifies the configured bank despite incomplete account onboarding. Stripe validates each new payout. No real money moves.' : bankVerified ? 'Stripe sandbox connected; own GBP bank destination verified. No real money moves.' : 'Stripe test balance connected; the configured bank is validated by Stripe when the payout is submitted. No real money moves.';
    return { status: { configured: true, connected: true, mode: 'test', message }, balancePence, destination };
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
export async function createTestPayout(input: { amountPence: number; idempotencyKey: string; runId: string; destination?: string; invoiceIds: string[]; minimumReservePence?: number }): Promise<PayoutResult> {
  if (!Number.isSafeInteger(input.amountPence) || input.amountPence <= 0) throw new StripeIntegrationError('Payout amount must be a positive whole number of pence.');
  if (!/^[A-Za-z0-9_:-]{1,255}$/.test(input.idempotencyKey)) throw new StripeIntegrationError('A stable valid idempotency key is required.');
  if (!input.runId || input.runId.length > 500 || !input.invoiceIds.length || input.invoiceIds.join(',').length > 500) throw new StripeIntegrationError('A run ID and bounded invoice references are required.');
  const context = await verifiedContext(input.destination);
  if (context.balancePence < input.amountPence) throw new StripeIntegrationError('Insufficient available GBP Stripe balance. Pending balance cannot fund this payout.');
  const reserve=input.minimumReservePence ?? 0;
  if(!Number.isSafeInteger(reserve)||reserve<0||context.balancePence-input.amountPence<reserve) throw new StripeIntegrationError('The latest Stripe balance cannot cover this payout while preserving the required reserve.');
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
