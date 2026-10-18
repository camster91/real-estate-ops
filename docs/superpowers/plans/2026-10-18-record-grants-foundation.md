# Record Grants Foundation (#97, part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store record-level access grants in PostgreSQL. Enforce read visibility in SQL, so that list, count, export and pagination can never include records the caller is not granted. Run every action decision through the shared `@reo/auth` `authorize()`, using grants loaded fresh from the database, so that a revocation takes effect on the next call.

**Architecture:** Migration `0002` adds a tenant-scoped `access_grant` table. Each row is one complete grant: principal, action, resource, classification, purpose and expiry. The runtime role can read only its own grants and can never write them. `withTenant()` gains a required `purpose`. A new SQL function `app.can_read()` filters queries before aggregation. `loadSubject()` and `authorizeInTenant()` in `@reo/db` turn database rows into an `@reo/auth` `Subject` and call `authorize()`.

**Tech Stack:** PostgreSQL 16, `pg` 8.23.1, `@reo/auth` (workspace), Vitest 5, TypeScript 7.

**Spec:**
- Issue #97 acceptance criteria. "Implement one shared default-deny RBAC/ABAC policy and consistent API/worker/storage authorization." "List/detail/search/export/aggregate and task execution cannot leak unauthorized records; role revocation takes effect."
- `docs/adr/0003-authorization-and-approval.md`
- `docs/adr/0009-authorization-contracts.md`, which says: "Query/aggregate filtering must occur before counts/pagination; a per-record evaluator is not safe query middleware".
- `docs/adr/0010-tenant-persistence.md`
- `docs/product/AUTHORIZATION.md`

