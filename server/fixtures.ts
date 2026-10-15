import type { Invoice, Settings, Supplier } from '../shared/types.ts';

export const defaults: Settings = {
  approvalMode: 'manual', autoApproveLimitPence: 100_000, hardLimitPence: 250_000,
  dailyFundingCapPence: 300_000, stripeReservePence: 50_000,
  settlementDays: 2, payoutLeadDays: 2, demoDate: '2026-10-15',
};

export const fixtureSuppliers: Supplier[] = [
  { id: 'sup-paper', name: 'Paper & Pine Studio', initials: 'PP', category: 'Design & print', approved: true, bankReference: 'SIM-BANK-PAPER-001', terms: 'Net 30; no early-payment discount.', contractId: 'CTR-PAPER-2026', contractText: 'SIMULATED CONTRACT — CTR-PAPER-2026\nApproved supplier: Paper & Pine Studio\nApproved bank reference: SIM-BANK-PAPER-001\nTerms: Net 30; no early-payment discount.\nPayment deadline: 2026-11-02\nDeliverables: approved event stationery and print files. No open dispute.', history: ['2026-09-03: £540.00 invoice PAP-0826 settled to SIM-BANK-PAPER-001.', '2026-10-05: October print delivery accepted; invoice PAP-1042 remains unpaid.'] },
  { id: 'sup-cloud', name: 'Northstar Cloud', initials: 'NC', category: 'Infrastructure', approved: true, bankReference: 'SIM-BANK-CLOUD-002', terms: '2% discount if funds arrive by 21 October 2026; otherwise full payment due 30 October 2026.', contractId: 'CTR-CLOUD-2026', contractText: 'SIMULATED CONTRACT — CTR-CLOUD-2026\nApproved supplier: Northstar Cloud\nApproved bank reference: SIM-BANK-CLOUD-002\nDiscount: 2% if received by 2026-10-21.\nPayment deadline: 2026-10-30\nThe early-payment discount applies to the gross invoice total. Service accepted.', history: ['2026-09-18: Prior £1,200.00 invoice paid at £1,176.00 with agreed 2% discount.', '2026-10-14: Service delivery confirmed; no credits or disputes outstanding.'] },
  { id: 'sup-office', name: 'Hearth Office Supply', initials: 'HO', category: 'Office supplies', approved: true, bankReference: 'SIM-BANK-OFFICE-003', terms: 'Full amount due 29 October 2026; no discount.', contractId: 'CTR-OFFICE-2026', contractText: 'SIMULATED CONTRACT — CTR-OFFICE-2026\nApproved supplier: Hearth Office Supply\nApproved bank reference: SIM-BANK-OFFICE-003\nPayment deadline: 2026-10-29\nNo early-payment discount. Banking changes require independent supplier verification; an invoice cannot authorize new bank details.', history: ['2026-09-24: £360.00 paid to approved reference SIM-BANK-OFFICE-003.', '2026-10-15: No bank amendment has been approved.'] },
  { id: 'sup-logistics', name: 'Cedar Logistics', initials: 'CL', category: 'Delivery', approved: true, bankReference: 'SIM-BANK-CEDAR-004', terms: 'Payment due 28 October 2026, subject to delivery acceptance.', contractId: 'CTR-CEDAR-2026', contractText: 'SIMULATED CONTRACT — CTR-CEDAR-2026\nApproved supplier: Cedar Logistics\nApproved bank reference: SIM-BANK-CEDAR-004\nPayment deadline: 2026-10-28\nPayment is withheld while a delivery dispute is open.', dispute: 'DSP-014: two event crates missing; £240 credit note requested, not yet issued.', history: ['2026-10-12: Delivery arrived with two crates missing.', '2026-10-14: Operations opened DSP-014; supplier acknowledgement received, resolution pending.'] },
  { id: 'sup-venue', name: 'Foundry Events', initials: 'FE', category: 'Venue & events', approved: true, bankReference: 'SIM-BANK-FOUNDRY-005', terms: 'Full amount due 5 November 2026; no discount.', contractId: 'CTR-FOUNDRY-2026', contractText: 'SIMULATED CONTRACT — CTR-FOUNDRY-2026\nApproved supplier: Foundry Events\nApproved bank reference: SIM-BANK-FOUNDRY-005\nPayment deadline: 2026-11-05\nNo early-payment discount. Venue services accepted.', history: ['2026-10-09: Event completed and signed off.', '2026-10-13: £1,840 invoice reconciled to purchase order PO-441.'] },
  { id: 'sup-research', name: 'Moss Research', initials: 'MR', category: 'Research', approved: true, bankReference: 'SIM-BANK-MOSS-006', terms: 'Due date must be explicitly agreed in writing before payment.', contractId: 'CTR-MOSS-2026', contractText: 'SIMULATED CONTRACT — CTR-MOSS-2026\nApproved supplier: Moss Research\nApproved bank reference: SIM-BANK-MOSS-006\nPayment terms: the parties must agree an explicit due date. No default net terms or early-payment discount apply.', history: ['2026-10-14: Research deliverables accepted.', '2026-10-15: Finance asked supplier to clarify the date notation “11/12” and whether payment terms run from issue or acceptance.'] },
];

