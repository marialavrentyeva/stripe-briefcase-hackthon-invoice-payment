# Two-minute recording flow

Prepared scenario: 20 invoices, 19 eligible payments, one duplicate PAP-1042. Other exception examples are retained in the local demo archive. Existing Stripe receipt and bank balances are preserved.

1. Home (0:00–0:20): show the forecast and £564 discounts. “Briefcase schedules invoices for their latest safe payment dates, keeping cash available longer and capturing agreed discounts.”
2. Open agent (0:20–0:40): “The plan uses supplier contracts and history in Cognee.” Show the plan, optionally ask “Why pay Northstar early?” then return to Plan.
3. Remove duplicate (0:40–0:55): click Remove duplicate from run, then Remove from run. The original stays scheduled; the copy and review history remain in the audit trail.
4. Approve plan (0:55–1:15): click Review approvals, then Approve plan. This approves eligible scheduled invoices without paying them.
5. Funding (1:15–1:40): show the actual preview before confirming. With the prepared state, Northstar £1,176 plus Harbour £900 need funding today; £1,176 is already in the simulated bank account, leaving a fresh £900 shortfall. Future payments remain scheduled. Only confirm the displayed amount during recording; no further payout was made during preparation.
6. Payment runs (1:40–1:50): show the new receipt and Stripe balance change, then evidence. “Each transfer is tied to the policy, source evidence and approval.” The bank account ledger/downstream supplier export is simulated; Stripe payout is a real test API call.

The £900 figure is conditional on unchanged balances and approvals. Use the current preview as authority. Do not reset the real funding ledger or replay the previous £876 payout. The scenario-preparation endpoint is idempotent and does not re-open a duplicate after the first preparation.
