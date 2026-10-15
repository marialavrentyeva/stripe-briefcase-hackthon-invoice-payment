import type { Invoice, Supplier } from '../shared/types.ts';

// Fictional, agreed offers: the normal policy engine derives every saving and date.
export const extraSuppliers: Supplier[] = [
  {
    id: 'sup-lumen', name: 'Lumen Production', initials: 'LP', category: 'Event production',
    approved: true, bankReference: 'SIM-BANK-LUMEN-007',
    terms: '10% discount if received by 26 October 2026; otherwise due 5 November 2026.',
    contractId: 'CTR-LUMEN-2026',
    contractText: 'SIMULATED CONTRACT — CTR-LUMEN-2026\nApproved supplier: Lumen Production\nApproved bank reference: SIM-BANK-LUMEN-007\nDiscount: 10% if received by 2026-10-26.\nPayment deadline: 2026-11-05\nThe early-payment discount applies to the gross invoice total. Production services accepted. No open dispute.',
    history: ['2026-10-02: Event production delivered and accepted against PO-512.', '2026-10-05: £2,400.00 invoice LP-1052 received; agreed 10% early-payment offer confirmed. Invoice remains unpaid.'],
  },
  {
    id: 'sup-willow', name: 'Willow Catering', initials: 'WC', category: 'Catering',
    approved: true, bankReference: 'SIM-BANK-WILLOW-008',
    terms: '8% discount if received by 28 October 2026; otherwise due 10 November 2026.',
    contractId: 'CTR-WILLOW-2026',
    contractText: 'SIMULATED CONTRACT — CTR-WILLOW-2026\nApproved supplier: Willow Catering\nApproved bank reference: SIM-BANK-WILLOW-008\nDiscount: 8% if received by 2026-10-28.\nPayment deadline: 2026-11-10\nThe early-payment discount applies to the gross invoice total. Catering services accepted. No open dispute.',
    history: ['2026-10-07: Catering delivery accepted against PO-518.', '2026-10-08: £2,250.00 invoice WC-1086 reconciled; agreed 8% early-payment offer confirmed. Invoice remains unpaid.'],
  },
  {
    id: 'sup-atlas', name: 'Atlas Workshop', initials: 'AW', category: 'Exhibition fabrication',
    approved: true, bankReference: 'SIM-BANK-ATLAS-010',
    terms: '5% discount if received by 2 November 2026; otherwise due 12 November 2026.',
    contractId: 'CTR-ATLAS-2026',
    contractText: 'SIMULATED CONTRACT — CTR-ATLAS-2026\nApproved supplier: Atlas Workshop\nApproved bank reference: SIM-BANK-ATLAS-010\nDiscount: 5% if received by 2026-11-02.\nPayment deadline: 2026-11-12\nThe early-payment discount applies to the gross invoice total. Exhibition fabrication accepted. No open dispute.',
    history: ['2026-10-09: Exhibition fabrication delivered and accepted against PO-524.', '2026-10-12: £2,400.00 invoice AW-1124 reconciled; agreed 5% early-payment offer confirmed. Invoice remains unpaid.'],
  },
];

function agreedInvoice(supplier: Supplier, number: string, issueDate: string, dueDate: string, grossPence: number, discountPercent: number, discountDeadline: string, uploadedAt: string): Invoice {
  const id = `inv-${supplier.id.slice(4)}-${number.split('-')[1]}`;
  const subtotal = Math.round(grossPence / 1.2);
  return {
    id, supplierId: supplier.id, supplierName: supplier.name, number, issueDate, dueDate,
    terms: supplier.terms, grossPence, currency: 'GBP', discountPercent, discountDeadline,
    bankReference: supplier.bankReference, uploadedAt, fileName: `${id}.txt`,
    sourceText: `SIMULATED INVOICE — FOR DEMONSTRATION ONLY\nSupplier: ${supplier.name}\nSupplier ID: ${supplier.id}\nInvoice number: ${number}\nIssue date: ${issueDate}\nDue date: ${dueDate}\nTerms: ${supplier.terms}\nDiscount: ${discountPercent}% if received by ${discountDeadline}. Discount applies to the gross invoice total.\nSubtotal: GBP ${(subtotal / 100).toFixed(2)}\nVAT: GBP ${((grossPence - subtotal) / 100).toFixed(2)}\nTotal: GBP ${(grossPence / 100).toFixed(2)}\nCurrency: GBP\nBank reference: ${supplier.bankReference}\nThese references are fictional identifiers, not bank account details.`,
  };
}

