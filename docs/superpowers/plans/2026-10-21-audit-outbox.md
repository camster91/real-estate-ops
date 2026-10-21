# Audit Events and Transactional Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every future state change writes a minimised audit event and an outbox event in the same database transaction as the change itself, so nothing is changed without a record, and no event exists for a change that rolled back.

**Architecture:**
- **Migration `0005_audit_outbox.sql`:**
  - `audit_event` is append-only. The runtime role may only INSERT, and only for its own tenant and principal. A trigger blocks UPDATE, DELETE and TRUNCATE for every role.
  - `outbox_event` is insert-only for the runtime role. Publishing (#84) comes later.
- **`@reo/db` `recordChange(client, change)`:** writes both rows on the caller's `withTenant` client. It takes the tenant, actor and purpose from the transaction's context, never from arguments.
- **`minimiseDetails(details)`:** a pure function that keeps only short primitive values and replaces sensitive-named keys with `"[redacted]"` before anything is stored.

**Tech Stack:** PostgreSQL 16, `pg`, Vitest 5. No new dependencies.

**Spec:**
- `AGENTS.md`: "Outbox/event pattern for state changes that trigger async work"; "All external writes must be retriable and auditable"; "No secrets in source control or logs".
- ADR 0004: "Write domain mutation, minimized AuditEvent and DomainEvent/outbox within one PostgreSQL transaction … stable event IDs, aggregate version, event schema version, actor, correlation and causation IDs. Do not place full PII or document contents in event payloads."
- ADR 0005: "Database grants/triggers make audit append-only for application identities."
- `docs/platform/M1_PLAN.md` M1-D: "Rollback leaves no partial mutation/event".
- Issues #98 (audit and sensitive-field redaction) and #84 (outbox, writer side only).
- Owner decision (21 October 2026): build this foundation first, then tasks.

**Out of scope:**
- Reading audit events (BOR/admin view).
- The outbox publisher, consumers and receipts (#84 part 2).
- The hash chain and external checkpoints (ADR 0005; needs storage from #99/#101).
- Retention purge.
- Any API route. Tasks (the next plan) are the first caller.

## Decisions for owner approval

1. **The app can write history but never read, edit or delete it.** Even a database administrator's UPDATE or DELETE is blocked by a trigger. Changing history later would need a reviewed migration.
2. **Fail-safe redaction.** Details whose names look sensitive (`email`, `phone`, `name`, `address`, `birth`, `social`, `note`, `body`, `message`, `token`, `secret`, `password`, `account`, or exactly `sin`) are stored as `"[redacted]"`. Nested objects are dropped. Text is cut to 200 characters. At most 20 keys are kept.
3. **Event payloads hold ids and codes only**, under the same minimisation, so no personal details travel to future consumers.

## Global Constraints

- Strict TypeScript, Biome, exact pins, forward-only migrations. Do not edit `0001`–`0004`.
- Both tables use `ENABLE` and `FORCE ROW LEVEL SECURITY`, composite `(organization_id, id)` primary keys, and policies in the `(SELECT app.fn())` shape.
- `reo_app` gets INSERT only: no SELECT, UPDATE or DELETE on either table.
- `recordChange` never takes `organizationId`, `principalId` or `purpose` from its caller. It reads `app.current_organization_id()`, `app.current_principal_id()` and `app.current_purpose()` inside the transaction.
- Use synthetic data and Canadian spelling.

## Review Focus

1. **Rollback.** A change, its audit row and its outbox row all disappear together when the transaction fails after `recordChange`. Test in Task 2.
2. **Forged tenant or actor.** A runtime insert naming another organisation or another principal is refused by RLS. Test in Task 1.
3. **Tampering.** UPDATE, DELETE and TRUNCATE on `audit_event` fail for `reo_app` and for the table owner. Test in Task 1.
4. **Personal data in details.** Emails, names and nested objects never reach the stored row. Test in Task 2.
5. **Called outside `withTenant`.** `recordChange` with no tenant context fails, and nothing is written. Test in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/migrations/0005_audit_outbox.sql` | Tables, RLS, grants, immutability trigger |
| `packages/db/src/audit.ts` | `minimiseDetails`, `recordChange` |
| `packages/db/src/audit.test.ts` | Unit tests for `minimiseDetails` |
| `packages/db/src/audit.db.test.ts` | Database tests |
| `packages/db/src/index.ts` (modify) | Exports |
| `docs/adr/0014-audit-outbox.md` + doc updates | Decisions, evidence |

---

### Task 1: Audit and outbox tables

**Files:**
- Create: `packages/db/migrations/0005_audit_outbox.sql`, `packages/db/src/audit.db.test.ts`

**Interfaces:**
- **`audit_event` columns:**
  - `organization_id uuid NOT NULL REFERENCES organization`
  - `id uuid NOT NULL DEFAULT gen_random_uuid()`
  - `occurred_at timestamptz NOT NULL DEFAULT now()`
  - `actor_principal_id uuid NOT NULL REFERENCES principal`
  - `action text NOT NULL CHECK (action ~ '^[a-z][a-z_]{0,40}\.[a-z][a-z_]{0,40}$')`
  - `resource_type text NOT NULL CHECK (resource_type ~ '^[a-z][a-z_]{0,62}$')`
  - `resource_id uuid NOT NULL`
  - `purpose text NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9_]{0,63}$')`
  - `correlation_id uuid NOT NULL`
  - `details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 4096)`
  - `PRIMARY KEY (organization_id, id)`
- **`outbox_event` columns:**
  - `organization_id`, `id` and `created_at` (same pattern as above)
  - `event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z_]{0,40}\.[a-z][a-z_]{0,40}$')`
  - `schema_version int NOT NULL CHECK (schema_version >= 1)`
  - `aggregate_type` (same check as `resource_type`)
  - `aggregate_id uuid NOT NULL`
  - `aggregate_version int NOT NULL CHECK (aggregate_version >= 1)`
  - `actor_principal_id`
  - `correlation_id uuid NOT NULL`
  - `causation_id uuid`
  - `payload jsonb` (same object and size checks as `details`)
  - `published_at timestamptz`
  - `UNIQUE (organization_id, aggregate_type, aggregate_id, aggregate_version, event_type)`
  - `PRIMARY KEY (organization_id, id)`
- **Policies:** `FOR INSERT TO reo_app WITH CHECK (organization_id = (SELECT app.current_organization_id()) AND actor_principal_id = (SELECT app.current_principal_id()) AND (SELECT app.has_active_membership()))`. There are no SELECT, UPDATE or DELETE policies for `reo_app`.
- **Trigger:** `app.audit_event_immutable()` as `BEFORE UPDATE OR DELETE` (row) and `BEFORE TRUNCATE` (statement) on `audit_event`. It raises `insufficient_privilege` (`42501`) with the message `'audit_event is append-only'`.

- [ ] **Step 1: Write the failing tests** in `audit.db.test.ts`. Use `createTestDatabase`, `seedTwoTenants` and `withTenant` as `pa` in A with purpose `operations`.
  - `runtime role inserts its own audit and outbox rows`: inserts with `organization_id = orgA` and `actor = pa` succeed, and the admin sees one row in each table.
  - `forged tenant or actor is refused` (Review Focus 2): `it.each` over org B, principal `pb`, and principal `approver`. Each insert gives `42501`.
  - `inactive member cannot write`: suspend `pa` in A, then an insert gives `42501`. Restore afterwards.
  - `runtime role cannot read, change or delete`: SELECT, UPDATE and DELETE on both tables give `42501`.
  - `audit is append-only even for the owner` (Review Focus 3): as admin, `UPDATE audit_event SET action = 'x.y'`, `DELETE FROM audit_event` and `TRUNCATE audit_event` each give `42501`.
  - `constraints hold`: a `details` value that is an array gives `23514`; a 5 KB `details` gives `23514`; an `action` of `Task.Create` gives `23514`; a duplicate `(aggregate, version, event_type)` outbox row gives `23505`.
  - `tables are forced and not owned by the runtime role`: the same shape as the existing check in `grants.db.test.ts`.
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test:db packages/db/src/audit`. Expected: `relation "audit_event" does not exist`.
- [ ] **Step 3: Implement** `0005_audit_outbox.sql`.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db` (all suites). Mutation spot-check: drop the trigger in a scratch copy, and the append-only test must fail. Restore afterwards.
- [ ] **Step 5: Commit** with message `feat(db): append-only audit events and transactional outbox tables`.

### Task 2: `recordChange` and `minimiseDetails`

**Files:**
- Create: `packages/db/src/audit.ts`, `packages/db/src/audit.test.ts`
- Modify: `packages/db/src/audit.db.test.ts`, `packages/db/src/index.ts`

**Interfaces:**
- Consumes: the Task 1 tables, and `withTenant` from `tenant.ts`.
- Produces:
  - `type DetailValue = string | number | boolean | null`
  - `minimiseDetails(input: Record<string, unknown>): Record<string, DetailValue>`, which:
    - keeps at most the first 20 keys, in insertion order
    - drops keys that do not match `/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/`
    - replaces the value with `"[redacted]"` when the key matches `/(e-?mail|phone|name|address|birth|dob|social|note|body|message|token|secret|password|account)/i`, or is exactly `sin` (any case). A bare `sin` pattern would also hit keys such as `closingDate`.
    - drops object, array, function, bigint and undefined values
    - drops non-finite numbers
    - truncates strings to 200 characters
  - `interface Change { action: string; resourceType: string; resourceId: string; details?: Record<string, unknown>; correlationId?: string; event: { type: string; schemaVersion: number; aggregateVersion: number; payload?: Record<string, unknown>; causationId?: string } }`
  - `recordChange(client: pg.PoolClient, change: Change): Promise<{ auditId: string; eventId: string; correlationId: string }>`, which:
    - inserts one `audit_event` and one `outbox_event`, using `app.current_organization_id()`, `app.current_principal_id()` and `app.current_purpose()` in SQL
    - passes `details` and `payload` through `minimiseDetails`
    - uses `correlationId` when given, otherwise a fresh `randomUUID()`
    - if the purpose, organisation or principal is NULL, throws `MissingTenantContextError` before inserting anything
  - Exported from `@reo/db`: `recordChange`, `minimiseDetails`, `MissingTenantContextError`, and the types `Change` and `DetailValue`.

- [ ] **Step 1: Write the failing tests.**
  - **`audit.test.ts` (unit):**
    - `keeps short primitives`: `{ status: "ready", count: 2, done: false, due: null }` is returned unchanged.
    - `redacts sensitive keys` (Review Focus 4): `{ email: "a@b.invalid", clientName: "X", phoneNumber: "1", accountNo: "9", SIN: "1" }` gives every value as `"[redacted]"`. `{ closingDate: "2026-11-01" }` is kept unchanged.
    - `drops nested and odd values`: `{ nested: { a: 1 }, list: [1], fn: () => 1, big: 1n, inf: Infinity, undef: undefined }` gives `{}`.
    - `truncates long text`: a 500-character string comes back as 200 characters.
    - `limits keys`: 30 keys come back as the first 20.
    - `drops odd key names`: `{ "bad key": 1, "1x": 2 }` gives `{}`.
  - **`audit.db.test.ts` (add):**
    - `change, audit and event commit together`: inside `withTenant`, `pa` inserts a branch, then calls `recordChange({ action: "branch.create", resourceType: "branch", resourceId, details: { name: "Synthetic", status: "new" }, event: { type: "branch.created", schemaVersion: 1, aggregateVersion: 1, payload: { branchId: resourceId } } })`. After commit, the admin sees:
      - the branch
      - one audit row with `actor_principal_id = pa`, `purpose = 'operations'` and `details = {"name":"[redacted]","status":"new"}`
      - one outbox row with the same `correlation_id` and `published_at` NULL
    - `rollback leaves nothing` (Review Focus 1): the same flow, but the work throws after `recordChange`. The admin counts zero new branch, audit and outbox rows.
    - `outside a tenant context fails` (Review Focus 5): `recordChange` on a plain `pool.connect()` client inside `BEGIN` rejects with `MissingTenantContextError`, and no rows are written.
    - `given correlation id is kept`.
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test packages/db/src/audit` and `pnpm test:db packages/db/src/audit`. Expected: module `./audit.js` not found.
- [ ] **Step 3: Implement** `audit.ts` and the exports.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test`, `pnpm test:db`, `pnpm lint` and `pnpm check`.
- [ ] **Step 5: Commit** with message `feat(db): recordChange writes minimised audit and outbox rows in the caller's transaction`.

### Task 3: ADR and docs

**Files:**
- Create: `docs/adr/0014-audit-outbox.md`
- Modify: `docs/roadmap/RESUME.md`, `docs/platform/M1_PLAN.md`, `docs/platform/LOCAL_DEVELOPMENT.md` (only if commands change)

**Content:**
- **ADR 0014:**
  - the three decisions above
  - the table shapes
  - why the trigger also covers the owner
  - the redaction rules
  - how `recordChange` reads its context
  - evidence, what is not done (reader, publisher and consumers, hash chain and checkpoints, retention), and rollback
- **RESUME and M1_PLAN:** M1-D writer side done. Next: tasks (#44, the "my tasks" slice) as the first caller.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run the full checks.** Run `pnpm lint && pnpm security:source && pnpm check && pnpm test:db`, the Python tests and `pnpm audit --audit-level high`. All must be clean.
- [ ] **Step 3: Commit** with message `docs: ADR 0014 audit events and outbox`.
