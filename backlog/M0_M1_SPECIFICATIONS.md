# Proposed M0 / M1 issue specifications

23 existing seed intents expanded. IDs refer to seed inventory, not GitHub issue numbers. Dependencies are proposed implementation gates; reconcile against current work before adoption. No issue is marked complete.

## REO-SEED-001 — EPIC 01: Define service taxonomy and product boundaries

Milestone: M0. Dependencies: none within this subset.

- Approve service boundary glossary and map child workflow decisions; record company-specific unknowns.
- Epic closure requires verified child outcomes; document proposals alone do not complete it.

## REO-SEED-002 — EPIC 02: Define roles, teams and permissions model

Milestone: M0. Dependencies: REO-SEED-001.

- Approve tenant/brokerage/team model and permission matrix with named access/compliance owners.
- Every role has record scope, restricted-data behaviour and approval authority; no executive-to-BOR inference.

## REO-SEED-019 — EPIC 19: Create Figma design system and core UX

Milestone: M0. Dependencies: REO-SEED-001, REO-SEED-002.

- Link current Figma evidence and define reusable tokens/components and core flows.
- Close only after child design criteria and responsive/accessibility evidence are reviewed.

## REO-SEED-021 — Map buyer, seller, lease, commercial, referral and property-management workflows

Milestone: M0. Dependencies: REO-SEED-022.

- Document candidate buyer, seller, lease, commercial, referral and management workflows with actor, inputs, gates and exceptions.
- Separate service completion from legal trade/compliance decisions; unresolved brokerage variants are disabled templates.

## REO-SEED-022 — Define service types, engagement lifecycle and terminology glossary

Milestone: M0. Dependencies: none within this subset.

- Define Party, Property, Listing, Transaction and ServiceEngagement boundaries and cardinalities.
- Publish versioned candidate taxonomy and glossary; preserve actual service approval as a client decision.

## REO-SEED-023 — Define external partner and vendor operating model

Milestone: M0. Dependencies: REO-SEED-022, REO-SEED-025.

- Specify explicit partner/vendor grants with purpose, expiry, resource projection and revocation.
- Test design against another household member, counterparty and hidden compliance document; invitation is approved.

## REO-SEED-024 — Define authorization matrix for owner, BOR, manager, agent, operations, finance, partner and client

Milestone: M0. Dependencies: REO-SEED-025, REO-SEED-026.

- Define action/role/scope/data-classification matrix for owner, BOR, manager, agent, operations, finance, partner and client.
- List deny fixtures for horizontal/vertical escalation, self-approval and expired/revoked grants.

## REO-SEED-025 — Define record-level access and team/branch boundaries

Milestone: M0. Dependencies: REO-SEED-022.

- Define tenant versus accountable brokerage registration and effective BOR/branch/team assignments.
- Tenant-scoped child foreign keys, RLS runtime roles and access rules are specified; actual organization mapping stays explicit.

## REO-SEED-026 — Define service-account and system-agent identities

Milestone: M0. Dependencies: REO-SEED-025.

- Specify principal/service/device identity, issuer+subject uniqueness and approved tenant membership.
- An agent gets the intersection of requester and capability rights; no implicit user or admin impersonation.

## REO-SEED-018 — EPIC 18: Platform security, privacy and audit foundation

Milestone: M1. Dependencies: REO-SEED-002.

- Security foundation epic maps verified auth, tenant, audit, storage, recovery and operations evidence.
- Track partial completion and required security review separately; no production readiness claim from scaffold tests.

## REO-SEED-095 — Initialize pnpm/Turborepo monorepo and CI

Milestone: M1. Dependencies: REO-SEED-025, REO-SEED-026.

- Create all four apps and shared packages, pin supported versions and lockfile, validate env and repeatable local startup.
- Clean checkout installs and typechecks/builds; CI has least permissions and no secret leakage; failure states are actionable.

## REO-SEED-096 — Implement organization/tenant boundary and auth foundation

Milestone: M1. Dependencies: REO-SEED-095, REO-SEED-025, REO-SEED-026.

