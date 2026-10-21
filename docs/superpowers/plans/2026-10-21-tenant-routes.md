# Tenant Selection and First Tenant Route (#96, part 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in member picks an organisation per request and reads that organisation's data through `withTenant`, with record decisions through `authorizeInTenant`, so sign-in becomes usable end to end.

**Architecture:**
- **Session guard:** one Fastify `preHandler`, `requireSession`, turns the session cookie into `request.principalId` (via `app.session_principal`) or replies 401. `/v1/session` is refactored onto it.
- **Tenant selection:** the organisation is in the URL: `/v1/organizations/:organizationId/...`. Each request checks it against `app.session_memberships`. There is no stored "current organisation", so two tabs can work in two organisations safely. A non-member or malformed id gets **404** `not_found`, so an organisation's existence is not revealed.
- **Tenant work:** `inTenant(request, purpose, work)` builds the `TenantContext` only from the verified principal and the checked organisation, never from headers. It runs `withTenant`, and passes `work` a `decide(action, resourceType, resource)` helper that calls `authorizeInTenant` on the same client.
- **First route:** `GET /v1/organizations/:organizationId/branches` lists that organisation's branches. RLS already limits branches to the tenant and to active members.
- **Origin guard:** unsafe methods (anything but GET, HEAD and OPTIONS) on `/v1/*` and `/auth/logout` require `Origin` to equal `REO_PUBLIC_URL`, otherwise 403 `forbidden_origin`. This is the CSRF defence for cookie-authenticated writes, on top of `SameSite=Lax`.

**Tech Stack:** Fastify 5, `@reo/db` (`withTenant`, `authorizeInTenant`), PostgreSQL 16, Vitest 5. No new dependencies.

**Spec:**
- Issue #96: "verified OIDC/session boundary and tenant-scoped persistence".
- `docs/platform/M1_PLAN.md`:
  - row M1-C: "approved memberships … scope-escalation tests; CSRF … where applicable"
  - "Suggested first vertical slice": "Unauthorized membership/cross-tenant requests return safe errors".
- ADR 0001 (tenancy), ADR 0003 ("Authorize the authenticated principal, active tenant membership, … purpose").
- ADR 0010 (`withTenant`): "Build it only from a verified session and membership lookup, never from request input".
- ADR 0011 (`authorizeInTenant`: one decision per short transaction), ADR 0012 (sessions).