**Out of scope (needs decisions that don't exist yet):**
- API and worker middleware wiring (needs a verified principal from OIDC, #96 part 2).
- Actual role grants from the authorization matrix (#24, needs brokerage approval).
- Admin screens for granting and revoking.
- Service identities and requester intersection in the database.
- Object storage (#99).
- Audit (#98).

## Decisions for owner approval

These are recorded in ADR 0011 (Task 4):

1. **One row per grant.** Each `access_grant` row is one principal, one action, one exact resource, one classification and one purpose. There are no arrays and no wildcard resources. A row is always a complete grant, which matches `@reo/auth`'s rule that fragments never combine.
2. **Grants always expire and need a second person.**
   - `expires_at` is required.
   - The grantor must be a different principal.
   - The grantee must be a member of the same tenant (composite FK to `membership`).
   - The runtime role can never insert, update or delete grants. Granting is a permission change, which is L3; the admin path comes later.
3. **Purpose joins the tenant context.** `withTenant()` requires a `purpose`, for example `client_service`, and grants only match their own purpose.
4. **Record visibility is filtered in SQL.** `app.can_read(resource_type, resource_id, classification)` goes inside `WHERE` (and, later, inside client-record RLS policies), so lists, counts, exports and pages are filtered before aggregation. Future client-record tables must put it in their SELECT policy.
5. **Actions are checked fresh each time.** Mutations and higher action levels go through `@reo/auth` `authorize()`, with grants read from the database on every call and the database clock as `now`. Nothing is cached.

## Global Constraints

- Node `>=24.19.0 <25`, pnpm `11.25.0`, exact pins, strict TS, Biome tabs and double quotes. No new external dependencies. `@reo/db` adds `"@reo/auth": "workspace:*"`.
- Migrations are forward-only. `0001_tenancy.sql` must not be edited; it is applied history.
- Every new table gets `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- Policies wrap context functions in scalar subqueries, `(SELECT app.…())`, so they are evaluated once per query (ADR 0010).
- The runtime role `reo_app` gets SELECT only on `access_grant`. No INSERT, UPDATE or DELETE.
- Context is set transaction-locally only (`set_config(…, true)`).
- Use synthetic data only and Canadian spelling in docs.
- `/health/ready` stays 503 and `/v1/*` stays 401. No route uses the database.

## Review Focus

1. **Revocation between two calls.** A grant revoked (or expired) between two `authorizeInTenant()` calls on the same pool must deny the second call. Test in Task 3.
2. **Pagination and count leaks.** `count(*)`, `LIMIT` and `OFFSET` over a filtered query must count only granted rows. Page 2 must never contain hidden rows. Test in Task 4.
3. **Look-alike grants.** These must not grant access:
   - a grant held by another principal,
   - a grant in another tenant for the same resource UUID,
   - a grant for a different `resource_type` with the same UUID.

   Test in Task 4.
4. **Purpose mismatch.** A grant for `marketing` must not satisfy a `client_service` context, in either SQL or `authorize()`. Test in Tasks 3 and 4.
5. **Per-row function cost.** `app.can_read()` must inline, meaning plain `LANGUAGE sql`, no `SET` clause and fully qualified names, so a large scan does not call it per row. Test in Task 4 by asserting the plan text has no `app.can_read(`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/migrations/0002_access_grants.sql` | `app.current_purpose()`, the `access_grant` table, RLS, `app.can_read()`, grants |
| `packages/db/src/tenant.ts` (modify) | Adds `purpose` to `TenantContext`, validates it and sets `app.purpose` |
| `packages/db/src/subject.ts` | `loadSubject()` and `authorizeInTenant()` |
| `packages/db/src/index.ts` (modify) | Exports |
| `packages/db/src/testing/fixtures.ts` | Shared seed helper for two tenants, extracted from `tenancy.db.test.ts` |
| `packages/db/src/grants.db.test.ts`, `subject.db.test.ts` | New tests |
| `packages/db/src/tenant.db.test.ts`, `tenancy.db.test.ts` (modify) | Pass `purpose`; use the fixtures helper |
| `packages/db/package.json` (modify) | Adds `@reo/auth` dependency |
| `docs/adr/0011-record-grants.md`, `docs/platform/AUTHORIZATION_VERIFICATION.md`, `docs/roadmap/RESUME.md` | Decisions and status |

---

### Task 1: Purpose in the tenant context

**Files:**
- Modify: `packages/db/src/tenant.ts`, `packages/db/src/tenant.db.test.ts`, `packages/db/src/tenancy.db.test.ts` (each `TenantContext` gets `purpose: "client_service"`)

**Interfaces:**
- Produces: `interface TenantContext { readonly organizationId: string; readonly principalId: string; readonly purpose: string }`. `withTenant` also sets `app.purpose` transaction-locally. The purpose must match `/^[a-z][a-z0-9_]{0,63}$/`, otherwise `InvalidTenantContextError`, thrown before `pool.connect()`.

- [ ] **Step 1: Write the failing tests** in `tenant.db.test.ts`:
  - Extend `sets both ids for the transaction`. Rename it to `sets ids and purpose for the transaction` and assert `current_setting('app.purpose')` equals `"client_service"`.
  - Extend `clears context after commit` to check `app.purpose` too.
  - Add `rejects malformed purpose before touching the database`: `it.each(["", "Client", "1abc", "a b", "x".repeat(65), "client_service; --"])` rejects with `InvalidTenantContextError`, and `pool.connect` is not called.
- [ ] **Step 2: Run and verify they fail.** Run `REO_TEST_DATABASE_URL=… pnpm test:db tenant`. Expected: FAIL on the `app.purpose` assertion (an unset setting is `null`) and on the purpose cases (no throw).
- [ ] **Step 3: Implement** the purpose validation and the extra `set_config('app.purpose', $3, true)` in the same `SELECT`. Add `purpose: "client_service"` to the contexts in `tenancy.db.test.ts`.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db`: all pass (28 existing plus 6 new). Run `pnpm lint && pnpm typecheck`: clean.
- [ ] **Step 5: Commit** with message `feat(db): require a purpose in the tenant context`.

### Task 2: `access_grant` table, RLS and `app.can_read()`

**Files:**
- Create: `packages/db/migrations/0002_access_grants.sql`, `packages/db/src/testing/fixtures.ts`, `packages/db/src/grants.db.test.ts`
- Modify: `packages/db/src/tenancy.db.test.ts`, which imports `seedTwoTenants` instead of its inline seed

**Interfaces:**
- Consumes: `withTenant` with `purpose` (Task 1). `createTestDatabase()` from the harness.
- Produces:
  - `seedTwoTenants(admin: pg.Pool): Promise<SeedIds>` with `interface SeedIds { orgA; orgB; pa; pb; approver; pc; branchA; branchB }`, all `string`. Same data as today's `tenancy.db.test.ts` seed.
  - `grant(admin: pg.Pool, row: { org: string; principal: string; action: string; resourceType: string; resourceId: string; classification?: string; purpose?: string; expiresIn?: string; grantor: string }): Promise<string>`. Defaults: classification `operational`, purpose `client_service`, expiresIn `'1 day'`. It inserts as admin and returns the grant id.
  - SQL: `app.current_purpose() returns text`, and `app.can_read(resource_type text, resource_id uuid, classification text) returns boolean`.

The migration defines:

- **`app.current_purpose()`:** `nullif(current_setting('app.purpose', true), '')`. It follows the `0001` function style and is granted to `reo_app`.
- **`access_grant` table:**
  - Columns: `organization_id uuid NOT NULL`, `id uuid NOT NULL DEFAULT gen_random_uuid()`, `principal_id uuid NOT NULL`, `action text NOT NULL`, `resource_type text NOT NULL CHECK (resource_type ~ '^[a-z][a-z_]{0,62}$')`, `resource_id uuid NOT NULL`, `classification text NOT NULL CHECK (classification IN ('operational','personal','financial','restricted_compliance'))`, `purpose text NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9_]{0,63}$')`, `valid_from timestamptz NOT NULL DEFAULT now()`, `expires_at timestamptz NOT NULL`, `revoked_at timestamptz`, `granted_by_principal_id uuid NOT NULL REFERENCES principal`, `created_at timestamptz NOT NULL DEFAULT now()`.
  - Keys and checks: `PRIMARY KEY (organization_id, id)`. `FOREIGN KEY (organization_id, principal_id) REFERENCES membership (organization_id, principal_id)`. `CHECK (expires_at > valid_from)`. `CHECK (granted_by_principal_id <> principal_id)`.
  - `action` must be one of the `@reo/auth` action names:
    ```
    'record.read','task.create','communication.draft','communication.send','calendar.modify',
    'signature.send','regulatory.submit','permission.modify','record.delete','money.move',
    'security.bypass','compliance.bypass','agent.expand_permissions'
    ```
  - Index: `(organization_id, principal_id, action, resource_type, resource_id)`.
- **RLS:** `ENABLE` and `FORCE`. Policy `access_grant_self_read` is FOR SELECT `USING (organization_id = (SELECT app.current_organization_id()) AND principal_id = (SELECT app.current_principal_id()) AND (SELECT app.has_active_membership()))`.
- **`app.can_read`:** `LANGUAGE sql STABLE SECURITY INVOKER`, with **no `SET` clause** so that it inlines. Every name is fully qualified (`public.access_grant`, `app.current_*()`). The body is:
  ```sql
  SELECT EXISTS (SELECT 1 FROM public.access_grant g
    WHERE g.organization_id = (SELECT app.current_organization_id())
      AND g.principal_id = (SELECT app.current_principal_id())
      AND g.action = 'record.read' AND g.resource_type = $1 AND g.resource_id = $2
      AND g.classification = $3 AND g.purpose = (SELECT app.current_purpose())
      AND g.revoked_at IS NULL AND g.valid_from <= now() AND now() < g.expires_at)
  ```
  RLS on `access_grant` also enforces active membership. The context calls are wrapped in `(SELECT …)` so they stay once-per-query InitPlans even inside the correlated subquery.
- **Grants to `reo_app`:** `SELECT ON access_grant`, plus `EXECUTE` on the two new functions. Revoke `EXECUTE` on both from `PUBLIC`.

**Test fixture inside `grants.db.test.ts` only:**
- As admin, create `fixture_record(organization_id uuid, id uuid DEFAULT gen_random_uuid(), classification text, n int, PRIMARY KEY (organization_id, id))`.
- Give it tenant RLS in the 0001 shape, plus `GRANT SELECT TO reo_app`.
- Insert 5 rows for org A (n 1–5) and 2 for org B, all with classification `operational`.
- Grant `pa` `record.read` on A's rows n = 2 and n = 4, purpose `client_service`.
- Read with `SELECT … FROM fixture_record WHERE app.can_read('fixture_record', id, classification)`.

- [ ] **Step 1: Write the failing tests** in `grants.db.test.ts`:
  - `lists and counts only granted records`: as `{A, pa, client_service}`, `count(*)` is 2 and `ORDER BY n` gives `[2, 4]`.
  - `paginates after filtering`: `ORDER BY n LIMIT 1 OFFSET 1` gives `[4]`, and `OFFSET 2` gives `[]`.
  - `ignores look-alike grants`. Add each of these as admin; the result stays `[2, 4]` and `pb` sees `[]` in org B:
    - a grant to `pb` on A's n = 1,
    - a grant in org B to `pb` that reuses A's n = 3 UUID as `resource_id`,
    - a grant to `pa` with `resource_type = 'other_type'` on n = 5.
  - `wrong purpose, classification, expiry or revocation does not grant`. `it.each` over:
    - purpose `marketing`,
    - classification `personal`,
    - `expires_at` in the past (with `valid_from` earlier),
    - `valid_from` in the future,
    - `revoked_at = now()`.

    For each case, admin edits the n = 2 grant, the visible list becomes `[4]`, and the grant is restored afterwards.
  - `inactive membership hides all grants`: admin sets `pa`'s membership to `suspended`. The list becomes `[]`, and `SELECT count(*) FROM access_grant` as `pa` is 0. Restore afterwards.
  - `runtime role cannot write grants`: as `{A, pa}`, each of these rejects with `42501`:
    - `INSERT INTO access_grant (…) VALUES (…)`, a grant to itself,
    - `UPDATE access_grant SET expires_at = now() + interval '10 years'`,
    - `UPDATE access_grant SET revoked_at = NULL`,
    - `DELETE FROM access_grant`.
  - `grant constraints hold for admins`. Each of these rejects as admin:
    - a self-grant gives `23514`,
    - `expires_at` NULL gives `23502`,
    - action `record.update` gives `23514`,
    - a grantee who is not a member of the org gives `23503` (use `pc`, which has no membership).
  - `can_read inlines instead of running per row`: as `pa`, the `EXPLAIN` text for the list query does not match `/app\.can_read\(/`.
  - `grant table is forced and not owned by the runtime role`: same check as the `0001` isolation test, for `access_grant`.
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test:db grants`. Expected: FAIL, because `function app.can_read(...) does not exist`.
- [ ] **Step 3: Implement** `0002_access_grants.sql` and `fixtures.ts`. Switch `tenancy.db.test.ts` to `seedTwoTenants`.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db`: all pass. `pnpm lint` is clean.
- [ ] **Step 5: Commit** with message `feat(db): record-level access grants with SQL read filter`.

### Task 3: `loadSubject()` and `authorizeInTenant()`

**Files:**
- Create: `packages/db/src/subject.ts`, `packages/db/src/subject.db.test.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/package.json` (add `"@reo/auth": "workspace:*"`, then `pnpm install`)

**Interfaces:**
- Consumes: `withTenant`, `TenantContext` (Task 1). The `access_grant` table and `seedTwoTenants` and `grant` (Task 2). `authorize`, `Subject`, `Grant`, `Resource`, `Action` and `Decision` from `@reo/auth`.
- Produces:
  - `loadSubject(client: pg.ClientBase): Promise<Subject>`. It must be called inside `withTenant`.
    - It reads the current principal's membership for the current tenant, which RLS limits to its own row.
    - `membershipActive` comes from the same active test as `app.has_active_membership()`.
    - It reads every visible `access_grant` row and maps each row to one `Grant`: `actions: [action]`, `resourceIds: [resource_id]`, `classifications: [classification]`, `purposes: [purpose]`, `validFrom` and `expiresAt` as epoch milliseconds, `revoked: revoked_at !== null`.
    - It returns `kind: "human"` and the IDs from `app.current_*()`. If there is no membership row, it returns `membershipActive: false` and `grants: []`.
  - `authorizeInTenant(client: pg.ClientBase, request: { action: Action; resource: Resource }): Promise<Decision>`. It calls `authorize()` with:
    - `subject` from `loadSubject(client)`,
    - `purpose` from `app.current_purpose()`,
    - `now` from `SELECT (extract(epoch FROM now()) * 1000)::float8`, the database clock.

    It never caches anything.

- [ ] **Step 1: Write the failing tests** in `subject.db.test.ts`. Seed with `seedTwoTenants`. Grant `pa` `record.read` and `communication.send` on `resA = randomUUID()`, classification `personal`.
  - `allows a granted read and requires audit`: `authorizeInTenant(c, { action: "record.read", resource: { tenantId: orgA, id: resA, classification: "personal" } })` returns `{ allowed: true, level: 0, auditRequired: true }`.
  - `revocation takes effect on the next call`: allowed on the first `withTenant` call. Admin then sets `revoked_at = now()`. A second `withTenant` call on the same pool returns `{ allowed: false, reason: "grant_required" }`.
  - `wrong purpose is denied`: a context with purpose `marketing` returns `grant_required`.
  - `other tenant resource is denied`: `resource.tenantId = orgB` returns `tenant_mismatch`.
  - `inactive membership is denied`: admin suspends the membership, which returns `membership_required`. Restore afterwards.
  - `consequential actions stay gated`: `communication.send`, even though granted, returns `human_approval_required`. `money.move` returns `never_autonomous`.
  - `loadSubject never returns another principal's grants`: add a grant to `pb` in org A on `resA` (`pb` needs an A membership first, added by admin). `loadSubject` as `pa` returns only grants whose `subjectId` is `pa`, and their count equals `pa`'s rows.
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test:db subject`. Expected: FAIL, because module `./subject.js` is not found.
- [ ] **Step 3: Implement** `subject.ts` and export both functions.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db`: all pass. Run `pnpm check`, which rebuilds with the new workspace dependency: clean.
- [ ] **Step 5: Commit** with message `feat(db): load subjects from grants and authorize with the shared policy`.

### Task 4: ADR and docs

**Files:**
- Create: `docs/adr/0011-record-grants.md`
- Modify: `docs/platform/AUTHORIZATION_VERIFICATION.md` (add a section dated 18 October 2026), `docs/roadmap/RESUME.md` (next slice line)

**Content:**
- **ADR 0011:**
  - The five decisions above.
  - The rule that client-record tables must use `app.can_read()` in their SELECT RLS policy.
  - Why `can_read` has no `SET` clause: inlining. And why that is safe: every name is qualified, and `pg_temp` is never searched for functions or operators.
  - The evidence list.
  - What is not done: middleware wiring, #24 role grants, the grant admin path, service-identity requester intersection, storage and worker.
  - Rollback: revert the PR. No shared database exists.
- **AUTHORIZATION_VERIFICATION:** a new dated section stating what is now enforced and what still is not.
- **RESUME:** the next slice is #96 part 2 (OIDC) when the provider is chosen, then wiring `authorizeInTenant` into API and worker. The grant admin path waits for #24 approval.

- [ ] **Step 1: Write the ADR and doc updates.**
- [ ] **Step 2: Run the full checks.** Run `pnpm lint && pnpm security:source && pnpm check && pnpm test:db` and the Python tests. All must be clean.
- [ ] **Step 3: Commit** with message `docs: ADR 0011 record grants and verification status`.
