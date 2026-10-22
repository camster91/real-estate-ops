# Task Status Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On "My tasks", the assignee can change a task's status (Ready, In progress, Waiting, Blocked, Done, Cancelled), reopen a finished task, and see finished tasks behind a "Show done tasks" button. Every change is audited, and two tabs cannot silently overwrite each other.

**Architecture:**
- **Shared rules.** `@reo/domain` holds the transition rules and request parsing. The database repeats the rules in a trigger, as it already does for titles (ADR 0015).
- **One route.** `PATCH /v1/organizations/:organizationId/tasks/:taskId` takes `{ status, version }`:
  - it uses optimistic concurrency on `version`;
  - setting the status a task already has is a safe replay;
  - the update, its audit event and its outbox event commit together through `recordChange`.
- **Open and done lists.** The list route gains `?show=done`. The default list is open tasks only. The web page swaps between the two lists.

**Tech Stack:** TypeScript strict, Fastify 5, PostgreSQL 16, Next.js 16, React 19, Vitest 5, Playwright. No new dependencies.

**Spec:**
- `docs/product/CORE_MODEL.md`: "Task: ready/in_progress/waiting/blocked/completed/cancelled… blocked/waiting are explicit".
- AGENTS.md: audit every state change; outbox for state changes; tests cover authorisation boundaries, workflow transitions and bypass attempts; Canadian spelling; America/Toronto times.
- ADRs 0014, 0015 and 0016.
- Owner decisions (22 October 2026):
  - finished tasks can be reopened, and the reopening is audited;
  - finished tasks are hidden behind a "Show done" link.

**Out of scope:**
- Reasons for Waiting or Blocked.
- Dependencies between tasks.
- Approval tasks.
- Editing the title or due date.
- Assigning a task to someone else.
- Manager views.
- Deleting tasks.

## Decisions for owner approval

1. **Transitions.**
   - The open statuses (`ready`, `in_progress`, `waiting`, `blocked`) can move to any other open status, or to `completed` or `cancelled`.
   - `completed` and `cancelled` can move only to `ready` (reopen).
   - Done → Cancelled must reopen first. That is two audited steps, so history stays clear.
2. **Only the assignee changes the status.** Today the assignee is always the creator. An RLS `UPDATE` policy and column grants allow changing only `status` and `version`; the trigger sets `status_changed_at` itself.
3. **Concurrency.** The client sends the `version` it saw. Outcomes:
   - **Version matches:** the status changes and `version` goes up by 1.
   - **Version differs:** 409 `conflict`, with the current task, so the screen can show the latest state.
   - **The task already has the requested status:** 200 with the current task and no write, so a retried request is harmless.
4. **History stays minimal.**
   - Audit: action `task.status_change`, details `{ from, to }`.
   - Outbox event: `task.status_changed` with payload `{ taskId, status }`, at the new aggregate version.
   - No titles in either.
5. **Done tasks list.**
   - `GET …/tasks?show=done` returns completed and cancelled tasks, newest change first (new column `status_changed_at`), at most 100.
   - The default list returns open tasks only, ordered as now.

## Global Constraints

- **Code:** strict TypeScript, Biome, exact pins, no new dependencies.
- **Migration:** forward-only `0008`; do not edit `0001`–`0007`.
- **Copy:** Canadian spelling, America/Toronto for displayed times, and short fixed error messages. Never render raw API bodies.
- **Status labels on screen:** Ready, In progress, Waiting, Blocked, Done (`completed`), Cancelled.
- **Accessibility:** every control has an accessible name, focus is visible, and nothing scrolls sideways at 390, 768 or 1440 px.

## Review Focus

1. **Two tabs.** A change sent with an old version gets 409. The screen then shows the latest status with "This task changed in another window. It now shows the latest status." It never silently overwrites. Tested in Tasks 3 and 5.
2. **Lost reply, then retry.** Re-sending the same status after it already applied returns 200, and writes no second audit or event. Tested in Task 3.
3. **Finishing the last open task.** The task leaves the open list, the empty state shows, and the task appears under "Show done tasks". Tested in Task 5.
4. **Bypass attempts.** None of these change the row:
   - a non-assignee member sending a PATCH (404);
   - a direct SQL `UPDATE` that skips a transition, sets `version` other than `old + 1`, or touches `title`, `assignee_principal_id` or `created_at`.

   Tested in Tasks 2 and 3.
