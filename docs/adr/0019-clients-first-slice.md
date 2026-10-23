# ADR 0019: Clients, first slice

Status: Implemented for synthetic data. This is pilot slice 1 (`docs/roadmap/PILOT.md`) and the start of M2 (CRM). The owner chose the pilot plan on 23 October 2026. It builds on ADRs 0013–0018.

## Decision

1. **Party table.** A client is a row in `party`, following CORE_MODEL's Party, with `kind = 'person'`.
   - Login stays separate: a party is never a principal.
   - This slice stores one optional email and one optional phone on the party itself.
   - In slice 2 these move to contact points with purpose-based consent, proof and withdrawal. That needs a forward migration, and the API keeps the same shape.
2. **Visibility.**
   - A client is visible only to its assigned agent and its creator, and only while they have an active membership. RLS enforces this.
   - A member can add clients only for themselves.
   - Kind, classification (`personal`), version and `created_at` always take their defaults, through column grants.
   - Update and delete come later, with version checks.
   - Assigning clients to others waits for the role rules (#24).
3. **One set of rules.**
   - `@reo/domain` `parseNewClient` checks every new client:
     - the name is 1–200 characters, trimmed, with no control characters, line separators or half emoji;
     - the email is optional, lower-cased, at most 254 characters, with one `@` and a dot in the domain, and without `?`, `#`, `%` or `&`, so an address can never carry `mailto:` parameters such as a hidden bcc;
     - the phone is optional and stored as digits with an optional leading `+` (7–15 digits), with spaces, dots, dashes and brackets removed.
   - The database repeats these rules as CHECK constraints. They use explicit character ranges, so the rules don't depend on the database locale.
4. **No personal data in history.**
   - The audit row is `party.create` with details `{ kind, contactPoints }`, where `contactPoints` is a count only.
   - The outbox event is `party.created` with payload `{ partyId }`.
   - Names, emails and phone numbers never reach the audit log, the outbox or the logs. (Keys that mention email or phone are redacted by ADR 0014 anyway.)
5. **Safe retries.** The client sends its own UUID `id`, as for tasks.
   - The same id with the same details returns 200 and writes nothing.
   - The same id with different details, or one belonging to another member, returns 409.

## Routes

| Route | Result |
|---|---|
| `GET /v1/organizations/:organizationId/clients` | `{ clients, more }`: the caller's first 100 clients, A to Z with case and accents set aside (ICU root collation, the same order as the screen whatever the database locale), and `more` set when there are others. `no-store`. |
| `GET /v1/organizations/:organizationId/clients/:clientId` | One client, or 404 for anything not visible or not a UUID |
| `POST /v1/organizations/:organizationId/clients` | Body `{ id, name, email?, phone? }`; other fields are refused. Returns 201, 200 (replay), 400 `invalid_client` with `field`, 409 `conflict`, or 404. 4 KB body limit; same-origin `Origin` required. |

## Screens

- **Header.** A shared header with "My tasks" and "Clients" links. The current page is marked with `aria-current`.
- **Clients list.**
  - Each client shows its name (a link to the detail page), plus email and phone, or "No contact details".
  - Phones in North American format show as "(416) 555-0100".
  - The page has loading, empty and error states.
  - When there are more than 100 clients, it says "Showing your first 100 clients, A to Z. Search is coming soon."
- **Add a client form.**
  - Fields: Name, Email (optional) and Phone (optional).
  - Each field shows its own error inline, with `aria-invalid` and focus.
  - A retry reuses the same client id.
  - A conflict reloads the list.
  - If the session ends, the typed values are kept.
- **Client detail.** Email (a `mailto:` link), phone (a `tel:` link) and the date the client was added, in Toronto time. A client that isn't yours shows "This client is not available to you."

## Evidence

- `packages/domain/src/client.test.ts`: the rules for name, email and phone.
- `packages/db/src/clients.db.test.ts`:
  - visibility, including another member, another organisation and a suspended member;
  - adding for someone else is refused;
  - protected columns can't be set;
  - there is no update or delete yet;
  - every CHECK constraint holds;
  - RLS is forced.
- `apps/api/src/tenant/clients.db.test.ts`:
  - add, list and show work;
  - audit and outbox rows hold no personal data;
  - replays and conflicts behave as above;
  - each bad field returns 400;
  - another organisation returns 404, and a missing `Origin` returns 403;
  - losing membership mid-request returns 404;
  - logs hold no names, emails, phones or ids.
- `e2e/clients.spec.ts` at 390, 768 and 1440 px.
  - Mutation checks: the tests failed when a new id was made on every click, and when `aria-current` was removed.

## Not done

- Editing clients (done in ADR 0020) and deleting them.
- Companies.
- Contact points (deferred; consent is per purpose, ADR 0020).
- Search.
- Duplicate detection.
- Assigning clients to others.
- Linking clients to deals (slice 3).

## Rollback

- Revert the code. Migration 0009 only adds the `party` table; a forward migration can drop it while it holds only synthetic data.
