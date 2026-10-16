# Tenant Persistence Foundation (#96, part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PostgreSQL tenant/membership schema with row-level security (RLS), a forward-only migration runner and a transaction-local tenant context. Prove with tests against a real database, as a non-owner role, that forged tenants, inactive memberships, missing context and cross-tenant associations are denied.

**Architecture:** A new `@reo/db` package holds plain SQL migrations, a small migration runner and `withTenant()`. `withTenant()` opens a transaction and sets the tenant and principal with `set_config(..., true)`. RLS policies on every tenant table require the row's `organization_id` to equal the current tenant, and require that the current principal has an active membership there. The runtime role `reo_app` owns nothing, cannot bypass RLS and has no DELETE grant. No API route is enabled.

**Tech Stack:** PostgreSQL 16, `pg` (node-postgres) 8.23.1, `@types/pg` 8.23.1, Vitest 5, TypeScript 7, GitHub Actions service container.

**Spec:** Issue #96 (acceptance criteria). `docs/adr/0001-tenancy-and-authority.md`. `docs/product/CORE_MODEL.md` (Principal / Membership rows). `docs/platform/M1_PLAN.md` (row M1-B). `docs/roadmap/RESUME.md` ("Next engineering slice").

**Out of scope (separate plans):**
- OIDC verification and sessions (rest of #96, blocked on provider choice).
- Audit persistence (#98).
- Outbox (#84).
- API routes.
- BrokerageRegistration and BOR records.
- The admin path for creating or approving memberships.

## Decisions for owner approval

These decisions are recorded in ADR 0010 (Task 4):

1. **Database:** PostgreSQL 16. This matches the local toolchain. Cloud hosting is still undecided.
2. **Driver:** `pg` 8.23.1. There is no ORM, so RLS and roles stay visible in plain SQL.
3. **Migrations:**
   - Plain numbered SQL files run by our own ~80-line runner.
   - Forward-only. Each file is checksummed, guarded by an advisory lock and run in one transaction.
   - There are no "down" migrations; repairs are new forward migrations, as M1_PLAN requires.
4. **Database tests:**
   - Tests need a real PostgreSQL and run with `pnpm test:db`.
   - CI runs them against a pinned `postgres:16` service container.
   - Local runs use `compose.yaml`.

## Global Constraints

- Node `>=24.19.0 <25`, pnpm `11.25.0`. Every dependency is pinned exactly. Strict TS uses the existing `tsconfig.base.json`. Biome uses tabs and double quotes.
- New dependencies are only `pg@8.23.1` and `@types/pg@8.23.1`.
- The runtime role must never be the table owner, a superuser or `BYPASSRLS`. Every tenant table has `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- Tenant context must use `set_config(name, value, true)` (transaction-local) only. Never set it for the whole session.
- The runtime role has no `DELETE` and no DDL. It has no write grant on `organization`, `principal` or `membership`.
- Use synthetic data only. No real names, emails or credentials, not even in tests.
- `/health/ready` stays 503 and `/v1/*` stays 401. `NODE_ENV=production` stays refused.
- IDs are UUIDs from `gen_random_uuid()`. Instants are `timestamptz`.
- Use Canadian spelling in docs.

## Review Focus

1. **Pooled connection reuse.** Context from one `withTenant` call must not be visible to the next user of the same pooled connection, after either commit or error. Test in Task 2.
2. **Malformed IDs.** An empty string, a non-UUID or SQL text as the tenant or principal must throw before any query, never widen access. Test in Task 2.
3. **Membership time window.** A membership whose `effective_to` has passed, or whose `effective_from` is in the future, must deny like a revoked one. Test in Task 3.
4. **Self-escalation by the app role.** The app role must not be able to:
   - activate its own membership,
   - disable RLS,
   - `SET ROLE` to the owner,
   - delete rows.

   Test in Task 3.
5. **Concurrent migration runs.** Two deploys migrating at once must apply each file exactly once. Test in Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/package.json`, `tsconfig.json` | Package `@reo/db`, same shape as `packages/auth` |
| `packages/db/src/index.ts` | Re-exports `migrate`, `withTenant`, errors, `migrationsDirectory` |
| `packages/db/src/migrate.ts` | Migration runner |
| `packages/db/src/tenant.ts` | `withTenant()` and context validation |
| `packages/db/src/testing/harness.ts` | Throwaway test database and app login (excluded from build) |
| `packages/db/migrations/0001_tenancy.sql` | Roles, schema, RLS, grants |
| `packages/db/src/*.db.test.ts` | Database tests (need PostgreSQL) |
| `vitest.config.ts` (modify), `vitest.db.config.ts` (new), root `package.json` (modify) | Split unit tests from database tests |
| `.github/workflows/ci.yml` (modify) | PostgreSQL service and `pnpm test:db` |
| `compose.yaml` (new) | Local PostgreSQL bound to loopback |
| `docs/adr/0010-tenant-persistence.md` (new), `docs/platform/LOCAL_DEVELOPMENT.md`, `docs/platform/M1_PLAN.md`, `docs/roadmap/RESUME.md` | Decisions, how to run, status |

---

### Task 1: `@reo/db` package, test harness, migration runner and CI database

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/src/index.ts`, `packages/db/src/migrate.ts`, `packages/db/src/testing/harness.ts`, `packages/db/src/migrate.db.test.ts`, `vitest.db.config.ts`
- Modify: `vitest.config.ts` (add `exclude: ["**/*.db.test.ts", "**/node_modules/**"]`), root `package.json` (add `"test:db": "vitest run --config vitest.db.config.ts"` and the two dependencies), `.github/workflows/ci.yml`, `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**
- Produces:
  - `migrate(client: pg.ClientBase, directory: string): Promise<{ applied: string[]; skipped: string[] }>`
  - `class MigrationChecksumError extends Error { version: string }`
  - `class MigrationNameError extends Error`
  - `migrationsDirectory: string`, which resolves `../migrations` from the module via `fileURLToPath(new URL("../migrations", import.meta.url))`
  - Harness: `createTestDatabase(options?: { migrate?: boolean }): Promise<TestDatabase>` with `interface TestDatabase { admin: pg.Pool; app: pg.Pool | undefined; name: string; drop(): Promise<void> }`

Runner rules:
- Migration files must match `/^\d{4}_[a-z0-9_]+\.sql$/`, otherwise `MigrationNameError`. They run in name order.
- The ledger is `public.schema_migrations(version text primary key, checksum text not null, applied_at timestamptz not null default now())`.
- The checksum is SHA-256 hex of the file bytes.
- Take `pg_advisory_lock(7212026)` for the whole run and unlock in `finally`.
- Verify every already-applied checksum before applying anything.
- Each pending file runs in its own `BEGIN … INSERT INTO schema_migrations … COMMIT`.

Harness rules:
- Read `REO_TEST_DATABASE_URL` (a superuser on a throwaway cluster). If it is unset, throw `"REO_TEST_DATABASE_URL is required for database tests"`. Never skip.
- Create database `reo_test_<12 hex>`.
- If `migrate !== false`, run `migrate(admin, migrationsDirectory)`. Then create a login role `reo_app_<12 hex>` with a random password, `IN ROLE reo_app`, and point `app` at it.
- `drop()` ends both pools, then runs `DROP DATABASE … WITH (FORCE)` and `DROP ROLE IF EXISTS`.

- [ ] **Step 1: Write the failing tests** in `packages/db/src/migrate.db.test.ts`. Each test writes fixture `.sql` files into a temp directory.
  - `applies pending migrations in order and records checksums`: two files creating tables `a` and `b`. Result `applied` is `["0001_a","0002_b"]`. `schema_migrations` has 2 rows with 64-character checksums.
  - `is a no-op on a second run`: the second call returns `applied: []` and `skipped: ["0001_a","0002_b"]`.
  - `refuses a changed applied migration`: edit `0001_a.sql` after the first run and add `0003_c.sql`. The second run rejects with `MigrationChecksumError` (`version === "0001_a"`), and `to_regclass('c')` is null.
  - `rolls back a failing migration completely`: `0002_bad.sql` is `CREATE TABLE b (id int); SELECT 1/0;`. The call rejects. `to_regclass('b')` is null, and the ledger holds only `0001_a`.
  - `applies each migration once under concurrent runs`: run `Promise.all` on two clients. The two `applied` arrays together have length 2, and the ledger count is 2.
  - `rejects badly named files`: `1_x.sql` gives `MigrationNameError`.
- [ ] **Step 2: Run and verify they fail.** Run `REO_TEST_DATABASE_URL=… pnpm test:db`. Expected: FAIL, module `./migrate.js` not found.
- [ ] **Step 3: Implement** `migrate.ts`, `harness.ts`, `index.ts`, the package files and the vitest split. The root `pnpm test` must still pass without a database.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db`: 6 pass. Run `pnpm test`: still passes (db tests excluded). Run `pnpm lint && pnpm typecheck`: clean.
- [ ] **Step 5: CI.**
  - In `ci.yml`, add a `services.postgres` block with image `postgres:16@sha256:<digest>`. Resolve the digest at implementation time with `docker buildx imagetools inspect postgres:16`.
  - Set env `POSTGRES_HOST_AUTH_METHOD: trust`, ports `5432:5432`, and a `pg_isready` health check.
  - Set job env `REO_TEST_DATABASE_URL: postgres://postgres@localhost:5432/postgres`.
  - Add step `pnpm test:db` after `pnpm check`.
- [ ] **Step 6: Commit** with message `feat(db): add migration runner, test harness and CI database`.

### Task 2: Transaction-local tenant context

**Files:**
- Create: `packages/db/src/tenant.ts`, `packages/db/src/tenant.db.test.ts`
- Modify: `packages/db/src/index.ts` (exports)

**Interfaces:**
- Consumes: `createTestDatabase({ migrate: false })` from Task 1.
- Produces:
  - `interface TenantContext { readonly organizationId: string; readonly principalId: string }`
  - `class InvalidTenantContextError extends Error`
  - `withTenant<T>(pool: pg.Pool, context: TenantContext, work: (client: pg.PoolClient) => Promise<T>): Promise<T>`
  - Setting names `app.organization_id` and `app.principal_id`.

Behaviour:
- Validate both IDs with a lowercase or uppercase UUID regex before `pool.connect()`.
- Run `BEGIN`, then `SELECT set_config('app.organization_id', $1, true), set_config('app.principal_id', $2, true)`, then `work`, then `COMMIT`.
- On error, `ROLLBACK` and rethrow. If the rollback also fails, `client.release(err)` so the connection is destroyed rather than reused.
- The JSDoc must state that `context` comes only from a verified session or membership lookup, never from request input.

- [ ] **Step 1: Write the failing tests** in `tenant.db.test.ts`. Use the admin pool with `max: 1` so the same connection is reused.
  - `sets both ids for the transaction`: inside `work`, `current_setting('app.organization_id')` and `current_setting('app.principal_id')` equal the inputs.
  - `clears context after commit`: after `withTenant` resolves, `SELECT current_setting('app.organization_id', true)` on the pool returns `""` or `null`.
  - `clears context and rolls back after work throws`: `work` creates `TEMP TABLE t` then throws. The call rejects with the same error. Then `current_setting(...)` is empty and `to_regclass('pg_temp.t')` is null.
  - `rejects malformed ids before touching the database`: `it.each(["", "not-a-uuid", "00000000-0000-0000-0000-00000000000g", "1'; SET ROLE postgres; --"])` rejects with `InvalidTenantContextError` for either field. A spy on `pool.connect` is never called.
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test:db -- tenant`. Expected: FAIL, `withTenant` not exported.
- [ ] **Step 3: Implement** `withTenant` in `tenant.ts` and export it from `index.ts`.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db`: all pass. `pnpm lint` is clean.
- [ ] **Step 5: Commit** with message `feat(db): add transaction-local tenant context`.

### Task 3: Tenancy schema, RLS and grants

**Files:**
- Create: `packages/db/migrations/0001_tenancy.sql`, `packages/db/src/tenancy.db.test.ts`

**Interfaces:**
- Consumes: `createTestDatabase()` (migrated, with `app` pool) and `withTenant` from Tasks 1–2.
- Produces: the tables and functions below. Later slices (#97 middleware, #98 audit) build on them.

The migration defines:

- **Role:** `reo_app`. Create it only if missing, via a `DO` block: `NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`. Wrap the `CREATE ROLE` in `EXCEPTION WHEN duplicate_object THEN NULL`. Roles are cluster-wide but advisory locks are per database, so two databases migrating at once can race.
- **Schema `app`, with `SECURITY INVOKER STABLE` functions and `SET search_path = pg_catalog, public`:**
  - `app.current_organization_id() returns uuid`, which is `nullif(current_setting('app.organization_id', true), '')::uuid`.
  - `app.current_principal_id() returns uuid`, the same for the principal.
  - `app.has_active_membership() returns boolean`. It is an EXISTS on `membership` matching the current tenant and principal, `status = 'active'`, `effective_from <= now()` and (`effective_to IS NULL OR now() < effective_to`).
  - `app.tenant_visible(org uuid) returns boolean`, which is `org = app.current_organization_id() AND app.has_active_membership()`.
- **`organization`:** `id uuid pk default gen_random_uuid()`, `name text not null check (length(trim(name)) > 0)`, `created_at timestamptz not null default now()`.
  - Policy: SELECT `USING (app.tenant_visible(id))`.
- **`principal`:** `id uuid pk default gen_random_uuid()`, `oidc_issuer text not null`, `oidc_subject text not null`, `created_at`, `unique (oidc_issuer, oidc_subject)`.
  - Policy: SELECT `USING (id = app.current_principal_id())`.
- **`membership`:** `id uuid default gen_random_uuid()`, `organization_id uuid not null references organization`, `principal_id uuid not null references principal`, `status text not null check (status in ('invited','active','suspended','revoked'))`, `approved_by_principal_id uuid references principal`, `approved_at timestamptz`, `effective_from timestamptz not null default now()`, `effective_to timestamptz`, `created_at`.
  - `primary key (organization_id, id)` and `unique (organization_id, principal_id)`.
  - `check (status <> 'active' or (approved_by_principal_id is not null and approved_at is not null))`.
  - `check (approved_by_principal_id is distinct from principal_id)`.
  - `check (effective_to is null or effective_to > effective_from)`.
  - Policy: SELECT `USING (organization_id = app.current_organization_id() AND principal_id = app.current_principal_id())`. This policy must not call `has_active_membership()`, which would recurse.
- **`branch`:** `organization_id uuid not null references organization`, `id uuid default gen_random_uuid()`, `name text not null`, `version integer not null default 1`, `created_at`, `primary key (organization_id, id)`.
- **`team`:** the same columns plus `branch_id uuid not null`, and `foreign key (organization_id, branch_id) references branch (organization_id, id)`.
- **`branch` and `team` policy:** `FOR ALL USING (app.tenant_visible(organization_id)) WITH CHECK (app.tenant_visible(organization_id))`.
- **On all five tables:** `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- **Grants to `reo_app`:**
  - `USAGE` on schemas `public` and `app`.
  - `EXECUTE` on the four functions.
  - `SELECT` on `organization`, `principal`, `membership`.
  - `SELECT, INSERT, UPDATE` on `branch` and `team`.
  - Nothing else. Revoke `EXECUTE` on the `app` functions from `PUBLIC`.

**Test fixtures:**
- Seed through `admin` (superuser bypasses RLS): two orgs A and B; principals `pa` (member of A), `pb` (member of B) and `approver`; one branch per org. All names are synthetic, e.g. "Synthetic Org A".
- Helper `as(ctx, sql, params)` wraps `withTenant(db.app, ctx, c => c.query(sql, params))`.

- [ ] **Step 1: Write the failing tests** in `tenancy.db.test.ts`:
  - `runtime role cannot bypass isolation`:
    - `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user` on the app pool gives `false,false`.
    - For each of the 5 tables, `pg_class.relforcerowsecurity` is true and `pg_tables.tableowner` is not the app user.
  - `member sees only their tenant, including counts`: as `{A, pa}`, `SELECT count(*) FROM branch` gives 1. `SELECT name FROM branch` gives `["Synthetic Branch A"]`. `organization` returns only A.
  - `forged tenant gets nothing and cannot write`: as `{B, pa}`, `branch`, `organization` and `membership` each return 0 rows. `INSERT INTO branch (organization_id, name) VALUES (B, 'x')` rejects with code `42501`.
  - `inactive or out-of-window membership is denied`: `it.each` over status `invited`, `suspended`, `revoked`, plus `active` with `effective_to = now() - 1 day`, plus `active` with `effective_from = now() + 1 day`. Admin updates `pa`'s membership. As `{A, pa}`, `branch` gives 0 rows and an insert gives `42501`.
  - `missing context sees nothing and cannot write`: on the raw `db.app` pool (no `withTenant`), `SELECT count(*) FROM branch` gives 0 and an insert gives `42501`.
  - `cross-tenant association is rejected`: as `{A, pa}`, `INSERT INTO team (organization_id, branch_id, name) VALUES (A, <B's branch id>, 't')` rejects with `23503`.
  - `runtime role cannot escalate`: as `{A, pa}`, each of the following rejects with `42501`:
    - `UPDATE membership SET status = 'active'`
    - `UPDATE organization SET name = 'x'`
    - `DELETE FROM branch`
    - `ALTER TABLE branch DISABLE ROW LEVEL SECURITY`
    - `SET ROLE <admin user>`, using the admin user name read from `db.admin`
  - `membership constraints hold for admins too`: admin inserting an `active` membership with no approver rejects with `23514`. Admin inserting one approved by the same principal also rejects with `23514`.
  - `migration is safe to re-run in a fresh database when reo_app already exists`: running `createTestDatabase()` twice in parallel succeeds for both.
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test:db -- tenancy`. Expected: FAIL, because `reo_app` does not exist and the app pool is not created.
- [ ] **Step 3: Implement** `0001_tenancy.sql` as specified above.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db`: all pass. Also run `pnpm lint`, `pnpm security:source` and `pnpm check`.
- [ ] **Step 5: Commit** with message `feat(db): tenancy schema with forced RLS and least-privilege runtime role`.

### Task 4: Local database, ADR and docs

**Files:**
- Create: `compose.yaml`, `docs/adr/0010-tenant-persistence.md`
- Modify: `docs/platform/LOCAL_DEVELOPMENT.md`, `docs/platform/M1_PLAN.md`, `docs/roadmap/RESUME.md`

**Content:**
- **`compose.yaml`:**
  - One `postgres` service using the same pinned image and digest as CI.
  - `ports: ["127.0.0.1:5432:5432"]` (loopback only) and `POSTGRES_HOST_AUTH_METHOD: trust`.
  - A header comment saying it is for local synthetic data only.
  - A named volume.
- **ADR 0010:**
  - The four decisions above.
  - The role model: owner runs migrations; `reo_app` runtime role; future login roles inherit `reo_app`.
  - The RLS predicate and why the `membership` policy avoids recursion.
  - The forward-only migration rule.
  - What is not done: OIDC, the admin and membership-approval path, audit, BrokerageRegistration/BOR, and principal lookup before a context exists (needs a reviewed `SECURITY DEFINER` function in the OIDC slice).
  - Rollback: revert the PR. No production database exists.
- **LOCAL_DEVELOPMENT:**
  - `docker compose up -d postgres`
  - `REO_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm test:db`
  - Database tests create and drop their own `reo_test_*` databases and roles.
- **M1_PLAN:** row M1-B becomes "in progress: schema/RLS/migration runner in #96 part 1; OIDC pending".
- **RESUME:** the next slice is #96 part 2 (OIDC/session) once the provider is chosen, or #97 middleware on top of this schema.

- [ ] **Step 1: Verify compose works.** Run `docker compose up -d postgres`, then `REO_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm test:db`. Expected: all pass. Then run `docker compose down -v`.
- [ ] **Step 2: Write the ADR and doc updates.**
- [ ] **Step 3: Run the full checks.** Run `pnpm lint && pnpm security:source && pnpm check && pnpm test:db` and the Python tests. All must be clean.
- [ ] **Step 4: Commit** with message `docs: ADR 0010 tenant persistence, local database and status`.
