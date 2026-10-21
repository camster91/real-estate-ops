# OIDC Login and Sessions (#96, part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff sign in with Google or Microsoft through a verified OpenID Connect (OIDC) flow, and the API keeps a server-side session. Only people who already have an active membership get in. Everything is tested against a fake local identity provider, because the real Google and Microsoft app registrations do not exist yet.

**Architecture:**
- **Login flow:** `apps/api` runs the authorization-code flow with PKCE, `state` and `nonce`, using `openid-client`. The temporary login values live in a short-lived, signed, HttpOnly cookie.
- **Identity lookup:** After the ID token is verified, a narrow `SECURITY DEFINER` database function owned by a new NOLOGIN role, `reo_auth`, maps `(issuer, subject)` to a principal. It refuses anyone without an active membership.
- **Sessions:** a random 32-byte token goes in a `__Host-` cookie. The database stores only its SHA-256 hash, with absolute and idle expiry and revocation.
- **No auto-provisioning:** an unknown person is refused.

**Tech Stack:** Fastify 5, `openid-client` 6.8.8, `@fastify/cookie` 11.1.2, `jose` 6.2.12 (test-only fake issuer), PostgreSQL 16, Vitest 5.

**Spec:**
- Issue #96, criterion "Implement approved memberships, verified OIDC/session boundary and tenant-scoped persistence".
- `docs/adr/0001-tenancy-and-authority.md`.
- `docs/product/CORE_MODEL.md`: "OIDC issuer + subject uniquely identifies principal; invited membership is approved, never provisioned merely by email domain".
- `docs/platform/M1_PLAN.md` row M1-C: "Verified Google/Microsoft OIDC issuer/audience/signature/expiry, secure sessions… Forged/expired/revoked identity, inactive membership… CSRF/state/nonce/PKCE".
- ADRs 0010 and 0011.
- Owner decision (20 October 2026): both providers, built and tested with a synthetic issuer first.

**Out of scope:**
- Real provider registrations and secrets (owner action, documented in Task 5).
- The membership invite and approval admin path.
- Choosing a tenant when a person belongs to several (the session lists memberships; tenant selection comes with the first tenant route).
- Wiring `withTenant` or `authorizeInTenant` into routes.
- Multi-factor policy (delegated to the identity provider and documented).

## Decisions for owner approval

These are recorded in ADR 0012:

1. **Library:** `openid-client` 6.8.8, a certified OpenID Connect library. We do not hand-roll token validation.
2. **Accepted issuers:** Google is `https://accounts.google.com`. Microsoft accepts only the configured Entra tenant IDs (`https://login.microsoftonline.com/<tenant>/v2.0`), never "common" or any other tenant. An optional Google Workspace domain allow-list (the `hd` claim) is supported.
3. **No sign-in without an approved membership.** Signing in never creates a person or a membership. Email address and domain are never used to grant access.
4. **Sessions:**
   - The token is stored server-side as a hash only.
   - Lifetimes are 12 hours absolute and 30 minutes idle.
   - Logout revokes the session.
   - Losing an active membership ends the session on the next request.
   - The cookie is `__Host-reo_session` with `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/`.
5. **`reo_auth` role:** a NOLOGIN role that owns the five session and identity functions and is the only role allowed to see `principal` and `auth_session` without a tenant context. The runtime role `reo_app` can only EXECUTE those functions.

## Global Constraints

- Node `>=24.19.0 <25`, pnpm `11.25.0`, exact pins, strict TS, Biome. Use only these new dependencies:
  - `openid-client@6.8.8` and `@fastify/cookie@11.1.2` (apps/api)
  - `jose@6.2.12` (apps/api devDependency)
