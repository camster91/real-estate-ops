# ADR 0021: Deals, first slice

Status: Implemented for synthetic data. This is pilot slice 3 (`docs/roadmap/PILOT.md`). The owner chose it on 23 October 2026. **The stage names and rules are placeholders** until the broker of record approves them. It builds on ADRs 0017, 0019 and 0020.

## Decision

1. **A deal** is one side of a transaction the brokerage represents: buyer, seller, tenant or landlord.
   - It has an Ontario address: street, optional unit, city and postal code. The province is always `ON`, and the postal code must be an Ontario one (K, L, M, N or P), stored as `K1A 0B1`.
   - It is linked to 1 to 4 of the agent's own clients, in `deal_party`.
   - The address, side and clients are fixed in this slice. The database enforces this for every role: the trigger `app.deal_party_guard` accepts a link only in the transaction that created the deal, up to 4 links; `app.deal_party_immutable` refuses any update, delete or truncate of links; and the deferred trigger `app.deal_has_client` refuses a deal with no client when its transaction commits. Editing them, prices, commissions and other parties (co-op agents, lawyers) come later.
2. **Visibility** is the same as for clients (ADR 0019).
   - Only the assigned agent and the creator see a deal, while they are active members. RLS enforces this on `deal` and `deal_party`.
   - A member adds deals only for themselves and links only clients assigned to them. Both the API and RLS check this. An unknown or someone else's client returns the same 400, whichever layer refuses it, so nothing about other clients leaks and the screen never mistakes it for a lost membership.
   - There are no update grants on the address, side or links, and no delete.
3. **Stages (placeholders):** Draft, Active, Conditional, Firm, Closed, Fell through.
   - `@reo/domain` `canMoveDeal`: an open deal (draft, active, conditional, firm) moves to any other stage except back to draft; a deal that fell through can only reopen as active; a closed deal never moves.
   - The screen offers only the allowed stages. The API checks again, and the trigger `app.deal_stage_guard` repeats the rules for every role, the owner included (with the ADR 0014 limit: the owner or a superuser can disable a trigger). It also requires `version` to go up by exactly 1, refuses changes to any other column, and stamps `stage_changed_at`.
   - The labels can change freely. Changing a code or a rule needs a migration, because codes are stored and the trigger repeats the rules. Such a migration must disable `deal_stage_guard` inside its own transaction while it updates rows, because the guard refuses bulk changes.
4. **Safe retries and conflicts**, as for tasks:
   - The screen sends its own UUID for a new deal. The same id and details return 200; different details, or another member's id, return 409.
   - A stage change sends the version seen. The same stage again returns 200 without a write. A stale version returns 409 `conflict` with the latest deal; a move the rules refuse returns 409 `invalid_transition` with the latest deal.
5. **No personal data in history.** Audit: `deal.create` with `{ side, clients }` (a count), and `deal.stage_change` with `{ from, to }`. Outbox: `deal.created` with `{ dealId }`, and `deal.stage_changed` with `{ dealId, stage }`. The address and client names never reach the audit log, the outbox or the logs.

## Routes

| Route | Result |
|---|---|
| `GET /v1/organizations/:organizationId/deals` | `{ deals, more }`: the caller's newest 100 deals, each with its clients (A to Z). `no-store`. |
| `GET /v1/organizations/:organizationId/deals/:dealId` | One deal, or 404 for anything not visible or not a UUID. |
| `POST /v1/organizations/:organizationId/deals` | Body `{ id, side, address: { street, unit?, city, postalCode }, clientIds }`. Returns 201, 200 (replay), 400 `invalid_deal` with `field`, 409, or 404. 4 KB body limit. |
| `PATCH /v1/organizations/:organizationId/deals/:dealId` | Body `{ stage, version }`. Returns 200, 400 `invalid_stage` with `field`, 409 `conflict` or `invalid_transition` with `deal`, or 404. Assigned agent only. |

Writes need the same-origin `Origin` header.

## Screens

- **Header:** a "Deals" section.
- **Deals list:**
  - Each deal shows its address (a link), side, stage and clients, newest first.
  - The page has loading, empty and error states, and a placeholder note about stage names.
- **Add a deal:**
  - "We represent the" select, Street address, Unit (optional), City, Postal code, and a "Clients on this deal" group of checkboxes. With no clients yet, it links to the clients page.
  - Field errors show inline with focus, including on the select. A retry reuses the same id.
  - After a 409, the screen keeps the id until the list confirms whether the earlier try was saved, so a failed check can never lead to a duplicate. This path has no screen test, because the mock cannot fail only the list after a conflict.
  - With more than 100 clients, the picker says only the first 100 are shown.
- **Deal detail:**
  - The address, side, stage (with the time it changed, in Toronto time), linked clients (links) and the date added.
  - "Move to" offers only allowed stages. A closed deal says it cannot be moved, and focus moves to that note. A conflict shows the latest stage with a message.
  - If the deal can't load, a "Try again" button reloads it.

## Evidence

- `packages/domain/src/deal.test.ts`: address, postal code and client rules, and every stage pair for `canMoveDeal`.
- `packages/db/src/deals.db.test.ts`:
  - visibility for another member, another organisation and a suspended member;
  - adding or linking for someone else is refused;
  - protected columns on insert;
  - no delete or unlinking;
  - every CHECK;
  - forced RLS and table ownership;
  - the trigger's stage rules and version rule, and one owner case per fixed column;
  - links: at least one, at most four, none after creation, and no owner update, delete or truncate.
- `apps/api/src/tenant/deals.db.test.ts`:
  - add, list and show;
  - replays and conflicts;
  - other members' and unknown clients;
  - field errors;
  - stage moves, unchanged retries, stale versions and refused moves;
  - another member and another organisation;
  - bad ids and a missing `Origin`;
  - audit, outbox and logs without addresses, names or ids.
- `e2e/deals.spec.ts` at 390, 768 and 1440 px, including keyboard only, lost replies with and without a changed retry, the 100-client notice, a select error, focus after closing, and load retry. The mock uses the real `parseNewDeal`, `parseStageChange` and `canMoveDeal`, so it cannot drift from the API.
- **Mutation checks:**
  - Database: removing the trigger's fell-through, closed or postal-code checks failed the tests.
  - Database: removing the link guard's "created now" or "at most 4" check failed the tests.
  - API: removing the unit comparison in replays failed the tests. Removing the API's own-client check still returns the same 400, now from the database backstop, and saves nothing.
  - Screen: making a new id on every try, skipping the client check, or offering every stage failed the tests.

## Not done

- Real stage names and rules (the broker of record).
- Editing a deal's address, side or clients; deleting deals.
- Prices, deposits, commissions and other parties.
- Showing a client's deals on the client page.
- Key dates and the checklist (slice 4).
