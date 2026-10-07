# ADR 0006-finance: Operational finance separated from ledger and money movement

Status: Proposed — derived from seed and current user instruction; repository reconciliation pending.

## Context
The seed defines product boundaries but lacks implementation-level invariants. The repository was confirmed empty before bootstrap; no earlier repository decisions existed.

## Decision
Accounting remains the authoritative ledger. Store invoice/expense/payment/trust references and reconciliation evidence with source system, source ID, as-of timestamp and discrepancy state. TrustMoneyRecord tracks operational evidence; it cannot execute a transfer or imply that the operational platform is the official ledger.

CommissionEstimate stores currency, exact decimal amounts/rates, effective-dated split policy and calculation version. CommissionStatement snapshots an approved calculation and dependencies; corrections supersede statements. Avoid JavaScript floating-point currency calculations and never invent commission percentages, HST handling or rounding rules. Bank balances and actual payments are provider evidence, not editable derived values. Financial action proposals always require human review; autonomous money movement is excluded.

TrustReconciliationRecord is scoped to responsible brokerage/account/month, immutable reviewed evidence, preparer and BOR reviewer, outstanding items and remediation. Prior-period corrections require an explicit superseding version. Filing preparation has fiscal period, trading status, financial/trust evidence and human attestation metadata. Do not implement a filing portal connector without sanctioned access.

## Consequences
Shared domain rules and tenant-scoped persistence are required. Unconfirmed policies and entitlements stay configurable and disabled by default. Existing repository decisions must be compared before adoption; document any conflict rather than silently replacing it.

## Verification before acceptance
Trace to the relevant reconciled GitHub issue, review the core model/security implications, and add automated tests for tenant isolation, invalid transitions, least privilege and applicable approval/replay/concurrency boundaries. Verify migration and recovery implications. Legal or brokerage policy choices require the named accountable reviewer.