- Migrations are forward-only. Do not edit `0001` or `0002`. New tables get `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- `NODE_ENV=production` stays refused, and the API binds to loopback only.
- Login routes are **disabled (404)** for any provider without complete configuration.
- Logs never contain tokens, codes, cookies, claims or email addresses. The existing redaction stays, and new log lines carry only an outcome code.
- All `/v1/*` routes except `/v1/session` stay 401. `/health/ready` stays 503.
- Use synthetic identities only in tests and Canadian spelling in docs.

## Review Focus

1. **Replayed callback.** Reusing a callback URL (same `code` and `state`) after a successful login must fail and must not create a second session. Test in Task 4.
2. **Login cookie tampering.** A changed, missing or expired login cookie (state, nonce or PKCE verifier) must fail closed with 400 and no session. Test in Task 4.
3. **Membership loss after login.** If the person's last active membership is suspended, the existing session must stop working on the next request. Test in Task 1 (database) and Task 4 (HTTP).
4. **Microsoft issuer from another tenant.** A token from an unlisted Entra tenant must be refused even when the signature is valid. Test in Task 2.
5. **Idle and absolute expiry.** Each must end the session independently. Test in Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/migrations/0003_auth_sessions.sql` | The `reo_auth` role, the `auth_session` table, and five `SECURITY DEFINER` functions |
| `packages/db/src/sessions.db.test.ts` | Database tests for identity resolution and sessions |
| `packages/config/src/index.ts` (modify) | `readAuthConfig(env)` |
| `apps/api/src/auth/oidc.ts` | `createOidcLogin(provider)`: builds the start URL and verifies the callback |
| `apps/api/src/auth/fake-issuer.ts` | Test-only fake OIDC issuer (discovery, JWKS, token endpoint) |
| `apps/api/src/auth/routes.ts` | Login, callback, logout and `/v1/session` routes, plus cookies |
| `apps/api/src/server.ts` (modify) | Registers the auth routes when configured; takes an optional database pool |
| `apps/api/src/auth/*.test.ts` | Unit and HTTP tests (HTTP ones are `*.db.test.ts`) |
| `docs/adr/0012-oidc-sessions.md`, `docs/platform/LOCAL_DEVELOPMENT.md`, `docs/platform/IDP_SETUP.md` | Decisions, how to run locally, owner setup steps |

---

### Task 1: Session and identity storage

**Files:**
- Create: `packages/db/migrations/0003_auth_sessions.sql`, `packages/db/src/sessions.db.test.ts`

**Interfaces:**
- Consumes: `seedTwoTenants`, `createTestDatabase` and the 0001 tables.
- Produces SQL functions. All are `SECURITY DEFINER`, owned by `reo_auth`, use `SET search_path = pg_catalog, public`, and grant `EXECUTE` only to `reo_app`:
  - `app.resolve_principal(issuer text, subject text) RETURNS uuid`. Returns the principal id only if it has at least one active membership (same rule as `has_active_membership`), otherwise NULL.
  - `app.open_session(principal uuid, token_hash bytea) RETURNS timestamptz`. Inserts a session and returns its absolute expiry.
  - `app.session_principal(token_hash bytea) RETURNS uuid`. Returns the principal for a valid session and updates `last_seen_at`. Valid means:
    - not revoked
    - `now() < expires_at`
    - `now() < last_seen_at + interval '30 minutes'`
    - the principal still has an active membership

    Otherwise it returns NULL.
  - `app.close_session(token_hash bytea) RETURNS void`. Sets `revoked_at`.
  - `app.session_memberships(token_hash bytea) RETURNS SETOF uuid`. For a session that `session_principal` would accept, returns the organisation ids where the principal has an active membership; otherwise no rows. It does not update `last_seen_at`.

The migration defines:
- **`reo_auth` role:** NOLOGIN NOSUPERUSER NOBYPASSRLS. Use the same `DO` / `EXCEPTION WHEN duplicate_object OR unique_violation` pattern as 0001.
- **`auth_session` table:**
  - Columns: `token_hash bytea PRIMARY KEY CHECK (length(token_hash) = 32)`, `principal_id uuid NOT NULL REFERENCES principal`, `created_at timestamptz NOT NULL DEFAULT now()`, `last_seen_at timestamptz NOT NULL DEFAULT now()`, `expires_at timestamptz NOT NULL`, `revoked_at timestamptz`.
  - `CHECK (expires_at = created_at + interval '12 hours')`.
- **RLS:** `ENABLE` and `FORCE`. Policies `TO reo_auth` only:
  - `principal`: SELECT `USING (true)`
  - `membership`: SELECT `USING (true)`
  - `auth_session`: SELECT, INSERT and UPDATE `USING (true) WITH CHECK (true)`
- **Grants:**
  - `reo_auth` gets SELECT on `principal` and `membership`, and SELECT, INSERT and UPDATE on `auth_session`.
  - `reo_app` gets nothing on `auth_session`, only EXECUTE on the five functions.
  - Set `ALTER FUNCTION … OWNER TO reo_auth` for each function.

- [ ] **Step 1: Write the failing tests** in `sessions.db.test.ts`. Run them as the `db.app` login, calling the functions directly. Seed `pa` with issuer `https://issuer.invalid` and subject `synthetic-a`.
  - `resolves a member's identity`: `resolve_principal('https://issuer.invalid','synthetic-a')` returns `pa`.
  - `refuses unknown or non-member identities`: an unknown subject returns NULL, and `pc` (no membership) returns NULL.
  - `refuses after the last membership is suspended`: admin suspends `pa`'s membership. The function returns NULL. Restore afterwards.
  - `opens and resolves a session`: `open_session(pa, sha256('t1'))` returns an expiry 12 hours after creation, and `session_principal(sha256('t1'))` returns `pa`.
  - `idle, absolute and revoked sessions end`: `it.each` over three cases. Each one sets up a session, ends it, then expects `session_principal` to return NULL.
    - admin sets `last_seen_at = now() - interval '31 minutes'`
    - admin sets `created_at` and `expires_at` into the past (keeping the CHECK satisfied)
    - `close_session` is called
  - `session ends when membership is lost`: suspend the membership, then `session_principal` returns NULL.
  - `runtime role cannot touch sessions directly`: as `db.app`, `SELECT/INSERT/UPDATE auth_session` gives `42501`. A `principal` lookup with no context still returns 0 rows.
  - `lists only active memberships`: give `pa` a second, suspended membership in org B; `session_memberships` returns only org A. A revoked session returns no rows.
  - `token hash must be 32 bytes`: `open_session(pa, '\x01')` gives `23514`.
- [ ] **Step 2: Run and verify they fail.** Expected: `function app.resolve_principal(...) does not exist`.
- [ ] **Step 3: Implement** `0003_auth_sessions.sql`.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db`: all pass. Then run a mutation spot-check by removing the membership condition from `session_principal`; the test must then fail. Restore it afterwards.
- [ ] **Step 5: Commit** with message `feat(db): auth sessions and identity resolution behind reo_auth`.

### Task 2: OIDC client and fake issuer

**Files:**
- Create: `apps/api/src/auth/oidc.ts`, `apps/api/src/auth/fake-issuer.ts`, `apps/api/src/auth/oidc.test.ts`
- Modify: `apps/api/package.json` (dependencies), `pnpm-lock.yaml`

**Interfaces:**
- Produces:
  - `interface ProviderConfig { name: "google" | "microsoft"; issuer: string; clientId: string; clientSecret: string; redirectUri: string; allowedIssuers: readonly string[]; allowedHostedDomains?: readonly string[] }`
  - `interface LoginStart { url: string; state: string; nonce: string; codeVerifier: string }`
  - `createOidcLogin(provider: ProviderConfig, options?: { allowInsecure?: boolean }): Promise<{ start(): LoginStart; finish(callbackUrl: URL, expected: { state: string; nonce: string; codeVerifier: string }): Promise<{ issuer: string; subject: string }> }>`
  - `finish` throws `LoginRejectedError` with a `reason` code. It never returns claims beyond `issuer` and `subject`.
  - `startFakeIssuer(): Promise<{ issuer: string; clientId: string; clientSecret: string; mint(claims: Partial<IdClaims>, options?: { key?: "other" }): void; close(): Promise<void> }>`. It serves discovery, JWKS, an authorization endpoint (redirects back with a code) and a token endpoint, on `127.0.0.1` with a random port. `mint` sets the claims for the next issued ID token.
- Use `openid-client` 6 APIs: `discovery`, `buildAuthorizationUrl`, `randomState`, `randomNonce`, `randomPKCECodeVerifier`, `calculatePKCECodeChallenge` and `authorizationCodeGrant`. `allowInsecure` maps to `allowInsecureRequests` and may only be used in tests.
- After the library validates the token, `finish` also checks:
  - `claims.iss` must be in `allowedIssuers`.
  - If `allowedHostedDomains` is set, `claims.hd` must be in it.
  - `sub` must be present.

- [ ] **Step 1: Write the failing tests** in `oidc.test.ts`. For each test: run the fake issuer, call `start()`, fetch `url` with `redirect: "manual"`, then call `finish(callbackUrl, …)`.
  - `completes a valid login`: returns `{ issuer: fake.issuer, subject: "synthetic-a" }`.
  - `rejects`, as `it.each` over these cases, each with `LoginRejectedError`:
    - wrong `state` in the callback
    - wrong `nonce` minted
    - `aud` set to another client
    - `exp` in the past
    - token signed with the `"other"` key
    - `iss` not in `allowedIssuers` (Review Focus 4: set `allowedIssuers` to a different tenant URL)
    - missing `hd` when `allowedHostedDomains` is `["example.invalid"]`
    - a `codeVerifier` that does not match the challenge
  - `never exposes email or name`: the result keys are exactly `["issuer", "subject"]`.
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test`. Expected: module `./oidc.js` not found.
- [ ] **Step 3: Implement** both files and add the dependencies (`pnpm --filter @reo/api add --save-exact openid-client@6.8.8 @fastify/cookie@11.1.2` and `add -D --save-exact jose@6.2.12`).
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test` (these are unit tests that need no database), `pnpm lint` and `pnpm typecheck`.
- [ ] **Step 5: Commit** with message `feat(api): verified OIDC login client with a synthetic test issuer`.

### Task 3: Auth configuration

**Files:**
- Modify: `packages/config/src/index.ts`, `packages/config/src/index.test.ts`, `.env.example`

**Interfaces:**
- Produces:
  - `readAuthConfig(env): Readonly<{ publicUrl: string; cookieSecret: string; providers: readonly ProviderEnv[] }>`
  - `ProviderEnv = { name: "google" | "microsoft"; issuer: string; clientId: string; clientSecret: string; allowedIssuers: string[]; allowedHostedDomains?: string[] }`
- Environment variables:
  - `REO_PUBLIC_URL` (must be `http://127.0.0.1:<port>` or `http://localhost:<port>` while production is refused)
  - `REO_LOGIN_COOKIE_SECRET` (at least 32 characters)
  - Google: `REO_GOOGLE_CLIENT_ID`, `REO_GOOGLE_CLIENT_SECRET`, optional `REO_GOOGLE_HOSTED_DOMAINS` (comma-separated)
  - Microsoft: `REO_MICROSOFT_CLIENT_ID`, `REO_MICROSOFT_CLIENT_SECRET`, `REO_MICROSOFT_TENANT_IDS` (comma-separated UUIDs; required)
  - Test-only override: `REO_TEST_OIDC_ISSUER`
- A provider is enabled only when all its variables are present. A partly configured provider throws: `"Incomplete google login configuration"`, and the same pattern for microsoft.

- [ ] **Step 1: Write the failing tests**:
  - `no providers when nothing is set`: returns `providers: []`.
  - `google needs id and secret`: setting only the id throws `/Incomplete google/`.
  - `microsoft requires tenant ids and builds one issuer per tenant`: two tenant UUIDs give `allowedIssuers` with the two `https://login.microsoftonline.com/<id>/v2.0` URLs. `"common"` or a non-UUID throws.
  - `short cookie secret throws`.
  - `public URL must be loopback while production is refused`: `https://app.example.invalid` throws.
- [ ] **Step 2: Run and verify they fail.**
- [ ] **Step 3: Implement**, and document the variables (empty values, no secrets) in `.env.example`.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test` and `pnpm lint`.
- [ ] **Step 5: Commit** with message `feat(config): login provider and session configuration`.

### Task 4: Login, callback, logout and session routes

**Files:**
- Create: `apps/api/src/auth/routes.ts`, `apps/api/src/auth/routes.db.test.ts`
- Modify: `apps/api/src/server.ts` (`createServer(options?: { auth?: AuthOptions })`), `apps/api/src/index.ts`, `apps/api/package.json` (add `@reo/db: workspace:*`, `pg`)

**Interfaces:**
- Consumes:
  - `createOidcLogin` (Task 2)
  - `readAuthConfig` (Task 3)
  - The five SQL functions (Task 1)
  - `createTestDatabase` and `seedTwoTenants`
- Produces:
  - `interface AuthOptions { pool: pg.Pool; config: ReturnType<typeof readAuthConfig>; allowInsecureIssuer?: boolean }`
  - Routes are registered only for configured providers:
    - `GET /auth/:provider/login` returns 302 to the provider and sets `__Host-reo_login`. That cookie is signed with `cookieSecret`, HttpOnly, Secure, SameSite=Lax, Max-Age 600, and holds `{state, nonce, codeVerifier, provider}`.
    - `GET /auth/:provider/callback` verifies the login and calls `resolve_principal`. Then:
      - With no principal: 403 `{ error: "no_access" }` and no session.
      - Otherwise: it makes a token with `randomBytes(32)`, calls `open_session` with its SHA-256 hash, sets `__Host-reo_session` (HttpOnly, Secure, SameSite=Lax, Path=/), clears `__Host-reo_login`, and returns 302 to `/`.
    - `POST /auth/logout` calls `close_session`, clears the cookie, and returns 204.
    - `GET /v1/session` returns `{ principalId, memberships: [{ organizationId }] }` for a valid session, using `session_principal` then `session_memberships`. Otherwise it returns 401.
  - Unknown or unconfigured providers return 404. All other `/v1/*` routes stay 401.

- [ ] **Step 1: Write the failing tests** in `routes.db.test.ts`. Use the fake issuer, a migrated test database, `seedTwoTenants`, `pa` with subject `synthetic-a`, and `app.inject`. Carry the cookie between steps by hand.
  - `member logs in and sees their session`:
    - The login gives 302 and sets `__Host-reo_login`.
    - Follow the fake authorization endpoint to get the callback URL.
    - The callback gives 302 and a `__Host-reo_session` cookie with `HttpOnly`, `Secure` and `SameSite=Lax`.
    - `/v1/session` gives 200 with `principalId: pa` and A's membership.
  - `non-member is refused`: subject `synthetic-c` (`pc`) gives 403 `no_access`, and no session cookie is set.
  - `replayed callback is refused` (Review Focus 1): calling the same callback a second time gives 400. The `auth_session` row count does not change.
  - `tampered, missing or expired login cookie is refused` (Review Focus 2): `it.each` over a changed signature, no cookie, and a cookie for a different provider. Each gives 400 and no session.
  - `logout revokes`: after logout, `/v1/session` with the old cookie gives 401.
  - `membership loss ends the session` (Review Focus 3): admin suspends the membership, then `/v1/session` gives 401.
  - `unconfigured provider is 404 and other /v1 routes stay 401`.
  - `logs carry no secrets`: capture stdout during a full login. It must contain neither the session token, the code, `synthetic-a`, nor any `@`.
- [ ] **Step 2: Run and verify they fail.**
- [ ] **Step 3: Implement** `routes.ts` and wire it into `createServer`. Register `@fastify/cookie` with `secret: config.cookieSecret` so the login cookie is signed with `REO_LOGIN_COOKIE_SECRET`; a cookie whose signature does not verify is treated as missing.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test`, `pnpm test:db`, `pnpm lint` and `pnpm check`.
- [ ] **Step 5: Commit** with message `feat(api): OIDC login, server-side sessions and logout`.

### Task 5: ADR, local development and provider setup guide

**Files:**
- Create: `docs/adr/0012-oidc-sessions.md`, `docs/platform/IDP_SETUP.md`
- Modify: `docs/platform/LOCAL_DEVELOPMENT.md`, `docs/roadmap/RESUME.md`, `docs/platform/M1_PLAN.md`

**Content:**
- **ADR 0012:**
  - The five decisions above.
  - The cookie flags and lifetimes.
  - The `reo_auth` design.
  - Multi-factor authentication is enforced at Google or Microsoft by owner policy (state this as a requirement, not a claim).
  - What is not done.
  - Evidence and rollback.
- **IDP_SETUP:** step-by-step owner actions. Do not include any secrets.
  - **Google Cloud:** create an OAuth web client, add the redirect URI `<public>/auth/google/callback`, and optionally restrict to a Workspace domain.
  - **Microsoft Entra:** register a single-tenant app, add the redirect URI `<public>/auth/microsoft/callback`, create a client secret with an expiry, and note the tenant ID.
  - **Both:** keep secrets in a secret manager, never in git.
  - **Multi-factor:** require it in each provider's admin console.
- **LOCAL_DEVELOPMENT:** login is off unless configured. Explain how the tests use the fake issuer.
- **RESUME and M1_PLAN:** M1-C is implemented for synthetic identities. The real provider registration waits on the owner. Next: wire `withTenant` and `authorizeInTenant` into the first tenant route.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run the full checks.** Run `pnpm lint && pnpm security:source && pnpm check && pnpm test:db` and the Python tests. All must be clean.
- [ ] **Step 3: Commit** with message `docs: ADR 0012 OIDC sessions and provider setup guide`.
