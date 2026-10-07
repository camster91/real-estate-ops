# ADR 0008-platform-delivery: Preserve seed stack and establish reviewable foundations

Status: Proposed — derived from seed and current user instruction; repository reconciliation pending.

## Context
The seed defines product boundaries but lacks implementation-level invariants. No current repository decision has been verified.

## Decision
Retain pnpm/Turborepo, strict TypeScript, Next.js web, Fastify API, PostgreSQL, a PostgreSQL-backed queue, encrypted S3-compatible storage, OIDC for Google/Microsoft, Vitest and Playwright. Shared packages own domain, db, auth, audit, compliance, integrations, workflows, automation and UI rules. Web never accesses the database directly; gateway never holds broad database credentials.

Do not choose library/runtime versions, cloud vendor, queue library or OIDC adapter from memory. Verify supported official documentation/security advisories and pin compatible versions with a lockfile during M1. Avoid exposing implementation complexity in user-facing flows. Separate development/test/staging/production credentials and databases, validate environment at boot, redact logs, expose liveness separately from dependency readiness, and deny startup with invalid auth/security configuration.

Migration convention: expand/backfill/validate/contract, explicit preconditions and forward repair. Destructive rollback is not automatic. CI runs typecheck/unit/integration/authorization/build/dependency and secret checks with minimum token permissions. PRs require direct evidence and human approval before merge to main. Production requires restore rehearsal, independent security review, pilot sign-off and explicit deployment approval.

## Consequences
Shared domain rules and tenant-scoped persistence are required. Unconfirmed policies and entitlements stay configurable and disabled by default. Existing repository decisions must be compared before adoption; document any conflict rather than silently replacing it.

## Verification before acceptance
Trace to the relevant reconciled GitHub issue, review the core model/security implications, and add automated tests for tenant isolation, invalid transitions, least privilege and applicable approval/replay/concurrency boundaries. Verify migration and recovery implications. Legal or brokerage policy choices require the named accountable reviewer.
