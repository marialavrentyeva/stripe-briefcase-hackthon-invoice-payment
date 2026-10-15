import { test } from 'node:test';
import assert from 'node:assert/strict';
import {extraInvoices, extraSuppliers} from '../server/demo-expansion';
import {analyseInvoices} from '../server/domain';
import {defaults} from '../server/fixtures';
test('expanded calendar produces eligible payments across consecutive business days and preserves agreed discounts',()=>{
 const ds=analyseInvoices(extraInvoices,extraSuppliers,defaults);
 assert.ok(ds.every(d=>d.status==='eligible'));
 assert.equal(new Set(extraInvoices.map(i=>i.id)).size,extraInvoices.length);
 assert.equal(ds.reduce((n,d)=>n+d.discountPence,0),54000);
 const dates=[...new Set(ds.map(d=>d.sendDate))].sort();
 assert.equal(dates.length,14);assert.equal(dates[0],'2026-10-19');assert.equal(dates.at(-1),'2026-11-05');
 let balance=5029900;
 for(const date of dates){const before=balance;balance-=ds.filter(d=>d.sendDate===date).reduce((n,d)=>n+d.netPence,0);assert.ok(balance<before);}
 assert.ok(balance>0);
});
