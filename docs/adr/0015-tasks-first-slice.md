# ADR 0015: Tasks, first slice ("my tasks")

Status: Implemented for synthetic data. Supports #44 (first slice) and the API half of the M1 "assigned work summary" vertical slice. The owner approved the plan in #136. Builds on ADRs 0013 and 0014.

## Decision

1. **Visibility.** A task is visible only to its assignee and its creator, while they have an active membership in its organisation. RLS on `task` enforces this, not only the API.
2. **Self-assigned creation only.** A member may create tasks only for themselves (RLS `WITH CHECK`: creator and assignee are both the current principal). This is an internal, reversible action on operational data, so an active membership is the requirement; no record grant applies. `@reo/auth` grants name existing records and cannot cover a record not yet created. Assigning tasks to others waits for #32 and the role rules in #24.
3. **New tasks** start as `ready`, with classification `operational` and version 1. Column-level grants stop the runtime role from setting status, classification, version or `created_at` on insert.
   - The title is 1–200 characters (counted as code points), trimmed, with no control characters.
   - The due date is optional; it must be an ISO 8601 date-time with an offset or `Z`, and is stored in UTC. Impossible dates such as 30 February are rejected.
   - The rules live once in `@reo/domain` (`parseNewTask`), and the database repeats them as CHECK constraints.
4. **The title stays out of history.** The audit details are `{ status, hasDueDate }` and the event payload is `{ taskId }`.
5. **Safe retries.** The client sends a fresh UUID `id`.
   - The same id with the same title and due date returns the existing task with 200, and writes no second task, audit or event.
   - Different content, or an id already used by another member, returns 409 `conflict` without revealing that task.

## Routes

| Route | Result |
|---|---|
| `GET /v1/organizations/:organizationId/tasks` | `{ tasks: [{ id, title, status, dueAt, version }] }`: tasks assigned to the caller, open first, then by due date (undated last), at most 100, `no-store` |
| `POST /v1/organizations/:organizationId/tasks` | Body `{ id, title, dueAt? }` (other fields refused). 201 when created, 200 for a replay, 400 `invalid_task` with `field`, 409 `conflict`, 404 for a non-member. 4 KB body limit; same-origin `Origin` required (ADR 0013). |

Both use `requireSession` and `inTenant` with the purpose `operations`. The task insert, its audit event and its outbox event are one transaction (`recordChange`, ADR 0014).

## Evidence

- `packages/domain/src/task.test.ts`: the title, id and due-date rules, including emoji, NUL, tab, 201 characters and 30 February.
- `packages/db/src/tasks.db.test.ts`:
  - another member's task is invisible
  - creating a task for another member, as another member, or in another organisation is refused
  - status, version, classification and `created_at` cannot be set
  - there is no update or delete
  - the title constraints hold
  - a suspended member sees and creates nothing
  - forced RLS
- `apps/api/src/tenant/tasks.db.test.ts`:
  - create and list, with exactly one audit row and one event and no title in either
  - ordering
  - isolation between members
  - an `assigneeId` field is refused
  - retries and conflicts
  - odd titles, non-JSON and oversized bodies
  - membership loss
  - another organisation, and a missing `Origin`
  - logs without titles or ids
- Mutation checks: removing the assignee check from the insert policy, or skipping `recordChange`, each fails a named test.

## Not done

- The web "My tasks" screen and web sign-in (next plan).
- Status changes and edits (UPDATE with version checks).
- Assigning tasks to others; manager and team views.
- Dependencies, checklists, templates and recurrence (#43–#46).

## Rollback

Revert the PR. No shared or production database exists. Once one does, schema changes are forward-only (ADR 0010).
