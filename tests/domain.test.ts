import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseInvoices, subtractWorkingDays } from '../server/domain.ts';
import { defaults, fixtureInvoices, fixtureSuppliers } from '../server/fixtures.ts';
import type { Invoice, Settings, Supplier } from '../shared/types.ts';

function decide(patch: Partial<Invoice> = {}, settings: Partial<Settings> = {}, suppliers: Supplier[] = fixtureSuppliers) {
  return analyseInvoices([{ ...fixtureInvoices[0], ...patch }], suppliers, { ...defaults, ...settings })[0];
}
test('demo batch isolates a duplicate, changed bank, unknown supplier and dispute', () => {
  const decisions = analyseInvoices(fixtureInvoices, fixtureSuppliers, defaults);
  assert.deepEqual(decisions.map(d => d.status), ['eligible', 'eligible', 'blocked', 'blocked', 'blocked', 'blocked', 'eligible', 'review']);
  assert.match(decisions[2].reason, /Duplicate/);
  assert.match(decisions[3].reason, /Suspicious change/);
  assert.match(decisions[4].reason, /Unknown supplier/);
  assert.match(decisions[5].reason, /DSP-014/);
  for (const d of decisions.filter(d => d.status !== 'eligible')) assert.equal(d.fundingDate, null);
});
test('agreed 2% discount has deterministic penny math and two working-day legs', () => {
  const d = analyseInvoices([fixtureInvoices[1]], fixtureSuppliers, defaults)[0];
  assert.equal(d.grossPence, 120000);
  assert.equal(d.discountPence, 2400);
  assert.equal(d.netPence, 117600);
  assert.equal(d.fundingDate, '2026-10-15');
  assert.equal(d.sendDate, '2026-10-19');
  assert.equal(d.arrivalDate, '2026-10-21');
  assert.ok(d.evidence.some(e => e.source === 'contract'));
  assert.ok(d.ruleIds.includes('P09'));
});
test('ordinary invoice keeps cash until latest safe send and funding dates', () => {
  const d = decide();
  assert.equal(d.fundingDate, '2026-10-27');
  assert.equal(d.sendDate, '2026-10-29');
  assert.equal(d.arrivalDate, '2026-11-02');
  assert.equal(d.netPence, 78000);
});
test('working-day subtraction crosses weekends and normalizes weekend deadlines', () => {
  assert.equal(subtractWorkingDays('2026-10-19', 2), '2026-10-15');
  assert.equal(subtractWorkingDays('2026-10-18', 0), '2026-10-16');
  assert.equal(subtractWorkingDays('2026-10-18', 2), '2026-10-14');
  assert.throws(() => subtractWorkingDays('2026-02-30', 1));
  assert.throws(() => subtractWorkingDays('2026-10-19', -1));
});
test('missed discount funding window falls back to ordinary full payment', () => {
  const d = analyseInvoices([fixtureInvoices[1]], fixtureSuppliers, { ...defaults, demoDate: '2026-10-16' })[0];
  assert.equal(d.status, 'eligible');
  assert.equal(d.discountPence, 0);
  assert.equal(d.netPence, 120000);
  assert.equal(d.arrivalDate, '2026-10-30');
  assert.equal(d.fundingDate, '2026-10-26');
});
test('expired discount also falls back to full payment if ordinary window remains', () => {
  const d = analyseInvoices([fixtureInvoices[1]], fixtureSuppliers, { ...defaults, demoDate: '2026-10-22' })[0];
  assert.equal(d.status, 'eligible');
  assert.equal(d.discountPence, 0);
});
test('overdue and missed ordinary funding windows require review', () => {
  assert.equal(decide({}, { demoDate: '2026-11-03' }).status, 'review');
  assert.equal(decide({}, { demoDate: '2026-10-28' }).status, 'review');
});
test('ambiguous, impossible and future issue dates never acquire executable schedules', () => {
  for (const patch of [{ dueDate: undefined }, { dueDate: '11/12' }, { dueDate: '2026-02-30' }, { issueDate: '2026-10-16' }]) {
    const d = decide(patch);
    assert.equal(d.status, 'review'); assert.equal(d.sendDate, null);
  }
});
test('manual mode and gross automatic limit control approval independently of eligibility', () => {
  assert.equal(decide().requiresApproval, true);
  assert.equal(decide({}, { approvalMode: 'automatic' }).requiresApproval, false);
  const large = analyseInvoices([fixtureInvoices[6]], fixtureSuppliers, { ...defaults, approvalMode: 'automatic', autoApproveLimitPence: 250000 })[0];
  assert.equal(large.status, 'eligible'); assert.equal(large.requiresApproval, true);
});
test('hard ceiling cannot be increased above £2500 through settings', () => {
  const d = decide({ grossPence: 250001, sourceText: 'Total: GBP 2500.01' }, { hardLimitPence: 999999 });
  assert.equal(d.status, 'blocked'); assert.ok(d.ruleIds.includes('P05'));
});
test('canonical supplier identity, bank, approval and currency are enforced', () => {
  assert.equal(decide({ supplierName: 'Impersonator Ltd' }).status, 'blocked');
  assert.equal(decide({ bankReference: 'SIM-BANK-OTHER' }).status, 'blocked');
  assert.equal(decide({ currency: 'USD' }).status, 'blocked');
  assert.equal(decide({}, {}, fixtureSuppliers.map(s => ({ ...s, approved: false }))).status, 'blocked');
});
test('source arithmetic and positive whole pence are validated', () => {
  for (const grossPence of [0, -100, 78000.5, NaN]) assert.notEqual(decide({ grossPence }).status, 'eligible');
  assert.equal(decide({ sourceText: 'Subtotal: GBP 600.00\nVAT: GBP 120.00\nTotal: GBP 780.00' }).status, 'review');
  assert.equal(decide({ sourceText: 'Total: GBP 781.00' }).status, 'review');
});
test('contract due date and invented discounts are held for review', () => {
  assert.equal(decide({ dueDate: '2026-11-03' }).status, 'review');
  assert.equal(decide({ discountPercent: 5, discountDeadline: '2026-10-25' }).status, 'review');
});
test('unrecognized or missing contract terms fail closed even when invoice dates are valid', () => {
  for (const contractText of ['', 'Payment is due on November 2, 2026.', 'Payment deadline: 2026-02-30']) {
    const suppliers = fixtureSuppliers.map(s => s.id === 'sup-paper' ? { ...s, contractText } : s);
    const d = decide({}, {}, suppliers);
    assert.equal(d.status, 'review');
    assert.equal(d.fundingDate, null);
    assert.match(d.reason, /no recognized explicit payment deadline/);
  }
});
test('normalized duplicate number is supplier-specific and retains first occurrence', () => {
  const [first, duplicate] = analyseInvoices([fixtureInvoices[0], { ...fixtureInvoices[0], id: 'copy', number: ' pap / 1042 ' }], fixtureSuppliers, defaults);
  assert.equal(first.status, 'eligible'); assert.equal(duplicate.status, 'blocked');
});
test('invalid settings cannot create a schedule', () => {
  assert.equal(decide({}, { settlementDays: -1 }).status, 'review');
  assert.equal(decide({}, { demoDate: 'tomorrow' }).status, 'review');
});
