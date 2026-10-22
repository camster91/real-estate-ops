# ADR 0016: Web sign-in and the "My tasks" screen

Status: Implemented for synthetic data. Completes the web half of the M1 "assigned work summary" vertical slice (web → API → PostgreSQL). The owner approved the plan in #142 (simple, clean screens now, restyled later with the Figma system in #103; a brokerage picker that remembers the last choice). Builds on ADRs 0012, 0013 and 0015.

## Decision

1. **One origin: the website's address is the public address.**
   - The website (`apps/web`) proxies `/auth/*` and `/v1/*` to the API with Next.js rewrites. The browser only talks to the website's own origin.
   - So the `__Host-` cookies, the same-origin `Origin` check (ADR 0013) and the provider redirect URI all work unchanged, with `REO_PUBLIC_URL` set to the website's origin (locally `http://127.0.0.1:3000`).
   - The API address comes from `REO_API_ORIGIN` (default `http://127.0.0.1:4000`). It must be a loopback `http` origin, or the website build fails. The API never faces the internet directly.
2. **Sign-in failures land on the sign-in page.** The callback no longer answers with JSON. It redirects to `/?signin=<reason>`:
   - `failed`: any verification failure (was 400 `login_failed`)
   - `no_access`: a verified identity without an active membership (was 403)
   - `unavailable`: the provider cannot be reached (was 502)

   No session is set, the login cookie is cleared, and `Cache-Control: no-store` is sent. The page shows a fixed message for each known code and nothing for any other value.
3. **The picker shows organisation names.** `/v1/session` returns `{ principalId, memberships: [{ organizationId, name }] }`, ordered by name. The names come from `app.session_organizations(token_hash)`, a `SECURITY DEFINER` function owned by `reo_auth`, which returns only the caller's own live, active memberships. The runtime role still cannot read `organization` rows outside a tenant context (migration 0007).
4. **Toronto time on screen.**
   - "Due (Toronto time)" is read as America/Toronto wall-clock time and sent with its correct offset, for example `2026-11-01T09:00:00-05:00`.
   - A time inside the spring-forward gap is refused before sending: "That time does not exist in Toronto (clocks change). Pick another time."
   - A time in the fall-back hour uses the earlier (first) occurrence.
   - Due dates are shown in `en-CA`, for example "Sun, Nov 1, 9:00 a.m.".
   - The helpers live once in `@reo/domain` (`zonedLocalToUtc`, `toOffsetIso`, `formatInZone`, `TORONTO`) and use only `Intl`.
5. **Remember the last brokerage in this browser only.** The `localStorage` key `reo.lastOrganization` holds an organisation id. It is a convenience, not security: the API checks the membership on every request, and an id that is no longer one of the person's memberships falls back to the picker (or to their only brokerage).

## Page flow

- `/` shows "Loading…", then:
  - signed out (or no memberships): "Sign in to Real Estate Ops" with "Sign in with Google" and "Sign in with Microsoft" links;
  - one membership: straight to `/o/<id>/tasks`;
  - a remembered id that is still a membership: straight there;
  - otherwise, or with `?choose=1`: "Choose a brokerage".
- `/o/<id>/tasks` ("My tasks") lists the person's tasks with status and due date, and has an "Add a task" form, "Switch brokerage" and "Sign out".
  - Loading, empty and error ("Tasks could not be loaded." with "Try again") states are visible.
  - A 401 while loading goes to sign-in. A 401 while adding keeps the typed task and says "Your session has ended. Sign in again, then add this task."
  - A 404 shows "This brokerage is not available to you." with the switch link.
  - **Safe retries:** one client UUID per submission. A retry after a network error reuses it, so the API replays instead of creating a second task. A new id is made only after a success, or after a 409.
  - A server 400 for the title or due date is shown next to the field, with `aria-invalid`, `aria-describedby` and focus on the field. The typed text is kept.
- The web app never reads or writes the session token, sends no tenant or principal headers, and never renders raw API bodies.

## Evidence

- `packages/db/src/sessions.db.test.ts`: names for active memberships only; nothing for a closed or unknown session; no direct `organization` reads.
- `apps/api/src/auth/routes.db.test.ts`: names in `/v1/session`; every callback failure is a 302 to `/?signin=…` with no session and `no-store`.
- `packages/domain/src/time.test.ts`: summer and winter offsets, the fall-back hour, the spring-forward gap, invalid input, round trips and agreement with `parseNewTask`.
- `e2e/signin.spec.ts` and `e2e/tasks.spec.ts`: every screen state at 390, 768 and 1440 px against browser-level API mocks, with keyboard-only use, visible focus rings and no horizontal scroll.
  - Mutation checks: making a new id on every click fails "retry reuses the id"; trusting the remembered id fails "stale remembered brokerage falls back to the picker".

## Not done

- The Figma restyle (#103–#107).
- Task status changes and edits.
- Manager views.
- A full accessibility audit (only the basics are covered).
- A script Content Security Policy with nonces (the existing headers stay).
- Real provider accounts.
- An end-to-end browser test against the real API and database: the screen tests mock the API, and the API is covered by its own database tests.

## Rollback

- Revert the website changes and set `REO_PUBLIC_URL` back to the API's address. Then the provider redirect URIs must point back at the API too.
- Migration 0007 only adds a policy, a grant and a function. It can stay in place, or a forward migration can drop them.
- No data changes.
