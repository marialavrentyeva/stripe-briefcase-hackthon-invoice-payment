import type { AppState, ReviewHistoryEntry } from '../shared/types';
import { analyseInvoices } from './domain';

export function resolveInvoiceReview(state: AppState, invoiceId: string, input: Record<string, unknown>): ReviewHistoryEntry {
  if (!state.run || input.runId !== state.run.id || input.revision !== state.run.revision) throw new Error('This run changed. Refresh and review it before resolving an invoice.');
  if (state.fundingAttempts.some(a => a.status === 'pending' || a.status === 'unknown')) throw new Error('Reconcile pending funding before resolving invoices.');
  const invoice = state.invoices.find(i => i.id === invoiceId);
  if (!invoice) throw new Error('Invoice not found.');
  if (state.fundingAttempts.some(a => a.status !== 'failed' && a.invoiceIds.includes(invoiceId))) throw new Error('This invoice has a funding commitment and cannot be edited.');
  const { action, note, dueDate } = input;
  if (typeof note !== 'string' || !note.trim() || note.trim().length > 2000) throw new Error('A review note of 1–2000 characters is required.');
  if (!['hold', 'exclude', 'restore', 'correct_terms'].includes(String(action))) throw new Error('Unsupported review action.');
  const before = { dueDate: invoice.dueDate ?? null, reviewState: invoice.reviewState ?? null };
  if (action === 'exclude') {
    const decision = analyseInvoices(state.invoices, state.suppliers, state.settings).find(d => d.invoiceId === invoiceId)!;
    if (!decision.checks.some(c => c.label === 'Unique invoice' && !c.passed && c.detail.startsWith('Duplicate'))) throw new Error('Only a detected duplicate invoice may be excluded.');
    invoice.reviewState = 'excluded';
  } else if (action === 'hold') invoice.reviewState = 'held';
  else if (action === 'restore') delete invoice.reviewState;
  else {
    if (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('Provide a valid ISO due date.');
    const parsed = new Date(`${dueDate}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dueDate || dueDate < invoice.issueDate) throw new Error('Due date must be valid and on or after the issue date.');
    invoice.dueDate = dueDate;
  }
  const entry: ReviewHistoryEntry = { action: String(action), note: note.trim(), createdAt: new Date().toISOString(), before, after: { dueDate: invoice.dueDate ?? null, reviewState: invoice.reviewState ?? null } };
  (invoice.reviewHistory ??= []).push(entry);
  return entry;
}
