import type { AppState } from '../shared/types';

export function fundingPreview(state: AppState) {
  const eligible = state.run?.decisions.filter(d => d.status === 'eligible' && !state.invoices.find(i => i.id === d.invoiceId)?.reviewState && state.run!.approvedInvoiceIds.includes(d.invoiceId) && d.fundingDate && d.fundingDate <= state.settings.demoDate) || [];
  const requiredPence = eligible.reduce((sum, d) => sum + d.netPence, 0);
  const pendingPence = state.fundingAttempts.filter(a => a.status === 'pending' || a.status === 'unknown').reduce((sum,a) => sum + a.amountPence, 0);
  const bankAvailablePence = state.bankBalancePence;
  const shortfallPence = Math.max(0, requiredPence - bankAvailablePence - pendingPence);
  const committedPence = state.fundingAttempts.filter(a => a.status !== 'failed').reduce((sum,a) => sum + a.amountPence, 0);
  let reason = 'Ready to fund the authorised payment run.';
  if (!state.run || !eligible.length) reason = 'Approve eligible invoices whose funding date has arrived.';
  else if (state.run.policyVersion !== state.policyVersion) reason = 'Policy changed. Analyse and approve this run again.';
  else if (state.fundingAttempts.some(a => a.status === 'unknown')) reason = 'A payout has an unknown outcome. Reconcile it before requesting more funding.';
  else if (!shortfallPence) reason = pendingPence ? 'Existing funds and pending payouts cover this run. Reconcile pending payouts.' : 'The payments account already covers this run.';
  else if (!state.integrations.stripe.connected) reason = state.integrations.stripe.message;
  else if (shortfallPence + committedPence > state.settings.dailyFundingCapPence) reason = 'This funding request exceeds the policy cap for this demo day.';
  else if (state.stripeBalancePence - shortfallPence < state.settings.stripeReservePence) reason = 'Insufficient available Stripe balance after preserving the minimum reserve.';
  const canFund = reason === 'Ready to fund the authorised payment run.';
  return { requiredPence, bankAvailablePence, pendingPence, shortfallPence, invoiceIds: eligible.map(d=>d.invoiceId), canFund, reason };
}
export const csvCell = (value: unknown) => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
export function exportRun(state: AppState) {
  if (!state.run) throw new Error('Analyse invoices first.');
  const rows: unknown[][] = [['run_id','invoice_id','supplier','invoice_number','currency','gross','discount','payment_amount','funding_date','send_date','expected_arrival','payment_reference','policy_version','status']];
  for (const d of state.run.decisions) {
    if (d.status !== 'eligible' || !state.run.approvedInvoiceIds.includes(d.invoiceId)) continue;
    const invoice = state.invoices.find(i => i.id === d.invoiceId)!;
    if (!invoice || invoice.reviewState) continue;
    rows.push([state.run.id,invoice.id,invoice.supplierName,invoice.number,'GBP',(d.grossPence/100).toFixed(2),(d.discountPence/100).toFixed(2),(d.netPence/100).toFixed(2),d.fundingDate,d.sendDate,d.arrivalDate,invoice.number,state.run.policyVersion,'APPROVED_NOT_PAID']);
  }
  return '\uFEFF' + rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}
