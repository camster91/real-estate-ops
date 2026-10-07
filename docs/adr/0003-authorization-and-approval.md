# ADR 0003-authorization-and-approval: Deny-by-default access and content-bound approvals

Status: Proposed — derived from seed and current user instruction; repository reconciliation pending.

## Context
The seed defines product boundaries but lacks implementation-level invariants. No current repository decision has been verified.

## Decision
Authorize the authenticated principal, active tenant membership, role permission, record scope, data classification, purpose and resource state. Owner/executive is not automatically BOR or entitled to identity documents. External partners and clients receive explicit expiring record grants and safe projections. A service identity cannot assume a staff role.

Action levels follow the current user instruction: L0 authorized read; L1 explicitly allowlisted reversible internal mutation; L2 external draft; L3 explicit human approval for external sends/calendar edits/signature sends/submissions/permission changes/important deletions; L4 never autonomous money movement, compliance/security bypass, self-approval or silent scope expansion. This supersedes the seed SECURITY.md wording that places regulatory submission and permission escalation together in L4. No policy may interpret L3 as authorization for autonomous execution. Regulatory attestation remains a human act; default implementation prepares evidence for manual portal submission until a permitted workflow is approved.

Bind approval to tenant, requester, action, canonical payload hash, resource version, recipient/destination, scopes, expiry and designated approver. Approver must possess the required human role and cannot be the requesting system agent. Any material draft edit or resource change invalidates approval. Reauthorize at execution. Revocation, expiry, device revocation, offline state or inability to verify approval fail closed. Approval is consumed atomically with durable execution intent; replay cannot create another action. Provider idempotency or status reconciliation is required after ambiguous timeouts; do not blindly retry an external send.

## Consequences
Shared domain rules and tenant-scoped persistence are required. Unconfirmed policies and entitlements stay configurable and disabled by default. Existing repository decisions must be compared before adoption; document any conflict rather than silently replacing it.

## Verification before acceptance
Trace to the relevant reconciled GitHub issue, review the core model/security implications, and add automated tests for tenant isolation, invalid transitions, least privilege and applicable approval/replay/concurrency boundaries. Verify migration and recovery implications. Legal or brokerage policy choices require the named accountable reviewer.
