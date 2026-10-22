# ADR 0017: Task status changes

Status: Implemented for synthetic data. The owner approved the plan in #146 and decided on 22 October 2026 that finished tasks can be reopened (audited) and are hidden behind "Show done tasks". Builds on ADRs 0014, 0015 and 0016.

## Decision

1. **Transitions** (from `docs/product/CORE_MODEL.md`):
   - The open statuses (`ready`, `in_progress`, `waiting`, `blocked`) can move to any other status.
   - `completed` and `cancelled` can only move back to `ready`, which reopens the task.
   - Changing Done to Cancelled means reopening first, so the history shows both steps.
   - The rules live once in `@reo/domain` (`canTransition`). The database trigger `task_status_guard` repeats them for every role, including the table owner.
2. **Only the assignee changes the status**, while they have an active membership.
   - This is enforced by the RLS policy `task_update_assignee`.
   - Column grants allow `UPDATE` of `status` and `version` only.
   - The trigger refuses any other column change, and sets `status_changed_at`.
   - Today the assignee is always the creator.
3. **Concurrency.**
   - The client sends the `version` it saw.
   - A stale version returns 409 `conflict` with the current task.
   - A refused transition returns 409 `invalid_transition` with the current task.
   - Asking for the status the task already has returns 200 with no write, so a retried request never writes a second audit row or event.
   - Each change adds exactly 1 to `version`. The trigger enforces this too.
4. **Minimal history.**
   - Audit: `task.status_change` with details `{ from, to }`.
   - Outbox: `task.status_changed` with payload `{ taskId, status }`, at the new aggregate version.
   - The update, its audit row and its event commit in one transaction (`recordChange`).
   - Titles never appear in the audit row or the event.
5. **Open and done lists.**
   - The default list returns open tasks only.
   - `?show=done` returns completed and cancelled tasks, most recently changed first (by `status_changed_at`). Both lists are limited to 100.
   - On screen, finished tasks sit behind a "Show done tasks" button (`aria-expanded`), and each one has a "Reopen" button.

## Routes

| Route | Result |
|---|---|
| `GET /v1/organizations/:organizationId/tasks` | Open tasks assigned to the caller, by due date (undated last). `?show=done`: finished tasks, newest change first. Any other `show` value: 400 `invalid_query`. |
| `PATCH /v1/organizations/:organizationId/tasks/:taskId` | Body `{ status, version }`, other fields refused. Responses: 200 `{ task }`; 400 `invalid_status` with `field` (`status`, `version`, `body` or `id`); 404 if not the assignee or not a member (also when the membership ends during the request); 409 `conflict` or `invalid_transition` with `{ task }`. 1 KB body limit, same-origin `Origin`, `no-store`. |

Task JSON now includes `statusChangedAt`.

## Screen

- Each open task has a status menu labelled "Status of <title>". It is disabled while a change is in flight.
- After a change, the screen announces one of: "Status changed to …", "Task marked done.", "Task cancelled." or "Task reopened.".
- **Conflict:** the row is replaced with the latest version and shows "This task changed in another window. It now shows the latest status.".
- **Network error:** the menu goes back to the old value, with "The status could not be changed. Please try again.".
- **Session ended:** the row shows "Your session has ended. Sign in again to change it." with a sign-in link.
- **Empty open list:** "No open tasks. Add a task below.".
- **A task moved to the other list by another window:** a visible notice says "<title> changed in another window and is now <status>.".
- **Focus after a row moves lists:** it goes to the next open task's status menu. If there is no other open task, it goes to "Show done tasks". After a reopen, it goes to the reopened task's menu.

## Evidence

- `packages/domain/src/task.test.ts`: every transition pair, plus the request parsing.
- `packages/db/src/tasks.db.test.ts`:
  - the assignee can change a task and reopen it;
  - the trigger refuses a skipped transition, the same status, a version jump and an unchanged version, including for the owner;
  - other columns cannot be changed;
  - another member, or a suspended member, changes nothing;
  - still no delete.
- `apps/api/src/tenant/tasks.db.test.ts`:
  - a change writes one audit row and one event, with no title in either;
  - a replay writes nothing;
  - stale versions and refused transitions return 409;
  - reopening works;
  - the done list works;
  - a non-assignee, another organisation, a missing Origin, bad bodies and a membership lost mid-request are all refused;
  - logs stay clean.
- `e2e/status.spec.ts`, at 390, 768 and 1440 px: change, finishing the last task, reopen, a conflict from another window, in flight, error, session ended and keyboard use.
  - Mutation checks: removing the in-flight lock fails "in flight"; skipping the conflict update fails "two tabs".

## Not done

- Reasons for Waiting and Blocked.
- Dependencies between tasks.
- Approval tasks (CORE_MODEL: the requester cannot complete their own).
- Editing the title or due date.
- Assigning a task to someone else.
- Manager views.
- Deleting tasks.
- Paging beyond 100 tasks.

## Rollback

- Revert the code.
- The guard trigger also applies to the table owner. A future migration that backfills `task` rows must disable `task_status_guard` for that statement and re-enable it in the same migration.
- Migration 0008 can stay in place. A forward migration can drop the grant, the policy and the trigger; `status_changed_at` is harmless.
