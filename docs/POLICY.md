# Payment policy — 2026-10-15.v1

This is a simulated GBP accounts-payable workflow. All amounts are stored as integer pence. The demo clock is **15 October 2026**. The policy is deterministic; model output never determines arithmetic, eligibility, approval or execution timing.

| Clause | Rule |
| --- | --- |
| P01 | Match the canonical approved supplier ID and name, and the exact approved bank reference. An invoice cannot authorize a change of bank details. Hold unknown suppliers or changed banking references for independent verification. A mismatch is suspicious, not proof of fraud. |
| P02 | Require GBP, a positive integer-pence total, reconciled available subtotal/VAT/total evidence, a nonempty invoice number, and explicit valid issue and due dates. Ambiguous dates require clarification. |
| P03 | Compare canonical supplier ID plus an uppercase invoice number stripped of spaces and punctuation. Retain the first occurrence in the batch; block subsequent copies. Previously funded invoices must also be excluded by the service ledger. |
| P04 | Hold any supplier with an open dispute. Explicit invoice dates and claimed discounts must agree with the recorded signed contract. |
| P05 | Automatic approval ceiling: **£1,000 gross**, before discount. Hard payment ceiling: **£2,500 gross**. Settings may tighten either ceiling. Above the automatic ceiling, human approval is required; above the hard ceiling, hold the invoice outside this workflow. |
| P06 | Funding service enforces the daily funding cap (**£3,000 default**) and Stripe reserve (**£500 default**) against the amount actually being funded. Pending, unknown and successful payout reservations count; a retry must not spend the same funds twice. |
| P07 | Manual approval mode requires explicit approval for every eligible invoice. Automatic mode can approve eligible invoices within the gross automatic limit. Approval never overrides a blocked or review decision. |
| P08 | Ordinary terms: choose the latest safe send date, subtracting settlement working days from the due date. Subtract payout lead working days from send date to obtain funding date. |
| P09 | Use a contract-backed discount when its funding date has not passed. Round the discount once to the nearest penny; net = gross − discount. If its funding window has passed, use full payment against the ordinary due date when still feasible. |
| P10 | Execute funding only when its funding date is due, with approval and policy revalidation. Hold invoices whose ordinary due date or safe funding window has passed. |

## Calendar and scope

Default settlement time is two working days and default payout lead time is two working days. Working days are Monday–Friday in a deterministic UTC date-only calendar. Weekend deadlines move to the preceding Friday before subtracting lead days. Public holidays, bank cut-off times and bank-specific settlement exceptions are not modelled; production rollout requires a banking calendar and provider settlement guarantees.

The engine treats canonical ISO dates as already normalized extraction output. Human-facing evidence intentionally contains ISO dates, named-month dates and unambiguous UK dates. The Moss Research invoice has “11/12” with no year; it must remain unresolved rather than guessed.

Contracts must contain a reviewed canonical `Payment deadline: YYYY-MM-DD` line; discounted contracts additionally need `Discount: N% if received by YYYY-MM-DD`. Arbitrary contract prose is held for review until its terms are normalized into these approved fields. Missing or unrecognized contract terms never count as agreement with the invoice.

`eligible` means all policy checks passed. `requiresApproval` records whether a person must approve before funding. `review` means a date, amount, source or contract issue needs correction; `blocked` means an explicit supplier, banking, duplicate, dispute or hard-limit prohibition. Held rows have no executable schedule or claimed savings. Approvals are bound to the run revision by the service; edits require reanalysis and new approval.

## Worked discount example

Northstar Cloud NS-1088 has **£1,200.00 gross** and an agreed 2% discount if funds arrive by **Wednesday 21 October 2026**. The discount is **£24.00** and net payment **£1,176.00**. Latest safe send is **Monday 19 October**; funding is due **Thursday 15 October**, allowing two working days for each leg. It needs human approval because its gross amount exceeds £1,000. If first analysed on 16 October, its discount funding window has passed: schedule £1,200.00 for arrival on 30 October instead.

Paper & Pine PAP-1042 has no discount and is due 2 November. Fund on 27 October, send on 29 October, arrive by 2 November. Its resent copy is held. Foundry FE-441 is £1,840 and requires a person. Hearth has an unverified bank change; Blue Ridge is unknown; Cedar has dispute DSP-014; Moss lacks a usable due date.

## Evidence and execution boundary

Every decision links the invoice text, the matched supplier contract, relationship history and each applied numbered policy clause. The engine schedules instructions; it does not send a supplier bank transfer. A Stripe payout moves funds to the configured business bank destination. The bank-export fixture is explicitly simulated and contains fictional banking references only.
