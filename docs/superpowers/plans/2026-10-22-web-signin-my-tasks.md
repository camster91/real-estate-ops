# Web Sign-in and "My Tasks" Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff open the website, sign in with Google or Microsoft, pick a brokerage (remembered for next time), see their tasks with due dates in Toronto time, and add a task, on phone, tablet and desktop, using only the keyboard if they want.

**Architecture:**
- **One origin.** Next.js (`apps/web`) proxies `/auth/*` and `/v1/*` to the API through rewrites. The browser only ever talks to the website's own origin, so:
  - the `__Host-` cookies,
  - the same-origin `Origin` check (ADR 0013),
  - and the OIDC redirect URI

  all work unchanged with `REO_PUBLIC_URL` set to the website's address.
- **Client components.** Pages are small client components that call the API with `fetch` (same-origin cookies). The API stays the only place that decides access. The web app stores nothing except the last-picked organisation id in `localStorage`.
- **Two small API changes:**
  - `/v1/session` returns organisation names, so the picker can show them.
  - Sign-in failures redirect back to the website with a reason code instead of showing raw JSON.
- **Shared time helpers in `@reo/domain`:** convert a Toronto wall-clock time to UTC, and format UTC in Toronto time, with correct daylight-saving handling.

**Tech Stack:** Next.js 16 and React 19 (already pinned), Playwright 1.63 with network mocks for the screen tests, Vitest 5, PostgreSQL 16. No new dependencies.