**Out of scope:**
- Any write route or new business table. The "assigned work summary" needs the task model, which is not accepted yet.
- A web UI.
- Role grants (#24).
- Audit events (#98).
- The six deferred minors from the #130 review.

## Decisions for owner approval

1. **The organisation goes in the URL**, checked on every request. There is no "switch organisation" state.
2. **A non-member or unknown organisation gets 404**, not 403.
3. **Branch listing uses the purpose `operations`.** Purposes only matter for record grants; branches have none.
4. **The Origin check** protects every cookie-authenticated write.

## Global Constraints

- Node `>=24.19.0 <25`, pnpm `11.25.0`, strict TypeScript, Biome, exact pins. No new dependencies; move `@reo/db` from `devDependencies` to `dependencies` in `apps/api`.
- `TenantContext` comes only from `session_principal`, `session_memberships` and a purpose that is a code constant. Never from headers, query or body.
- Without login configured, every `/v1/*` route stays 401. `/health/ready` stays 503. Production stays refused.
- Error bodies are fixed codes: `authentication_required`, `not_found`, `forbidden_origin`. Logs never contain tokens, organisation ids from the URL, or record contents.
- No migration is needed. If one turns out to be needed, it is `0005` and forward-only.
- Use synthetic data and Canadian spelling.

## Review Focus

1. **Member of two organisations.** Selecting B shows only B's branches, and selecting A shows only A's. Test in Task 2.
2. **Membership suspended in one organisation only.** A request for that organisation gets 404 and the session keeps working for the other. Test in Task 2.
3. **Malformed or odd-case organisation id** (`not-a-uuid`, upper-case UUID, a UUID with a trailing space). Each gets 404, never 500 (`InvalidTenantContextError`). Test in Task 2.
4. **Cross-site write.** A POST to `/auth/logout` with a valid session but no or a foreign `Origin` gets 403 and the session stays live. Test in Task 1.
5. **Grants checked through HTTP.** In a test-only route, a granted record gives `allow`, and an ungranted, revoked or wrong-purpose record gives `deny`, all through the real session. Test in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/auth/guard.ts` | `requireSession` preHandler, `request.principalId`, `sessionHash(request)`, Origin guard hook |
| `apps/api/src/auth/routes.ts` (modify) | `/v1/session` uses `requireSession`; registers the guard hook |
| `apps/api/src/tenant/context.ts` | `inTenant()` tenant selection, `withTenant` and the `decide` helper |
| `apps/api/src/tenant/routes.ts` | `GET /v1/organizations/:organizationId/branches` |
| `apps/api/src/server.ts` (modify) | Registers tenant routes when auth is on |
| `apps/api/src/auth/guard.db.test.ts`, `apps/api/src/tenant/routes.db.test.ts` | HTTP tests |
| `docs/adr/0013-tenant-requests.md` + doc updates | Decisions, evidence |

A small test helper, `signInAs(app, fake, subject)`, moves from `routes.db.test.ts` into `apps/api/src/auth/testing.ts` (test-only, excluded from the build like the fake issuer) so both new test files can use it.

---

### Task 1: Session guard and Origin check

**Files:**
- Create: `apps/api/src/auth/guard.ts`, `apps/api/src/auth/guard.db.test.ts`, `apps/api/src/auth/testing.ts`
- Modify: `apps/api/src/auth/routes.ts`, `apps/api/src/auth/routes.db.test.ts` (use `testing.ts`; logout tests send `Origin`), `apps/api/tsconfig.json` (exclude `src/**/testing.ts` and `src/**/fake-issuer.ts` from the build)

**Interfaces:**
- Produces:
  - `declare module "fastify" { interface FastifyRequest { principalId?: string } }`
  - `requireSession(pool: pg.Pool): preHandlerAsyncHookHandler`: sets `request.principalId`, or replies 401 `{ error: "authentication_required" }` with `Cache-Control: no-store`.
  - `sessionHash(request: FastifyRequest): Buffer | undefined`: SHA-256 of a well-formed session cookie (moved from `routes.ts`).
  - `originGuard(publicUrl: string): onRequestAsyncHookHandler`: for methods other than GET, HEAD and OPTIONS on paths starting with `/v1/` or equal to `/auth/logout`, requires `request.headers.origin === publicUrl`; otherwise 403 `{ error: "forbidden_origin" }`.
  - `signInAs(app: FastifyInstance, fake: FakeIssuer, subject: string): Promise<string>`: returns the session token (test-only).

- [ ] **Step 1: Write the failing tests** in `guard.db.test.ts`, with the same setup as `routes.db.test.ts`:
  - `logout needs a same-origin request` (Review Focus 4), `it.each` over:
    - no `Origin` → 403
    - `Origin: http://evil.invalid` → 403
    - `Origin: http://127.0.0.1:4000/` (trailing slash) → 403
    - `Origin: null` → 403

    After each, `/v1/session` with the same token is still 200. With `Origin: http://127.0.0.1:4000` the logout gives 204.
  - `unsafe /v1 methods need the origin`: `POST /v1/contacts` with a valid session and no Origin gives 403. With the right Origin it gives 401, because the route does not exist behind the catch-all.
  - `safe methods are not origin-checked`: `GET /v1/session` without Origin gives 200.
  - `requireSession sets the principal`: a test route `GET /v1/test/whoami` registered on the app before `ready()` returns `{ principalId }`, which equals `pa`. Without a cookie it returns 401.
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test:db apps/api`. Expected: the logout cases give 204 instead of 403.
- [ ] **Step 3: Implement** `guard.ts`, move `/v1/session` onto `requireSession`, register `originGuard` inside `registerAuthRoutes`, add `testing.ts`, and update the existing logout tests to send the right Origin.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db`, `pnpm test`, `pnpm lint` and `pnpm typecheck`. Also run `pnpm build`, then check that `dist` contains neither `fake-issuer.js` nor `testing.js`.
- [ ] **Step 5: Commit** with message `feat(api): session guard and origin check for cookie-authenticated writes`.

### Task 2: Tenant selection, `inTenant` and the branches route

**Files:**
- Create: `apps/api/src/tenant/context.ts`, `apps/api/src/tenant/routes.ts`, `apps/api/src/tenant/routes.db.test.ts`
- Modify: `apps/api/src/server.ts`, `apps/api/package.json` (move `@reo/db` to `dependencies`), `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `requireSession` and `sessionHash` (Task 1); `withTenant`, `authorizeInTenant` and `TenantContext` from `@reo/db`; `app.session_memberships`.
- Produces:
  - `interface TenantWork { client: pg.PoolClient; context: TenantContext; decide(action: Action, resourceType: string, resource: Resource): Promise<Decision> }`
  - `inTenant<T>(pool: pg.Pool, request: FastifyRequest, purpose: string, work: (tenant: TenantWork) => Promise<T>): Promise<T | typeof NOT_MEMBER>`. Requires `request.principalId` (set by `requireSession`). Reads `request.params.organizationId`, which must match `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` (lower-case only). The id must be in `session_memberships(sessionHash)`; otherwise the function returns the `NOT_MEMBER` symbol without opening a transaction.
  - `registerTenantRoutes(app: FastifyInstance, options: { pool: pg.Pool }): Promise<void>`: adds `GET /v1/organizations/:organizationId/branches`, which returns `{ branches: [{ id, name, version }] }` ordered by `name, id` with `LIMIT 200`, purpose `"operations"`, `Cache-Control: no-store`. `NOT_MEMBER` gives 404 `{ error: "not_found" }`.
  - `server.ts` registers `registerTenantRoutes` only when `auth` is given, after the auth routes.

- [ ] **Step 1: Write the failing tests** in `tenant/routes.db.test.ts`. Use the fake issuer, `seedTwoTenants` and `signInAs`. The fixture adds a second branch to A, named `"Synthetic Branch A2"`.
  - `member lists their organisation's branches`: `pa` reading `/v1/organizations/{orgA}/branches` gets 200, `no-store`, and the two A branches by name. Nothing from B appears.
  - `other organisation is 404` for `pa` reading B.
  - `member of two organisations sees each separately` (Review Focus 1): give `pa` an active membership in B (approved by `approver`). A lists only A's branches; B lists only B's. Remove the membership afterwards.
  - `suspended in one organisation only` (Review Focus 2): `pa` is active in B and suspended in A. A gives 404, B gives 200, and `/v1/session` gives 200 with only B.
  - `malformed organisation ids are 404` (Review Focus 3): `it.each` over `not-a-uuid`, the upper-case form of `orgA`, `${orgA}%20`, and `00000000-0000-0000-0000-000000000000`. Each gives 404 `not_found`.
  - `no session is 401 and login-off is 401`: no cookie gives 401. `createServer()` without auth gives 401 for the same path.
  - `grants are decided through the session` (Review Focus 5): register a test-only route `GET /v1/organizations/:organizationId/fixture/:id` (purpose `client_service`) that calls `inTenant`, then `decide("record.read", "fixture_record", { tenantId, id, classification: "operational" })` and returns `{ allowed: decision.allowed }`. It runs against the `fixture_record` table and grant shape from `packages/db/src/grants.db.test.ts`. Assert:
    - a granted record gives `allowed: true`
    - an ungranted record gives `allowed: false`
    - after the grant is revoked (`revoked_at = now()`), it gives `allowed: false`
    - a route variant with purpose `marketing` gives `allowed: false` for the granted record
  - `logs carry no organisation ids or tokens`: capture stdout around one branches request. It contains neither `orgA` nor the token.
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test:db apps/api`. Expected: 401 from the catch-all, because the route does not exist.
- [ ] **Step 3: Implement** `context.ts`, `routes.ts` and the `server.ts` wiring.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db`, `pnpm test`, `pnpm lint` and `pnpm check`. Mutation spot-checks, each restored afterwards:
  - Skip the `session_memberships` check in `inTenant`. Expected: "other organisation is 404" fails.
  - Drop the lower-case UUID check. Expected: the upper-case case returns 200 or 500 instead of 404.
- [ ] **Step 5: Commit** with message `feat(api): tenant selection and the first tenant-scoped route`.

### Task 3: ADR and docs

**Files:**
- Create: `docs/adr/0013-tenant-requests.md`
- Modify: `docs/platform/LOCAL_DEVELOPMENT.md`, `docs/roadmap/RESUME.md`, `docs/platform/M1_PLAN.md`, `docs/adr/0011-record-grants.md` ("Not done": API wiring is now done)

**Content:**
- **ADR 0013:**
  - the four decisions above
  - the request flow (cookie → `session_principal` → `session_memberships` → `withTenant` → RLS and `decide`)
  - why there is no stored current organisation
  - the Origin guard and its limits (it relies on browsers sending `Origin`; non-browser clients cannot ride a session cookie cross-site)
  - evidence, what is not done, and rollback
- **RESUME and M1_PLAN:** the first tenant-scoped read is wired. Next: the task model and the "assigned work summary" vertical slice, plus web sign-in.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run the full checks.** Run `pnpm lint && pnpm security:source && pnpm check && pnpm test:db`, the Python tests and `pnpm audit --audit-level high`. All must be clean.
- [ ] **Step 3: Commit** with message `docs: ADR 0013 tenant-scoped requests`.
