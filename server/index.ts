import dotenv from 'dotenv';
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppState, FundingAttempt, Settings } from '../shared/types';
import { archiveRun, createRun, initialState, policyVersion, readStore, withLock, writeStore, type StoredState } from './store';
import { analyseInvoices } from './domain';
import { createTestPayout, getStripeStatus, getStripeDestinations, retrieveTestPayout, StripeIntegrationError } from './stripe';
import { getCogneeStatus, searchCognee, seedCognee } from './cognee';
import { fundingPreview, exportRun } from './funding';
import { extractInvoice, normaliseInvoice } from './extract';

const envPath=process.env.BRIEFCASE_ENV_FILE || '.env';
dotenv.config({path:envPath,override:true});
const app = express();
app.use(express.json({limit:'2mb'}));
app.use('/api', (req,res,next) => {
  const origin = req.headers.origin;
  if (origin && !['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:3001','http://localhost:3001'].includes(origin)) { res.status(403).json({error:'Only the local Briefcase dashboard may access this API.'}); return; }
  res.setHeader('Cache-Control','no-store');
  dotenv.config({path:envPath,override:true});
  next();
});
const route = (fn:(req:Request,res:Response)=>Promise<unknown>) => (req:Request,res:Response,next:NextFunction) => { Promise.resolve(fn(req,res)).catch(next); };
const publicState = (s:StoredState):AppState => { const {runHistory,memorySyncPending,...state} = s; return state; };

async function refreshIntegrations(s:StoredState) {
  const [stripe,cognee] = await Promise.all([getStripeStatus(),getCogneeStatus()]);
  s.integrations.stripe = stripe.status.configured ? stripe.status : {configured:false,connected:false,mode:'demo',message:'Sample Stripe balance. Configure the sandbox key and own bank destination to request funding.'};
  s.stripeBalancePence = stripe.status.configured ? stripe.balancePence : 1250000;
  s.integrations.cognee = cognee.configured ? cognee : {configured:false,connected:false,mode:'demo',message:'Using local demo source documents. Cognee Cloud is not connected.'};
  s.integrations.llm = process.env.OPENAI_API_KEY ? {configured:true,connected:false,mode:'cloud',message:'OpenAI key configured. Connection is verified when an invoice is extracted.'} : {configured:false,connected:false,mode:'demo',message:'Structured fixtures work without a key. Configure OpenAI for new invoice text.'};
}
async function attachMemory(s:StoredState) {
  if (!s.run || !process.env.COGNEE_API_KEY) return;
  const cache = new Map<string,Awaited<ReturnType<typeof searchCognee>>>();
  for (const decision of s.run.decisions) {
    const invoice = s.invoices.find(i=>i.id===decision.invoiceId)!;
    const supplier = s.suppliers.find(x=>x.id===invoice.supplierId);
    if (!supplier) continue;
    try {
      if (!cache.has(supplier.id)) cache.set(supplier.id, await searchCognee(`${supplier.name} ${supplier.id} ${supplier.contractId} payment terms approved bank reference disputes active policy ${s.policyVersion}`));
      const evidence = cache.get(supplier.id)!;
      // A retrieval without the supplier's actual identity is not corroborating evidence.
      const matches = evidence.filter(e=>e.excerpt.includes(supplier.id) || e.excerpt.toLowerCase().includes(supplier.name.toLowerCase()) || e.excerpt.includes(supplier.contractId));
      if (!matches.length) throw new Error('No matching supplier source was retrieved from Cognee. Seed the demo memory and wait for processing.');
      decision.evidence.push(...matches);
      decision.checks.push({label:'Cognee memory',passed:true,detail:`Retrieved ${matches.length} matching source chunks.`});
      s.integrations.cognee = {configured:true,connected:true,mode:'cloud',message:'Supplier evidence retrieved from Cognee Cloud.'};
    } catch (error) {
      decision.status = decision.status === 'blocked' ? 'blocked' : 'review';
      decision.reason = error instanceof Error ? error.message : 'Memory could not be verified.';
      decision.checks.push({label:'Cognee memory',passed:false,detail:decision.reason});
      s.run.approvedInvoiceIds = s.run.approvedInvoiceIds.filter(id=>id!==decision.invoiceId);
    }
  }
}
function invalidate(s:StoredState) { archiveRun(s); s.policyVersion=policyVersion(s.settings); s.run=createRun(s); }
function fundingActive(s:StoredState) { return s.fundingAttempts.some(x=>x.status==='pending'||x.status==='unknown'); }

