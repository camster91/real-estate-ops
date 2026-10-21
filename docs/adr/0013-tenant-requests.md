# ADR 0013: Tenant-scoped API requests

Status: Implemented for synthetic data. Supports #96 (part 3). The owner approved the plan in #132.

## Decision

1. **The organisation is in the URL.** Tenant routes live under `/v1/organizations/:organizationId/...`. Every request checks the id against the session's active memberships (`app.session_memberships`). There is no stored "current organisation", so two tabs can work in two organisations safely and nothing can go stale.
2. **Outsiders get 404.** A malformed id, an id that is not lower-case, an unknown organisation, or one where the person has no active membership all return 404 `not_found`. The response never says whether the organisation exists.
3. **Purposes are code constants.** Branch listing runs with the purpose `operations`. A purpose is never read from the request.
4. **Same-origin writes only.** Every request with a method other than GET, HEAD and OPTIONS must carry `Origin` exactly equal to `REO_PUBLIC_URL`, or it gets 403 `forbidden_origin`. This applies whatever the path: a path-based check would miss encoded spellings such as `/auth/%6Cogout`, which the router decodes (found in review). A route can opt out only through its own `config.allowCrossOrigin`, meant for a future signed provider webhook. This is the CSRF defence for cookie-authenticated writes, on top of `SameSite=Lax`. It relies on browsers sending `Origin`, which they do on every POST. A non-browser client cannot borrow someone's cookie across sites anyway. The hook is registered at the root, so it also covers routes added later.

## Request flow

1. The session cookie is checked by `requireSession` → `app.session_principal`. This refreshes the idle timer and ends the session if the person has no active membership left. On success, `request.principalId` is set.
2. `inTenant(pool, request, purpose, work)` checks `:organizationId` against `app.session_memberships`, then runs `work` inside `withTenant` with a `TenantContext` built only from those two results.
3. Inside the transaction, RLS still applies. The `decide(action, resourceType, resource)` helper calls `authorizeInTenant` on the same transaction, so grants are read fresh on every decision.

The first route is `GET /v1/organizations/:organizationId/branches`. It returns `{ branches: [{ id, name, version }] }`, ordered by name, with at most 200 rows and `Cache-Control: no-store`.

## Evidence

- `apps/api/src/auth/guard.db.test.ts` (Origin cases and `requireSession`).
- `apps/api/src/tenant/routes.db.test.ts`:
  - a member sees only their own branches
  - another organisation gives 404
  - a member of two organisations sees each one separately
  - suspension in one organisation leaves the session working for the other
  - malformed, upper-case, padded and unknown ids give 404
  - no session, and login switched off, give 401
  - granted, ungranted, revoked and wrong-purpose records are decided correctly through the real session
  - logs contain no organisation ids or tokens
- Encoded and absolute-form spellings (`/auth/%6Cogout`, `/auth/logou%74`, `/%761/...`, a fragment, `http://host/auth/logout`) are still origin-checked.
- Mutation checks: removing the membership check, matching Origin by prefix, or accepting upper-case ids each fails a named test.

## Not done

- Write routes, and therefore audit and outbox wiring (#98).
- The task model and the "assigned work summary" slice.
- Role grants (#24).
- A web sign-in page and organisation picker.

## Rollback

Revert the PR. There is no schema change.
