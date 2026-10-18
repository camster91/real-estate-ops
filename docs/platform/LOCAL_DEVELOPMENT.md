# M1 tooling slice

This branch is a local development scaffold, not a functioning brokerage system or production-ready M1. It is stacked on the M0 planning branch. No real operational records, authentication provider, database migrations, job queue, object storage, compliance rules or live integrations are enabled.

## Run locally

1. Install Node 24.19.x and pnpm 11.25.0. Dependencies are exact-pinned with pnpm-lock.yaml.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm lint`, `pnpm security:source` and `pnpm check`.
4. Run `pnpm turbo run dev --filter=@reo/web` for the pending-workspace page at http://127.0.0.1:3000. It sends no X-Powered-By header and sets nosniff, DENY framing and no-referrer headers; a full script CSP is still pending.
5. Run `pnpm turbo run dev --filter=@reo/api` for the API (Turbo builds shared packages first; restart after editing them) at http://127.0.0.1:4000. PORT is configurable; HOST only accepts loopback. Liveness is `/health/live`; `/health/ready` returns 503 until foundation dependencies exist. Every `/v1/*` request returns 401 regardless of supplied credentials or tenant headers.
6. Database tests need PostgreSQL 16. Run `docker compose up -d --wait postgres` (loopback only, synthetic data only), then `REO_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm test:db`. Each test file creates and drops its own `reo_test_*` database and login role. `pnpm test` stays database-free. Stop with `docker compose down -v`. See ADR 0010.
7. Run `pnpm exec playwright install chromium --only-shell`, then `pnpm test:e2e`. Tests cover 390/768/1440px, basic keyboard focus/skip link, language and horizontal overflow. This is not a full accessibility audit.

Worker and gateway entry points only report disabled diagnostics and terminate. They expose no job executor, polling connection, model adapter or filesystem capability. API/worker/gateway configuration rejects NODE_ENV=production. No secret files belong in git; `.env.example` contains non-sensitive defaults. Next.js production compilation is tested, but that is not permission or readiness to deploy.

An optional REO_TEST_BROWSER_EXECUTABLE path is accepted only by Playwright test configuration when the version-matched browser download is unavailable. The observed local download returned an invalid archive; local QA used the existing Chromium runtime. CI installs the version-matched browser. Browser mismatch limits that local QA evidence and must remain visible.

## Security and operational limits

Logs intentionally omit request URL/query, body and headers; authorization/cookies/set-cookie also have redaction paths. Errors return safe envelopes. Client errors (4xx, e.g. malformed JSON) keep their status and log only the error code; unexpected 5xx failures are logged with the error and stack. The source credential-pattern check is deliberately limited and does not replace provider secret scanning, full-history scanning or security review. pnpm dependency audit checks current known advisories, not security of business logic. Dependency install scripts are denied by default except the explicit esbuild build allowlist. CI action commit references were read from official action repositories and pinned.

Authentication, RBAC/ABAC and tenant RLS require their own testable slice; denial of all API access is not evidence they are implemented. Shared configuration is centralized in @reo/config. No financial, regulatory, permission or communication actions exist.

## Migration, deployment and rollback

This slice changes no database or production configuration. Rollback is reverting its additive files on the feature branch. No main merge or deploy has been executed. Keep main approval-controlled. Follow ADRs and the M1 plan before adding schema, queue, audit/evidence or storage. Approve brokerage/retention/integration decisions before enabling affected features.
