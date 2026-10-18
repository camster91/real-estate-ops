# ADR 0011: Record-level access grants

Status: Implemented for synthetic data. Supports #97 (part 1) without closing it. The owner approved the plan in #127.

## Decision

1. **One row per grant.** Each `access_grant` row is one principal, one action, one exact resource (`resource_type` plus `resource_id`), one classification and one purpose. There are no arrays and no wildcard resources. A row is always a complete grant, so fragments never combine; this matches `@reo/auth`.
2. **Grants always expire and need a second person.**
   - `expires_at` is required.
   - The grantor must be a different principal.
   - The grantee must be a member of the same tenant (composite FK to `membership`).
   - The runtime role `reo_app` can only SELECT its own grants. It can never insert, update or delete them. Issuing or changing a grant is a permission change (L3); that admin path is not built yet.
3. **Purpose joins the tenant context.** `withTenant()` requires a `purpose` such as `client_service`, set transaction-locally as `app.purpose`. Grants only match their own purpose.
4. **Record visibility is filtered in SQL.** `app.readable_record` lists what the current principal may read in the current tenant, for the current purpose, right now.
   - List, count, search, export and page queries filter with `EXISTS (SELECT 1 FROM app.readable_record rr WHERE rr.resource_type = '<type>' AND rr.resource_id = t.id AND rr.classification = t.classification)`, so hidden records never reach an aggregate.
   - Future client-record tables must put the same `EXISTS` in their SELECT RLS policy.
5. **Actions are checked fresh each time.** `authorizeInTenant()` loads the subject's grants for the requested resource type from the database on every call, uses the database clock, and runs the shared `@reo/auth` `authorize()`. Nothing is cached, so a revocation applies to the next decision. L3 actions still deny with `human_approval_required`, and L4 never unlocks.

## Why a view, not a function

The plan proposed a function, `app.can_read()`. PostgreSQL never inlines a SQL function whose body contains a subquery, so it would run once per row; a minimal probe confirmed this.

The view is merged into the caller's query and becomes a join on the `access_grant_lookup` index, and a test asserts that plan shape. `security_invoker = true` makes the view run with the caller's privileges and `access_grant` RLS, which covers only the caller's own grants and only while their membership is active. A test fails if that option is removed.

## Evidence

`packages/db/src/grants.db.test.ts` and `subject.db.test.ts`, plus the existing suites, give 55 database tests on PostgreSQL 16.15. They cover:
- lists, counts and pagination filtered before aggregation
- look-alike grants that must not count: another principal, another tenant with the same UUID, another resource type
- wrong purpose or classification, expired, not yet valid, and revoked grants
- an inactive membership hiding all grants, including through the view
- the runtime role being unable to write grants
- grant constraints: no self-grant, a known action, a member grantee, a required expiry
- the join plan shape
- forced RLS and ownership
- revocation taking effect on the next call
- L3 and L4 gating
- `loadSubject` never returning another principal's grants

A mutation check confirmed the tests fail if any of these is weakened:
- the purpose filter
- the revocation filter
- the membership check in the grant policy
- write grants for the runtime role
- `security_invoker`

## Not done

- API and worker middleware wiring. It needs a verified principal from OIDC (#96 part 2).
- Role grants from the authorization matrix (#24, needs brokerage approval).
- The admin path for issuing and revoking grants, which requires an L3 approval.
- Service identities and requester intersection in the database.
- Storage (#99) and audit (#98).

## Rollback

Revert the PR. No shared or production database exists. Once one does, schema changes are forward-only (ADR 0010).
