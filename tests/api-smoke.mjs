import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
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
  const csv=await(await fetch(`${url}/api/export`)).text();
  assert.ok(csv.includes('1176.00'));assert.ok(!csv.includes('HO-203'));assert.ok(csv.includes('APPROVED_NOT_PAID'));
  assert.equal((await request('/api/fund','POST',{runId:s.run.id})).status,400);
  assert.equal((await request('/api/state')).data.fundingAttempts.length,0);
  await stop();await start();
  s=(await request('/api/state')).data;assert.equal(s.run.approvedInvoiceIds.length,3);
  s=(await request('/api/settings','PATCH',{approvalMode:'automatic'})).data;
  assert.deepEqual(s.run.approvedInvoiceIds,['inv-paper-1042']);
  const origin=await fetch(`${url}/api/analyse`,{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'});assert.equal(origin.status,403);
  console.log('API smoke passed: stale approvals, blocked rows, shortfall, CSV, disabled unconfigured funding, restart persistence, settings invalidation and origin checks.');
}finally{await stop();}
