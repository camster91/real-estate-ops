# Real Estate Ops

A Toronto/Ontario-focused real estate operations platform for brokerages and multi-service real estate teams.

## Product goal

Create one operational system for leads, contacts, properties, transactions, tasks, documents, compliance, communications, commissions, reporting, and controlled AI-assisted automation.

The product is intentionally **API-first and human-controlled**. A local Mac gateway can use sanctioned desktop/browser workflows when a clean API is unavailable, but it is not the primary database or application server.

## Core principles

1. One source of truth for operational records.
2. Role-specific UX instead of one overloaded dashboard.
3. Deterministic workflow automation before AI.
4. Human approval for external, financial, compliance-submission, permission, and destructive actions.
5. Privacy-by-design and least-privilege access.
6. Toronto/Ontario brokerage compliance is P0.
7. Integrate through supported APIs before browser automation.
8. Every important automated action is auditable.

## Initial stack

- Monorepo: pnpm + Turborepo
- Web: Next.js + TypeScript
- API: Fastify + TypeScript
- Database: PostgreSQL
- Background jobs: PostgreSQL-backed queue
- Storage: encrypted S3-compatible object storage in a Canadian region where practical
- Auth: OIDC/OAuth with Google and Microsoft support; application RBAC/ABAC
- Tests: Vitest + Playwright
- Observability: structured logs, traces, error tracking, audit log
- Local gateway: macOS service + Hermes/Codex tool adapters

## Applications

- `apps/web` — staff and management application
- `apps/api` — core API, webhooks, auth callbacks
- `apps/worker` — background jobs, sync, automation, notifications
- `apps/mac-gateway` — controlled local agent bridge

## Key domains

CRM, leads, properties, listings, service engagements, transactions, work, documents, communications, compliance, finance/commissions, reporting, integrations, automation, agent approvals, audit.

## Delivery sequence

M0 Product Definition → M1 Platform Foundation → M2 CRM + Leads → M3 Properties + Listings → M4 Transactions + Work → M5 Documents + Compliance → M6 Communications → M7 Mac Agent Gateway → M8 Automation + Ops Inbox → M9 Finance + Reporting → M10 Pilot → M11 Production.

See `/docs`. GitHub issues are the canonical backlog; `/backlog/issues.json` is the original import seed.
