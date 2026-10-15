# ADR 0009: Explicit authorization contracts before runtime activation

Status: Implemented on a review branch; merge approval pending. Supports #24, #26, #76 and #97 without closing them.

## Decision

Add @reo/auth as one shared policy package. A policy request uses trusted server-side active membership and grants, an exact tenant/resource/classification/action/purpose, and a server clock. No built-in role grants, wildcard resource expansion or email-domain membership. Matching permissions must come from one complete grant; fragments cannot combine into access. Service access intersects an active human requester's rights and forbids restricted compliance evidence.

L1 task creation requires a matching approved, current, reversible, audited internal rule. L2 permits drafts only. Every L3 decision denies with human_approval_required, even when the caller attaches an approval claim; L4 never unlocks. This is not a durable approval service. All allows require audit; the policy evaluator does not itself persist audit or execute work.

## Boundary

Inputs must come from fresh authenticated server-side policy snapshots, never request headers or claimed identity/role/grants. TypeScript types are not authentication. Invalid/missing context fails closed. No API route is enabled; existing /v1 denial and production startup refusal stay in place. Query/aggregate filtering must occur before counts/pagination; a per-record evaluator is not safe query middleware. Storage, worker, OIDC, RLS, concurrency/revocation guarantees and transactional audit remain unimplemented. No full #97 completion is claimed.

## Evidence and rollback

Unit tests cover tenant/record/purpose/classification boundaries, time windows, revocation, grant fragment escalation, requester intersection, KYC denial, unsafe internal rules, consequential execution and malformed runtime values. See AUTHORIZATION_VERIFICATION.md for executed evidence. No database migration, live credential or new dependency. Rollback removes the additive package on the review branch. Proposed business role grants remain under ADR 0003 review.