- Implement approved memberships, verified OIDC/session boundary and tenant-scoped persistence.
- Non-owner PostgreSQL tests deny forged tenants, inactive membership, missing context and cross-tenant associations.

## REO-SEED-097 — Implement RBAC/record authorization middleware

Milestone: M1. Dependencies: REO-SEED-096, REO-SEED-024.

- Implement one shared default-deny RBAC/ABAC policy and consistent API/worker/storage authorization.
- List/detail/search/export/aggregate and task execution cannot leak unauthorized records; role revocation takes effect.

## REO-SEED-098 — Implement audit event service and sensitive-field redaction

Milestone: M1. Dependencies: REO-SEED-096, REO-SEED-097.

- Write redacted actor/purpose/resource/correlation audit atomically with important mutations.
- App cannot edit/delete history; failed domain transaction leaves neither audit nor outbox; sensitive reads/exports are covered.

## REO-SEED-099 — Implement encrypted object storage and malware/file validation

Milestone: M1. Dependencies: REO-SEED-096, REO-SEED-097, REO-SEED-098.

- Implement encrypted versioned object abstraction, quarantine, file validation and scan states with fail-closed access.
- Cross-tenant/download/expiry tests, unsafe files, scan failure, version checksum and retention/hold constraints are evidenced.

## REO-SEED-100 — Implement secrets management, dependency scanning and security CI

Milestone: M1. Dependencies: REO-SEED-095.

- Validate secrets-store references and run dependency/secret scans with supported pinned versions.
- No source/log credentials; invalid security config fails startup; findings have severity, owner and resolution evidence.

## REO-SEED-101 — Implement backup/restore procedure and test

Milestone: M1. Dependencies: REO-SEED-096, REO-SEED-098, REO-SEED-099.

- Specify approved RPO/RTO, encrypted backups, restore role and migration/forward-repair runbook.
- Isolated restore proves database/object/audit integrity and reports measured recovery against agreed objectives.

## REO-SEED-102 — Implement observability, structured logging and alerting

Milestone: M1. Dependencies: REO-SEED-095.

- Structured redacted logs/traces, safe error envelopes, correlation IDs and separate health/readiness.
- Sensitive values are absent, unavailable DB changes readiness, trace correlation works and alert ownership is recorded.

## REO-SEED-103 — Create Figma foundations, tokens and reusable component library

Milestone: M0. Dependencies: REO-SEED-019.

- Create/verify linked Figma typography, colour, spacing and semantic component tokens.
- Keyboard/focus/disabled/error/loading states and contrast are specified in reusable components; no completion without file evidence.

## REO-SEED-104 — Design Command Centre and Operations Inbox

Milestone: M0. Dependencies: REO-SEED-103, REO-SEED-024.

- Design role-scoped Command Centre and exception Operations Inbox with owner, source, next action and resolution.
- Hidden records do not leak in counts; waiting/blocked states and readable mobile/tablet/desktop layout are demonstrated.

## REO-SEED-105 — Design Contact 360, Property 360 and Transaction Workspace

Milestone: M0. Dependencies: REO-SEED-103, REO-SEED-022, REO-SEED-024.

- Design distinct Contact 360, Property 360 and Transaction Workspace with safe linked records and clear identity boundaries.
- Empty/loading/error/stale-edit and restricted-data projections are explicit; navigation and keyboard paths reviewed.

## REO-SEED-106 — Design Compliance Centre and agent work queue

Milestone: M0. Dependencies: REO-SEED-103, REO-SEED-024.

- Design Compliance Centre and agent queue with applicability/evidence/human review and action levels.
- AI advisory text never resembles regulatory approval; expired/revoked/offline approval states show safe next steps.

## REO-SEED-107 — Define responsive/accessibility acceptance criteria

Milestone: M0. Dependencies: REO-SEED-103.

- Define representative 390/768/1440px checks, semantic labels, keyboard order, focus visibility and contrast criteria.
- Include forms/errors, zoom/reflow and accessible empty/loading states; actual QA evidence remains required per feature.

