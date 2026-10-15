import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppState, FundingAttempt } from '../shared/types.ts';
import { createRun, initialState } from '../server/store.ts';
import { csvCell, exportRun, fundingPreview } from '../server/funding.ts';

function approvedState(): AppState {
  const state = initialState();
  state.integrations.stripe = { configured: true, connected: true, mode: 'test', message: 'Sandbox ready.' };
  state.run!.approvedInvoiceIds = state.run!.decisions.filter(d => d.status === 'eligible').map(d => d.invoiceId);
  state.run!.status = 'approved';
  return state;
}
function attempt(state: AppState, status: FundingAttempt['status'], amountPence: number): FundingAttempt {
  return { id: 'fund-test', runId: state.run!.id, amountPence, currency: 'gbp', status, createdAt: '2026-10-15T09:10:00Z', idempotencyKey: 'test-idempotency', invoiceIds: ['inv-cloud-1088'], policyVersion: state.policyVersion, evidence: 'Simulated funding test.' };
}

test('funding requires approval and includes only invoices whose funding date has arrived', () => {
  const state = approvedState();
  const preview = fundingPreview(state);
  assert.deepEqual(preview.invoiceIds, ['inv-cloud-1088']);
  assert.equal(preview.requiredPence, 117600);
  assert.equal(preview.shortfallPence, 87600);
  assert.equal(preview.canFund, true);
  state.run!.approvedInvoiceIds = [];
  assert.equal(fundingPreview(state).canFund, false);
  assert.equal(fundingPreview(state).requiredPence, 0);
});
test('only actual shortfall is requested and excess bank balance does not create negative funding', () => {
  const state = approvedState();
  state.bankBalancePence = 100000;
  assert.equal(fundingPreview(state).shortfallPence, 17600);
  state.bankBalancePence = 200000;
  assert.equal(fundingPreview(state).shortfallPence, 0);
  assert.equal(fundingPreview(state).canFund, false);
});
test('pending payout reservations prevent duplicate funding of the same obligation', () => {
  const state = approvedState();
  state.fundingAttempts.push(attempt(state, 'pending', 87600));
  const preview = fundingPreview(state);
  assert.equal(preview.pendingPence, 87600);
  assert.equal(preview.shortfallPence, 0);
  assert.equal(preview.canFund, false);
  assert.match(preview.reason, /pending payouts/);
});
test('paid payout credited once to bank prevents repeat funding, including after reanalysis', () => {
  const state = approvedState();
  state.fundingAttempts.push(attempt(state, 'paid', 87600));
  state.bankBalancePence += 87600;
  assert.equal(fundingPreview(state).canFund, false);
  state.run = createRun(state);
  state.run.approvedInvoiceIds = state.run.decisions.filter(d => d.status === 'eligible').map(d => d.invoiceId);
  assert.equal(fundingPreview(state).shortfallPence, 0);
  assert.equal(fundingPreview(state).canFund, false);
});
test('unknown outcome blocks new payout even when it does not cover the shortfall', () => {
  const state = approvedState();
  state.fundingAttempts.push(attempt(state, 'unknown', 100));
  const preview = fundingPreview(state);
  assert.equal(preview.shortfallPence, 87500);
  assert.equal(preview.canFund, false);
  assert.match(preview.reason, /unknown outcome/);
});
test('funding cap counts prior successful commitments and permits the exact boundary', () => {
  const state = approvedState();
  state.fundingAttempts.push(attempt(state, 'paid', 20000));
  state.settings.dailyFundingCapPence = 107599;
  assert.equal(fundingPreview(state).canFund, false);
  assert.match(fundingPreview(state).reason, /policy cap/);
  state.settings.dailyFundingCapPence = 107600;
  assert.equal(fundingPreview(state).canFund, true);
});
test('failed payouts release cap reservation without creating pending money', () => {
  const state = approvedState();
  state.fundingAttempts.push(attempt(state, 'failed', 300000));
  state.settings.dailyFundingCapPence = 87600;
  const preview = fundingPreview(state);
  assert.equal(preview.pendingPence, 0);
  assert.equal(preview.canFund, true);
});
test('Stripe reserve is preserved and exact reserve boundary is allowed', () => {
  const state = approvedState();
  state.stripeBalancePence = 137599;
  assert.equal(fundingPreview(state).canFund, false);
  assert.match(fundingPreview(state).reason, /minimum reserve/);
  state.stripeBalancePence = 137600;
  assert.equal(fundingPreview(state).canFund, true);
});
test('stale policy and unavailable Stripe both prevent funding', () => {
  const state = approvedState();
  state.policyVersion = 'changed-policy';
  assert.equal(fundingPreview(state).canFund, false);
  assert.match(fundingPreview(state).reason, /Policy changed/);
  state.policyVersion = state.run!.policyVersion;
  state.integrations.stripe.connected = false;
  state.integrations.stripe.message = 'No verified sandbox destination.';
  assert.equal(fundingPreview(state).canFund, false);
  assert.equal(fundingPreview(state).reason, 'No verified sandbox destination.');
});
test('export contains only approved eligible instructions and clearly states not paid', () => {
  const state = approvedState();
  state.run!.approvedInvoiceIds = ['inv-cloud-1088', 'inv-paper-copy', 'inv-office-203', 'inv-moss-019'];
  const output = exportRun(state);
  assert.ok(output.startsWith('\uFEFF'));
  assert.equal(output.split('\r\n').length, 2);
  assert.match(output, /inv-cloud-1088/);
  assert.match(output, /1176\.00/);
  assert.match(output, /APPROVED_NOT_PAID/);
  assert.doesNotMatch(output, /inv-paper-copy|inv-office-203|inv-moss-019/);
  state.run = null;
  assert.throws(() => exportRun(state), /Analyse invoices/);
});
test('CSV output quotes values and neutralizes common spreadsheet formula prefixes', () => {
  for (const value of ['=HYPERLINK("bad")', '+SUM(1,2)', '-1+1', '@SUM(1,2)', '\t=1+1', '\r=1+1']) {
    assert.ok(csvCell(value).startsWith('"\''), `unsafe prefix in ${JSON.stringify(value)}`);
  }
  assert.equal(csvCell('Quoted "name", Ltd'), '"Quoted ""name"", Ltd"');
  const state = approvedState();
  state.invoices.find(i => i.id === 'inv-cloud-1088')!.number = '=1+1';
  assert.ok(exportRun(state).includes('"\'=1+1"'));
});
