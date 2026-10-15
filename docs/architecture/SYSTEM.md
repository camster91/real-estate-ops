# System architecture

## Shape

```text
Users
  │
  ▼
Web app ───── API ───── PostgreSQL
                │            │
                │            ├─ domain records
                │            ├─ audit log
                │            └─ outbox/jobs
                │
                ├─ object storage
                ├─ OAuth/API integrations
                ├─ webhook receiver
                └─ worker
                      │
                      ▼
               automation engine
                      │
                approval service
                      │
                      ▼
                Mac Gateway
                 │       │
              Hermes   Codex
                 │       │
              MCP/API  specialist tools
```

## Key architectural decisions
1. The cloud service is authoritative; the Mac is not the system of record.
2. The Mac gateway makes outbound authenticated connections; no public inbound desktop port.
3. Domain events use an outbox pattern so transaction changes and integrations cannot silently diverge.
4. External objects carry `external_reference` records rather than contaminating domain IDs.
5. Every external side effect has idempotency keys and an audit event.
6. PII presented to AI is minimized to the fields required for the task.
7. Sensitive documents are never automatically placed into model context.

## Availability
If the Mac gateway is offline, core CRM, task, property, transaction, document metadata, reporting and API integrations continue to work. Only gateway-dependent jobs pause.
