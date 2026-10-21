# ADR 0014: Audit events and the transactional outbox (writer side)

Status: Implemented for synthetic data. Supports #98 (audit and redaction) and #84 (outbox, writer side only). The owner approved the plan in #134. Applies ADR 0004 and the audit part of ADR 0005.

## Decision

1. **The app can write history but never read, edit or delete it.**
   - `reo_app` may only INSERT into `audit_event` and `outbox_event`. RLS `WITH CHECK` limits it to its own tenant, its own principal and its own purpose, while it has an active membership.
   - Column-level grants stop it from setting `occurred_at`, `created_at` or `published_at`. It cannot backdate history or mark an event as already published.
   - A trigger refuses UPDATE, DELETE and TRUNCATE on `audit_event` for ordinary use by any role, including cascades from deleting an organisation.
   - **Limit:** a superuser or the table owner can still disable the trigger (for example with `session_replication_role = replica` or `ALTER TABLE … DISABLE TRIGGER`) or drop it. The trigger prevents mistakes and ordinary misuse, not a privileged attack. Real tamper evidence needs the hash chain and externally retained checkpoints in ADR 0005, which are not built yet.
2. **Fail-safe minimisation.** `minimiseDetails()` runs on every audit `details` object and every event `payload`.
   - It keeps at most 20 keys whose names look like code identifiers (up to 40 characters).
   - **Strings are kept only if they look like a code, id, number or date:** ASCII letters, digits and `_ . : + -`, with no spaces or `@`, at most 64 characters. Anything else, including any free text, becomes `"[redacted]"`.
   - Keys whose names look sensitive are always redacted. They cover:
     - contact and address: email, phone, mobile, cell, tel, fax, address, street, city, postal, zip
     - identity: name, birth, dob, social, SIN as a word, licence or license, registration, passport, OHIP, health
     - finance: bank, transit, IBAN, card, account
     - employment: occupation, employer
     - free text: note, body, message, comment, description, subject, recipient
     - secrets: token, secret, password, key, auth, credential, cookie, session
   - One exception: a UUID value under a key ending in `Id` or `_id` is kept, so events can still name records such as `accountId`.
   - Numbers must be finite. Booleans and null are kept; nested values are dropped.
   - The worst case fits the database's 4096-byte check, so ordinary text can never make a valid change fail.
3. **Event payloads carry ids and codes only**, under the same rules, so personal details never reach future consumers.
4. **One helper for every change.** `recordChange(client, change)` writes both rows on the caller's `withTenant()` transaction:
   - Organisation, actor and purpose come from the transaction's context in SQL (`app.current_*()`), never from arguments.
   - Without a tenant context it throws `MissingTenantContextError` before writing anything.
   - It validates its inputs first (UUIDs, action and type patterns, versions that are integers of at least 1) and throws `InvalidChangeError`. A second event for the same aggregate version and type throws `DuplicateEventError`, which callers can treat as a concurrency conflict.
   - A change and its history commit or roll back together.

## Tables

- **`audit_event`:** `(organization_id, id)`, `occurred_at`, `actor_principal_id`, `action` (`noun.verb`), `resource_type`, `resource_id`, `purpose`, `correlation_id`, `details`.
- **`outbox_event`:** `(organization_id, id)`, `created_at`, `event_type`, `schema_version`, `aggregate_type`, `aggregate_id`, `aggregate_version`, `actor_principal_id`, `correlation_id`, `causation_id`, `payload`, `published_at`.
  - Unique `(organization_id, aggregate_type, aggregate_id, aggregate_version, event_type)`, so the same version of an event cannot be queued twice.
  - A partial index on unpublished events for the future publisher.

## Evidence

- `packages/db/src/audit.db.test.ts`:
  - own-tenant inserts work
  - a forged organisation, principal or approver is refused
  - an inactive member is refused
  - the runtime role cannot read, update or delete
  - the owner cannot update, delete or truncate the audit table
  - JSON shape, size, action format and duplicate-event constraints
  - forced RLS and ownership
  - change, audit and event commit together
  - a rollback leaves no change, audit or event
  - calling outside a tenant context fails
  - a supplied correlation id is kept
- `packages/db/src/audit.test.ts`: key and value redaction (including personal data in values under neutral keys), multibyte, NUL, emoji and control text, the key limit, the worst-case size and key names.
- Further DB tests: a forged purpose, a backdated `occurred_at`, a pre-published or future-dated outbox event, invalid inputs, and duplicate events.
- Mutation checks: dropping the triggers, disabling sensitive-key redaction, or removing the purpose check from the policy each fails a named test.

## Not done

- `resource_id` and `aggregate_id` are not checked against the tenant's records. Callers pass the id returned by their own RLS-scoped write.
- No lookup indexes on `audit_event` yet; the reader work adds them.
- Audit rows block deleting their organisation or principal (foreign keys plus the trigger). Erasing personal data from audit history needs the retention policy work (ADR 0005).
- `INSERT … ON CONFLICT DO NOTHING` on the outbox is allowed; callers must not use it, so that duplicates surface as `DuplicateEventError`.

- Reading audit events (BOR/admin view, with its own access rules).
- The outbox publisher, consumer receipts, retries and dead-letter handling (#84 part 2).
- The hash chain and externally retained checkpoints (ADR 0005; needs #99 and #101).
- Audit retention and privacy policy.
- Callers: tasks (#44) will be the first.

## Rollback

Revert the PR. No shared or production database exists. Once one does, schema changes are forward-only (ADR 0010).
