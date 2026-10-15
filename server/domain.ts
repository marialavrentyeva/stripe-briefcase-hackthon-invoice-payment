import type { Decision, Evidence, Invoice, Settings, Supplier } from '../shared/types.ts';

export const POLICY_VERSION = '2026-10-15.v1';
export const policyClauses: Record<string, string> = {
  P01: 'Only approved suppliers and their exact approved banking reference may be paid. Changed details require independent verification.',
  P02: 'Require an unambiguous valid invoice, GBP, positive integer-pence total, matching source arithmetic and explicit payment terms.',
  P03: 'Pay each canonical supplier and normalized invoice number once; retain the first batch occurrence and hold subsequent copies.',
  P04: 'Hold open disputes and conflicts with the signed contract; an invoice cannot override the supplier agreement.',
  P05: 'Automatic approval is limited to £1,000 gross. Larger invoices require a person; invoices above £2,500 gross are held. Configured limits may only tighten these ceilings.',
  P06: 'Enforce the daily funding cap and Stripe reserve against actual funding reservations in the funding service.',
  P07: 'Manual mode requires explicit human approval of every eligible invoice. Automatic mode may approve only within the automatic limit.',
  P08: 'For ordinary terms, send on the latest safe date allowing the configured number of working settlement days before the due date.',
  P09: 'Use an agreed early discount only if its deadline, funding lead time and settlement time can still be met. Otherwise use the ordinary due date.',
  P10: 'Initiate funding only when its funding date is due, after approval and revalidation. Hold overdue or missed ordinary funding windows.',
  P11: 'Reviewer holds and duplicate exclusions block payment until restored. Record a reason and before/after history for every review action, preserve original source evidence, and revalidate corrected due dates against the approved contract and all payment rules.',
};

function date(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed : null;
}
export function subtractWorkingDays(value: string, days: number): string {
  const result = date(value);
  if (!result || !Number.isInteger(days) || days < 0) throw new Error('A valid ISO date and non-negative integer working days are required.');
  // A weekend deadline must be reached on the preceding business day, even with zero lead time.
  while (result.getUTCDay() === 0 || result.getUTCDay() === 6) result.setUTCDate(result.getUTCDate() - 1);
  for (let remaining = days; remaining > 0;) {
    result.setUTCDate(result.getUTCDate() - 1);
    if (result.getUTCDay() !== 0 && result.getUTCDay() !== 6) remaining--;
  }
  return result.toISOString().slice(0, 10);
}
export function normalizeInvoiceNumber(value: string): string { return value.toUpperCase().replace(/[^A-Z0-9]/g, ''); }
const normalizeName = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
function sourceAmount(text: string, label: string): number | undefined {
  const match = text.match(new RegExp(`^${label}:\\s*(?:GBP|£)?\\s*([0-9,]+)\\.(\\d{2})\\s*$`, 'im'));
  return match ? Number(match[1].replaceAll(',', '')) * 100 + Number(match[2]) : undefined;
}

