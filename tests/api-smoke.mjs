import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const dir=mkdtempSync(join(tmpdir(),'briefcase-api-'));
const envFile=join(dir,'empty.env');
writeFileSync(envFile,'STRIPE_SECRET_KEY=\nSTRIPE_PAYOUT_DESTINATION=\nCOGNEE_API_KEY=\nOPENAI_API_KEY=\n');
const port=3009, url=`http://127.0.0.1:${port}`;
let child;
async function start(){
  child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:String(port),DATA_DIR:dir,BRIEFCASE_ENV_FILE:envFile},stdio:['ignore','pipe','pipe']});
  for(let i=0;i<50;i++) {
    try{if((await fetch(`${url}/api/health`)).ok)return;}catch{}
    if(child.exitCode!==null) throw new Error('Smoke test API did not start.');
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('Smoke test API timed out.');
}
async function stop(){if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}}
async function request(path,method='GET',body){ const r=await fetch(`${url}${path}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()}; }
try {
  await start();
  let {data:s}=await request('/api/state');
  assert.equal(s.invoices.length,8);assert.equal(s.run.approvedInvoiceIds.length,0);
  assert.equal((await request('/api/reconcile','POST',{})).data.run.status,'draft');
  assert.equal((await request('/api/approve','POST',{})).status,400);
  const oldRun=s.run;
  s=(await request('/api/analyse','POST',{})).data;
  assert.equal((await request('/api/approve','POST',{runId:oldRun.id,revision:oldRun.revision})).status,400);
  assert.equal((await request('/api/approve','POST',{runId:s.run.id,revision:s.run.revision,invoiceIds:['inv-office-203']})).status,400);
  s=(await request('/api/approve','POST',{runId:s.run.id,revision:s.run.revision})).data;
  assert.equal(s.run.approvedInvoiceIds.length,3);
  const preview=(await request('/api/funding-preview')).data;
  assert.equal(preview.shortfallPence,87600); assert.equal(preview.canFund,false);
  const staleFunding=await request('/api/fund','POST',{runId:s.run.id,expectedAmountPence:1});
  assert.equal(staleFunding.status,400); assert.match(staleFunding.data.error,/Funding amount changed/);
  const csv=await(await fetch(`${url}/api/export`)).text();
  assert.ok(csv.includes('1176.00'));assert.ok(!csv.includes('HO-203'));assert.ok(csv.includes('APPROVED_NOT_PAID'));
  assert.equal((await request('/api/fund','POST',{runId:s.run.id})).status,400);
  assert.equal((await request('/api/state')).data.fundingAttempts.length,0);
  await stop();await start();
  s=(await request('/api/state')).data;assert.equal(s.run.approvedInvoiceIds.length,3);
  s=(await request('/api/settings','PATCH',{approvalMode:'automatic'})).data;
  assert.deepEqual(s.run.approvedInvoiceIds,['inv-paper-1042']);
  const review=async(id,action,extra={})=>request(`/api/invoices/${id}/review`,'POST',{runId:s.run.id,revision:s.run.revision,action,note:'Checked source documents',...extra});
  assert.equal((await review(s.invoices[0].id,'hold',{note:''})).status,400);
  assert.equal((await review(s.invoices[0].id,'hold',{revision:0})).status,400);
  assert.equal((await review(s.invoices[0].id,'exclude')).status,400);
  s=(await review(s.invoices[0].id,'hold')).data;
  assert.equal(s.invoices[0].reviewState,'held'); assert.equal(s.run.decisions[0].status,'blocked');
  assert.deepEqual(s.run.approvedInvoiceIds,[]);
  s=(await request('/api/analyse','POST',{})).data;assert.equal(s.run.decisions[0].status,'blocked');
  s=(await review(s.invoices[0].id,'restore')).data;assert.equal(s.run.decisions[0].status,'eligible');
  s=(await review(s.invoices[2].id,'exclude')).data;assert.equal(s.invoices[2].reviewState,'excluded');
  s=(await request('/api/approve','POST',{runId:s.run.id,revision:s.run.revision})).data;
  const reviewedCsv=await(await fetch(`${url}/api/export`)).text();assert.ok(!reviewedCsv.includes(s.invoices[2].id));
  const originalSource=s.invoices[0].sourceText;
  assert.equal((await review(s.invoices[0].id,'correct_terms',{dueDate:'2026-02-30'})).status,400);
  s=(await review(s.invoices[0].id,'correct_terms',{dueDate:'2026-11-03'})).data;
  assert.equal(s.run.decisions[0].status,'review');assert.equal(s.invoices[0].sourceText,originalSource);
  const audit=(await request('/api/audit')).data; assert.equal(audit.invoiceReviews.length,2);
  await stop();await start();s=(await request('/api/state')).data;
  assert.equal(s.invoices[2].reviewState,'excluded');assert.equal(s.invoices[0].reviewHistory.length,3);
  const saved=JSON.parse(readFileSync(join(dir,'state.json'),'utf8'));assert.equal(saved.memoryOutbox.filter(d=>d.id.startsWith('review_')).length,4);
  s=(await request('/api/demo/prepare-recording','POST',{})).data;
  assert.equal(s.invoices.some(i=>i.id==='inv-office-203'),false);
  assert.equal(s.invoices.find(i=>i.id==='inv-paper-copy').reviewState,undefined);
  const preparedRun=s.run.id;
  assert.equal((await request('/api/demo/prepare-recording','POST',{})).data.run.id,preparedRun);
  const preparedStore=JSON.parse(readFileSync(join(dir,'state.json'),'utf8'));
  assert.equal(preparedStore.demoArchivedInvoices.length,4);
  const origin=await fetch(`${url}/api/analyse`,{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'});assert.equal(origin.status,403);
  console.log('API smoke passed: stale approvals, blocked rows, shortfall, CSV, disabled unconfigured funding, restart persistence, settings invalidation, invoice review persistence, audit, memory outbox and origin checks.');
}finally{await stop();}
