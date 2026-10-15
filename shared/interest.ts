import type { AppState } from './types';
// Simple interest estimate, ACT/365, using whole calendar days from ingestion to send.
export function estimateInterest(state: AppState, annualRate = 0.03) {
  const items = (state.run?.decisions || []).filter(d => d.status === 'eligible' && d.sendDate).flatMap(d => {
    const invoice = state.invoices.find(i => i.id === d.invoiceId);
    if (!invoice || invoice.reviewState) return [];
    const received = Date.parse(invoice.uploadedAt.slice(0,10)+'T00:00:00Z');
    const send = Date.parse(d.sendDate!+'T00:00:00Z');
    if (!Number.isFinite(received) || !Number.isFinite(send)) return [];
    const days = Math.max(0, Math.round((send-received)/86400000));
    return [{invoiceId:invoice.id,days,principalPence:d.netPence,interestPence:d.netPence*annualRate*days/365}];
  });
  return {annualRate,items,totalPence:Math.round(items.reduce((n,i)=>n+i.interestPence,0))};
}
