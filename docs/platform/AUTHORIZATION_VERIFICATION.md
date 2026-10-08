# Authorization contract verification — 8 October 2026

Scope: review-branch @reo/auth decision contracts; partial groundwork for #97 and #75. Not authenticated middleware or completion of either issue. Existing API operational denial remains enabled.

## Completed and verified locally

- Node 24.19.0 and pnpm 11.25.0; locked install with no new external dependency.
- 64 Vitest tests pass, including 50 authorization boundary cases and the existing 14 config/API checks.
- Strict typecheck passes for all six packages/apps (web, API, worker, gateway, config, auth).
- All six builds pass. Initial web build failed with ENOSPC; only generated checkout-local cache was cleared and the retry succeeded after disk space became available. No unrelated files deleted.
- Biome check and limited source credential-pattern check pass; five Python reconciliation tests pass.
- GitHub milestone readback verifies all 113 issue assignments; no issue duplicated or automatically closed.

## Limits and next verification

No changed UI journey; this slice does not claim new rendered product behavior. Existing #116 responsive/keyboard CI passed; the new branch's CI will separately run version-matched browser checks. No real OIDC/session, policy database, row-level-security runtime, storage/worker enforcement, append-only audit, transactional approval consumption, replay/concurrency guarantee or gateway execution exists. AuditRequired is a contract obligation, not proof of persisted events. Query lists/search/exports/counts must be authorized before aggregation; synthetic per-record tests do not prove future query safety.

Policies/grants/rules and clock must be freshly loaded by trusted authenticated server code. Never accept them from browser inputs. Do not expose denial reasons revealing hidden records to an untrusted user. L3 remains denied even with caller approval fields; L4 is denied. Next safe slice is synthetic PostgreSQL membership/RLS and transaction tests under #96 before exposing routes or claiming #97 middleware complete.

Rollback: remove additive @reo/auth package and importer entry; documentation/map changes are versioned. No database migration, account permission, production deployment, external send or money movement occurred. M0 policy review and M1 completion remain open.
