import fs from 'node:fs';
import path from 'node:path';
import type { AppState, PaymentRun } from '../shared/types';
import { fixtureInvoices, fixtureSuppliers, defaults as defaultSettings } from './fixtures';
import { analyseInvoices } from './domain';
import { createHash, randomUUID } from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || '.data');
const storePath = path.join(DATA_DIR, 'state.json');
export type StoredState = AppState & { demoPrepared?: boolean; demoArchivedInvoices?: AppState['invoices']; runHistory: PaymentRun[]; memoryOutbox: {id:string;text:string}[]; memorySyncPending?: string[] };
export const policyVersion = (settings: AppState['settings']) => `v1-${createHash('sha256').update(JSON.stringify(settings)).update(fs.existsSync('docs/POLICY.md') ? fs.readFileSync('docs/POLICY.md','utf8') : 'policy-v1').digest('hex').slice(0, 8)}`;
export function createRun(state: AppState): PaymentRun {
  const decisions = analyseInvoices(state.invoices, state.suppliers, state.settings);
  const approvedInvoiceIds = decisions.filter(d => d.status === 'eligible' && !d.requiresApproval).map(d => d.invoiceId);
  return { id: `run_${randomUUID().slice(0, 8)}`, revision: (state.run?.revision || 0) + 1, createdAt: new Date().toISOString(), policyVersion: policyVersion(state.settings), decisions, approvedInvoiceIds, approvalMode: state.settings.approvalMode, status: approvedInvoiceIds.length ? 'approved' : 'draft' };
}
export function initialState(): StoredState {
  const state: StoredState = {
    suppliers: structuredClone(fixtureSuppliers), invoices: structuredClone(fixtureInvoices), settings: { ...defaultSettings },
    run: null, runHistory: [], memoryOutbox: [], fundingAttempts: [], bankBalancePence: 30000, stripeBalancePence: 1250000,
    policyVersion: policyVersion(defaultSettings),
    integrations: {
      stripe: {configured:false, connected:false, mode:'demo', message:'Sample balance. Add a Stripe sandbox key and payout destination to fund a run.'},
      cognee: {configured:false, connected:false, mode:'demo', message:'Local source documents. Cognee Cloud is not connected.'},
      llm: {configured:false, connected:false, mode:'demo', message:'Demo invoice fixtures. Add an OpenAI API key to read new invoice text.'}
    }
  };
  state.run = createRun(state);
  return state;
}
export function readStore(): StoredState {
  if (!fs.existsSync(storePath)) { const state = initialState(); writeStore(state); return state; }
  const state=JSON.parse(fs.readFileSync(storePath, 'utf8'));
  state.memoryOutbox ??= [];
  return state;
}
export function writeStore(state: StoredState) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const temp = `${storePath}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(state, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, storePath);
}
let queue = Promise.resolve();
export async function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await fn(); } finally { release(); }
}
export function archiveRun(state: StoredState) {
  if (state.run) state.runHistory.push(structuredClone(state.run));
}
