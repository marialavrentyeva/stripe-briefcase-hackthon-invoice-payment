import { useState } from 'react';
import { ArrowRight, Check, CircleAlert, LoaderCircle } from 'lucide-react';
import type { Decision, Invoice } from '../shared/types';

type Props = { invoice: Invoice; decision: Decision; busy: boolean; error: string; onSubmit: (body: Record<string, unknown>) => Promise<boolean | undefined>; onNext?: () => void };
export default function ReviewActions({ invoice, decision, busy, error, onSubmit, onNext }: Props) {
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState(invoice.dueDate || '');
  const [saved, setSaved] = useState('');
  const failures = decision.checks.filter(c => !c.passed);
  const duplicate = failures.some(c => c.label === 'Unique invoice');
  const dates = failures.some(c => ['Explicit payment dates', 'Contract terms', 'Funding window'].includes(c.label));
  const bank = failures.some(c => c.label === 'Approved bank reference');
  const supplier = failures.some(c => c.label === 'Approved supplier');
  const held = invoice.reviewState === 'held';
  const excluded = invoice.reviewState === 'excluded';
  const instruction = duplicate ? 'Compare this copy with the original. Exclude the duplicate to retain it in the audit trail without paying it.' : bank ? 'Verify bank details with a known supplier contact outside this invoice. Keep this invoice on hold until the approved supplier record and evidence agree.' : supplier ? 'Obtain and verify the supplier’s contract and bank details. Keep the invoice on hold while supplier onboarding is completed.' : dates ? 'Obtain an explicit due date from the supplier or contract. Record the confirmed date and supporting evidence below; all policy checks will run again.' : 'Record what is needed to resolve the failed checks. Keep this invoice on hold until the supporting records have been corrected.';
  async function submit(action: string) {
    const ok = await onSubmit({ action, note, ...(action === 'correct_terms' ? { dueDate } : {}) });
    if (ok) { setSaved(action === 'correct_terms' ? 'Date correction saved and checks rerun. See the updated outcome below.' : action === 'restore' ? 'Returned to review and checks rerun.' : action === 'exclude' ? 'Duplicate excluded from payment. Audit history retained.' : 'Moved to On hold. This invoice cannot be paid.'); setNote(''); }
  }
  return <section className="review-resolution" aria-label="Resolve invoice review">
    <h3><CircleAlert size={17} />{held ? 'Invoice on hold' : excluded ? 'Duplicate excluded' : decision.status === 'eligible' ? 'Checks passed' : 'Action needed'}</h3>
    {saved && <p className="resolution-success" role="status"><Check size={15} />{saved}</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    {decision.status !== 'eligible' && <><ul className="review-failures">{failures.map(c => <li key={c.label}><strong>{c.label}</strong><span>{c.detail}</span></li>)}</ul><p>{held || excluded ? 'Your decision is saved. Restore the invoice to run checks again; restoring does not approve payment.' : instruction}</p>
    <label>Review note / supporting evidence<textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Record what you checked, the evidence reference, or what you are waiting for." maxLength={2000} required /></label>
    {!held && !excluded && dates && <label>Confirmed due date<input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} required /></label>}
    <p className="review-impact">Saving reruns validation and clears previous run approvals. Original invoice text is preserved.</p>
    <div className="resolution-buttons">{held || excluded ? <button className="button primary" disabled={busy || !note.trim()} onClick={() => submit('restore')}>Restore to review</button> : <>
    {duplicate && <button className="button primary" disabled={busy || !note.trim()} onClick={() => submit('exclude')}>Exclude duplicate</button>}
    {dates && <button className="button primary" disabled={busy || !note.trim() || !dueDate} onClick={() => submit('correct_terms')}>Save date & recheck</button>}
    <button className={`button ${!duplicate && !dates ? 'primary' : 'secondary'}`} disabled={busy || !note.trim()} onClick={() => submit('hold')}>Keep on hold</button>
    </>}{busy && <LoaderCircle size={17} className="spin" />}</div></>}
    {onNext && <button className="button secondary full next-review" disabled={busy} onClick={onNext}>Next invoice needing attention<ArrowRight size={15} /></button>}
  </section>;
}
