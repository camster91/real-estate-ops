# ADR 0022: Key dates on deals

Status: Implemented for synthetic data. This is the first half of pilot slice 4 (`docs/roadmap/PILOT.md`); the checklist from a reviewed template is the second half. The owner chose it on 23 October 2026. It builds on ADR 0021.

## Decision

1. **A key date** belongs to one deal:
   - Kinds: condition, deposit due, closing or other.
   - A condition or other date needs a name, such as "Financing" (1 to 100 characters, no control characters). Deposit and closing need none.
   - Each date is one moment in time, in the years 2000 to 2100. The screen takes a date and time in Toronto time and sends it with its offset, such as `2026-10-30T23:59:00-04:00`. A time skipped by the spring clock change is refused on the screen. An edit that leaves the due time untouched sends it exactly as stored, so a repeated fall-back hour or stored seconds never shift it.
   - A deal holds at most 200 key dates. One more returns 409 `limit_reached`, rather than being hidden from the list.
   - It can be marked done, and marked not done again.
   - There is no delete; a wrong date is changed.
2. **Who:**
   - Key dates are visible with their deal (ADR 0021).
   - Only the deal's assigned agent adds or changes them. RLS enforces this on `deal_key_date`. The API checks it too, as a second layer; a test that removed the API check still passed because RLS refused, which is the intended backstop.
3. **The database protects the record**, for every role that does not disable its triggers (the owner included; the ADR 0014 limit applies). On insert, `app.deal_key_date_insert_guard` refuses a done time, a version other than 1 or another classification, and sets the timestamps from the server. Delete and truncate are refused. On update, `app.deal_key_date_guard`:
   - lets only the name, due time and done time change;
   - requires `version` to go up by exactly 1;
   - stamps `updated_at`;
   - sets `done_at` from the server clock. It is kept while the date stays done, set to now when it becomes done, and cleared when it is reopened. A client can never supply the time something was done.
4. **States** come from `@reo/domain` `keyDateState`: Done, Overdue (past due), Due soon (within 72 hours) or Upcoming. The screen shows the state in words, and with a coloured edge as well.
5. **Safe retries and conflicts:**
   - A new date carries the screen's UUID. The same id and details return 200; other details, or the same id on another deal, return 409.
   - An edit sends every field and the version seen. Values already saved return 200 without a write. A stale version returns 409 with the latest key date.
6. **No free text in history.** Audit: `key_date.create` with `{ kind }`, and `key_date.update` with `{ fieldsChanged, dateChanged, done }`. Outbox: `key_date.created` and `key_date.updated`, each with `{ keyDateId, dealId }`. Names stay out of audit, outbox and logs, because people may type client details into them.

## Routes

| Route | Result |
|---|---|
| `GET /v1/organizations/:organizationId/deals/:dealId/key-dates` | `{ keyDates }`, soonest first (up to 200), or 404 if the deal isn't visible. `no-store`. |
| `POST …/deals/:dealId/key-dates` | Body `{ id, kind, label?, dueAt }`. Returns 201, 200 (replay), 400 `invalid_key_date` with `field`, 409, or 404. Assigned agent only. |
| `PATCH …/deals/:dealId/key-dates/:keyDateId` | Body `{ version, label, dueAt, done }`, all required. Returns 200, 400 `invalid_key_date` with `field`, 409 `{ error: "conflict", keyDate }`, or 404. |

Writes need the same-origin `Origin` header and have a 1 KB body limit.

## Screens

- **"Key dates" on the deal page:**
  - Each date shows its name, kind, due time and state.
  - Each has "Mark done" or "Mark not done", and "Change", which edits the name and due time inline. Button names include the date's name and due time, so two unnamed deposits are told apart.
  - The edit form stays open on an error or conflict, so nothing typed is lost. A conflict loads the latest values into it, and a field error shows on the field. After Save or Cancel, focus returns to that date's "Change" button.
  - Each date saves on its own; one saving date does not block the others or the add form.
  - States refresh every minute while the page is open.
  - If the list can't load, there is a "Try again" button.
- **"Add a key date":** Type, Name (optional for deposit and closing), Due (Toronto time). Errors show inline with focus. A retry reuses the same id.

## Evidence

- `packages/domain/src/keydate.test.ts`: the rules, and states at the 72-hour edge.
- `packages/domain/src/task.test.ts` still passes, now with the shared `parseOffsetDateTime`.
- `packages/db/src/keydates.db.test.ts`:
  - visibility for another member, another organisation and a suspended member;
  - adding for someone else's deal or as someone else;
  - protected columns on insert;
  - every CHECK;
  - done time from the server;
  - the version rule;
  - runtime-role and owner changes to fixed columns;
  - owner inserts with a done time, version or classification, and server timestamps on owner inserts;
  - no delete or truncate, for the runtime role and the owner;
  - forced RLS.
- `apps/api/src/tenant/keydates.db.test.ts`:
  - add and list in order;
  - replays and conflicts, including the same id on another deal;
  - field errors;
  - mark done, replay, stale version, reopen and move;
  - a label a condition must keep;
  - other members and organisations;
  - a key date reached through the wrong deal;
  - the 200-per-deal limit, with a replay still answered;
  - bad ids and a missing `Origin`;
  - audit, outbox and logs without names or ids.
- `e2e/key-dates.spec.ts` at 390, 768 and 1440 px:
  - order and states;
  - adding in summer and winter time;
  - required fields;
  - the spring-forward gap;
  - retry with the same id, and a lost reply added only once;
  - a conflicting add and the 200 limit;
  - an edit that fails, conflicts or is rejected keeps its form; focus after Save and Cancel;
  - an untouched fall-back due time sent as stored;
  - distinct names for two deposits;
  - done and not done;
  - changing a date;
  - conflicts;
  - load retry;
  - keyboard only, for marking done and for adding.
- **Mutation checks:**
  - Database: removing the server done time or the deal guard failed the tests.
  - API: ignoring the deal in replays, or skipping the label rule, failed the tests.
  - Screen: making a new id on every try, skipping the name check, ignoring a conflict reply, re-reading an untouched due time, not returning focus, or closing the editor on failure failed the tests.

## Not done

- The checklist from a reviewed template (the second half of slice 4).
- Reminders or notifications before a date (these would be external messages and need approval).
- A list of upcoming key dates across all deals.