5. **A quick second change on the same row.** The control is disabled while a change is in flight, so the second change cannot race the first. Tested in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/domain/src/task.ts` (+ test) | `OPEN_STATUSES`, `DONE_STATUSES`, `canTransition`, `parseStatusChange` |
| `packages/db/migrations/0008_task_status.sql` | `status_changed_at`, UPDATE grant and policy, transition trigger |
| `packages/db/src/tasks.db.test.ts` (modify) | Database rules for updates |
| `apps/api/src/tenant/tasks.ts` (+ db test) | `PATCH` route, `?show=done` |
| `apps/web/app/lib/api.ts`, `apps/web/app/o/[organizationId]/tasks/page.tsx`, `globals.css` | Status control, the done list, reopen |
| `e2e/tasks.spec.ts`, `e2e/mock-api.ts` | Screen tests |
| `docs/adr/0017-task-status-changes.md`, RESUME, LOCAL_DEVELOPMENT | Docs |

### Task 1: Transition rules in `@reo/domain`

**Files:** Modify `packages/domain/src/task.ts`, `packages/domain/src/task.test.ts` and `packages/domain/src/index.ts`.

**Interfaces (Produces):**
- `OPEN_STATUSES = ["ready", "in_progress", "waiting", "blocked"] as const`
- `DONE_STATUSES = ["completed", "cancelled"] as const`
- `canTransition(from: TaskStatus, to: TaskStatus): boolean`. `from === to` is false; that case is a replay, decided by the caller.
- `parseStatusChange(input: unknown): { ok: true; status: TaskStatus; version: number } | { ok: false; field: "status" | "version" | "body" }`
  - the body must be an object with exactly the keys `status` and `version`;
  - `version` must be an integer from 1 to 2147483647.

- [ ] **Step 1: Write the failing tests** in `task.test.ts`:
  - `open statuses move freely`: every ordered pair of distinct open statuses is true.
  - `open to done`: every open status → `completed` or `cancelled` is true.
  - `done only reopens`: `completed → ready` and `cancelled → ready` are true; `completed → cancelled`, `cancelled → completed` and `completed → in_progress` are false.
  - `parseStatusChange accepts`: `{ status: "in_progress", version: 3 }`.
  - `parseStatusChange rejects`, using `it.each`:
    - `{ status: "done", version: 1 }` → status
    - `{ status: "ready" }` → version
    - `{ status: "ready", version: 0 }` → version
    - `{ status: "ready", version: 1.5 }` → version
    - `{ status: "ready", version: "1" }` → version
    - `{ status: "ready", version: 1, title: "x" }` → body
    - `[]` → body
    - `null` → body
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test packages/domain`.
- [ ] **Step 3: Implement** the two functions and the two status lists, and export them from `index.ts`.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test`, then `pnpm check`.
- [ ] **Step 5: Commit** with message `feat(domain): task status transition rules`.

### Task 2: Migration 0008

**Files:** Create `packages/db/migrations/0008_task_status.sql`. Modify `packages/db/src/tasks.db.test.ts`.

**Interfaces (Produces):**
- **New column:** `task.status_changed_at timestamptz NOT NULL DEFAULT now()`. Existing rows take `created_at`.
- **Grant:** `GRANT UPDATE (status, version) ON task TO reo_app`. `status_changed_at` is set by the trigger, never by the client.
- **Policy:** `task_update_assignee` FOR UPDATE TO reo_app.
  - `USING`: same organisation, active membership, and `assignee_principal_id = app.current_principal_id()`.
  - `WITH CHECK`: the same.
- **Trigger:** `task_status_guard` BEFORE UPDATE, a plpgsql function owned by the table owner with `SET search_path = pg_catalog, public`. It raises `check_violation` (23514) unless all of these hold:
  - `NEW.version = OLD.version + 1`;
  - `NEW.status <> OLD.status`;
  - the transition is allowed: the same rules as Task 1, written out in SQL;
  - all other columns are unchanged.

  It then sets `NEW.status_changed_at = now()`.

- [ ] **Step 1: Write the failing tests** in `tasks.db.test.ts`. Replace `no update or delete` with:
  - `assignee changes status`: `UPDATE task SET status='in_progress', version=version+1 WHERE id=$1` succeeds. Afterwards `version = 2` and `status_changed_at > created_at`.
  - `reopen`: `completed` then `ready` succeeds.
  - `trigger refuses`, using `it.each` (each gives 23514):
    - a skipped transition (`completed → in_progress`);
    - the same status;
    - `version = version + 2`;
    - `version` unchanged.
  - `cannot change other columns`: updates to `title`, `due_at`, `assignee_principal_id` and `created_at` each give 42501.
  - `another member cannot update`: `pa2`'s update of `pa`'s task changes 0 rows. Use RLS, and check with `rowCount`.
  - `suspended member cannot update`: 0 rows.
  - `still no delete`: 42501.
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test:db packages/db/src/tasks`.
- [ ] **Step 3: Implement** the migration.
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db`.
- [ ] **Step 5: Commit** with message `feat(db): task status updates with a transition guard`.

### Task 3: API route and the done list

**Files:** Modify `apps/api/src/tenant/tasks.ts` and `apps/api/src/tenant/tasks.db.test.ts`.

**Interfaces:**
- **Consumes:** `parseStatusChange` and `canTransition` (Task 1); the migration from Task 2.
- **Produces:**
  - **`PATCH /v1/organizations/:organizationId/tasks/:taskId`.** Body limit 1 KB; same-origin `Origin`; `no-store`.
    - `200 { task }`: changed, or already had that status (replay, no write).
    - `400 { error: "invalid_status", field }`: the body failed `parseStatusChange`, or `taskId` is not a UUID (`field: "id"`).
    - `404 { error: "not_found" }`: not a member, not visible, not the assignee, or the membership was lost mid-request.
    - `409 { error: "conflict", task }`: stale version.
    - `409 { error: "invalid_transition", task }`: a disallowed transition.
  - **`GET …/tasks?show=done`.** Completed and cancelled tasks, ordered by `status_changed_at DESC, id`, limit 100.
    - Without `show`, or with any other value, the list shows open tasks only.
    - An unknown `show` value is 400 `invalid_query`.
  - **Task JSON** adds `statusChangedAt` (ISO string).
- **Write order:**
  1. In one `inTenant` transaction, `SELECT … FOR UPDATE` the row where the caller is the assignee.
  2. No row: 404.
  3. The task already has the requested status: 200, no write.
  4. Version differs: 409 `conflict`.
  5. `!canTransition`: 409 `invalid_transition`.
  6. Otherwise `UPDATE … RETURNING`, then `recordChange` with:
     - action `task.status_change`;
     - details `{ from, to }`;
     - event `task.status_changed`, `schemaVersion` 1, `aggregateVersion` the new version;
     - payload `{ taskId, status }`.

- [ ] **Step 1: Write the failing tests** in `tasks.db.test.ts`:
  - `changes status and audits`: 200, version 2. Exactly one audit row `{ action: "task.status_change", details: { from: "ready", to: "in_progress" } }`, and exactly one outbox row with `aggregate_version` 2. The title appears in neither.
  - `replay is harmless`: sending the same request again gives 200, and the audit and outbox counts stay unchanged.
  - `stale version is 409 with the current task`.
  - `invalid transition is 409`: `completed → in_progress`.
  - `reopen`: `completed → ready` gives 200 and is audited.
  - `done list`: after completing a task, it is missing from the default list and present in `?show=done`; `?show=x` is 400.
  - `not the assignee is 404`: `tokenA2` patches `pa`'s task.
  - `other organisation is 404; no Origin is 403`.
  - `bad bodies are 400`: one case each for `status`, `version`, `body` and `id`.
  - `membership lost mid-request is 404`: reuse the racing-pool pattern from the existing test.
  - `logs carry no titles or ids`: extend the existing test to also make a PATCH.
- [ ] **Step 2: Run and verify they fail.** Run `pnpm test:db apps/api/src/tenant`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and verify they pass.** Run `pnpm test:db`, `pnpm lint` and `pnpm check`.
- [ ] **Step 5: Commit** with message `feat(api): change task status with version check and audit`.

### Task 4: Web status control, done list and reopen

**Files:** Modify `apps/web/app/lib/api.ts`, `apps/web/app/o/[organizationId]/tasks/page.tsx` and `apps/web/app/globals.css`.

**Interfaces:**
- **Consumes:** `OPEN_STATUSES` and `canTransition` (Task 1); the route from Task 3.
- **Produces:**
  - `listTasks(org, show?: "done")`.
  - `changeStatus(org, taskId, status, version): Promise<{ task } | { conflict: Task } | { invalidTransition: Task } | "signed_out" | "not_found" | "error">`.
  - `Task.statusChangedAt: string`.
- **Behaviour:**
  - **Open list.** Each open task has a `<select>`:
    - accessible name: `Status of <title>`;
    - options: the four open statuses plus "Done" and "Cancelled";
    - current value selected;
    - disabled while its change is in flight.
  - **Successful change.**
    - The row updates.
    - A move to Done or Cancelled removes the task from the open list and announces "Task marked done." or "Task cancelled.".
    - Any other change announces "Status changed to <label>.".
  - **Show and hide.** A "Show done tasks" button (`aria-expanded`) loads `?show=done` and lists those tasks. Its text then reads "Hide done tasks".
  - **Done list.** Each done task shows its title, "Done" or "Cancelled", the change time via `formatInZone`, and a "Reopen <title>" button. Reopening moves the task back to the open list (sorted as before) and announces "Task reopened.".
  - **Conflict.** Replace the row with the returned task, and show the row message "This task changed in another window. It now shows the latest status.".
  - **Invalid transition.** Same handling as a conflict.
  - **Signed out.** The session-ended message.
  - **Not found.** Reload the list.
  - **Error.** The row message "The status could not be changed. Please try again.", and the select goes back to its old value.
  - **Empty open list.** It now says "No open tasks. Add a task below." The plan accepts this copy change.

- [ ] **Step 1: Implement.** The screen behaviour is tested in Task 5; this task is checked by typecheck and build.
- [ ] **Step 2: Run** `pnpm lint`, `pnpm check` and `pnpm --filter @reo/web typecheck`.
- [ ] **Step 3: Commit** with message `feat(web): change task status, show done tasks and reopen`.

### Task 5: Screen tests

**Files:** Modify `e2e/mock-api.ts` and `e2e/tasks.spec.ts` (update the empty-state text).

**Interfaces:**
- `mockApi` handles:
  - `PATCH …/tasks/:id`, with the same rules as the API (replay, version, transitions);
  - `GET ?show=done`;
  - `state.patchReplies: Reply[]`.

- [ ] **Step 1: Write the tests.** Every test checks for no horizontal scroll.
  - `change status`: choose "In progress" on a task. The PATCH body is `{ status: "in_progress", version: 1 }`, the row shows In progress, and "Status changed to In progress." is announced.
  - `finishing the last open task` (Review Focus 3): choose "Done".
    - The empty state shows and "Task marked done." is announced.
    - Pressing "Show done tasks" lists the task with "Done" and a Toronto time.
    - `aria-expanded="true"`.
  - `reopen`: from the done list, pressing "Reopen <title>" moves the task back to the open list as Ready, and "Task reopened." is announced.
  - `two tabs` (Review Focus 1): the next PATCH returns 409 `conflict` with a task in `blocked`. The row shows Blocked and the conflict message.
  - `in flight` (Review Focus 5): delay the PATCH. The select is disabled until the reply arrives.
  - `error restores the old value`: abort the PATCH. The select shows the old status and the error message.
  - `keyboard`: Tab to a status select (with a focus ring), change it with the arrow keys and Enter (or `selectOption` after focusing by keyboard), then Tab to "Show done tasks" and press Enter.
- [ ] **Step 2: Run and verify they pass.** Run `pnpm test:e2e`.
- [ ] **Step 3: Mutation spot-check.** Remove the in-flight `disabled`; "in flight" must fail. Restore it.
- [ ] **Step 4: Commit** with message `test(web): task status changes at three viewports`.

### Task 6: Docs

**Files:**
- Create: `docs/adr/0017-task-status-changes.md`.
- Modify:
  - `docs/adr/0015-tasks-first-slice.md`: a "Superseded in part by ADR 0017" note on "no update".
  - `docs/roadmap/RESUME.md`.
  - `docs/platform/LOCAL_DEVELOPMENT.md`: route list.

**Content of ADR 0017:**
- the five decisions above;
- the routes table;
- the evidence;
- what is not done (reasons for Waiting and Blocked, dependencies, approval tasks, edits);
- rollback (revert the code; migration 0008 can stay, because a forward migration can drop the grant, the policy and the trigger).

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run the full checks.** Run `pnpm lint && pnpm security:source && pnpm check && pnpm test:db && pnpm test:e2e`, the Python tests and `pnpm audit --audit-level high`. All must be clean.
- [ ] **Step 3: Commit** with message `docs: ADR 0017 task status changes`.
