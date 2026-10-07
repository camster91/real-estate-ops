# M1 implementation and acceptance plan

Not started. Repository access and reconciled core-model gate are prerequisites. Package/tool/provider choices require current official documentation during implementation.

| Slice | Concrete deliverable | Verification |
|---|---|---|
| M1-A tooling | Four expected apps, shared packages, strict TS, pinned pnpm/runtime, Turborepo, lockfile, local compose environment and validated env examples | Clean-install typecheck/build and reproducible local startup; no secrets |
| M1-B persistence | Tenant/membership foundation, migration runner, runtime RLS roles, synthetic fixtures, optimistic concurrency | PostgreSQL integration tests with non-owner role; cross-tenant FK and RLS denial; migration from clean/previous schema |
| M1-C auth | Verified Google/Microsoft OIDC issuer/audience/signature/expiry, secure sessions, approved memberships, RBAC/ABAC | Forged/expired/revoked identity, inactive membership and scope-escalation tests; CSRF/state/nonce/PKCE where applicable |
| M1-D durable work | Audit + transactional outbox + queue contracts, consumer dedupe, lease/retry/dead-letter, approval primitives | Rollback leaves no partial mutation/event; duplicate/concurrent delivery yields one internal effect; stale/reused/self-approved actions denied |
| M1-E files | Encrypted storage abstraction, quarantine, type/size checks, malware adapter, authorized versioned download | Cross-tenant object access denial, unsafe upload denial, scan failure closed, expiry/revocation |
| M1-F operations | Redacted structured logs, request/trace IDs, error envelopes, liveness/readiness, CI and dependency/secret scanning | Sensitive-field tests, invalid env refusal, unhealthy dependency readiness, CI evidence |
| M1-G recovery | Backup/restore design, encrypted backup access, versioned migration conventions and runbook | Restore into isolated environment; integrity/audit checks; actual recovery times recorded against approved RPO/RTO |

## Core-model gate
Repository/seed reconciled; tenant/legal brokerage distinction recorded; Party/property/listing/engagement/transaction boundaries stable; authorization defaults and approval semantics documented; compliance/retention extension points fail closed; accountable unknowns registered; required M0 design/product tasks have verified status. Do not claim all M0 complete merely because proposed ADRs exist. M1 foundation should avoid broad feature-domain migrations until their models are accepted.

## Suggested first vertical slice
Authenticate a synthetic member and read a tenant-scoped assigned work summary through web → API → PostgreSQL. Unauthorized membership/cross-tenant requests return safe errors; responsive UI has empty/loading/error states and keyboard navigation. A reversible internal synthetic task creation adds mutation, audit and outbox atomically. No live integrations, financial actions, regulatory submission or external sends. Add a reviewed approval fixture to prove bypass attempts fail without enabling external execution.

## QA evidence per PR
Issue-linked acceptance criteria; unit/integration/E2E output and exact commit; mobile 390px, tablet 768px, desktop 1440px representative QA; keyboard/focus semantics and accessible labels/contrast; error/empty/loading/stale-edit states; tenant/authorization and audit verification; schema/migration/forward-repair implications; logs/traces; dependency/security result; screenshot evidence where useful. Viewport values are proposed QA targets, not tests already run.

## Delivery and rollback
Small reviewable branches/commits and PRs against reconciled issues. No merge to main or production deployment without explicit human approval. Expand/contract migrations maintain compatibility; destructive contraction requires verified backup and explicit approval. Infrastructure restore, OAuth revocation, paused outbox/jobs, gateway revocation and provider reconciliation must be documented. Application rollback alone cannot reverse a sent message or signature package.