app.get('/api/health',(_req,res)=>res.json({ok:true,app:'Briefcase',mode:'local'}));
app.get('/api/state',route(async(_req,res)=>withLock(async()=>{ const s=readStore(); await refreshIntegrations(s); writeStore(s); res.json(publicState(s)); })));
app.get('/api/funding-preview',route(async(_req,res)=>{res.json(fundingPreview(readStore()));}));
app.get('/api/stripe/destinations',route(async(_req,res)=>{res.json(await getStripeDestinations());}));
app.post('/api/analyse',route(async(_req,res)=>withLock(async()=>{
  const s=readStore(); if(fundingActive(s)) throw new Error('Reconcile pending funding before changing this run.');
  await refreshIntegrations(s); invalidate(s); await attachMemory(s); writeStore(s); res.json(publicState(s));
})));
app.patch('/api/settings',route(async(req,res)=>withLock(async()=>{
  const s=readStore(); if(fundingActive(s)) throw new Error('Reconcile pending funding before changing the policy.');
  const numeric:(keyof Settings)[]=['autoApproveLimitPence','hardLimitPence','dailyFundingCapPence','stripeReservePence','settlementDays','payoutLeadDays'];
  const updates:Partial<Settings>={};
  for (const key of Object.keys(req.body)) {
    const value=req.body[key];
    if (numeric.includes(key as keyof Settings)) {
      if(!Number.isSafeInteger(value)||value<0||value>100000000) throw new Error(`Invalid ${key}.`);
      if((key==='settlementDays'||key==='payoutLeadDays') && value>10) throw new Error('Lead times must be between 0 and 10 business days.');
      Object.assign(updates,{[key]:value});
    } else if(key==='approvalMode' && ['manual','automatic'].includes(value)) updates.approvalMode=value;
    else if(key==='demoDate' && typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value))) {
      if(s.fundingAttempts.length && value!==s.settings.demoDate) throw new Error('The demo clock is locked after a funding attempt to preserve its budget ledger.');
      updates.demoDate=value;
    } else throw new Error(`Unsupported setting: ${key}.`);
  }
  const next={...s.settings,...updates}; if(next.autoApproveLimitPence>next.hardLimitPence) throw new Error('The automatic limit cannot exceed the hard invoice limit.');
  s.settings=next; invalidate(s); await attachMemory(s); writeStore(s); res.json(publicState(s));
})));
app.post('/api/approve',route(async(req,res)=>withLock(async()=>{
  const s=readStore(); if(!s.run) throw new Error('Analyse invoices first.');
  if(req.body.runId!==s.run.id || req.body.revision!==s.run.revision) throw new Error('This run changed. Refresh and review its current amounts and policy before approving.');
  if(fundingActive(s)) throw new Error('Reconcile pending funding before changing approvals.');
  const requested=req.body.invoiceIds ?? s.run.decisions.filter(d=>d.status==='eligible').map(d=>d.invoiceId);
  if(!Array.isArray(requested)||requested.some(id=>typeof id!=='string')) throw new Error('Select valid invoice IDs.');
  for(const id of requested) if(!s.run.decisions.some(d=>d.invoiceId===id&&d.status==='eligible')) throw new Error('Held or blocked invoices cannot be approved.');
  s.run.approvedInvoiceIds=[...new Set([...s.run.approvedInvoiceIds,...requested])]; s.run.approvedAt=new Date().toISOString(); s.run.status='approved';
  writeStore(s); res.json(publicState(s));
})));
app.post('/api/invoices',route(async(req,res)=>withLock(async()=>{
  const s=readStore(); if(fundingActive(s)) throw new Error('Reconcile pending funding before uploading more invoices.');
  const files=req.body.files;
  if(!Array.isArray(files)||!files.length||files.length>20) throw new Error('Upload 1–20 text or JSON files.');
  const imported=[];
  for(const file of files) {
    if(typeof file.name!=='string'||typeof file.text!=='string'||file.text.length>100000) throw new Error('Each file must contain at most 100 KB of invoice text.');
    if(file.name.toLowerCase().endsWith('.json')) {
      const parsed=JSON.parse(file.text); const items=Array.isArray(parsed)?parsed:Array.isArray(parsed.invoices)?parsed.invoices:[parsed];
      if(items.length>30) throw new Error('A batch may contain at most 30 invoices.');
      for(const item of items) imported.push(normaliseInvoice(item,s.suppliers,file.name,typeof item.sourceText==='string'?item.sourceText:JSON.stringify(item,null,2)));
    } else {
      imported.push(await extractInvoice(file.text,file.name,s.suppliers));
      s.integrations.llm={configured:true,connected:true,mode:'cloud',message:'Invoice extracted with OpenAI structured output.'};
    }
  }
  s.invoices.push(...imported); invalidate(s); await attachMemory(s); writeStore(s); res.json(publicState(s));
})));
app.get('/api/export',route(async(_req,res)=>{
  const s=readStore(); if(!s.run?.approvedInvoiceIds.length) throw new Error('Approve at least one eligible invoice before exporting.');
  res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition',`attachment; filename="briefcase-${s.run.id}.csv"`);res.send(exportRun(s));
}));
app.post('/api/fund',route(async(req,res)=>withLock(async()=>{
  const s=readStore(); if(!s.run||req.body.runId!==s.run.id) throw new Error('This run changed. Refresh and review it before funding.');
  await refreshIntegrations(s);
  const fresh=analyseInvoices(s.invoices,s.suppliers,s.settings);
  for(const d of s.run.decisions.filter(d=>s.run!.approvedInvoiceIds.includes(d.invoiceId))) {
    const check=fresh.find(c=>c.invoiceId===d.invoiceId);
    if(!check||check.status!=='eligible'||check.netPence!==d.netPence||check.fundingDate!==d.fundingDate) throw new Error('Invoice evidence changed. Analyse and approve the run again.');
  }
  await attachMemory(s);
  const preview=fundingPreview(s); if(!preview.canFund) { writeStore(s); throw new Error(preview.reason); }
  const attempt:FundingAttempt={id:`fund_${randomUUID()}`,runId:s.run.id,amountPence:preview.shortfallPence,currency:'gbp',status:'unknown',createdAt:new Date().toISOString(),idempotencyKey:`briefcase_${randomUUID()}`,invoiceIds:preview.invoiceIds,policyVersion:s.policyVersion,destination:process.env.STRIPE_PAYOUT_DESTINATION,evidence:`F01–F04: £${(preview.requiredPence/100).toFixed(2)} approved obligations requiring funding by ${s.settings.demoDate}, less £${(preview.bankAvailablePence/100).toFixed(2)} simulated payments-account balance and £${(preview.pendingPence/100).toFixed(2)} pending funding. Preserve £${(s.settings.stripeReservePence/100).toFixed(2)} in Stripe. Own approved GBP bank destination only. Supplier invoices remain unpaid.`};
  s.fundingAttempts.push(attempt); s.run.status='funding'; archiveRun(s); writeStore(s);
  try {
    const result=await createTestPayout({amountPence:attempt.amountPence,idempotencyKey:attempt.idempotencyKey,runId:attempt.runId,destination:attempt.destination,invoiceIds:attempt.invoiceIds});
    Object.assign(attempt,result); if(result.status==='paid') s.bankBalancePence+=result.amountPence;
    s.run.status=result.status==='paid'?'funded':result.status==='failed'?'approved':'funding';
    s.stripeBalancePence-=result.status==='failed'?0:result.amountPence;
  } catch(error) {
    attempt.status=error instanceof StripeIntegrationError && !error.uncertain?'failed':'unknown';
    attempt.error=error instanceof Error?error.message:'Funding outcome unknown; reconcile before retrying.';
    if(attempt.status==='failed') s.run.status='approved';
  }
  writeStore(s); res.json(publicState(s));
})));
app.post('/api/reconcile',route(async(_req,res)=>withLock(async()=>{
  const s=readStore();
  for(const attempt of s.fundingAttempts.filter(a=>a.status==='pending'||a.status==='unknown')) {
    if(!attempt.stripePayoutId) { attempt.error='No payout ID was received. Check the Stripe request logs using the saved idempotency key; automatic resubmission is disabled.'; continue; }
    const result=await retrieveTestPayout(attempt.stripePayoutId);
    if(result.amountPence!==attempt.amountPence) throw new Error('Payout amount mismatch. Manual reconciliation is required.');
    Object.assign(attempt,result); if(result.status==='paid') s.bankBalancePence+=result.amountPence;
  }
  if(s.run) s.run.status=fundingActive(s)?'funding':fundingPreview(s).shortfallPence===0?'funded':'approved';
  await refreshIntegrations(s); writeStore(s); res.json(publicState(s));
})));
app.post('/api/memory/seed',route(async(_req,res)=>withLock(async()=>{
  const s=readStore(); const policy=fs.existsSync('docs/POLICY.md')?fs.readFileSync('docs/POLICY.md','utf8'):'Briefcase policy v1';
  const result=await seedCognee([{id:s.policyVersion,text:`Active policy ${s.policyVersion}\n${policy}\nActual current settings: ${JSON.stringify(s.settings)}`},...s.suppliers.map(x=>({id:x.contractId,text:`Supplier ID: ${x.id}\n${x.contractText}\nHistory:\n${x.history.join('\n')}\nOpen dispute: ${x.dispute||'None'}`}))]);
  res.json({...result,message:'Sources submitted. Wait for Cognee processing to finish, then analyse the batch again.'});
})));
app.post('/api/reset',route(async(_req,res)=>withLock(async()=>{
  const old=readStore(); if(old.fundingAttempts.length) throw new Error('Reset is disabled after a funding attempt so the payout ledger cannot be lost.');
  const s=initialState(); await refreshIntegrations(s); writeStore(s); res.json(publicState(s));
})));
app.get('/api/audit',route(async(_req,res)=>{const s=readStore();res.json({policyVersion:s.policyVersion,runs:[...s.runHistory,...(s.run?[s.run]:[])],fundingAttempts:s.fundingAttempts});}));
app.use(express.static(path.resolve('dist')));
app.get('*',(_req,res)=> { const index=path.resolve('dist/index.html'); fs.existsSync(index)?res.sendFile(index):res.status(404).send('Start the Vite dashboard at http://127.0.0.1:5173'); });
app.use((error:Error,_req:Request,res:Response,_next:NextFunction)=>{res.status(400).json({error:error.message || 'The request could not be completed.'});});
const port=Number(process.env.PORT||3001);
app.listen(port,'127.0.0.1',()=>console.log(`Briefcase API: http://127.0.0.1:${port}`));
