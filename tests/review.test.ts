import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, createRun } from '../server/store';
import { resolveInvoiceReview } from '../server/review';
import { fundingPreview, exportRun } from '../server/funding';
import type { FundingAttempt } from '../shared/types';
const apply = (s: ReturnType<typeof initialState>, id: string, action: string, extra = {}) => resolveInvoiceReview(s, id, {runId:s.run!.id,revision:s.run!.revision,action,note:'Reviewed source evidence',...extra});
test('hold survives recomputation and stale cached approvals cannot fund or export it', () => {
  const s=initialState(), id=s.invoices[1].id;
  s.run!.approvedInvoiceIds=[id];
  apply(s,id,'hold');
  assert.deepEqual(fundingPreview(s).invoiceIds,[]);
  assert.ok(!exportRun(s).includes(id));
  s.run=createRun(s);
  const d=s.run.decisions.find(d=>d.invoiceId===id)!;
  assert.equal(d.status,'blocked'); assert.equal(d.fundingDate,null);
  assert.ok(d.evidence.some(e=>e.source==='history'&&e.title==='Review: hold'));
  apply(s,id,'restore'); s.run=createRun(s);
  assert.equal(s.run.decisions.find(d=>d.invoiceId===id)!.status,'eligible');
});
test('exclusion requires a detected duplicate and restore does not bypass duplicate checks', () => {
  const s=initialState();
  assert.throws(()=>apply(s,s.invoices[0].id,'exclude'),/detected duplicate/);
  const id=s.invoices[2].id;
  apply(s,id,'exclude'); s.run=createRun(s);
  assert.equal(s.invoices[2].reviewState,'excluded');
  assert.equal(s.run.decisions[2].status,'blocked');
  apply(s,id,'restore'); s.run=createRun(s);
  assert.equal(s.run.decisions[2].status,'blocked');
});
test('due date corrections retain original evidence and cannot override contracts', () => {
  const s=initialState(), invoice=s.invoices[0], original=invoice.sourceText;
  for (const dueDate of ['2026-02-30','2026-1-01','2020-01-01']) assert.throws(()=>apply(s,invoice.id,'correct_terms',{dueDate}),/date/);
  apply(s,invoice.id,'correct_terms',{dueDate:'2026-11-03'});
  assert.equal(invoice.sourceText,original);
  assert.deepEqual(invoice.reviewHistory![0].before,{dueDate:'2026-11-02',reviewState:null});
  s.run=createRun(s); assert.equal(s.run.decisions[0].status,'review');
  apply(s,invoice.id,'correct_terms',{dueDate:'2026-11-02'});
  s.run=createRun(s); assert.equal(s.run.decisions[0].status,'eligible');
});
test('review rejects stale run, missing notes, unknown invoice and funding commitments without mutation', () => {
  const s=initialState(), id=s.invoices[0].id;
  assert.throws(()=>apply(s,id,'hold',{runId:'old'}),/run changed/);
  assert.throws(()=>apply(s,id,'hold',{note:' '}),/note/);
  assert.throws(()=>apply(s,'missing','hold'),/not found/);
  for (const status of ['pending','unknown','paid'] as const) {
    s.fundingAttempts=[{status,invoiceIds:[id]} as FundingAttempt];
    assert.throws(()=>apply(s,id,'hold'),/funding/);
  }
  s.fundingAttempts=[{status:'pending',invoiceIds:['different']} as FundingAttempt];
  assert.throws(()=>apply(s,id,'hold'),/pending/);
  assert.equal(s.invoices[0].reviewHistory,undefined);
  s.fundingAttempts=[{status:'failed',invoiceIds:[id]} as FundingAttempt];
  apply(s,id,'hold'); assert.equal(s.invoices[0].reviewState,'held');
});
test('correcting Moss due date still requires an explicit approved contract deadline', () => {
  const s=initialState();
  apply(s,'inv-moss-019','correct_terms',{dueDate:'2026-11-12'});
  s.run=createRun(s);
  const decision=s.run.decisions.find(d=>d.invoiceId==='inv-moss-019')!;
  assert.equal(decision.status,'review');
  assert.match(decision.reason,/no recognized explicit payment deadline/);
  assert.equal(decision.fundingDate,null);
});
