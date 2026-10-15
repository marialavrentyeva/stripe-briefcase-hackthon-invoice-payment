import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../server/store';
import { estimateInterest } from '../shared/interest';
test('interest uses eligible net amounts and calendar days from ingestion to scheduled send',()=>{
 const s=initialState();const result=estimateInterest(s);
 assert.equal(result.items.length,3);
 const cloud=result.items.find(i=>i.invoiceId==='inv-cloud-1088')!;
 assert.equal(cloud.days,4);assert.equal(cloud.principalPence,117600);
 assert.equal(cloud.interestPence,117600*0.03*4/365);
 s.invoices.find(i=>i.id===cloud.invoiceId)!.reviewState='held';
 assert.equal(estimateInterest(s).items.length,2);
});
test('interest does not accrue when ingestion follows planned send',()=>{
 const s=initialState();s.invoices.forEach(i=>i.uploadedAt='2027-01-01T00:00:00Z');
 assert.equal(estimateInterest(s).totalPence,0);
});
