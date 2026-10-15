import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addCalendarDays,normaliseInvoice} from '../server/extract';
import {fixtureInvoices,fixtureSuppliers} from '../server/fixtures';

test('relative calendar terms are computed in code with leap-year and date validation',()=>{
  assert.equal(addCalendarDays('2026-10-03',30),'2026-11-02');
  assert.equal(addCalendarDays('2028-02-28',2),'2028-03-01');
  assert.equal(addCalendarDays('2026-02-30',30),undefined);
  assert.equal(addCalendarDays('2026-10-03',-1),undefined);
  assert.equal(addCalendarDays('2026-10-03',null),undefined);
});
test('supplier ID is resolved from canonical name and cannot be supplied by an uploaded document',()=>{
  const input={...fixtureInvoices[0],supplierId:'sup-cloud',dueDate:null,netDays:30};
  const invoice=normaliseInvoice(input,fixtureSuppliers,'invoice.json','source');
  assert.equal(invoice.supplierId,'sup-paper');
  assert.equal(invoice.dueDate,'2026-11-02');
  const unknown=normaliseInvoice({...input,supplierName:'Unknown impersonator'},fixtureSuppliers,'invoice.json','source');
  assert.equal(unknown.supplierId,'unknown');
});
test('invalid fractional or missing monetary fields are rejected before planning',()=>{
  assert.throws(()=>normaliseInvoice({...fixtureInvoices[0],grossPence:1.5},fixtureSuppliers,'bad.json','source'));
  assert.throws(()=>normaliseInvoice({...fixtureInvoices[0],bankReference:null},fixtureSuppliers,'bad.json','source'));
});
