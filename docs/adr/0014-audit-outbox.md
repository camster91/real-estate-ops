# ADR 0014: Audit events and the transactional outbox (writer side)

Status: Implemented for synthetic data. Supports #98 (audit and redaction) and #84 (outbox, writer side only). The owner approved the plan in #134. Applies ADR 0004 and the audit part of ADR 0005.

## Decision

1. **The app can write history but never read, edit or delete it.**
   - `reo_app` may only INSERT into `audit_event` and `outbox_event`, and only for its own tenant and principal while it has an active membership. This is enforced by RLS `WITH CHECK`.
   - A trigger refuses UPDATE, DELETE and TRUNCATE on `audit_event` for every role, the owner included. A database administrator cannot quietly rewrite history; changing it needs a reviewed migration.
2. **Fail-safe redaction.** `minimiseDetails()` runs on every audit `details` object and every event `payload`. It:
   - keeps up to 20 keys whose names look like code identifiers
   - stores the value of any key whose name looks sensitive (`email`, `phone`, `name`, `address`, `birth`, `dob`, `social`, `note`, `body`, `message`, `token`, `secret`, `password`, `account`, or exactly `sin`) as `"[redacted]"`
   - keeps only strings (cut to 200 characters), finite numbers, booleans and null
   - drops everything else

   The database also requires a JSON object of at most 4096 bytes.
3. **Event payloads carry ids and codes only**, under the same rules, so personal details never reach future consumers.
4. **One helper for every change.** `recordChange(client, change)` writes both rows on the caller's `withTenant()` transaction:
   - Organisation, actor and purpose come from the transaction's context in SQL (`app.current_*()`), never from arguments.
   - Without a tenant context it throws `MissingTenantContextError` before writing anything.
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
- `packages/db/src/audit.test.ts`: redaction, the type filter, truncation, the key limit and key names.
- Mutation checks: dropping the triggers, or disabling sensitive-key redaction, each fails a named test.

## Not done

- Reading audit events (BOR/admin view, with its own access rules).
- The outbox publisher, consumer receipts, retries and dead-letter handling (#84 part 2).
- The hash chain and externally retained checkpoints (ADR 0005; needs #99 and #101).
- Audit retention and privacy policy.
- Callers: tasks (#44) will be the first.

## Rollback

Revert the PR. No shared or production database exists. Once one does, schema changes are forward-only (ADR 0010).
