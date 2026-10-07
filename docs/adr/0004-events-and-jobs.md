# ADR 0004-events-and-jobs: Transactional outbox and at-least-once execution

Status: Proposed — derived from seed and current user instruction; repository reconciliation pending.

## Context
The seed defines product boundaries but lacks implementation-level invariants. No current repository decision has been verified.

## Decision
Write domain mutation, minimized AuditEvent and DomainEvent/outbox within one PostgreSQL transaction. Outbox is foundational M1 work; the seed M8 outbox issue should be reconciled and moved/split deliberately rather than duplicated. Rule configuration/simulation stays M8.

Use tenant-scoped stable event IDs, aggregate version, event schema version, actor, correlation and causation IDs. Do not place full PII or document contents in event payloads. Consumers use a unique (organization_id, consumer, event_id) receipt and transactional effects; job delivery is at least once, never claimed exactly once. Use leases, heartbeat, bounded retries, backoff, dead-letter state and explicit replay permissions. Approval-controlled jobs verify approval immediately before side effects. Concurrent workers use locking and compare-and-set completion; idempotency protects re-delivery.

Webhook ingress verifies provider authenticity, connection/tenant mapping, replay window where supported and deduplication before dispatch. Provider IDs are unique within connection/resource type, never domain primary keys. Integration unknowns remain disabled adapters.

## Consequences
Shared domain rules and tenant-scoped persistence are required. Unconfirmed policies and entitlements stay configurable and disabled by default. Existing repository decisions must be compared before adoption; document any conflict rather than silently replacing it.

## Verification before acceptance
Trace to the relevant reconciled GitHub issue, review the core model/security implications, and add automated tests for tenant isolation, invalid transitions, least privilege and applicable approval/replay/concurrency boundaries. Verify migration and recovery implications. Legal or brokerage policy choices require the named accountable reviewer.
