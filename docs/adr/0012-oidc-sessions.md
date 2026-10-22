# ADR 0012: Staff sign-in with OIDC and server-side sessions

Status: Implemented for synthetic identities against a local test issuer. Supports #96 (part 2) without closing it. The owner approved the plan in #129. Real Google and Microsoft registrations are an owner action (`docs/platform/IDP_SETUP.md`).

## Decision

1. **Library.** `apps/api` uses `openid-client` 6.8.8 for the authorization-code flow with PKCE (S256), `state` and `nonce`. We do not hand-roll token validation. ID-token signatures are always checked against the provider's JWKS (`enableNonRepudiationChecks`): by default the library skips that check for tokens fetched from the token endpoint, which the spec allows but M1-C does not.
2. **Accepted issuers.**
   - Google: `https://accounts.google.com`. An optional Google Workspace allow-list (`REO_GOOGLE_HOSTED_DOMAINS`) requires a matching `hd` claim.
   - Microsoft: exactly one Entra tenant, `https://login.microsoftonline.com/<tenant>/v2.0`. `common`, `organizations`, `consumers` and the personal-account tenant are refused. The app registration is single-tenant.
   - After the library's checks (issuer, audience, signature, expiry, nonce, state, PKCE), the API also requires `iss` to be in the configured allow-list and `sub` to be present.
   - Only `scope=openid` is requested. A login yields `{issuer, subject}` and nothing else; email and name are never read or stored.
3. **No sign-in without an approved membership.** Signing in never creates a principal or a membership. Email address and domain never grant access. A verified identity with no active membership gets no session (now a redirect to `/?signin=no_access`, ADR 0016).
4. **Sessions.**
   - A random 32-byte token (base64url) goes in the `__Host-reo_session` cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`. The database stores only its SHA-256 hash.
   - Lifetimes: 12 hours absolute (a table CHECK) and 30 minutes idle (checked and refreshed on every request).
   - Logout (`POST /auth/logout`) revokes the session. Losing the last active membership revokes it on the next request; reinstating the membership does not revive it.
   - A new token is issued on every login, so a session ID cannot be fixed in advance.
   - The temporary login values (`state`, `nonce`, PKCE verifier, provider, issue time) live in `__Host-reo_login`, signed with `REO_LOGIN_COOKIE_SECRET`, `Max-Age` 600, also refused server-side after 600 seconds, and cleared on the callback whatever the outcome. The callback also claims a SHA-256 hash of the `state` through `app.claim_login_state` (migration `0004`) before redeeming the code, so a replayed callback is refused by us even if a provider would redeem a code twice. Claims older than an hour are deleted.
5. **`reo_auth` role.** A NOLOGIN, NOBYPASSRLS role owns six `SECURITY DEFINER` functions in migration `0003`: `resolve_principal`, `open_session`, `session_principal`, `session_memberships`, `close_session` and the internal `principal_is_active`. It is the only role with policies on `principal`, `membership` and `auth_session` outside a tenant context. `reo_app` has no table access to `auth_session` and may EXECUTE only the five public functions. `open_session` refuses principals without an active membership.

## Routes

| Route | Result |
|---|---|
| `GET /auth/{google,microsoft}/login` | 302 to the provider; sets the login cookie. 404 if that provider is not configured. |
| `GET /auth/{provider}/callback` | 302 to `/` with a session cookie. Failures are 302 redirects to `/?signin=failed` (any verification failure), `/?signin=unavailable` (provider unreachable) or `/?signin=no_access` (non-member), with no session (ADR 0016; before that, 400, 502 and 403 JSON). |
| `POST /auth/logout` | 204; revokes the session and clears the cookie. |
| `GET /v1/session` | `{principalId, memberships: [{organizationId}]}` or 401. |

All other `/v1/*` routes stay 401. All of these responses send `Cache-Control: no-store`. Login is off unless a provider is fully configured; a partly configured provider stops the API from starting. Logs carry only an outcome (`signed_in`, `no_access`, `login_cookie_invalid`, `login_state_reused`, or a rejection reason: `invalid_response`, `provider_error`, `provider_unavailable`, `issuer_not_allowed`, `hosted_domain_not_allowed`, `missing_subject`) and a fixed-format `code` (the library's error code, or the provider's OAuth error such as `access_denied`); never tokens, codes, cookies, claims, free text or email addresses. A database pool error is logged by its code only and does not stop the API.

## Multi-factor authentication

MFA must be enforced at Google Workspace and Microsoft Entra by owner policy. This is a requirement for go-live, not something this code can verify.

## Evidence

- `packages/db/src/sessions.db.test.ts`: identity resolution, non-members, suspension, idle, absolute and revoked expiry, membership loss, memberships list, runtime-role denial, hash length, ownership and role attributes.
- `apps/api/src/auth/oidc.test.ts`: against a fake issuer, rejects wrong state, nonce, audience, expired tokens, wrong signing key, an issuer from another tenant, missing or wrong `hd`, and a PKCE mismatch; exposes no email or name.
- `apps/api/src/auth/routes.db.test.ts`: full login, non-member refusal, callback replay, tampered, missing, unsigned, expired and other-provider login cookies, logout, membership loss, invalid session tokens, unconfigured providers, and logs without secrets.
- `packages/config/src/index.test.ts`: provider configuration rules.
- A mutation check confirmed the tests fail if any of these is removed: the membership check in `session_principal`, the issuer allow-list, the `hd` check, signature verification, or the server-side login-cookie age check.

## Not done

- Real provider registrations, secrets and MFA policy (owner action).
- Tenant selection when a person belongs to several organisations.
- Wiring `withTenant` and `authorizeInTenant` into routes.
- The membership invite and approval path.
- Deleting old `auth_session` rows (retention job).
- Audit events for sign-in and sign-out (#98).
- A web sign-in page.

## Rollback

Revert the PR. No shared or production database exists. Once one does, schema changes are forward-only (ADR 0010).
