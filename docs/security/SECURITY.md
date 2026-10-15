# Security and privacy model

## Principles
- Least privilege
- MFA
- Role + record-level authorization
- Default deny for cross-team/client access
- Separate external-partner/client roles
- Encryption in transit and at rest
- Canadian data residency where practical/contractually required
- Central secret management
- Immutable/tamper-evident audit history for sensitive actions
- No secrets or full sensitive documents in logs

## AI privacy
Before any model call:
1. authorize the requesting user/job;
2. select only the minimum records needed;
3. redact high-risk fields unless necessary;
4. select permitted model/provider based on data classification;
5. log purpose/provider/data-classification metadata;
6. require approval for consequential external actions.

## Action classes
- L0 Read-only
- L1 Safe internal write (e.g. create task)
- L2 Draft external action
- L3 Explicit human-approved consequential action (external sends, calendars, signatures, regulatory submissions, permission changes and important deletions)
- L4 Never autonomous (money movement, compliance/security bypass, self-approval, silent agent permission expansion). Regulatory attestation remains human-owned; permitted submissions require L3 approval.

## Required tests
Authorization matrix, horizontal/vertical privilege escalation, webhook signature/replay, tenant isolation, approval bypass, secret leakage, sensitive log leakage, backup/restore, token revocation, session expiry.
