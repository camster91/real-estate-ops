# Pickup handoff — 8 October 2026

GitHub is the implementation record: https://github.com/camster91/real-estate-ops.

## Saved state

- PR #114: seed and proposed M0 planning; base main. Open, not merged.
- PR #116: tooling and fail-closed app scaffold; base codex/m0-seed-and-planning. Open; foundation CI passed at 1a5248cc65540a3c9c093111d1a768ab40e69e7c (run 37677484535).
- PR #117: shared authorization contracts and reconciled planning; base codex/m1-tooling-foundation. Open; foundation CI passed at 3a1a24749b73a953e877902b1f27b170d4ad7ea0 (run 37775948687), including version-matched browser checks. GitGuardian passed; neutral automated reviewer statuses do not establish human approval.
- All 12 milestones created; all 113 stable seed markers/intents and milestone assignments read back; no duplicate imports or feature closures. The outbox is #84 in M1; #83 inbox filtering is M8 (corrected 15 October 2026, see RECONCILIATION_2026-10-07.md).
- Shared @reo/auth has 50 new boundary tests; 64 total Vitest tests and six package/app typechecks/builds pass. Formatting, limited source scan and five reconciliation tests pass. Initial local web build hit ENOSPC; retry passed after clearing only generated local cache.
- Decisions, issue map, ADR 0009 and verification limits are saved on codex/m1-authorization-contracts. M0 and M1 remain incomplete. No main merge, production deployment, live auth, financial/compliance submission, permission change or external communication occurred.

## Safe resume procedure

1. Fetch GitHub state and inspect branches, open PRs, checks, applicable AGENTS and local changes. Resume from codex/m1-authorization-contracts, preserving unrelated work. Do not assume this handoff is current approval.
2. Read docs/product/DECISION_REGISTER.md, docs/product/AUTHORIZATION.md, docs/adr/0009-authorization-contracts.md, docs/platform/M1_PLAN.md and docs/platform/AUTHORIZATION_VERIFICATION.md.
3. #96 part 1 (synthetic PostgreSQL tenant/membership schema, forced RLS, non-owner tests, migration runner; ADR 0010) is implemented. #97 part 1 (record grants, `app.readable_record` read filter, `authorizeInTenant`; ADR 0011) is implemented. #96 part 2 (Google/Microsoft OIDC login, server-side sessions; ADR 0012) is implemented for synthetic identities; registering the real providers is an owner action (`docs/platform/IDP_SETUP.md`). #96 part 3 (organisation in the URL, `requireSession`, `inTenant`, the first tenant route `GET /v1/organizations/:organizationId/branches`, same-origin writes; ADR 0013) is implemented. Audit events and the transactional outbox, writer side (`recordChange`, append-only `audit_event`, `outbox_event`; ADR 0014), are implemented. The first tasks slice (#44: the `task` table, `@reo/domain` rules, `GET`/`POST /v1/organizations/:organizationId/tasks`; ADR 0015) is implemented. Web sign-in, the brokerage picker and the "My tasks" screen (responsive, keyboard, empty/loading/error states, America/Toronto times; ADR 0016) are implemented, so the first vertical slice works end to end for synthetic data. Next: task status changes, or the Figma restyle once #103 is ready. The grant admin path waits for #24 approval. Do not enable API access merely because database tests pass.
4. Keep work on small review branches with issue-linked tests/evidence. Stacked PRs require deliberate rebase/retarget after separately approved upstream merges; do not auto-merge or deploy.

## Blockers and owners

| Dependency | Owner / resume condition |
|---|---|
| Original seed archive comparison | Cameron supplies accessible real-estate-ops-github-seed.zip; neither connected Drive search exposed it. Imported repository seed was read, not independently byte-compared. |
| Private build Project and fields | Cameron/GitHub administrator supplies Project capability or configures it; #115 remains open. CLI lacks read:project; no permissions changed. |
| Brokerage structure, BOR/compliance review and pilot services | Cameron identifies registrations/branches, accountable reviewer and service scope. Proposed policies/templates remain disabled. |
| OIDC provider tenants, hosting/residency and production secrets | Cameron/identity/infrastructure owner supplies reviewed choices; isolated synthetic contracts may progress. |
| Core Figma/UX evidence | #103–#107 remain open; the scaffold page is not product-journey completion. |

No repeated blocked checks are necessary without changed evidence. Unknown retention, legal applicability, data entitlements and financial rules remain explicit gates rather than invented defaults. Production/main approval and client acceptance are separate from reviewed code.
