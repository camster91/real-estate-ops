# AGENTS.md

## Mission
Build a reliable, privacy-conscious real estate operations platform for an Ontario brokerage/team.

## Working rules
- Preserve tenant and client isolation.
- Never weaken auth, permissions, audit logging, retention, or approval gates to make a feature easier.
- Prefer official APIs and webhooks over browser automation.
- Do not scrape or persist MLS/industry data beyond the rights granted by the applicable agreement.
- External messages, signature sends, regulatory submissions, money movement, permission changes, production deploys, and destructive actions require explicit human approval.
- AI output is advisory unless a deterministic rule explicitly allows a safe internal action.
- Compliance workflows support staff; they do not replace the broker of record, legal counsel, accountants, or FINTRAC compliance personnel.
- Use Canadian spelling and America/Toronto for user-facing dates/times unless a record specifies otherwise.

## Engineering
- TypeScript strict mode.
- Shared domain schemas; no duplicate business rules between web/API/worker.
- Idempotent integration handlers and jobs.
- Outbox/event pattern for state changes that trigger async work.
- All external writes must be retriable and auditable.
- Tests must cover authorization boundaries, workflow transitions, webhook replay, and approval bypass attempts.
- No secrets in source control or logs.

## Definition of done
A feature is not done until permissions, audit events, error states, representative mobile/tablet/desktop QA, accessibility basics, tests, observability, and rollback/migration implications are addressed.
