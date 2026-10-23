# ADR 0020: Client edits and consent records

Status: Implemented for synthetic data. This is pilot slice 2 (`docs/roadmap/PILOT.md`). The owner chose it on 23 October 2026, with placeholder consent wording. It builds on ADR 0019.

## Decision

1. **Editing with a version check.**
   - The assigned agent can edit a client's name, email and phone. A `PATCH` must send all three, plus the `version` the editor saw; a body missing any of them is 400, so a partial body can never clear details by accident. An empty or null email or phone clears it.
   - The same rules as adding (`parseFields` in `@reo/domain`) check every edit.
   - A stale version returns 409 with the latest client, so the screen can show it. Sending the values that are already saved returns 200 and writes nothing.
   - In the database, the guard trigger `app.party_update_guard` allows only `display_name`, `email` and `phone` to change, requires `version` to go up by exactly 1, and sets `updated_at`. Column grants allow nothing else. The trigger applies to the table owner too, unless the owner or a superuser disables it (the same limit as ADR 0014).
   - Audit: `party.update` with `{ fieldsChanged }` (a count, never the values). Outbox: `party.updated` with `{ partyId }`.
2. **Consent records.**
   - `consent_record` holds one row per decision: purpose, status (`granted` or `withdrawn`), method (`written`, `electronic` or `verbal`), who recorded it and when.
   - The table is append-only. The runtime role has no update or delete grant, and a trigger refuses update, delete and truncate for every role, the owner included. A change of mind is a new row, so the history is the proof.
   - **Limit:** as in ADR 0014, the owner or a superuser can still disable or drop the trigger. Real tamper evidence needs the hash chain in ADR 0005, which is not built yet.
   - The current status for a purpose is its newest row, over all history (not just the 50 returned). Recording takes a row lock on the client and stamps `clock_timestamp()`, so two recordings for one client are ordered as they commit.
   - Anyone who can see the client can read its consent. Only the assigned agent can record it, and only as themselves.
   - Retries are safe: the screen sends its own UUID, one per purpose, status and method, until it saves. The same id and details return 200; different details return 409. Any success for a purpose clears its pending ids, so an old id is never reused for a new decision. After an error the screen reloads the history: if the record is there, it was saved.
   - Audit: `consent.record` with `{ purpose, status, method }`, which are codes. Outbox: `consent.recorded` with `{ consentId, partyId }`.
3. **Placeholder wording.**
   - Purposes are stored as codes (`transaction_service`, `market_updates`). The wording shown to staff lives in `CONSENT_PURPOSE_LABELS` and is marked "(placeholder wording)".
   - `CONSENT_WORDING_IS_PLACEHOLDER` shows a note on the screen until the privacy owner approves the real text. Then change the labels and set the flag to false. Never change the codes, because they are stored.
   - This records what staff say the client agreed to. It does not send anything, and it does not replace legal advice on CASL or PIPEDA.
4. **Contact points stay on the party for now.** ADR 0019 planned to move email and phone into contact points. That is deferred: consent is per purpose, not per address, so it does not need them yet.

## Routes

| Route | Result |
|---|---|
| `PATCH /v1/organizations/:organizationId/clients/:clientId` | Body `{ version, name, email, phone }`. Returns 200, 400 `invalid_client` with `field`, 409 `{ error: "conflict", client }`, or 404. Assigned agent only. |
| `GET /v1/organizations/:organizationId/clients/:clientId/consents` | `{ current, history }`: one `current` entry per purpose (status, method and time, or nulls), and the newest 50 records. 404 if the client isn't visible. `no-store`. |
| `POST /v1/organizations/:organizationId/clients/:clientId/consents` | Body `{ id, purpose, status, method }`. Returns 201, 200 (replay), 400 `invalid_consent` with `field`, 409, or 404. Assigned agent only. 1 KB body limit. |

## Screens

- **Edit details** on the client page: Name, Email (optional), Phone (optional).
  - Field errors show inline with focus; the typed values are kept on errors and when the session ends.
  - A conflict shows "This client was changed in another window" and loads the latest details.
  - On success it says "Client details saved." and returns focus to "Edit details".
- **Consent** on the client page:
  - The placeholder note.
  - Each purpose with its current status ("Given", "Withdrawn" or "Not recorded"), how, and when, in Toronto time.
  - A "How" select (named with its purpose for screen readers) and "Record consent" / "Record withdrawal" buttons, all disabled while one is saving. A failed try is retried with the same id. A 409 says "That may already be recorded" and reloads the history.
  - The history, newest first. If consent can't load, a "Try again" button.

## Evidence

- `packages/domain/src/client.test.ts`: edit and consent rules.
- `packages/db/src/clients.db.test.ts`: the guard trigger (version +1, and one owner case per protected column), column grants, edit visibility, consent visibility, recording only as yourself and only for your clients, append-only (no grants for the runtime role; the trigger's own message for owner update, delete and truncate), table ownership, and every CHECK.
- `apps/api/src/tenant/clients.db.test.ts`: edits, partial bodies refused, unchanged replays, conflicts, field errors, a member of another organisation (both URLs), consent read and record, current status beyond the history page, replays and conflicts, audit and outbox content without personal data, and logs from every new route without names, phones or ids.
- `e2e/client-edit.spec.ts` at 390, 768 and 1440 px.
  - Lost replies (`commit_then_abort`) for edits and consent, the 409 message, sign-in on session end, and the select names.
  - Mutation checks: the tests failed when a new consent id was made on every try, when the conflict reply was ignored, when focus was not returned, when the history check after an error was removed, and when pending ids were not cleared. In the database: when the trigger's assignee check or delete trigger was removed, and when current status came from the history page.

## Not done

- Real consent wording and retention periods (the privacy owner).
- Sending anything that uses consent (later, behind approval).
- Deleting clients, companies and contact points.
