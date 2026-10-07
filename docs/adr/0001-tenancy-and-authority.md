# ADR 0001-tenancy-and-authority: Tenant, brokerage and operational authority

Status: Proposed — derived from seed and current user instruction; repository reconciliation pending.

## Context
The seed defines product boundaries but lacks implementation-level invariants. No current repository decision has been verified.

## Decision
Use Organization as the tenant and security boundary. Distinguish the tenant from Party(kind=organization), which represents an external/legal company identity. A tenant may represent a multi-service company; BrokerageRegistration records legal brokerage identity, jurisdiction, registration reference and effective dates. Each regulated Transaction references exactly one responsible brokerage registration and branch where applicable. BOR assignments are effective-dated records, not inferred from tenant ownership. Branch and Team belong to one tenant; an active Membership links a principal to tenant roles/scopes. Team membership alone does not grant access to every client.

Every operational record carries organization_id. Child and association foreign keys include organization_id so cross-tenant relationships fail at the database boundary. Application authorization and PostgreSQL RLS are independent controls. The application runtime role must not own tables or bypass RLS; tenant context is transaction-local and derived from a verified membership. FORCE ROW LEVEL SECURITY, scoped worker roles and isolation tests are required. Maintenance/backup roles are segregated and audited. Global identity linking never exposes another tenant's Party records.

Open decision: actual number of brokerages/branches and permitted shared-service access. Default deny until scoped policy is approved.

## Consequences
Shared domain rules and tenant-scoped persistence are required. Unconfirmed policies and entitlements stay configurable and disabled by default. Existing repository decisions must be compared before adoption; document any conflict rather than silently replacing it.

## Verification before acceptance
Trace to the relevant reconciled GitHub issue, review the core model/security implications, and add automated tests for tenant isolation, invalid transitions, least privilege and applicable approval/replay/concurrency boundaries. Verify migration and recovery implications. Legal or brokerage policy choices require the named accountable reviewer.