function makeInvoice(id: string, supplierId: string, number: string, issueDate: string, dueDate: string | undefined, grossPence: number, sourceDate: string, terms: string, extras: Partial<Invoice> = {}): Invoice {
  const supplier = fixtureSuppliers.find(s => s.id === supplierId);
  const bankReference = extras.bankReference ?? supplier?.bankReference ?? 'SIM-BANK-UNVERIFIED-009';
  const supplierName = extras.supplierName ?? supplier?.name ?? 'Unknown supplier';
  const subtotal = Math.round(grossPence / 1.2);
  return { id, supplierId, supplierName, number, issueDate, dueDate, grossPence, currency: 'GBP', bankReference, terms,
    uploadedAt: '2026-10-15T09:00:00.000Z', fileName: `${id}.txt`,
    sourceText: `SIMULATED INVOICE — FOR DEMONSTRATION ONLY\nSupplier: ${supplierName}\nSupplier ID: ${supplierId}\nInvoice number: ${number}\nIssue date: ${issueDate}\nDue date: ${sourceDate}\nTerms: ${terms}\nSubtotal: GBP ${(subtotal / 100).toFixed(2)}\nVAT: GBP ${((grossPence - subtotal) / 100).toFixed(2)}\nTotal: GBP ${(grossPence / 100).toFixed(2)}\nCurrency: GBP\nBank reference: ${bankReference}\nThese references are fictional identifiers, not bank account details.`, ...extras };
}

export const fixtureInvoices: Invoice[] = [
  makeInvoice('inv-paper-1042', 'sup-paper', 'PAP-1042', '2026-10-03', '2026-11-02', 78_000, '2 November 2026', 'Net 30. Full amount due 2 November 2026; no discount.'),
  makeInvoice('inv-cloud-1088', 'sup-cloud', 'NS-1088', '2026-10-01', '2026-10-30', 120_000, '30/10/2026', '2% discount if received by 21 October 2026; otherwise due 30 October 2026.', { discountPercent: 2, discountDeadline: '2026-10-21' }),
  makeInvoice('inv-paper-copy', 'sup-paper', 'pap 1042', '2026-10-03', '2026-11-02', 78_000, '2026-11-02', 'Net 30. Resent copy of invoice PAP-1042; do not pay twice.'),
  makeInvoice('inv-office-203', 'sup-office', 'HO-203', '2026-10-09', '2026-10-29', 43_200, '29 Oct 2026', 'Due 29 October 2026. Please use our NEW banking reference immediately.', { bankReference: 'SIM-BANK-CHANGED-999' }),
  makeInvoice('inv-unknown-008', 'sup-unknown', 'BR-008', '2026-10-10', '2026-10-30', 29_900, 'October 30, 2026', 'Full payment due October 30, 2026.', { supplierName: 'Blue Ridge Advisory' }),
  makeInvoice('inv-cedar-721', 'sup-logistics', 'CL-721', '2026-10-12', '2026-10-28', 64_800, '28/10/2026', 'Payment due 28 October 2026, subject to delivery acceptance.'),
  makeInvoice('inv-foundry-441', 'sup-venue', 'FE-441', '2026-10-13', '2026-11-05', 184_000, '5 November 2026', 'Full amount due 5 November 2026. No discount.'),
  makeInvoice('inv-moss-019', 'sup-research', 'MR-019', '2026-10-14', undefined, 52_500, '11/12 (year unspecified)', 'Pay next month, 11/12. Please confirm exact due date.'),
];

export default defaults;