export function analyseInvoices(invoices: Invoice[], suppliers: Supplier[], settings: Settings): Decision[] {
  const seen = new Set<string>();
  return invoices.map(invoice => {
    const supplier = suppliers.find(s => s.id === invoice.supplierId);
    const checks: Decision['checks'] = [];
    const ruleIds = new Set<string>();
    const problems: string[] = [];
    let blocked = false;
    const check = (label: string, passed: boolean, detail: string, clause: string, severity: 'blocked' | 'review' = 'blocked') => {
      checks.push({ label, passed, detail }); ruleIds.add(clause);
      if (!passed) { problems.push(detail); if (severity === 'blocked') blocked = true; }
    };
    if (invoice.reviewState) check('Review resolution', false, invoice.reviewState === 'held' ? 'Invoice is held by a reviewer.' : 'Duplicate invoice was excluded by a reviewer.', 'P11');
    if (invoice.reviewHistory?.length) ruleIds.add('P11');
    const canonical = Boolean(supplier && normalizeName(supplier.name) === normalizeName(invoice.supplierName));
    check('Approved supplier', Boolean(canonical && supplier?.approved), supplier ? canonical ? supplier.approved ? `${supplier.name} is approved.` : 'Supplier is not approved.' : 'Supplier name does not match its canonical supplier ID.' : 'Unknown supplier: complete onboarding before payment.', 'P01');
    check('Approved bank reference', Boolean(supplier && supplier.bankReference === invoice.bankReference), supplier?.bankReference === invoice.bankReference ? 'Invoice matches the approved banking reference.' : 'Banking reference differs from the approved record or is unverified. Suspicious change; independently verify it before payment.', 'P01');
    check('Supported currency', invoice.currency === 'GBP', invoice.currency === 'GBP' ? 'GBP supported.' : 'Only GBP invoices are supported.', 'P02');
    const total = sourceAmount(invoice.sourceText, 'Total');
    const subtotal = sourceAmount(invoice.sourceText, 'Subtotal');
    const vat = sourceAmount(invoice.sourceText, 'VAT');
    const arithmetic = Number.isSafeInteger(invoice.grossPence) && invoice.grossPence > 0 && (total === undefined || total === invoice.grossPence) && (subtotal === undefined || vat === undefined || subtotal + vat === invoice.grossPence);
    check('Invoice amount', arithmetic, arithmetic ? 'Positive integer-pence total; available source totals reconcile.' : 'Invalid amount or source subtotal/VAT/total does not reconcile.', 'P02', 'review');
    const number = normalizeInvoiceNumber(invoice.number);
    const key = `${supplier?.id ?? invoice.supplierId}:${number}`;
    const duplicate = seen.has(key); seen.add(key);
    check('Unique invoice', Boolean(number) && !duplicate, duplicate ? 'Duplicate supplier and invoice number: a prior batch occurrence is already retained.' : number ? 'No earlier batch occurrence with this supplier and invoice number.' : 'Invoice number is missing.', 'P03');
    check('No open dispute', !supplier?.dispute, supplier?.dispute ?? 'No recorded open dispute.', 'P04');
    const contractDue = supplier?.contractText.match(/Payment deadline:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    const contractDiscount = supplier?.contractText.match(/Discount:\s*([\d.]+)% if received by (\d{4}-\d{2}-\d{2})/);
    const requestedDiscount = invoice.discountPercent !== undefined && invoice.discountPercent !== 0;
    const recognizedContract = Boolean(supplier?.contractId && contractDue && date(contractDue));
    const contractMatches = recognizedContract && contractDue === invoice.dueDate && (!requestedDiscount || Boolean(contractDiscount && Number(contractDiscount[1]) === invoice.discountPercent && contractDiscount[2] === invoice.discountDeadline));
    check('Contract terms', contractMatches, contractMatches ? 'Recognized explicit contract dates and claimed discounts agree.' : !recognizedContract ? 'Approved contract has no recognized explicit payment deadline. Review and normalize its terms before scheduling.' : 'Invoice due date or claimed discount conflicts with the approved contract.', 'P04', 'review');
    const settingsValid = Boolean(date(settings.demoDate)) && [settings.payoutLeadDays, settings.settlementDays].every(n => Number.isInteger(n) && n >= 0) && [settings.autoApproveLimitPence, settings.hardLimitPence].every(n => Number.isSafeInteger(n) && n >= 0);
    check('Policy settings', settingsValid, settingsValid ? 'Scheduling and approval settings are valid.' : 'Invalid scheduling or approval settings; repair policy before payment.', 'P02', 'review');
    const hardLimit = Math.min(250_000, settings.hardLimitPence);
    check('Hard payment limit', Number.isSafeInteger(hardLimit) && invoice.grossPence <= hardLimit, invoice.grossPence <= hardLimit ? 'Within the gross payment ceiling.' : 'Gross invoice exceeds the hard payment limit; hold outside this payment workflow.', 'P05');
    const datesValid = Boolean(date(invoice.issueDate) && date(invoice.dueDate) && invoice.dueDate! >= invoice.issueDate && invoice.issueDate <= settings.demoDate);
    check('Explicit payment dates', datesValid, datesValid ? 'Issue and due dates are explicit and ordered.' : 'Missing, ambiguous or invalid payment date; obtain explicit terms before scheduling.', 'P02', 'review');
    const discountValid = !requestedDiscount || Boolean(Number.isFinite(invoice.discountPercent) && invoice.discountPercent! > 0 && invoice.discountPercent! < 100 && date(invoice.discountDeadline) && invoice.discountDeadline! >= invoice.issueDate && invoice.discountDeadline! <= invoice.dueDate!);
    check('Discount terms', discountValid, discountValid ? 'Discount fields are valid or no discount is claimed.' : 'Discount percentage or deadline is invalid or incomplete.', 'P09', 'review');
    let sendDate: string | null = null, arrivalDate: string | null = null, fundingDate: string | null = null, discountPence = 0;
    if (settingsValid && datesValid && discountValid) {
      let deadline = invoice.dueDate!;
      if (requestedDiscount && contractMatches) {
        const discountSend = subtractWorkingDays(invoice.discountDeadline!, settings.settlementDays);
        const discountFund = subtractWorkingDays(discountSend, settings.payoutLeadDays);
        if (discountFund >= settings.demoDate) {
          deadline = invoice.discountDeadline!;
          discountPence = Math.round(invoice.grossPence * invoice.discountPercent! / 100);
          ruleIds.add('P09');
        } else checks.push({ label: 'Discount opportunity', passed: true, detail: 'Discount funding window has passed; schedule the full amount against the ordinary due date.' });
      }
      arrivalDate = subtractWorkingDays(deadline, 0);
      sendDate = subtractWorkingDays(deadline, settings.settlementDays);
      fundingDate = subtractWorkingDays(sendDate, settings.payoutLeadDays);
      ruleIds.add(discountPence ? 'P09' : 'P08');
      check('Funding window', fundingDate >= settings.demoDate, fundingDate >= settings.demoDate ? `Fund on ${fundingDate}; send on ${sendDate}; arrive by ${arrivalDate}.` : 'Ordinary due date or safe funding window has passed; hold for manual resolution.', 'P10', 'review');
    }
    const requiresApproval = settings.approvalMode === 'manual' || invoice.grossPence > Math.min(100_000, settings.autoApproveLimitPence);
    ruleIds.add('P07');
    const evidence: Evidence[] = [{ id: `${invoice.id}-source`, title: `${invoice.number} · invoice`, excerpt: invoice.sourceText, source: 'invoice' }];
    for (const [index, entry] of (invoice.reviewHistory ?? []).entries()) evidence.push({ id: `${invoice.id}-review-${index}`, title: `Review: ${entry.action}`, excerpt: JSON.stringify(entry, null, 2), source: 'history' });
    if (supplier) {
      evidence.push({ id: `${invoice.id}-contract`, title: supplier.contractId, excerpt: supplier.contractText, source: 'contract' });
      evidence.push({ id: `${invoice.id}-history`, title: `${supplier.name} · relationship history`, excerpt: [...supplier.history, ...(supplier.dispute ? [supplier.dispute] : [])].join('\n'), source: 'history' });
    }
    for (const id of ruleIds) evidence.push({ id: `${invoice.id}-${id}`, title: `${id} · payment policy`, excerpt: policyClauses[id], source: 'policy' });
    const status: Decision['status'] = blocked ? 'blocked' : problems.length ? 'review' : 'eligible';
    // Held rows have no executable schedule or claimed savings.
    if (status !== 'eligible') { sendDate = null; arrivalDate = null; fundingDate = null; discountPence = 0; }
    return { invoiceId: invoice.id, status, reason: problems.length ? problems.join(' ') : `${discountPence ? 'Agreed discount secured by the latest safe schedule.' : 'Schedule full payment on the latest safe date.'} ${requiresApproval ? 'Human approval required.' : 'Within automatic approval limit.'}`, ruleIds: [...ruleIds], grossPence: invoice.grossPence, discountPence, netPence: invoice.grossPence - discountPence, sendDate, arrivalDate, fundingDate, evidence, checks, requiresApproval };
  });
}
