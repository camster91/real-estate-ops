# Real Estate Ops

A Toronto/Ontario-focused real estate operations platform for brokerages and multi-service real estate teams.

## Product goal

This is the goal, not a list of what exists today. Create one operational system for leads, contacts, properties, transactions, tasks, documents, compliance, communications, commissions, reporting, and controlled AI-assisted automation.

The product is intended to be **API-first and human-controlled**. A local Mac gateway can use sanctioned desktop/browser workflows when a clean API is unavailable, but it is not the primary database or application server.

## Current status

Early development, for local use with synthetic data only. It is not production-ready: the API, worker and gateway refuse any `NODE_ENV` other than `development` or `test`, the API only listens on loopback, `/health/ready` always returns 503, and there is no deployment configuration.

Built so far (see the ADRs in [docs/adr](docs/adr)):

- Staff sign-in with Google or Microsoft (OIDC) and server-side sessions. It is off until a provider is configured; tests use a fake issuer.
- Tenant isolation with PostgreSQL row-level security, record-level grants, append-only audit events and the writing side of a transactional outbox.
- Web screens and API routes for "My tasks", clients, client consent records, deals and deal key dates.
- Placeholder content that still needs owner approval: consent wording and deal stage names.

Not built yet: leads, full properties and listings, the deal checklist, documents, FINTRAC records, e-signing, email/calendar, finance, reporting, AI features and all external integrations other than sign-in. `apps/worker` and `apps/mac-gateway` only report that they are disabled and exit. The order of work is in the [pilot plan](docs/roadmap/PILOT.md).

## Core principles

1. One source of truth for operational records.
2. Role-specific UX instead of one overloaded dashboard.
3. Deterministic workflow automation before AI.
4. Human approval for external, financial, compliance-submission, permission, and destructive actions.
5. Privacy-by-design and least-privilege access.
6. Toronto/Ontario brokerage compliance is P0.
7. Integrate through supported APIs before browser automation.
8. Every important automated action is auditable.

## Stack

In use:

- Monorepo: pnpm + Turborepo, Node 24, TypeScript
- Web: Next.js + React
- API: Fastify
- Database: PostgreSQL 16, with SQL migrations in `packages/db/migrations`
- Auth: OIDC with Google and Microsoft support (`openid-client`)
- Tests: Vitest + Playwright; lint and format: Biome

Planned:

- PostgreSQL-backed job queue
- Encrypted S3-compatible object storage in a Canadian region where practical
- Traces and error tracking (the API has structured logs today)
- Local gateway: macOS service + Hermes/Codex tool adapters

## Repository map

- `apps/web` — staff web app; passes `/auth/*` and `/v1/*` through to the API
- `apps/api` — API, sign-in callbacks and tenant routes
- `apps/worker` — background jobs (disabled placeholder)
- `apps/mac-gateway` — controlled local agent bridge (disabled placeholder)
- `packages/auth`, `packages/config`, `packages/db`, `packages/domain` — authorization contracts, environment checks, database access and migrations, shared business rules
- `e2e` — Playwright screen tests
- `docs` — product, architecture, security, compliance, roadmap and ADRs
- `backlog`, `tools` — original issue import seed and a read-only backlog reconciliation tool

## Run locally

You need Node 24.19.x and pnpm 11.25.0. Database tests also need PostgreSQL 16 (Docker Compose is provided).

```bash
pnpm install --frozen-lockfile
pnpm turbo run dev --filter=@reo/web   # http://127.0.0.1:3000
pnpm turbo run dev --filter=@reo/api   # http://127.0.0.1:4000 (separate terminal)
```

Without a configured sign-in provider, every `/v1/*` request returns 401. [Local development](docs/platform/LOCAL_DEVELOPMENT.md) has the full notes and [sign-in setup](docs/platform/IDP_SETUP.md) covers the providers. There is no migration command; `packages/db` exports the migration runner, which the database tests use.

### Environment variables

[.env.example](.env.example) lists the names. The API reads its process environment and does not load a `.env` file itself.

- Runtime: `NODE_ENV`, `PORT`, `HOST`
- Web and API: `REO_PUBLIC_URL`, `REO_API_ORIGIN`
- Required when sign-in is on: `REO_DATABASE_URL`, `REO_LOGIN_COOKIE_SECRET`
- Google: `REO_GOOGLE_CLIENT_ID`, `REO_GOOGLE_CLIENT_SECRET`, `REO_GOOGLE_HOSTED_DOMAINS` (optional)
- Microsoft: `REO_MICROSOFT_CLIENT_ID`, `REO_MICROSOFT_CLIENT_SECRET`, `REO_MICROSOFT_TENANT_ID`
- Tests only: `REO_TEST_DATABASE_URL`, `REO_TEST_OIDC_ISSUER`, `REO_TEST_BROWSER_EXECUTABLE`

### Checks and tests

```bash
pnpm lint
pnpm security:source   # limited credential-pattern scan
pnpm check             # typecheck, unit tests, build

docker compose up -d --wait postgres
REO_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm test:db

pnpm exec playwright install chromium --only-shell
pnpm test:e2e          # uses mocked API responses; no database needed
```

CI ([ci.yml](.github/workflows/ci.yml)) runs these on pull requests and `main`, plus a dependency audit and the backlog tool's Python tests. It does not deploy.

## Planned product domains

CRM, leads, properties, listings, service engagements, transactions, work, documents, communications, compliance, finance/commissions, reporting, integrations, automation, agent approvals, audit.

## Delivery sequence

M0 Product Definition → M1 Platform Foundation → M2 CRM + Leads → M3 Properties + Listings → M4 Transactions + Work → M5 Documents + Compliance → M6 Communications → M7 Mac Agent Gateway → M8 Automation + Ops Inbox → M9 Finance + Reporting → M10 Pilot → M11 Production.

The milestones are described in the [roadmap](docs/roadmap/ROADMAP.md). Contributors and agents should read [AGENTS.md](AGENTS.md). GitHub issues are the canonical backlog; `/backlog/issues.json` is the original import seed.

## Licence

This repository does not contain a licence file.