export const extraInvoices: Invoice[] = [
  agreedInvoice(extraSuppliers[0], 'LP-1052', '2026-10-05', '2026-11-05', 240_000, 10, '2026-10-26', '2026-10-05T09:00:00.000Z'),
  agreedInvoice(extraSuppliers[1], 'WC-1086', '2026-10-08', '2026-11-10', 225_000, 8, '2026-10-28', '2026-10-08T09:00:00.000Z'),
  agreedInvoice(extraSuppliers[2], 'AW-1124', '2026-10-12', '2026-11-12', 240_000, 5, '2026-11-02', '2026-10-12T09:00:00.000Z'),
];

// A varied operating-payments calendar. Each deadline is two business days after
// the intended send date; the policy engine, rather than the chart, schedules it.
const calendarInvoices = [
  ['harbour','Harbour Printworks','HP','Print materials','2026-10-21',90000],
  ['juniper','Juniper IT Support','JI','IT support','2026-10-22',144000],
  ['oak','Oak Facilities','OF','Facilities','2026-10-23',108000],
  ['linen','Linen Hire Co','LH','Event linen','2026-10-26',60000],
  ['beacon','Beacon Security','BS','Event security','2026-10-27',174000],
  ['clover','Clover Cleaning','CC','Cleaning','2026-10-28',72000],
  ['relay','Relay Couriers','RC','Courier services','2026-10-29',156000],
  ['studio','Studio Audio','SA','Audio equipment','2026-10-30',132000],
  ['maple','Maple Furniture Hire','MF','Furniture hire','2026-11-03',168000],
  ['clear','Clear Window Services','CW','Maintenance','2026-11-04',96000],
  ['pixel','Pixel Design','PD','Design services','2026-11-05',84000],
  ['silver','Silver Stage Lighting','SL','Lighting hire','2026-11-06',192000],
  ['fern','Fern Plant Hire','FP','Venue styling','2026-11-09',114000],
] as const;
for (const [slug,name,initials,category,dueDate,grossPence] of calendarInvoices) {
  const supplier: Supplier = {
    id:`sup-${slug}`,name,initials,category,approved:true,bankReference:`SIM-BANK-${slug.toUpperCase()}-CAL`,
    terms:`Full payment due ${dueDate}; no early-payment discount.`,contractId:`CTR-${slug.toUpperCase()}-2026`,
    contractText:`SIMULATED CONTRACT — CTR-${slug.toUpperCase()}-2026\nApproved supplier: ${name}\nApproved bank reference: SIM-BANK-${slug.toUpperCase()}-CAL\nPayment deadline: ${dueDate}\nNo early-payment discount. Services delivered and accepted. No open dispute.`,
    history:[`2026-10-08: ${category} delivered and approved. Invoice matched to purchase order; no disputes.`, '2026-10-12: Invoice received; approved bank reference independently checked.'],
  };
  const invoice=agreedInvoice(supplier,`${initials}-2001`,'2026-10-08',dueDate,grossPence,0,dueDate,'2026-10-12T09:00:00.000Z');
  delete invoice.discountPercent;delete invoice.discountDeadline;
  invoice.sourceText=invoice.sourceText.replace(/Discount: 0%[^\n]*\n/,'');
  extraSuppliers.push(supplier);extraInvoices.push(invoice);
}