**Spec:**
- `docs/platform/M1_PLAN.md`, "Suggested first vertical slice": "Authenticate a synthetic member and read a tenant-scoped assigned work summary through web → API → PostgreSQL… responsive UI has empty/loading/error states and keyboard navigation"; "QA evidence per PR: mobile 390px, tablet 768px, desktop 1440px… keyboard/focus semantics and accessible labels".
- AGENTS.md: "Use Canadian spelling and America/Toronto for user-facing dates/times"; the definition of done (mobile, tablet and desktop QA and accessibility basics).
- `docs/product/CORE_MODEL.md`: "Home shows personal priorities".
- ADRs 0012, 0013 and 0015.
- Owner decisions (22 October 2026):
  - simple, clean screens now, restyled later with the Figma system (#103)
  - one brokerage goes straight to the tasks; two or more show a picker that remembers the last one

**Out of scope:**
- The Figma design system.
- Task status changes and edits.
- Manager views.
- A full accessibility audit (only the basics are covered).
- A full script Content Security Policy with nonces (the existing headers stay).
- Real provider accounts.

## Decisions for owner approval

1. **The web address is the public address.** `REO_PUBLIC_URL` becomes the website's origin (locally `http://127.0.0.1:3000`), and the API sits behind it. The provider redirect URIs in IDP_SETUP become `<web>/auth/{google,microsoft}/callback`.
2. **Sign-in failures land on the sign-in page with a plain message.** Instead of JSON, the callback redirects to `/?signin=<reason>` with one of `failed`, `no_access` or `unavailable`. No session is set, and no detail is shown or logged beyond the existing outcome codes.
3. **The picker shows organisation names.** `/v1/session` returns `memberships: [{ organizationId, name }]`. Names come from a narrow `reo_auth` function, and only for the caller's own active memberships.
4. **Toronto time everywhere on screen.**
   - The due-date input is read as America/Toronto wall-clock time and sent with its correct offset (`-04:00` or `-05:00`).
   - Due dates are shown as, for example, "Sun Nov 1, 9:00 a.m." in `en-CA`.
   - A wall-clock time that does not exist (inside the spring-forward gap) is refused with a message.
   - An ambiguous time (in the fall-back hour) uses the earlier time, which is the first occurrence.
5. **Remember the last brokerage in this browser only** (`localStorage` key `reo.lastOrganization`). This is a convenience, not security: the API still checks the membership on every request, and an id that is no longer valid falls back to the picker.

## Global Constraints

- Strict TypeScript, Biome, exact pins, no new dependencies. Forward-only migration `0007`; do not edit `0001`–`0006`.
- `lang="en-CA"`, Canadian spelling in all copy, and America/Toronto for every displayed time.
- The web app never reads or writes the session token, and never sends tenant or principal ids in headers. The organisation id appears only in the URL path, as ADR 0013 requires.
- Every screen has visible loading, empty and error states. Every control has an accessible name. Focus is visible. There is no horizontal scroll at 390, 768 or 1440 px.
- Errors shown to users are short, fixed messages. Raw API bodies are never rendered.

## Review Focus

1. **Stale remembered brokerage.** If the remembered id is no longer one of the person's memberships, the picker appears (or they go straight to their only brokerage). There is no error page or loop. Test in Task 4.
2. **Session expires while on the tasks screen.** A 401 from the list or the create call sends the person to sign-in, and their typed title is not silently lost: it is kept in the form until they navigate away. Test in Task 4.
3. **Double-click or network retry on "Add task".** The same client UUID is reused for retries of one submission, so the API sees a replay rather than a second task. A new id is made only after a success. Test in Task 4.
4. **Daylight-saving edges.** `2026-11-01T01:30` (ambiguous) and `2026-03-08T02:30` (does not exist) behave as Decision 4 says, and display round-trips. Test in Task 2.
5. **Odd titles from the screen.** Server 400 `invalid_task` messages are shown next to the field, the input keeps the text, and focus moves to the error. Test in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/migrations/0007_session_organizations.sql` | `app.session_organizations(token_hash)` returning `(organization_id, name)` |
| `apps/api/src/auth/routes.ts` (modify) | Names in `/v1/session`; callback failures redirect to `/?signin=…` |
| `packages/domain/src/time.ts` + test | `zonedLocalToUtc`, `formatInZone`, `TORONTO` |
| `apps/web/next.config.ts` (modify) | Rewrites for `/auth/:path*` and `/v1/:path*` to `REO_API_ORIGIN` (default `http://127.0.0.1:4000`) |
| `apps/web/app/page.tsx` (replace) | Sign-in, or routing to the right brokerage, or the picker |
| `apps/web/app/o/[organizationId]/tasks/page.tsx` | "My tasks": list, add form, sign out, switch brokerage |
| `apps/web/app/lib/api.ts` | Small typed `fetch` wrappers and the error mapping |
| `apps/web/app/globals.css` (modify) | Simple, clean styles for the form, list and buttons |
| `e2e/signin.spec.ts`, `e2e/tasks.spec.ts` (replace `workspace.spec.ts`) | Screen tests with mocked API responses at all three viewports |
| `docs/adr/0016-web-signin-my-tasks.md`, `docs/platform/IDP_SETUP.md`, `docs/platform/LOCAL_DEVELOPMENT.md` and others | Decisions and run instructions |

---

### Task 1: API support for the website

**Files:**
- Create: `packages/db/migrations/0007_session_organizations.sql`
- Modify: `packages/db/src/sessions.db.test.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/auth/routes.db.test.ts`

**Interfaces:**
- `app.session_organizations(p_token_hash bytea) RETURNS TABLE (organization_id uuid, name text)`:
  - same validity rules as `app.session_memberships`: live session and active memberships only
  - `SECURITY DEFINER`, owned by `reo_auth`, `SET search_path = pg_catalog, public`
  - EXECUTE revoked from PUBLIC and granted to `reo_app`
  - ordered by name, then id
  - adds `CREATE POLICY organization_auth_read ON organization FOR SELECT TO reo_auth USING (true)` and `GRANT SELECT ON organization TO reo_auth`
- `/v1/session` returns `{ principalId, memberships: [{ organizationId, name }] }`, using `session_organizations` instead of `session_memberships`.
- Callback outcomes:
  - success: unchanged (302 to `/`)
  - a `login_failed` 400: becomes 302 `/?signin=failed`
  - 403 `no_access`: becomes 302 `/?signin=no_access`
  - 502 `login_unavailable`: becomes 302 `/?signin=unavailable`

  Each redirect still clears the login cookie, sets no session and sends `Cache-Control: no-store`.

- [ ] **Step 1: Write the failing tests.**
  - `sessions.db.test.ts`: `session organizations lists names of active memberships only`. With `pa` active in A and suspended in B, the result is `[{ organization_id: orgA, name: "Synthetic Org A" }]`. A revoked session returns `[]`. The runtime role cannot `SELECT` from `organization` without a tenant context (0 rows).
  - `routes.db.test.ts`:
    - Update the existing assertions:
      - `/v1/session` memberships include `name`
      - the non-member callback gives 302 with `location: "/?signin=no_access"`
      - the replay and tampered-cookie cases give 302 `/?signin=failed`
      - the provider outage gives 302 `/?signin=unavailable`
    - The session cookie stays absent in every failure case.
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test:db packages/db/src/sessions apps/api/src/auth`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db`, `pnpm lint` and `pnpm check`.
- [ ] **Step 5: Commit** with message `feat(api): organisation names in session and sign-in failures redirect to the website`.

### Task 2: Toronto time helpers in `@reo/domain`

**Files:**
- Create: `packages/domain/src/time.ts`, `packages/domain/src/time.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- `TORONTO = "America/Toronto"`
- `zonedLocalToUtc(local: string, timeZone: string): Date | "invalid" | "nonexistent"`:
  - `local` is the value of an `<input type="datetime-local">`: `YYYY-MM-DDTHH:mm`, optionally with `:ss`
  - uses `Intl.DateTimeFormat(…, { timeZone, hourCycle: "h23" })` offset lookup, with no libraries
  - an ambiguous time returns the earlier instant (the first occurrence)
- `toOffsetIso(date: Date, timeZone: string): string` gives ISO 8601 with the zone's offset, for example `2026-11-01T09:00:00-05:00`.
- `formatInZone(iso: string, timeZone: string): string` uses `en-CA` with `{ weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }`.

- [ ] **Step 1: Write the failing tests** in `time.test.ts`:
  - `summer time`: `zonedLocalToUtc("2026-07-01T09:00", TORONTO)` gives `2026-07-01T13:00:00Z`, and `toOffsetIso` ends `-04:00`.
  - `winter time`: `2026-12-01T09:00` gives `14:00Z`, ending `-05:00`.
  - `fall-back hour is the first occurrence`: `2026-11-01T01:30` gives `2026-11-01T05:30:00Z`.
  - `spring-forward gap does not exist`: `2026-03-08T02:30` gives `"nonexistent"`.
  - `invalid input`: `""`, `"2026-02-30T09:00"` and `"tomorrow"` give `"invalid"`.
  - `round trip`: for each of the four valid cases, `formatInZone(toOffsetIso(d))` shows the same wall-clock hour and minute as the input.
  - `format`: `formatInZone("2026-11-01T14:00:00Z", TORONTO)` contains `"Nov"`, `"1"` and `"9:00"`.
  - `agrees with parseNewTask`: `parseNewTask` accepts every `toOffsetIso` output.
- [ ] **Step 2: Run and verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test`, `pnpm lint` and `pnpm check`.
- [ ] **Step 5: Commit** with message `feat(domain): America/Toronto time helpers with DST handling`.

### Task 3: Website pages

**Files:**
- Modify: `apps/web/next.config.ts`, `apps/web/app/page.tsx`, `apps/web/app/layout.tsx` (title only), `apps/web/app/globals.css`, `apps/web/package.json` (add `@reo/domain`)
- Create: `apps/web/app/o/[organizationId]/tasks/page.tsx`, `apps/web/app/lib/api.ts`

**Interfaces:**
- **Rewrites:** `{ source: "/auth/:path*", destination: "${API}/auth/:path*" }` and the same for `/v1/:path*`. `API` is `process.env.REO_API_ORIGIN ?? "http://127.0.0.1:4000"`, which must be a loopback http origin; otherwise the build throws. The security headers are kept.
- **`api.ts`:**
  - `getSession(): Promise<Session | "signed_out" | "error">`
  - `listTasks(org): Promise<Task[] | "signed_out" | "not_found" | "error">`
  - `createTask(org, body): Promise<{ task } | "signed_out" | "not_found" | "conflict" | { invalid: field } | "error">`
  - `signOut(): Promise<void>`, which POSTs `/auth/logout`
  - all calls use `credentials: "same-origin"` and `cache: "no-store"`
- **`/` (client component):**
  - On load, it calls `getSession()` and shows a "Loading…" status (`role="status"`).
  - **Signed out:** heading "Sign in to Real Estate Ops", and two links: "Sign in with Google" (`/auth/google/login`) and "Sign in with Microsoft" (`/auth/microsoft/login`). It shows a message for `?signin=`:
    - `failed`: "Sign-in did not complete. Please try again."
    - `no_access`: "Your account does not have access yet. Ask your broker of record to add you."
    - `unavailable`: "Sign-in is temporarily unavailable. Please try again shortly."
  - **Signed in:**
    - One membership: go to `/o/<id>/tasks`.
    - The remembered id is still a membership: go there.
    - Otherwise: a picker heading "Choose a brokerage" with a list of buttons, one per organisation name. Choosing one stores it and navigates.
  - **Zero memberships** (which should not happen, because the session ends): treat as signed out.
  - **Error:** "Something went wrong. Please refresh the page."
- **`/o/[organizationId]/tasks` (client component):**
  - Heading "My tasks". A "Switch brokerage" link to `/?choose=1` (the picker always shows when `choose=1`). A "Sign out" button.
  - **List:**
    - each task shows its title, a status shown as text ("Ready"), and its due date via `formatInZone`, or "No due date"
    - empty state: "No tasks yet. Add your first task below."
    - loading state: "Loading tasks…"
    - error state: "Tasks could not be loaded." with a "Try again" button
  - **"Add a task" form:**
    - "Title" (required, maxlength 200)
    - "Due (Toronto time)" (`datetime-local`, optional)
    - an "Add task" button
  - **On submit:**
    - It disables the button while the request is in flight.
    - It reuses the pending UUID for retries of the same submission, and makes a new one only after success.
    - `nonexistent` gives the inline error "That time does not exist in Toronto (clocks change). Pick another time."
    - `invalid` gives "Enter a valid date and time."
    - Success clears the form, adds the task to the list, and announces "Task added." in a polite live region.
    - An `invalid` response gives a field error ("Enter a title of 1 to 200 characters without line breaks." or the date message) with `aria-invalid` and `aria-describedby`, and focus on the field.
    - `conflict` gives "That task could not be saved. Please try again." and resets the pending id.
    - `signed_out` goes to `/`.
    - `not_found` gives "This brokerage is not available to you." with the "Switch brokerage" link.
  - It stores the organisation id as the last chosen one on a successful load.

- [ ] **Step 1: Implement** the pages. The screen behaviour is tested in Task 4; this task is checked by typecheck and build.
- [ ] **Step 2: Run** `pnpm lint`, `pnpm check` (including `next build`) and `pnpm --filter @reo/web typecheck`.
- [ ] **Step 3: Commit** with message `feat(web): sign-in, brokerage picker and my tasks screens`.

### Task 4: Screen tests (Playwright, mocked API)

**Files:**
- Create: `e2e/signin.spec.ts`, `e2e/tasks.spec.ts`, `e2e/mock-api.ts` (helpers using `page.route("**/v1/**")` and `page.route("**/auth/**")`)
- Delete: `e2e/workspace.spec.ts`. Its header, `lang` and skip-link checks move into `signin.spec.ts`.

**Interfaces:**
- `mockApi(page, state)`. The mock state holds:
  - the session (signed out, or memberships)
  - tasks per organisation
  - the next create response
  - a log of requests, for assertions
- Tests run in the three existing projects (390, 768 and 1440 px).

- [ ] **Step 1: Write the tests.** Every test also asserts no horizontal overflow, and the visible focus ring where focus moves.
  - **`signin.spec.ts`:**
    - `signed out shows both providers`: the two links have the right `href`; the security headers and `lang="en-CA"` are present; Tab reaches the skip link first and then the provider links.
    - `sign-in failure messages`: `it.each` over the three `?signin=` codes, each showing its message.
    - `one brokerage goes straight to tasks`.
    - `two brokerages show the picker; choice is remembered`: choosing B goes to B's tasks; a reload of `/` goes straight to B.
    - `stale remembered brokerage falls back to the picker` (Review Focus 1).
    - `switch brokerage always shows the picker`.
  - **`tasks.spec.ts`:**
    - `loading then list`: delays the mock, sees "Loading tasks…", then sees tasks with a Toronto-formatted due date ("9:00 a.m." for `2026-11-01T14:00:00Z`).
    - `empty state`.
    - `load error and try again`.
    - `add a task`: types a title and the due time `2026-11-01T09:00`, presses Enter. The POST body has a UUID `id`, the title, and `dueAt` `2026-11-01T09:00:00-05:00`. The list shows the task, "Task added." is announced, and the form is cleared.
    - `retry reuses the id` (Review Focus 3): the first POST fails with a network error; clicking again sends the same `id`; after success, the next task gets a new `id`.
    - `server rejects the title` (Review Focus 5): a 400 `invalid_task`/`title` gives the inline message, `aria-invalid="true"`, focus on Title, and the text kept.
    - `nonexistent time is caught before sending`: `2026-03-08T02:30` shows the message and no POST is made.
    - `session expired` (Review Focus 2): a 401 on load goes to sign-in.
    - `brokerage not available`: a 404 shows the message and the switch link.
    - `sign out`: POSTs `/auth/logout` and shows sign-in.
    - `keyboard only`: the whole add flow works with Tab, typing and Enter.
- [ ] **Step 2: Run and verify they pass.** Run `pnpm test:e2e` (all three projects). Mutation spot-check: make the form generate a new id on every click; "retry reuses the id" must then fail. Restore it afterwards.
- [ ] **Step 3: Commit** with message `test(web): sign-in and my tasks screens at three viewports`.

### Task 5: ADR, setup guide and docs

**Files:**
- Create: `docs/adr/0016-web-signin-my-tasks.md`
- Modify:
  - `docs/platform/IDP_SETUP.md` (redirect URIs use the web address)
  - `docs/platform/LOCAL_DEVELOPMENT.md` (run API and web together, with `REO_PUBLIC_URL=http://127.0.0.1:3000`; note that Safari will not keep `Secure` cookies on plain `http://127.0.0.1`, so use Chrome or Firefox locally)
  - `.env.example` (`REO_API_ORIGIN`)
  - `docs/roadmap/RESUME.md`
  - `docs/platform/M1_PLAN.md` (the first vertical slice read path is complete end to end for synthetic data)

**Content:**
- **ADR 0016:** the five decisions; the one-origin design and why; the page flow; the time rules; the evidence; what is not done (Figma restyle, status changes, full accessibility audit, CSP nonces); rollback.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run the full checks.** Run `pnpm lint && pnpm security:source && pnpm check && pnpm test:db && pnpm test:e2e`, the Python tests and `pnpm audit --audit-level high`. All must be clean. Take one manual screenshot of each screen at 390 and 1440 px from the Playwright output for the PR.
- [ ] **Step 3: Commit** with message `docs: ADR 0016 web sign-in and my tasks`.
