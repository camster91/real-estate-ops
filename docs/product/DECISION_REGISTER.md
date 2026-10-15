# M0 decision register — 7 October 2026

Repository: camster91/real-estate-ops (the user corrected the original organization). GitHub issues are canonical implementation status. PR #114 is planning; PR #116 is the tooling scaffold; PR #117 adds shared authorization contracts and this register. All are open, with no main merge. Reconciliation inspected branches, issues, PRs, Actions, README, AGENTS, all docs and backlog. No pre-existing work was replaced.

## Stable implementation constraints

The user's architecture and safety requirements establish these engineering constraints: Organization is the isolation boundary; legal brokerage responsibility is distinct; Party is independent of login; Property is independent of Listing; service case is independent of trade; explicit grants and default denial; deterministic internal work first; consequential actions require human approval; autonomous money movement/security bypass excluded; shared rules; transactional outbox/audit; Canadian-region preference; Mac is an outbound bounded gateway. These are sufficient for isolated foundation contracts, not activation of brokerage workflows or broad domain migrations.

| Topic | Defined design and trace | Remaining decision and accountable owner |
|---|---|---|
| Organization/brokerage/branch | ADR 0001; organization tenant, effective registration/BOR, scoped branch/team; #25 | Actual registrations, branches, shared-service scopes — company owner/BOR |
| People/company/household | ADR 0002; Party exactly one profile; household grouping does not confer consent/access; #22 | Actual identity dedupe review owner — operations |
| Relationships | Directed typed associations with provenance/effective dates, tenant-scoped identities; CORE_MODEL | Approved relationship vocabulary — operations/compliance |
| Service taxonomy | Versioned candidate codes, disabled until approved; #21/#22 | Pilot services and variants — company owner/BOR |
| Lead lifecycle | Candidate transitions, audited reasons and idempotent conversion; CORE_MODEL | Qualification and assignment policy — sales manager |
| Property/listing | Physical asset versus marketing instruction, units, entitled external refs; ADR 0002 | Marketing activation/rights owner — BOR/integration owner |
| Transaction/engagement | One engagement to zero/many trades, one accountable brokerage per trade; ADR 0002 | Actual representation/stage guard templates — BOR/operations |
| Tasks/workflows | Snapshot template versions, scoped acyclic dependencies, explicit waiting/blocked, timezone-aware dates; CORE_MODEL | Business-day/deadline variants — operations/BOR |
| Documents | Immutable version/checksum/quarantine; unknown applicability does not satisfy requirement; ADR 0005 | Required evidence schedule/waiver authority — compliance |
| Communications/activity | Provider metadata and typed associations, body ingestion opt-in, explicit consent purpose; CORE_MODEL | Retention, send authority and consent classification — compliance/operations |
| Finance/commission | External ledger authoritative, exact decimals and snapshot rules; ADR 0006 | Accounting vendor, tax/splits/rounding, trust authority — finance/BOR |
| Property management | Tenancy/inspection/maintenance extensions on engagement; ADR 0002 | Lease/rent/trust workflow and pilot inclusion — property manager/BOR |
| RBAC/ABAC | Explicit action/resource/classification/purpose grants, no owner-to-BOR inference; #24/#97 | Actual entitled roles and grant administration — access owner/BOR |
| External partners | Expiring explicit record projections and reviewed invitation, household/counterparty segregation; #23 | Partner fields/purposes/expiry — operations/compliance |
| Retention/audit | Versioned record-class policy, triggers, holds, append-only audit/checkpoints; ADR 0005 | Reviewed schedule, privacy grounds, checkpoint custody — compliance/privacy owner |
| Event/outbox/queue | Atomic mutation/audit/outbox, receipt dedupe, at-least-once delivery; ADR 0004, #84 (M1) | Queue/library and hosting selected after persistence tests — engineering |
| Integrations | Disabled until scopes/contract/rights and sandbox verified; ADR 0007 | Entitlements/accounting/phone vendors — integration and contract owners |
| Agent approval | L0–L4, exact content/version binding and reauthorization; ADR 0003; #76/#77 | Approver assignment, durable atomic consumption/executor review — access/compliance owner |
| Ontario compliance | Existing official-source review; unknown applicability blocks automation; compliance docs | Full legal applicability, policy/retention and workflow review — BOR/compliance adviser |

## Current blockers and safe continuation

- Original archive: searches in two connected Drive accounts found no real-estate-ops-github-seed.zip. Imported repository material was read; this is not independent archive checksum verification. Cameron supplies accessible location/file. Preserve the existing seed/backlog.
- GitHub Project: current credential lacks read:project. Existing #115 tracks private Project configuration, requested fields and privacy readback. Milestones and all seed issue assignments are complete. Cameron/GitHub administrator supplies Project capability; do not widen account permissions automatically.
- Brokerage policies: no named BOR/compliance owner or confirmed pilot workflows. Cameron supplies structure/reviewer/services; pending templates and consequential execution remain disabled.
- Identity/hosting: no configured OIDC tenants, hosting/data processor/residency policy or production secrets. Build provider-independent contracts and synthetic tests; no live access.
- UX/Figma: #103–#107 remain open; no linked current Figma artifact proves their completion. Tooling page screenshots do not satisfy core journey design.

## Completion rules and next dependency

M0 is incomplete. No proposed ADR is a substitute for an accountable policy review or Figma evidence. Do not close epics from document existence. #97 can progress through isolated shared decision contracts and negative tests without granting access; full closure depends on #96 identity/persistence and runtime enforcement. #76 shared action classification is groundwork only; #77 approvals need durable execution intent and transactional consumption before any executor exists. Major product slices remain behind the core-model gate. No main merge, production deployment, external communication or permission change is authorized by this register.
