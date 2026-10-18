# ADR 0010: Tenant persistence, row-level security and migrations

Status: Implemented for synthetic data. Supports #96 (part 1) without closing it. The owner approved the plan in #125.

## Decision

- **Database:** PostgreSQL 16, pinned to the same image digest (16.15) in CI and in `compose.yaml`. Cloud hosting and residency are still undecided.
- **Driver:** `pg` 8.23.1, with no ORM, so roles, grants and RLS policies stay in reviewable SQL.
- **Migrations:** `@reo/db` runs numbered `packages/db/migrations/NNNN_name.sql` files in name order.
  - Each file runs in its own transaction.
  - The SHA-256 checksum of each file is recorded in `schema_migrations`.
  - An advisory lock makes concurrent runners apply each file once.
  - A changed, already-applied file stops the run.
  - Migrations are forward-only: fix with a new migration, never by editing or reversing an old one.
- **Database tests:** `pnpm test:db` needs `REO_TEST_DATABASE_URL`, a superuser on a throwaway cluster. Each test file creates and drops its own `reo_test_*` database and login role. CI provides a PostgreSQL service container.

## Role and isolation model

- **Migrations and ownership:** migrations run as the owning admin. `reo_app` is a NOLOGIN, non-superuser, NOBYPASSRLS group role that owns nothing.
- **Runtime logins:** they inherit `reo_app`. That gives SELECT on `organization`, `principal` and `membership`, plus SELECT, INSERT and UPDATE on tenant tables. There is no DELETE, no DDL and no write to memberships.
- **RLS:** every table has `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- **Tenant context:** `withTenant()` sets `app.organization_id` and `app.principal_id` with `set_config(..., true)`, so the context ends with the transaction and never leaks on a pooled connection. IDs must be UUIDs before any query runs.
- **Tenant-table policy:** a row is visible and writable only when its `organization_id` equals the current tenant AND the current principal has an active membership there. Active means `status = 'active'`, `effective_from <= now()` and `effective_to` not reached. Missing or forged context matches nothing.
- **Membership policy:** it checks only the row's own tenant and principal. It must not call `has_active_membership()`, or the policy would recurse.
- **Child tables:** they reference parents with composite `(organization_id, id)` foreign keys, so a cross-tenant link fails at the database (23503).
- **Membership constraints:**
  - An active membership needs an approver and an approval time.
  - Self-approval is rejected.

## Evidence

- `packages/db/src/*.db.test.ts` (26 tests) run against PostgreSQL 16.15, both locally and in the pinned container. They cover:
  - forged tenants
  - invited, suspended, revoked, expired and not-yet-effective memberships
  - missing context
  - cross-tenant links
  - counts
  - escalation attempts: activating a membership, editing the organization, DELETE, disabling RLS, `SET ROLE`
  - constraints
  - concurrent and changed migrations
  - context clean-up on pooled connections
- A mutation check confirmed the tests fail if any of these is weakened:
  - the membership status check
  - the branch policy
  - membership grants
  - `FORCE`
  - the composite foreign key

## Not done

- OIDC verification and sessions (#96 part 2). A principal lookup before a context exists will need a reviewed `SECURITY DEFINER` function.
- The admin path for inviting, approving and revoking memberships.
- BrokerageRegistration and effective-dated BOR records.
- Audit (#98), outbox (#84) and #97 middleware.
- No API route uses the database. `/health/ready` stays 503 and `/v1/*` stays 401.

## Rollback

Revert the PR. No production or shared database exists. Once one exists, schema changes are forward-only.
